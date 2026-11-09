/**
 * Звонок с панели → запись в базе и уведомление жителю.
 *
 * Здесь нет сети и сокетов: на вход приходит уже разобранное событие AMI.
 * Так эту часть можно проверить без Asterisk и не гадать, «кто виноват» —
 * разбор, база или интерфейс.
 *
 * Правило нумерации: панель набирает **номер комнаты**, он хранится в
 * `apartments.intercom_room`. Если комната не найдена — звонок не создаём.
 * Фантомная запись «звонят в никуда» хуже, чем отсутствие записи: она
 * показывает жителю окно, открывать которое некуда.
 */
import { pool } from '../../db/pool.js';
import { parseHangup, parsePanelCall, type AmiEvent } from './ami-parser.js';

export interface IntercomLog {
  info: (message: string) => void;
  warn: (message: string) => void;
}

/** Активные звонки: Uniqueid Asterisk → id записи. Живут только в памяти. */
const active = new Map<string, { callId: string; tenantId: string; apartmentId: string }>();

/**
 * Отправка команды в Asterisk. Появляется при подключении AMI и пропадает при
 * остановке; без неё запрос на сброс звонка просто пропускается — приложение
 * не должно падать из-за того, что телефония не подключена.
 */
let amiSend: ((command: string) => void) | null = null;

export function setAmiSender(fn: ((command: string) => void) | null): void {
  amiSend = fn;
}

export function activeCallCount(): number {
  return active.size;
}

/** Обработка одного события AMI. Ошибки не бросаем: поток событий важнее. */
export async function handleAmiEvent(event: AmiEvent, log: IntercomLog): Promise<void> {
  const call = parsePanelCall(event);
  if (call) {
    await startCall(call.uniqueId, call.room, call.from, call.channel, log);
    return;
  }

  const hangup = parseHangup(event);
  if (hangup) {
    await finishCall(hangup.uniqueId, log);
  }
}

