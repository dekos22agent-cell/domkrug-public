#!/bin/bash
# Параллельный звонок с панели: приложение и видеомонитор одновременно.
#
# Зачем: панель умеет только последовательный вызов (монитор 30 с, потом VoIP),
# и объединить цели в одну группу прошивка не даёт. Поэтому разворачиваем
# схему на нашей стороне:
#
#   панель ──► Asterisk ──┬──► монитор (абонент 1..16)
#                         └──► приложение (окно появляется по событию AMI)
#
# На панели достаточно поставить приоритет 0 = VoIP (только наш сервер),
# а кого звать дальше — решает Asterisk.
#
# Использование:
#   asterisk-parallel-ring.sh --monitor 1    # включить параллельный звонок
#   asterisk-parallel-ring.sh --off          # вернуть прежнее поведение
#   asterisk-parallel-ring.sh --status       # что сейчас в плане
#
set -euo pipefail

CONF=/etc/asterisk/extensions.conf
BACKUP=/root/extensions.conf.before-parallel
MONITOR_EXT=""
MODE="on"

while [ $# -gt 0 ]; do
  case "$1" in
    --monitor) MONITOR_EXT="${2:-}"; shift 2 ;;
    --off) MODE="off"; shift ;;
    --status) MODE="status"; shift ;;
    *) echo "неизвестный параметр: $1" >&2; exit 2 ;;
  esac
done

if [ "$MODE" = "status" ]; then
  sudo asterisk -rx 'dialplan show from-panel'
  exit 0
fi

[ -f "$BACKUP" ] || cp -a "$CONF" "$BACKUP"

if [ "$MODE" = "off" ]; then
  python3 - "$CONF" <<'PY'
import re, sys
p = sys.argv[1]
text = open(p, encoding="utf-8").read()
new = re.sub(r'Dial\(PJSIP/\$\{EXTEN\}&PJSIP/[^,]+,30\)', 'Dial(PJSIP/${EXTEN},30)', text)
open(p, "w", encoding="utf-8").write(new)
print("прежнее поведение восстановлено")
PY
  sudo asterisk -rx 'dialplan reload' >/dev/null
  sudo asterisk -rx 'dialplan show from-panel'
  exit 0
fi

if [ -z "$MONITOR_EXT" ]; then
  echo "укажите номер монитора: --monitor 1" >&2
  exit 2
fi

# Проверяем, что такой абонент заведён в Asterisk — иначе звонок будет
# «звонить в пустоту» и это заметят не сразу.
if ! sudo asterisk -rx 'pjsip show endpoints' | grep -qE "^\s*Endpoint:\s+${MONITOR_EXT}\b"; then
  echo "ОШИБКА: в Asterisk нет абонента ${MONITOR_EXT}. Есть: $(sudo asterisk -rx 'pjsip show endpoints' | grep -oE '^\s*Endpoint:\s+[0-9]+' | awk '{print $2}' | tr '\n' ' ')" >&2
  exit 1
fi

python3 - "$CONF" "$MONITOR_EXT" <<'PY'
import re, sys
p, mon = sys.argv[1], sys.argv[2]
text = open(p, encoding="utf-8").read()

new_line = f" same => n,Dial(PJSIP/${{EXTEN}}&PJSIP/{mon},30)"

# Уже включено — меняем только номер монитора
if re.search(r'Dial\(PJSIP/\$\{EXTEN\}&PJSIP/\d+,30\)', text):
    text = re.sub(r'Dial\(PJSIP/\$\{EXTEN\}&PJSIP/\d+,30\)', f'Dial(PJSIP/${{EXTEN}}&PJSIP/{mon},30)', text)
    note = "номер монитора обновлён"
else:
    text = text.replace(" same => n,Dial(PJSIP/${EXTEN},30)", new_line, 1)
    note = "параллельный звонок включён"

open(p, "w", encoding="utf-8").write(text)
print(note)
PY

sudo asterisk -rx 'dialplan reload' >/dev/null
echo "=== план набора сейчас ==="
sudo asterisk -rx 'dialplan show from-panel'

# Учётка для монитора: кладём в файл, читаемый только root, — в переписку и
# в документацию пароль не попадает.
PASS=$(sudo grep -A3 "^\[auth${MONITOR_EXT}\]" /etc/asterisk/pjsip.conf | grep -m1 '^password=' | cut -d= -f2-)
cat > /root/monitor-sip-credentials.txt <<EOF
Учётка для видеомонитора (вписать в меню монитора: Настройки → Сеть → SIP)

  Сервер SIP : 198.51.100.10
  Порт       : 5060
  Логин      : ${MONITOR_EXT}
  Пароль     : ${PASS}
  Номер комнаты / абонента : ${MONITOR_EXT}

Файл удалить после настройки: rm /root/monitor-sip-credentials.txt
EOF
chmod 600 /root/monitor-sip-credentials.txt

echo "=== учётка для монитора записана в /root/monitor-sip-credentials.txt (600 root) ==="
