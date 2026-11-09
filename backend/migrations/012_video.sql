-- ============================================================================
-- 012_video.sql
-- Камеры и видеозвонки с вызывной панели.
--
-- Что решаем:
--   1. Житель смотрит камеры своего дома — и только те, что ему разрешены.
--   2. Когда звонят в калитку или подъезд, у жителя появляется картинка
--      с вызывной панели и кнопки «открыть» / «отклонить».
--
-- Почему отдельная таблица, а не поле в access_points: у одной точки может
-- быть несколько камер (вызывная панель + обзорная), а у камеры может не быть
-- точки вовсе (обзор двора). Связь многие-ко-многим здесь честнее.
--
-- Потоки: реальный RTSP браузер не воспроизводит. Поэтому храним тип потока
-- (hls / webrtc / sip / demo) и адрес. Пока тип demo — плеер показывает
-- заглушку, а не выдуманное видео.
-- ============================================================================

CREATE TABLE cameras (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  building_id     uuid NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  -- Камера вызывной панели привязана к точке доступа; обзорная может быть без
  access_point_id uuid REFERENCES access_points(id) ON DELETE SET NULL,

  kind            text NOT NULL CHECK (kind IN ('overview', 'call_panel', 'barrier', 'parking')),
  name            text NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  sort_order      integer NOT NULL DEFAULT 0,

  stream_type     text NOT NULL DEFAULT 'demo' CHECK (stream_type IN ('demo', 'hls', 'webrtc', 'sip')),
  stream_url      text,
  poster_url      text,

  provider        text NOT NULL DEFAULT 'mock',
  provider_ref    text,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cameras_tenant_idx ON cameras (tenant_id, is_active);
CREATE INDEX cameras_building_idx ON cameras (building_id);
CREATE INDEX cameras_point_idx ON cameras (access_point_id);

COMMENT ON TABLE cameras IS
  'Камеры дома. stream_type=rtsp не поддерживается браузером, поэтому храним hls/webrtc/sip либо demo.';

-- Кому камера доступна. Как и с точками доступа — выдаём квартире.
CREATE TABLE camera_grants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  camera_id    uuid NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  apartment_id uuid NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  UNIQUE (camera_id, apartment_id)
);

CREATE INDEX camera_grants_apartment_idx ON camera_grants (apartment_id);

COMMENT ON TABLE camera_grants IS
  'Каким квартирам доступна камера. Право жителя выводится из подтверждённой привязки.';

-- ─── Звонки с вызывной панели ──────────────────────────────────────────────
CREATE TABLE intercom_calls (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  access_point_id uuid NOT NULL REFERENCES access_points(id) ON DELETE CASCADE,
  camera_id       uuid REFERENCES cameras(id) ON DELETE SET NULL,
  apartment_id    uuid NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,

  status          text NOT NULL DEFAULT 'ringing'
                    CHECK (status IN ('ringing', 'opened', 'declined', 'missed', 'ended')),
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,

  UNIQUE (access_point_id, apartment_id, started_at)
);

CREATE INDEX intercom_calls_apartment_idx ON intercom_calls (apartment_id, started_at DESC);
CREATE INDEX intercom_calls_ringing_idx ON intercom_calls (status) WHERE status = 'ringing';

COMMENT ON TABLE intercom_calls IS
  'Звонки в домофон: кто в какую квартиру звонил, чем закончилось. Журнал нужен и жителю, и УК при разборе спорных ситуаций.';
