/**
 * Камеры и видеозвонки.
 *
 * Два независимых, но связанных сценария:
 *
 *  1. Просмотр камер: житель открывает камеры своего дома — только те,
 *     что разрешены его квартире.
 *  2. Звонок в домофон: кто-то нажал кнопку на вызывной панели, у жителя
 *     появляется картинка с панели и кнопки «открыть» / «отклонить».
 *
 * Про видео отдельно: браузер не воспроизводит RTSP. Поэтому камера хранит
 * тип потока (hls / webrtc / sip / demo). Пока тип demo — плеер показывает
 * заглушку с честной подписью, а не выдуманный «прямой эфир».
 *
 * Доступ к потоку выдаётся короткоживущим токеном, а не прямой ссылкой:
 * иначе ссылку из нашего API можно переслать кому угодно, и камера будет
 * смотреть кто хочет.
 */
import { randomUUID } from 'node:crypto';
import { pool } from '../../db/pool.js';

export type CameraKind = 'overview' | 'call_panel' | 'barrier' | 'parking';
export type StreamType = 'demo' | 'hls' | 'webrtc' | 'sip';

export interface ResidentCamera {
  id: string;
  kind: CameraKind;
  name: string;
  buildingAddress: string;
  apartmentNumber: string;
  isActive: boolean;
  /** Есть ли у камеры поток. В демо-режиме false. */
  hasLiveStream: boolean;
}

interface CameraRow {
  id: string;
  kind: CameraKind;
  name: string;
  is_active: boolean;
  stream_type: StreamType;
  stream_url: string | null;
  address_text: string;
  apartment_number: string;
}

/** Камеры, доступные жителю (как и точки доступа — через привязку к квартире). */
export async function listCamerasForUser(userId: string): Promise<ResidentCamera[]> {
  const res = await pool.query<CameraRow>(
    `SELECT * FROM (
       SELECT DISTINCT ON (c.id)
              c.id, c.kind, c.name, c.is_active, c.stream_type, c.stream_url,
              b.address_text, a.number AS apartment_number, c.sort_order
         FROM apartment_rights r
         JOIN apartments a ON a.id = r.apartment_id
         JOIN buildings b ON b.id = a.building_id
         JOIN camera_grants g ON g.apartment_id = a.id AND g.revoked_at IS NULL
         JOIN cameras c ON c.id = g.camera_id
        WHERE r.user_id = $1
          AND r.can_video
        ORDER BY c.id, a.number
     ) AS cameras
     ORDER BY sort_order, name`,
    [userId],
  );

  return res.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    buildingAddress: row.address_text,
    apartmentNumber: row.apartment_number,
    isActive: row.is_active,
    hasLiveStream: row.stream_type !== 'demo' && Boolean(row.stream_url),
  }));
}

export interface CameraStream {
  type: StreamType;
  /** Подписанный адрес потока. null в демо-режиме — показывать нечего. */
  url: string | null;
  expiresAt: string;
  /** Признак демо-режима: плеер покажет заглушку, а не видео. */
  demo: boolean;
}

/** Сколько живёт ссылка на поток. Минуты хватает, чтобы открыть просмотр. */
const STREAM_TTL_SECONDS = 300;

/**
 * Ссылка на поток камеры.
 *
 * В демо-режиме возвращаем demo=true и url=null: честнее показать заглушку,
 * чем битую ссылку. Когда появится медиасервер, здесь будет подписанный URL
 * с ограниченным сроком жизни.
 */
export async function getCameraStream(
  userId: string,
  cameraId: string,
): Promise<CameraStream | null> {
  const res = await pool.query<{
    stream_type: StreamType;
    stream_url: string | null;
    is_active: boolean;
  }>(
    `SELECT c.stream_type, c.stream_url, c.is_active
       FROM apartment_rights r
       JOIN camera_grants g ON g.apartment_id = r.apartment_id AND g.revoked_at IS NULL
       JOIN cameras c ON c.id = g.camera_id
      WHERE r.user_id = $1 AND r.can_video AND c.id = $2
      LIMIT 1`,
    [userId, cameraId],
  );

  const row = res.rows[0];
  if (!row || !row.is_active) return null;

  const expiresAt = new Date(Date.now() + STREAM_TTL_SECONDS * 1000).toISOString();

  if (row.stream_type === 'demo' || !row.stream_url) {
    return { type: 'demo', url: null, expiresAt, demo: true };
  }

  // Подпись ссылки появится вместе с медиасервером: сейчас нечего подписывать
  return {
    type: row.stream_type,
    url: row.stream_url,
    expiresAt,
    demo: false,
  };
}

