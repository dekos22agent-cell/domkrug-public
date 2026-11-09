-- ============================================================================
-- 019_intercom_call_guest.sql
-- Один звонящий вызов на квартиру + привязка звонка к жителю.
--
-- Причины (обе найдены проверкой на живом Asterisk 06.11):
--
-- 1. Local-канал Asterisk создаёт ПАРУ каналов (;1 и ;2), и оба приходят как
--    Newchannel с Context=from-panel. Проверка в коде «есть ли уже ringing»
--    не спасает: два события обрабатываются почти одновременно и оба видят
--    пустую таблицу. Нужен запрет на уровне базы.
--
-- 2. Звонок искался по intercom_calls.user_id, а из AMI мы его не знаем:
--    вызов приходит на КВАРТИРУ, а не на конкретного человека. Житель не
--    видел окно, хотя запись создавалась.
-- ============================================================================

-- ─── Сначала гасим возможные дубли, иначе индекс не создастся ───────────────
-- Оставляем самый ранний звонок из одновременных, остальные помечаем
-- пропущенными: они относятся к тому же нажатию кнопки.
UPDATE intercom_calls c
   SET status = 'missed',
       ended_at = COALESCE(ended_at, now())
 WHERE c.status = 'ringing'
   AND EXISTS (
     SELECT 1 FROM intercom_calls x
      WHERE x.apartment_id = c.apartment_id
        AND x.status = 'ringing'
        AND x.started_at < c.started_at
   );

-- ─── Один звонящий вызов на квартиру ────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS intercom_calls_one_ringing_idx
  ON intercom_calls (apartment_id)
  WHERE status = 'ringing';

COMMENT ON INDEX intercom_calls_one_ringing_idx IS
  'У квартиры не может быть двух одновременно звонящих вызовов: Asterisk присылает пару каналов на один вызов.';
