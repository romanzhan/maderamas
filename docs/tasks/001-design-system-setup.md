# 001 — Дизайн-система: Tailwind + theme.json + шрифты

**Статус:** готово, 2026-08-18.

## Что сделано

- `tailwind.config.js` (корень репо) — читает палитру и шрифты из
  `wp-content/themes/maderamas/theme.json`, не дублирует значения.
- `postcss.config.js`, `.stylelintrc.json` (разрешает `@tailwind`/`@apply`
  для стайллинтера wp-scripts).
- `wp-content/themes/maderamas/src/style.scss` → `style.css` с
  `@tailwind base/components/utilities`.
- `theme.json` — палитра и типографика заменены с черновых заглушек на
  утверждённые (см. `docs/design-system.md`).
- Шрифты Onest + Golos Text самохостятся:
  `wp-content/themes/maderamas/assets/fonts/*.woff2` (latin + latin-ext,
  вариативные файлы), подключение — отдельный `wp_enqueue_style` в
  `functions.php` (`maderamas_enqueue_assets`), не через Tailwind-бандл.
- `package.json`: `+swiper` (карусели), `+tailwindcss/postcss/autoprefixer`
  (dev). `npm install` прогнан, `npm run build` собирает без ошибок,
  `npm run lint:css`/`lint:js` — чисто.

## Не проверено / известные ограничения

- `npm run lint:php` не запускается на этой машине — нет `composer`/`php`
  локально. Не блокер (окружение, не код), но нужно перепроверить на
  первом же деплое/CI, где PHP есть.
- Иконки (Lucide) — библиотека выбрана и описана в `docs/design-system.md`,
  но ещё не подключена физически (сделать при первой реальной
  потребности в иконке — задача 003).
- Визуально в браузере результат не смотрели (ревью-политика — см.
  `CONTEXT.md` → «Решения по разработке»): собирать почти нечего, ни
  одна страница ещё не свёрстана предметно.

## Ссылки

- Полная палитра/типографика/обоснование — `docs/design-system.md`.
- Правило проекта про дизайн-токены — `CLAUDE.md` → «Дизайн-токены».
