-- ============================================================================
-- 025_owners.sql
-- Собственники и доли владения.
--
-- Физическое лицо отделено от учётной записи: собственник может быть
-- заведён УК без пользователя в приложении. Привязка пользователя к
-- квартире (resident_bindings) остаётся отдельным механизмом доступа.
-- ============================================================================

CREATE TABLE IF NOT EXISTS owners (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  full_name   text        NOT NULL CHECK (length(trim(full_name)) BETWEEN 2 AND 200),
  phone       text,
  email       text,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

COMMENT ON TABLE owners IS
  'Физические лица — собственники и представители. Не являются учётными записями.';

CREATE INDEX IF NOT EXISTS owners_tenant_name_idx
  ON owners (tenant_id, full_name) WHERE deleted_at IS NULL;

CREATE TRIGGER owners_set_updated_at
  BEFORE UPDATE ON owners
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS ownerships (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  apartment_id   uuid        NOT NULL REFERENCES apartments(id) ON DELETE RESTRICT,
  owner_id       uuid        NOT NULL REFERENCES owners(id) ON DELETE RESTRICT,
  role           text        NOT NULL DEFAULT 'owner'
                             CHECK (role IN ('owner', 'representative')),
  share_percent  numeric(5, 2) NOT NULL DEFAULT 100
                             CHECK (share_percent > 0 AND share_percent <= 100),
  valid_from     date        NOT NULL DEFAULT CURRENT_DATE,
  valid_to       date,
  created_by     uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  CONSTRAINT ownerships_dates_check CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

COMMENT ON TABLE ownerships IS
  'Право собственника на помещение: роль, доля и период. Одна активная запись на пару квартира+собственник.';

CREATE UNIQUE INDEX IF NOT EXISTS ownerships_active_unique
  ON ownerships (apartment_id, owner_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ownerships_tenant_apartment_idx
  ON ownerships (tenant_id, apartment_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ownerships_tenant_owner_idx
  ON ownerships (tenant_id, owner_id) WHERE deleted_at IS NULL;

CREATE TRIGGER ownerships_set_updated_at
  BEFORE UPDATE ON ownerships
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
