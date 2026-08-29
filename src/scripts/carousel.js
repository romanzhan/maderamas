// Карусели страницы (сложные-узлы.md п. 13а). Swiper из реестра зависимостей —
// свою механику листания не пишем (принцип 1). Библиотека и её стили приходят
// динамическим import() и только если на странице есть хоть одна лента.
//
// Автопрокрутки нет намеренно: она уводит карточку из-под курсора и мешает читать.
// Целые числа карточек, а не дробные: лента живёт внутри полей страницы, и обрезанная
// краем карточка читалась бы браком (решение владельца 27.08.2026). На телефоне 1.2 —
// единственное место, где нужен «выглядывающий» край: иначе не видно, что лента листается
const BREAKPOINTS = {
  0: { slidesPerView: 1.2, spaceBetween: 16 },
  640: { slidesPerView: 2, spaceBetween: 16 },
  1024: { slidesPerView: 3, spaceBetween: 24 },
  1280: { slidesPerView: 4, spaceBetween: 24 },
}

/**
 * Подпись для скринридера из разметки. В словаре подстановки записаны как {n} и {total},
 * у Swiper свои — {{index}} и {{slidesLength}}: перевод делаем здесь, чтобы испанских
 * строк в скрипте не было (тексты.md, преамбула). Без этих подписей библиотека ставит
 * свои английские, и они перебивают наши sr-only на стрелках
 */
export function a11yText(value) {
  return String(value ?? '')
    .replace('{n}', '{{index}}')
    .replace('{total}', '{{slidesLength}}')
}

export async function initCarousels() {
  const roots = [...document.querySelectorAll('[data-carousel-root]')]
  if (!roots.length) return

  const [{ default: Swiper }, { A11y, Keyboard, Navigation, Pagination }] = await Promise.all([
    import('swiper'),
    import('swiper/modules'),
    import('swiper/css'),
  ])

  for (const root of roots) {
    // Стрелки живут в строке заголовка секции. Ленты вне секции у нас нет; появится —
    // обойдётся без стрелок, а не уронит остальные ленты страницы
    const section = root.closest('section')
    // Одиночный кадр (секция регулировки, кадры поста Instagram): в кадре всегда одно
    // место целиком, ряда карточек там нет, поэтому и шкала ширин ему не нужна
    const single = root.hasAttribute('data-carousel-single')
    // Лента внутри ленты (карусель-пост в ряду постов). Swiper отдаёт жест внутренней,
    // пока та не дойдёт до своего края, — иначе на телефоне пришлось бы выбирать,
    // какая из двух листается. Стрелки такой ленте не подключаются вовсе: в секции они
    // одни, и внутренняя лента забрала бы их у внешней
    const nested = root.hasAttribute('data-carousel-nested')

    // Внутри ленты может стоять другая лента (карусель-пост), и её .swiper и точки
    // лежат в разметке раньше собственных. Поэтому берём не «первое найденное»,
    // а «ближайшая лента которого — эта»: без этого внешняя лента забирала бы
    // точки внутренней
    const own = (selector) =>
      [...root.querySelectorAll(selector)].find(
        (element) => element.closest('[data-carousel-root]') === root,
      ) ?? null

    const swiper = new Swiper(own('.swiper'), {
      modules: [Navigation, Pagination, A11y, Keyboard],
      ...(single ? { slidesPerView: 1 } : { breakpoints: BREAKPOINTS }),
      ...(nested ? { nested: true } : {}),
      watchOverflow: true,
      keyboard: { enabled: true, onlyInViewport: true },
      navigation: nested
        ? {}
        : {
            prevEl: section?.querySelector('[data-carousel-prev]'),
            nextEl: section?.querySelector('[data-carousel-next]'),
          },
      pagination: {
        el: own('[data-carousel-dots]'),
        // Компактные точки (карусель-пост в ленте Instagram) — индикатор «кадров
        // несколько», а не кнопки: на плитке в 300 пикселей область нажатия 24 сделала бы
        // их крупнее самого кадра. Не кнопка — значит, и правило области нажатия
        // (стандарты-размеров.md п. 4) к ней не относится; листают пальцем
        clickable: !root.hasAttribute('data-carousel-compact'),
      },
      a11y: {
        enabled: true,
        prevSlideMessage: a11yText(root.dataset.tPrev),
        nextSlideMessage: a11yText(root.dataset.tNext),
        firstSlideMessage: a11yText(root.dataset.tFirst),
        lastSlideMessage: a11yText(root.dataset.tLast),
        paginationBulletMessage: a11yText(root.dataset.tDot),
        slideLabelMessage: a11yText(root.dataset.tSlide),
      },
    })

    // Лента поднялась — ширина карточек стала окончательной. До этого они были во всю
    // ширину секции, и содержимое, которое считает свою высоту само (текст отзыва),
    // намерило бы не то. Наблюдатель размера здесь не спасает: в фоновой вкладке
    // отрисовки нет и сообщение придёт только когда вкладку откроют
    root.dispatchEvent(new CustomEvent('carousel:ready', { bubbles: true, detail: swiper }))
  }
}
