#!/usr/bin/env python3
"""
Настройка вызывной панели Hikvision через ISAPI с сессионным логином.

Зачем этот файл
---------------
Часть настроек панели закрыта обычным Digest-логином: `PUT` отвечает
`400 badJsonContent`, и создаётся впечатление, что «эндпоинт только для
чтения». Это не так. В коде веб-интерфейса панели такие ресурсы помечены
`security1` — для записи нужен **сессионный логин**:

1. `GET /ISAPI/Security/sessionLogin/capabilities?username=...&random=...`
   → `sessionID`, `challenge`, `iterations`, `isIrreversible`, `salt`;
2. пароль считается по алгоритму панели (см. `encode_password`);
3. `POST /ISAPI/Security/sessionLogin` с XML → выдаёт `sessionID` и `sessionTag`;
4. дальше запросы идут с заголовком `SessionID: <id>`.

Проверено на `DS-KD9403-E6` и `DS-KD9633-E6`, прошивка V2.3.9.

Что важно знать про приоритет вызова
------------------------------------
Панель **запрещает** объединять `indoor` и `VoIP` в одном уровне приоритета
(`400 badParameters`), хотя `platform` + `indoor` в одном уровне разрешает.
То есть одновременный звонок на монитор и в приложение этой прошивкой не
поддерживается — только «сначала монитор», «сначала VoIP» или параллель
с платформой вендора.

Использование
-------------
    export PANEL=http://127.0.0.1:18081
    export PANEL_USER=admin
    export PANEL_PASS=...

    python3 scripts/hikvision.py get callPriority
    python3 scripts/hikvision.py backup callPriority > cp.json
    python3 scripts/hikvision.py put callPriority cp.json
    python3 scripts/hikvision.py set-manage 198.51.100.10 5060
    python3 scripts/hikvision.py set-manage 0.0.0.0 5060   # выключить

Скрипт не хранит пароль: только переменные окружения.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time

import requests
from requests.auth import HTTPDigestAuth

PANEL = os.environ.get("PANEL", "http://127.0.0.1:18081")
USER = os.environ.get("PANEL_USER", "admin")
PASSWORD = os.environ.get("PANEL_PASS", "")

# Ресурсы, которые панель отдаёт в JSON
RESOURCES = {
    "callPriority": "/ISAPI/VideoIntercom/callPriority",
    "deviceCommunication": "/ISAPI/VideoIntercom/deviceCommunication",
}


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _node(xml: str, tag: str) -> str | None:
    match = re.search(rf"<{tag}[^>]*>([^<]*)</{tag}>", xml)
    return match.group(1) if match else None


def encode_password(password: str, challenge: str, salt: str, iterations: int, irreversible: bool) -> str:
    """Повторяет encodePwd() из веб-интерфейса панели.

    `isIrreversible` включается на новых прошивках: сначала соль и имя
    пользователя, потом challenge, потом итерации. Ошибка в этой формуле
    даёт `401` на sessionLogin, поэтому алгоритм скопирован дословно.
    """
    if irreversible:
        digest = _sha256(USER + salt + password)
        digest = _sha256(digest + challenge)
        for _ in range(2, iterations):
            digest = _sha256(digest)
    else:
        digest = _sha256(password) + challenge
        for _ in range(1, iterations):
            digest = _sha256(digest)
    return digest


def session_login() -> str:
    """Возвращает sessionID, с которым можно писать закрытые настройки."""
    auth = HTTPDigestAuth(USER, PASSWORD)

    caps = requests.get(
        f"{PANEL}/ISAPI/Security/sessionLogin/capabilities",
        params={"username": USER, "random": f"{int(time.time()) % 10**8:08d}"},
        auth=auth,
        timeout=10,
    )
    caps.raise_for_status()

    sid0 = _node(caps.text, "sessionID")
    challenge = _node(caps.text, "challenge")
    iterations = int(_node(caps.text, "iterations") or 1)
    irreversible = (_node(caps.text, "isIrreversible") or "false") == "true"
    salt = _node(caps.text, "salt") or ""
    version = _node(caps.text, "sessionIDVersion")
    tag_supported = (_node(caps.text, "isSupportSessionTag") or "false") == "true"

    if not sid0 or not challenge:
        raise RuntimeError("Панель не отдала параметры сессии")

    digest = encode_password(PASSWORD, challenge, salt, iterations, irreversible)

    body = (
        f"<SessionLogin><userName>{USER}</userName>"
        f"<password>{digest}</password>"
        f"<sessionID>{sid0}</sessionID>"
    )
    if tag_supported:
        body += "<isNeedSessionTag>true</isNeedSessionTag>"
    body += "<isSessionIDValidLongTerm>false</isSessionIDValidLongTerm>"
    if version:
        body += f"<sessionIDVersion>{version}</sessionIDVersion>"
    body += "</SessionLogin>"

    login = requests.post(
        f"{PANEL}/ISAPI/Security/sessionLogin",
        params={"timeStamp": str(int(time.time() * 1000))},
        data=body.encode("utf-8"),
        headers={"Content-Type": "application/xml"},
        auth=auth,
        timeout=10,
    )
    sid = _node(login.text, "sessionID") or sid0
    if login.status_code != 200:
        raise RuntimeError(f"sessionLogin не прошёл: {login.status_code} {login.text[:300]}")
    return sid


def get(resource: str) -> str:
    response = requests.get(
        f"{PANEL}{RESOURCES[resource]}", params={"format": "json"},
        auth=HTTPDigestAuth(USER, PASSWORD), timeout=10,
    )
    response.raise_for_status()
    return response.text


def put(resource: str, payload: str) -> requests.Response:
    sid = session_login()
    return requests.put(
        f"{PANEL}{RESOURCES[resource]}", params={"format": "json"},
        data=payload, headers={"Content-Type": "application/json", "SessionID": sid},
        auth=HTTPDigestAuth(USER, PASSWORD), timeout=10,
    )


def set_manage(ip: str, port: int, reg_password: str = "") -> requests.Response:
    """Прописывает адрес платформы (`manage`) в конфиге связей панели.

    Пустой адрес `0.0.0.0` выключает платформу. `regPassword` панель
    требует обязательно — без него отвечает `MessageParametersLack`.
    Пароль не хранится в коде: передайте третьим аргументом или
    переменной окружения `PANEL_REG_PASSWORD`.
    """
    reg_password = reg_password or os.environ.get("PANEL_REG_PASSWORD", "")
    if not reg_password:
        raise ValueError(
            "regPassword обязателен: задайте PANEL_REG_PASSWORD или передайте третьим аргументом"
        )
    current = json.loads(get("deviceCommunication"))["DeviceCommunication"]
    current["regPassword"] = reg_password
    for server in current["ServerAddressList"]:
        if server["unitType"] == "manage":
            server["ipAddress"] = ip
            server["portNo"] = port
    return put("deviceCommunication", json.dumps({"DeviceCommunication": current}))


def main() -> int:
    parser = argparse.ArgumentParser(description="Настройка панели Hikvision через ISAPI")
    parser.add_argument("command", choices=["get", "backup", "put", "set-manage", "session"])
    parser.add_argument("args", nargs="*")
    options = parser.parse_args()

    if not PASSWORD and options.command != "get":
        print("Не задан PANEL_PASS", file=sys.stderr)
        return 2

    if options.command in ("get", "backup"):
        if not options.args:
            print("Укажите ресурс: " + ", ".join(RESOURCES), file=sys.stderr)
            return 2
        print(get(options.args[0]))
        return 0

    if options.command == "session":
        print(session_login())
        return 0

    if options.command == "put":
        resource, path = options.args[0], options.args[1]
        with open(path, encoding="utf-8") as handle:
            payload = handle.read()
        response = put(resource, payload)
        print(response.status_code, response.text[:300])
        return 0 if response.status_code == 200 else 1

    if options.command == "set-manage":
        ip = options.args[0]
        port = int(options.args[1]) if len(options.args) > 1 else 5060
        reg_password = options.args[2] if len(options.args) > 2 else ""
        response = set_manage(ip, port, reg_password)
        print(response.status_code, response.text[:300].replace("\n", " "))
        return 0 if response.status_code == 200 else 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
