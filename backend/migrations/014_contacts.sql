-- ============================================================================
-- 014_contacts.sql
-- Полезные телефоны и связь неисправности лифта с заявкой.
--
-- 1. Сообщение о неисправности лифта должно превращаться в настоящую заявку:
--    иначе житель пишет в пустоту, а УК не видит обращения в своём инбоксе.
--    Связь храним в lift_events.ticket_id — по ней видно, какая заявка
--    появилась из какого сообщения.
--
-- 2. Телефоны обслуживающих организаций: УК, участковый, провайдеры,
--    поликлиника. Это не «справочник ради справочника»: человек ищет их
--    в момент проблемы, и искать он должен в приложении, а не в интернете.
-- ============================================================================

ALTER TABLE lift_events
  ADD COLUMN IF NOT EXISTS ticket_id uuid REFERENCES tickets(id) ON DELETE SET NULL;

COMMENT ON COLUMN lift_events.ticket_id IS
  'Заявка, созданная из сообщения о неисправности. NULL у вызовов лифта.';

CREATE TABLE contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- NULL = телефон общий для всей УК, иначе — для конкретного дома
  building_id uuid REFERENCES buildings(id) ON DELETE CASCADE,

  kind        text NOT NULL CHECK (kind IN ('uk', 'district', 'provider', 'clinic', 'emergency', 'other')),
  name        text NOT NULL,
  phone       text NOT NULL,
  note        text,
  sort_order  integer NOT NULL DEFAULT 0,

  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX contacts_tenant_idx ON contacts (tenant_id, sort_order);
CREATE INDEX contacts_building_idx ON contacts (building_id);

COMMENT ON TABLE contacts IS
  'Телефоны обслуживающих организаций. Показываются жителям УК или конкретного дома.';
