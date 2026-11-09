#!/bin/bash
# Установка go2rtc: RTSP вызывной панели -> поток для браузера.
#
# Зачем медиасервер: панель отдаёт видео по RTSP, браузер этот протокол не
# понимает. go2rtc забирает RTSP и отдаёт mp4 по HTTP
# (/api/stream.mp4?src=panel), а такой URL играет в обычном <video> без
# библиотек — в отличие от HLS (нужен hls.js) и WebRTC (нужен отдельный плеер).
# Для домофона задержка около секунды приемлема.
#
# Схема доступа:
#   панель 192.168.2.109:554  ──(SSH-туннель)──  127.0.0.1:18083
#                                                     │
#                                              go2rtc (127.0.0.1:1984)
#                                                     │
#                                            Caddy /go2rtc/*  (HTTPS)
#                                                     │
#                                                  браузер
#
# Наружу медиасервер не смотрит: API только на loopback, WebRTC выключен
# (он открыл бы 8555/udp в интернет, а нам нужен только mp4 через HTTPS).
#
# Пароль панели лежит в /etc/go2rtc/panel.env (600 root) и подставляется в
# адрес потока systemd-юнитом — в конфиге go2rtc и в списке процессов его нет.
set -euo pipefail

echo "=== скачиваю go2rtc ==="
curl -fsSL "https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_linux_amd64" \
  -o /usr/local/bin/go2rtc
chmod 755 /usr/local/bin/go2rtc
/usr/local/bin/go2rtc --version 2>&1 | head -1 || true

install -d -m 755 /etc/go2rtc

if [ ! -f /etc/go2rtc/panel.env ]; then
  cat > /etc/go2rtc/panel.env <<'EOF'
# Учётка вызывной панели для RTSP.
# Hikvision DS-KD9633/9403 держит одну учётную запись — admin
# (docs/INTERCOM-HIKVISION.md, раздел 15). Пароль вписать здесь.
PANEL_USER=admin
PANEL_PASS=
EOF
  chmod 600 /etc/go2rtc/panel.env
  echo "создан /etc/go2rtc/panel.env — впишите PANEL_PASS"
fi

cat > /etc/go2rtc/go2rtc.yaml <<'EOF'
# go2rtc: RTSP панели -> mp4 для браузера
api:
  listen: "127.0.0.1:1984"   # наружу отдаёт только Caddy
  origin: "https://liviti.ru"

rtsp:
  listen: ""                 # входящий RTSP не нужен

# WebRTC не используем: браузер играет mp4 через Caddy.
# Без этого блока go2rtc открывает 8555/udp наружу.
webrtc:
  listen: ""

log:
  level: info

streams:
  # Подставляется systemd-юнитом из /etc/go2rtc/panel.env
  panel: "${PANEL_RTSP}"
EOF

chmod 644 /etc/go2rtc/go2rtc.yaml

cat > /etc/systemd/system/go2rtc.service <<'EOF'
[Unit]
Description=go2rtc — RTSP панели в браузер
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/go2rtc/panel.env
ExecStart=/bin/bash -c 'export PANEL_RTSP="rtsp://${PANEL_USER}:${PANEL_PASS}@127.0.0.1:18083/Streaming/Channels/101"; exec /usr/local/bin/go2rtc -config /etc/go2rtc/go2rtc.yaml'
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now go2rtc
sleep 3
systemctl is-active go2rtc

echo "=== проверка ==="
curl -s -o /dev/null -w 'API go2rtc: %{http_code}\n' --max-time 5 http://127.0.0.1:1984/api/streams
curl -s --max-time 5 http://127.0.0.1:1984/api/streams | head -c 200
echo
echo "=== ГОТОВО. Не забудьте блок в Caddyfile: ==="
cat <<'EOF'
	handle_path /go2rtc/* {
		reverse_proxy 127.0.0.1:1984
	}
EOF
