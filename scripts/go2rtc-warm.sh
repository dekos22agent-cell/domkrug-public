#!/bin/bash
# «Тёплый» поток go2rtc.
#
# Зачем: go2rtc поднимает RTSP-сессию с панелью только когда появляется
# зритель. Пока панель отвечает на RTSP, проходит 1-3 секунды — в это время
# житель видит чёрный экран. Держим одного постоянного зрителя, который просто
# выбрасывает данные: сессия с панелью уже открыта, и плеер получает первый
# кадр почти сразу.
#
# Плата: постоянные ~512 кбит/с по туннелю. Если понадобится экономить —
# остановить службу: systemctl disable --now go2rtc-warm
set -euo pipefail

cat > /etc/systemd/system/go2rtc-warm.service <<'EOF'
[Unit]
Description=go2rtc: держит поток панели открытым (первый кадр без задержки)
After=go2rtc.service
Requires=go2rtc.service

[Service]
Type=simple
# Читаем поток и выбрасываем: важно только то, что сессия с панелью открыта
ExecStart=/bin/bash -c 'while true; do curl -s -o /dev/null --max-time 3600 "http://127.0.0.1:1984/api/stream.mp4?src=panel"; sleep 2; done'
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now go2rtc-warm
sleep 8
systemctl is-active go2rtc-warm

echo "=== поток держится? (consumers не пусто) ==="
curl -s --max-time 5 http://127.0.0.1:1984/api/streams | head -c 400
echo
