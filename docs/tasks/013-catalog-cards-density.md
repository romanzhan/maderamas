# 013 — Карточки товаров плотнее (3–4 в ряд), общий `.card`

**Статус:** готово, 2026-08-18.

## Что сделано

- `patterns/product-highlights.php` (блок «Nuestras sillas» на главной)
  и `templates/archive-product.html` (страница каталога): сетка
  `woocommerce/product-collection` переведена с `columns:3` на
  `columns:4` (с `shrinkColumns:true` — это уже CSS `grid-template-columns:
  repeat(auto-fill, minmax(max(150px, 25%), 1fr))`, само сжимается на
  мобильном без ручных брейкпоинтов). На главной заодно `perPage` 3 → 4,
  чтобы ряд не оставался неполным.
- Обёртка каждой карточки — общий класс `.card` (задача 010) вместо
  разрозненного `overflow-hidden rounded-2xl border border-border
  bg-surface`, повторённого в двух файлах. Внутренние отступы карточки
  уменьшены (`px-4 pb-4 pt-3` → `px-3 pb-3 pt-2.5`), заголовок товара
  `fontSize` `medium` → `small` — компенсирует более узкую колонку при
  4 в ряд.
- `patterns/category-tiles.php`: убраны хардкоженные `text-[17px]`/
  `text-[13px]` — заменены на токены `text-medium`/`text-small`.
  Добавлена интерактивность плиток (`hover:-translate-y-0.5`,
  `duration-base`) — раньше плитки были статичными, только `<a>`
  без какой-либо hover-реакции.

`patterns/promo-banner.php` не трогали — секция маленькая, кнопка уже
использует padding из `theme.json`'s core-button пресета (0.75rem/
1.75rem — достаточный тач-таргет), не относится к жалобе «карточки
слишком крупные».

## Проверено (без браузера)

- `npm run build` — чисто.
- `vendor/bin/phpcs` на `category-tiles.php`/`product-highlights.php` —
  0/0.
- `curl` на `/` и `/shop/` — 200; в HTML подтверждён класс
  `wp-block-group card overflow-hidden` на карточках (10 шт. на
  `/shop/`, столько сейчас товаров в каталоге); `.card`/`.card:hover`
  скомпилированы в `build/style-index.css`.
- `debug.log` — без новых ошибок.

## Дальше

014 — страница каталога: стилизованная сортировка/пагинация, фильтры
(если нужны).
