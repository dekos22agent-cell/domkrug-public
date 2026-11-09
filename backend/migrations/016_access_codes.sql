-- ============================================================================
-- 016_access_codes.sql
-- Доступ по коду — без регистрации и без персональных данных.
--
-- Зачем: строителю, курьеру, гостю и даже ребёнку не нужно создавать учётную
-- запись, указывать телефон, ФИО и соглашаться на обработку персональных
-- данных. Собственник создаёт код в своём кабинете, человек вводит его на
-- экране входа и получает только то, что ему выдали: двери, адрес, срок.
--
-- Код храним хешем (bcrypt), как пароль: если база утечёт, коды не восстановить.
-- Показываем его владельцу один раз при создании.
-- ============================================================================

ALTER TABLE apartment_members
  -- Телефон нужен только для входа по учётной записи; для кода его нет
  ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE apartment_members
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'account'
    CHECK (kind IN ('account', 'code')),
  ADD COLUMN IF NOT EXISTS access_code_hash text,
  -- Первые символы для опознания в списке: «A3F-…»
  ADD COLUMN IF NOT EXISTS access_code_prefix text,
  -- Заметка владельца: «Строитель Пётр», «Курьер». Это данные владельца
  -- о его госте, а не персональные данные гостя
  ADD COLUMN IF NOT EXISTS label text;

-- Один код — одна запись. Хеш уникален, чтобы коды не совпали случайно
CREATE UNIQUE INDEX IF NOT EXISTS apartment_members_code_hash_idx
  ON apartment_members (access_code_hash)
  WHERE access_code_hash IS NOT NULL;

COMMENT ON COLUMN apartment_members.kind IS
  'account — вход по телефону, code — вход по коду без регистрации и ПДн.';
COMMENT ON COLUMN apartment_members.access_code_hash IS
  'bcrypt-хеш кода доступа. Сам код не хранится и не восстанавливается.';
COMMENT ON COLUMN apartment_members.label IS
  'Заметка владельца для опознания: «Строитель Пётр». Не является ПДн гостя.';
