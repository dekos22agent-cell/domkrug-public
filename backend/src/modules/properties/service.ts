/**
 * Структура домов: здания, квартиры, счётчики для карточки.
 *
 * Все запросы обязательно фильтруются по tenant_id из токена.
 * tenant_id никогда не приходит от клиента.
 */
import { pool } from '../../db/pool.js';

export type BuildingObjectKind =
  | 'apartment_building'
  | 'cottage_settlement'
  | 'mixed_use'
  | 'commercial_building';

export interface BuildingListItem {
  id: string;
  addressText: string;
  city: string;
  street: string;
  houseNumber: string;
  buildingNumber: string | null;
  complexId: string | null;
  complexName: string | null;
  objectKind: BuildingObjectKind;
  apartmentsCount: number;
  openTickets: number;
}

export async function listBuildings(
  tenantId: string,
  filter: { q?: string | undefined; complexId?: string | undefined },
): Promise<BuildingListItem[]> {
  const res = await pool.query<{
    id: string;
    address_text: string;
    city: string;
    street: string;
    house_number: string;
    building_number: string | null;
    complex_id: string | null;
    complex_name: string | null;
    object_kind: BuildingObjectKind;
    apartments_count: string;
    open_tickets: string;
  }>(
    `SELECT b.id, b.address_text, b.city, b.street, b.house_number, b.building_number,
            c.id AS complex_id, c.name AS complex_name, b.object_kind,
            (SELECT count(*) FROM apartments a
              WHERE a.building_id = b.id AND a.deleted_at IS NULL) AS apartments_count,
            (SELECT count(*) FROM tickets t
              WHERE t.building_id = b.id AND t.closed_at IS NULL AND t.deleted_at IS NULL) AS open_tickets
       FROM buildings b
       LEFT JOIN residential_complexes c ON c.id = b.complex_id
      WHERE b.tenant_id = $1
        AND b.deleted_at IS NULL
        AND ($2::text IS NULL OR b.address_text ILIKE '%' || $2 || '%')
        AND ($3::uuid IS NULL OR b.complex_id = $3::uuid)
      ORDER BY b.city, b.street, b.house_number
      LIMIT 500`,
    [tenantId, filter.q ?? null, filter.complexId ?? null],
  );

  return res.rows.map((r) => ({
    id: r.id,
    addressText: r.address_text,
    city: r.city,
    street: r.street,
    houseNumber: r.house_number,
    buildingNumber: r.building_number,
    complexId: r.complex_id,
    complexName: r.complex_name,
    objectKind: r.object_kind,
    // count(*) возвращается строкой (bigint) — приводим к числу явно
    apartmentsCount: Number(r.apartments_count),
    openTickets: Number(r.open_tickets),
  }));
}

export interface BuildingDetail extends BuildingListItem {
  totalEntrances: number | null;
  totalFloors: number | null;
  yearBuilt: number | null;
  residentsConfirmed: number;
  overdueTickets: number;
  entrances: { id: string; number: number }[];
}

export async function getBuilding(
  tenantId: string,
  buildingId: string,
): Promise<BuildingDetail | null> {
  const res = await pool.query<{
    id: string;
    address_text: string;
    city: string;
    street: string;
    house_number: string;
    building_number: string | null;
    complex_id: string | null;
    complex_name: string | null;
    object_kind: BuildingObjectKind;
    total_entrances: number | null;
    total_floors: number | null;
    year_built: number | null;
    apartments_count: string;
    open_tickets: string;
    residents_confirmed: string;
    overdue_tickets: string;
  }>(
    `SELECT b.id, b.address_text, b.city, b.street, b.house_number, b.building_number,
            c.id AS complex_id, c.name AS complex_name, b.object_kind,
            b.total_entrances, b.total_floors, b.year_built,
            (SELECT count(*) FROM apartments a
              WHERE a.building_id = b.id AND a.deleted_at IS NULL) AS apartments_count,
            (SELECT count(*) FROM tickets t
              WHERE t.building_id = b.id AND t.closed_at IS NULL AND t.deleted_at IS NULL) AS open_tickets,
            (SELECT count(*) FROM resident_bindings rb
               JOIN apartments a2 ON a2.id = rb.apartment_id
              WHERE a2.building_id = b.id AND rb.status = 'confirmed') AS residents_confirmed,
            (SELECT count(*) FROM tickets t2
              WHERE t2.building_id = b.id AND t2.closed_at IS NULL
                AND t2.deleted_at IS NULL AND t2.sla_due_at < now()) AS overdue_tickets
       FROM buildings b
       LEFT JOIN residential_complexes c ON c.id = b.complex_id
      WHERE b.tenant_id = $1 AND b.id = $2 AND b.deleted_at IS NULL
      LIMIT 1`,
    [tenantId, buildingId],
  );

  const r = res.rows[0];
  if (!r) return null;

  const entrancesRes = await pool.query<{ id: string; number: number }>(
    `SELECT id, number FROM entrances WHERE building_id = $1 AND tenant_id = $2 ORDER BY number`,
    [buildingId, tenantId],
  );

  return {
    id: r.id,
    addressText: r.address_text,
    city: r.city,
    street: r.street,
    houseNumber: r.house_number,
    buildingNumber: r.building_number,
    complexId: r.complex_id,
    complexName: r.complex_name,
    objectKind: r.object_kind,
    totalEntrances: r.total_entrances,
    totalFloors: r.total_floors,
    yearBuilt: r.year_built,
    apartmentsCount: Number(r.apartments_count),
    openTickets: Number(r.open_tickets),
    residentsConfirmed: Number(r.residents_confirmed),
    overdueTickets: Number(r.overdue_tickets),
    entrances: entrancesRes.rows,
  };
}

