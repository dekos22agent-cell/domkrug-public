# DomKrug — продукт **liviti**

Многофункциональная цифровая платформа для управления многоквартирными домами и взаимодействия жителей с управляющими компаниями.

**Статус:** MVP работает в проде — https://liviti.ru (backend + PWA-фронтенд, 30 таблиц, 27 миграций, 112 API-тестов, 32 юнит-теста, 24 фронтенд-теста).
**Название продукта:** liviti — «цифровая среда для современной жизни». DomKrug — имя проекта и репозитория.
**Стек:** Node.js + TypeScript + Fastify · PostgreSQL 16 · Vite + React (PWA) · Docker.
**Пилот:** 2–3 действующие УК.
**Разработчик:** 1 человек + AI-агент.

---

## С чего продолжить

- **`PROGRESS.md`** — текущее состояние и принятые решения (читать первым).
- **`START-HERE.md`** — как поднять проект на новой машине и промпт для агента.
- **`docs/FRONTEND-PLAN.md`** — что делать дальше по шагам.

---

## Что уже сделано

- docs/WHATS-DONE.md — техническая сводка: модули, права, тесты.
- docs/CUSTOMER-OVERVIEW.md — простое описание для заказчика.
- PROGRESS.md — журнал работ по дням.

## Документация

| Документ | Что внутри |
|---|---|
| [PROGRESS.md](PROGRESS.md) | Текущее состояние, принятые решения, что дальше |
| [START-HERE.md](START-HERE.md) | Как продолжить на новой машине |
| [docs/DOCS-STATUS.md](docs/DOCS-STATUS.md) | Актуальные цифры и статусы документов |
| [docs/FRONTEND-PLAN.md](docs/FRONTEND-PLAN.md) | План фронтенда по шагам |
| [docs/TZ-v1.1.md](docs/TZ-v1.1.md) | Техническое задание |
| [docs/DB-SCHEMA.md](docs/DB-SCHEMA.md) | Первоначальный проект схемы; фактическая схема — миграции 001–027 |
| [docs/RBAC.md](docs/RBAC.md) | Роли, права, области данных |
| [docs/API-CONTRACT.md](docs/API-CONTRACT.md) | Целевой контракт API; фактические маршруты — код backend |
| [docs/DESIGN.md](docs/DESIGN.md) | Дизайн-система |
| [docs/MVP-SCOPE.md](docs/MVP-SCOPE.md) | Границы MVP и критерии приёмки |
| [docs/PILOT-PLAN.md](docs/PILOT-PLAN.md) | План пилота |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Журнал решений: почему так |
| [docs/HOSTING-TimewebCloud.md](docs/HOSTING-TimewebCloud.md) | Хостинг и сервер |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Чек-лист развёртывания на сервер |

---

## Быстрый старт (локально)

Возможны два способа запуска базы. Выбирается по ресурсам машины.

### Способ A — Docker (рекомендуется, если есть ресурсы)

Нужен **Docker Desktop**. База и S3 поднимаются одной командой:

```powershell
Copy-Item .env.example .env
docker compose up -d
cd backend
npm install
npm run migrate
npm run dev
```

### Способ B — портативный PostgreSQL (для слабых машин)

Ничего не устанавливается в систему, права администратора не нужны.
One-time setup (300 МБ скачивание):

```powershell
# 1. Скачать портативную сборку и распаковать в .local\pgsql
Invoke-WebRequest "https://get.enterprisedb.com/postgresql/postgresql-16.9-1-windows-x64-binaries.zip" -OutFile .local\pg16.zip
Expand-Archive .local\pg16.zip -DestinationPath .local -Force

# 2. Один раз инициализировать кластер
"domkrug_dev_password" | Out-File -Encoding ascii -NoNewline .local\pwfile.txt
.local\pgsql\bin\initdb.exe -D .local\pgdata -U domkrug --pwfile=.local\pwfile.txt `
  --encoding=UTF8 --locale=C --auth-local=scram-sha-256 --auth-host=scram-sha-256
Remove-Item .local\pwfile.txt

# 3. Запустить и создать базу
.\scripts\db-start.ps1
$env:PGPASSWORD="domkrug_dev_password"
.local\pgsql\bin\createdb.exe -h localhost -U domkrug -E UTF8 domkrug_dev
Remove-Item Env:\PGPASSWORD

