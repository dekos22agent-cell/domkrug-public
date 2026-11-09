# -*- coding: utf-8 -*-
"""
Печатная инструкция по стенду liviti — редакция владельца, оформление v3.

Содержание взято из присланного плана (без «воды»); добавлен только
раздел 11 «Приёмка», на который ссылается план, и короткий пример конфига.
"""

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

GREEN = RGBColor(0x1B, 0x6B, 0x4A)
GREEN_HEX = "1B6B4A"
GREY = RGBColor(0x5B, 0x66, 0x60)
BLACK = RGBColor(0x1A, 0x1A, 0x1A)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)

BODY = "Calibri"
MONO = "Consolas"

ROW_FILL = "F5F9F6"
LINE = "D5E1DA"

_number = {"n": 0}
_break = {"used": 0}


# ─── Оформление ─────────────────────────────────────────────────────────────

def cell_bg(cell, hex_color):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_color)
    tc_pr.append(shd)


def cell_pad(cell, top=70, bottom=70, left=110, right=110):
    tc_pr = cell._tc.get_or_add_tcPr()
    mar = OxmlElement("w:tcMar")
    for side, value in (("top", top), ("bottom", bottom), ("start", left), ("end", right)):
        node = OxmlElement(f"w:{side}")
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")
        mar.append(node)
    tc_pr.append(mar)


def cell_border(cell, left=None, all_sides=None, color=LINE):
    tc_pr = cell._tc.get_or_add_tcPr()
    borders = OxmlElement("w:tcBorders")
    sides = ["top", "left", "bottom", "right"]
    for side in sides:
        el = OxmlElement(f"w:{side}")
        if all_sides:
            el.set(qn("w:val"), "single")
            el.set(qn("w:sz"), str(all_sides))
            el.set(qn("w:color"), color)
        elif side == "left" and left:
            el.set(qn("w:val"), "single")
            el.set(qn("w:sz"), str(left))
            el.set(qn("w:color"), GREEN_HEX)
        else:
            el.set(qn("w:val"), "nil")
        borders.append(el)
    tc_pr.append(borders)


def table_borders(table, color=LINE, size=4):
    tbl_pr = table._tbl.tblPr
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), str(size))
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), color)
        borders.append(el)
    tbl_pr.append(borders)


def page_number(paragraph):
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = "PAGE"
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.append(begin)
    run._r.append(instr)
    run._r.append(end)
    run.font.size = Pt(9)
    run.font.color.rgb = GREY


def h1(doc, num, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after = Pt(6)
    p.paragraph_format.keep_with_next = True

    number = p.add_run(f"{num}")
    number.bold = True
    number.font.size = Pt(16)
    number.font.color.rgb = GREEN
    number.font.name = BODY

    gap = p.add_run("   ")
    gap.font.size = Pt(12)

    title = p.add_run(text)
    title.bold = True
    title.font.size = Pt(13.5)
    title.font.name = BODY

    p_pr = p._p.get_or_add_pPr()
    border = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "6")
    bottom.set(qn("w:space"), "3")
    bottom.set(qn("w:color"), "C9D9D1")
    border.append(bottom)
    p_pr.append(border)
    return p


