-- ============================================================================
-- 023_code_lookup.sql
-- Индексируемый ключ для гостевых кодов.
--
-- Зачем: authenticateByCode проверял введённый код против КАЖДОГО активного
-- кода через bcrypt/scrypt. При сотнях кодов одна попытка блокировала Node
-- на секунды. Теперь код ищется одним SELECT по HMAC-ключу, а bcrypt
-- проверяет только найденную строку.
--
-- HMAC, а не sha256: без серверного секрета по дампу базы нельзя перебрать
-- 31^8 вариантов кода офлайн. Ключ — CODE_SECRET (или JWT_SECRET, если
-- отдельный не задан).
-- ============================================================================

ALTER TABLE apartment_members
  ADD COLUMN access_code_lookup text;

CREATE UNIQUE INDEX apartment_members_code_lookup_idx
  ON apartment_members (access_code_lookup)
  WHERE access_code_lookup IS NOT NULL;

COMMENT ON COLUMN apartment_members.access_code_lookup IS
  'HMAC-SHA256(normalizeCode(code), CODE_SECRET) в hex. Индекс для поиска кода без перебора всех записей.';
