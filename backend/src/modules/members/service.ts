/**
 * Члены квартиры и их права.
 *
 * Ключевая идея: «житель» — не единственная роль у квартиры. Есть владелец
 * (подтверждённая привязка УК), а есть члены: семья, дети, арендаторы,
 * рабочие. У каждого свой набор прав и, для рабочих и гостей, срок действия.
 *
 * Права проверяются на сервере в каждом модуле: дверь, видео, счётчики,
 * заявки. Список прав — массив строк, пресет — готовый набор для интерфейса.
 */
import { pool } from '../../db/pool.js';
import { normalizeIdentifier } from '../auth/service.js';
import { openSecret } from '../../lib/secrets.js';

export type MemberPreset = 'family' | 'child' | 'tenant' | 'worker' | 'guest';

export type Scope =
  | 'access.open'
  // Конкретные типы точек: владелец выбирает, что именно разрешено
  | 'access.entrance_door'
  | 'access.wicket'
  | 'access.barrier'
  | 'access.gate'
  | 'access.parking'
  | 'video.view'
  | 'meters.submit'
  | 'tickets.create'
  | 'finance.view'
  | 'members.manage';

/** Есть ли право открыть хотя бы какую-то точку. */
export function hasAnyAccessScope(scopes: readonly string[]): boolean {
  return scopes.some((scope) => scope === 'access.open' || scope.startsWith('access.'));
}

/**
 * Готовые наборы прав.
 *
 * Владельца здесь нет: владелец — это подтверждённая привязка к квартире,
 * и у него все права по умолчанию. Иначе пришлось бы дублировать права
 * в двух местах и следить, чтобы они не разъехались.
 */
export const PRESET_SCOPES: Record<MemberPreset, Scope[]> = {
  family: ['access.open', 'video.view', 'meters.submit', 'tickets.create'],
  child: ['access.open'],
  tenant: ['access.open', 'video.view', 'meters.submit', 'tickets.create'],
  worker: ['access.open'],
  guest: ['access.open'],
};

/** Пресеты, для которых срок действия обязателен. */
export const PRESETS_REQUIRING_EXPIRY: MemberPreset[] = ['worker', 'guest'];

export interface ApartmentMember {
  id: string;
  phone: string;
  preset: MemberPreset;
  scopes: Scope[];
  status: 'invited' | 'active' | 'revoked';
  /** account — вход по телефону, code — по коду без ПДн */
  kind: 'account' | 'code';
  label: string | null;
  codePrefix: string | null;
  /** Код в открытом виде — только владельцу, для передачи человеку */
  code: string | null;
  fullName: string | null;
  /** Приглашённый уже зарегистрировался и ждёт подтверждения владельца. */
  claimed: boolean;
  expiresAt: string | null;
  acceptedAt: string | null;
  createdAt: string;
}

interface MemberRow {
  id: string;
  phone: string;
  preset: MemberPreset;
  scopes: Scope[];
  status: 'invited' | 'active' | 'revoked';
  kind: 'account' | 'code';
  label: string | null;
  access_code_prefix: string | null;
  access_code_sealed: string | null;
  user_id: string | null;
  full_name: string | null;
  expires_at: string | null;
  accepted_at: string | null;
  created_at: string;
}

/**
 * Есть ли у человека право на квартиру.
 *
 * Владелец — подтверждённая привязка — имеет все права. Член квартиры —
 * только те, что в его scopes, и только пока не истёк срок.
 */
