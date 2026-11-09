-- ============================================================================
-- 024_object_passport.sql
-- Объектная модель: тип объекта + паспорт дома.
--
-- Первый шаг без финансов. buildings остаётся физическим объектом, но
-- получает object_kind: сейчас основной сценарий — МКД, дальше — посёлок,
-- смешанный объект или нежилое здание. Паспорт хранит только паспортные
-- данные; площади, годы и этажность домов не дублируются без необходимости.
-- ============================================================================

ALTER TABLE buildings
  ADD COLUMN IF NOT EXISTS object_kind text NOT NULL DEFAULT 'apartment_building';

-- Отдельный DO-блок: ADD CONSTRAINT IF NOT EXISTS в PostgreSQL нет.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'buildings_object_kind_check'
       AND conrelid = 'buildings'::regclass
  ) THEN
    ALTER TABLE buildings
      ADD CONSTRAINT buildings_object_kind_check
      CHECK (object_kind IN (
        'apartment_building',
        'cottage_settlement',
        'mixed_use',
        'commercial_building'
      ));
  END IF;
END $$;

COMMENT ON COLUMN buildings.object_kind IS
  'Тип объекта управления: МКД, коттеджный посёлок, смешанный объект или нежилое здание.';

CREATE TABLE IF NOT EXISTS building_passports (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  building_id        uuid        NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  cadastral_number   text,
  year_commissioned  integer     CHECK (year_commissioned IS NULL OR year_commissioned BETWEEN 1700 AND 2100),
  total_area         numeric(12, 2) CHECK (total_area IS NULL OR total_area >= 0),
  living_area        numeric(12, 2) CHECK (living_area IS NULL OR living_area >= 0),
  commercial_area    numeric(12, 2) CHECK (commercial_area IS NULL OR commercial_area >= 0),
  land_area          numeric(12, 2) CHECK (land_area IS NULL OR land_area >= 0),
  parking_spots      integer     CHECK (parking_spots IS NULL OR parking_spots >= 0),
  elevators_count    integer     CHECK (elevators_count IS NULL OR elevators_count >= 0),
  energy_class       text        CHECK (energy_class IS NULL OR energy_class IN ('A+', 'A', 'B', 'C', 'D', 'E', 'F', 'G')),
  management_start   date,
  warranty_until     date,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT building_passports_building_unique UNIQUE (building_id),
  CONSTRAINT building_passports_tenant_building_unique UNIQUE (tenant_id, building_id)
);

COMMENT ON TABLE building_passports IS
  'Паспорт объекта: кадастровые, проектные и эксплуатационные данные. Один паспорт на объект.';
COMMENT ON COLUMN building_passports.energy_class IS
  'Класс энергоэффективности по шкале A+…G. NULL — ещё не указан.';

CREATE INDEX IF NOT EXISTS building_passports_tenant_idx
  ON building_passports (tenant_id);

CREATE TRIGGER building_passports_set_updated_at
  BEFORE UPDATE ON building_passports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
