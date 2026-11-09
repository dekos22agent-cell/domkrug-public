"""
Иконки PWA «ДомКруг».

Рисуются кодом, а не берутся готовыми: цвет берётся из дизайн-системы
(--brand-600 = #1F7A4C), форма — простой дом. Так иконка не разойдётся
с интерфейсом, если палитра поменяется.

Запуск:
  python scripts/make-icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

BRAND = (0x1F, 0x7A, 0x4C, 255)      # --brand-600
BRAND_DARK = (0x16, 0x60, 0x3B, 255)  # --brand-700
WHITE = (0xFF, 0xFF, 0xFF, 255)

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "frontend" / "public"


def draw_icon(size: int, *, maskable: bool = False) -> Image.Image:
    """
    Иконка: зелёное поле и белый дом.

    maskable=True уменьшает рисунок и добавляет отступы: Android обрезает
    края маскируемых иконок под свою форму, и без запаса дом обрежется.
    """
    # Рисуем в 4 раза крупнее и уменьшаем — так края получаются гладкими
    # без отдельной библиотеки сглаживания.
    scale = 4
    px = size * scale
    image = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    # Фон: скруглённый квадрат. Для maskable — на весь размер, фон обязателен.
    radius = 0 if maskable else int(px * 0.22)
    draw.rounded_rectangle([0, 0, px - 1, px - 1], radius=radius, fill=BRAND)

    # Поле рисунка: у maskable оставляем 20% запаса по краям
    margin = px * (0.20 if maskable else 0.14)
    inner = px - margin * 2
    cx = px / 2

    # Корпус дома
    body_left = cx - inner * 0.30
    body_right = cx + inner * 0.30
    body_top = px * 0.50
    body_bottom = px * 0.50 + inner * 0.56

    draw.rounded_rectangle(
        [body_left, body_top, body_right, body_bottom],
        radius=int(inner * 0.05),
        fill=WHITE,
    )

    # Крыша: треугольник чуть шире корпуса
    roof_peak = px * 0.24
    roof_left = cx - inner * 0.42
    roof_right = cx + inner * 0.42
    draw.polygon(
        [(cx, roof_peak), (roof_right, body_top + inner * 0.02), (roof_left, body_top + inner * 0.02)],
        fill=WHITE,
    )

    # Дверь — вырез цветом бренда
    door_width = inner * 0.16
    door_height = inner * 0.26
    draw.rounded_rectangle(
        [
            cx - door_width / 2,
            body_bottom - door_height,
            cx + door_width / 2,
            body_bottom,
        ],
        radius=int(door_width * 0.18),
        fill=BRAND_DARK,
    )

    return image.resize((size, size), Image.LANCZOS)


def main() -> None:
    PUBLIC.mkdir(parents=True, exist_ok=True)

    targets = [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-maskable-512.png", 512, True),
        ("apple-touch-icon.png", 180, False),
    ]

    for name, size, maskable in targets:
        path = PUBLIC / name
        draw_icon(size, maskable=maskable).save(path, "PNG", optimize=True)
        print(f"{path.name}: {size}x{size}, {path.stat().st_size} байт")

    # favicon.svg уже есть в шаблоне — заменяем на свой, в тех же цветах
    favicon = PUBLIC / "favicon.svg"
    favicon.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
        '<rect width="32" height="32" rx="7" fill="#1F7A4C"/>'
        '<path d="M16 7.5 25 15.5h-2.6v9.2h-4.8v-5.6h-3.2v5.6H9.6v-9.2H7z" fill="#FFFFFF"/>'
        "</svg>\n",
        encoding="utf-8",
    )
    print(f"{favicon.name}: svg")


if __name__ == "__main__":
    main()
