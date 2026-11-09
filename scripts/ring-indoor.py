#!/usr/bin/env python3
"""
Параллельный вызов: заставляет панель позвонить монитору в обход приоритета.

Зачем это нужно
---------------
Панель Hikvision отказывается ставить `indoor` и `VoIP` в один уровень
приоритета (`400 badParameters`), то есть штатной параллели «монитор +
приложение» у неё нет. Но у неё есть команда `callSignal`, которая поднимает
вызов на внутреннюю станцию по требованию — и она работает, если выполнить
сессионный логин.

Отсюда схема:
    кнопка → панель звонит по VoIP (приложение) → Asterisk видит INVITE
           → этот скрипт → callSignal indoor roomNumber=N → звонит монитор

Оба вызова идут одновременно, разница — доли секунды.

Запускается из диалплана Asterisk в контексте `from-panel`, поэтому
учётные данные читаются из `/srv/domkrug/.env`, а не из окружения.

Использование:
    python3 ring-indoor.py 100        # номер комнаты
"""
from __future__ import annotations

import hashlib
import os
import re
import sys
import time

import requests
from requests.auth import HTTPDigestAuth

# Asterisk работает под своим пользователем, поэтому основной файл — тот,
# что читаем и он; /srv/domkrug/.env оставлен как запасной вариант для ручного запуска
ENV_FILE = os.environ.get("DOMKRUG_ENV", "/etc/domkrug/panel.env")
DEFAULT_PANEL = os.environ.get("PANEL_URL", "http://127.0.0.1:18081")
LOG = os.environ.get("RING_LOG", "/tmp/ring-indoor.log")


def log(message: str) -> None:
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"{stamp} {message}\n"
    try:
        with open(LOG, "a", encoding="utf-8") as handle:
            handle.write(line)
    except OSError:
        sys.stderr.write(line)


def read_env(path: str) -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        with open(path, encoding="utf-8") as handle:
            for raw in handle:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                values[key.strip()] = value.strip().strip('"').strip("'")
    except OSError as error:
        log(f"не прочитал {path}: {error}")
    if not values:
        # Ручной запуск: берём обычный .env проекта
        try:
            with open("/srv/domkrug/.env", encoding="utf-8") as handle:
                for raw in handle:
                    line = raw.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, value = line.partition("=")
                    values[key.strip()] = value.strip().strip('"').strip("'")
        except OSError:
            pass
    return values


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def node(xml: str, tag: str) -> str | None:
    match = re.search(rf"<{tag}[^>]*>([^<]*)</{tag}>", xml)
    return match.group(1) if match else None


def session_login(base: str, user: str, password: str) -> str | None:
    """Сессионный логин панели: без него callSignal отвечает отказом."""
    auth = HTTPDigestAuth(user, password)
    caps = requests.get(
        f"{base}/ISAPI/Security/sessionLogin/capabilities",
        params={"username": user, "random": f"{int(time.time()) % 10**8:08d}"},
        auth=auth,
        timeout=5,
    )
    sid = node(caps.text, "sessionID")
    challenge = node(caps.text, "challenge")
    if not sid or not challenge:
        log(f"нет параметров сессии: {caps.status_code}")
        return None

    iterations = int(node(caps.text, "iterations") or 1)
    irreversible = (node(caps.text, "isIrreversible") or "false") == "true"
    salt = node(caps.text, "salt") or ""
    version = node(caps.text, "sessionIDVersion")

    if irreversible:
        digest = sha256(user + salt + password)
        digest = sha256(digest + challenge)
        start = 2
    else:
        digest = sha256(password) + challenge
        start = 1
    for _ in range(start, iterations):
        digest = sha256(digest)

    body = (
        f"<SessionLogin><userName>{user}</userName><password>{digest}</password>"
        f"<sessionID>{sid}</sessionID><isNeedSessionTag>true</isNeedSessionTag>"
        f"<isSessionIDValidLongTerm>false</isSessionIDValidLongTerm>"
    )
    if version:
        body += f"<sessionIDVersion>{version}</sessionIDVersion>"
    body += "</SessionLogin>"

    login = requests.post(
        f"{base}/ISAPI/Security/sessionLogin",
        params={"timeStamp": str(int(time.time() * 1000))},
        data=body.encode("utf-8"),
        headers={"Content-Type": "application/xml"},
        auth=auth,
        timeout=5,
    )
    if login.status_code != 200:
        log(f"sessionLogin отказ: {login.status_code} {login.text[:150]}")
        return None
    return node(login.text, "sessionID") or sid


def send_signal(command: str, room: int | None = None, attempts: int = 8) -> bool:
    values = read_env(ENV_FILE)
    base = os.environ.get("PANEL_URL") or values.get("PANEL_URL") or DEFAULT_PANEL
    user = values.get("ACCESS_VENDOR_USER", "admin")
    password = values.get("ACCESS_VENDOR_PASSWORD", "")
    if not password:
        log("нет пароля панели в .env")
        return False

    auth = HTTPDigestAuth(user, password)
    for attempt in range(1, attempts + 1):
        sid = session_login(base, user, password)
        if not sid:
            time.sleep(0.3)
            continue

        body = {"CallSignal": {"cmdType": command}}
        if room is not None:
            body["CallSignal"]["target"] = {"unitType": "indoor", "roomNumber": room}
        try:
            response = requests.put(
                f"{base}/ISAPI/VideoIntercom/callSignal",
                params={"format": "json"},
                json=body,
                headers={"SessionID": sid},
                auth=auth,
                timeout=5,
            )
        except requests.RequestException as error:
            log(f"попытка {attempt}: сеть — {error}")
            time.sleep(0.3)
            continue

        text = response.text.replace("\n", " ").replace("\t", "")[:200]
        log(f"попытка {attempt}: {response.status_code} {text}")
        if response.status_code == 200:
            return True
        # Панель бывает занята: в момент, когда она уже звонит по VoIP, второй
        # вызов получает deviceBusy. Ждём и пробуем снова — монитор должен
        # зазвонить, пока в приложении ещё идёт вызов.
        if "deviceBusy" in text or "Device Busy" in text:
            time.sleep(1.5)
            continue
        time.sleep(0.3)
    return False


def main() -> int:
    if len(sys.argv) < 2:
        log("не передано действие: номер комнаты или hangup")
        return 2

    # hangup — отпустить вызов, когда приложение закончило разговор,
    # чтобы монитор не звонил до таймаута
    if sys.argv[1].lower() == "hangup":
        return 0 if send_signal("hangUp") else 1

    try:
        room = int(sys.argv[1])
    except ValueError:
        log(f"номер комнаты не число: {sys.argv[1]}")
        return 2
    return 0 if send_signal("request", room) else 1


if __name__ == "__main__":
    sys.exit(main())
