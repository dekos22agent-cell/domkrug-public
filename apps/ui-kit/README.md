# liviti UI Kit — dev gallery

Галерея реальных компонентов `@liviti/ui` на новых foundation-токенах.
Не входит в production-сборку и не деплоится на поддомены.

## Запуск

```bash
npm run dev:ui-kit
```

Открыть `http://localhost:5176/`.

## Что внутри

- Foundation: цвета и контраст, типографика, отступы, радиусы, тени.
- Shells: светлый каркас жителя и Deep Ink-каркас УК — один бренд, два режима.
- Button: варианты, размеры, loading/disabled.
- Input/Select/Switch: label, ошибка, подсказка, checkbox/radio/switch.
- Badge/Status/Card/TicketCard.
- Alert/Toast/Skeleton/EmptyState.
- Data Table, FilterBar, Tabs, Pagination, Tooltip.
- Modal, Drawer, Popover.
- Accessibility: контраст, focus, target size, reduced motion.

## Правила

- Галерея использует те же компоненты, что и приложения; не копировать сюда
  отдельные HTML-макеты.
- Stories/секции обновляются вместе с изменением компонента.
- Скриншоты для ревью лежат в `docs/design/screens/`.
- Галерея не является источником истины: токены — в
  `packages/ui/src/styles/tokens.css`, компоненты — в `packages/ui/src`.