export interface ApartmentListItem {
  id: string;
  number: string;
  kind: string;
  rooms: number | null;
  areaTotal: string | null;
  status: string;
  entranceNumber: number | null;
  floorNumber: number | null;
  residentsConfirmed: number;
  /** Номер комнаты на вызывной панели: панель набирает его при звонке */
  intercomRoom: string | null;
}

export async function listApartments(
  tenantId: string,
  buildingId: string,
  filter: { q?: string | undefined; limit: number },
): Promise<ApartmentListItem[]> {
  const res = await pool.query<{
    id: string;
    number: string;
    kind: string;
    rooms: number | null;
    area_total: string | null;
    status: string;
    entrance_number: number | null;
    floor_number: number | null;
    residents_confirmed: string;
    intercom_room: string | null;
  }>(
    `SELECT a.id, a.number, a.kind, a.rooms, a.area_total, a.status,
            e.number AS entrance_number, f.number AS floor_number,
            (SELECT count(*) FROM resident_bindings rb
              WHERE rb.apartment_id = a.id AND rb.status = 'confirmed') AS residents_confirmed,
            a.intercom_room
       FROM apartments a
       LEFT JOIN entrances e ON e.id = a.entrance_id
       LEFT JOIN floors f ON f.id = a.floor_id
      WHERE a.tenant_id = $1 AND a.building_id = $2 AND a.deleted_at IS NULL
        AND ($3::text IS NULL OR a.number ILIKE $3 || '%')
      ORDER BY (a.number ~ '^[0-9]+$'), a.number::text
      LIMIT $4`,
    [tenantId, buildingId, filter.q ?? null, filter.limit],
  );

  return res.rows.map((r) => ({
    id: r.id,
    number: r.number,
    kind: r.kind,
    rooms: r.rooms,
    areaTotal: r.area_total,
    status: r.status,
    entranceNumber: r.entrance_number,
    floorNumber: r.floor_number,
    residentsConfirmed: Number(r.residents_confirmed),
    intercomRoom: r.intercom_room,
  }));
}


/**
 * Задать или снять номер комнаты на вызывной панели.
 *
 * Панель при звонке набирает номер комнаты, а не квартиры: без этой привязки
 * звонок не находит квартиру и запись о вызове не создаётся. Раньше номер
 * можно было задать только SQL-запросом, что на объекте неприемлемо.
 *
 * Возвращает 'ok', 'not_found' или 'conflict' (номер уже занят в этом доме —
 * иначе два звонка пришли бы в одну квартиру и один житель не получил бы ничего).
 */
export async function setApartmentIntercomRoom(
  tenantId: string,
  buildingId: string,
  apartmentId: string,
  room: string | null,
): Promise<'ok' | 'not_found' | 'conflict'> {
  try {
    const res = await pool.query(
      `UPDATE apartments
          SET intercom_room = $4
        WHERE id = $1 AND tenant_id = $2 AND building_id = $3 AND deleted_at IS NULL`,
      [apartmentId, tenantId, buildingId, room],
    );
    if ((res.rowCount ?? 0) === 0) return 'not_found';
    return 'ok';
  } catch (error) {
    // Уникальный индекс (building_id, intercom_room) не даёт двум квартирам
    // один номер: иначе панель звонила бы в первую попавшуюся
    const code = (error as { code?: string }).code;
    if (code === '23505') return 'conflict';
    throw error;
  }
}
/**
 * Заполнить номера на панели по номерам квартир там, где поле пустое.
 *
 * Зачем: на объекте таких квартир может быть двести, и вбивать их руками
 * бессмысленно — в большинстве домов номер на панели совпадает с номером
 * квартиры. Заполняем только ПУСТЫЕ строки: уже заданные номера не трогаем,
 * потому что монтажник мог настроить их иначе и знает лучше.
 *
 * Берём только квартиры с числовым номером: «12А» панель набрать не сможет,
 * такие случаи остаются на ручную правку.
 */
