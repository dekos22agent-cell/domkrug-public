/**
 * Сервис заявок — ядро системы.
 *
 * Ключевые правила (из docs/DB-SCHEMA.md и docs/API-CONTRACT.md):
 *   - номер заявки сквозной внутри УК, выдаётся из ticket_numbers;
 *   - житель создаёт заявку только по ПОДТВЕРЖДЁННОЙ привязке;
 *   - переходы статусов проверяются здесь, недопустимый переход — ошибка;
 *   - закрыть заявку без описания работ нельзя (триггер в БД + проверка тут);
 *   - исполнитель работает только со своими заявками;
 *   - телефон жителя скрывается от исполнителя после закрытия заявки.
 */
import { pool } from '../../db/pool.js';
import { decodeCursor, encodeCursor } from '../../lib/pagination.js';

export type Result<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

export interface StatusInfo {
  code: string;
  name: string;
}

export interface TicketSummary {
  id: string;
  number: number;
  status: StatusInfo;
  priority: string;
  source: string;
  category: { id: string; name: string };
  building: { id: string; addressText: string };
  apartment: { id: string; number: string } | null;
  title: string | null;
  assignedTo: { id: string; fullName: string } | null;
  slaDueAt: string | null;
  isOverdue: boolean;
  createdAt: string;
}

export interface TicketDetail extends TicketSummary {
  /** УК заявки: нужна, чтобы не запрашивать её отдельным SQL при комментарии */
  tenantId: string;
  description: string;
  locationNote: string | null;
  contactPhone: string | null;
  contactName: string | null;
  createdBy: { id: string; fullName: string };
  parentTicket: { id: string; number: number } | null;
  acceptedAt: string | null;
  startedAt: string | null;
  closedAt: string | null;
  resolutionNote: string | null;
  /** Норматив по категории в часах — то, что житель понимает как «срок». */
  slaHours: number;
  comments: {
    id: string;
    author: { id: string; fullName: string };
    body: string;
    isInternal: boolean;
    createdAt: string;
  }[];
}

// ─── Справочники ────────────────────────────────────────────────────────────

interface StatusRow {
  id: string;
  code: string;
  name: string;
  is_terminal: boolean;
}

async function loadStatuses(): Promise<Map<string, StatusRow>> {
  const res = await pool.query<StatusRow>(
    'SELECT id, code, name, is_terminal FROM ticket_statuses',
  );
  return new Map(res.rows.map((r) => [r.code, r]));
}

