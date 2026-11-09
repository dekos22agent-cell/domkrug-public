-- ============================================================================
-- 003_users_tenancy.sql
-- Пользователи, назначение ролей, сотрудники УК, привязка жителей к квартирам.
--
-- Ключевое архитектурное решение: users НЕ привязаны к УК.
-- Человек может быть жителем одной УК и сотрудником другой — это реальность,
-- а не теоретический случай (сантехник живёт в доме, который обслуживает).
-- Принадлежность выражается через staff, user_roles.tenant_id,
-- resident_bindings.tenant_id.
--
-- Источник: docs/DB-SCHEMA.md, раздел 5.2; docs/RBAC.md
-- ============================================================================

-- ─── Пользователи ───────────────────────────────────────────────────────────
CREATE TABLE users (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email             citext,
  -- Нормализуется приложением до +7XXXXXXXXXX
  phone             text        CHECK (phone IS NULL OR phone ~ '^\+7\d{10}$'),
  -- Argon2id: хеш всегда, даже для демо-пользователей
  password_hash     text        NOT NULL,
  full_name         text        NOT NULL CHECK (length(trim(full_name)) > 1),
  status            text        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'blocked', 'deleted')),
  email_verified_at timestamptz,
  phone_verified_at timestamptz,
  last_login_at     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  -- Должен быть хотя бы один способ связи
  CONSTRAINT users_contact_required CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

COMMENT ON TABLE users IS
  'Пользователи платформы. НЕ привязаны к УК: один человек может быть жителем одной УК и сотрудником другой.';
COMMENT ON COLUMN users.status IS 'blocked — доступ закрыт, но данные сохраняются. deleted — по запросу субъекта ПДн (152-ФЗ), ФИО и телефон анонимизируются.';

CREATE UNIQUE INDEX users_email_unique
  ON users (email) WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX users_phone_unique
  ON users (phone) WHERE phone IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX users_status_idx ON users (status) WHERE deleted_at IS NULL;

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Назначенные роли ───────────────────────────────────────────────────────
CREATE TABLE user_roles (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role_id    uuid        NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  -- NULL = глобальная роль (platform_admin, resident).
  -- Для ролей УК (dispatcher, executor, uk_admin, uk_manager) обязателен.
  tenant_id  uuid        REFERENCES tenants(id) ON DELETE RESTRICT,
  granted_by uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE user_roles IS
  'Роли пользователя. tenant_id = NULL означает глобальную роль; для ролей УК обязан быть задан.';

-- NULLS NOT DISTINCT: без этого можно было бы дважды выдать глобальную роль
CREATE UNIQUE INDEX user_roles_unique
  ON user_roles (user_id, role_id, tenant_id) NULLS NOT DISTINCT;

CREATE INDEX user_roles_tenant_role_idx ON user_roles (tenant_id, role_id);

-- Роль УК без tenant_id — ошибка конфигурации, а не «глобальная роль»
CREATE OR REPLACE FUNCTION enforce_role_requires_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  role_code text;
BEGIN
  SELECT code INTO role_code FROM roles WHERE id = NEW.role_id;
  IF role_code IN ('uk_admin', 'uk_manager', 'dispatcher', 'executor')
     AND NEW.tenant_id IS NULL THEN
    RAISE EXCEPTION 'Роль "%" требует указания tenant_id', role_code
      USING HINT = 'Роли УК назначаются в рамках конкретной управляющей компании.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_roles_enforce_tenant
  BEFORE INSERT OR UPDATE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION enforce_role_requires_tenant();

-- ─── Сотрудники УК ──────────────────────────────────────────────────────────
CREATE TABLE staff (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  position   text,
  is_active  boolean     NOT NULL DEFAULT true,
  hired_at   date,
  fired_at   date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_fired_after_hired CHECK (
    fired_at IS NULL OR hired_at IS NULL OR fired_at >= hired_at
  )
);

COMMENT ON TABLE staff IS
  'Трудовые записи сотрудников УК. Отдельно от user_roles: роль — это право, сотрудник — факт трудовых отношений. Уволенный не удаляется, иначе пропадёт история его заявок.';

CREATE UNIQUE INDEX staff_tenant_user_unique ON staff (tenant_id, user_id);
CREATE INDEX staff_tenant_active_idx ON staff (tenant_id, is_active);

CREATE TRIGGER staff_set_updated_at
  BEFORE UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Привязка жителя к квартире ─────────────────────────────────────────────
CREATE TABLE resident_bindings (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Денормализация: выводится из дома квартиры, хранится для изоляции одним условием
  tenant_id         uuid        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id           uuid        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  apartment_id      uuid        NOT NULL REFERENCES apartments(id) ON DELETE RESTRICT,
  -- owner — собственник, renter — арендатор, representative — представитель по доверенности
  role_in_apartment text        NOT NULL DEFAULT 'owner'
                                CHECK (role_in_apartment IN ('owner', 'renter', 'representative')),
  status            text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'confirmed', 'rejected')),
  reject_reason     text,
  requested_at      timestamptz NOT NULL DEFAULT now(),
  confirmed_by      uuid        REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- Отклонение без причины бесполезно: житель не поймёт, что исправить
  CONSTRAINT binding_reject_has_reason CHECK (
    status <> 'rejected' OR (reject_reason IS NOT NULL AND length(trim(reject_reason)) > 0)
  ),
  -- Подтверждение всегда имеет автора и время
  CONSTRAINT binding_confirm_has_author CHECK (
    status <> 'confirmed' OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)
  )
);

COMMENT ON TABLE resident_bindings IS
  'Связь житель ↔ квартира (многие-ко-многим). Один житель может владеть несколькими квартирами; на одну квартиру бывает несколько жителей (собственник, супруг, арендатор).';
COMMENT ON COLUMN resident_bindings.status IS
  'pending — заявка подана, ждёт проверки УК. До confirmed житель НЕ может создавать заявки (решено 02.11.2026).';

CREATE UNIQUE INDEX resident_bindings_user_apartment_unique
  ON resident_bindings (user_id, apartment_id);
CREATE INDEX resident_bindings_tenant_status_idx ON resident_bindings (tenant_id, status);
CREATE INDEX resident_bindings_apartment_idx ON resident_bindings (apartment_id);
CREATE INDEX resident_bindings_user_idx ON resident_bindings (user_id);

CREATE TRIGGER resident_bindings_set_updated_at
  BEFORE UPDATE ON resident_bindings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
