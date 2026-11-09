-- ============================================================================
-- 004_tickets.sql
-- Ядро системы: категории заявок, счётчик номеров, заявки, история статусов,
-- назначения исполнителей.
--
-- Источник: docs/DB-SCHEMA.md, раздел 5.3; docs/RBAC.md; docs/API-CONTRACT.md
-- ============================================================================

-- ─── Категории заявок ───────────────────────────────────────────────────────
CREATE TABLE ticket_categories (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = системная категория, доступная всем УК.
  -- УК может добавить свои — они видны только ей.
  tenant_id          uuid        REFERENCES tenants(id) ON DELETE RESTRICT,
  code               text        NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  name               text        NOT NULL CHECK (length(trim(name)) > 0),
  -- Срок исполнения по умолчанию, часы. Ставится в tickets.sla_due_at
  default_sla_hours  integer     NOT NULL DEFAULT 24 CHECK (default_sla_hours > 0),
  -- Аварийная: красная метка в инбоксе, приоритетный SLA
  is_emergency       boolean     NOT NULL DEFAULT false,
  sort_order         integer     NOT NULL DEFAULT 100,
  is_active          boolean     NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE ticket_categories IS
  'Категории заявок. Системные (tenant_id = NULL) одинаковы для всех УК; УК может добавлять свои.';
COMMENT ON COLUMN ticket_categories.is_emergency IS
  'Аварийная категория: короткий SLA, красная метка. Аварийность ставит диспетчер, не житель.';

CREATE UNIQUE INDEX categories_system_code_unique
  ON ticket_categories (code) WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX categories_tenant_code_unique
  ON ticket_categories (tenant_id, code) WHERE tenant_id IS NOT NULL;
CREATE INDEX categories_tenant_active_idx
  ON ticket_categories (tenant_id, is_active, sort_order);

CREATE TRIGGER categories_set_updated_at
  BEFORE UPDATE ON ticket_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 12 категорий из ТЗ п. 4.2. Аварийные (is_emergency) — лифт, электрика, отопление.
INSERT INTO ticket_categories (code, name, default_sla_hours, is_emergency, sort_order) VALUES
  ('elevator',          'Лифтовое оборудование',                  4,  true,  10),
  ('electrical',        'Электроснабжение',                       8,  true,  20),
  ('heating',           'Отопление',                              8,  true,  30),
  ('water',             'Водоснабжение',                         24,  false, 40),
  ('sewerage',          'Канализация',                           24,  false, 50),
  ('plumbing',          'Сантехника',                            24,  false, 60),
  ('common_electrical', 'Электрика мест общего пользования',     24,  false, 70),
  ('security',          'Системы безопасности',                  24,  false, 80),
  ('intercom',          'Домофония',                             48,  false, 90),
  ('cleaning',          'Уборка',                                72,  false, 100),
  ('landscaping',       'Благоустройство',                      120,  false, 110),
  ('other',             'Другое',                                72,  false, 120);

-- ─── Счётчик номеров заявок (на УК) ─────────────────────────────────────────
CREATE TABLE ticket_numbers (
  tenant_id   uuid    PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  last_number integer NOT NULL DEFAULT 0 CHECK (last_number >= 0)
);

COMMENT ON TABLE ticket_numbers IS
  'Счётчик номеров заявок в рамках УК. Отдельная строка вместо MAX(number)+1: MAX даёт гонку при двух одновременных заявках.';

-- ─── Статус по умолчанию: «Новая» ───────────────────────────────────────────
-- Функция, а не константа: id статуса генерируется случайно в миграции 001.
CREATE OR REPLACE FUNCTION default_ticket_status_new()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT id FROM ticket_statuses WHERE code = 'new';
$$;

-- ─── Заявки ─────────────────────────────────────────────────────────────────
CREATE TABLE tickets (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  -- Сквозной номер внутри УК. Выдаётся из ticket_numbers.
  number          integer     NOT NULL CHECK (number > 0),
  building_id     uuid        NOT NULL REFERENCES buildings(id) ON DELETE RESTRICT,
  -- NULL допустим: заявка по месту общего пользования (подъезд, двор)
  apartment_id    uuid        REFERENCES apartments(id) ON DELETE RESTRICT,
  category_id     uuid        NOT NULL REFERENCES ticket_categories(id) ON DELETE RESTRICT,
  status_id       uuid        NOT NULL REFERENCES ticket_statuses(id) ON DELETE RESTRICT
                              DEFAULT default_ticket_status_new(),
  priority        text        NOT NULL DEFAULT 'normal'
                              CHECK (priority IN ('low', 'normal', 'high', 'emergency')),
  source          text        NOT NULL
                              CHECK (source IN ('resident_app', 'dispatcher_phone', 'dispatcher_walkin')),
  title           text,
  description     text        NOT NULL CHECK (length(trim(description)) > 0),
  -- Уточнение места для заявок по МОП: «подъезд 3, этаж 5, у лифта»
  location_note   text,
  contact_phone   text        NOT NULL CHECK (contact_phone ~ '^\+7\d{10}$'),
  contact_name    text,
  created_by      uuid        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_to     uuid        REFERENCES users(id) ON DELETE SET NULL,
  -- Повторное обращение: ссылка на исходную заявку
  parent_ticket_id uuid       REFERENCES tickets(id) ON DELETE SET NULL,
  sla_due_at      timestamptz,
  accepted_at     timestamptz,
  started_at      timestamptz,
  closed_at       timestamptz,
  closed_by       uuid        REFERENCES users(id) ON DELETE SET NULL,
  -- Обязателен при закрытии: житель не подтверждает работу (решение C),
  -- значит исполнитель обязан зафиксировать, что сделано
  resolution_note text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT tickets_parent_not_self CHECK (parent_ticket_id IS NULL OR parent_ticket_id <> id)
);

COMMENT ON TABLE tickets IS
  'Заявки. Ядро системы. Удаление только мягкое (deleted_at): история не должна исчезать.';
COMMENT ON COLUMN tickets.number IS 'Сквозной номер внутри УК: житель и диспетчер видят «№42».';
COMMENT ON COLUMN tickets.apartment_id IS 'NULL для заявок по местам общего пользования — тогда нужен location_note.';
COMMENT ON COLUMN tickets.parent_ticket_id IS 'Ссылка на исходную заявку при повторном обращении («проблема не решена»).';

CREATE UNIQUE INDEX tickets_tenant_number_unique ON tickets (tenant_id, number);

-- Главный экран диспетчера: инбокс по статусу, свежие сверху
CREATE INDEX tickets_tenant_status_created_idx
  ON tickets (tenant_id, status_id, created_at DESC);
-- «Мои заявки» исполнителя
CREATE INDEX tickets_tenant_assignee_status_idx
  ON tickets (tenant_id, assigned_to, status_id);
-- История по дому и квартире
CREATE INDEX tickets_tenant_building_idx ON tickets (tenant_id, building_id, created_at DESC);
CREATE INDEX tickets_tenant_apartment_idx ON tickets (tenant_id, apartment_id, created_at DESC);
-- Просрочки: частичный индекс — маленький и быстрый
CREATE INDEX tickets_overdue_idx
  ON tickets (tenant_id, sla_due_at) WHERE closed_at IS NULL AND deleted_at IS NULL;
-- Повторные обращения
CREATE INDEX tickets_parent_idx
  ON tickets (tenant_id, parent_ticket_id) WHERE parent_ticket_id IS NOT NULL;

CREATE TRIGGER tickets_set_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Проверка закрытия ──────────────────────────────────────────────────────
-- Требование: закрыть заявку без отчёта о работе нельзя. Житель не подтверждает
-- (решение C), поэтому единственная фиксация результата — resolution_note.
CREATE OR REPLACE FUNCTION validate_ticket_closure()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  status_code text;
BEGIN
  SELECT code INTO status_code FROM ticket_statuses WHERE id = NEW.status_id;

  IF status_code IN ('closed', 'rejected') AND NEW.closed_at IS NULL THEN
    NEW.closed_at := now();
  END IF;

  IF status_code = 'closed' THEN
    IF NEW.resolution_note IS NULL OR length(trim(NEW.resolution_note)) = 0 THEN
      RAISE EXCEPTION 'Нельзя закрыть заявку без описания выполненных работ'
        USING HINT = 'Заполните resolution_note: что именно сделано.';
    END IF;
    IF NEW.closed_by IS NULL THEN
      RAISE EXCEPTION 'Нельзя закрыть заявку без указания закрывающего'
        USING HINT = 'Заполните closed_by.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tickets_validate_closure
  BEFORE INSERT OR UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION validate_ticket_closure();

-- ─── Первая запись истории при создании ─────────────────────────────────────
CREATE OR REPLACE FUNCTION tickets_initial_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO ticket_status_history (tenant_id, ticket_id, from_status_id, to_status_id, changed_by)
  VALUES (NEW.tenant_id, NEW.id, NULL, NEW.status_id, NEW.created_by);
  RETURN NULL;
END;
$$;

-- ─── История статусов ───────────────────────────────────────────────────────
CREATE TABLE ticket_status_history (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  ticket_id      uuid        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  -- NULL только у первой записи (создание заявки)
  from_status_id uuid        REFERENCES ticket_statuses(id) ON DELETE RESTRICT,
  to_status_id   uuid        NOT NULL REFERENCES ticket_statuses(id) ON DELETE RESTRICT,
  changed_by     uuid        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  comment        text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE ticket_status_history IS
  'История смены статусов. Только INSERT: UPDATE и DELETE запрещены триггером — это аудит.';

CREATE INDEX history_ticket_created_idx ON ticket_status_history (ticket_id, created_at ASC);
CREATE INDEX history_tenant_created_idx ON ticket_status_history (tenant_id, created_at DESC);

CREATE TRIGGER tickets_initial_history_trigger
  AFTER INSERT ON tickets
  FOR EACH ROW EXECUTE FUNCTION tickets_initial_history();

-- История неизменяема
CREATE OR REPLACE FUNCTION forbid_history_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Изменение истории статусов запрещено: это аудит'
    USING HINT = 'Исправления вносятся новой записью, а не правкой старой.';
END;
$$;

CREATE TRIGGER history_immutable
  BEFORE UPDATE OR DELETE ON ticket_status_history
  FOR EACH ROW EXECUTE FUNCTION forbid_history_change();

-- ─── Назначения исполнителей ────────────────────────────────────────────────
CREATE TABLE ticket_assignments (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  ticket_id     uuid        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  assignee_id   uuid        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_by   uuid        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  unassigned_at timestamptz,
  note          text,
  CONSTRAINT assignment_unassign_after CHECK (
    unassigned_at IS NULL OR unassigned_at >= assigned_at
  )
);

COMMENT ON TABLE ticket_assignments IS
  'История назначений: кто держал заявку и когда. tickets.assigned_to — денормализация для быстрых запросов.';

CREATE INDEX assignments_ticket_idx ON ticket_assignments (ticket_id, assigned_at DESC);
CREATE INDEX assignments_tenant_assignee_idx
  ON ticket_assignments (tenant_id, assignee_id, assigned_at DESC);

-- Удалять историю назначений нельзя, но закрывать (unassigned_at) — можно
CREATE OR REPLACE FUNCTION forbid_assignment_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Удаление истории назначений запрещено';
END;
$$;

CREATE TRIGGER assignments_no_delete
  BEFORE DELETE ON ticket_assignments
  FOR EACH ROW EXECUTE FUNCTION forbid_assignment_delete();