export async function autofillIntercomRooms(
  tenantId: string,
  buildingId: string,
): Promise<{ filled: number; skipped: number }> {
  const res = await pool.query<{ filled: string; skipped: string }>(
    `WITH candidates AS (
       SELECT a.id, btrim(a.number) AS number
         FROM apartments a
        WHERE a.tenant_id = $1
          AND a.building_id = $2
          AND a.deleted_at IS NULL
          AND a.intercom_room IS NULL
     ),
     fillable AS (
       SELECT c.id, c.number
         FROM candidates c
        WHERE c.number ~ '^[0-9]{1,10}$'
          -- номер не занят другой квартирой этого дома
          AND NOT EXISTS (
                SELECT 1 FROM apartments o
                 WHERE o.building_id = $2
                   AND o.intercom_room = c.number
              )
     ),
     updated AS (
       UPDATE apartments a
          SET intercom_room = f.number
         FROM fillable f
        WHERE a.id = f.id
        RETURNING a.id
     )
     SELECT (SELECT count(*) FROM updated)::text AS filled,
            (SELECT count(*) FROM candidates)::text AS skipped`,
    [tenantId, buildingId],
  );

  const row = res.rows[0];
  return {
    filled: Number(row?.filled ?? 0),
    skipped: Number(row?.skipped ?? 0),
  };
}

// ─── Паспорт объекта ───────────────────────────────────────────────────────

export interface BuildingPassportFields {
  cadastralNumber: string | null;
  yearCommissioned: number | null;
  totalArea: string | null;
  livingArea: string | null;
  commercialArea: string | null;
  landArea: string | null;
  parkingSpots: number | null;
  elevatorsCount: number | null;
  energyClass: string | null;
  managementStart: string | null;
  warrantyUntil: string | null;
  notes: string | null;
}

export interface BuildingPassport {
  building: BuildingDetail;
  passport: BuildingPassportFields | null;
  stats: {
    unitsTotal: number;
    apartments: number;
    nonresidential: number;
    residentsConfirmed: number;
    openTickets: number;
    overdueTickets: number;
    entrances: number;
    unitsByKind: { kind: string; count: number }[];
  };
  updatedAt: string | null;
}

export interface SaveBuildingPassportInput {
  tenantId: string;
  buildingId: string;
  objectKind: BuildingObjectKind;
  yearBuilt: number | null;
  totalFloors: number | null;
  totalEntrances: number | null;
  cadastralNumber: string | null;
  yearCommissioned: number | null;
  totalArea: number | null;
  livingArea: number | null;
  commercialArea: number | null;
  landArea: number | null;
  parkingSpots: number | null;
  elevatorsCount: number | null;
  energyClass: string | null;
  managementStart: string | null;
  warrantyUntil: string | null;
  notes: string | null;
}

/**
 * Паспорт объекта собирается из самого объекта, его паспортной строки и
 * фактического состава помещений. Паспортная строка может отсутствовать:
 * объект уже существует, но УК ещё не заполнила кадастровые данные.
 */
