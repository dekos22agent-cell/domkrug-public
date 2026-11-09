#!/usr/bin/env bash
#
# Включает поддомены app.liviti.ru и uk.liviti.ru.
#
# Запускать ТОЛЬКО после того, как DNS-записи появились и резолвятся:
# сертификаты Caddy выпускает по HTTP-01 и без DNS не получит их.
#
# Проверка перед запуском:
#   getent hosts app.liviti.ru uk.liviti.ru
#   оба должны отвечать 198.51.100.10
#
# Что делает:
#   1. сохраняет копию Caddyfile;
#   2. добавляет блоки app.liviti.ru и uk.liviti.ru (раздача своих dist);
#   3. старые пути /app и /uk превращает в редиректы на поддомены;
#   4. проверяет конфиг и перезагружает Caddy без простоя.
#
# Откат: cp /etc/caddy/Caddyfile.bak.* /etc/caddy/Caddyfile && systemctl reload caddy
set -euo pipefail

HOST_IP="${HOST_IP:-198.51.100.10}"

for host in app.liviti.ru uk.liviti.ru; do
  resolved="$(getent hosts "$host" | awk '{print $1}' | head -1 || true)"
  if [ "$resolved" != "$HOST_IP" ]; then
    echo "DNS для $host ещё не готов (сейчас: '${resolved:-нет}'). Подождите распространения записей."
    exit 1
  fi
done

sudo cp -a /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%F-%H%M%S)"

sudo python3 - <<'PY'
path = "/etc/caddy/Caddyfile"
text = open(path, encoding="utf-8").read()

if "app.liviti.ru" in text:
    print("поддомены уже настроены — ничего не меняю")
    raise SystemExit(0)

# Старые пути больше не раздают приложения: отправляем на поддомены.
old_app = (
    "\thandle_path /app/* {\n"
    "\t\troot * /srv/domkrug/apps/resident/dist\n"
    "\t\ttry_files {path} /index.html\n"
    "\t\tfile_server\n"
    "\t}\n"
)
old_uk = (
    "\thandle_path /uk/* {\n"
    "\t\troot * /srv/domkrug/apps/staff/dist\n"
    "\t\ttry_files {path} /index.html\n"
    "\t\tfile_server\n"
    "\t}\n"
)
if old_app in text and old_uk in text:
    text = text.replace(old_app, "", 1)
    text = text.replace(old_uk, "", 1)
    text = text.replace(
        "\tredir /app /app/ 308\n\tredir /uk /uk/ 308\n",
        "\t# Приложения переехали на поддомены\n"
        "\tredir /app /app/ 308\n"
        "\tredir /app/* https://app.liviti.ru{uri} 308\n"
        "\tredir /uk /uk/ 308\n"
        "\tredir /uk/* https://uk.liviti.ru{uri} 308\n",
        1,
    )

blocks = """
# ─── Приложение жителя ──────────────────────────────────────────────────
app.liviti.ru {
	encode gzip

	handle /api/* {
		reverse_proxy 127.0.0.1:3000
	}
	handle /health* {
		reverse_proxy 127.0.0.1:3000
	}
	handle /ws* {
		reverse_proxy https://127.0.0.1:8089 {
			transport http {
				tls
				tls_insecure_skip_verify
			}
		}
	}
	handle {
		root * /srv/domkrug/apps/resident/dist
		try_files {path} /index.html
		file_server
	}
}

# ─── Кабинет УК ─────────────────────────────────────────────────────────
uk.liviti.ru {
	encode gzip

	handle /api/* {
		reverse_proxy 127.0.0.1:3000
	}
	handle /health* {
		reverse_proxy 127.0.0.1:3000
	}
	handle {
		root * /srv/domkrug/apps/staff/dist
		try_files {path} /index.html
		file_server
	}
}
"""

text = text.rstrip("\n") + "\n" + blocks
open(path, "w", encoding="utf-8").write(text)
print("Caddyfile: поддомены добавлены")
PY

sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
systemctl is-active caddy

echo "--- проверка ---"
for host in app uk; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://$host.liviti.ru/")
  echo "https://$host.liviti.ru/ -> $code"
done
