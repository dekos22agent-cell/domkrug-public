#!/usr/bin/env bash
#
# Деплой liviti на сервер.
#
# Порядок специально такой: сначала бэкап, потом код, потом сборка, и только
# в конце перезапуск. Если что-то падает посередине, старый процесс продолжает
# работать — сайт не ложится.
set -euo pipefail

APP=/srv/domkrug
cd "$APP"

echo "=== 1. Параметры ==="
DB_NAME=$(grep -E '^POSTGRES_DB=' .env | cut -d= -f2-)
DB_USER=$(grep -E '^POSTGRES_USER=' .env | cut -d= -f2-)
echo "база: $DB_NAME, пользователь: $DB_USER"

echo "=== 2. Бэкап базы ==="
mkdir -p backups
STAMP=$(date +%Y%m%d-%H%M%S)
sudo docker exec domkrug-postgres pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "backups/pre-$STAMP.dump"
ls -lh "backups/pre-$STAMP.dump"

echo "=== 3. Код с GitHub ==="
git fetch --all --prune
git pull --ff-only
git log --oneline -1

echo "=== 4. Бэкенд: зависимости, миграции, сборка ==="
# Куда собираем клиенты:
#   paths       — /app и /uk на главном домене (пока нет DNS)
#   subdomains  — app.liviti.ru и uk.liviti.ru (после появления записей)
DEPLOY_TARGET=${DEPLOY_TARGET:-paths}
if [ "$DEPLOY_TARGET" = "subdomains" ]; then
  RESIDENT_BASE=/
  STAFF_BASE=/
  RESIDENT_URL=https://app.liviti.ru/
  STAFF_URL=https://uk.liviti.ru/
else
  RESIDENT_BASE=/app/
  STAFF_BASE=/uk/
  RESIDENT_URL=/app/
  STAFF_URL=/uk/
fi
echo "режим сборки: $DEPLOY_TARGET"

cd backend
npm ci --no-audit --no-fund
npm run migrate
npm run db:backfill-code-lookup
npm run build

echo "=== 5. Фронтенд: зависимости и сборка ==="
# Зависимости живут в корне воркспейса: приложения и общие пакеты
# (ui, shared) делят один node_modules.
cd ..
# npm ci падает, если lock разошёлся с package.json (например, добавили
# новый воркспейс). Тогда доустанавливаем: деплой не должен вставать
# из-за этого, а lock всё равно обновится при следующем коммите.
npm ci --no-audit --no-fund || npm install --no-audit --no-fund

# Пароли демо-входов в сборку не попадают: бандл публичный, а экспорт
# переживает переход к сборке кабинета УК — пароль оказывался на обеих
# формах входа. Учётные данные владелец передаёт тестировщикам отдельно.
unset VITE_DEMO_LOGINS || true

# Лендинг — на главном домене
cd apps/landing
export VITE_RESIDENT_URL="$RESIDENT_URL"
export VITE_STAFF_URL="$STAFF_URL"
npm run build
ls -la dist/assets | head -3

echo "=== 5а. Приложение жителя (пока на /app) ==="
cd ../resident
export VITE_BASE="$RESIDENT_BASE"
export VITE_APP_AUDIENCE=resident
export VITE_STAFF_URL="$STAFF_URL"
npm run build
ls -la dist/assets | head -3

echo "=== 5б. Кабинет УК (пока на /uk) ==="
cd ../staff
export VITE_BASE="$STAFF_BASE"
export VITE_APP_AUDIENCE=staff
export VITE_RESIDENT_URL="$RESIDENT_URL"
npm run build
ls -la dist/assets | head -3

echo "=== 6. Перезапуск API ==="
sudo systemctl restart domkrug-api
sleep 4
systemctl is-active domkrug-api

echo "=== 7. Проверки ==="
curl -s -o /dev/null -w 'health: %{http_code}\n' http://127.0.0.1:3000/health
curl -s -o /dev/null -w 'updates без токена (ждём 401): %{http_code}\n' http://127.0.0.1:3000/api/v1/updates
curl -s -o /dev/null -w 'notifications без токена (ждём 401): %{http_code}\n' http://127.0.0.1:3000/api/v1/notifications

echo "=== ГОТОВО ==="