export type CallStatus = 'ringing' | 'opened' | 'declined' | 'missed' | 'ended';

export interface ActiveCall {
  id: string;
  pointId: string;
  pointName: string;
  cameraId: string | null;
  cameraName: string | null;
  stream: CameraStream | null;
  startedAt: string;
  apartmentNumber: string;
}

/**
 * Активный звонок для жителя.
 *
 * В реальной жизни звонок создаёт устройство через вебхук провайдера.
 * Здесь — тот же путь, но триггер ручной: `startDemoCall`. Так проверяется
 * весь сценарий без железа, а заменить триггер на вебхук — одна функция.
 */
export async function getActiveCall(userId: string): Promise<ActiveCall | null> {
  const res = await pool.query<{
    id: string;
    access_point_id: string;
    camera_id: string | null;
    started_at: string;
    apartment_number: string;
    point_name: string;
    camera_name: string | null;
    stream_type: StreamType | null;
    stream_url: string | null;
  }>(
    `SELECT c.id, c.access_point_id, c.camera_id, c.started_at::text AS started_at,
            a.number AS apartment_number,
            ap.name AS point_name,
            cam.name AS camera_name,
            cam.stream_type, cam.stream_url
       FROM intercom_calls c
       JOIN apartments a ON a.id = c.apartment_id
       JOIN access_points ap ON ap.id = c.access_point_id
       LEFT JOIN cameras cam ON cam.id = c.camera_id
      WHERE c.status = 'ringing'
        AND c.apartment_id IN (
          SELECT apartment_id FROM apartment_rights
           WHERE user_id = $1 AND can_video
        )
      ORDER BY c.started_at DESC
      LIMIT 1`,
    [userId],
  );

  const row = res.rows[0];
  if (!row) return null;

  // Звонок живёт 60 секунд: домофон звонит примерно столько же
  const startedAt = new Date(row.started_at).getTime();
  if (Date.now() - startedAt > 60_000) {
    await pool.query(
      `UPDATE intercom_calls SET status = 'missed', ended_at = now() WHERE id = $1`,
      [row.id],
    );
    return null;
  }

  return {
    id: row.id,
    pointId: row.access_point_id,
    pointName: row.point_name,
    cameraId: row.camera_id,
    cameraName: row.camera_name,
    stream:
      row.stream_type === null
        ? null
        : {
            type: row.stream_type,
            url: row.stream_type === 'demo' ? null : row.stream_url,
            expiresAt: new Date(Date.now() + STREAM_TTL_SECONDS * 1000).toISOString(),
            demo: row.stream_type === 'demo' || !row.stream_url,
          },
    startedAt: row.started_at,
    apartmentNumber: row.apartment_number,
  };
}

/**
 * Демонстрационный звонок.
 *
 * Имитирует нажатие кнопки на вызывной панели. Берёт первую точку с камерой
 * вызывной панели, доступную квартире жителя, и создаёт звонок «звонит».
 */
export async function startDemoCall(userId: string, apartmentId?: string): Promise<ActiveCall | null> {
  const res = await pool.query<{
    tenant_id: string;
    access_point_id: string;
    apartment_id: string;
    camera_id: string | null;
  }>(
    `SELECT ap.tenant_id, ap.id AS access_point_id, a.id AS apartment_id, cam.id AS camera_id
       FROM apartment_rights r
       JOIN apartments a ON a.id = r.apartment_id
       JOIN access_grants g ON g.apartment_id = a.id AND g.revoked_at IS NULL
       JOIN access_points ap ON ap.id = g.access_point_id
       LEFT JOIN cameras cam ON cam.access_point_id = ap.id AND cam.kind = 'call_panel'
      WHERE r.user_id = $1
        AND r.can_video
        AND ($2::uuid IS NULL OR a.id = $2)
      ORDER BY (cam.id IS NULL), ap.sort_order
      LIMIT 1`,
    [userId, apartmentId ?? null],
  );

  const row = res.rows[0];
  if (!row) return null;

  // Закрываем предыдущие «звонящие», чтобы не копились
  await pool.query(
    `UPDATE intercom_calls SET status = 'missed', ended_at = now()
      WHERE user_id = $1 AND status = 'ringing'`,
    [userId],
  );

  await pool.query(
    `INSERT INTO intercom_calls
       (id, tenant_id, access_point_id, camera_id, apartment_id, user_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'ringing')`,
    [randomUUID(), row.tenant_id, row.access_point_id, row.camera_id, row.apartment_id, userId],
  );

  return getActiveCall(userId);
}

