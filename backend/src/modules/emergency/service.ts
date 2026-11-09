/**
 * Экстренные сообщения и вызовы.
 *
 * Две разные вещи, которые легко перепутать:
 *
 *  - **сообщение** — УК предупреждает жителей (отключение воды, ремонт,
 *    авария). Только чтение;
 *  - **вызов** — житель зовёт помощь. Здесь важна не логика, а журнал:
 *    кто, когда, откуда и чем закончилось. По нему потом разбирают спорные
 *    ситуации, поэтому вызов нельзя «удалить» — только отменить.
 *
 * Экстренные службы (112, скорая, полиция) в реальности не принимают вызовы
 * через сторонние приложения. Поэтому сервер не изображает, что «вызов
 * передан в скорую»: он фиксирует намерение и показывает человеку номер,
 * по которому нужно позвонить. Это честнее и безопаснее.
 */
import { pool } from '../../db/pool.js';

export type Severity = 'info' | 'warning' | 'critical';
export type CallKind = 'uk_duty' | 'police' | 'ambulance' | 'fire' | 'gas';

export interface EmergencyMessage {
  id: string;
  title: string;
  body: string;
  severity: Severity;
  publishedAt: string;
  expiresAt: string | null;
  buildingAddress: string | null;
}

/** Активные сообщения для домов, где живёт человек. */
export async function listMessagesForUser(userId: string): Promise<EmergencyMessage[]> {
  const res = await pool.query<{
    id: string;
    title: string;
    body: string;
    severity: Severity;
    published_at: string;
    expires_at: string | null;
    address_text: string | null;
  }>(
    `SELECT DISTINCT m.id, m.title, m.body, m.severity,
            m.published_at::text AS published_at,
            m.expires_at::text AS expires_at,
            b.address_text
       FROM resident_bindings rb
       JOIN apartments a ON a.id = rb.apartment_id
       JOIN emergency_messages m
         ON m.tenant_id = rb.tenant_id
        AND (m.building_id IS NULL OR m.building_id = a.building_id)
       LEFT JOIN buildings b ON b.id = m.building_id
      WHERE rb.user_id = $1
        AND rb.status = 'confirmed'
        AND m.published_at <= now()
        AND (m.expires_at IS NULL OR m.expires_at > now())
      ORDER BY published_at DESC`,
    [userId],
  );

  return res.rows.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    severity: row.severity,
    publishedAt: row.published_at,
    expiresAt: row.expires_at,
    buildingAddress: row.address_text,
  }));
}

export interface EmergencyCallItem {
  id: string;
  kind: CallKind;
  status: 'requested' | 'accepted' | 'cancelled';
  locationNote: string | null;
  createdAt: string;
  acceptedAt: string | null;
}

export async function listCallsForUser(userId: string, limit = 10): Promise<EmergencyCallItem[]> {
  const res = await pool.query<{
    id: string;
    kind: CallKind;
    status: 'requested' | 'accepted' | 'cancelled';
    location_note: string | null;
    created_at: string;
    accepted_at: string | null;
  }>(
    `SELECT id, kind, status, location_note, created_at::text AS created_at,
            accepted_at::text AS accepted_at
       FROM emergency_calls
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, Math.min(limit, 50)],
  );

  return res.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    locationNote: row.location_note,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
  }));
}

export interface CreateCallResult {
  ok: boolean;
  call?: EmergencyCallItem;
  message?: string;
  status?: 404 | 429;
  code?: string;
}

/** Не чаще одного вызова в 5 минут: защита от случайного двойного нажатия. */
const CALL_COOLDOWN_SECONDS = 300;

export async function createCall(
  userId: string,
  kind: CallKind,
  locationNote: string | null,
): Promise<CreateCallResult> {
  // Нужна подтверждённая привязка: иначе непонятно, куда ехать
  const binding = await pool.query<{ tenant_id: string; apartment_id: string }>(
    `SELECT tenant_id, apartment_id FROM resident_bindings
      WHERE user_id = $1 AND status = 'confirmed' LIMIT 1`,
    [userId],
  );
  const row = binding.rows[0];
  if (!row) {
    return {
      ok: false,
      status: 404,
      code: 'BINDING_NOT_CONFIRMED',
      message: 'Сначала подтвердите привязку к квартире',
    };
  }

  const recent = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM emergency_calls
      WHERE user_id = $1 AND created_at > now() - ($2 || ' seconds')::interval`,
    [userId, CALL_COOLDOWN_SECONDS],
  );
  if (Number(recent.rows[0]?.count ?? '0') > 0) {
    return {
      ok: false,
      status: 429,
      code: 'TOO_MANY_REQUESTS',
      message: 'Вызов уже отправлен. Подождите несколько минут.',
    };
  }

  const inserted = await pool.query<EmergencyCallItem>(
    `INSERT INTO emergency_calls (tenant_id, user_id, apartment_id, kind, location_note)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, kind, status, location_note AS "locationNote",
               created_at::text AS "createdAt", accepted_at::text AS "acceptedAt"`,
    [row.tenant_id, userId, row.apartment_id, kind, locationNote],
  );

  return { ok: true, call: inserted.rows[0] };
}

/** Отменить вызов можно, пока его не приняли. */
export async function cancelCall(userId: string, callId: string): Promise<boolean> {
  const res = await pool.query(
    `UPDATE emergency_calls SET status = 'cancelled'
      WHERE id = $1 AND user_id = $2 AND status = 'requested'`,
    [callId, userId],
  );
  return (res.rowCount ?? 0) > 0;
}
