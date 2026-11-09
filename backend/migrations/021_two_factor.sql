-- ============================================================================
-- 021_two_factor.sql
-- Второй фактор (TOTP) для сотрудников УК.
--
-- Зачем: диспетчер и администратор видят данные сотен квартир. Одного пароля
-- для такой учётки мало — пароль утекает от фишинга и переиспользования.
--
-- Секрет хранится в users.totp_secret в base32 (как в otpauth://).
-- Это не пароль: без него не восстановить коды, поэтому база должна быть
-- защищена так же, как для password_hash. Шифрование на уровне приложения
-- добавим, когда появится KMS/ключ вне репозитория.
--
-- totp_enabled отдельно от totp_secret: секрет выдаётся на шаге настройки,
-- но вход по нему начинает требоваться только после подтверждения кодом.
--
-- Резервные коды нужны, чтобы потеря телефона не запирала администратора
-- навсегда. Хранятся хешами: утечка базы не даёт войти по коду.
-- ============================================================================

ALTER TABLE users
  ADD COLUMN totp_secret     text,
  ADD COLUMN totp_enabled    boolean NOT NULL DEFAULT false,
  ADD COLUMN totp_enabled_at timestamptz;

COMMENT ON COLUMN users.totp_secret IS
  'Base32-секрет TOTP. NULL — второй фактор не настраивался. Секрет считается выданным до подтверждения кода.';
COMMENT ON COLUMN users.totp_enabled IS
  'true — при входе требуется код. Ставится только после проверки кода из приложения-аутентификатора.';
COMMENT ON COLUMN users.totp_enabled_at IS
  'Когда второй фактор включён. Для аудита и будущего принудительного включения по ролям.';

CREATE TABLE totp_backup_codes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- sha256 от кода в верхнем регистре без дефисов
  code_hash  text        NOT NULL CHECK (length(code_hash) = 64),
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, code_hash)
);

COMMENT ON TABLE totp_backup_codes IS
  'Одноразовые резервные коды второго фактора. Хранятся хешами, показываются пользователю один раз при включении.';

-- Сколько кодов осталось — считается на каждый /auth/me
CREATE INDEX totp_backup_codes_active_idx
  ON totp_backup_codes (user_id) WHERE used_at IS NULL;
