# Контракт API — «ДомКруг» MVP

**Версия документа:** 1.0
**Дата:** 02.11.2026
**Статус:** TARGET/CONTRACT — целевой контракт, реализован частично.
Фактические маршруты — `backend/src/modules/*/routes.ts`; см. `docs/DOCS-STATUS.md`.
**Стиль:** REST, JSON, версионирование через URL

---

## 1. Соответствие OpenAPI

**Решение:** человекочитаемый контракт — этот документ; машинный `openapi.yaml` **генерируется из кода** (схемы Zod → OpenAPI) при реализации.

**Почему не писать YAML руками сейчас:**

- два источника правды (документ и код) неизбежно расходятся; через месяц YAML будет врать;
- генерация из одного источника (типы запросов/ответов в коде) исключает расхождение;
- на этапе проектирования важнее согласовать **форму** API, а не его синтаксис.

**Что это значит практически:** когда появится первый эндпоинт, рядом появится `openapi.yaml`, собранный автоматически. До этого — этот документ.

---

## 2. Общие соглашения

### 2.1. Базовый URL и версия

```
https://api.<домен>/api/v1
```

Локально: `http://localhost:3000/api/v1`

Версия в пути. При несовместимых изменениях — `/api/v2`, старая живёт параллельно минимум 3 месяца (на пилоте — пока жива соответствующая сборка клиента).

### 2.2. Аутентификация

| Токен | Где | Время жизни |
|---|---|---|
| Access | `Authorization: Bearer <jwt>` | 15 минут |
| Refresh | httpOnly cookie `refresh_token`, `Secure`, `SameSite=Strict` | 30 дней, ротация при каждом использовании |

**Правила:**

- Access-токен **не** хранится в `localStorage` (XSS).
- Refresh-токен — только cookie, недоступен JS.
- Ротация: при `POST /auth/refresh` старый refresh инвалидируется, выдаётся новый. Повторное использование старого = признак кражи → инвалидация всей сессии пользователя.

**Payload access-токена:**

```json
{
  "sub": "uuid пользователя",
  "tid": "uuid УК (или null для жителя без УК)",
  "roles": ["dispatcher"],
  "perms": ["ticket.view.all", "ticket.assign"],
  "iat": 1730592000,
  "exp": 1730592900
}
```

**Важно:** `tid` берётся **только** из токена. Заголовки вида `X-Tenant-Id` не поддерживаются — это дыра в изоляции.

### 2.3. Формат ошибок

Единый вид для всех ошибок:

```json
{
  "error": {
    "code": "TICKET_NOT_FOUND",
    "message": "Заявка не найдена",
    "details": null,
    "requestId": "01JCV..."
  }
}
```

**Коды HTTP:**

| HTTP | Когда |
|---|---|
| 200 / 201 / 204 | Успех |
| 400 | Невалидные данные (`VALIDATION_ERROR` + `details` по полям) |
| 401 | Нет/просрочен токен (`UNAUTHORIZED`) |
| 403 | Нет права (`FORBIDDEN`) |
| 404 | Объект не найден **или чужой тенант** (`NOT_FOUND`) |
| 409 | Конфликт состояния (`INVALID_STATUS_TRANSITION`, `ALREADY_EXISTS`) |
| 422 | Бизнес-правило (`CANNOT_CLOSE_WITHOUT_RESOLUTION`) |
| 429 | Лимит запросов (`RATE_LIMITED`) |
| 500 | Внутренняя ошибка (`INTERNAL`) |

**Правило 404 вместо 403:** обращение к объекту чужой УК возвращает **404**, а не 403. 403 подтверждает существование объекта — это утечка информации.

**`requestId`** — во всех ответах, пишется в лог. Нужен, чтобы по жалобе «не работает» найти конкретный запрос.

### 2.4. Пагинация

Курсорная, не offset — offset-пагинация «плывёт», когда добавляются новые заявки.

```
GET /tickets?limit=20&cursor=eyJpZCI6...
```

**Ответ:**

```json
{
  "items": [],
  "nextCursor": "eyJpZCI6...",
  "hasMore": true
}
```

`limit` — от 1 до 100, по умолчанию 20.

**Исключение:** справочники (категории, статусы, дома) отдаются целиком, без пагинации — их мало.

### 2.5. Идемпотентность

Для `POST`, создающих объекты (заявки, загрузка файлов), поддерживается заголовок:

```
Idempotency-Key: <uuid, генерирует клиент>
```

Повторный запрос с тем же ключом в течение 24 часов возвращает **тот же результат**, а не создаёт дубль. Это защита от двойного нажатия «Отправить» и от повторов при обрыве связи.

### 2.6. Лимиты

