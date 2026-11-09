# Поддомены УК: `<slug>.liviti.ru`

**Дата:** 07.11.2026
**Статус:** работает, сертификат выпускается по запросу
**Код:** `backend/src/modules/internal/routes.ts`,
`backend/src/modules/public/routes.ts`,
`scripts/enable-wildcard.sh`

---

## 1. Зачем

Каждая управляющая компания получает свой адрес: `dom-service.liviti.ru`,
`zhilkomfort.liviti.ru`. Это white-label-вход: сотрудник открывает адрес
своей УК, а не общий `uk.liviti.ru`.

На этом адресе работает тот же кабинет УК. Отличие — форма входа показывает
название организации: на `dom-service.liviti.ru` видно «Кабинет
ООО «Дом-Сервис»».

---

## 2. Почему нельзя просто `*.liviti.ru` с обычным сертификатом

Wildcard-сертификат `*.liviti.ru` покрывает **один уровень** поддоменов, но
его нельзя выпустить «на всякий случай»: Let's Encrypt выдаёт wildcard только
через DNS-01, а автоматическое управление DNS-записью у нас не настроено.

Поэтому используется **on-demand TLS**: Caddy выпускает отдельный сертификат
на конкретный `dom-service.liviti.ru`, когда в него впервые приходит запрос.
Перед выпуском Caddy спрашивает наш бэкенд:

```
GET http://127.0.0.1:3000/api/v1/internal/tls/allow?domain=dom-service.liviti.ru
```

- `200` — домен принадлежит существующей активной УК, сертификат выпускается;
- `403` — отказ, сертификата не будет.

Без этой проверки любой желающий получил бы валидный сертификат на
`что-угодно.liviti.ru` и мог бы выдать себя за УК.

**Важно:** все поддомены живут в одном блоке `*.liviti.ru`. Если рядом
оставить точные блоки `app.liviti.ru`, `uk.liviti.ru`, `www.liviti.ru`,
TLS-политика wildcard перекрывает их — проверено 07.11.2026: точные хосты
начинали отдавать `handshake error`. Поэтому `app`, `uk`, `www` разведены
host-матчерами внутри wildcard-блока.

---

## 3. Эндпоинты

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/v1/internal/tls/allow?domain=` | валидатор для Caddy |
| GET | `/api/v1/public/tenant?slug=` | имя УК для формы входа |

Проверка домена:

1. приводим к нижнему регистру, снимаем порт;
2. требуем суффикс `.liviti.ru` (именно с точкой — `liviti.ru` и
   `dom-service.liviti.ru.evil.com` не подходят);
3. ровно один уровень: `[a-z0-9-]`, не длиннее 40 символов;
4. `app`, `uk`, `www` разрешены как служебные адреса того же Caddy;
   `api`, `mail`, `ftp` запрещены;
5. slug должен быть у активной УК (`tenants.status = 'active'`,
   `deleted_at IS NULL`).

`/public/tenant` отдаёт только `slug` и `name` — это публичные данные,
ничего чувствительного.

---

## 4. Конфиг Caddy

В начале Caddyfile — глобальная опция:

```
{
	on_demand_tls {
		ask http://127.0.0.1:3000/api/v1/internal/tls/allow
	}
}
```

Сайт — один блок на все поддомены:

```
*.liviti.ru {
	tls {
		on_demand
	}
	encode gzip

	@app host app.liviti.ru
	handle @app { ... }          # приложение жителя + /ws

	@uk host uk.liviti.ru
	handle @uk { ... }           # общий кабинет УК

	@www host www.liviti.ru
	handle @www {
		redir https://liviti.ru{uri} permanent
	}

	handle { ... }               # кабинет конкретной УК
}
```

Полные обработчики — в `scripts/enable-wildcard.sh`: у `@app` есть ещё
`/ws` для телефонии, у `@uk` и арендаторов — API и статика.

Точных блоков `app.liviti.ru`, `uk.liviti.ru`, `www.liviti.ru` в Caddyfile
больше нет — иначе wildcard перекрывает их TLS.

---

## 5. Как включить

```bash
# на сервере, после деплоя бэкенда
bash scripts/enable-wildcard.sh
# другой пробный поддомен:
SLUG=zhilkomfort bash scripts/enable-wildcard.sh
```

Скрипт:

1. проверяет, что `<slug>.liviti.ru` резолвится на сервер;
2. проверяет, что валидатор отвечает `200` (иначе не трогает Caddy);
3. делает бэкап `/etc/caddy/Caddyfile.bak.<дата>`;
4. добавляет `on_demand_tls` и единый блок `*.liviti.ru`, если их ещё нет;
5. `caddy validate`, `systemctl reload caddy`;
6. ждёт до 40 секунд, пока выпустится сертификат на пробный поддомен;
7. проверяет `liviti.ru`, `app`, `uk`, `www` и пробный поддомен;
8. при любой ошибке **сам откатывает** Caddyfile из бэкапа и перезагружает
   Caddy.

Скрипт идемпотентен: повторный запуск ничего не дублирует.

**Откат:**

```bash
sudo cp /etc/caddy/Caddyfile.bak.<дата> /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

---

## 6. Проверка

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://dom-service.liviti.ru/
curl -s -o /dev/null -w '%{http_code}\n' https://zhilkomfort.liviti.ru/
curl -s -o /dev/null -w '%{http_code}\n' https://uk.liviti.ru/
curl -s -o /dev/null -w '%{http_code}\n' https://www.liviti.ru/   # 308
```

Первый запрос на новый поддомен может занять несколько секунд: Caddy
выпускает сертификат. Дальше ответ мгновенный.

**Проверка отказа:** запрос на несуществующий поддомен должен упасть на
TLS, а не получить сертификат:

```bash
curl -sS https://doesnotexist-xyz.liviti.ru/ 2>&1 | head -3
# curl: (60) SSL certificate problem / no alternative certificate ...
```

---

## 7. Ограничения

### 7.1. Грабли: wildcard перекрывает TLS точных блоков

Проверено 07.11.2026. Конфиг с `*.liviti.ru` **и** отдельными блоками
`app`/`uk`/`www` адаптируется без ошибок, но в работе точные хосты
получают `TLS alert internal error`: политика wildcard выбирается раньше.
Симптом: `curl https://uk.liviti.ru/` → `000`, `dom-service` → `200`.

Лечение — один блок и host-матчеры (см. §4). Скрипт проверяет все адреса
и откатывается при ошибке.

| Ограничение | Что делать |
|---|---|
| Точные блоки рядом с wildcard | нельзя; держать один блок |
| Лимит Let's Encrypt на выпуск | поддомены выпускаются по одному при первом заходе; массово не гонять |
| Новый поддомен после смены slug | старый сертификат остаётся, но валидатор начнёт отказывать; Caddy перестанет обновлять старый |
| Удалённая УК | `status != active` → валидатор откажет; действующий сертификат живёт до истечения |
| Нет проверки владения поддоменом на уровне DNS | мы владеем зоной; уровень — список УК в базе |

---

## 8. Связанные файлы

- `backend/src/modules/internal/routes.ts` — валидатор Caddy;
- `backend/src/modules/public/routes.ts` — имя УК для формы входа;
- `apps/staff/src/pages/LoginPage.tsx` — подпись «Кабинет <название>»;
- `backend/tests/api/wildcard.test.ts` — разрешённые и запрещённые домены;
- `scripts/enable-wildcard.sh` — включение и проверка;
- `docs/SPLIT-RESIDENT-STAFF.md` §8 — история переезда на поддомены.
