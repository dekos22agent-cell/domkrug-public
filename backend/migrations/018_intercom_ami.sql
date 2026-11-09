-- ============================================================================
-- 018_intercom_ami.sql
-- Приём звонков с вызывной панели через Asterisk (AMI).
--
-- Зачем: панель звонит на SIP-номер (у нас — «номер комнаты»), Asterisk
-- соединяет с клиентом. Приложение о звонке не знает, пока ему не скажут.
-- Единственный доступный источник события — AMI: у Hikvision событие вызова
-- по HTTP/ISAPI отсутствует (проверено, docs/INTERCOM-HIKVISION.md раздел 3).
--
-- Что добавляем:
--   1) номер комнаты у квартиры — чтобы связать «звонят в 100» с квартирой 1;
--   2) новый тип уведомления intercom_call — иначе звонок некуда записать.
-- ============================================================================

-- ─── Номер комнаты у квартиры ───────────────────────────────────────────────
-- Именно этот номер набирает панель при вызове. На стенде это «100».
ALTER TABLE apartments
  ADD COLUMN IF NOT EXISTS intercom_room text;

COMMENT ON COLUMN apartments.intercom_room IS
  'Номер комнаты/абонента, который набирает вызывная панель. NULL — вызовы в эту квартиру не маршрутизируются.';

-- Номер комнаты должен быть уникален в пределах дома: иначе непонятно,
-- в какую квартиру звонили. NULL не участвует в уникальности.
CREATE UNIQUE INDEX IF NOT EXISTS apartments_intercom_room_idx
  ON apartments (building_id, intercom_room)
  WHERE intercom_room IS NOT NULL;

-- ─── Тип уведомления «звонок в домофон» ─────────────────────────────────────
-- Ограничения в 006 заданы inline, поэтому имена стандартные:
-- <таблица>_<колонка>_check.
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'ticket_created',
    'ticket_status_changed',
    'ticket_assigned',
    'ticket_comment',
    'resident_binding_confirmed',
    'resident_binding_rejected',
    'news_published',
    'intercom_call'
  ));

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_entity_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_entity_type_check CHECK (entity_type IN (
    'ticket', 'news', 'resident_binding', 'intercom_call'
  ));

-- ─── Связь звонка с уникальным идентификатором Asterisk ─────────────────────
-- Нужно, чтобы на Hangup закрыть именно ту запись, а не «последнюю
-- незакрытую»: звонки могут идти параллельно из разных подъездов.
ALTER TABLE intercom_calls
  ADD COLUMN IF NOT EXISTS ami_unique_id text;

CREATE UNIQUE INDEX IF NOT EXISTS intercom_calls_ami_uid_idx
  ON intercom_calls (ami_unique_id)
  WHERE ami_unique_id IS NOT NULL;

COMMENT ON COLUMN intercom_calls.ami_unique_id IS
  'Uniqueid из события Asterisk Newchannel. NULL у демо-вызовов и записей, созданных вручную.';
