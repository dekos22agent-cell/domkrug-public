-- ============================================================================
-- 027_documents.sql
-- Реестр документов УК для жителей.
--
-- Пока это ссылки на документы (PDF, страницы), без загрузки файлов:
-- биллинг и квитанции ещё не подключены. Одна запись — один документ,
-- опубликованный для всей УК или конкретного дома.
-- ============================================================================

CREATE TABLE IF NOT EXISTS documents (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  -- NULL — документ всей УК; иначе — конкретный дом
  building_id  uuid        REFERENCES buildings(id) ON DELETE RESTRICT,
  title        text        NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 200),
  description  text,
  category     text        NOT NULL DEFAULT 'other'
                           CHECK (category IN ('house', 'apartment', 'receipt', 'other')),
  url          text        NOT NULL CHECK (url ~ '^https?://'),
  published_at timestamptz,
  created_by   uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

COMMENT ON TABLE documents IS
  'Документы УК: ссылки на PDF/страницы. NULL building_id — для всей УК.';

CREATE INDEX IF NOT EXISTS documents_tenant_published_idx
  ON documents (tenant_id, published_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS documents_tenant_building_idx
  ON documents (tenant_id, building_id) WHERE deleted_at IS NULL;

CREATE TRIGGER documents_set_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