def h2(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(9)
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.keep_with_next = True
    run = p.add_run(text)
    run.bold = True
    run.font.size = Pt(11)
    run.font.name = BODY
    return p


def para(doc, text="", size=10.5, color=None, space_after=5, italic=False):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.space_before = Pt(0)
    run = p.add_run(text)
    run.font.size = Pt(size)
    run.font.name = BODY
    run.italic = italic
    if color is not None:
        run.font.color.rgb = color
    return p


def bullet(doc, text):
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.left_indent = Cm(0.6)
    run = p.add_run(text)
    run.font.size = Pt(10.5)
    run.font.name = BODY
    return p


def reset_numbering():
    _number["n"] = 0


def step(doc, text):
    _number["n"] += 1
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.left_indent = Cm(0.8)
    p.paragraph_format.first_line_indent = Cm(-0.5)
    num = p.add_run(f"{_number['n']}.")
    num.bold = True
    num.font.size = Pt(10.5)
    num.font.color.rgb = GREEN
    num.font.name = BODY
    p.add_run("\t")
    run = p.add_run(text)
    run.font.size = Pt(10.5)
    run.font.name = BODY
    return p


def note(doc, title, text):
    spacer = doc.add_paragraph()
    spacer.paragraph_format.space_after = Pt(0)
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    cell = table.cell(0, 0)
    cell_bg(cell, "EEF6F1")
    cell_pad(cell, top=110, bottom=110, left=160, right=160)
    cell_border(cell, left=24)
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(2)
    run = p.add_run(title)
    run.bold = True
    run.font.size = Pt(10)
    run.font.color.rgb = GREEN
    run.font.name = BODY
    p2 = cell.add_paragraph()
    p2.paragraph_format.space_after = Pt(0)
    r2 = p2.add_run(text)
    r2.font.size = Pt(10)
    r2.font.name = BODY
    table.rows[0]._tr.get_or_add_trPr().append(OxmlElement("w:cantSplit"))
    doc.add_paragraph().paragraph_format.space_after = Pt(1)
    return table


def code(doc, text, size=9):
    table = doc.add_table(rows=1, cols=1)
    cell = table.cell(0, 0)
    cell_bg(cell, "F4F7F5")
    cell_pad(cell, top=100, bottom=100, left=140, right=140)
    cell_border(cell, left=20)
    first = True
    for line in text.split("\n"):
        p = cell.paragraphs[0] if first else cell.add_paragraph()
        first = False
        p.paragraph_format.space_after = Pt(0)
        p.paragraph_format.line_spacing = 1.0
        run = p.add_run(line if line else " ")
        run.font.size = Pt(size)
        run.font.name = MONO
        run.font.color.rgb = BLACK
    table.rows[0]._tr.get_or_add_trPr().append(OxmlElement("w:cantSplit"))
    doc.add_paragraph().paragraph_format.space_after = Pt(1)
    return table


def table(doc, headers, rows, widths_cm, size=9.5):
    t = doc.add_table(rows=1, cols=len(headers))
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    table_borders(t)

    for index, width in enumerate(widths_cm):
        t.columns[index].width = Cm(width)

    for index, header in enumerate(headers):
        cell = t.rows[0].cells[index]
        cell.width = Cm(widths_cm[index])
        cell_bg(cell, GREEN_HEX)
        cell_pad(cell)
        p = cell.paragraphs[0]
        p.paragraph_format.space_after = Pt(0)
        run = p.add_run(header)
        run.bold = True
        run.font.size = Pt(size)
        run.font.color.rgb = WHITE
        run.font.name = BODY

    for row_index, row in enumerate(rows):
        cells = t.add_row().cells
        for index, value in enumerate(row):
            cells[index].width = Cm(widths_cm[index])
            cell_pad(cells[index])
            if row_index % 2 == 1:
                cell_bg(cells[index], ROW_FILL)
            p = cells[index].paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            run = p.add_run(str(value))
            run.font.size = Pt(size)
            run.font.name = BODY

    t.rows[0]._tr.get_or_add_trPr().append(OxmlElement("w:tblHeader"))
    for row in t.rows:
        row._tr.get_or_add_trPr().append(OxmlElement("w:cantSplit"))

    doc.add_paragraph().paragraph_format.space_after = Pt(1)
    return t


def page_break(doc):
    _break["used"] += 1
    if _break["used"] > 0:
        return
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)


# ─── Документ ───────────────────────────────────────────────────────────────

doc = Document()

section = doc.sections[0]
section.page_width = Cm(21.0)
section.page_height = Cm(29.7)
section.top_margin = Cm(1.7)
section.bottom_margin = Cm(1.6)
section.left_margin = Cm(1.9)
section.right_margin = Cm(1.6)

style = doc.styles["Normal"]
style.font.name = BODY
style.font.size = Pt(10.5)

props = doc.core_properties
props.title = "Опытный стенд liviti — инструкция"
props.author = "liviti"
props.subject = "Видеонаблюдение, СКУД, домофония, калитка"
props.comments = "Редакция 3.0 от 06.11.2026"

