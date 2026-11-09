-- ============================================================================
-- 006_notifications_news.sql
-- Уведомления (внутрисистемные) и новости/объявления.
--
-- Источник: docs/DB-SCHEMA.md, раздел 5.4
-- ============================================================================

-- ─── Уведомления ────────────────────────────────────────────────────────────
CREATE TABLE notifications (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL для платформенных уведомлений (не привязанных к УК)
  tenant_id   uuid        REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        text        NOT NULL
                          CHECK (type IN (
                            'ticket_created',
                            'ticket_status_changed',
                            'ticket_assigned',
                            'ticket_comment',
                            'resident_binding_confirmed',
                            'resident_binding_rejected',
                            'news_published'
                          )),
  title       text        NOT NULL,
  body        text,
  entity_type text        CHECK (entity_type IN ('ticket', 'news', 'resident_binding')),
  entity_id   uuid,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE notifications IS
  'Внутрисистемные уведомления. read_at = NULL означает непрочитанное.';

-- Счётчик непрочитанных для колокольчика: частичный индекс, очень быстрый
CREATE INDEX notifications_unread_idx
  ON notifications (user_id) WHERE read_at IS NULL;
CREATE INDEX notifications_user_created_idx
  ON notifications (user_id, created_at DESC);
-- Для фоновой очистки старых уведомлений
CREATE INDEX notifications_created_idx ON notifications (created_at);

-- ─── Новости и объявления ───────────────────────────────────────────────────
CREATE TABLE news (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  -- tenant  — объявление всей УК
  -- complex — объявление жилого комплекса
  -- building— объявление конкретного дома
  scope        text        NOT NULL CHECK (scope IN ('tenant', 'complex', 'building')),
  complex_id   uuid        REFERENCES residential_complexes(id) ON DELETE RESTRICT,
  building_id  uuid        REFERENCES buildings(id) ON DELETE RESTRICT,
  title        text        NOT NULL CHECK (length(trim(title)) > 0),
  body         text        NOT NULL CHECK (length(trim(body)) > 0),
  -- Экстренное объявление: показывается баннером, не тонет в ленте
  is_emergency boolean     NOT NULL DEFAULT false,
  -- NULL = черновик, не виден жителям
  published_at timestamptz,
  published_by uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  -- Уровень объявления должен соответствовать заполненным ссылкам
  CONSTRAINT news_scope_matches_targets CHECK (
    (scope = 'tenant'   AND complex_id IS NULL     AND building_id IS NULL) OR
    (scope = 'complex'  AND complex_id IS NOT NULL AND building_id IS NULL) OR
    (scope = 'building' AND building_id IS NOT NULL)
  )
);

COMMENT ON TABLE news IS
  'Новости и объявления. scope определяет аудиторию: вся УК, ЖК или конкретный дом.';
COMMENT ON COLUMN news.published_at IS 'NULL — черновик. Заполняется при публикации.';

CREATE INDEX news_tenant_published_idx
  ON news (tenant_id, published_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX news_building_published_idx
  ON news (tenant_id, building_id, published_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX news_complex_published_idx
  ON news (tenant_id, complex_id, published_at DESC) WHERE deleted_at IS NULL;

CREATE TRIGGER news_set_updated_at
  BEFORE UPDATE ON news
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
