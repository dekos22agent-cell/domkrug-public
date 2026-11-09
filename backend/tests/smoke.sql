-- ============================================================================
-- smoke.sql — проверка схемы вживую.
--
-- Запуск:  .local\pgsql\bin\psql.exe -h localhost -U domkrug -d domkrug_dev -f backend\tests\smoke.sql
--
-- Всё выполняется в транзакции и откатывается в конце: база остаётся чистой.
-- Проверяем не «таблицы создались», а поведение: что триггеры и ограничения
-- действительно работают.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_tenant   uuid;
  v_complex  uuid;
  v_building uuid;
  v_entrance uuid;
  v_floor    uuid;
  v_flat     uuid;
  v_user     uuid;
  v_staff_u  uuid;
  v_cat      uuid;
  v_ticket   uuid;
  v_hist     integer;
  v_count    integer;
BEGIN
  -- ─── Структура ────────────────────────────────────────────────────────────
  INSERT INTO tenants (name, slug, contact_phone)
  VALUES ('Тестовая УК', 'test-uk', '+79000000000')
  RETURNING id INTO v_tenant;

  INSERT INTO residential_complexes (tenant_id, name)
  VALUES (v_tenant, 'Тестовый ЖК')
  RETURNING id INTO v_complex;

  INSERT INTO buildings (tenant_id, complex_id, city, street, house_number, address_text)
  VALUES (v_tenant, v_complex, 'Барнаул', 'Ленина', '1', 'г. Барнаул, ул. Ленина, 1')
  RETURNING id INTO v_building;

  INSERT INTO entrances (tenant_id, building_id, number)
  VALUES (v_tenant, v_building, 1) RETURNING id INTO v_entrance;

  INSERT INTO floors (tenant_id, entrance_id, number)
  VALUES (v_tenant, v_entrance, 1) RETURNING id INTO v_floor;

  INSERT INTO apartments (tenant_id, building_id, entrance_id, floor_id, number, rooms, area_total)
  VALUES (v_tenant, v_building, v_entrance, v_floor, '1', 2, 54.30)
  RETURNING id INTO v_flat;

  RAISE NOTICE 'PASS  структура: УК → ЖК → дом → подъезд → этаж → квартира';

  -- ─── Пользователи ─────────────────────────────────────────────────────────
  -- Пароли в тесте — заглушки: схема не проверяет формат хеша, это делает приложение
  INSERT INTO users (phone, password_hash, full_name)
  VALUES ('+79000000001', 'test-hash', 'Тестовый Житель')
  RETURNING id INTO v_user;

  INSERT INTO users (phone, password_hash, full_name)
  VALUES ('+79000000002', 'test-hash', 'Тестовый Диспетчер')
  RETURNING id INTO v_staff_u;

  -- Привязка в статусе pending (житель ещё не подтверждён)
  INSERT INTO resident_bindings (tenant_id, user_id, apartment_id, status, role_in_apartment)
  VALUES (v_tenant, v_user, v_flat, 'pending', 'owner');

  RAISE NOTICE 'PASS  пользователи и привязка в статусе pending';

  -- ─── Проверка: подтверждение без автора запрещено ─────────────────────────
  BEGIN
    UPDATE resident_bindings SET status = 'confirmed' WHERE user_id = v_user;
    RAISE NOTICE 'FAIL  привязка подтверждена без confirmed_by — ограничение не работает';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS  подтверждение привязки без автора отклонено';
  END;

  UPDATE resident_bindings
     SET status = 'confirmed', confirmed_by = v_staff_u, confirmed_at = now()
   WHERE user_id = v_user;

  -- ─── Заявка ───────────────────────────────────────────────────────────────
  SELECT id INTO v_cat FROM ticket_categories WHERE code = 'plumbing' AND tenant_id IS NULL;

  INSERT INTO ticket_numbers (tenant_id, last_number) VALUES (v_tenant, 0);

  UPDATE ticket_numbers SET last_number = last_number + 1
   WHERE tenant_id = v_tenant
  RETURNING last_number INTO v_count;

  INSERT INTO tickets (
    tenant_id, number, building_id, apartment_id, category_id,
    priority, source, title, description, contact_phone, created_by, sla_due_at
  ) VALUES (
    v_tenant, v_count, v_building, v_flat, v_cat,
    'high', 'resident_app', 'Течёт кран', 'Капает под мойкой', '+79000000001', v_user, now() + interval '24 hours'
  ) RETURNING id INTO v_ticket;

  RAISE NOTICE 'PASS  заявка создана, номер %', v_count;

  -- История должна появиться автоматически (триггер AFTER INSERT)
  SELECT count(*) INTO v_hist FROM ticket_status_history WHERE ticket_id = v_ticket;
  IF v_hist = 1 THEN
    RAISE NOTICE 'PASS  первая запись истории создана автоматически';
  ELSE
    RAISE NOTICE 'FAIL  записей истории: % (ожидалась 1)', v_hist;
  END IF;

  -- ─── Проверка: закрытие без описания работ запрещено ──────────────────────
  BEGIN
    UPDATE tickets
       SET status_id = (SELECT id FROM ticket_statuses WHERE code = 'closed'),
           closed_by = v_staff_u
     WHERE id = v_ticket;
    RAISE NOTICE 'FAIL  заявка закрыта без resolution_note — триггер не сработал';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'PASS  закрытие без описания работ отклонено';
  END;

  -- С описанием — должно пройти
  UPDATE tickets
     SET status_id = (SELECT id FROM ticket_statuses WHERE code = 'closed'),
         closed_by = v_staff_u,
         resolution_note = 'Заменён картридж'
   WHERE id = v_ticket;

  SELECT count(*) INTO v_count FROM tickets WHERE id = v_ticket AND closed_at IS NOT NULL;
  IF v_count = 1 THEN
    RAISE NOTICE 'PASS  closed_at проставлен автоматически';
  ELSE
    RAISE NOTICE 'FAIL  closed_at не проставлен';
  END IF;

  -- ─── Проверка: история неизменяема ────────────────────────────────────────
  BEGIN
    UPDATE ticket_status_history SET comment = 'подделка' WHERE ticket_id = v_ticket;
    RAISE NOTICE 'FAIL  историю статусов удалось изменить';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'PASS  изменение истории статусов запрещено';
  END;

  -- ─── Проверка: аудит неизменяем ───────────────────────────────────────────
  INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id)
  VALUES (v_tenant, v_staff_u, 'ticket.status_change', 'ticket', v_ticket);

  BEGIN
    UPDATE audit_log SET action = 'ticket.create' WHERE entity_id = v_ticket;
    RAISE NOTICE 'FAIL  журнал аудита удалось изменить';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'PASS  изменение журнала аудита запрещено';
  END;

  -- ─── Проверка: роль УК без tenant_id запрещена ─────────────────────────────
  BEGIN
    INSERT INTO user_roles (user_id, role_id, tenant_id)
    VALUES (v_staff_u, (SELECT id FROM roles WHERE code = 'dispatcher'), NULL);
    RAISE NOTICE 'FAIL  роль диспетчера назначена без привязки к УК';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'PASS  роль УК без tenant_id отклонена';
  END;

  -- ─── Проверка: телефон в неверном формате отклонён ────────────────────────
  BEGIN
    INSERT INTO users (phone, password_hash, full_name)
    VALUES ('89000000003', 'test-hash', 'Плохой Телефон');
    RAISE NOTICE 'FAIL  телефон в формате 8... принят';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS  телефон не в формате +7XXXXXXXXXX отклонён';
  END;

  -- ─── Проверка: дубль адреса дома запрещён ─────────────────────────────────
  BEGIN
    INSERT INTO buildings (tenant_id, city, street, house_number, address_text)
    VALUES (v_tenant, 'Барнаул', 'Ленина', '1', 'дубль');
    RAISE NOTICE 'FAIL  дубль дома принят';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS  дубль адреса дома отклонён';
  END;

END $$;

-- ─── Итоговая сводка ────────────────────────────────────────────────────────
SELECT 'таблиц' AS metric, count(*)::text AS value
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
UNION ALL
SELECT 'системных категорий', count(*)::text FROM ticket_categories WHERE tenant_id IS NULL
UNION ALL
SELECT 'миграций', count(*)::text FROM schema_migrations;

ROLLBACK;

\echo 'Транзакция откатана — тестовые данные в базе не остались.'