| Эндпоинт | Лимит |
|---|---|
| `POST /auth/login` | 10 в минуту на IP + 5 на пользователя |
| `POST /auth/register` | 5 в час на IP |
| Остальные | 100 в минуту на пользователя |
| Загрузка файла | 20 в час на пользователя |

Ответ при превышении — `429` с заголовком `Retry-After`.

### 2.7. Формат дат и ID

- Даты — ISO 8601 с зоной: `2026-11-02T18:30:00+07:00`.
- ID — UUID v4 строкой.
- Телефоны — `+7XXXXXXXXXX` (нормализуется на сервере).
- Деньги (когда появятся) — целые числа в копейках, не float.

---

## 3. Аутентификация и профиль

| Метод | Путь | Право | Описание |
|---|---|---|---|
| POST | `/auth/register` | — | Регистрация жителя |
| POST | `/auth/login` | — | Вход |
| POST | `/auth/refresh` | — (cookie) | Обновление токенов |
| POST | `/auth/logout` | — | Выход, инвалидация сессии |
| GET | `/auth/me` | — | Текущий пользователь, роли, права |
| PATCH | `/auth/me` | — | Изменение профиля (ФИО, телефон, e-mail) |
| POST | `/auth/password/change` | — | Смена пароля (требует текущий) |
| GET | `/auth/2fa` | — | Состояние второго фактора |
| POST | `/auth/2fa/setup` | — | Начать настройку, получить секрет |
| POST | `/auth/2fa/enable` | — | Подтвердить кодом и включить |
| POST | `/auth/2fa/disable` | — | Отключить (пароль + код) |
| POST | `/auth/password/forgot` | — | Запрос сброса (e-mail) |
| POST | `/auth/password/reset` | — | Сброс по токену из письма |

### 3.1. `POST /auth/register`

```json
{
  "email": "resident@example.com",
  "phone": "+79131234567",
  "password": "минимум 8 символов",
  "fullName": "Иванов Иван Иванович",
  "consentAccepted": true
}
```

**Требования:**

- `consentAccepted` **обязателен** и `true` — согласие на обработку ПДн (152-ФЗ). Факт согласия пишется в `audit_log` с версией текста согласия.
- Хотя бы один из `email`/`phone`.
- Пароль — минимум 8 символов, проверка по списку частых паролей.

**Ответ 201:**

```json
{
  "user": { "id": "...", "fullName": "...", "status": "active" },
  "requiresBinding": true
}
```

Житель после регистрации **не имеет** привязки — главный экран покажет «укажите квартиру».

### 3.2. `GET /auth/me`

```json
{
  "user": {
    "id": "...",
    "fullName": "Иванов Иван Иванович",
    "email": "...",
    "phone": "+79131234567",
    "status": "active"
  },
  "roles": ["resident"],
  "permissions": ["ticket.create", "ticket.view.own"],
  "tenant": null,
  "staff": null,
  "bindings": [
    {
      "id": "...",
      "status": "confirmed",
      "roleInApartment": "owner",
      "apartment": { "id": "...", "number": "42" },
      "building": { "id": "...", "addressText": "г. Барнаул, ул. Ленина, 1" },
      "tenant": { "id": "...", "name": "УК Дом-Сервис" }
    }
  ]
}
```

### 3.3. Второй фактор (TOTP) — добавлено 07.11.2026

Динамический код по RFC 6238: 6 цифр, шаг 30 секунд, HMAC-SHA1. Секрет
выдаётся в base32 — его принимают Google Authenticator, Authy, 1Password.

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| GET | `/auth/2fa` | — | `{ enabled, required, backupCodesLeft }` |
| POST | `/auth/2fa/setup` | — | `{ secret, otpauthUrl }`; секрет ещё не включает вход по коду |
| POST | `/auth/2fa/enable` | `{ code }` | `{ enabled, backupCodes }`; коды показываются один раз |
| POST | `/auth/2fa/disable` | `{ password, code }` | 204; `code` — TOTP или резервный |

`required` вычисляется по ролям (`uk_admin`, `dispatcher`, `platform_admin`)
и пока является подсказкой интерфейсу: жёсткой блокировки входа без
настроенного 2FA нет, чтобы не запереть пилотные учётки.

**Вход (`POST /auth/login`)** принимает необязательные `totpCode` (6 цифр)
и `backupCode`. Если второй фактор включён:

| Ситуация | Ответ |
|---|---|
| кода нет | `401 TOTP_REQUIRED` — клиент показывает поле ввода |
| код неверный | `401 INVALID_TOTP` |
| резервный код уже использован | `401 INVALID_TOTP` |

Если второй фактор выключен, поля игнорируются и вход идёт по паролю.
`/auth/me` отдаёт `twoFactor: { enabled, required, backupCodesLeft }`.