async function loadCategory(
  tenantId: string,
  categoryId: string,
): Promise<{ id: string; sla_hours: number; is_emergency: boolean } | null> {
  const res = await pool.query<{ id: string; default_sla_hours: number; is_emergency: boolean }>(
    `SELECT id, default_sla_hours, is_emergency
       FROM ticket_categories
      WHERE id = $1 AND (tenant_id = $2 OR tenant_id IS NULL) AND is_active = true
      LIMIT 1`,
    [categoryId, tenantId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { id: row.id, sla_hours: row.default_sla_hours, is_emergency: row.is_emergency };
}

// ─── Создание ───────────────────────────────────────────────────────────────

export interface CreateTicketInput {
  tenantId: string;
  buildingId: string;
  apartmentId: string | null;
  categoryId: string;
  priority: 'low' | 'normal' | 'high' | 'emergency';
  source: 'resident_app' | 'dispatcher_phone' | 'dispatcher_walkin';
  title?: string | null;
  description: string;
  locationNote?: string | null;
  contactPhone: string;
  contactName?: string | null;
  createdBy: string;
  parentTicketId?: string | null;
}

/**
 * Создаёт заявку и сразу первую запись истории.
 * Номер выдаётся через UPDATE ... RETURNING — без гонки MAX+1.
 */
export async function createTicket(input: CreateTicketInput): Promise<Result<{ id: string; number: number; status: StatusInfo; slaDueAt: string }>> {
  const client = await pool.connect();
  try {
    const category = await loadCategory(input.tenantId, input.categoryId);
    if (!category) {
      return { ok: false, code: 'NOT_FOUND', message: 'Категория не найдена' };
    }

    await client.query('BEGIN');

    // Счётчик на УК: строка создаётся при онбординге, но подстрахуемся
    await client.query(
      'INSERT INTO ticket_numbers (tenant_id, last_number) VALUES ($1, 0) ON CONFLICT (tenant_id) DO NOTHING',
      [input.tenantId],
    );
    const numRes = await client.query<{ last_number: number }>(
      'UPDATE ticket_numbers SET last_number = last_number + 1 WHERE tenant_id = $1 RETURNING last_number',
      [input.tenantId],
    );
    const number = numRes.rows[0]?.last_number;
    if (!number) throw new Error('Не удалось получить номер заявки');

    // Срок считается от момента создания
    const slaDueAt = new Date(Date.now() + category.sla_hours * 3600 * 1000);

    const insRes = await client.query<{ id: string; status_id: string }>(
      `INSERT INTO tickets
         (tenant_id, number, building_id, apartment_id, category_id, priority, source,
          title, description, location_note, contact_phone, contact_name, created_by,
          parent_ticket_id, sla_due_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id, status_id`,
      [
        input.tenantId,
        number,
        input.buildingId,
        input.apartmentId,
        input.categoryId,
        input.priority,
        input.source,
        input.title ?? null,
        input.description,
        input.locationNote ?? null,
        input.contactPhone,
        input.contactName ?? null,
        input.createdBy,
        input.parentTicketId ?? null,
        slaDueAt,
      ],
    );

    const created = insRes.rows[0];
    if (!created) throw new Error('Не удалось создать заявку');

    // Уведомляем УК о новой заявке — иначе диспетчер узнаёт о ней, только
    // заглянув в инбокс. Себе не пишем: заявку, оформленную на приёме,
    // сотрудник и так видит. Внутри транзакции: заявка без уведомления
    // диспетчеру — это заявка, которая может потеряться.
    await client.query(
      `INSERT INTO notifications (tenant_id, user_id, type, title, body, entity_type, entity_id)
       SELECT $1, s.user_id, 'ticket_created',
              'Новая заявка №' || $2, $3, 'ticket', $4
         FROM staff s
        WHERE s.tenant_id = $1
          AND s.is_active = true
          AND s.user_id <> $5
          AND EXISTS (
                SELECT 1
                  FROM user_roles ur
                  JOIN roles r ON r.id = ur.role_id
                 WHERE ur.user_id = s.user_id AND r.code IN ('dispatcher', 'uk_admin')
              )`,
      [
        input.tenantId,
        number,
        input.title ?? input.description.slice(0, 140),
        created.id,
        input.createdBy,
      ],
    );

    // Если обращение оформлено сотрудником «от имени жителя», создатель —
    // сотрудник, и обычная ветка уведомит только УК. Жителю, который
    // подтвердил квартиру, нужно увидеть заявку в своём колокольчике.
    await client.query(
      `INSERT INTO notifications (tenant_id, user_id, type, title, body, entity_type, entity_id)
       SELECT $1, rb.user_id, 'ticket_created',
              'Заявка №' || $2 || ' зарегистрирована',
              $3, 'ticket', $4
         FROM resident_bindings rb
         JOIN tickets t ON t.id = $4
        WHERE rb.tenant_id = $1
          AND rb.apartment_id = t.apartment_id
          AND rb.status = 'confirmed'
          AND rb.user_id <> $5`,
      [
        input.tenantId,
        number,
        input.title ?? input.description.slice(0, 140),
        created.id,
        input.createdBy,
      ],
    );

    await client.query('COMMIT');

    const statuses = await loadStatuses();
    const status = statuses.get('new');

    return {
      ok: true,
      data: {
        id: created.id,
        number,
        status: { code: status?.code ?? 'new', name: status?.name ?? 'Новая' },
        slaDueAt: slaDueAt.toISOString(),
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Может ли человек создавать заявки по этой квартире.
 *
 * Раньше проверялась только подтверждённая привязка. Теперь ещё и членство:
 * жена или арендатор могут подать заявку от квартиры, хотя собственниками
 * не являются. Права берём из представления apartment_rights.
 */
export async function hasConfirmedBinding(userId: string, apartmentId: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM apartment_rights
      WHERE user_id = $1 AND apartment_id = $2 AND can_tickets
      LIMIT 1`,
    [userId, apartmentId],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Максимальный приоритет из двух: при повторном обращении не понижаем. */
export function maxPriority(
  a: 'low' | 'normal' | 'high' | 'emergency',
  b: 'low' | 'normal' | 'high' | 'emergency',
): 'low' | 'normal' | 'high' | 'emergency' {
  const order = { low: 0, normal: 1, high: 2, emergency: 3 } as const;
  return order[a] >= order[b] ? a : b;
}

// ─── Чтение ─────────────────────────────────────────────────────────────────

const SUMMARY_SELECT = `
  SELECT t.id, t.number, t.priority, t.source, t.title, t.created_at, t.sla_due_at,
         t.closed_at,
         ts.code AS status_code, ts.name AS status_name,
         c.id AS category_id, c.name AS category_name,
         b.id AS building_id, b.address_text,
         a.id AS apartment_id, a.number AS apartment_number,
         e.id AS assignee_id, e.full_name AS assignee_name
    FROM tickets t
    JOIN ticket_statuses ts ON ts.id = t.status_id
    JOIN ticket_categories c ON c.id = t.category_id
    JOIN buildings b ON b.id = t.building_id
    LEFT JOIN apartments a ON a.id = t.apartment_id
    LEFT JOIN users e ON e.id = t.assigned_to
`;

interface SummaryRow {
  id: string;
  number: number;
  priority: string;
  source: string;
  title: string | null;
  created_at: Date;
  sla_due_at: Date | null;
  closed_at: Date | null;
  status_code: string;
  status_name: string;
  category_id: string;
  category_name: string;
  building_id: string;
  address_text: string;
  apartment_id: string | null;
  apartment_number: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
}

function toSummary(r: SummaryRow): TicketSummary {
  return {
    id: r.id,
    number: r.number,
    status: { code: r.status_code, name: r.status_name },
    priority: r.priority,
    source: r.source,
    category: { id: r.category_id, name: r.category_name },
    building: { id: r.building_id, addressText: r.address_text },
    apartment: r.apartment_id && r.apartment_number
      ? { id: r.apartment_id, number: r.apartment_number }
      : null,
    title: r.title,
    assignedTo: r.assignee_id && r.assignee_name
      ? { id: r.assignee_id, fullName: r.assignee_name }
      : null,
    slaDueAt: r.sla_due_at ? r.sla_due_at.toISOString() : null,
    // Просрочка — только для незакрытых: закрытая заявка не «просрочена», она выполнена
    isOverdue: Boolean(r.sla_due_at && !r.closed_at && r.sla_due_at.getTime() < Date.now()),
    createdAt: r.created_at.toISOString(),
  };
}

export interface ListFilters {
  status?: string[] | undefined;
  categoryId?: string | undefined;
  buildingId?: string | undefined;
  assignedTo?: string | undefined;
  priority?: string | undefined;
  onlyOverdue?: boolean | undefined;
  onlyEmergency?: boolean | undefined;
  q?: string | undefined;
  sort?: 'createdAt' | 'slaDueAt' | 'priority' | undefined;
  limit: number;
  cursor?: string | undefined;
}

export async function listTickets(
  tenantId: string,
  scope: { kind: 'all' } | { kind: 'assigned'; userId: string },
  filters: ListFilters,
): Promise<{ items: TicketSummary[]; nextCursor: string | null }> {
  const conditions: string[] = ['t.tenant_id = $1', 't.deleted_at IS NULL'];
  const params: unknown[] = [tenantId];

  if (scope.kind === 'assigned') {
    params.push(scope.userId);
    conditions.push(`t.assigned_to = $${params.length}`);
  }

  if (filters.status && filters.status.length > 0) {
    params.push(filters.status);
    conditions.push(`ts.code = ANY($${params.length}::text[])`);
  }
  if (filters.categoryId) {
    params.push(filters.categoryId);
    conditions.push(`t.category_id = $${params.length}`);
  }
  if (filters.buildingId) {
    params.push(filters.buildingId);
    conditions.push(`t.building_id = $${params.length}`);
  }
  if (filters.assignedTo === 'me') {
    params.push(scope.kind === 'assigned' ? scope.userId : null);
    conditions.push(`t.assigned_to = $${params.length}`);
  } else if (filters.assignedTo) {
    params.push(filters.assignedTo);
    conditions.push(`t.assigned_to = $${params.length}`);
  }
  if (filters.priority) {
    params.push(filters.priority);
    conditions.push(`t.priority = $${params.length}`);
  }
  if (filters.onlyOverdue) {
    conditions.push(`t.closed_at IS NULL AND t.sla_due_at IS NOT NULL AND t.sla_due_at < now()`);
  }
  if (filters.onlyEmergency) {
    conditions.push(`t.priority = 'emergency' AND t.closed_at IS NULL`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    const idx = params.length;
    // Номер ищем точным совпадением, если ввели число
    conditions.push(
      `(b.address_text ILIKE $${idx} OR t.description ILIKE $${idx} OR t.title ILIKE $${idx}
        OR t.number::text = regexp_replace($${idx}::text, '\\D', '', 'g'))`,
    );
  }

  const cursor = decodeCursor(filters.cursor);
  if (cursor) {
    params.push(cursor.createdAt, cursor.id);
    conditions.push(
      `(t.created_at, t.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
    );
  }

  const orderBy =
    filters.sort === 'slaDueAt'
      ? 't.sla_due_at ASC NULLS LAST, t.created_at DESC'
      : filters.sort === 'priority'
        ? `CASE t.priority WHEN 'emergency' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.created_at DESC`
        : 't.created_at DESC, t.id DESC';

  params.push(filters.limit + 1);
  const res = await pool.query<SummaryRow>(
    `${SUMMARY_SELECT}
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT $${params.length}`,
    params,
  );

  const hasMore = res.rows.length > filters.limit;
  const page = hasMore ? res.rows.slice(0, filters.limit) : res.rows;
  const last = page[page.length - 1];

  return {
    items: page.map(toSummary),
    nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
  };
}

/** Заявки жителя: свои + по квартирам с подтверждённой привязкой. */
export async function listResidentTickets(
  userId: string,
  limit: number,
  cursorRaw: string | undefined,
): Promise<{ items: TicketSummary[]; nextCursor: string | null }> {
  const cursor = decodeCursor(cursorRaw);
  const params: unknown[] = [userId];
  const conditions = [
    't.deleted_at IS NULL',
    `(t.created_by = $1 OR t.apartment_id IN (
        SELECT rb.apartment_id FROM resident_bindings rb
         WHERE rb.user_id = $1 AND rb.status = 'confirmed'
      ))`,
  ];

  if (cursor) {
    params.push(cursor.createdAt, cursor.id);
    conditions.push(
      `(t.created_at, t.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
    );
  }
  params.push(limit + 1);

  const res = await pool.query<SummaryRow>(
    `${SUMMARY_SELECT}
      WHERE ${conditions.join(' AND ')}
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT $${params.length}`,
    params,
  );

  const hasMore = res.rows.length > limit;
  const page = hasMore ? res.rows.slice(0, limit) : res.rows;
  const last = page[page.length - 1];

  return {
    items: page.map(toSummary),
    nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
  };
}

interface DetailRow extends SummaryRow {
  tenant_id: string;
  description: string;
  location_note: string | null;
  contact_phone: string;
  contact_name: string | null;
  created_by_id: string;
  created_by_name: string;
  parent_id: string | null;
  parent_number: number | null;
  accepted_at: Date | null;
  started_at: Date | null;
  resolution_note: string | null;
  /** Норматив по категории в часах — показываем жителю как «срок 4 часа». */
  sla_hours: number;
}

const DETAIL_SELECT = `
  SELECT t.id, t.number, t.priority, t.source, t.title, t.created_at, t.sla_due_at, t.closed_at,
         t.tenant_id, t.description, t.location_note, t.contact_phone, t.contact_name,
         t.accepted_at, t.started_at, t.resolution_note,
         ts.code AS status_code, ts.name AS status_name,
         c.id AS category_id, c.name AS category_name, c.default_sla_hours AS sla_hours,
         b.id AS building_id, b.address_text,
         a.id AS apartment_id, a.number AS apartment_number,
         e.id AS assignee_id, e.full_name AS assignee_name,
         t.created_by AS created_by_id, u.full_name AS created_by_name,
         t.parent_ticket_id AS parent_id, pt.number AS parent_number
    FROM tickets t
    JOIN ticket_statuses ts ON ts.id = t.status_id
    JOIN ticket_categories c ON c.id = t.category_id
    JOIN buildings b ON b.id = t.building_id
    LEFT JOIN apartments a ON a.id = t.apartment_id
    LEFT JOIN users e ON e.id = t.assigned_to
    JOIN users u ON u.id = t.created_by
    LEFT JOIN tickets pt ON pt.id = t.parent_ticket_id
`;

async function loadDetailRows(
  where: string,
  params: unknown[],
): Promise<DetailRow | null> {
  const res = await pool.query<DetailRow>(
    `${DETAIL_SELECT} WHERE ${where} LIMIT 1`,
    params,
  );
  return res.rows[0] ?? null;
}

async function loadComments(
  ticketId: string,
  includeInternal: boolean,
): Promise<TicketDetail['comments']> {
  const res = await pool.query<{
    id: string;
    body: string;
    is_internal: boolean;
    created_at: Date;
    author_id: string;
    author_name: string;
  }>(
    `SELECT c.id, c.body, c.is_internal, c.created_at,
            u.id AS author_id, u.full_name AS author_name
       FROM ticket_comments c
       JOIN users u ON u.id = c.author_id
      WHERE c.ticket_id = $1
        AND c.deleted_at IS NULL
        AND ($2::boolean OR c.is_internal = false)
      ORDER BY c.created_at ASC`,
    [ticketId, includeInternal],
  );

  return res.rows.map((r) => ({
    id: r.id,
    author: { id: r.author_id, fullName: r.author_name },
    body: r.body,
    isInternal: r.is_internal,
    createdAt: r.created_at.toISOString(),
  }));
}

export interface Viewer {
  userId: string;
  tenantId: string | null;
  /** 'all' — вся УК, 'assigned' — только свои, 'resident' — свои заявки */
  scope: 'all' | 'assigned' | 'resident';
}

function toDetail(
  r: DetailRow,
  comments: TicketDetail['comments'],
  hideContactPhone: boolean,
): TicketDetail {
  return {
    ...toSummary(r),
    tenantId: r.tenant_id,
    description: r.description,
    locationNote: r.location_note,
    contactPhone: hideContactPhone ? null : r.contact_phone,
    contactName: r.contact_name,
    createdBy: { id: r.created_by_id, fullName: r.created_by_name },
    parentTicket:
      r.parent_id && r.parent_number ? { id: r.parent_id, number: r.parent_number } : null,
    acceptedAt: r.accepted_at ? r.accepted_at.toISOString() : null,
    startedAt: r.started_at ? r.started_at.toISOString() : null,
    closedAt: r.closed_at ? r.closed_at.toISOString() : null,
    resolutionNote: r.resolution_note,
    slaHours: Number(r.sla_hours),
    comments,
  };
}

export async function getTicketForStaff(
  tenantId: string,
  ticketId: string,
  scope: 'all' | 'assigned',
  userId: string,
): Promise<Result<TicketDetail>> {
  const params: unknown[] = [tenantId, ticketId];
  let where = 't.tenant_id = $1 AND t.id = $2 AND t.deleted_at IS NULL';
  if (scope === 'assigned') {
    params.push(userId);
    where += ` AND t.assigned_to = $${params.length}`;
  }

  const row = await loadDetailRows(where, params);
  if (!row) {
    // Чужая УК и чужая заявка неразличимы: 404 и там, и там
    return { ok: false, code: 'NOT_FOUND', message: 'Заявка не найдена' };
  }

  // Сотрудники УК видят служебные комментарии, житель — нет
  const comments = await loadComments(ticketId, true);
  // Исполнитель не должен видеть телефон жителя после закрытия: работа сделана,
  // персональные данные больше не нужны
  const hidePhone = scope === 'assigned' && row.closed_at !== null;

  return { ok: true, data: toDetail(row, comments, hidePhone) };
}

export async function getTicketForResident(
  userId: string,
  ticketId: string,
): Promise<Result<TicketDetail>> {
  const row = await loadDetailRows(
    `t.id = $1 AND t.deleted_at IS NULL
     AND (t.created_by = $2 OR t.apartment_id IN (
            SELECT rb.apartment_id FROM resident_bindings rb
             WHERE rb.user_id = $2 AND rb.status = 'confirmed'
          ))`,
    [ticketId, userId],
  );

  if (!row) return { ok: false, code: 'NOT_FOUND', message: 'Заявка не найдена' };

  // Житель никогда не видит служебные комментарии
  const comments = await loadComments(ticketId, false);
  return { ok: true, data: toDetail(row, comments, false) };
}

// ─── Изменение ──────────────────────────────────────────────────────────────

/** Допустимые переходы статусов. Ключ — «откуда→куда». */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  'new→accepted': ['dispatcher', 'admin'],
  'accepted→assigned': ['dispatcher', 'admin'],
  'assigned→in_progress': ['executor', 'dispatcher', 'admin'],
  'in_progress→waiting': ['executor', 'dispatcher', 'admin'],
  'waiting→in_progress': ['executor', 'dispatcher', 'admin'],
  'in_progress→done': ['executor', 'dispatcher', 'admin'],
  'waiting→done': ['executor', 'dispatcher', 'admin'],
  'done→closed': ['executor', 'admin'],
  'in_progress→closed': ['executor', 'admin'],
  'waiting→closed': ['executor', 'admin'],
};

export interface TransitionInput {
  tenantId: string;
  ticketId: string;
  toCode: string;
  byUserId: string;
  /** 'all' — диспетчер/админ, 'assigned' — исполнитель */
  scope: 'all' | 'assigned';
  actorKind: 'executor' | 'dispatcher' | 'admin';
  comment?: string | undefined;
  resolutionNote?: string | undefined;
}

export async function transitionStatus(
  input: TransitionInput,
): Promise<Result<{ status: StatusInfo }>> {
  const statuses = await loadStatuses();
  const target = statuses.get(input.toCode);
  if (!target) return { ok: false, code: 'BAD_REQUEST', message: 'Неизвестный статус' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const params: unknown[] = [input.tenantId, input.ticketId];
    let where = 't.tenant_id = $1 AND t.id = $2 AND t.deleted_at IS NULL';
    if (input.scope === 'assigned') {
      params.push(input.byUserId);
      where += ` AND t.assigned_to = $${params.length}`;
    }

    const currentRes = await client.query<{
      status_code: string;
      status_id: string;
      assigned_to: string | null;
      priority: string;
      created_by: string;
    }>(
      `SELECT ts.code AS status_code, t.status_id, t.assigned_to, t.priority, t.created_by
         FROM tickets t
         JOIN ticket_statuses ts ON ts.id = t.status_id
        WHERE ${where}
        FOR UPDATE`,
      params,
    );

    const current = currentRes.rows[0];
    if (!current) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'NOT_FOUND', message: 'Заявка не найдена' };
    }

    const key = `${current.status_code}→${input.toCode}`;
    const allowedActors = ALLOWED_TRANSITIONS[key];

    // Закрывает тот, кто выполнил работу. Право `ticket.close` есть у
    // исполнителя и админа, но на практике исполнителем может оказаться
    // и диспетчер — например, когда он сам выехал. Поэтому назначенному
    // на заявку закрытие разрешено независимо от роли.
    const closesAsAssignee =
      input.toCode === 'closed' && current.assigned_to === input.byUserId;

    // Отклонение — особый случай: разрешено из любого незавершённого статуса,
    // но только диспетчеру и админу, и обязательно с причиной
    const isReject = input.toCode === 'rejected';
    const currentIsTerminal = current.status_code === 'closed' || current.status_code === 'rejected';

    if (isReject) {
      if (currentIsTerminal) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'CONFLICT', message: 'Заявка уже завершена' };
      }
      // Работы выполнены — отклонять нечего. Отклонение здесь означало бы
      // «сделали, но заявку не принимаем», что противоречит и смыслу, и учёту.
      if (current.status_code === 'done') {
        await client.query('ROLLBACK');
        return {
          ok: false,
          code: 'CONFLICT',
          message: 'Работы по заявке уже выполнены — отклонить её нельзя',
        };
      }
      if (input.actorKind === 'executor') {
        await client.query('ROLLBACK');
        return { ok: false, code: 'FORBIDDEN', message: 'Отклонять заявки может диспетчер или администратор' };
      }
      if (!input.comment) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'VALIDATION_ERROR', message: 'Укажите причину отклонения' };
      }
    } else if (!allowedActors) {
      // Сам переход недопустим — здесь послабление для назначенного не работает:
      // нельзя закрыть заявку, которую даже не начинали.
      await client.query('ROLLBACK');
      return {
        ok: false,
        code: 'INVALID_STATUS_TRANSITION',
        message: `Нельзя перевести заявку из «${statuses.get(current.status_code)?.name ?? current.status_code}» в «${target.name}»`,
      };
    } else if (!closesAsAssignee && !allowedActors.includes(input.actorKind)) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        code: 'FORBIDDEN',
        message: 'У вашей роли нет права на этот переход',
      };
    }

    // Работы ведёт назначенный. Диспетчер, который распределил заявку, но сам
    // на неё не назначен, не может «взять её в работу» — иначе непонятно,
    // кто на самом деле работает. Администратор — исключение: он может
    // подстраховать.
    const isWorkAction = input.toCode === 'in_progress' || input.toCode === 'waiting';
    if (isWorkAction && input.actorKind !== 'admin' && current.assigned_to !== input.byUserId) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        code: 'FORBIDDEN',
        message: 'Вести работы по заявке может только назначенный исполнитель',
      };
    }

    // Обязательные поля на переход
    if (input.toCode === 'waiting' && !input.comment) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'Укажите, чего именно ждёт заявка (комментарий обязателен)',
      };
    }
    if (input.toCode === 'done' && !input.comment) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'Опишите, что сделано (комментарий обязателен)',
      };
    }
    if (input.toCode === 'closed' && !input.resolutionNote) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        code: 'CANNOT_CLOSE_WITHOUT_RESOLUTION',
        message: 'Нельзя закрыть заявку без описания выполненных работ',
      };
    }
    // Закрывать может только тот, кому заявка назначена (или админ)
    if (input.toCode === 'closed' && input.actorKind === 'executor' && input.scope !== 'assigned') {
      await client.query('ROLLBACK');
      return { ok: false, code: 'FORBIDDEN', message: 'Закрывать можно только назначенные вам заявки' };
    }

    const updates: string[] = [];
    const updateParams: unknown[] = [input.ticketId, target.id];

    if (input.toCode === 'accepted') updates.push('accepted_at = COALESCE(accepted_at, now())');
    if (input.toCode === 'in_progress') updates.push('started_at = COALESCE(started_at, now())');
    if (input.toCode === 'closed') {
      updates.push('closed_by = $' + (updateParams.length + 1));
      updateParams.push(input.byUserId);
      updates.push('resolution_note = $' + (updateParams.length + 1));
      updateParams.push(input.resolutionNote);
    }

    await client.query(
      `UPDATE tickets
          SET status_id = $2
              ${updates.length ? ', ' + updates.join(', ') : ''}
        WHERE id = $1`,
      updateParams,
    );

    await client.query(
      `INSERT INTO ticket_status_history (tenant_id, ticket_id, from_status_id, to_status_id, changed_by, comment)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.tenantId,
        input.ticketId,
        current.status_id,
        target.id,
        input.byUserId,
        input.comment ?? input.resolutionNote ?? null,
      ],
    );

    // Уведомление жителю о смене статуса.
    //
    // created_by — не всегда житель: диспетчер может оформить заявку
    // «от имени жителя», и тогда создатель — сотрудник. Поэтому берём
    // создателя и всех подтверждённых жителей квартиры, кроме того, кто
    // сам изменил статус.
    await client.query(
      `WITH recipients AS (
         SELECT t.created_by AS user_id
           FROM tickets t
          WHERE t.id = $2
         UNION
         SELECT rb.user_id
           FROM tickets t
           JOIN resident_bindings rb
             ON rb.tenant_id = t.tenant_id
            AND rb.apartment_id = t.apartment_id
            AND rb.status = 'confirmed'
          WHERE t.id = $2
            AND t.apartment_id IS NOT NULL
       )
       INSERT INTO notifications (tenant_id, user_id, type, title, body, entity_type, entity_id)
       SELECT $1, r.user_id, 'ticket_status_changed',
              'Статус заявки №' || t.number || ' изменён',
              $3, 'ticket', t.id
         FROM recipients r
         JOIN tickets t ON t.id = $2
        WHERE r.user_id <> $4`,
      [
        input.tenantId,
        input.ticketId,
        `Новый статус: ${target.name}${input.resolutionNote ? '. ' + input.resolutionNote : ''}`,
        input.byUserId,
      ],
    );

    await client.query('COMMIT');
    return { ok: true, data: { status: { code: target.code, name: target.name } } };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Назначение исполнителя: обновляет заявку и пишет историю назначений. */
export async function assignTicket(input: {
  tenantId: string;
  ticketId: string;
  assigneeId: string;
  byUserId: string;
}): Promise<Result<{ assignee: { id: string; fullName: string }; status: StatusInfo }>> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const res = await client.query<{ status_code: string; status_id: string }>(
      `SELECT ts.code AS status_code, t.status_id
         FROM tickets t JOIN ticket_statuses ts ON ts.id = t.status_id
        WHERE t.tenant_id = $1 AND t.id = $2 AND t.deleted_at IS NULL
        FOR UPDATE`,
      [input.tenantId, input.ticketId],
    );
    const current = res.rows[0];
    if (!current) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'NOT_FOUND', message: 'Заявка не найдена' };
    }

    if (current.status_code === 'closed' || current.status_code === 'rejected') {
      await client.query('ROLLBACK');
      return { ok: false, code: 'CONFLICT', message: 'Заявка уже завершена' };
    }

    // Работы уже выполнены: переназначение вернуло бы статус назад и стёрло
    // факт выполнения. Для переделки есть отдельный путь через комментарий,
    // а не «назначить другого» поверх закрытого результата.
    if (current.status_code === 'done') {
      await client.query('ROLLBACK');
      return {
        ok: false,
        code: 'CONFLICT',
        message: 'Работы по заявке уже выполнены — переназначение невозможно',
      };
    }

    // Исполнитель должен быть активным сотрудником этой же УК
    const staffRes = await client.query<{ full_name: string }>(
      `SELECT u.full_name
         FROM staff s JOIN users u ON u.id = s.user_id
        WHERE s.tenant_id = $1 AND s.user_id = $2 AND s.is_active = true
        LIMIT 1`,
      [input.tenantId, input.assigneeId],
    );
    const assignee = staffRes.rows[0];
    if (!assignee) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'NOT_FOUND', message: 'Исполнитель не найден в этой управляющей компании' };
    }

    // Закрываем предыдущее назначение, если было
    await client.query(
      `UPDATE ticket_assignments SET unassigned_at = now()
        WHERE ticket_id = $1 AND unassigned_at IS NULL`,
      [input.ticketId],
    );

    await client.query(
      `INSERT INTO ticket_assignments (tenant_id, ticket_id, assignee_id, assigned_by)
       VALUES ($1, $2, $3, $4)`,
      [input.tenantId, input.ticketId, input.assigneeId, input.byUserId],
    );

    const statuses = await loadStatuses();
    const assignedStatus = statuses.get('assigned');
    if (!assignedStatus) throw new Error('Статус assigned отсутствует');

    // Назначение подразумевает, что заявку приняли: диспетчер не может отдать
    // её, не отреагировав. Заполняем accepted_at, если ещё пусто, иначе
    // «время реакции» оставалось бы неизвестным при назначении прямо
    // из «Новой».
    await client.query(
      `UPDATE tickets
          SET assigned_to = $2,
              status_id = $3,
              accepted_at = COALESCE(accepted_at, now())
        WHERE id = $1`,
      [input.ticketId, input.assigneeId, assignedStatus.id],
    );

    await client.query(
      `INSERT INTO ticket_status_history (tenant_id, ticket_id, from_status_id, to_status_id, changed_by, comment)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.tenantId,
        input.ticketId,
        current.status_id,
        assignedStatus.id,
        input.byUserId,
        `Назначен исполнитель: ${assignee.full_name}`,
      ],
    );

    // Уведомление исполнителю
    await client.query(
      `INSERT INTO notifications (tenant_id, user_id, type, title, body, entity_type, entity_id)
       SELECT $1, $2, 'ticket_assigned',
              'Вам назначена заявка №' || t.number, t.title, 'ticket', t.id
         FROM tickets t WHERE t.id = $3`,
      [input.tenantId, input.assigneeId, input.ticketId],
    );

    // Жителям квартиры — отдельное уведомление: назначение исполнителя
    // для них такое же значимое событие, как смена статуса.
    await client.query(
      `INSERT INTO notifications (tenant_id, user_id, type, title, body, entity_type, entity_id)
       SELECT $1, rb.user_id, 'ticket_assigned',
              'Назначен исполнитель по заявке №' || t.number,
              'Исполнитель: ' || $4, 'ticket', t.id
         FROM tickets t
         JOIN resident_bindings rb
           ON rb.tenant_id = t.tenant_id
          AND rb.apartment_id = t.apartment_id
          AND rb.status = 'confirmed'
        WHERE t.id = $2
          AND rb.user_id <> $3`,
      [input.tenantId, input.ticketId, input.byUserId, assignee.full_name],
    );

    await client.query('COMMIT');
    return {
      ok: true,
      data: {
        assignee: { id: input.assigneeId, fullName: assignee.full_name },
        status: { code: assignedStatus.code, name: assignedStatus.name },
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function addComment(input: {
  tenantId: string;
  ticketId: string;
  authorId: string;
  body: string;
  isInternal: boolean;
}): Promise<Result<{ id: string; createdAt: string }>> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // tenant_id обязателен уже здесь, а не только в вызывающем маршруте:
    // сервис не должен полагаться на то, что снаружи всё проверили.
    const check = await client.query(
      'SELECT 1 FROM tickets WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
      [input.ticketId, input.tenantId],
    );
    if (!check.rows[0]) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'NOT_FOUND', message: 'Заявка не найдена' };
    }

    const res = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO ticket_comments (tenant_id, ticket_id, author_id, body, is_internal)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
      [input.tenantId, input.ticketId, input.authorId, input.body, input.isInternal],
    );
    const row = res.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'INTERNAL', message: 'Не удалось добавить комментарий' };
    }

    // Комментарий сам по себе не меняет заявку, поэтому без этого UPDATE сигнал
    // обновлений на нём не срабатывал бы: список у диспетчера и у жителя
    // оставался бы «тихим», хотя разговор идёт.
    await client.query(
      'UPDATE tickets SET updated_at = now() WHERE id = $1 AND tenant_id = $2',
      [input.ticketId, input.tenantId],
    );

    // Жителю — об ответе УК. Служебный комментарий ему не показываем и не
    // уведомляем: иначе уведомление ведёт в текст, которого он не увидит.
    await client.query(
      `WITH recipients AS (
         SELECT t.created_by AS user_id
           FROM tickets t
          WHERE t.id = $3
            AND t.tenant_id = $1
         UNION
         SELECT rb.user_id
           FROM tickets t
           JOIN resident_bindings rb
             ON rb.tenant_id = t.tenant_id
            AND rb.apartment_id = t.apartment_id
            AND rb.status = 'confirmed'
          WHERE t.id = $3
            AND t.tenant_id = $1
            AND t.apartment_id IS NOT NULL
       )
       INSERT INTO notifications (tenant_id, user_id, type, title, body, entity_type, entity_id)
       SELECT $1, r.user_id, 'ticket_comment',
              'Ответ по заявке №' || t.number, left($2, 200), 'ticket', t.id
         FROM recipients r
         JOIN tickets t ON t.id = $3
        WHERE r.user_id <> $4 AND $5::boolean = false`,
      [input.tenantId, input.body, input.ticketId, input.authorId, input.isInternal],
    );

    // Исполнителю — о сообщении жителя: он может ждать уточнения, а увидит его
    // только открыв заявку.
    await client.query(
      `INSERT INTO notifications (tenant_id, user_id, type, title, body, entity_type, entity_id)
       SELECT $1, t.assigned_to, 'ticket_comment',
              'Комментарий к заявке №' || t.number, left($2, 200), 'ticket', t.id
         FROM tickets t
        WHERE t.id = $3 AND t.tenant_id = $1
          AND t.assigned_to IS NOT NULL AND t.assigned_to <> $4`,
      [input.tenantId, input.body, input.ticketId, input.authorId],
    );

    await client.query('COMMIT');
    return { ok: true, data: { id: row.id, createdAt: row.created_at.toISOString() } };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listHistory(
  tenantId: string,
  ticketId: string,
): Promise<{ from: StatusInfo | null; to: StatusInfo; by: string; comment: string | null; at: string }[]> {
  const res = await pool.query<{
    from_code: string | null;
    from_name: string | null;
    to_code: string;
    to_name: string;
    changed_by_name: string;
    comment: string | null;
    created_at: Date;
  }>(
    `SELECT fs.code AS from_code, fs.name AS from_name,
            ts.code AS to_code, ts.name AS to_name,
            u.full_name AS changed_by_name, h.comment, h.created_at
       FROM ticket_status_history h
       JOIN ticket_statuses ts ON ts.id = h.to_status_id
       LEFT JOIN ticket_statuses fs ON fs.id = h.from_status_id
       JOIN users u ON u.id = h.changed_by
      WHERE h.tenant_id = $1 AND h.ticket_id = $2
      ORDER BY h.created_at ASC`,
    [tenantId, ticketId],
  );

  return res.rows.map((r) => ({
    from: r.from_code && r.from_name ? { code: r.from_code, name: r.from_name } : null,
    to: { code: r.to_code, name: r.to_name },
    by: r.changed_by_name,
    comment: r.comment,
    at: r.created_at.toISOString(),
  }));
}

/** Первичная заявка для повторного обращения: та же квартира и категория. */
export async function getTicketBasicsForRepeat(
  userId: string,
  ticketId: string,
): Promise<Result<{ tenantId: string; buildingId: string; apartmentId: string | null; categoryId: string; statusCode: string }>> {
  const res = await pool.query<{
    tenant_id: string;
    building_id: string;
    apartment_id: string | null;
    category_id: string;
    status_code: string;
  }>(
    `SELECT t.tenant_id, t.building_id, t.apartment_id, t.category_id, ts.code AS status_code
       FROM tickets t JOIN ticket_statuses ts ON ts.id = t.status_id
      WHERE t.id = $1 AND t.deleted_at IS NULL
        AND (t.created_by = $2 OR t.apartment_id IN (
              SELECT rb.apartment_id FROM resident_bindings rb
               WHERE rb.user_id = $2 AND rb.status = 'confirmed'
            ))
      LIMIT 1`,
    [ticketId, userId],
  );

  const row = res.rows[0];
  if (!row) return { ok: false, code: 'NOT_FOUND', message: 'Заявка не найдена' };

  return {
    ok: true,
    data: {
      tenantId: row.tenant_id,
      buildingId: row.building_id,
      apartmentId: row.apartment_id,
      categoryId: row.category_id,
      statusCode: row.status_code,
    },
  };
}

/** Не чаще одного повторного обращения в сутки по одной заявке. */
export async function canRepeatWithinDay(parentTicketId: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM tickets
      WHERE parent_ticket_id = $1 AND created_at > now() - interval '24 hours'
      LIMIT 1`,
    [parentTicketId],
  );
  return (res.rowCount ?? 0) === 0;
}