export async function getBuildingPassport(
  tenantId: string,
  buildingId: string,
): Promise<BuildingPassport | null> {
  const building = await getBuilding(tenantId, buildingId);
  if (!building) return null;

  const [passportRes, kindsRes] = await Promise.all([
    pool.query<{
      cadastral_number: string | null;
      year_commissioned: number | null;
      total_area: string | null;
      living_area: string | null;
      commercial_area: string | null;
      land_area: string | null;
      parking_spots: number | null;
      elevators_count: number | null;
      energy_class: string | null;
      management_start: string | null;
      warranty_until: string | null;
      notes: string | null;
      updated_at: Date;
    }>(
      `SELECT cadastral_number, year_commissioned, total_area, living_area,
              commercial_area, land_area, parking_spots, elevators_count,
              energy_class, management_start::text, warranty_until::text,
              notes, updated_at
         FROM building_passports
        WHERE tenant_id = $1 AND building_id = $2
        LIMIT 1`,
      [tenantId, buildingId],
    ),
    pool.query<{ kind: string; count: string }>(
      `SELECT kind, count(*)::text AS count
         FROM apartments
        WHERE tenant_id = $1 AND building_id = $2 AND deleted_at IS NULL
        GROUP BY kind
        ORDER BY kind`,
      [tenantId, buildingId],
    ),
  ]);

  const row = passportRes.rows[0];
  const unitsByKind = kindsRes.rows.map((item) => ({
    kind: item.kind,
    count: Number(item.count),
  }));

  return {
    building,
    passport: row
      ? {
          cadastralNumber: row.cadastral_number,
          yearCommissioned: row.year_commissioned,
          totalArea: row.total_area,
          livingArea: row.living_area,
          commercialArea: row.commercial_area,
          landArea: row.land_area,
          parkingSpots: row.parking_spots,
          elevatorsCount: row.elevators_count,
          energyClass: row.energy_class,
          managementStart: row.management_start,
          warrantyUntil: row.warranty_until,
          notes: row.notes,
        }
      : null,
    stats: {
      unitsTotal: building.apartmentsCount,
      apartments: unitsByKind.find((item) => item.kind === 'apartment')?.count ?? 0,
      nonresidential: unitsByKind.find((item) => item.kind === 'nonresidential')?.count ?? 0,
      residentsConfirmed: building.residentsConfirmed,
      openTickets: building.openTickets,
      overdueTickets: building.overdueTickets,
      entrances: building.entrances.length || building.totalEntrances || 0,
      unitsByKind,
    },
    updatedAt: row?.updated_at.toISOString() ?? null,
  };
}

/**
 * Полное сохранение паспорта: форма редактирования отправляет все поля.
 * object_kind, этажность, число подъездов и год постройки живут в buildings —
 * паспорт не должен становиться вторым источником истины для них.
 */
