/**
 * Сид демонстрационных данных.
 *
 * Состав строго по docs/MVP-SCOPE.md, раздел 5:
 *   УК-1 «Дом-Сервис» — основной демонстрационный тенант;
 *   УК-2 «ЖилКомфорт» — для проверки изоляции (второй тенант).
 *
 * ВАЖНО:
 *   - все имена и телефоны вымышленные; телефоны в диапазоне +7 900 000-XX-XX,
 *     чтобы не совпасть с реальными номерами;
 *   - пароль демо-пользователей одинаковый и указан в README — только для
 *     локальной демонстрации;
 *   - реальные персональные данные в демо не используются (правило из ТЗ).
 *
 * Идемпотентность: если демо-данные уже есть, скрипт ничего не делает и
 * подсказывает `npm run db:reset`. Удалять данные «на всякий случай» нельзя:
 * в базе могут быть результаты ручной проверки.
 *
 * Запуск: npm run db:seed
 */
import type { PoolClient } from 'pg';
import { pool } from './pool.js';
import { config } from '../config.js';
import { hashPassword } from '../lib/password.js';

/**
 * Пароль демо-пользователей.
 *
 * По умолчанию — демонстрационный (указан в README). На сервере его
 * использовать нельзя: такой пароль знает любой, кто читал репозиторий.
 * Переопределяется через SEED_PASSWORD.
 */
const DEMO_PASSWORD = process.env['SEED_PASSWORD'] ?? 'Demo1234!';

/**
 * Защита от случайного запуска на боевом сервере.
 *
 * Сид создаёт вымышленные УК, заявки и пользователей с общим паролем.
 * В production это допустимо только осознанно — с явным флагом и своим
 * паролем (для показа пилотной УК на тестовых данных).
 */
if (config.isProduction && !process.argv.includes('--allow-production')) {
  console.error('[seed] Отказ: NODE_ENV=production.');
  console.error('[seed] Демо-данные на боевом сервере создаются только осознанно:');
  console.error('[seed]   SEED_PASSWORD=<свой пароль> npm run db:seed -- --allow-production');
  console.error('[seed] Пароль SEED_PASSWORD обязателен, иначе будет демонстрационный.');
  process.exit(1);
}

if (config.isProduction && DEMO_PASSWORD === 'Demo1234!') {
  console.error('[seed] Отказ: на production нельзя использовать демонстрационный пароль.');
  console.error('[seed] Задайте SEED_PASSWORD.');
  process.exit(1);
}

const DEMO_SLUGS = ['dom-service', 'zhilkomfort'] as const;