# ─── Шапка ──────────────────────────────────────────────────────────────────

head = doc.add_paragraph()
head.paragraph_format.space_after = Pt(0)
run = head.add_run("ОПЫТНЫЙ СТЕНД liviti")
run.bold = True
run.font.size = Pt(24)
run.font.color.rgb = GREEN
run.font.name = BODY

sub = doc.add_paragraph()
sub.paragraph_format.space_after = Pt(2)
run = sub.add_run("Инструкция: собрать и подключить к liviti.ru")
run.font.size = Pt(12.5)
run.font.color.rgb = GREY
run.font.name = BODY

meta = doc.add_paragraph()
meta.paragraph_format.space_after = Pt(6)
run = meta.add_run("v3.0 · 6 ноября 2026 · камеры, домофон, замок, калитка")
run.font.size = Pt(9)
run.font.color.rgb = GREY
run.font.name = BODY

p_pr = meta._p.get_or_add_pPr()
border = OxmlElement("w:pBdr")
bottom = OxmlElement("w:bottom")
bottom.set(qn("w:val"), "single")
bottom.set(qn("w:sz"), "12")
bottom.set(qn("w:space"), "6")
bottom.set(qn("w:color"), GREEN_HEX)
border.append(bottom)
p_pr.append(border)

# ─── 1. Оборудование ────────────────────────────────────────────────────────

h1(doc, "1", "Оборудование")

table(
    doc,
    ["Что", "Зачем", "Требования"],
    [
        ["Мини-ПК Linux", "медиасервер (RTSP → браузер)", "4 ГБ RAM, 2 ядра, 16 ГБ диск, проводная сеть"],
        ["Роутер + коммутатор", "отдельная сеть, VLAN", "портов на все устройства, VLAN"],
        ["IP-камеры, 2–3 шт.", "видео", "RTSP + ONVIF, желательно совместимые с «Линией»"],
        ["Видеорегистратор «Линия»", "архив и события движения", "версия с «Реакциями»"],
        ["Домофон Hikvision: панель + монитор", "звонок гостя, открытие двери",
         "обязательно ISAPI / веб-интерфейс"],
        ["Контроллер СКУД", "по команде щёлкает замком", "Hikvision DS-K2604 и подобные либо реле с HTTP"],
        ["Замок + БП 12 В", "держит дверь", "электромагнитный или электромеханический"],
        ["Макет калитки с приводом", "открытие калитки из приложения", "«сухой контакт» (dry contact)"],
        ["Кабель UTP 5e, патч-корды, БП, DIN-рейка", "соединение и питание", "плюс запасные патч-корды"],
        ["Ноутбук для проверок", "curl, VLC, браузер", "Windows / macOS / Linux"],
        ["Стикеры и маркер", "подписать кабели", "—"],
    ],
    [4.4, 5.8, 7.2],
)

note(doc, "Не покупать «на вырост»", "Хватит двух камер и одной вызывной панели.")

# ─── 2. Сеть ────────────────────────────────────────────────────────────────

h1(doc, "2", "Сеть")

para(doc, "Подсеть 192.168.50.0/24. Заполнить на этапе 1.", space_after=4)

table(
    doc,
    ["Устройство", "Адрес"],
    [
        ["Роутер / шлюз", "192.168.50.1"],
        ["Мини-ПК (медиасервер)", "192.168.50.10"],
        ["Камера 1 / 2 / 3", ".21 / .22 / .23"],
        ["Вызывная панель домофона", "192.168.50.31"],
        ["Монитор домофона", "192.168.50.32"],
        ["Контроллер СКУД", "192.168.50.41"],
        ["«Линия»", "192.168.50.51"],
        ["Ноутбук", "DHCP"],
    ],
    [9.4, 8.0],
)

h2(doc, "Правила")
reset_numbering()
step(doc, "Камеры, домофон, контроллер не имеют выхода в интернет.")
step(doc, "Наружу — только мини-ПК через WireGuard, не проброс портов.")
step(doc, "Сменить заводские пароли до подключения к сети.")
step(doc, "Обновить прошивки до подключения.")
step(doc, "Каждый кабель подписан с двух сторон.")