export async function saveBuildingPassport(
  input: SaveBuildingPassportInput,
): Promise<BuildingPassport | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const updated = await client.query(
      `UPDATE buildings
          SET object_kind = $3,
              year_built = $4,
              total_floors = $5,
              total_entrances = $6
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [
        input.tenantId,
        input.buildingId,
        input.objectKind,
        input.yearBuilt,
        input.totalFloors,
        input.totalEntrances,
      ],
    );

    if ((updated.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query(
      `INSERT INTO building_passports (
         tenant_id, building_id, cadastral_number, year_commissioned,
         total_area, living_area, commercial_area, land_area,
         parking_spots, elevators_count, energy_class,
         management_start, warranty_until, notes
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (building_id) DO UPDATE SET
         cadastral_number = EXCLUDED.cadastral_number,
         year_commissioned = EXCLUDED.year_commissioned,
         total_area = EXCLUDED.total_area,
         living_area = EXCLUDED.living_area,
         commercial_area = EXCLUDED.commercial_area,
         land_area = EXCLUDED.land_area,
         parking_spots = EXCLUDED.parking_spots,
         elevators_count = EXCLUDED.elevators_count,
         energy_class = EXCLUDED.energy_class,
         management_start = EXCLUDED.management_start,
         warranty_until = EXCLUDED.warranty_until,
         notes = EXCLUDED.notes`,
      [
        input.tenantId,
        input.buildingId,
        input.cadastralNumber,
        input.yearCommissioned,
        input.totalArea,
        input.livingArea,
        input.commercialArea,
        input.landArea,
        input.parkingSpots,
        input.elevatorsCount,
        input.energyClass,
        input.managementStart,
        input.warrantyUntil,
        input.notes,
      ],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return getBuildingPassport(input.tenantId, input.buildingId);
}

// ─── Собственники и доли ────────────────────────────────────────────────────

export interface OwnerListItem {
  ownershipId: string;
  ownerId: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  role: 'owner' | 'representative';
  sharePercent: string;
  validFrom: string;
  validTo: string | null;
  apartmentId: string;
  apartmentNumber: string;
}

export interface SaveOwnershipInput {
  tenantId: string;
  buildingId: string;
  apartmentId: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  role: 'owner' | 'representative';
  sharePercent: number;
  validFrom: string;
  validTo: string | null;
  createdBy: string;
}

const OWNER_SELECT = `
  SELECT ow.id AS ownership_id, o.id AS owner_id, o.full_name, o.phone, o.email, o.notes,
         ow.role, ow.share_percent::text, ow.valid_from::text, ow.valid_to::text,
         a.id AS apartment_id, a.number AS apartment_number
    FROM ownerships ow
    JOIN owners o ON o.id = ow.owner_id AND o.deleted_at IS NULL
    JOIN apartments a ON a.id = ow.apartment_id AND a.deleted_at IS NULL
   WHERE ow.tenant_id = $1
     AND a.building_id = $2
     AND ow.deleted_at IS NULL`;

function mapOwner(row: {
  ownership_id: string;
  owner_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  role: 'owner' | 'representative';
  share_percent: string;
  valid_from: string;
  valid_to: string | null;
  apartment_id: string;
  apartment_number: string;
}): OwnerListItem {
  return {
    ownershipId: row.ownership_id,
    ownerId: row.owner_id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    role: row.role,
    sharePercent: row.share_percent,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    apartmentId: row.apartment_id,
    apartmentNumber: row.apartment_number,
  };
}

export async function listOwners(
  tenantId: string,
  buildingId: string,
): Promise<OwnerListItem[]> {
  const res = await pool.query<Parameters<typeof mapOwner>[0]>(
    `${OWNER_SELECT}
     ORDER BY a.number::text, o.full_name`,
    [tenantId, buildingId],
  );
  return res.rows.map(mapOwner);
}

async function getOwnerItem(
  tenantId: string,
  buildingId: string,
  ownershipId: string,
): Promise<OwnerListItem | null> {
  const res = await pool.query<Parameters<typeof mapOwner>[0]>(
    `${OWNER_SELECT} AND ow.id = $3
     LIMIT 1`,
    [tenantId, buildingId, ownershipId],
  );
  const row = res.rows[0];
  return row ? mapOwner(row) : null;
}

/**
 * Создать физическое лицо и его право на помещение.
 *
 * Возвращает 'not_found', если квартира не принадлежит этому дому/УК,
 * и 'conflict', если этот человек уже привязан к квартире.
 */
export async function createOwnership(
  input: SaveOwnershipInput,
): Promise<OwnerListItem | 'not_found' | 'conflict'> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const apartment = await client.query(
      `SELECT id FROM apartments
        WHERE id = $1 AND tenant_id = $2 AND building_id = $3 AND deleted_at IS NULL
        LIMIT 1`,
      [input.apartmentId, input.tenantId, input.buildingId],
    );
    if ((apartment.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return 'not_found';
    }

    const owner = await client.query<{ id: string }>(
      `INSERT INTO owners (tenant_id, full_name, phone, email, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        input.tenantId,
        input.fullName.trim(),
        input.phone?.trim() || null,
        input.email?.trim() || null,
        input.notes?.trim() || null,
      ],
    );
    const ownerId = owner.rows[0]?.id;
    if (!ownerId) throw new Error('Не удалось создать собственника');

    const ownership = await client.query<{ id: string }>(
      `INSERT INTO ownerships
         (tenant_id, apartment_id, owner_id, role, share_percent, valid_from, valid_to, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::date, $7::date, $8)
       RETURNING id`,
      [
        input.tenantId,
        input.apartmentId,
        ownerId,
        input.role,
        input.sharePercent,
        input.validFrom,
        input.validTo,
        input.createdBy,
      ],
    );
    const ownershipId = ownership.rows[0]?.id;
    if (!ownershipId) throw new Error('Не удалось создать право собственности');

    await client.query('COMMIT');
    const item = await getOwnerItem(input.tenantId, input.buildingId, ownershipId);
    if (!item) throw new Error('Не удалось прочитать созданную запись');
    return item;
  } catch (err) {
    await client.query('ROLLBACK');
    const code = (err as { code?: string }).code;
    if (code === '23505') return 'conflict';
    throw err;
  } finally {
    client.release();
  }
}