**Почему сначала пароль, потом код:** `TOTP_REQUIRED` появляется только
после верного пароля и проверки приложения — до этого нельзя раскрывать,
что учётка существует.

**Резервные коды:** 10 штук формата `XXXX-XXXX`, в базе только sha256,
одноразовые. Нужны, чтобы потеря телефона не запирала администратора.

---

## 4. Структура домов (сотрудники УК)

| Метод | Путь | Право | Описание |
|---|---|---|---|
| GET | `/complexes` | `complex.view` | Список ЖК УК |
| POST | `/complexes` | `complex.manage` | Создать ЖК |
| PATCH | `/complexes/{id}` | `complex.manage` | Изменить |
| GET | `/buildings` | `building.view` | Список домов (фильтр по ЖК) |
| POST | `/buildings` | `building.manage` | Создать дом |
| GET | `/buildings/{id}` | `building.view` | Карточка дома |
| PATCH | `/buildings/{id}` | `building.manage` | Изменить |
| GET | `/buildings/{id}/entrances` | `building.view` | Подъезды |
| POST | `/buildings/{id}/entrances` | `building.manage` | Добавить подъезд |
| GET | `/buildings/{id}/apartments` | `apartment.view` | Квартиры дома |
| POST | `/apartments` | `apartment.manage` | Создать квартиру |
| PATCH | `/apartments/{id}` | `apartment.manage` | Изменить квартиру |
| POST | `/buildings/{id}/apartments/import` | `apartment.import` | Массовый импорт CSV |

**Фильтры `GET /buildings`:** `complexId`, `q` (поиск по адресу), `status`.

**`GET /buildings/{id}`** возвращает счётчики для карточки:

```json
{
  "id": "...",
  "addressText": "г. Барнаул, ул. Ленина, 1",
  "complex": { "id": "...", "name": "ЖК Северный" },
  "stats": {
    "apartments": 120,
    "residentsConfirmed": 87,
    "openTickets": 5,
    "overdueTickets": 1
  }
}
```

---

## 5. Житель: привязка к квартире

| Метод | Путь | Право | Описание |
|---|---|---|---|
| GET | `/resident/bindings` | — (свои) | Мои привязки |
| POST | `/resident/bindings` | — (свои) | Запросить привязку |
| DELETE | `/resident/bindings/{id}` | — (свои) | Отозвать свою привязку |
| GET | `/resident/search-apartment` | — | Поиск дома/квартиры для привязки |

### 5.1. `POST /resident/bindings`

```json
{
  "apartmentId": "...",
  "roleInApartment": "owner"
}
```

**Ответ 201:**

```json
{
  "id": "...",
  "status": "pending",
  "apartment": { "number": "42" },
  "building": { "addressText": "..." },
  "tenant": { "name": "УК Дом-Сервис", "contactPhone": "+7..." }
}
```

**Ограничения:**

- одна пара (пользователь, квартира) — повторный запрос возвращает `409 ALREADY_EXISTS`;
- нельзя иметь больше 10 активных привязок (защита от перебора);
- привязка в статусе `pending` не даёт права создавать заявки.

### 5.2. `GET /resident/search-apartment`

Поиск для привязки: житель вводит адрес и номер квартиры.

```
GET /resident/search-apartment?address=Ленина 1&apartment=42
```

**Ответ:**

```json
{
  "items": [
    {
      "apartmentId": "...",
      "number": "42",
      "building": { "addressText": "г. Барнаул, ул. Ленина, 1" },
      "tenant": { "name": "УК Дом-Сервис" },
      "alreadyBound": false
    }
  ]
}
```

**Ограничение:** отдаём **только** дом, адрес, номер квартиры и название УК. ФИО жильцов, телефоны и история заявок — никогда. Иначе поиск превращается в способ разведки.

---

## 6. Заявки

### 6.1. Эндпоинты жителя

| Метод | Путь | Право | Описание |
|---|---|---|---|
| GET | `/resident/tickets` | `ticket.view.own` | Мои заявки |
| POST | `/resident/tickets` | `ticket.create` | Создать заявку |
| GET | `/resident/tickets/{id}` | `ticket.view.own` | Заявка детально |
| POST | `/resident/tickets/{id}/comments` | `ticket.comment.create` | Комментарий |
| POST | `/resident/tickets/{id}/attachments` | `ticket.attachment.upload` | Фото/файл |
| POST | `/resident/tickets/{id}/report-problem` | `ticket.create` | «Проблема не решена» |

### 6.2. Эндпоинты сотрудников УК