note(
    doc,
    "Проверка сети",
    "Адрес камеры открывается с ноутбука в офисе и не открывается с мобильного интернета.",
)

# ─── 3. Что куда подключаем ─────────────────────────────────────────────────

h1(doc, "3", "Что куда подключаем")

para(
    doc,
    "Камеры подключаются к «Линии» — она пишет архив и присылает события движения. "
    "Те же камеры и вызывная панель домофона отдают видеопоток на мини-ПК, где стоит "
    "медиасервер: он переводит RTSP в формат, который понимает браузер телефона.",
    space_after=4,
)
para(
    doc,
    "Домофон связан с контроллером СКУД: контроллер держит замок и реле калитки. "
    "Команду «открыть» ему передаёт наш сервер — сам житель до железа не достаёт.",
    space_after=4,
)
para(
    doc,
    "Наш сервер (liviti.ru) общается только с мини-ПК и контроллером. "
    "Телефон жителя открывает сайт, сайт отдаёт команду в офис.",
    space_after=4,
)

note(
    doc,
    "Что уходит наружу",
    "Только команды: «открой дверь», «пришёл вызов», «сработало движение». "
    "Видео в интернет не уходит.",
)

# ─── 4. Что куда пишем ──────────────────────────────────────────────────────

h1(doc, "4", "Что куда пишем")

table(
    doc,
    ["Куда", "Что пишем"],
    [
        ["mediamtx.yml на мини-ПК", "пути kamera1, kamera2, domofon → RTSP-адреса источников"],
        ["Переменные окружения сервера liviti", "адрес и учётка домофона, адреса камер, адрес медиасервера"],
        ["База liviti (скриптом)", "дом, квартира, точки доступа (дверь, калитка, шлагбаум), права, камеры"],
        ["«Линия» → «Реакции»", "действие «HTTP-запрос» POST на приёмник liviti (или .bat с curl на Windows)"],
        ["Менеджер паролей", "все пароли устройств — не в документе и не в чате"],
    ],
    [6.6, 10.8],
)

h2(doc, "Медиасервер (Docker)")
code(
    doc,
    """sudo apt update && sudo apt install -y docker.io docker-compose-plugin
sudo systemctl enable --now docker
sudo docker run -d --name mediamtx --restart unless-stopped \\
  --network host bluenviron/mediamtx:latest""",
)

h2(doc, "Пути в конфиге")
code(
    doc,
    """paths:
  kamera1:
    source: rtsp://login:pass@192.168.50.21:554/Streaming/Channels/101
  kamera2:
    source: rtsp://login:pass@192.168.50.22:554/Streaming/Channels/101
  domofon:
    source: rtsp://login:pass@192.168.50.31:554/Streaming/Channels/101""",
    size=8.5,
)

note(
    doc,
    "Проверка медиасервера",
    "http://192.168.50.10:8888/kamera1 — HLS;  http://192.168.50.10:8889/kamera1 — WebRTC.",
)

# ─── 5. Проверки ────────────────────────────────────────────────────────────

h1(doc, "5", "Проверки «на салфетке» (до кода)")

para(doc, "Выполнять с ноутбука в той же сети.", space_after=4)

h2(doc, "Открыть дверь")
code(
    doc,
    """curl -i --digest -u integrator:ПАРОЛЬ -X PUT \\
  -d "<RemoteControlDoor><cmd>open</cmd></RemoteControlDoor>" \\
  http://192.168.50.31/ISAPI/AccessControl/RemoteControl/door/1""",
)
para(
    doc,
    "200 — ок · 401 — пароль · 403 — права · нет ответа — ping и адрес · "
    "ответ есть, дверь молчит — проводка и питание.",
    space_after=4,
)

h2(doc, "Статус вызова")
code(
    doc,
    """curl -i --digest -u integrator:ПАРОЛЬ \\
  "http://192.168.50.31/ISAPI/VideoIntercom/callStatus?format=json\"""",
)
para(doc, "Должно меняться idle → ring при нажатии кнопки.", space_after=4)