async function startCall(
  uniqueId: string,
  room: string,
  from: string,
  channel: string | null,
  log: IntercomLog,
): Promise<void> {
  // Повторное событие по тому же каналу (Asterisk иногда дублирует) не должно
  // порождать второй звонок.
  if (active.has(uniqueId)) return;

  const apartment = await pool.query<{
    id: string;
    tenant_id: string;
    building_id: string;
  }>(
    `SELECT a.id, b.tenant_id, a.building_id
       FROM apartments a
       JOIN buildings b ON b.id = a.building_id
      WHERE a.intercom_room = $1
      LIMIT 1`,
    [room],
  );

  const target = apartment.rows[0];
  if (!target) {
    log.warn(`[ami] звонок в комнату ${room}: квартира не найдена, пропускаю`);
    return;
  }

  // Точка доступа нужна для журнала: звонок привязан к точке, а не к дому.
  // Берём активную точку этого дома — на стенде она одна.
  const point = await pool.query<{ id: string }>(
    `SELECT id FROM access_points
      WHERE building_id = $1 AND is_active = true
      ORDER BY sort_order
      LIMIT 1`,
    [target.building_id],
  );

  const pointId = point.rows[0]?.id;
  if (!pointId) {
    log.warn(`[ami] звонок в комнату ${room}: у дома нет активных точек доступа`);
    return;
  }

  // Один звонок на квартиру. Asterisk присылает пару каналов на Local-вызов
  // (;1 и ;2), и оба приходят как Newchannel. Проверка «есть ли уже ringing»
  // в коде от гонки не спасает — два события обрабатываются одновременно.
  // Поэтому запрет держит база: частичный уникальный индекс
  // intercom_calls_one_ringing_idx (миграция 019).
  //
  // user_id заполняем собственником квартиры: окно звонка ищет звонок
  // по жителю, а из AMI мы знаем только квартиру.
  const owner = await pool.query<{ user_id: string }>(
    `SELECT rb.user_id
       FROM resident_bindings rb
      WHERE rb.apartment_id = $1 AND rb.status = 'confirmed'
      ORDER BY (rb.role_in_apartment = 'owner') DESC, rb.created_at
      LIMIT 1`,
    [target.id],
  );

  // Звонок не может «звенеть» дольше двух минут: панель столько не звонит,
  // значит запись осталась от оборванной связи (Asterisk перезапускали, процесс
  // падал). Такая запись заняла бы место в уникальном индексе, и следующий
  // настоящий звонок был бы тихо проигнорирован. Поэтому закрываем заранее.
  await pool.query(
    `UPDATE intercom_calls
        SET status = 'missed', ended_at = COALESCE(ended_at, now())
      WHERE apartment_id = $1 AND status = 'ringing'
        AND started_at < now() - interval '2 minutes'`,
    [target.id],
  );

  const inserted = await pool.query<{ id: string }>(
    // camera_id сразу: окно звонка показывает поток камеры этой точки, а без
    // камеры житель увидит заглушку вместо картинки с панели.
    // Камер несколько может не быть — тогда NULL и остаётся демо-заставка.
    `INSERT INTO intercom_calls
       (tenant_id, access_point_id, apartment_id, user_id, camera_id, status, ami_unique_id, ami_channel)
     VALUES ($1, $2, $3, $4,
             (SELECT id FROM cameras
               WHERE access_point_id = $2 AND kind = 'call_panel'
               LIMIT 1),
             'ringing', $5, $6)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [target.tenant_id, pointId, target.id, owner.rows[0]?.user_id ?? null, uniqueId, channel],
  );

  let callId = inserted.rows[0]?.id;

  if (!callId) {
    // Значит звонок в эту квартиру уже звенит (второй канал того же вызова).
    // Привязываем канал к существующей записи, чтобы Hangup закрыл её.
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM intercom_calls
        WHERE apartment_id = $1 AND status = 'ringing'
        ORDER BY started_at DESC
        LIMIT 1`,
      [target.id],
    );

    callId = existing.rows[0]?.id;
    if (!callId) {
      log.warn(`[ami] звонок в комнату ${room}: запись не создана и не найдена`);
      return;
    }

    active.set(uniqueId, { callId, tenantId: target.tenant_id, apartmentId: target.id });
    log.info(`[ami] второй канал того же вызова в комнату ${room} — записи не создаю`);
    return;
  }

  active.set(uniqueId, { callId, tenantId: target.tenant_id, apartmentId: target.id });
  log.info(`[ami] звонок из ${from || 'панели'} в комнату ${room} → квартира ${target.id}`);

  // Уведомление здесь НЕ создаём: житель ещё может ответить.
  // Оно появится только если звонок остался без ответа — см. finishCall.
}

/**
 * Уведомление о пропущенном звонке.
 *
 * Вынесено отдельно, потому что зовётся из двух мест: при штатном завершении
 * звонка и при остановке процесса (деплой, падение) — иначе пропущенный
 * звонок, пришедшийся на перезапуск, исчез бы без следа.
 *
 * DISTINCT обязателен: представление прав отдаёт строку на каждую точку
 * доступа квартиры, и без него один звонок превращался в 19 уведомлений.
 */