| Метод | Путь | Право | Описание |
|---|---|---|---|
| GET | `/tickets` | `ticket.view.all` | Инбокс с фильтрами |
| GET | `/tickets/assigned` | `ticket.view.assigned` | Мои назначенные (исполнитель) |
| GET | `/tickets/{id}` | `ticket.view.all` \| `ticket.view.assigned` | Заявка детально |
| POST | `/tickets` | `ticket.create` | Создать от имени жителя |
| POST | `/tickets/{id}/accept` | `ticket.accept` | Новая → Принята |
| POST | `/tickets/{id}/assign` | `ticket.assign` | Назначить исполнителя |
| POST | `/tickets/{id}/status` | `ticket.status.change` | Смена статуса |
| POST | `/tickets/{id}/close` | `ticket.close` | Закрыть с результатом |
| POST | `/tickets/{id}/reject` | `ticket.reject` | Отклонить |
| GET | `/tickets/{id}/history` | `ticket.view.all` \| `ticket.view.assigned` | История статусов |
| POST | `/tickets/{id}/comments` | `ticket.comment.create` | Комментарий (можно служебный) |
| POST | `/tickets/{id}/attachments` | `ticket.attachment.upload` | Вложение |
| DELETE | `/tickets/{id}` | `ticket.delete` | Скрыть заявку |

### 6.3. `POST /resident/tickets` — создание заявки

```json
{
  "apartmentId": "...",
  "categoryId": "...",
  "priority": "normal",
  "title": "Течёт кран на кухне",
  "description": "Капает под мойкой, ведро уже полное",
  "contactPhone": "+79131234567",
  "locationNote": null,
  "attachmentIds": ["...", "..."]
}
```

**Правила:**

- `apartmentId` обязателен для жителя и должен быть в его **подтверждённых** привязках → иначе `403`;
- `contactPhone` — по умолчанию телефон из профиля, но можно переопределить;
- `attachmentIds` — файлы, загруженные ранее через `/attachments` (двухфазная загрузка, см. раздел 9);
- `priority = emergency` житель может поставить, но **флаг аварийности** выставляет диспетчер — иначе все заявки станут аварийными;
- `slaDueAt` вычисляется сервером по категории, клиент его не передаёт.

**Ответ 201:**

```json
{
  "id": "...",
  "number": 42,
  "status": { "code": "new", "name": "Новая" },
  "slaDueAt": "2026-11-03T18:30:00+07:00",
  "createdAt": "2026-11-02T18:30:00+07:00"
}
```

### 6.4. `POST /tickets` — создание диспетчером

Отличается полями:

```json
{
  "buildingId": "...",
  "apartmentId": "...",
  "categoryId": "...",
  "priority": "high",
  "source": "dispatcher_phone",
  "title": "Протечка в подъезде",
  "description": "...",
  "locationNote": "подъезд 3, этаж 5, у лифта",
  "contactPhone": "+79131234567",
  "contactName": "Петрова А."
}
```

**Правила:**

- `apartmentId` может быть `null` (заявка по МОП) — тогда `locationNote` настоятельно рекомендуется (валидация: предупреждение, не ошибка);
- `source` обязателен: `dispatcher_phone` или `dispatcher_walkin`;
- `createdBy` = текущий сотрудник; привязки жителя не проверяются (заявка «от имени»);
- если `apartmentId` указан — привязываем заявку к квартире, чтобы житель её видел в своём списке (если он зарегистрирован).

### 6.5. `GET /tickets` — инбокс диспетчера

**Фильтры:**

| Параметр | Значения |
|---|---|
| `status` | `new`, `accepted`, `assigned`, `in_progress`, `waiting`, `done`, `closed`, `rejected` (можно несколько через запятую) |
| `categoryId` | UUID |
| `buildingId` | UUID |
| `assignedTo` | UUID или `me` |
| `priority` | `low`, `normal`, `high`, `emergency` |
| `onlyOverdue` | `true` — просроченные по SLA |
| `onlyEmergency` | `true` — аварийные |
| `dateFrom` / `dateTo` | ISO-даты |
| `q` | Поиск по номеру, адресу, описанию |
| `sort` | `createdAt` (по умолчанию, DESC), `slaDueAt`, `priority` |

**Элемент списка:**

```json
{
  "id": "...",
  "number": 42,
  "status": { "code": "in_progress", "name": "В работе" },
  "priority": "high",
  "category": { "id": "...", "name": "Сантехника" },
  "building": { "addressText": "г. Барнаул, ул. Ленина, 1" },
  "apartment": { "number": "42" },
  "title": "Течёт кран",
  "assignedTo": { "id": "...", "fullName": "Сидоров П." },
  "slaDueAt": "...",
  "isOverdue": true,
  "createdAt": "...",
  "source": "resident_app"
}
```

