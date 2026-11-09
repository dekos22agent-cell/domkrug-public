#!/bin/bash
# Подготовка Asterisk к звонкам из браузера (WebRTC).
#
# Что делаем:
#   1. Отдельный диапазон медиа-портов для WebRTC (30000-30200) и открытие его
#      в файрволе. Прежний 10000-20000 закрыт для всех, кроме офиса — он нужен
#      панели, браузер туда не достучится.
#   2. Абонент 100 получает настройки WebRTC: DTLS-SRTP, ICE, rtcp-mux,
#      кодек Opus в дополнение к G.711 (Asterisk перекодирует в alaw для панели).
#
# Резервные копии обязательны: это рабочая телефония стенда.
set -euo pipefail

echo "=== 1. rtp.conf: диапазон портов ==="
cp -a /etc/asterisk/rtp.conf /root/rtp.conf.before-webrtc
cat > /etc/asterisk/rtp.conf <<'EOF'
[general]
; Диапазон медиа-портов Asterisk.
; 30000-30200 открыт в интернет для звонков из браузера (WebRTC):
; медиа там шифруется DTLS-SRTP, но порты должны быть доступны снаружи,
; иначе житель не услышит панель.
rtpstart=30000
rtpend=30200
EOF

echo "=== 2. абонент 100: настройки WebRTC ==="
cp -a /etc/asterisk/pjsip.conf /root/pjsip.conf.before-webrtc

python3 - <<'PY'
p = "/etc/asterisk/pjsip.conf"
text = open(p, encoding="utf-8").read()

# Ищем секцию [100] (endpoint) и добавляем WebRTC-параметры, если их нет
if "webrtc=yes" not in text:
    marker = "[100](app-endpoint)"
    idx = text.find(marker)
    if idx < 0:
        raise SystemExit("ОШИБКА: не найден [100](app-endpoint)")

    end = text.find("\n[", idx + len(marker))
    if end < 0:
        end = len(text)

    block = text[idx:end].rstrip("\n")
    block += (
        "\n; --- WebRTC для браузера (житель звонит и слышит с сайта) ---\n"
        "webrtc=yes                 ; DTLS-SRTP, ICE, rtcp-mux и avpf одним флагом\n"
        "transport=transport-wss    ; только через защищённый WebSocket\n"
        "allow=opus                 ; браузер любит Opus\n"
        "allow=alaw                 ; в этот кодек Asterisk перекодирует для панели\n"
        "allow=ulaw\n"
        "media_encryption=dtls\n"
        "dtls_auto_generate_cert=yes\n"
        "ice_support=yes\n"
        "direct_media=no\n"
        "rewrite_contact=yes\n"
    )
    text = text[:idx] + block + text[end:]
    open(p, "w", encoding="utf-8").write(text)
    print("настройки WebRTC добавлены в [100]")
else:
    print("WebRTC уже настроен")
PY

echo "=== 3. файрвол: медиа-порты для браузера ==="
if ! sudo ufw status | grep -q "30000:30200/udp"; then
  sudo ufw allow 30000:30200/udp comment 'WebRTC media (browser calls)'
  sudo ufw allow 30000:30200/udp comment 'WebRTC media v6' >/dev/null 2>&1 || true
fi

echo "=== 4. перезагрузка и проверка ==="
sudo systemctl restart asterisk
sleep 6
systemctl is-active asterisk

echo "--- транспорты ---"
sudo asterisk -rx 'pjsip show transports' | grep -E "transport-wss|Objects"

echo "--- абонент 100 ---"
sudo asterisk -rx 'pjsip show endpoint 100' | grep -E "webrtc|media_encryption|allow |ice_support|transport|dtls" | head -10

echo "--- порты ---"
sudo ufw status | grep -E "30000:30200|5060" | head -5
