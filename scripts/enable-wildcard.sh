#!/usr/bin/env bash
#
# Включает кабинет УК на своём поддомене: <slug>.liviti.ru.
#
# ПОЧЕМУ ОДИН WILDCARD-БЛОК, А НЕ ОТДЕЛЬНЫЕ БЛОКИ app/uk/www.
# Проверено 07.11.2026 на этом Caddy: если рядом с `*.liviti.ru` оставить
# точные блоки app.liviti.ru / uk.liviti.ru / www.liviti.ru, TLS-политика
# wildcard перекрывает их, и они начинают отдавать handshake error.
# Поэтому все поддомены живут в одном блоке, а app/uk/www разведены
# host-матчерами внутри него.
#
# Что делает:
#   1. проверяет DNS и что валидатор Caddy уже отвечает 200;
#   2. сохраняет копию Caddyfile;
#   3. добавляет on_demand_tls и единый блок *.liviti.ru;
#   4. проверяет конфиг и перезагружает Caddy;
#   5. проверяет все адреса; при любой ошибке сам откатывает Caddyfile.
#
# Откат вручную:
#   cp /etc/caddy/Caddyfile.bak.<дата> /etc/caddy/Caddyfile && systemctl reload caddy
#
# Использование:
#   bash scripts/enable-wildcard.sh
#   SLUG=zhilkomfort bash scripts/enable-wildcard.sh
set -euo pipefail

HOST_IP="${HOST_IP:-198.51.100.10}"
SLUG="${SLUG:-dom-service}"

for host in "$SLUG.liviti.ru" app.liviti.ru uk.liviti.ru www.liviti.ru; do
  resolved="$(getent hosts "$host" | awk '{print $1}' | head -1 || true)"
  if [ "$resolved" != "$HOST_IP" ]; then
    echo "DNS для $host ещё не готов (сейчас: '${resolved:-нет}')."
    exit 1
  fi
done

# Валидатор должен разрешать и УК, и служебные хосты: они теперь тоже
# получают сертификаты через on-demand.
for domain in "$SLUG.liviti.ru" app.liviti.ru uk.liviti.ru www.liviti.ru; do
  code="$(curl -s -o /dev/null -w '%{http_code}' \
    "http://127.0.0.1:3000/api/v1/internal/tls/allow?domain=$domain" || true)"
  if [ "$code" != "200" ]; then
    echo "Валидатор Caddy отвечает $code на $domain (ждём 200)."
    echo "Сначала задеплойте бэкенд с обновлённым /api/v1/internal/tls/allow."
    exit 1
  fi
done

bad="$(curl -s -o /dev/null -w '%{http_code}' \
  "http://127.0.0.1:3000/api/v1/internal/tls/allow?domain=evil.com" || true)"
if [ "$bad" != "403" ]; then
  echo "Валидатор пропускает чужой домен (evil.com -> $bad). Останавливаюсь."
  exit 1
fi

BACKUP="/etc/caddy/Caddyfile.bak.$(date +%F-%H%M%S)"
sudo cp -a /etc/caddy/Caddyfile "$BACKUP"

sudo python3 - <<'PY'
path = "/etc/caddy/Caddyfile"
text = open(path, encoding="utf-8").read()

if "*.liviti.ru" in text:
    print("wildcard уже настроен — ничего не меняю")
    raise SystemExit(0)

if "on_demand_tls" not in text:
    text = """{
\ton_demand_tls {
\t\task http://127.0.0.1:3000/api/v1/internal/tls/allow
\t}
}

""" + text

old_www = "www.liviti.ru, 1brn.ru, www.1brn.ru {"
if old_www not in text:
    raise SystemExit("не нашёл блок www — конфиг изменился, остановился")
text = text.replace(old_www, "1brn.ru, www.1brn.ru {", 1)
text = text.replace(
    "# www и прежний адрес — только перенаправление.",
    "# Прежние адреса — только перенаправление.",
    1,
)

marker = "# ─── Приложение жителя"
index = text.find(marker)
if index == -1:
    raise SystemExit("не нашёл блок приложения жителя — конфиг изменился, остановился")

wildcard = """
# ─── Поддомены: кабинет УК и служебные хосты ─────────────────────────────
# Один блок на все поддомены. Caddy с on_demand_tls перекрывает TLS точных
# блоков (app/uk/www получали handshake error), поэтому служебные хосты
# разведены host-матчерами внутри wildcard-блока.
*.liviti.ru {
\ttls {
\t\ton_demand
\t}
\tencode gzip

\t# Приложение жителя
\t@app host app.liviti.ru
\thandle @app {
\t\thandle /api/* {
\t\t\treverse_proxy 127.0.0.1:3000
\t\t}
\t\thandle /health* {
\t\t\treverse_proxy 127.0.0.1:3000
\t\t}
\t\thandle /ws* {
\t\t\treverse_proxy https://127.0.0.1:8089 {
\t\t\t\ttransport http {
\t\t\t\t\ttls
\t\t\t\t\ttls_insecure_skip_verify
\t\t\t\t}
\t\t\t}
\t\t}
\t\thandle {
\t\t\troot * /srv/domkrug/apps/resident/dist
\t\t\ttry_files {path} /index.html
\t\t\tfile_server
\t\t}
\t}

\t# Общий кабинет УК
\t@uk host uk.liviti.ru
\thandle @uk {
\t\thandle /api/* {
\t\t\treverse_proxy 127.0.0.1:3000
\t\t}
\t\thandle /health* {
\t\t\treverse_proxy 127.0.0.1:3000
\t\t}
\t\thandle {
\t\t\troot * /srv/domkrug/apps/staff/dist
\t\t\ttry_files {path} /index.html
\t\t\tfile_server
\t\t}
\t}

\t# www — только редирект на основной домен
\t@www host www.liviti.ru
\thandle @www {
\t\tredir https://liviti.ru{uri} permanent
\t}

\t# Кабинет конкретной УК
\thandle {
\t\thandle /api/* {
\t\t\treverse_proxy 127.0.0.1:3000
\t\t}
\t\thandle /health* {
\t\t\treverse_proxy 127.0.0.1:3000
\t\t}
\t\thandle {
\t\t\troot * /srv/domkrug/apps/staff/dist
\t\t\ttry_files {path} /index.html
\t\t\tfile_server
\t\t}
\t}
}
"""

text = text[:index].rstrip() + "\n" + wildcard
open(path, "w", encoding="utf-8").write(text)
print("Caddyfile: on_demand_tls и единый *.liviti.ru добавлены")
PY

sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
sleep 2
systemctl is-active caddy

check() {
  local host="$1"
  local expected="$2"
  local code=""
  for _ in $(seq 1 20); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "https://$host/" || true)"
    if [ "$code" = "$expected" ]; then
      echo "OK  https://$host/ -> $code"
      return 0
    fi
    sleep 2
  done
  echo "FAIL https://$host/ -> $code (ожидали $expected)"
  return 1
}

failed=0
check liviti.ru 200 || failed=1
check app.liviti.ru 200 || failed=1
check uk.liviti.ru 200 || failed=1
check www.liviti.ru 301 || failed=1
check "$SLUG.liviti.ru" 200 || failed=1

if [ "$failed" -ne 0 ]; then
  echo "Что-то сломалось — откатываю Caddyfile из $BACKUP"
  sudo cp -a "$BACKUP" /etc/caddy/Caddyfile
  sudo systemctl reload caddy
  echo "Откат выполнен. Смотри журнал: sudo journalctl -u caddy -n 50"
  exit 1
fi

echo "Готово: https://$SLUG.liviti.ru/ и служебные поддомены работают."