h2(doc, "Поток камеры")
code(
    doc,
    """ffmpeg -rtsp_transport tcp -i "rtsp://login:pass@192.168.50.21:554/Streaming/Channels/101" -t 5 -c copy test.mp4""",
)
para(doc, "Порт бывает 554 и 10554; канал 101 — основной, 102 — второй.", space_after=4)

h2(doc, "События «Линии»")
para(
    doc,
    "Приёмник на ноутбуке (Python, порт 8080) плюс реакция «HTTP-запрос» в «Линии». "
    "В Windows-сборках HTTP-действия может не быть — обход через .bat и curl.",
    space_after=4,
)
para(doc, "Результаты заносить в таблицу: проверка · результат · кто · дата.", space_after=4)

note(doc, "Стоп-точка", "Если день 3 не дал результата — дальше не идти.")

# ─── 6. Подключение к liviti.ru ─────────────────────────────────────────────

h1(doc, "6", "Подключение к liviti.ru")

h2(doc, "Уже готово")
para(
    doc,
    "Точки доступа · права по квартирам · журнал открытий · лимит 5 открытий в минуту · "
    "камеры и токен на 5 минут · звонок на демо-данных.",
    space_after=4,
)

h2(doc, "Сделать")
reset_numbering()
step(doc, "Занести дом, квартиру и точки доступа скриптом.")
step(doc, "Прописать адрес и учётку домофона в переменные окружения.")
step(doc, "Включить настоящий провайдер открытия вместо демо.")
step(doc, "Прописать камеры: имя, поток на медиасервере, доступ по квартирам.")
step(doc, "Проверить пять сценариев ниже.")

table(
    doc,
    ["Сценарий", "Ожидаем"],
    [
        ["Открытие двери", "дверь открывается, запись в журнале"],
        ["Чужой доступ", "дверей дома не видит"],
        ["Отзыв доступа", "кнопка исчезла, дверь не открывается"],
        ["Камера", "живая картинка"],
        ["Камера не по правам", "отказ или отсутствие камеры"],
    ],
    [7.0, 10.4],
)

# ─── 7. Домофон ─────────────────────────────────────────────────────────────

h1(doc, "7", "Домофон")

h2(doc, "Этап 1 (2–3 дня): звонок без звука")
reset_numbering()
step(doc, "Панель шлёт событие «вызов»: опрос callStatus раз в 2 секунды (просто), "
          "поток ISAPI (мгновенно) или SIP (только для звука).")
step(doc, "Картинка гостя — снимок кадра или короткий поток.")
step(doc, "Всплывающее окно с картинкой и кнопкой «Открыть».")
step(doc, "Запись в журнал: кто звонил, кому, открыли или нет.")

h2(doc, "Этап 2 (4–5 дней): разговор")
para(
    doc,
    "go2rtc (двусторонний звук с Hikvision) или SIP-сервер Asterisk. "
    "Начинать только после этапа 1.",
    space_after=4,
)

note(
    doc,
    "Проверить до закупки",
    "Открывается ли http://адрес-панели. Если веб-интерфейса нет — ISAPI нет, "
    "интеграция сложнее вплоть до замены панели.",
)

# ─── 8. Линия ───────────────────────────────────────────────────────────────

h1(doc, "8", "«Линия»")

table(
    doc,
    ["Задача", "Решение"],
    [
        ["Живой просмотр", "поток с камер через медиасервер, не через «Линию»"],
        ["Архив", "остаётся в «Линии», жителю не показываем"],
        ["События: движение, тревога", "«Реакции» → HTTP POST на наш приёмник"],
    ],
    [5.8, 11.6],
)

para(
    doc,
    "На нашей стороне: приёмник с проверкой секрета и списка адресов, запись в журнал, "
    "отказ при неверной подписи.",
    space_after=4,
)

# ─── 9. Безопасность ────────────────────────────────────────────────────────

h1(doc, "9", "Безопасность: восемь правил")

reset_numbering()
step(doc, "Отдельная учётка для интеграции, не admin.")
step(doc, "Пароли только в менеджере паролей.")
step(doc, "Камеры и домофон без выхода в интернет.")
step(doc, "Наружу — только WireGuard-туннель.")
step(doc, "Заводские пароли менять до подключения.")
step(doc, "Все открытия — в журнал.")
step(doc, "Лимит открытий в минуту.")
step(doc, "Гостевые доступы — по коду и со сроком.")

