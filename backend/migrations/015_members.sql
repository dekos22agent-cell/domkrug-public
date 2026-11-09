-- ============================================================================
-- 015_members.sql
-- Члены квартиры: семья, дети, арендаторы, рабочие — с набором прав.
--
-- Зачем не «семья»: строителю нужен доступ на неделю и только к двери,
-- ребёнку — только дверь, жене — ещё видео и показания. Это разные наборы
-- прав, а не разные родственные связи.
--
-- Права храним массивом scopes, а не только пресетом: пресет — это готовый
-- набор для интерфейса, но если завтра «семье» понадобится финанс, хватит
-- поменять набор, не трогая схему.
--
-- Инвайт по номеру телефона: человек ставит приложение, регистрируется этим
-- номером — приглашение подхватывается автоматически. Никаких ссылок и кодов.
-- ============================================================================

CREATE TABLE apartment_members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  apartment_id uuid NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,

  -- Пока человек не вошёл, user_id пустой: приглашение живёт по телефону
  user_id      uuid REFERENCES users(id) ON DELETE CASCADE,
  phone        text NOT NULL,

  preset       text NOT NULL CHECK (preset IN ('family', 'child', 'tenant', 'worker', 'guest')),
  scopes       text[] NOT NULL DEFAULT '{}',

  status       text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'revoked')),

  invited_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at   timestamptz,
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),

  -- Один телефон — одно приглашение на квартиру: повторное обновляет права
  UNIQUE (apartment_id, phone)
);

CREATE INDEX apartment_members_user_idx ON apartment_members (user_id, status);
CREATE INDEX apartment_members_phone_idx ON apartment_members (phone, status);
CREATE INDEX apartment_members_apartment_idx ON apartment_members (apartment_id, status);

COMMENT ON TABLE apartment_members IS
  'Члены квартиры с набором прав. Владелец (подтверждённая привязка) сюда не входит — у него все права по умолчанию.';
COMMENT ON COLUMN apartment_members.scopes IS
  'Набор прав: access.open, video.view, meters.submit, tickets.create, finance.view, members.manage.';

-- ─── Единое представление прав на квартиру ────────────────────────────────
-- Чтобы каждый модуль не собирал UNION из привязок и членств руками,
-- собираем права в одном месте. Модули спрашивают: «может ли этот человек
-- открыть дверь в этой квартире» — и получают ответ из представления.
--
-- Владелец (подтверждённая привязка) имеет все права. Член квартиры —
-- только свои, и только пока не истёк срок.
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
  true AS can_manage
FROM resident_bindings rb
WHERE rb.status = 'confirmed'
UNION ALL
SELECT
  m.user_id,
  m.apartment_id,
  false,
  'access.open' = ANY (m.scopes)   AND (m.expires_at IS NULL OR m.expires_at > now()),
  'video.view' = ANY (m.scopes)    AND (m.expires_at IS NULL OR m.expires_at > now()),
  'meters.submit' = ANY (m.scopes) AND (m.expires_at IS NULL OR m.expires_at > now()),
  'tickets.create' = ANY (m.scopes) AND (m.expires_at IS NULL OR m.expires_at > now()),
  'finance.view' = ANY (m.scopes)  AND (m.expires_at IS NULL OR m.expires_at > now()),
  'members.manage' = ANY (m.scopes) AND (m.expires_at IS NULL OR m.expires_at > now())
FROM apartment_members m
WHERE m.status = 'active' AND m.user_id IS NOT NULL;

COMMENT ON VIEW apartment_rights IS
  'Права человека на квартиру: владелец из привязки или член с набором прав. Модули проверяют can_* вместо прямых JOIN по resident_bindings.';