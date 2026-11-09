-- ============================================================================
-- 001_core_reference.sql
-- Справочники платформы: роли, права, роли↔права, статусы заявок.
--
-- Почему первыми: на них ссылаются все остальные таблицы, и они не зависят
-- от данных УК. Сид справочников лежит здесь же — чтобы после `npm run migrate`
-- база была работоспособной, а не полупустой.
--
-- Источник: docs/RBAC.md (матрица прав), docs/DB-SCHEMA.md (раздел 5.2–5.3)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;    -- e-mail без учёта регистра

-- ─── Общий триггер updated_at ───────────────────────────────────────────────
-- Одна функция на все таблицы: не нужно дублировать логику в каждой миграции.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION set_updated_at() IS
  'Автоматически проставляет updated_at при UPDATE. Навешивается триггером на таблицы с этим полем.';

-- ─── Роли ───────────────────────────────────────────────────────────────────
CREATE TABLE roles (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text        NOT NULL UNIQUE,
  name       text        NOT NULL,
  -- is_system = true защищает от удаления/переименования из интерфейса
  is_system  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE roles IS 'Роли платформы. Платформенный справочник, не привязан к УК.';

INSERT INTO roles (code, name) VALUES
  ('platform_admin', 'Системный администратор платформы'),
  ('uk_admin',       'Администратор УК'),
  ('uk_manager',     'Руководитель УК'),
  ('dispatcher',     'Диспетчер УК'),
  ('executor',       'Исполнитель / технический специалист'),
  ('resident',       'Житель');

-- ─── Права ──────────────────────────────────────────────────────────────────
CREATE TABLE permissions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text        NOT NULL UNIQUE,
  description text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE permissions IS
  'Права доступа. Соглашение по коду: <ресурс>.<действие>. Право не знает, к каким строкам применимо — это область данных.';

INSERT INTO permissions (code, description) VALUES
  -- Платформа и тенанты
  ('tenant.view',                  'Просмотр своей УК'),
  ('tenant.update',                'Изменение своей УК'),
  ('tenant.create',                'Создание УК на платформе'),
  ('tenant.suspend',               'Приостановка и возобновление УК'),
  ('platform.audit.view',          'Журнал платформенных действий'),

  -- Структура домов
  ('complex.view',                 'Просмотр жилых комплексов'),
  ('complex.manage',               'Создание и изменение ЖК'),
  ('building.view',                'Просмотр домов'),
  ('building.manage',              'Создание и изменение домов'),
  ('building.import',              'Массовый импорт домов'),
  ('apartment.view',               'Просмотр квартир'),
  ('apartment.manage',             'Создание и изменение квартир'),
  ('apartment.import',             'Массовый импорт квартир'),

  -- Пользователи и доступ
  ('user.view',                    'Просмотр пользователей УК'),
  ('user.create',                  'Создание учётной записи сотрудника'),
  ('user.block',                   'Блокировка пользователя'),
  ('staff.view',                   'Просмотр сотрудников'),
  ('staff.manage',                 'Приём и деактивация сотрудников'),
  ('staff.roles.assign',           'Назначение ролей сотрудникам'),
  ('resident_binding.view',        'Просмотр заявок на привязку к квартире'),
  ('resident_binding.confirm',     'Подтверждение привязки'),
  ('resident_binding.reject',      'Отклонение привязки'),
  ('resident_binding.revoke',      'Отзыв подтверждённой привязки'),

  -- Заявки
  ('ticket.create',                'Создание заявки'),
  ('ticket.view.own',              'Просмотр своих заявок'),
  ('ticket.view.all',              'Просмотр всех заявок УК'),
  ('ticket.view.assigned',         'Просмотр назначенных на себя'),
  ('ticket.accept',                'Принятие заявки'),
  ('ticket.assign',                'Назначение исполнителя'),
  ('ticket.status.change',         'Смена статуса заявки'),
  ('ticket.close',                 'Закрытие заявки'),
  ('ticket.reject',                'Отклонение заявки'),
  ('ticket.delete',                'Скрытие заявки'),
  ('ticket.export',                'Выгрузка заявок'),

  -- Обсуждение и файлы
  ('ticket.comment.create',        'Комментирование заявки'),
  ('ticket.comment.internal',      'Служебные комментарии, невидимые жителю'),
  ('ticket.comment.delete',        'Удаление комментария'),
  ('ticket.attachment.upload',     'Загрузка файлов к заявке'),
  ('ticket.attachment.delete',     'Удаление вложений'),

  -- Справочники и настройки
  ('category.view',                'Просмотр категорий заявок'),
  ('category.manage',              'Настройка категорий'),
  ('sla.manage',                   'Настройка сроков SLA'),
  ('status.view',                  'Просмотр справочника статусов'),

  -- Информирование
  ('news.view',                    'Просмотр новостей'),
  ('news.manage',                  'Создание и редактирование новостей'),
  ('news.publish',                 'Публикация новостей'),
  ('news.delete',                  'Удаление новостей'),
  ('notification.view.own',        'Свои уведомления'),

  -- Контроль
  ('audit.view',                   'Журнал действий своей УК'),
  ('report.view',                  'Просмотр аналитики'),
  ('report.export',                'Выгрузка отчётов');

-- ─── Роли ↔ права ───────────────────────────────────────────────────────────
CREATE TABLE role_permissions (
  role_id       uuid NOT NULL REFERENCES roles(id)       ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- Обратный индекс: «кто имеет право X» — частый вопрос при отладке доступа.
CREATE INDEX role_permissions_permission_idx ON role_permissions (permission_id);

COMMENT ON TABLE role_permissions IS
  'Связь роль ↔ право. Служебная таблица, поэтому CASCADE при удалении роли/права.';

-- platform_admin: только платформа. НЕ имеет доступа к заявкам, квартирам
-- и жителям — требование изоляции по ТЗ v1.1 п. 2.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'tenant.view', 'tenant.create', 'tenant.suspend', 'platform.audit.view',
  'user.block', 'notification.view.own'
)
WHERE r.code = 'platform_admin';

-- uk_admin: всё в своей УК, кроме платформенных операций.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code NOT IN (
  'tenant.create', 'tenant.suspend', 'platform.audit.view'
)
WHERE r.code = 'uk_admin';

-- uk_manager (v2): только чтение и отчёты.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'tenant.view',
  'complex.view', 'building.view', 'apartment.view',
  'user.view', 'staff.view', 'resident_binding.view',
  'ticket.view.all', 'ticket.export',
  'category.view', 'status.view',
  'news.view', 'notification.view.own',
  'audit.view', 'report.view', 'report.export'
)
WHERE r.code = 'uk_manager';

