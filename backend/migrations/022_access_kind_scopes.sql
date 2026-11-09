-- ============================================================================
-- 022_access_kind_scopes.sql
-- Права на конкретные типы точек доступа: подъезд, калитка, шлагбаум, ворота,
-- парковка — вместо одного «access.open» на всё.
--
-- Зачем: владелец хочет выдать гостю доступ только к калитке или только к
-- шлагбауму. Раньше право было одно на все двери, и выбрать было нечего.
--
-- В представление добавляем колонку scopes: по ней проверка точки понимает,
-- какой именно тип разрешён. Существующее «access.open» остаётся и означает
-- «все точки» — старые приглашения и пресеты продолжают работать.
-- ============================================================================

CREATE OR REPLACE VIEW apartment_rights AS
SELECT
  rb.user_id,
  rb.apartment_id,
  true AS is_owner,
  true AS can_open,
  true AS can_video,
  true AS can_meters,
  true AS can_tickets,
  true AS can_finance,
  true AS can_manage,
  ARRAY[
    'access.open',
    'access.entrance_door',
    'access.wicket',
    'access.barrier',
    'access.gate',
    'access.parking',
    'video.view',
    'meters.submit',
    'tickets.create',
    'finance.view',
    'members.manage'
  ]::text[] AS scopes
FROM resident_bindings rb
WHERE rb.status = 'confirmed'
UNION ALL
SELECT
  m.user_id,
  m.apartment_id,
  false,
  (
    'access.open' = ANY (m.scopes)
    OR EXISTS (SELECT 1 FROM unnest(m.scopes) AS s(scope) WHERE s.scope LIKE 'access.%')
  ) AND (m.expires_at IS NULL OR m.expires_at > now()),
  'video.view' = ANY (m.scopes)    AND (m.expires_at IS NULL OR m.expires_at > now()),
  'meters.submit' = ANY (m.scopes) AND (m.expires_at IS NULL OR m.expires_at > now()),
  'tickets.create' = ANY (m.scopes) AND (m.expires_at IS NULL OR m.expires_at > now()),
  'finance.view' = ANY (m.scopes)  AND (m.expires_at IS NULL OR m.expires_at > now()),
  'members.manage' = ANY (m.scopes) AND (m.expires_at IS NULL OR m.expires_at > now()),
  m.scopes
FROM apartment_members m
WHERE m.status = 'active' AND m.user_id IS NOT NULL;

COMMENT ON VIEW apartment_rights IS
  'Права человека на квартиру. scopes — исходный набор прав члена или все права владельца; can_open учитывает и access.open, и access.<kind>.';
