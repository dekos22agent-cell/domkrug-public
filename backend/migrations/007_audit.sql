-- ============================================================================
-- 007_audit.sql
-- Журнал критических действий платформы.
--
-- Принципы:
--   1. Только INSERT. UPDATE и DELETE запрещены триггером.
--   2. Пишем закрытый список действий (~20), а не «всё подряд».
--      Журнал просмотров превращается в гигабайты и становится бесполезным.
--   3. Пароли, токены и содержимое файлов в before/after НЕ попадают никогда.
--
-- Источник: docs/DB-SCHEMA.md, раздел 5.4; ТЗ п. 6 и п. 7
-- ============================================================================

CREATE TABLE audit_log (
  -- bigserial, не uuid: таблица растёт быстрее всех, bigserial дешевле по
  -- размеру индекса и понятнее при чтении человеком
  id            bigserial   PRIMARY KEY,
  -- NULL для действий вне УК (например, создание УК платформой)
  tenant_id     uuid        REFERENCES tenants(id) ON DELETE SET NULL,
  -- NULL для системных действий
  actor_user_id uuid        REFERENCES users(id) ON DELETE SET NULL,
  actor_ip      inet,
  -- Формат: <сущность>.<действие>. Закрытый список — в комментарии ниже.
  action        text        NOT NULL CHECK (action ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  entity_type   text,
  entity_id     uuid,
  -- Снимок критичных полей до и после изменения
  before        jsonb,
  after         jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE audit_log IS
  'Журнал критических действий. Append-only: UPDATE и DELETE запрещены триггером.';
COMMENT ON COLUMN audit_log.action IS
  'Закрытый список: auth.login, auth.logout, auth.password_change, auth.failed, ticket.create, ticket.status_change, ticket.assign, ticket.delete, resident.confirm, resident.reject, building.create, building.update, apartment.create, apartment.update, apartment.delete, staff.create, staff.deactivate, user.block, user.unblock, tenant.create, tenant.suspend, news.publish, news.delete.';
COMMENT ON COLUMN audit_log.before IS
  'JSON-снимок полей до изменения. Пароли, токены и содержимое файлов сюда не пишутся.';

-- Основные выборки: что происходило в УК, по конкретному объекту, кем
CREATE INDEX audit_tenant_created_idx ON audit_log (tenant_id, created_at DESC);
CREATE INDEX audit_entity_idx ON audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_actor_idx ON audit_log (actor_user_id, created_at DESC);
CREATE INDEX audit_action_idx ON audit_log (action, created_at DESC);

-- ─── Append-only ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION forbid_audit_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Журнал аудита изменять нельзя: он должен оставаться достоверным'
    USING HINT = 'Для исправления ошибочного действия добавьте новую запись.';
END;
$$;

CREATE TRIGGER audit_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_change();