-- dispatcher: весь инбокс УК, но НЕ закрытие заявки (закрывает исполнитель).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'tenant.view',
  'complex.view', 'building.view', 'apartment.view',
  'user.view', 'staff.view',
  'resident_binding.view', 'resident_binding.confirm', 'resident_binding.reject',
  'ticket.create', 'ticket.view.all', 'ticket.accept', 'ticket.assign',
  'ticket.status.change', 'ticket.reject', 'ticket.export',
  'ticket.comment.create', 'ticket.comment.internal', 'ticket.attachment.upload',
  'category.view', 'status.view',
  'news.view', 'news.manage', 'news.publish', 'notification.view.own',
  'report.view'
)
WHERE r.code = 'dispatcher';

-- executor: только назначенные заявки, но с правом закрытия.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'tenant.view',
  'complex.view', 'building.view', 'apartment.view', 'staff.view',
  'ticket.view.assigned', 'ticket.status.change', 'ticket.close',
  'ticket.comment.create', 'ticket.comment.internal', 'ticket.attachment.upload',
  'category.view', 'status.view',
  'news.view', 'notification.view.own'
)
WHERE r.code = 'executor';

-- resident: свои заявки и своя квартира.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'tenant.view',
  'complex.view', 'building.view', 'apartment.view',
  'ticket.create', 'ticket.view.own',
  'ticket.comment.create', 'ticket.comment.delete',
  'ticket.attachment.upload', 'ticket.attachment.delete',
  'category.view', 'status.view',
  'news.view', 'notification.view.own'
)
WHERE r.code = 'resident';

-- ─── Статусы заявок ─────────────────────────────────────────────────────────
CREATE TABLE ticket_statuses (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text        NOT NULL UNIQUE,
  name        text        NOT NULL,
  sort_order  integer     NOT NULL,
  -- terminal = дальше переходов нет (кроме повторного обращения новой заявкой)
  is_terminal boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE ticket_statuses IS
  'Справочник статусов заявки. Платформенный, не редактируется из интерфейса.';

INSERT INTO ticket_statuses (code, name, sort_order, is_terminal) VALUES
  ('new',         'Новая',                   10, false),
  ('accepted',    'Принята',                 20, false),
  ('assigned',    'Назначен исполнитель',    30, false),
  ('in_progress', 'В работе',                40, false),
  ('waiting',     'Ожидает материалов или доступа', 50, false),
  ('done',        'Выполнена',               60, false),
  ('closed',      'Закрыта',                 70, true),
  ('rejected',    'Отклонена',               80, true)
ON CONFLICT (code) DO NOTHING;
