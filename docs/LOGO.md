# Логотип Liviti

## Источник

Файлы получены из `Brand Book & Design System/logo`:

- `liviti-logo.svg` — основная версия для светлого фона;
- `liviti-logo-dark.svg` — версия для тёмного фона;
- `liviti-mark.svg` / `liviti-mark-dark.svg` — знак без названия;
- `liviti-favicon.svg` — упрощённый знак 2×2 для favicon.

Копии исходников лежат в `packages/ui/src/assets/brand/`.

## Реализация

- Компонент — `packages/ui/src/Logo.tsx`.
- `variant="full"` — знак + слово `liviti`; `variant="mark"` — только знак.
- `tone="dark"` — версия для Deep Ink-сайдбара; `tone="light"` — для бумаги.
- Размеры: `sm`, `md`, `lg`.
- В шапках и сайдбарах используется `Logo`; в лендинг-мокапе — `variant="mark"`.
- В кабинете УК кликабелен только логотип: он ведёт на `/inbox` (для
  исполнителя — на `/my`). Подпись «кабинет УК» и название УК — обычный
  текст, не часть ссылки.
- Favicon: `apps/landing/public/favicon.svg`,
  `apps/resident/public/favicon.svg`, `apps/staff/public/favicon.svg`.
- `theme-color` приведён к Deep Ink `#142B35`.

Название пока набрано Manrope 800, а не переведено в кривые: это
соответствует промежуточному статусу логотипа в Brand Book. Когда
финальный логотип утвердят, слово можно заменить на контурный SVG без
изменения API компонента.

## Правила

- не растягивать и не менять пропорции;
- на тёмном фоне — только `tone="dark"`;
- не добавлять тени, обводки и градиенты;
- не использовать старый лаймовый квадрат `l` как знак;
- не ставить логотип на пёстрое фото без подложки.

## Скриншоты

- `docs/design/screens/brand-landing-1440.png`
- `docs/design/screens/brand-staff-1440.png`
- `docs/design/screens/brand-resident-1440.png`
- `docs/design/screens/brand-login-1440.png`
