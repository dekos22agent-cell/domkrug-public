#!/usr/bin/env bash
#
# Preflight живого теста параллельного вызова домофона.
#
# Ничего не звонит и не меняет: только проверяет, что туннель, Asterisk и
# диалплан готовы, и печатает, чего не хватает.
#
# Запуск на сервере:
#   bash scripts/intercom-parallel-check.sh
set -uo pipefail

PANEL_URL="${PANEL_URL:-http://127.0.0.1:18081}"
failed=0

echo "1. Туннель до панели ($PANEL_URL)"
code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$PANEL_URL/ISAPI/System/deviceInfo" || true)"
if [ "$code" = "401" ] || [ "$code" = "200" ]; then
  echo "   OK: панель отвечает ($code)"
else
  echo "   НЕТ: панель не отвечает (код '${code:-нет}')"
  failed=1
fi

echo "2. Триггер в диалплане"
dialplan="$(sudo asterisk -rx 'dialplan show from-panel' 2>/dev/null || true)"
if [[ "$dialplan" == *"ring-indoor.py"* ]]; then
  echo "   OK: ring-indoor.py вызывается из from-panel"
else
  echo "   НЕТ: в from-panel нет вызова ring-indoor.py"
  failed=1
fi

contacts="$(sudo asterisk -rx 'pjsip show contacts' 2>/dev/null || true)"

echo "3. Панель 6001 в Asterisk"
if [[ "$contacts" == *"Contact:  6001/"* ]]; then
  echo "   OK: панель зарегистрирована"
else
  echo "   ВНИМАНИЕ: панель 6001 не в контактах — звонок не придёт"
  failed=1
fi

echo "4. Монитор (indoor)"
monitor=0
for ext in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16; do
  if [[ "$contacts" == *"Contact:  ${ext}/"* ]]; then
    monitor=1
    break
  fi
done
if [ "$monitor" -eq 1 ]; then
  echo "   OK: SIP-контакт монитора есть"
else
  echo "   ПРИМЕЧАНИЕ: SIP-контакта монитора нет."
  echo "   Для callSignal это не обязательно: вызов идёт по внутреннему"
  echo "   протоколу панели. Нужен подключённый монитор и человек у панели."
fi

echo "5. Последние попытки ring-indoor"
if sudo test -f /tmp/ring-indoor.log; then
  sudo tail -5 /tmp/ring-indoor.log
else
  echo "   журнала пока нет — это нормально, если звонков ещё не было"
fi

echo
if [ "$failed" -eq 0 ]; then
  echo "ГОТОВО к живому тесту: нажмите кнопку на панели и смотрите"
  echo "/tmp/ring-indoor.log и входящий вызов в приложении."
  exit 0
fi

echo "НЕ ГОТОВО: см. пункты выше."
exit 1
