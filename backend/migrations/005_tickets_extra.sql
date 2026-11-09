-- ============================================================================
-- 005_tickets_extra.sql
-- Обсуждение заявки и файлы.
--
-- Файлы хранятся ТОЛЬКО в S3: в базе лежит ключ объекта, а не сам файл и не
-- публичный URL. Выдача клиенту — через подписанную ссылку с коротким TTL.
--
-- Источник: docs/DB-SCHEMA.md, раздел 5.3
-- ============================================================================

-- ─── Комментарии к заявке ───────────────────────────────────────────────────
CREATE TABLE ticket_comments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  ticket_id   uuid        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id   uuid        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body        text        NOT NULL CHECK (length(trim(body)) > 0),
  -- Служебный комментарий: житель его не видит.
  -- Нужен для «нужен доступ в квартиру, собственник не отвечает».
  is_internal boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

COMMENT ON TABLE ticket_comments IS
  'Комментарии к заявке. is_internal = true скрывает комментарий от жителя.';
COMMENT ON COLUMN ticket_comments.is_internal IS
  'Служебный комментарий сотрудников УК. Житель не видит его ни в списке, ни в детали.';

CREATE INDEX comments_ticket_created_idx ON ticket_comments (ticket_id, created_at ASC);
CREATE INDEX comments_tenant_author_idx ON ticket_comments (tenant_id, author_id);

CREATE TRIGGER comments_set_updated_at
  BEFORE UPDATE ON ticket_comments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Вложения ───────────────────────────────────────────────────────────────
CREATE TABLE attachments (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  ticket_id     uuid        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  -- Файл может быть приложен к комментарию, а не к заявке напрямую
  comment_id    uuid        REFERENCES ticket_comments(id) ON DELETE SET NULL,
  kind          text        NOT NULL
                            CHECK (kind IN ('request_photo', 'result_photo', 'comment_file', 'document')),
  -- Ключ объекта в S3. НЕ публичный URL.
  storage_key   text        NOT NULL UNIQUE,
  original_name text        NOT NULL,
  -- Проверяется по магии байтов при загрузке, не по расширению
  mime_type     text        NOT NULL CHECK (
                              mime_type IN ('image/jpeg', 'image/png', 'image/webp',
                                            'video/mp4', 'application/pdf')
                            ),
  size_bytes    bigint      NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 52428800),
  uploaded_by   uuid        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

COMMENT ON TABLE attachments IS
  'Вложения заявки. Сам файл лежит в S3; здесь — метаданные и ключ объекта.';
COMMENT ON COLUMN attachments.storage_key IS
  'Ключ объекта в S3. Клиенту не отдаётся: доступ только через подписанный URL с TTL 5 минут.';
COMMENT ON COLUMN attachments.mime_type IS
  'Белый список типов. Видео — до 50 МБ, задаётся ограничением size_bytes.';

CREATE INDEX attachments_ticket_idx ON attachments (ticket_id, created_at);
CREATE INDEX attachments_tenant_kind_idx ON attachments (tenant_id, kind);

-- Закрытие заявки требует фото результата (правило из API-CONTRACT.md).
-- Проверка на уровне приложения: здесь только фиксируем данные.