async function notifyMissed(
  tenantId: string,
  callId: string,
  apartmentId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO notifications (tenant_id, user_id, type, title, body, entity_type, entity_id)
     SELECT $1, ar.user_id, 'intercom_call',
            'Пропущенный звонок в домофон', 'Гость звонил в вашу дверь и не дождался ответа',
            'intercom_call', $2
       FROM (
         SELECT DISTINCT r.user_id
           FROM apartment_rights r
          WHERE r.apartment_id = $3 AND r.can_tickets
       ) ar
      LIMIT 20`,
    [tenantId, callId, apartmentId],
  );
}

async function finishCall(uniqueId: string, log: IntercomLog): Promise<void> {
  const known = active.get(uniqueId);
  if (!known) return;

  active.delete(uniqueId);

  // Если звонок ещё «звонит» — никто не ответил. Если уже открыт или отклонён,
  // статус менял интерфейс, его не трогаем: он важнее для разбора.
  const closed = await pool.query<{
    id: string;
    status: string;
    tenant_id: string;
    apartment_id: string;
  }>(
    `UPDATE intercom_calls
        SET ended_at = now(),
            status = CASE WHEN status = 'ringing' THEN 'missed' ELSE status END
      WHERE id = $1
      RETURNING id, status, tenant_id, apartment_id`,
    [known.callId],
  );

  const row = closed.rows[0];

  // Уведомление — только про пропущенный звонок.
  //
  // Раньше оно создавалось в момент вызова, и житель получал «вам звонили» даже
  // когда уже поговорил и открыл дверь. Теперь колокольчик говорит ровно то, что
  // важно: «ты пропустил гостя». Отвеченные и отклонённые звонки не шумят.
  if (row?.status === 'missed') {
    await notifyMissed(row.tenant_id, row.id, row.apartment_id);
  }

  log.info(`[ami] звонок завершён (${known.callId}), статус: ${row?.status ?? '-'}`);
}

/**
 * Положить трубку на панели.
 *
 * Зачем: житель нажимает «Открыть», дверь открывается, но панель продолжает
 * вызов — на её табло разговор не завершён, а гость слышит «линию». Раньше мы
 * меняли только свою запись в базе, а Asterisk об этом не знал.
 *
 * Канал берём из записи звонка: он пришёл в событии Newchannel. Если канала
 * нет (звонок создан вручную или это демо), просто ничего не делаем.
 */
export async function hangupCall(callId: string): Promise<boolean> {
  if (!amiSend) return false;

  const res = await pool.query<{ ami_channel: string | null }>(
    `SELECT ami_channel FROM intercom_calls WHERE id = $1`,
    [callId],
  );

  const channel = res.rows[0]?.ami_channel;
  if (!channel) return false;

  amiSend(`Action: Hangup\r\nChannel: ${channel}\r\n\r\n`);
  return true;
}


/**
 * Сторож звонков: закрывает «зависшие» вызовы и уведомляет о пропущенных.
 *
 * Зачем: событие Hangup приходит не всегда. Проверено на стенде 06.11 —
 * звонок, поданный через `channel originate`, остался в статусе ringing
 * навсегда, и уведомление о пропущенном не создалось. Причины могут быть
 * разные (потеря события, обрыв AMI, перезапуск Asterisk), но последствие
 * одно: житель не узнает, что к нему приходили, а запись занимает место в
 * уникальном индексе «один звонящий звонок на квартиру» и блокирует новые.
 *
 * Вызывается по таймеру из app.ts. Возвращает число закрытых звонков.
 */
export async function sweepStaleCalls(olderThanSeconds = 60): Promise<number> {
  const closed = await pool.query<{
    id: string;
    tenant_id: string;
    apartment_id: string;
  }>(
    `UPDATE intercom_calls
        SET status = 'missed', ended_at = COALESCE(ended_at, now())
      WHERE status = 'ringing'
        AND started_at < now() - ($1 || ' seconds')::interval
      RETURNING id, tenant_id, apartment_id`,
    [String(olderThanSeconds)],
  );

  const ids = new Set(closed.rows.map((row) => row.id));
  for (const [uniqueId, item] of active) {
    if (ids.has(item.callId)) active.delete(uniqueId);
  }

  for (const row of closed.rows) {
    await notifyMissed(row.tenant_id, row.id, row.apartment_id).catch(() => undefined);
  }

  return closed.rowCount ?? 0;
}

/** Сброс состояния при остановке процесса: открытые звонки помечаем как пропущенные. */
export async function closeAllActiveCalls(): Promise<void> {
  if (active.size === 0) return;
  const items = [...active.values()];
  active.clear();

  const closed = await pool.query<{
    id: string;
    status: string;
    tenant_id: string;
    apartment_id: string;
  }>(
    `UPDATE intercom_calls
        SET ended_at = COALESCE(ended_at, now()),
            status = CASE WHEN status = 'ringing' THEN 'missed' ELSE status END
      WHERE id = ANY($1::uuid[])
      RETURNING id, status, tenant_id, apartment_id`,
    [items.map((item) => item.callId)],
  );

  // Если остались неотвеченные звонки — житель должен узнать, что не слышал гостя.
  for (const row of closed.rows) {
    if (row.status === 'missed') {
      await notifyMissed(row.tenant_id, row.id, row.apartment_id).catch(() => undefined);
    }
  }
}
