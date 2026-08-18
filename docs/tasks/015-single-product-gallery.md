# 015 — Товар: галерея, select вариаций, степпер, кнопка

**Статус:** готово, 2026-08-18.

## Главная жалоба (и главный фикс)

«Галерея не проработанная, стандартная WordPress-овская, размеры
разные — то сужается, то расширяется». Причина: галерея
`woocommerce/product-image-gallery` рендерит **легаси**-разметку Woo
(`flexslider` + `zoom` + `photoswipe`, jQuery-плагины, а не React/blocks),
где у каждого слайда — реальные пропорции конкретного загруженного
фото (одно 320×500, другое 600×1067 и т.д.), без общей рамки — контейнер
физически меняет размер при переключении.

## Фикс

Разметку блока не трогаем (данные — настоящие, от WooCommerce, зачем
их дублировать), заменили **поведение**: `src/product-gallery.js`
берёт уже отрендеренные узлы (`data-thumb`/`href`/`alt` — атрибуты Woo)
и переразмечает их под Swiper (уже используется для hero, задача 003) —
главный слайдер + отдельно достроенная полоса миниатюр + модуль Zoom
(клик/пинч зумит фото на месте, без ухода на другую страницу — раньше
`<a href="…">` вёл на файл изображения). CSS даёт всем слайдам общий
`aspect-ratio: 1/1` и `object-fit: contain` — фото любых пропорций
вписываются без обрезки и без «прыжков» высоты.

Штатную JS-галерею WooCommerce (flexslider/zoom/photoswipe) отключили
через `remove_theme_support()`. **Важная находка**: просто не
объявлять `add_theme_support('wc-product-gallery-*')` недостаточно —
`WC_Template_Loader::init()` сама включает все три для любой
блочной/FSE-темы (`if (wp_is_block_theme()) { add_support_for_product_page_gallery(); }`,
независимо от того, что заявляет тема) на хуке `init`, **позже**
`after_setup_theme`, где обычно и настраивают supports. Пришлось явно
снять их на `wp_loaded` (гарантированно после `init`) —
`maderamas_disable_default_product_gallery()`. Проверено через
`current_theme_supports()`: без этого фикса возвращает `true` несмотря
на отсутствие вызовов в `maderamas_setup()`.

Скрипт `wc-single-product` (звёздный рейтинг в форме отзыва) **не**
трогали — его собственная защитная проверка (`'function' === typeof
$.fn.flexslider`) сама отключает связанные с галереей ветки, когда
библиотек нет; отзывы продолжают работать.

## Остальное на странице товара

- **Select вариаций** (`table.variations select`) — тот же визуальный
  язык, что `.select` из задачи 010: рамка/радиус/фон/фокус на токенах,
  шеврон — CSS `mask` на `assets/icons/chevron-down.svg` (тот же файл,
  без дублирования). Разметку рендерит Woo, стилизовано по реальным
  классам (`table.variations`, легаси — не BEM даже, свой
  `stylelint-disable` блок).
- **Степпер количества** — `src/quantity-stepper.js`: оборачивает
  существующий `<input class="qty">` (не создаёт новый — сохраняются
  `name`/`min`/`max`/`step`/`value` от WooCommerce) кнопками ±
  на иконках Lucide (`plus`/`minus`, инлайн SVG в JS — тот же контур,
  что в `assets/icons/`), с уважением к `min`/`max`/`step`. Нативный
  спиннер браузера скрыт (`appearance: textfield` + `::-webkit-*-spin-button`).
- **Кнопка «Agregar al carrito»** (`.single_add_to_cart_button`) —
  визуально приведена к языку `.btn-primary` (тот же паддинг/радиус/
  цвета/hover/focus-visible/disabled), стилизована напрямую — блок
  `wp:woocommerce/add-to-cart-form` не даёт добавить класс на саму
  кнопку, только на обёртку.

## Проверено (без браузера)

- `npm run build`/`lint:js`/`lint:css` — чисто (автофикс поправил
  форматирование и переименовал `.quantity-stepper__button` →
  `.quantity-stepper-button`, наш класс держим в кебаб-кейсе, а не
  чужом BEM).
- `vendor/bin/phpcs` на `functions.php` — 0/0.
- `curl` на страницу простого и вариативного товара — 200/200.
- `current_theme_supports('wc-product-gallery-zoom'|'lightbox'|'slider')`
  через `wp eval` — все три `false` после фикса (были `true` до него,
  несмотря на отсутствие вызовов в теме — см. находку выше).
- В отданном HTML — 0 вхождений `wc-flexslider`/`wc-zoom-js`/
  `wc-photoswipe` (скрипты больше не подключаются).
- В собранных `build/style-index.css`/`build/index.js` — классы
  галереи/степпера и логика (`woocommerce-product-gallery__wrapper`,
  `swiper-zoom-container`) подтверждены.
- `debug.log` — без новых ошибок.

## Дальше

016 — формы корзины/чекаута через `@tailwindcss/forms`.