# ─── 10. План ───────────────────────────────────────────────────────────────

h1(doc, "10", "План: 10 дней")

table(
    doc,
    ["День", "Дело", "Результат"],
    [
        ["1", "Инвентаризация, IP-план, учётки, паспорт стенда", "известно, чего не хватает"],
        ["2", "Монтаж, кабели, отдельная сеть", "устройства видны по адресам"],
        ["3", "Проверки из раздела 5", "таблица результатов заполнена"],
        ["4", "Медиасервер и камеры", "картинка в браузере"],
        ["5", "Видео в приложении", "житель видит камеру, чужой — отказ"],
        ["6", "Открытие двери, журнал, отзыв доступа", "открывает, после отзыва — нет"],
        ["7", "Звонок с панели в приложение", "звонок с картинкой и кнопкой"],
        ["8", "«Линия»: реакция и приём событий", "движение в журнале"],
        ["9", "Безопасность и устойчивость", "переживает выключение железа"],
        ["10", "Приёмка (раздел 11)", "подписанный чек-лист"],
    ],
    [1.2, 10.2, 6.0],
)

# ─── 11. Приёмка ────────────────────────────────────────────────────────────

h1(doc, "11", "Приёмка")

table(
    doc,
    ["№", "Проверяем", "Должно быть", "✓"],
    [
        ["1", "Открыть дверь из приложения", "дверь открылась, запись в журнале", ""],
        ["2", "Открыть калитку", "привод сработал, запись", ""],
        ["3", "Посмотреть камеру", "живая картинка без зависаний", ""],
        ["4", "Нажать кнопку на панели", "звонок в приложении с картинкой", ""],
        ["5", "Открыть из звонка", "дверь открылась, звонок закрылся", ""],
        ["6", "Зайти жителем без прав", "дверей и камер дома не видит", ""],
        ["7", "Отозвать доступ", "кнопки исчезли, дверь не открывается", ""],
        ["8", "Движение перед камерой", "событие в журнале", ""],
        ["9", "Выключить контроллер", "понятная ошибка, приложение не висит", ""],
        ["10", "Выключить интернет в офисе", "видео внутри офиса работает", ""],
    ],
    [1.0, 6.2, 8.8, 1.4],
)

para(doc, "Замечания:", space_after=3)
for _ in range(2):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(7)
    run = p.add_run("_" * 96)
    run.font.size = Pt(9)
    run.font.color.rgb = GREY

# ─── 12. Если не работает ───────────────────────────────────────────────────

h1(doc, "12", "Если не работает")

table(
    doc,
    ["Симптом", "Причина", "Действие"],
    [
        ["Дверь не открывается, ошибки нет", "команда не понята контроллером",
         "журнал и лог, проверить curl вручную"],
        ["«Устройство не отвечает»", "сеть или адрес", "ping с мини-ПК"],
        ["Видео не идёт", "медиасервер не получил поток", "VLC и лог медиасервера"],
        ["Видео на ноутбуке есть, на телефоне нет", "телефон вне офисной сети", "ожидаемо до этапа 9"],
        ["Звонок не появляется", "событие не доходит или опрос не туда",
         "проверить callStatus и опрос"],
        ["После перезагрузки ничего не работает", "нет автозапуска", "systemctl enable --now"],
        ["Камера видна из интернета", "дыра в сети", "немедленно закрыть порт, изолировать"],
        ["Пришло чужое событие", "неверный секрет или адрес", "проверить подпись и список адресов"],
    ],
    [5.4, 5.8, 6.2],
)

# ─── Колонтитул ─────────────────────────────────────────────────────────────

footer = section.footer
footer_paragraph = footer.paragraphs[0]
footer_paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = footer_paragraph.add_run("liviti · опытный стенд · v3.0 · стр. ")
run.font.size = Pt(9)
run.font.color.rgb = GREY
run.font.name = BODY
page_number(footer_paragraph)

doc.save("liviti-стенд.docx")
print("готово")
