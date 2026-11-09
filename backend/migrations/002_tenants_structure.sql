-- ============================================================================
-- 002_tenants_structure.sql
-- Управляющие компании и структура домов:
-- tenants → residential_complexes → buildings → entrances → floors → apartments
--
-- Изоляция: tenant_id на каждой бизнес-таблице. Дублируется (денормализация)
-- сознательно — чтобы проверка доступа была одним условием, а не джойном
-- по трём уровням.
--
-- Источник: docs/DB-SCHEMA.md, раздел 5.1
-- ============================================================================

-- ─── Управляющие компании (тенант) ──────────────────────────────────────────
CREATE TABLE tenants (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Полное название, как в документах УК
  name          text        NOT NULL CHECK (length(trim(name)) > 1),
  -- Короткий идентификатор для поддомена и логов: domkrug.ru/<slug>
  slug          text        NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$'),
  inn           text        CHECK (inn IS NULL OR inn ~ '^\d{10}(\d{2})?$'),
  contact_email citext,
  contact_phone text,
  status        text        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'suspended', 'archived')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

COMMENT ON TABLE tenants IS
  'Управляющие компании. Корень изоляции данных: всё остальное принадлежит одной УК.';
COMMENT ON COLUMN tenants.slug IS 'Короткий идентификатор для URL и логов. Только строчная латиница, цифры, дефис.';
COMMENT ON COLUMN tenants.status IS 'archived — УК больше не обслуживается, данные сохраняются. Физическое удаление запрещено.';

-- ИНН уникален среди неудалённых: две УК не могут иметь один ИНН
CREATE UNIQUE INDEX tenants_inn_unique ON tenants (inn) WHERE inn IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX tenants_status_idx ON tenants (status) WHERE deleted_at IS NULL;

CREATE TRIGGER tenants_set_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Жилые комплексы ────────────────────────────────────────────────────────
CREATE TABLE residential_complexes (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name         text        NOT NULL CHECK (length(trim(name)) > 0),
  address_text text,
  status       text        NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'archived')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

COMMENT ON TABLE residential_complexes IS
  'Жилые комплексы. Необязательный уровень: дом может существовать без ЖК (отдельный дом).';

CREATE UNIQUE INDEX complexes_tenant_name_unique
  ON residential_complexes (tenant_id, name) WHERE deleted_at IS NULL;
CREATE INDEX complexes_tenant_status_idx ON residential_complexes (tenant_id, status);

CREATE TRIGGER complexes_set_updated_at
  BEFORE UPDATE ON residential_complexes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Многоквартирные дома ───────────────────────────────────────────────────
CREATE TABLE buildings (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  -- Дом может быть без ЖК — поэтому NULL допустим
  complex_id       uuid        REFERENCES residential_complexes(id) ON DELETE RESTRICT,
  city             text        NOT NULL CHECK (length(trim(city)) > 0),
  street           text        NOT NULL CHECK (length(trim(street)) > 0),
  -- text, а не int: бывает «12А», «5/1»
  house_number     text        NOT NULL CHECK (length(trim(house_number)) > 0),
  building_number  text,
  postal_code      text        CHECK (postal_code IS NULL OR postal_code ~ '^\d{6}$'),
  -- Полный адрес одной строкой: для отображения и поиска
  address_text     text        NOT NULL,
  total_entrances  integer     CHECK (total_entrances IS NULL OR total_entrances > 0),
  total_floors     integer     CHECK (total_floors IS NULL OR total_floors > 0),
  year_built       integer     CHECK (year_built IS NULL OR (year_built BETWEEN 1700 AND 2100)),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

COMMENT ON TABLE buildings IS
  'Многоквартирные дома. address_text обязателен: по нему ищет диспетчер и житель.';

-- Один и тот же адрес нельзя завести дважды в рамках одной УК
CREATE UNIQUE INDEX buildings_tenant_address_unique
  ON buildings (tenant_id, city, street, house_number, COALESCE(building_number, ''))
  WHERE deleted_at IS NULL;

CREATE INDEX buildings_tenant_complex_idx ON buildings (tenant_id, complex_id);
CREATE INDEX buildings_tenant_city_street_idx ON buildings (tenant_id, city, street);

CREATE TRIGGER buildings_set_updated_at
  BEFORE UPDATE ON buildings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Подъезды ───────────────────────────────────────────────────────────────
CREATE TABLE entrances (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  building_id uuid        NOT NULL REFERENCES buildings(id) ON DELETE RESTRICT,
  number      integer     NOT NULL CHECK (number > 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX entrances_building_number_unique ON entrances (building_id, number);
CREATE INDEX entrances_tenant_idx ON entrances (tenant_id);

CREATE TRIGGER entrances_set_updated_at
  BEFORE UPDATE ON entrances
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Этажи ──────────────────────────────────────────────────────────────────
CREATE TABLE floors (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  entrance_id uuid        NOT NULL REFERENCES entrances(id) ON DELETE RESTRICT,
  -- Может быть отрицательным (подземный уровень)
  number      integer     NOT NULL CHECK (number <> 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE floors IS
  'Этажи. Самая спорная сущность из ТЗ: для заявок важен номер квартиры, а не этаж. Оставлена по требованию ТЗ, кандидат на удаление в v2, если не используется.';

CREATE UNIQUE INDEX floors_entrance_number_unique ON floors (entrance_id, number);
CREATE INDEX floors_tenant_idx ON floors (tenant_id);

CREATE TRIGGER floors_set_updated_at
  BEFORE UPDATE ON floors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Квартиры и помещения ───────────────────────────────────────────────────
CREATE TABLE apartments (
  id          uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid           NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  building_id uuid           NOT NULL REFERENCES buildings(id) ON DELETE RESTRICT,
  -- Может быть не указан при массовом импорте из старых баз УК
  entrance_id uuid           REFERENCES entrances(id) ON DELETE RESTRICT,
  floor_id    uuid           REFERENCES floors(id) ON DELETE RESTRICT,
  -- text: «42», «42А», «12/3»
  number      text           NOT NULL CHECK (length(trim(number)) > 0),
  kind        text           NOT NULL DEFAULT 'apartment'
                             CHECK (kind IN ('apartment', 'nonresidential')),
  rooms       integer        CHECK (rooms IS NULL OR rooms BETWEEN 0 AND 20),
  area_total  numeric(10, 2) CHECK (area_total IS NULL OR area_total > 0),
  status      text           NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'archived')),
  created_at  timestamptz    NOT NULL DEFAULT now(),
  updated_at  timestamptz    NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

COMMENT ON TABLE apartments IS
  'Квартиры и нежилые помещения. number — text, потому что бывают «12А» и «5/1».';
COMMENT ON COLUMN apartments.kind IS 'nonresidential — магазины, офисы на первых этажах, кладовки. Заявки по ним тоже возможны.';

CREATE UNIQUE INDEX apartments_building_number_unique
  ON apartments (building_id, number) WHERE deleted_at IS NULL;
CREATE INDEX apartments_tenant_building_idx ON apartments (tenant_id, building_id);
CREATE INDEX apartments_tenant_entrance_idx ON apartments (tenant_id, entrance_id);

CREATE TRIGGER apartments_set_updated_at
  BEFORE UPDATE ON apartments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