# 4. Миграции
Copy-Item .env.example .env
cd backend
npm install
npm run migrate
npm run dev
```

Ежедневно: `.\scripts\db-start.ps1` → `cd backend; npm run dev`.
Остановить базу: `.\scripts\db-stop.ps1`.

### Проверка

Открыть http://localhost:3000/health — `{"status":"ok"}`.
Проверка подключения к БД: http://localhost:3000/health/ready — `{"status":"ok","checks":{"database":true}}`.

---

## Структура репозитория

```
backend/              — API (Fastify + TypeScript)
  src/
    config.ts         — валидация переменных окружения
    app.ts            — сборка Fastify-приложения
    index.ts          — точка входа
    db/
      pool.ts         — пул соединений PostgreSQL
      migrate.ts      — раннер SQL-миграций
    modules/
      health/         — служебные эндпоинты
  migrations/         — SQL-миграции (001 … 027)
docs/                 — проектные документы
docker-compose.yml    — PostgreSQL (+ S3-хранилище в профиле storage)
```

---

## Команды (из папки `backend`)

| Команда | Что делает |
|---|---|
| `npm run dev` | Запуск с автоперезагрузкой |
| `npm run build` | Сборка в `dist/` |
| `npm start` | Запуск собранной версии |
| `npm run typecheck` | Проверка типов без сборки |
| `npm run migrate` | Применить миграции БД |
| `npm run test:api` | Интеграционные тесты API (нужен запущенный сервер) |
| `npm run check:text` | Найти в БД тексты с потерянной кодировкой (`??`) |
| `npm run db:reset` | Пересоздать схему (только вне production) |
| `npm test` | Тесты |

---

## Демо-данные

После `npm run db:seed` в базе появляются две УК. **Все данные вымышленные**, телефоны
в диапазоне `+7 900 000-XX-XX` — совпадение с реальными номерами исключено.

**Пароль всех демо-пользователей: `Demo1234!`** (только для локальной демонстрации).

### УК-1 «Дом-Сервис» (`dom-service`) — основной демонстрационный тенант

| Телефон | Кто | Роль |
|---|---|---|
| `+79000000001` | Администратор | `uk_admin` |
| `+79000000002` | Диспетчер | `dispatcher` |
| `+79000000003` | Петров (сантехник) | `executor` |
| `+79000000004` | Сидоров (электрик) | `executor` |
| `+79000000101` | Иванов, кв. 1 | `resident`, **подтверждён** |
| `+79000000102` | Петрова, кв. 2 | `resident`, подтверждён |
| `+79000000103` | Смирнов, кв. 3 | `resident`, подтверждён |
| `+79000000104` | Кузнецова, кв. 4 | `resident`, подтверждён |
| `+79000000105` | Волков, кв. 5 | `resident`, **ожидает подтверждения** |

Дом: г. Барнаул, ул. Ленина, 1 — 3 подъезда, 9 этажей, 12 квартир.

### УК-2 «ЖилКомфорт» (`zhilkomfort`) — для проверки изоляции

| Телефон | Кто | Роль |
|---|---|---|
| `+79000000021` | Администратор | `uk_admin` |
| `+79000000022` | Диспетчер | `dispatcher` |
| `+79000000201` | Орлов, кв. 1 | `resident`, подтверждён |
| `+79000000202` | Зайцева, кв. 2 | `resident`, подтверждён |

Дом: г. Барнаул, ул. Мира, 5 — 6 квартир, 1 заявка (нужна, чтобы проверять изоляцию).

### Заявки УК-1 (10 штук)

| № | Статус | Что проверяет |
|---|---|---|
| 1 | Закрыта | обычный цикл, есть повторное обращение №10 |
| 2 | Закрыта | аварийная (электрика) |
| 3 | Закрыта | заявка по МОП без квартиры (`apartment_id = NULL`) |
| 4 | В работе | назначен исполнитель |
| 5 | Ожидает материалов | служебный комментарий |
| 6 | Новая | **аварийная** (лифт), создана диспетчером по телефону |
| 7 | Новая | житель без подтверждённой привязки — заявку завёл диспетчер |
| 8 | Отклонена | причина отказа |
| 9 | В работе, **просрочена по SLA** | подсветка просрочки |
| 10 | Новая | **повторное обращение** со ссылкой на №1 |

### Пересоздать демо-данные

```powershell
cd backend
npm run db:reset      # удаляет схему (только NODE_ENV != production)
npm run migrate
npm run db:seed
```

Скрипт сида идемпотентен: если данные уже есть — ничего не делает и подсказывает
команды выше. Удалять данные «на всякий случай» он не станет: в базе могут быть
результаты ручной проверки.

---

## Соглашения

- Не коммитить `.env`, секреты, дампы БД, `node_modules`.
- Секреты — только в DPAPI-хранилище (`C:\Users\<user>\.dsh\secrets\`), не в репозитории.
- Демо-данные — только тестовые, без реальных персональных данных.
- Каждое изменение — отдельный осмысленный коммит с описанием «что и почему».

## Лицензия

Проприетарная. Все права защищены.






