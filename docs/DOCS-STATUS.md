# Статус документации

**Актуально на:** 08.11.2026
**Источник истины по коду:** `backend/src`, `backend/migrations`, `apps/`,
`packages/` и `PROGRESS.md` (журнал).

## Актуальные цифры

| Показатель | Значение |
|---|---|
| Миграции | 27 (`backend/migrations/001…027`) |
| API-тесты | 112 |
| Юнит-тесты backend | 32 |
| Тесты frontend | 24 |
| Таблицы | 30 (29 бизнес- + `schema_migrations`) |

Проверка: `npm --prefix backend run test:api`, `npm --prefix backend test`,
`npm test`, `npm run build`.

## Статусы документов

| Документ | Статус | Комментарий |
|---|---|---|
| `README.md` | ACTIVE | Верхние цифры обновлены 08.11.2026 |
| `START-HERE.md` | ACTIVE | Верхние цифры обновлены; поздние разделы — исторические |
| `PROGRESS.md` | ACTIVE (журнал) | Цифры в ранних разделах — на дату записи |
| `docs/DB-SCHEMA.md` | HISTORICAL | Первоначальный проект; фактическая схема — миграции |
| `docs/OBJECT-MODEL.md` | ACTIVE | Объектная модель, паспорт и собственники |
| `docs/A11Y-REPORT.md` | ACTIVE | A11y-прогон 09.11.2026 |
| `docs/MAIL.md` | ACTIVE | Состояние корпоративной почты и блокер активации |
| `docs/API-CONTRACT.md` | TARGET/CONTRACT | Целевой контракт; реализовано частично |
| `docs/WHATS-DONE.md` | HISTORICAL | Сводка этапа, не текущее состояние |
| `docs/TZ-v1.1.md`, `docs/MVP-SCOPE.md` | HISTORICAL | Исходное ТЗ/границы |
| `docs/SECURITY-REVIEW-2026-11-08.md` | ACTIVE | Известные исправления и блокеры |
| `docs/CI.md` | ACTIVE | Workflow и ограничение токена |
| `docs/DESIGN.md` | ACTIVE | Foundation обновлён в ветке `design/ui-kit-foundation` |
| `docs/DESIGN-IMPLEMENTATION.md` | ACTIVE | План внедрения UI Kit и открытые решения |

Если документ противоречит коду, прав код; противоречие нужно исправить в
документе, а не подстраивать код под старую версию.





