# Фронтенд «ДомКруг»

Vite + React + TypeScript. Один бандл на все роли: экраны различаются правами,
а не отдельными приложениями.

## Запуск

Нужны два процесса: API на `:3000` и этот dev-сервер на `:5173`.

```powershell
# 1. База и API (из корня репозитория)
powershell -ExecutionPolicy Bypass -File scripts\db-start.ps1
cd backend; npm run migrate; npm run db:seed; npm run dev

# 2. Фронтенд (второе окно)
cd frontend
npm install
npm run dev        # http://localhost:5173
```

Демо-входы — на самой форме входа, пароль `Demo1234!`.

## Скрипты

| Команда | Что делает |
|---|---|
| `npm run dev` | Dev-сервер с HMR и прокси `/api` → `:3000` |
| `npm run build` | Проверка типов + production-сборка в `dist/` |
| `npm run test` | Юнит-тесты утилит (Vitest) |
| `npm run preview` | Посмотреть собранное локально |
| `npm run lint` | Oxlint |

## Почему прокси, а не CORS

Refresh-токен живёт в httpOnly cookie с `SameSite=Strict`. Если фронт и API —
разные origin, браузер cookie не отправит. Прокси Vite делает запросы
same-origin, как будет в production за nginx. Ослаблять CORS ради разработки
не стали — см. `docs/DECISIONS.md` от 03.11.2026.

## Структура

```
src/
  lib/
    api.ts        клиент: токен в памяти, refresh на 401, разбор ошибок
    auth.tsx      AuthProvider: вход, выход, восстановление сессии после F5
    format.ts     даты, телефоны, статусы (цвет + текст всегда вместе)
    types.ts      типы ответов API
    useTickets.ts загрузка списка заявок
  components/     Button, Field, StatusBadge, TicketCard, EmptyState, Spinner, Layout
  pages/          LoginPage, resident/, staff/, executor/, ProfilePage
  styles/         tokens.css (дизайн-система), global.css
```

## Соглашения

- Access-токен — **только в памяти**. В `localStorage` не кладём: XSS его достанет.
- Статус заявки — всегда **цвет и текст**. Только цветом нельзя (DESIGN.md п. 2.3).
- Зона нажатия — не меньше 44×44px на любом экране.
- Ошибки API показываем человеческим текстом, `requestId` — в консоль, не пользователю.
- Заглушки экранов честно говорят «ещё не готово», а не имитируют работу.

## Что ещё не сделано

По `docs/FRONTEND-PLAN.md` осталось: создание заявки (шаг 3), карточка заявки
с действиями (шаг 5), привязка квартиры (шаг 7), PWA-манифест (шаг 8).
