-- ============================================================================
-- 011_access.sql
-- Точки доступа: подъездные двери, калитки, шлагбаумы.
--
-- Задача: житель открывает дверь или шлагбаум из приложения, а УК видит
-- журнал. Сейчас работает mock-провайдер (команда не уходит на железо),
-- но модель данных и контракт провайдера рассчитаны на реальные устройства.
--
-- Ключевое решение: доступ выдаётся НЕ человеку напрямую, а квартире.
-- Житель с подтверждённой привязкой получает доступ автоматически;
-- при отзыве привязки доступ исчезает сам. Это избавляет от отдельной
-- процедуры «отозвать пропуск у бывшего жильца».
-- ============================================================================

CREATE TABLE access_points (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  building_id   uuid NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  entrance_id   uuid REFERENCES entrances(id) ON DELETE SET NULL,

  kind          text NOT NULL CHECK (kind IN ('entrance_door', 'wicket', 'barrier', 'gate', 'parking')),
  name          text NOT NULL,
  instruction   text,
  sort_order    integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,

  -- Какой провайдер обслуживает точку: mock сейчас, конкретный вендор потом
  provider      text NOT NULL DEFAULT 'mock',
  provider_ref  text,

  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX access_points_tenant_idx ON access_points (tenant_id, is_active);
CREATE INDEX access_points_building_idx ON access_points (building_id);

COMMENT ON TABLE access_points IS
  'Точки доступа дома: подъездная дверь, калитка, шлагбаум. provider/provider_ref — каким устройством управляем.';

-- Доступ выдаётся квартире: все подтверждённые жители получают его автоматически
CREATE TABLE access_grants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_point_id uuid NOT NULL REFERENCES access_points(id) ON DELETE CASCADE,
  apartment_id    uuid NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  UNIQUE (access_point_id, apartment_id)
);

CREATE INDEX access_grants_apartment_idx ON access_grants (apartment_id);

COMMENT ON TABLE access_grants IS
  'Каким квартирам разрешена точка доступа. Право жителя выводится из подтверждённой привязки к квартире.';

-- Журнал: каждое нажатие, включая отказы
CREATE TABLE access_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  access_point_id uuid NOT NULL REFERENCES access_points(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  apartment_id    uuid REFERENCES apartments(id) ON DELETE SET NULL,

  action          text NOT NULL DEFAULT 'open' CHECK (action IN ('open')),
  result          text NOT NULL CHECK (result IN ('ok', 'denied', 'error')),
  source          text NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'widget', 'staff', 'auto')),
  detail          jsonb,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX access_events_user_idx ON access_events (user_id, created_at DESC);
CREATE INDEX access_events_point_idx ON access_events (access_point_id, created_at DESC);

COMMENT ON TABLE access_events IS
  'Журнал открытий и отказов. Отказы пишем тоже: по ним видно проблемы прав, а не только успешные нажатия.';