// ─── Помощники ──────────────────────────────────────────────────────────────

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Не удалось получить ${what}`);
  return value;
}

async function insertOne<T extends Record<string, unknown>>(
  client: PoolClient,
  sql: string,
  params: readonly unknown[],
): Promise<string> {
  const res = await client.query<{ id: string } & T>(sql, params as unknown[]);
  return must(res.rows[0]?.id, 'id вставленной строки');
}

// ─── Основной сценарий ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    // Проверка идемпотентности — до транзакции, чтобы не держать блокировки
    const existing = await client.query<{ slug: string }>(
      'SELECT slug FROM tenants WHERE slug = ANY($1)',
      [[...DEMO_SLUGS]],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      console.log('[seed] Демо-данные уже есть:', existing.rows.map((r) => r.slug).join(', '));
      console.log('[seed] Чтобы пересоздать: npm run db:reset (пересоздаст схему), затем npm run migrate и npm run db:seed.');
      return;
    }

    await client.query('BEGIN');

    // Кеши справочников
    const statusRes = await client.query<{ id: string; code: string }>(
      'SELECT id, code FROM ticket_statuses',
    );
    const statusId = new Map(statusRes.rows.map((r) => [r.code, r.id]));

    const catRes = await client.query<{ id: string; code: string; default_sla_hours: number }>(
      'SELECT id, code, default_sla_hours FROM ticket_categories WHERE tenant_id IS NULL',
    );
    const category = new Map(catRes.rows.map((r) => [r.code, r]));

    const roleRes = await client.query<{ id: string; code: string }>('SELECT id, code FROM roles');
    const roleId = new Map(roleRes.rows.map((r) => [r.code, r.id]));

    const passwordHash = hashPassword(DEMO_PASSWORD);

    // ─── Справочники: id по коду ────────────────────────────────────────────
    const status = (code: string): string => {
      const id = statusId.get(code);
      if (!id) throw new Error(`Статус "${code}" не найден. Сначала npm run migrate.`);
      return id;
    };
    const categoryOf = (code: string): { id: string; sla: number } => {
      const c = category.get(code);
      if (!c) throw new Error(`Категория "${code}" не найдена. Сначала npm run migrate.`);
      return { id: c.id, sla: c.default_sla_hours };
    };
    const role = (code: string): string => {
      const id = roleId.get(code);
      if (!id) throw new Error(`Роль "${code}" не найдена. Сначала npm run migrate.`);
      return id;
    };

    // ─── Пользователи (общие для платформы) ─────────────────────────────────
    const mkUser = (fullName: string, phone: string): Promise<string> =>
      insertOne(client, 'INSERT INTO users (phone, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id', [
        phone,
        passwordHash,
        fullName,
      ]);

    // ─── УК-1 «Дом-Сервис» ──────────────────────────────────────────────────
    const uk1 = await insertOne(
      client,
      'INSERT INTO tenants (name, slug, contact_phone) VALUES ($1, $2, $3) RETURNING id',
      ['ООО «Дом-Сервис»', 'dom-service', '+79000000010'],
    );

    const complex1 = await insertOne(
      client,
      'INSERT INTO residential_complexes (tenant_id, name) VALUES ($1, $2) RETURNING id',
      [uk1, 'ЖК «Северный»'],
    );

    const building1 = await insertOne(
      client,
      `INSERT INTO buildings
         (tenant_id, complex_id, city, street, house_number, address_text,
          total_entrances, total_floors, year_built)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [uk1, complex1, 'Барнаул', 'Ленина', '1', 'г. Барнаул, ул. Ленина, 1', 3, 9, 1985],
    );

    // 3 подъезда × 9 этажей
    const entrances1: string[] = [];
    const floorsByEntrance = new Map<string, string[]>();
    for (let e = 1; e <= 3; e++) {
      const entranceId = await insertOne(
        client,
        'INSERT INTO entrances (tenant_id, building_id, number) VALUES ($1, $2, $3) RETURNING id',
        [uk1, building1, e],
      );
      entrances1.push(entranceId);
      const floors: string[] = [];
      for (let f = 1; f <= 9; f++) {
        const floorId = await insertOne(
          client,
          'INSERT INTO floors (tenant_id, entrance_id, number) VALUES ($1, $2, $3) RETURNING id',
          [uk1, entranceId, f],
        );
        floors.push(floorId);
      }
      floorsByEntrance.set(entranceId, floors);
    }

    // 12 квартир: 1–6 в первом подъезде, 7–12 во втором
    const apartments1: string[] = [];
    for (let n = 1; n <= 12; n++) {
      const entranceIdx = n <= 6 ? 0 : 1;
      const entranceId = must(entrances1[entranceIdx], 'подъезд');
      const floorList = floorsByEntrance.get(entranceId);
      const floorId = must(floorList?.[(n - 1) % 9], 'этаж');
      const id = await insertOne(
        client,
        `INSERT INTO apartments (tenant_id, building_id, entrance_id, floor_id, number, rooms, area_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [uk1, building1, entranceId, floorId, String(n), 2, 54.3],
      );
      apartments1.push(id);
    }

    // Сотрудники УК-1
    const admin1 = await mkUser('Администратор Дом-Сервис', '+79000000001');
    const dispatcher1 = await mkUser('Диспетчер Дом-Сервис', '+79000000002');
    const plumber = await mkUser('Петров Пётр (сантехник)', '+79000000003');
    const electrician = await mkUser('Сидоров Семён (электрик)', '+79000000004');

    for (const [userId, roleCode, position] of [
      [admin1, 'uk_admin', 'Директор'],
      [dispatcher1, 'dispatcher', 'Диспетчер'],
      [plumber, 'executor', 'Сантехник'],
      [electrician, 'executor', 'Электрик'],
    ] as const) {
      await client.query(
        'INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3)',
        [userId, role(roleCode), uk1],
      );
      await client.query(
        'INSERT INTO staff (tenant_id, user_id, position) VALUES ($1, $2, $3)',
        [uk1, userId, position],
      );
    }

    // Жители УК-1: 4 подтверждённых + 1 ожидающий
    const residentSpecs = [
      ['Иванов Иван Иванович', '+79000000101', 0, 'confirmed'],
      ['Петрова Анна Сергеевна', '+79000000102', 1, 'confirmed'],
      ['Смирнов Олег Петрович', '+79000000103', 2, 'confirmed'],
      ['Кузнецова Мария Ивановна', '+79000000104', 3, 'confirmed'],
      ['Волков Дмитрий Андреевич', '+79000000105', 4, 'pending'],
    ] as const;

    const residents1: string[] = [];
    for (const [fullName, phone, aptIdx, bindingStatus] of residentSpecs) {
      const userId = await mkUser(fullName, phone);
      residents1.push(userId);
      await client.query(
        'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
        [userId, role('resident')],
      );
      await client.query(
        `INSERT INTO resident_bindings
           (tenant_id, user_id, apartment_id, status, role_in_apartment, confirmed_by, confirmed_at)
         VALUES ($1, $2, $3, $4, 'owner', $5, $6)`,
        [
          uk1,
          userId,
          must(apartments1[aptIdx], 'квартира'),
          bindingStatus,
          bindingStatus === 'confirmed' ? dispatcher1 : null,
          bindingStatus === 'confirmed' ? new Date() : null,
        ],
      );
    }

    // ─── УК-2 «ЖилКомфорт» — для проверки изоляции ──────────────────────────
    const uk2 = await insertOne(
      client,
      'INSERT INTO tenants (name, slug, contact_phone) VALUES ($1, $2, $3) RETURNING id',
      ['ООО «ЖилКомфорт»', 'zhilkomfort', '+79000000020'],
    );

    const complex2 = await insertOne(
      client,
      'INSERT INTO residential_complexes (tenant_id, name) VALUES ($1, $2) RETURNING id',
      [uk2, 'ЖК «Южный»'],
    );

    const building2 = await insertOne(
      client,
      `INSERT INTO buildings (tenant_id, complex_id, city, street, house_number, address_text,
                              total_entrances, total_floors, year_built)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [uk2, complex2, 'Барнаул', 'Мира', '5', 'г. Барнаул, ул. Мира, 5', 1, 3, 2005],
    );

    const entrance2 = await insertOne(
      client,
      'INSERT INTO entrances (tenant_id, building_id, number) VALUES ($1, $2, 1) RETURNING id',
      [uk2, building2],
    );

    const floors2: string[] = [];
    for (let f = 1; f <= 3; f++) {
      floors2.push(
        await insertOne(
          client,
          'INSERT INTO floors (tenant_id, entrance_id, number) VALUES ($1, $2, $3) RETURNING id',
          [uk2, entrance2, f],
        ),
      );
    }

    const apartments2: string[] = [];
    for (let n = 1; n <= 6; n++) {
      apartments2.push(
        await insertOne(
          client,
          `INSERT INTO apartments (tenant_id, building_id, entrance_id, floor_id, number, rooms, area_total)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [uk2, building2, entrance2, must(floors2[(n - 1) % 3], 'этаж'), String(n), 1, 38.5],
        ),
      );
    }

    const admin2 = await mkUser('Администратор ЖилКомфорт', '+79000000021');
    const dispatcher2 = await mkUser('Диспетчер ЖилКомфорт', '+79000000022');

    for (const [userId, roleCode, position] of [
      [admin2, 'uk_admin', 'Директор'],
      [dispatcher2, 'dispatcher', 'Диспетчер'],
    ] as const) {
      await client.query(
        'INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3)',
        [userId, role(roleCode), uk2],
      );
      await client.query(
        'INSERT INTO staff (tenant_id, user_id, position) VALUES ($1, $2, $3)',
        [uk2, userId, position],
      );
    }

    for (const [fullName, phone, aptIdx] of [
      ['Орлов Никита Сергеевич', '+79000000201', 0],
      ['Зайцева Ольга Викторовна', '+79000000202', 1],
    ] as const) {
      const userId = await mkUser(fullName, phone);
      await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [
        userId,
        role('resident'),
      ]);
      await client.query(
        `INSERT INTO resident_bindings
           (tenant_id, user_id, apartment_id, status, role_in_apartment, confirmed_by, confirmed_at)
         VALUES ($1, $2, $3, 'confirmed', 'owner', $4, now())`,
        [uk2, userId, must(apartments2[aptIdx], 'квартира'), dispatcher2],
      );
    }

    // ─── Житель с двумя квартирами в разных УК ──────────────────────────────
    // Иванов владеет квартирой в УК-1 и ещё одной — в УК-2. Нужно, чтобы
    // проверить переключатель квартир: у человека один вход, но два адреса
    // и две управляющие компании.
    await client.query(
      `INSERT INTO resident_bindings
         (tenant_id, user_id, apartment_id, status, role_in_apartment, confirmed_by, confirmed_at)
       VALUES ($1, $2, $3, 'confirmed', 'owner', $4, now())`,
      [uk2, must(residents1[0], 'житель'), must(apartments2[1], 'квартира УК-2'), dispatcher2],
    );

    // СНИЛС демо-жителя — валидный номер с корректной контрольной суммой,
    // чтобы можно было проверить сверку с реестром собственников.
    await client.query('UPDATE users SET snils = $2 WHERE id = $1', [
      must(residents1[0], 'житель'),
      '11223344595',
    ]);

    // ─── Точки доступа (СКУД) ───────────────────────────────────────────────
    // Провайдер mock: команда никуда не уходит, но вся логика прав и журнала
    // работает по-настоящему. Реальное железо подключим отдельным провайдером.
    const pointSpecs = [
      ['entrance_door', 'Подъезд 1', 'Дверь подъезда, где вы живёте', 1],
      ['barrier', 'Шлагбаум на въезде', 'Откроется на 5 секунд', 2],
      ['wicket', 'Калитка во двор', 'Калитка рядом с подъездом', 3],
    ] as const;

    const points1: string[] = [];
    for (const [kind, name, instruction, sortOrder] of pointSpecs) {
      points1.push(
        await insertOne(
          client,
          `INSERT INTO access_points
             (tenant_id, building_id, kind, name, instruction, sort_order, provider)
           VALUES ($1, $2, $3, $4, $5, $6, 'mock') RETURNING id`,
          [uk1, building1, kind, name, instruction, sortOrder],
        ),
      );
    }

    // Доступ выдаём квартирам, а не людям: житель получает его вместе
    // с подтверждением привязки
    for (const apartmentId of apartments1) {
      for (const pointId of points1) {
        await client.query(
          'INSERT INTO access_grants (access_point_id, apartment_id) VALUES ($1, $2)',
          [pointId, apartmentId],
        );
      }
    }

    // УК-2 получает свою точку — чтобы изоляция проверялась и здесь
    const point2 = await insertOne(
      client,
      `INSERT INTO access_points (tenant_id, building_id, kind, name, instruction, provider)
       VALUES ($1, $2, 'entrance_door', 'Подъезд 1', 'Дверь подъезда', 'mock') RETURNING id`,
      [uk2, building2],
    );
    for (const apartmentId of apartments2) {
      await client.query(
        'INSERT INTO access_grants (access_point_id, apartment_id) VALUES ($1, $2)',
        [point2, apartmentId],
      );
    }

    // ─── Камеры ─────────────────────────────────────────────────────────────
    // stream_type = demo: реального потока нет, плеер покажет заглушку.
    // Когда появится медиасервер, здесь будет hls или webrtc и адрес потока.
    const cameraSpecs = [
      ['call_panel', 'Вызывная панель подъезда 1', must(points1[0], 'дверь'), 1],
      ['overview', 'Двор, обзор', null, 2],
      ['barrier', 'Шлагбаум на въезде', must(points1[1], 'шлагбаум'), 3],
    ] as const;

    for (const [kind, name, pointId, sortOrder] of cameraSpecs) {
      const cameraId = await insertOne(
        client,
        `INSERT INTO cameras
           (tenant_id, building_id, access_point_id, kind, name, sort_order, stream_type, provider)
         VALUES ($1, $2, $3, $4, $5, $6, 'demo', 'mock') RETURNING id`,
        [uk1, building1, pointId, kind, name, sortOrder],
      );

      for (const apartmentId of apartments1) {
        await client.query(
          'INSERT INTO camera_grants (camera_id, apartment_id) VALUES ($1, $2)',
          [cameraId, apartmentId],
        );
      }
    }

    // Камера вызывной панели у второго УК — проверяем изоляцию
    const camera2 = await insertOne(
      client,
      `INSERT INTO cameras
         (tenant_id, building_id, access_point_id, kind, name, stream_type, provider)
       VALUES ($1, $2, $3, 'call_panel', 'Вызывная панель подъезда 1', 'demo', 'mock') RETURNING id`,
      [uk2, building2, point2],
    );
    for (const apartmentId of apartments2) {
      await client.query(
        'INSERT INTO camera_grants (camera_id, apartment_id) VALUES ($1, $2)',
        [camera2, apartmentId],
      );
    }

    // Пара записей в журнале, чтобы экран не был пустым на демо
    for (const [pointId, hoursAgo] of [
      [must(points1[1], 'шлагбаум'), 3],
      [must(points1[0], 'дверь'), 26],
    ] as const) {
      await client.query(
        `INSERT INTO access_events
           (tenant_id, access_point_id, user_id, apartment_id, action, result, source, created_at)
         VALUES ($1, $2, $3, $4, 'open', 'ok', 'app', now() - ($5 || ' hours')::interval)`,
        [uk1, pointId, must(residents1[0], 'житель'), must(apartments1[0], 'квартира'), hoursAgo],
      );
    }

    // ─── Счётчики, лифты, экстренные сообщения ──────────────────────────────
    const meterSpecs = [
      ['cold_water', 'СВ-0417', 'м³', 1, '2027-03-01'],
      ['hot_water', 'ГВ-0418', 'м³', 2, '2027-03-01'],
      ['electricity', 'Э-99215', 'кВт·ч', 3, '2026-12-01'],
    ] as const;

    for (const [kind, serial, unit, sortOrder, verificationDue] of meterSpecs) {
      const meterId = await insertOne(
        client,
        `INSERT INTO meters (tenant_id, apartment_id, kind, serial, unit, verification_due, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6::date, $7) RETURNING id`,
        [uk1, must(apartments1[0], 'квартира'), kind, serial, unit, verificationDue, sortOrder],
      );

      // Двенадцать прошлых периодов: историю и график видно сразу.
      // Значения детерминированные, чтобы демо было одинаковым у всех.
      const base = kind === 'electricity' ? 1450 : 42;
      const deltas =
        kind === 'electricity'
          ? [110, 118, 105, 122, 130, 140, 155, 160, 145, 132, 120, 115]
          : [3.8, 4.1, 3.6, 4.4, 3.9, 4.2, 3.7, 4.0, 4.5, 3.5, 4.3, 3.9];
      let value = base;
      for (let monthsAgo = 12; monthsAgo >= 1; monthsAgo--) {
        value += deltas[12 - monthsAgo] ?? 0;
        await client.query(
          `INSERT INTO meter_readings (meter_id, period, value, source)
           VALUES ($1, date_trunc('month', now()) - ($2 || ' months')::interval, $3, 'app')
           ON CONFLICT (meter_id, period) DO NOTHING`,
          [meterId, monthsAgo, Number(value.toFixed(1))],
        );
      }
    }

    // Счётчики и для второй квартиры: переключатель квартир должен
    // показывать разные приборы, иначе непонятно, работает ли он
    const meters2 = [
      ['cold_water', 'СВ-7721', 'м³', 1],
      ['electricity', 'Э-7734', 'кВт·ч', 2],
    ] as const;

    for (const [kind, serial, unit, sortOrder] of meters2) {
      const meterId = await insertOne(
        client,
        `INSERT INTO meters (tenant_id, apartment_id, kind, serial, unit, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [uk2, must(apartments2[1], 'квартира УК-2'), kind, serial, unit, sortOrder],
      );

      const base = kind === 'electricity' ? 860 : 12.4;
      const deltas =
        kind === 'electricity'
          ? [75, 82, 78, 88, 90, 95, 100, 105, 98, 92, 86, 80]
          : [1.2, 1.4, 1.1, 1.6, 1.3, 1.5, 1.2, 1.4, 1.7, 1.1, 1.5, 1.3];
      let value = base;
      for (let monthsAgo = 12; monthsAgo >= 1; monthsAgo--) {
        value += deltas[12 - monthsAgo] ?? 0;
        await client.query(
          `INSERT INTO meter_readings (meter_id, period, value, source)
           VALUES ($1, date_trunc('month', now()) - ($2 || ' months')::interval, $3, 'app')
           ON CONFLICT (meter_id, period) DO NOTHING`,
          [meterId, monthsAgo, Number(value.toFixed(1))],
        );
      }
    }

    const contactSpecs = [
      ['uk', 'Аварийная служба УК «Дом-Сервис»', '+7 385 200-00-01', 'Круглосуточно', 1],
      ['uk', 'Диспетчер УК «Дом-Сервис»', '+7 385 200-00-02', 'Пн–Пт, 8:00–20:00', 2],
      ['district', 'Участковый', '+7 385 200-00-30', 'Кабинет в опорном пункте', 3],
      ['provider', 'Интернет-провайдер', '+7 800 100-20-30', 'Поддержка абонентов', 4],
      ['clinic', 'Поликлиника', '+7 385 200-00-40', 'Запись и вызов врача', 5],
    ] as const;

    for (const [kind, name, phone, note, sortOrder] of contactSpecs) {
      await client.query(
        `INSERT INTO contacts (tenant_id, kind, name, phone, note, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [uk1, kind, name, phone, note, sortOrder],
      );
    }

    const liftSpecs = [
      ['1', 'ok', 'ООО «ЛифтСервис»', 1],
      ['2', 'maintenance', 'ООО «ЛифтСервис»', 2],
    ] as const;

    for (const [number, status, serviceOrg, sortOrder] of liftSpecs) {
      await client.query(
        `INSERT INTO lifts (tenant_id, building_id, number, status, service_org, last_service_at)
         VALUES ($1, $2, $3, $4, $5, now() - ($6 || ' days')::interval)`,
        [uk1, building1, number, status, serviceOrg, sortOrder * 30],
      );
    }

    // Сообщение по всей УК и сообщение по конкретному дому
    await client.query(
      `INSERT INTO emergency_messages (tenant_id, title, body, severity, expires_at)
       VALUES ($1, $2, $3, 'warning', now() + interval '3 days')`,
      [
        uk1,
        'Отключение горячей воды',
        'С 12 по 15 ноября горячей воды не будет: плановые работы на тепловом пункте. Холодная вода — без ограничений.',
      ],
    );
    await client.query(
      `INSERT INTO emergency_messages (tenant_id, building_id, title, body, severity)
       VALUES ($1, $2, $3, $4, 'info')`,
      [
        uk1,
        building1,
        'Ремонт кровли',
        'С 8:00 до 17:00 возможен шум на верхних этажах: идёт ремонт кровли. Извините за неудобства.',
      ],
    );

    // ─── Счётчики номеров заявок ────────────────────────────────────────────
    await client.query('INSERT INTO ticket_numbers (tenant_id, last_number) VALUES ($1, 0), ($2, 0)', [
      uk1,
      uk2,
    ]);

    // ─── Заявки УК-1 ────────────────────────────────────────────────────────

    /** Создать заявку в статусе «Новая» и вернуть id + номер. */
    const createTicket = async (input: {
      tenantId: string;
      buildingId: string;
      apartmentId: string | null;
      categoryCode: string;
      priority: string;
      source: string;
      title: string;
      description: string;
      contactPhone: string;
      createdBy: string;
      locationNote?: string;
      parentTicketId?: string;
      slaHours?: number;
      createdAt?: Date;
    }): Promise<{ id: string; number: number }> => {
      const cat = categoryOf(input.categoryCode);
      const numRes = await client.query<{ last_number: number }>(
        'UPDATE ticket_numbers SET last_number = last_number + 1 WHERE tenant_id = $1 RETURNING last_number',
        [input.tenantId],
      );
      const number = must(numRes.rows[0]?.last_number, 'номер заявки');
      const slaHours = input.slaHours ?? cat.sla;
      // Срок считается от момента СОЗДАНИЯ заявки, а не от текущего времени:
      // иначе «старые» заявки в демо не бывают просроченными.
      const createdAt = input.createdAt ?? new Date();
      const slaDueAt = new Date(createdAt.getTime() + slaHours * 3600 * 1000);

      const res = await client.query<{ id: string }>(
        `INSERT INTO tickets
           (tenant_id, number, building_id, apartment_id, category_id, priority, source,
            title, description, location_note, contact_phone, created_by,
            parent_ticket_id, sla_due_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING id`,
        [
          input.tenantId,
          number,
          input.buildingId,
          input.apartmentId,
          cat.id,
          input.priority,
          input.source,
          input.title,
          input.description,
          input.locationNote ?? null,
          input.contactPhone,
          input.createdBy,
          input.parentTicketId ?? null,
          slaDueAt,
          createdAt,
        ],
      );
      return { id: must(res.rows[0]?.id, 'id заявки'), number };
    };

    /**
     * Сменить статус так же, как это делает приложение:
     * обновить заявку + добавить запись в историю.
     * Триггер истории не даст изменить прошлые записи — это проверка заодно.
     */
    const changeStatus = async (
      ticketId: string,
      tenantId: string,
      toCode: string,
      by: string,
      opts: {
        comment?: string;
        resolutionNote?: string;
        assignedTo?: string | null;
        setAccepted?: boolean;
        setStarted?: boolean;
      } = {},
    ): Promise<void> => {
      const current = await client.query<{ status_id: string }>(
        'SELECT status_id FROM tickets WHERE id = $1',
        [ticketId],
      );
      const fromStatusId = must(current.rows[0]?.status_id, 'текущий статус');

      await client.query(
        `UPDATE tickets
            SET status_id = $2::uuid,
                resolution_note = COALESCE($3::text, resolution_note),
                closed_by = CASE WHEN $2::uuid = $4::uuid THEN $5::uuid ELSE closed_by END,
                assigned_to = COALESCE($6::uuid, assigned_to),
                accepted_at = CASE WHEN $7::boolean THEN COALESCE(accepted_at, now()) ELSE accepted_at END,
                started_at  = CASE WHEN $8::boolean THEN COALESCE(started_at, now()) ELSE started_at END
          WHERE id = $1::uuid`,
        [
          ticketId,
          status(toCode),
          opts.resolutionNote ?? null,
          status('closed'),
          by,
          opts.assignedTo ?? null,
          opts.setAccepted ?? false,
          opts.setStarted ?? false,
        ],
      );

      await client.query(
        `INSERT INTO ticket_status_history
           (tenant_id, ticket_id, from_status_id, to_status_id, changed_by, comment)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::text)`,
        [tenantId, ticketId, fromStatusId, status(toCode), by, opts.comment ?? null],
      );
    };

    const assign = async (ticketId: string, tenantId: string, assignee: string, by: string): Promise<void> => {
      await client.query('UPDATE tickets SET assigned_to = $2 WHERE id = $1', [ticketId, assignee]);
      await client.query(
        `INSERT INTO ticket_assignments (tenant_id, ticket_id, assignee_id, assigned_by)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, ticketId, assignee, by],
      );
    };

    const [r1, r2, r3, r4, r5] = residents1 as [string, string, string, string, string];
    const [a1, a2, a3, a4, a5] = apartments1 as [string, string, string, string, string];

    // №1 — закрытая (сантехника), была повторно открыта отдельной заявкой №10
    const t1 = await createTicket({
      tenantId: uk1,
      buildingId: building1,
      apartmentId: a1,
      categoryCode: 'plumbing',
      priority: 'high',
      source: 'resident_app',
      title: 'Течёт кран на кухне',
      description: 'Капает под мойкой, ведро уже полное.',
      contactPhone: '+79000000101',
      createdBy: r1,
      createdAt: new Date(Date.now() - 5 * 24 * 3600 * 1000),
    });
    await changeStatus(t1.id, uk1, 'accepted', dispatcher1, { setAccepted: true, comment: 'Принято' });
    await assign(t1.id, uk1, plumber, dispatcher1);
    await changeStatus(t1.id, uk1, 'assigned', dispatcher1, { assignedTo: plumber });
    await changeStatus(t1.id, uk1, 'in_progress', plumber, { setStarted: true });
    await changeStatus(t1.id, uk1, 'closed', plumber, {
      resolutionNote: 'Заменён картридж смесителя, течь устранена.',
    });

    // №2 — закрытая (электрика)
    const t2 = await createTicket({
      tenantId: uk1,
      buildingId: building1,
      apartmentId: a2,
      categoryCode: 'electrical',
      priority: 'emergency',
      source: 'resident_app',
      title: 'Нет света в квартире',
      description: 'Выбило автомат, в подъезде свет есть.',
      contactPhone: '+79000000102',
      createdBy: r2,
      createdAt: new Date(Date.now() - 4 * 24 * 3600 * 1000),
    });
    await changeStatus(t2.id, uk1, 'accepted', dispatcher1, { setAccepted: true });
    await assign(t2.id, uk1, electrician, dispatcher1);
    await changeStatus(t2.id, uk1, 'assigned', dispatcher1, { assignedTo: electrician });
    await changeStatus(t2.id, uk1, 'in_progress', electrician, { setStarted: true });
    await changeStatus(t2.id, uk1, 'closed', electrician, {
      resolutionNote: 'Заменён автоматический выключатель 16А.',
    });

    // №3 — закрытая (уборка, место общего пользования)
    const t3 = await createTicket({
      tenantId: uk1,
      buildingId: building1,
      apartmentId: null,
      categoryCode: 'cleaning',
      priority: 'low',
      source: 'resident_app',
      title: 'Не убран подъезд',
      description: 'В подъезде 2 не убирали неделю.',
      locationNote: 'подъезд 2, все этажи',
      contactPhone: '+79000000103',
      createdBy: r3,
      createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000),
    });
    await changeStatus(t3.id, uk1, 'accepted', dispatcher1, { setAccepted: true });
    await changeStatus(t3.id, uk1, 'closed', dispatcher1, {
      resolutionNote: 'Уборка выполнена, подъезд приведён в порядок.',
      // Закрывает админ УК: у диспетчера права ticket.close нет
    });

    // №4 — в работе (водоснабжение)
    const t4 = await createTicket({
      tenantId: uk1,
      buildingId: building1,
      apartmentId: a3,
      categoryCode: 'water',
      priority: 'high',
      source: 'resident_app',
      title: 'Нет холодной воды',
      description: 'Со вчерашнего вечера нет холодной воды.',
      contactPhone: '+79000000103',
      createdBy: r3,
      // 2 часа назад: норматив категории (24 ч) ещё не истёк — заявка в работе,
      // но не просрочена. Свой срок не задаём: он должен совпадать с нормативом,
      // иначе карточка пишет «24 часа», а просрочка наступает через два.
      createdAt: new Date(Date.now() - 2 * 3600 * 1000),
    });
    await changeStatus(t4.id, uk1, 'accepted', dispatcher1, { setAccepted: true });
    await assign(t4.id, uk1, plumber, dispatcher1);
    await changeStatus(t4.id, uk1, 'assigned', dispatcher1, { assignedTo: plumber });
    await changeStatus(t4.id, uk1, 'in_progress', plumber, { setStarted: true });

    // №5 — ожидает материалов (отопление)
    const t5 = await createTicket({
      tenantId: uk1,
      buildingId: building1,
      apartmentId: a4,
      categoryCode: 'heating',
      priority: 'high',
      source: 'resident_app',
      title: 'Холодная батарея в комнате',
      description: 'Одна батарея не греет.',
      contactPhone: '+79000000104',
      createdBy: r4,
      // 3 часа назад: SLA (8 ч) ещё не истёк
      createdAt: new Date(Date.now() - 3 * 3600 * 1000),
    });
    await changeStatus(t5.id, uk1, 'accepted', dispatcher1, { setAccepted: true });
    await assign(t5.id, uk1, plumber, dispatcher1);
    await changeStatus(t5.id, uk1, 'assigned', dispatcher1, { assignedTo: plumber });
    await changeStatus(t5.id, uk1, 'in_progress', plumber, { setStarted: true });
    await changeStatus(t5.id, uk1, 'waiting', plumber, {
      comment: 'Ожидаем поставку радиатора, срок 3 дня.',
    });

    // №6 — новая аварийная (лифт, МОП)
    await createTicket({
      tenantId: uk1,
      buildingId: building1,
      apartmentId: null,
      categoryCode: 'elevator',
      priority: 'emergency',
      source: 'dispatcher_phone',
      title: 'Застрял лифт в подъезде 1',
      description: 'Лифт остановился между 4 и 5 этажом, внутри никого.',
      locationNote: 'подъезд 1, между 4 и 5 этажом',
      contactPhone: '+79000000101',
      createdBy: dispatcher1,
      // Норматив лифта — 4 часа, создана 30 минут назад: срочно, но не просрочена
      createdAt: new Date(Date.now() - 30 * 60 * 1000),
    });
    // №7 — новая, от жителя без подтверждённой привязки (зарегистрировал диспетчер)
    await createTicket({
      tenantId: uk1,
      buildingId: building1,
      apartmentId: a5,
      categoryCode: 'intercom',
      priority: 'normal',
      source: 'dispatcher_phone',
      title: 'Не работает домофон',
      description: 'Домофон не открывает дверь, трубка молчит.',
      contactPhone: '+79000000105',
      createdBy: dispatcher1,
      createdAt: new Date(Date.now() - 4 * 3600 * 1000),
    });

    // №8 — отклонённая
    const t8 = await createTicket({
      tenantId: uk1,
      buildingId: building1,
      apartmentId: a2,
      categoryCode: 'other',
      priority: 'low',
      source: 'resident_app',
      title: 'Прошу заменить лампочку в подъезде',
      description: 'Перегорела лампочка на лестнице.',
      contactPhone: '+79000000102',
      createdBy: r2,
      createdAt: new Date(Date.now() - 6 * 24 * 3600 * 1000),
    });
    await changeStatus(t8.id, uk1, 'rejected', dispatcher1, {
      comment: 'Освещение в подъезде обслуживается по отдельному графику, заявка не требуется.',
    });

    // №9 — просроченная по SLA (в работе, срок прошёл)
    const t9 = await createTicket({
      tenantId: uk1,
      buildingId: building1,
      apartmentId: a1,
      categoryCode: 'sewerage',
      priority: 'high',
      source: 'resident_app',
      title: 'Засор в стояке',
      description: 'Вода уходит очень медленно.',
      contactPhone: '+79000000101',
      createdBy: r1,
      // Единственная просроченная: норматив 24 ч, создана 30 часов назад.
      // Раньше срок подменялся двумя часами — карточка честно писала «24 часа»,
      // а просрочка наступала вдвое раньше норматива.
      createdAt: new Date(Date.now() - 30 * 3600 * 1000),
    });
    await changeStatus(t9.id, uk1, 'accepted', dispatcher1, { setAccepted: true });
    await assign(t9.id, uk1, plumber, dispatcher1);
    await changeStatus(t9.id, uk1, 'assigned', dispatcher1, { assignedTo: plumber });
    await changeStatus(t9.id, uk1, 'in_progress', plumber, { setStarted: true });

    // №10 — повторное обращение по заявке №1
    await createTicket({
      tenantId: uk1,
      buildingId: building1,
      apartmentId: a1,
      categoryCode: 'plumbing',
      priority: 'high',
      source: 'resident_app',
      title: 'Течь осталась (повторно)',
      description: 'Кран снова подкапывает, хотя приезжали.',
      contactPhone: '+79000000101',
      createdBy: r1,
      parentTicketId: t1.id,
      createdAt: new Date(Date.now() - 1 * 3600 * 1000),
    });

    // ─── Одна заявка во второй УК: проверка, что чужие её не видят ──────────
    const catOther = categoryOf('other');
    const numRes2 = await client.query<{ last_number: number }>(
      'UPDATE ticket_numbers SET last_number = last_number + 1 WHERE tenant_id = $1 RETURNING last_number',
      [uk2],
    );
    await client.query(
      `INSERT INTO tickets
         (tenant_id, number, building_id, apartment_id, category_id, priority, source,
          title, description, contact_phone, created_by, sla_due_at)
       VALUES ($1, $2, $3, $4, $5, 'normal', 'resident_app', $6, $7, $8, $9,
               now() + ($10 || ' hours')::interval)`,
      [
        uk2,
        must(numRes2.rows[0]?.last_number, 'номер заявки УК-2'),
        building2,
        must(apartments2[0], 'квартира УК-2'),
        catOther.id,
        'Шумные соседи',
        'После 23:00 громкая музыка.',
        '+79000000201',
        admin2,
        String(catOther.sla),
      ],
    );

    // ─── Новости ────────────────────────────────────────────────────────────
    await client.query(
      `INSERT INTO news (tenant_id, scope, title, body, published_at, published_by)
       VALUES ($1, 'tenant', $2, $3, now(), $4)`,
      [
        uk1,
        'Плановое отключение горячей воды',
        'С 10 по 13 ноября будет отключена горячая вода в связи с гидравлическими испытаниями. Приносим извинения за неудобства.',
        admin1,
      ],
    );
    await client.query(
      `INSERT INTO news (tenant_id, scope, building_id, title, body, is_emergency, published_at, published_by)
       VALUES ($1, 'building', $2, $3, $4, true, now(), $5)`,
      [
        uk1,
        building1,
        'Авария на теплотрассе',
        'Временно снижена температура в квартирах. Ремонтная бригада работает на месте. Ориентировочное время устранения — 18:00.',
        dispatcher1,
      ],
    );
    await client.query(
      `INSERT INTO news (tenant_id, scope, title, body, published_at, published_by)
       VALUES ($1, 'tenant', $2, $3, now(), $4)`,
      [uk2, 'Субботник во дворе', 'Приглашаем жителей на субботник 8 ноября в 10:00.', admin2],
    );

    // ─── Уведомления для жителя (по закрытой заявке) ────────────────────────
    await client.query(
      `INSERT INTO notifications (tenant_id, user_id, type, title, body, entity_type, entity_id)
       VALUES ($1, $2, 'ticket_status_changed', $3, $4, 'ticket', $5)`,
      [uk1, r1, `Заявка №${t1.number} закрыта`, 'Заменён картридж смесителя, течь устранена.', t1.id],
    );
    await client.query(
      `INSERT INTO notifications (tenant_id, user_id, type, title, body, entity_type, entity_id)
       VALUES ($1, $2, 'ticket_status_changed', $3, $4, 'ticket', $5)`,
      [uk1, r3, 'Заявка в работе', 'По вашей заявке назначен сантехник.', t4.id],
    );

    await client.query('COMMIT');
    console.log('[seed] Готово. Демо-данные созданы.');
    console.log('[seed] Пароль всех пользователей: ' + DEMO_PASSWORD);
    console.log('[seed] УК-1 «Дом-Сервис»: admin +79000000001, диспетчер +79000000002, сантехник +79000000003');
    console.log('[seed] УК-2 «ЖилКомфорт»: admin +79000000021, диспетчер +79000000022');
    console.log('[seed] Житель УК-1: +79000000101 (кв. 1, подтверждён), +79000000105 (кв. 5, ожидает)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[seed] Ошибка, транзакция откачена:');
    console.error(err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