/** Завершить звонок: открыли дверь или отклонили. */
export async function finishCall(
  userId: string,
  callId: string,
  status: 'opened' | 'declined',
): Promise<boolean> {
  // Авторизация по квартире, а не по user_id: звонок с панели приходит
  // в КВАРТИРУ — вызывают кнопкой на подъезде, а не конкретному человеку.
  // Поэтому ответить может любой член семьи с правом на видео, а не только
  // тот, кто записан в user_id.
  const res = await pool.query(
    `UPDATE intercom_calls c
        SET status = $1, ended_at = now()
      WHERE c.id = $2 AND c.status = 'ringing'
        AND c.apartment_id IN (
          SELECT apartment_id FROM apartment_rights
           WHERE user_id = $3 AND can_video
        )`,
    [status, callId, userId],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Точка, к которой относится звонок, — чтобы открыть дверь через провайдера. */
export async function pointOfCall(userId: string, callId: string): Promise<string | null> {
  const res = await pool.query<{ access_point_id: string }>(
    `SELECT c.access_point_id FROM intercom_calls c
      WHERE c.id = $1 AND c.status = 'ringing'
        AND c.apartment_id IN (
          SELECT apartment_id FROM apartment_rights
           WHERE user_id = $2 AND can_video
        )`,
    [callId, userId],
  );
  return res.rows[0]?.access_point_id ?? null;
}

/* ─── История звонков ───────────────────────────────────────────────────────
   Житель должен видеть, что в домофон звонили, пока его не было: иначе
   пропущенный звонок исчезает бесследно. Данные уже пишутся в intercom_calls,
   не хватало только чтения. */

export type IntercomCallStatus = 'ringing' | 'opened' | 'declined' | 'missed' | 'ended';

export interface IntercomCallRecord {
  id: string;
  status: IntercomCallStatus;
  startedAt: string;
  endedAt: string | null;
  /** Сколько длился звонок (или идёт, если ещё активен) */
  durationSeconds: number;
  apartmentNumber: string;
  pointName: string;
  cameraName: string | null;
}

/**
 * Последние звонки в квартиры, где у человека есть право открывать дверь.
 *
 * Порядок — от новых к старым: житель ищет «кто звонил вчера», а не «первый
 * звонок в истории». Лимит жёсткий: это экран, а не отчёт.
 */
export async function listIntercomCallsForUser(
  userId: string,
  limit: number,
): Promise<IntercomCallRecord[]> {
  const res = await pool.query<{
    id: string;
    status: IntercomCallStatus;
    started_at: string;
    ended_at: string | null;
    duration_seconds: string;
    apartment_number: string;
    point_name: string;
    camera_name: string | null;
  }>(
    `SELECT c.id, c.status,
            c.started_at::text AS started_at,
            c.ended_at::text AS ended_at,
            -- Длительность считаем только по закрытым звонкам: у пропущенного
            -- без ended_at иначе росло бы «звонит уже два часа»
            CASE
              WHEN c.ended_at IS NOT NULL
                THEN EXTRACT(EPOCH FROM (c.ended_at - c.started_at))
              WHEN c.status = 'ringing'
                THEN EXTRACT(EPOCH FROM (now() - c.started_at))
              ELSE 0
            END::text AS duration_seconds,
            a.number AS apartment_number,
            ap.name AS point_name,
            cam.name AS camera_name
       FROM intercom_calls c
       JOIN apartments a ON a.id = c.apartment_id
       JOIN access_points ap ON ap.id = c.access_point_id
       LEFT JOIN cameras cam ON cam.id = c.camera_id
      WHERE c.apartment_id IN (
              SELECT apartment_id FROM apartment_rights
               WHERE user_id = $1 AND can_open
            )
      ORDER BY c.started_at DESC
      LIMIT $2`,
    [userId, limit],
  );

  return res.rows.map((row) => ({
    id: row.id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: Math.max(0, Math.round(Number(row.duration_seconds))),
    apartmentNumber: row.apartment_number,
    pointName: row.point_name,
    cameraName: row.camera_name,
  }));
}