### 6.6. Переходы статусов — правила сервера

```
new ──accept──► accepted ──assign──► assigned ──status──► in_progress
                                                          │
                                        ┌─────────────────┼─────────────────┐
                                        ▼                 ▼                 ▼
                                     waiting           done             closed
                                        │
                                        └──── status ────► in_progress
new|accepted|assigned|in_progress|waiting ──reject──► rejected
```

| Переход | Кто | Обязательные поля |
|---|---|---|
| `new → accepted` | диспетчер, админ | — |
| `accepted → assigned` | диспетчер, админ | `assigneeId` |
| `assigned → in_progress` | исполнитель, диспетчер | — |
| `in_progress → waiting` | исполнитель | `comment` (что ждём) |
| `waiting → in_progress` | исполнитель | — |
| `in_progress|waiting → done` | исполнитель | `comment` |
| `done → closed` | исполнитель, админ | `resolutionNote` |
| `in_progress|waiting → closed` | исполнитель, админ | `resolutionNote` + минимум 1 фото `result_photo` |
| `* → rejected` | диспетчер, админ | `reason` |

**Недопустимый переход → `409 INVALID_STATUS_TRANSITION`.**

**Закрытие без комментария запрещено** — `422 CANNOT_CLOSE_WITHOUT_RESOLUTION`. Это компенсация решения C: житель не подтверждает, значит исполнитель обязан зафиксировать, что сделано.

### 6.7. `POST /tickets/{id}/close`

```json
{
  "resolutionNote": "Заменён картридж смесителя, течь устранена",
  "attachmentIds": ["..."]
}
```

**Ответ 200:** полная заявка с `status = closed`, `closedAt`, `closedBy`.

**Побочные эффекты:**

- запись в `ticket_status_history`;
- запись в `audit_log` (`ticket.status_change`);
- уведомление жителю (`ticket_status_changed`);
- пересчёт счётчиков дома.

### 6.8. `POST /resident/tickets/{id}/report-problem`

Замена «повторного открытия» (решение C).

```json
{
  "description": "Течь осталась, только медленнее",
  "attachmentIds": ["..."]
}
```

**Ответ 201:** новая заявка с `parentTicketId = {id}`, категория и квартира наследуются, `priority` — минимум `high`.

**Ограничения:**

- можно только по заявке в статусе `closed`;
- не чаще 1 раза в сутки по одной заявке;
- исходная заявка получает пометку «есть повторное обращение» (для аналитики).

### 6.9. `GET /tickets/{id}` — детально

```json
{
  "id": "...",
  "number": 42,
  "status": { "code": "in_progress", "name": "В работе" },
  "priority": "high",
  "source": "resident_app",
  "category": { "id": "...", "name": "Сантехника" },
  "building": { "id": "...", "addressText": "..." },
  "apartment": { "id": "...", "number": "42" },
  "title": "...",
  "description": "...",
  "locationNote": null,
  "contactPhone": "+79131234567",
  "createdBy": { "id": "...", "fullName": "..." },
  "assignedTo": { "id": "...", "fullName": "..." },
  "parentTicket": { "id": "...", "number": 31 },
  "slaDueAt": "...",
  "isOverdue": true,
  "acceptedAt": "...",
  "startedAt": "...",
  "closedAt": null,
  "resolutionNote": null,
  "attachments": [
    { "id": "...", "kind": "request_photo", "mimeType": "image/jpeg", "url": "подписанный URL, TTL 5 мин" }
  ],
  "comments": [
    {
      "id": "...",
      "author": { "id": "...", "fullName": "..." },
      "body": "...",
      "isInternal": false,
      "createdAt": "..."
    }
  ],
  "createdAt": "...",
  "updatedAt": "..."
}
```

**Что скрывается:**

- служебные комментарии (`isInternal = true`) — не отдаются жителю;
- `contactPhone` — не отдаётся исполнителю после закрытия заявки;
- `attachments` с `deleted_at` — не отдаются.

---

## 7. Привязки жителей (сотрудники УК)

| Метод | Путь | Право | Описание |
|---|---|---|---|
| GET | `/resident-bindings` | `resident_binding.view` | Список, фильтр по статусу |
| POST | `/resident-bindings/{id}/confirm` | `resident_binding.confirm` | Подтвердить |
| POST | `/resident-bindings/{id}/reject` | `resident_binding.reject` | Отклонить с причиной |
| DELETE | `/resident-bindings/{id}` | `resident_binding.revoke` | Отозвать подтверждённую |

**`POST .../reject`:**

```json
{ "reason": "Квартира не найдена в базе УК" }
```

`reason` обязателен — иначе житель не поймёт, что исправить.