export async function updateOwnership(input: {
  tenantId: string;
  buildingId: string;
  ownershipId: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  role: 'owner' | 'representative';
  sharePercent: number;
  validFrom: string;
  validTo: string | null;
}): Promise<OwnerListItem | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const current = await client.query<{ owner_id: string }>(
      `SELECT ow.owner_id
         FROM ownerships ow
         JOIN apartments a ON a.id = ow.apartment_id
        WHERE ow.id = $1 AND ow.tenant_id = $2 AND a.building_id = $3
          AND ow.deleted_at IS NULL
        FOR UPDATE`,
      [input.ownershipId, input.tenantId, input.buildingId],
    );
    const row = current.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query(
      `UPDATE owners
          SET full_name = $2, phone = $3, email = $4, notes = $5
        WHERE id = $1 AND tenant_id = $6 AND deleted_at IS NULL`,
      [
        row.owner_id,
        input.fullName.trim(),
        input.phone?.trim() || null,
        input.email?.trim() || null,
        input.notes?.trim() || null,
        input.tenantId,
      ],
    );

    await client.query(
      `UPDATE ownerships
          SET role = $2, share_percent = $3, valid_from = $4::date, valid_to = $5::date
        WHERE id = $1 AND tenant_id = $6 AND deleted_at IS NULL`,
      [
        input.ownershipId,
        input.role,
        input.sharePercent,
        input.validFrom,
        input.validTo,
        input.tenantId,
      ],
    );

    await client.query('COMMIT');
    return getOwnerItem(input.tenantId, input.buildingId, input.ownershipId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Удалить право. Если у человека больше нет других прав в этой УК,
 * его карточка тоже архивируется — иначе реестр забьётся пустыми людьми.
 */
export async function deleteOwnership(
  tenantId: string,
  buildingId: string,
  ownershipId: string,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const removed = await client.query<{ owner_id: string }>(
      `UPDATE ownerships ow
          SET deleted_at = now()
         FROM apartments a
        WHERE ow.id = $1
          AND ow.tenant_id = $2
          AND a.id = ow.apartment_id
          AND a.building_id = $3
          AND ow.deleted_at IS NULL
        RETURNING ow.owner_id`,
      [ownershipId, tenantId, buildingId],
    );
    const ownerId = removed.rows[0]?.owner_id;
    if (!ownerId) {
      await client.query('ROLLBACK');
      return false;
    }

    await client.query(
      `UPDATE owners o
          SET deleted_at = now()
        WHERE o.id = $1
          AND o.tenant_id = $2
          AND o.deleted_at IS NULL
          AND NOT EXISTS (
                SELECT 1 FROM ownerships ow2
                 WHERE ow2.owner_id = o.id AND ow2.deleted_at IS NULL
              )`,
      [ownerId, tenantId],
    );

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export interface UpdateApartmentInput {
  tenantId: string;
  buildingId: string;
  apartmentId: string;
  kind: 'apartment' | 'nonresidential' | 'house' | 'office' | 'retail' | 'parking' | 'storage';
  rooms: number | null;
  areaTotal: number | null;
  status: 'active' | 'archived';
}

/** Тип, комнатность и площадь помещения. */
export async function updateApartment(input: UpdateApartmentInput): Promise<boolean> {
  const res = await pool.query(
    `UPDATE apartments
        SET kind = $4, rooms = $5, area_total = $6, status = $7
      WHERE id = $1
        AND tenant_id = $2
        AND building_id = $3
        AND deleted_at IS NULL`,
    [
      input.apartmentId,
      input.tenantId,
      input.buildingId,
      input.kind,
      input.rooms,
      input.areaTotal,
      input.status,
    ],
  );
  return (res.rowCount ?? 0) > 0;
}

export interface ImportApartmentRow {
  number: string;
  kind: 'apartment' | 'nonresidential' | 'house' | 'office' | 'retail' | 'parking' | 'storage';
  rooms: number | null;
  areaTotal: number | null;
}

/**
 * Импорт помещений. Дубли по номеру пропускаются, а не перезаписываются:
 * иначе повторная загрузка файла затирала бы данные, которые УК уже
 * поправила вручную.
 */
export async function importApartments(
  tenantId: string,
  buildingId: string,
  rows: ImportApartmentRow[],
): Promise<{ created: number; skipped: number }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const building = await client.query(
      `SELECT 1 FROM buildings
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [buildingId, tenantId],
    );
    if (building.rowCount === 0) {
      await client.query('ROLLBACK');
      throw new Error('OBJECT_NOT_FOUND');
    }

    let created = 0;
    let skipped = 0;
    for (const row of rows) {
      const result = await client.query(
        `INSERT INTO apartments (tenant_id, building_id, number, kind, rooms, area_total)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (building_id, number) WHERE deleted_at IS NULL DO NOTHING`,
        [
          tenantId,
          buildingId,
          row.number.trim(),
          row.kind,
          row.rooms,
          row.areaTotal,
        ],
      );
      if ((result.rowCount ?? 0) > 0) created += 1;
      else skipped += 1;
    }

    await client.query('COMMIT');
    return { created, skipped };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}