export async function hasApartmentScope(
  userId: string,
  apartmentId: string,
  scope: Scope,
): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 WHERE EXISTS (
       SELECT 1 FROM resident_bindings
        WHERE user_id = $1 AND apartment_id = $2 AND status = 'confirmed'
     ) OR EXISTS (
       SELECT 1 FROM apartment_members
        WHERE user_id = $1 AND apartment_id = $2 AND status = 'active'
          AND (expires_at IS NULL OR expires_at > now())
          AND $3 = ANY (scopes)
     )
     LIMIT 1`,
    [userId, apartmentId, scope],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Кто может управлять членами: владелец квартиры или член с members.manage. */
export async function canManageMembers(userId: string, apartmentId: string): Promise<boolean> {
  return hasApartmentScope(userId, apartmentId, 'members.manage');
}

export async function listMembers(
  userId: string,
  apartmentId: string,
): Promise<ApartmentMember[] | null> {
  if (!(await canManageMembers(userId, apartmentId))) return null;

  const res = await pool.query<MemberRow>(
    `SELECT m.id, m.phone, m.preset, m.scopes, m.status,
            m.kind, m.label, m.access_code_prefix, m.access_code_sealed,
            m.user_id,
            u.full_name,
            m.expires_at::text AS expires_at,
            m.accepted_at::text AS accepted_at,
            m.created_at::text AS created_at
       FROM apartment_members m
       LEFT JOIN users u ON u.id = m.user_id
      WHERE m.apartment_id = $1
      ORDER BY m.created_at DESC`,
    [apartmentId],
  );

  return res.rows.map(toMember);
}

function toMember(row: MemberRow): ApartmentMember {
  return {
    id: row.id,
    phone: row.phone,
    preset: row.preset,
    scopes: row.scopes,
    status: row.status,
    kind: row.kind,
    label: row.label,
    codePrefix: row.access_code_prefix,
    code: openSecret(row.access_code_sealed),
    fullName: row.full_name,
    claimed: Boolean(row.user_id),
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    createdAt: row.created_at,
  };
}

export type InviteOutcome =
  | { ok: true; member: ApartmentMember; activated: boolean }
  | { ok: false; status: 400 | 403 | 404 | 409; code: string; message: string };

interface InviteInput {
  ownerUserId: string;
  apartmentId: string;
  phone: string;
  preset: MemberPreset;
  /** Если задано — используем этот набор вместо набора пресета. */
  scopes?: Scope[];
  expiresAt?: string | null;
}

export async function inviteMember({
  ownerUserId,
  apartmentId,
  phone,
  preset,
  scopes: requestedScopes,
  expiresAt,
}: InviteInput): Promise<InviteOutcome> {
  if (!(await canManageMembers(ownerUserId, apartmentId))) {
    return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Нет права приглашать в эту квартиру' };
  }

  if (PRESETS_REQUIRING_EXPIRY.includes(preset) && !expiresAt) {
    return {
      ok: false,
      status: 400,
      code: 'EXPIRY_REQUIRED',
      message: 'Для рабочего и гостя укажите срок действия доступа',
    };
  }

  // Телефон приводим к одному виду: владелец может ввести «+7 923 240-15-20»,
  // а пользователь в базе хранится как «+79232401520». Без нормализации
  // приглашение никогда не находится и доступ не включается.
  const normalized = normalizeIdentifier(phone);
  if (!normalized.phone) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_PHONE',
      message: 'Телефон в формате +7XXXXXXXXXX',
    };
  }
  const phoneNormalized = normalized.phone;

  const tenant = await pool.query<{ tenant_id: string }>(
    'SELECT tenant_id FROM apartments WHERE id = $1',
    [apartmentId],
  );
  const tenantId = tenant.rows[0]?.tenant_id;
  if (!tenantId) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Квартира не найдена' };
  }

  // Если человек уже зарегистрирован — активируем сразу, иначе он подхватит
  // приглашение при входе
  const existing = await pool.query<{ id: string }>(
    'SELECT id FROM users WHERE phone = $1 AND deleted_at IS NULL LIMIT 1',
    [phoneNormalized],
  );
  const userId = existing.rows[0]?.id ?? null;
  // Явный набор прав важнее пресета: интерфейс присылает чекбоксы
  const scopes =
    requestedScopes && requestedScopes.length > 0 ? requestedScopes : PRESET_SCOPES[preset];

  const inserted = await pool.query<MemberRow>(
    `INSERT INTO apartment_members
       (tenant_id, apartment_id, user_id, phone, preset, scopes, status, invited_by, expires_at, accepted_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'invited', $7, $8::timestamptz, NULL)
     ON CONFLICT (apartment_id, phone) DO UPDATE
       SET preset = EXCLUDED.preset,
           scopes = EXCLUDED.scopes,
           user_id = COALESCE(EXCLUDED.user_id, apartment_members.user_id),
           expires_at = EXCLUDED.expires_at,
           revoked_at = NULL,
           status = CASE
             WHEN apartment_members.status = 'active' THEN 'active'
             ELSE 'invited'
           END,
           accepted_at = CASE
             WHEN apartment_members.status = 'active' THEN apartment_members.accepted_at
             ELSE NULL
           END
     RETURNING id, phone, preset, scopes, status, kind, label,
               access_code_prefix, access_code_sealed, user_id,
               NULL::text AS full_name,
               expires_at::text AS expires_at, accepted_at::text AS accepted_at,
               created_at::text AS created_at`,
    [tenantId, apartmentId, userId, phoneNormalized, preset, scopes, ownerUserId, expiresAt ?? null],
  );

  const member = inserted.rows[0];
  if (!member) {
    return { ok: false, status: 409, code: 'ERROR', message: 'Не удалось создать приглашение' };
  }

  // Доступ по телефону включается только после того, как владелец
  // подтвердит зарегистрировавшегося человека: без проверки номера
  // автоматическая выдача означала бы, что чужой телефон даёт двери.
  return { ok: true, member: toMember(member), activated: member.status === 'active' };
}

/**
 * Подтверждение приглашённого владельцем.
 *
 * Нужно, потому что телефон не проверяется кодом из SMS: человек мог
 * зарегистрироваться с чужим номером. Пока владелец не подтвердил,
 * доступа к двери, камерам и заявкам нет.
 */
export async function confirmMember(
  ownerUserId: string,
  apartmentId: string,
  memberId: string,
): Promise<boolean> {
  if (!(await canManageMembers(ownerUserId, apartmentId))) return false;

  const res = await pool.query(
    `UPDATE apartment_members
        SET status = 'active', accepted_at = now()
      WHERE id = $1 AND apartment_id = $2
        AND status = 'invited' AND user_id IS NOT NULL`,
    [memberId, apartmentId],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function revokeMember(
  ownerUserId: string,
  apartmentId: string,
  memberId: string,
): Promise<boolean> {
  if (!(await canManageMembers(ownerUserId, apartmentId))) return false;

  const res = await pool.query(
    `UPDATE apartment_members
        SET status = 'revoked', revoked_at = now()
      WHERE id = $1 AND apartment_id = $2 AND status <> 'revoked'`,
    [memberId, apartmentId],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Подхватить приглашения по номеру телефона.
 *
 * Вызывается при входе и после регистрации: если человека пригласили,
 * он получает доступ без кодов и ссылок.
 */
export async function claimInvites(userId: string, phone: string): Promise<number> {
  const res = await pool.query(
    `UPDATE apartment_members
        SET user_id = $1
      WHERE regexp_replace(phone, '\D', '', 'g') = regexp_replace($2, '\D', '', 'g')
        AND user_id IS NULL
        AND status = 'invited'
        AND (expires_at IS NULL OR expires_at > now())`,
    [userId, phone],
  );
  return res.rowCount ?? 0;
}

/** Квартиры, где человек имеет конкретное право: для списков и проверок. */
export async function accessibleApartmentIds(userId: string, scope: Scope): Promise<string[]> {
  const res = await pool.query<{ apartment_id: string }>(
    `SELECT apartment_id FROM resident_bindings
      WHERE user_id = $1 AND status = 'confirmed'
     UNION
     SELECT apartment_id FROM apartment_members
      WHERE user_id = $1 AND status = 'active'
        AND (expires_at IS NULL OR expires_at > now())
        AND $2 = ANY (scopes)`,
    [userId, scope],
  );
  return res.rows.map((row) => row.apartment_id);
}

/**
 * Квартиры, куда человека пригласили.
 *
 * Нужно интерфейсу: член семьи не имеет «привязки» (он не собственник),
 * но у него есть квартира, адрес и набор прав. Без этого списка приложение
 * считает, что квартиры нет, и показывает «адрес не привязан».
 */
export interface Membership {
  apartmentId: string;
  apartmentNumber: string;
  addressText: string;
  buildingId: string;
  tenantId: string;
  tenantName: string;
  preset: MemberPreset;
  scopes: Scope[];
  expiresAt: string | null;
  /** Кто пригласил: по нему показываем «доступ от …» */
  invitedByName: string | null;
}

export async function listMemberships(userId: string): Promise<Membership[]> {
  const res = await pool.query<{
    apartment_id: string;
    apartment_number: string;
    address_text: string;
    building_id: string;
    tenant_id: string;
    tenant_name: string;
    preset: MemberPreset;
    scopes: Scope[];
    expires_at: string | null;
    invited_by_name: string | null;
  }>(
    `SELECT m.apartment_id, a.number AS apartment_number, b.address_text,
            a.building_id, t.id AS tenant_id, t.name AS tenant_name,
            m.preset, m.scopes, m.expires_at::text AS expires_at,
            inviter.full_name AS invited_by_name
       FROM apartment_members m
       LEFT JOIN users inviter ON inviter.id = m.invited_by
       JOIN apartments a ON a.id = m.apartment_id
       JOIN buildings b ON b.id = a.building_id
       JOIN tenants t ON t.id = m.tenant_id
      WHERE m.user_id = $1
        AND m.status = 'active'
        AND (m.expires_at IS NULL OR m.expires_at > now())
      ORDER BY m.created_at`,
    [userId],
  );

  return res.rows.map((row) => ({
    apartmentId: row.apartment_id,
    apartmentNumber: row.apartment_number,
    addressText: row.address_text,
    buildingId: row.building_id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    preset: row.preset,
    scopes: row.scopes,
    expiresAt: row.expires_at,
    invitedByName: row.invited_by_name,
  }));
}