---

## 8. Справочники, сотрудники, новости, уведомления

### 8.1. Категории

| Метод | Путь | Право | Описание |
|---|---|---|---|
| GET | `/ticket-categories` | `category.view` | Категории (системные + УК) |
| POST | `/ticket-categories` | `category.manage` | Своя категория УК |
| PATCH | `/ticket-categories/{id}` | `category.manage` | Изменить (только свои) |

**Правило:** системные категории (`tenantId = null`) изменять нельзя — `403`.

### 8.2. Сотрудники

| Метод | Путь | Право | Описание |
|---|---|---|---|
| GET | `/staff` | `staff.view` | Список сотрудников |
| POST | `/staff` | `staff.manage` | Добавить сотрудника |
| PATCH | `/staff/{id}` | `staff.manage` | Изменить (должность) |
| POST | `/staff/{id}/deactivate` | `staff.manage` | Деактивировать (увольнение) |
| POST | `/staff/{id}/roles` | `staff.roles.assign` | Назначить роли |

**`POST /staff`:**

```json
{
  "fullName": "Сидоров Пётр",
  "phone": "+79131234567",
  "email": null,
  "position": "Сантехник",
  "roles": ["executor"],
  "sendInvite": true
}
```

Если `sendInvite = true` — создаётся пользователь со случайным паролем и отправляется приглашение. Пароль в ответе **не возвращается**.

### 8.3. Новости

| Метод | Путь | Право | Описание |
|---|---|---|---|
| GET | `/news` | `news.view` | Лента (фильтр по уровню) |
| POST | `/news` | `news.manage` | Создать |
| PATCH | `/news/{id}` | `news.manage` | Изменить |
| POST | `/news/{id}/publish` | `news.publish` | Опубликовать |
| DELETE | `/news/{id}` | `news.delete` | Удалить (soft) |

**`POST /news`:**

```json
{
  "scope": "building",
  "buildingId": "...",
  "title": "Отключение горячей воды",
  "body": "С 3 по 5 ноября в связи с ремонтом...",
  "isEmergency": false
}
```

### 8.4. Уведомления

| Метод | Путь | Право | Описание |
|---|---|---|---|
| GET | `/notifications` | `notification.view.own` | Свои, фильтр `unread` |
| GET | `/notifications/unread-count` | `notification.view.own` | Счётчик для колокольчика |
| POST | `/notifications/{id}/read` | `notification.view.own` | Отметить прочитанным |
| POST | `/notifications/read-all` | `notification.view.own` | Прочитать все |

---

## 9. Файлы (двухфазная загрузка)

**Проблема:** если грузить файл вместе с созданием заявки, при обрыве связи теряется всё.

**Решение — две фазы:**

**Фаза 1.** `POST /attachments` — загрузка файла, получение `attachmentId`.

```
POST /attachments
Content-Type: multipart/form-data
```

```json
{
  "id": "...",
  "kind": "request_photo",
  "mimeType": "image/jpeg",
  "sizeBytes": 184320,
  "expiresAt": "2026-11-02T19:30:00+07:00"
}
```

**Фаза 2.** `POST /resident/tickets` с `attachmentIds: [...]`.

**Правила:**

- несвязанные вложения живут 1 час, затем удаляются фоновой задачей;
- белый список MIME: `image/jpeg`, `image/png`, `image/webp`, `video/mp4`, `application/pdf`;
- лимит размера: фото 10 МБ, видео 50 МБ, документ 20 МБ;
- проверка MIME — по содержимому (magic bytes), не по расширению;
- `GET /attachments/{id}/url` — возвращает подписанный URL с TTL 5 минут; прямая отдача файла через API не делается.

---

## 10. Платформенные эндпоинты

| Метод | Путь | Право | Описание |
|---|---|---|---|
| GET | `/admin/tenants` | `tenant.view` | Список УК |
| POST | `/admin/tenants` | `tenant.create` | Создать УК |
| PATCH | `/admin/tenants/{id}` | `tenant.update` | Изменить |
| POST | `/admin/tenants/{id}/suspend` | `tenant.suspend` | Приостановить |
| POST | `/admin/tenants/{id}/activate` | `tenant.suspend` | Возобновить |
| GET | `/admin/audit` | `platform.audit.view` | Платформенный аудит |
| GET | `/health` | — | Проверка живости (без авторизации) |
| GET | `/health/ready` | — | Готовность (БД, S3) |

**`platform_admin` не имеет доступа к** `/tickets`, `/buildings`, `/resident-bindings` — по ТЗ изоляция даже от суперадмина.

---

## 11. Что НЕ входит в API MVP

Перечислено явно, чтобы не было сюрпризов:

- показания счётчиков (`/meters`, `/readings`) — v2;
- начисления и платежи (`/charges`, `/payments`) — v2;
- отчёты и аналитика (`/reports`) — v2;
- интеграции (ENVIRO, домофония, платежи) — v3;
- аварийно-диспетчерская служба как отдельный API — v2;
- WebSocket/push-каналы — v2 (в MVP — polling счётчика уведомлений раз в 30 сек).

---

## 12. Итог: 76 эндпоинтов

| Группа | Кол-во |
|---|---|
| Аутентификация и профиль | 9 |
| Структура домов | 13 |
| Привязки жителя | 4 |
| Заявки жителя | 6 |
| Заявки сотрудников | 13 |
| Привязки (УК) | 4 |
| Справочники | 3 |
| Сотрудники | 5 |
| Новости | 5 |
| Уведомления | 4 |
| Файлы | 2 |
| Платформа | 6 |
| Служебные | 2 |
| **Итого** | **76** |

---

## 13. Вопросы к согласованию

1. **Поиск квартиры для привязки** (`/resident/search-apartment`) — обязателен, или житель вводит адрес/квартиру и ждёт проверки УК вручную? Поиск удобнее, но раскрывает список квартир (без ФИО). Моё мнение: поиск нужен, иначе регистрация неудобна.
2. **`report-problem`** — новая заявка или всё-таки переоткрытие? (Выбрано: новая заявка, решение C.)
3. **Аварийность** — кто ставит `priority = emergency`? (Моё мнение: диспетчер, не житель.)

---

## 14. Модули, добавленные 04.11.2026

Все маршруты — под `/api/v1`. Жительские требуют `Authorization: Bearer <access JWT>`;
гостевые — токен типа `guest` из `/guest/login`.

### 14.1 Доступ на территорию (СКУД)

| Метод | Путь | Что делает |
|---|---|---|
| GET | `/resident/access/points` | точки доступа, выданные квартирам человека |
| POST | `/resident/access/points/:id/open` | открыть точку (лимит 5/мин, журнал) |
| GET | `/resident/access/events` | журнал открытий по своим квартирам |

### 14.2 Видеонаблюдение и домофон

| Метод | Путь | Что делает |
|---|---|---|
| GET | `/resident/video/cameras` | камеры по правам квартиры |
| GET | `/resident/video/cameras/:id/stream` | поток камеры; токен живёт 5 минут |
| GET | `/resident/video/intercom/active` | активный вызов с вызывной панели |
| POST | `/resident/video/intercom/demo-call` | демо-звонок (только для показа) |
| POST | `/resident/video/:id/open` | открыть по вызову |
| POST | `/resident/video/:id/decline` | отклонить вызов |

### 14.3 Показания счётчиков

| Метод | Путь | Что делает |
|---|---|---|
| GET | `/resident/meters` | приборы активной квартиры, прошлое и текущее показание |
| GET | `/resident/meters/:id/readings` | история показаний |
| POST | `/resident/meters/:id/readings` | передать показание (`409 VALUE_DECREASED`) |

### 14.4 Лифты

| Метод | Путь | Что делает |
|---|---|---|
| GET | `/resident/lifts` | лифты дома и их статус |
| GET | `/resident/lifts/events` | журнал вызовов и сообщений |
| POST | `/resident/lifts/:id/call` | вызвать лифт (`403 LIFT_FAULT`, если неисправен) |
| POST | `/resident/lifts/:id/fault` | сообщить о неисправности → **создаёт заявку**, возвращает `ticketNumber` |

### 14.5 Экстренные сообщения и вызовы

| Метод | Путь | Что делает |
|---|---|---|
| GET | `/resident/emergency/messages` | сообщения УК по дому или всей УК |
| GET | `/resident/emergency/calls` | свои вызовы |
| POST | `/resident/emergency/calls` | вызов аварийной УК (кулдаун 300 с) |
| POST | `/resident/emergency/calls/:id/cancel` | отменить, пока не принят |

Экстренные службы (112, 101–104) в API отсутствуют намеренно: приложение
открывает набор номера, вызов идёт мимо нас.

### 14.6 Полезные телефоны

| Метод | Путь | Что делает |
|---|---|---|
| GET | `/resident/contacts` | телефоны УК и обслуживающих организаций |

### 14.7 Члены квартиры и права

| Метод | Путь | Что делает |
|---|---|---|
| GET | `/resident/members?apartmentId=` | кто имеет доступ: вид, метка, код, права, срок |
| POST | `/resident/members` | пригласить по телефону (пресет + срок) |
| POST | `/resident/members/code` | создать доступ по коду (возвращает код один раз) |
| DELETE | `/resident/members/:id?apartmentId=` | отозвать доступ |

