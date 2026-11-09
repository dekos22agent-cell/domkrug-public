-- ============================================================================
-- 013_utilities.sql
-- Счётчики, лифты, экстренные сообщения и вызовы.
--
-- Три независимых блока в одной миграции: они появляются вместе на витрине,
-- но данные у них разные и связи между собой нет.
--
-- Общее правило для всех трёх: житель видит только то, что относится к его
-- подтверждённым привязкам. Право проверяется на сервере, а не в интерфейсе.
-- ============================================================================

-- ─── Счётчики ──────────────────────────────────────────────────────────────
CREATE TABLE meters (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  apartment_id     uuid NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,

  kind             text NOT NULL CHECK (kind IN ('cold_water', 'hot_water', 'electricity', 'heat', 'gas')),
  serial           text,
  unit             text NOT NULL,
  -- Дата следующей поверки: по ней видно, когда показания перестанут приниматься
  verification_due date,

  is_active        boolean NOT NULL DEFAULT true,
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX meters_apartment_idx ON meters (apartment_id);
CREATE INDEX meters_tenant_idx ON meters (tenant_id, is_active);

COMMENT ON TABLE meters IS
  'Счётчики квартиры. Показания принимаются раз в месяц, за прошлый и текущий период.';

CREATE TABLE meter_readings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meter_id    uuid NOT NULL REFERENCES meters(id) ON DELETE CASCADE,

  -- Первое число месяца: 2026-11-01 — показания за ноябрь
  period      date NOT NULL,
  value       numeric(12, 3) NOT NULL CHECK (value >= 0),

  source      text NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'staff', 'import')),
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  -- Один прибор — одно показание за период. Повторная передача исправляет
  -- значение, а не создаёт вторую запись.
  UNIQUE (meter_id, period)
);

CREATE INDEX meter_readings_meter_idx ON meter_readings (meter_id, period DESC);

COMMENT ON TABLE meter_readings IS
  'Показания счётчиков. Повторная передача за тот же период обновляет значение.';

-- ─── Лифты ─────────────────────────────────────────────────────────────────
CREATE TABLE lifts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  building_id     uuid NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  entrance_id     uuid REFERENCES entrances(id) ON DELETE SET NULL,

  number          text NOT NULL,
  status          text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'maintenance', 'fault')),
  service_org     text,
  last_service_at date,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX lifts_building_idx ON lifts (building_id);

COMMENT ON TABLE lifts IS
  'Лифты дома. Вызов и сообщение о неисправности — события, статус меняет УК.';

CREATE TABLE lift_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lift_id    uuid NOT NULL REFERENCES lifts(id) ON DELETE CASCADE,

  kind       text NOT NULL CHECK (kind IN ('call', 'fault', 'repair')),
  note       text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX lift_events_lift_idx ON lift_events (lift_id, created_at DESC);

COMMENT ON TABLE lift_events IS
  'Вызовы лифта и сообщения о неисправностях. Журнал нужен и жителю, и УК.';

-- ─── Экстренные сообщения и вызовы ─────────────────────────────────────────
CREATE TABLE emergency_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- NULL = сообщение по всей УК, иначе — по конкретному дому
  building_id  uuid REFERENCES buildings(id) ON DELETE CASCADE,

  title        text NOT NULL,
  body         text NOT NULL,
  severity     text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),

  published_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX emergency_messages_tenant_idx ON emergency_messages (tenant_id, published_at DESC);
CREATE INDEX emergency_messages_building_idx ON emergency_messages (building_id);

COMMENT ON TABLE emergency_messages IS
  'Экстренные сообщения УК. Показываются всем жителям УК или конкретного дома.';

CREATE TABLE emergency_calls (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  apartment_id  uuid REFERENCES apartments(id) ON DELETE SET NULL,

  -- uk_duty — аварийная служба УК; остальное — экстренные службы
  kind          text NOT NULL CHECK (kind IN ('uk_duty', 'police', 'ambulance', 'fire', 'gas')),
  status        text NOT NULL DEFAULT 'requested'
                  CHECK (status IN ('requested', 'accepted', 'cancelled')),

  location_note text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  accepted_at   timestamptz
);

CREATE INDEX emergency_calls_user_idx ON emergency_calls (user_id, created_at DESC);
CREATE INDEX emergency_calls_tenant_idx ON emergency_calls (tenant_id, status);

COMMENT ON TABLE emergency_calls IS
  'Экстренные вызовы из приложения. Журнал обязателен: по нему разбирают, кто и когда вызывал.';
