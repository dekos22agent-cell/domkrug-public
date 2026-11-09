-- ============================================================================
-- 008_sessions.sql
-- Сессии для refresh-токенов.
--
-- Зачем таблица, а не «просто JWT»: refresh-токен должен отзываться.
-- Без серверного состояния нельзя выкинуть украденный токен, нельзя
-- инвалидировать сессии при увольнении сотрудника и нельзя видеть,
-- откуда входили в аккаунт.
--
-- Хранится ХЕШ токена (sha256), а не сам токен: утечка базы не должна
-- давать возможность войти по чужому refresh-токену.
--
-- Источник: docs/API-CONTRACT.md, раздел 2.2
-- ============================================================================

CREATE TABLE sessions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- sha256 от refresh-токена, hex. Сами токены в базе не хранятся.
  token_hash   text        NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  user_agent   text,
  ip           inet,
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE sessions IS
  'Сессии refresh-токенов. Ротация: при обновлении старая сессия отзывается, создаётся новая. Повторное использование отозванного токена — признак кражи.';
COMMENT ON COLUMN sessions.token_hash IS 'sha256(refresh_token) в hex. Сам токен хранится только у клиента.';

-- Активные сессии пользователя: вход в «мои устройства» и отзыв при увольнении
CREATE INDEX sessions_user_active_idx ON sessions (user_id) WHERE revoked_at IS NULL;
-- Фоновая очистка просроченных
CREATE INDEX sessions_expires_idx ON sessions (expires_at);