Только владелец квартиры или член с правом `members.manage`.

### 14.8 Гостевой доступ по коду

| Метод | Путь | Что делает |
|---|---|---|
| POST | `/guest/login` | вход по коду (10 попыток/мин с адреса) |
| GET | `/guest/me` | адрес, срок, права (без персональных данных) |
| GET | `/guest/points` | точки доступа квартиры |
| POST | `/guest/points/:id/open` | открыть точку |

Гостевые маршруты не принимают пользовательский токен, а `/auth/me` и
`/resident/*` не принимают гостевой — разделение проверяется тестами.

### 14.9 Права на квартиру в ответах

`/auth/me` отдаёт два списка:

- `bindings` — подтверждённые привязки (собственник, все права);
- `memberships` — квартиры по приглашению: `preset`, `scopes`, `expiresAt`,
  `invitedByName`.

Фронтенд строит из них переключатель квартир с подписями «— моя» / «— по доступу».
---

## 15. Номера на панели, история звонков, вложения (06.11.2026)

### 15.1 Номера на вызывной панели (сотрудники УК)

| Метод | Путь | Право | Что делает |
|---|---|---|---|
| GET | `/buildings/:id/apartments` | `apartment.view` | список квартир, в ответе `intercomRoom` |
| PATCH | `/buildings/:id/apartments/:apartmentId/room` | `apartment.manage` | задать номер (`room`) или снять (`null`) |
| POST | `/buildings/:id/apartments/rooms/autofill` | `apartment.manage` | подставить номера квартир в пустые строки |

Ответ автозаполнения: `{ filled, skipped }`. Два одинаковых номера в доме
дают `409 ROOM_TAKEN` — иначе панель звонила бы в одну квартиру.

### 15.2 История звонков (житель)

| Метод | Путь | Что делает |
|---|---|---|
| GET | `/resident/video/intercom/history?limit=` | последние звонки по квартирам с правом открытия |

Статусы: `ringing`, `opened`, `declined`, `missed`, `ended`.
`durationSeconds` считается только по закрытым звонкам.

### 15.3 Вложения заявок

| Метод | Путь | Кто | Что делает |
|---|---|---|---|
| POST | `/resident/tickets/:id/attachments` | житель, своя заявка | загрузка multipart (`file`, до 10 МБ) |
| GET | `/resident/tickets/:id/attachments` | житель, своя заявка | список файлов |
| GET | `/resident/tickets/:id/attachments/:attachmentId` | житель | файл потоком |
| GET | `/tickets/:id/attachments/:attachmentId` | УК: `ticket.view.all` или `ticket.view.assigned` | файл потоком |

Тип определяется по содержимому: JPEG, PNG, WebP, PDF. Иначе
`400 UNSUPPORTED_MIME`. Чужая заявка даёт `404`, как несуществующая.

---

## 16. Wildcard-поддомены УК (07.11.2026)

| Метод | Путь | Кто | Что делает |
|---|---|---|---|
| GET | `/internal/tls/allow?domain=` | Caddy (без токена) | `200`, если `<slug>.liviti.ru` принадлежит активной УК; иначе `403` |
| GET | `/public/tenant?slug=` | все | `{ slug, name }` активной УК; иначе `404` |

Валидатор нужен для `on_demand_tls`: без него Caddy выпустил бы сертификат
на произвольный поддомен `liviti.ru` и любой мог бы выдать себя за УК.
Служебные `app`, `uk`, `www`, `api`, `mail`, `ftp` запрещены; домен должен
быть ровно одного уровня и заканчиваться на `.liviti.ru`.

Подробности — `docs/WILDCARD-SUBDOMAINS.md`.

---

## 17. UX-правки 07.11.2026

| Метод | Путь | Что изменилось |
|---|---|---|
| GET | `/auth/session` | кто вошёл, по httpOnly refresh-cookie; токен не ротируется |
| DELETE | `/resident/bindings/:id` | теперь отзывает и подтверждённую привязку (отвязка квартиры) |
| POST | `/resident/members`, `/resident/members/code` | необязательный `scopes[]` вместо выбора пресета |

**Права на точки доступа:** `access.open` (все точки, для совместимости),
`access.entrance_door`, `access.wicket`, `access.barrier`, `access.gate`,
`access.parking`. При открытии сервер сверяет тип конкретной точки.

**`/auth/me` → привязка** теперь содержит `areaTotal`, `rooms`, `kind`,
`entranceNumber`, `floorNumber`, `buildingYear`, `buildingFloors`,
`buildingEntrances`, `city`, `street`, `houseNumber` — для карточки
квартиры.

Подробности — `docs/UX-FIXES-2026-11-07.md`.