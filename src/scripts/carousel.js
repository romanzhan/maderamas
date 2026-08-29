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

  const [{ default: Swiper }, { A11y, Autoplay, Keyboard, Navigation, Pagination }] =
    await Promise.all([import('swiper'), import('swiper/modules'), import('swiper/css')])

  // Просьба системы «поменьше движения» сильнее нашей автопрокрутки: она уводит кадр
  // из-под глаз, а это ровно то, от чего человек и защищается этой настройкой
  const calmer = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // Ленты, внутри которых стоят другие ленты: их нужно связать после того,
  // как поднимутся обе
  const instances = new Map()

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

    // Автопрокрутка есть ровно у одного вида ленты — кадров регулировки (решение
    // владельца 29.08.2026): секция объясняет механизм, и первый кадр в одиночку его
    // не объясняет. Останавливается под мышью и после первого касания пальцем: дальше
    // листает человек, а не лента
    const autoplay = root.hasAttribute('data-carousel-autoplay') && !calmer

    // Ленте, внутри которой стоят другие ленты, нужен признак полной видимости слайда:
    // по нему ниже решается, кому достаётся жест
    const hasNested = Boolean(root.querySelector('[data-carousel-nested]'))

    const swiper = new Swiper(own('.swiper'), {
      modules: [Navigation, Pagination, A11y, Keyboard, Autoplay],
      ...(autoplay
        ? { autoplay: { delay: 3000, pauseOnMouseEnter: true, disableOnInteraction: true } }
        : {}),
      ...(single ? { slidesPerView: 1 } : { breakpoints: BREAKPOINTS }),
      ...(nested ? { nested: true } : {}),
      watchOverflow: true,
      ...(hasNested ? { watchSlidesProgress: true } : {}),
      keyboard: { enabled: true, onlyInViewport: true },
      // Свои стрелки внутри ленты (кадры регулировки) важнее стрелок секции: у ленты
      // внутри секции они лежат прямо на кадре, а у ряда карточек — в строке заголовка
      navigation: nested
        ? {}
        : {
            prevEl: own('[data-carousel-prev]') ?? section?.querySelector('[data-carousel-prev]'),
            nextEl: own('[data-carousel-next]') ?? section?.querySelector('[data-carousel-next]'),
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
    instances.set(root, swiper)
    root.dispatchEvent(new CustomEvent('carousel:ready', { bubbles: true, detail: swiper }))
  }

  // Лента внутри ленты: жест забирает внутренняя, и на телефоне это ломало привычное
  // листание — палец попадал на выглядывающую справа плитку, и вместо ряда постов
  // листались её кадры (замечание владельца 29.08.2026). Поэтому внутренняя лента
  // слушает палец только тогда, когда её плитка видна целиком: у выглядывающей
  // и наполовину закрытой жест достаётся внешней ленте
  for (const [root, swiper] of instances) {
    const inner = [...root.querySelectorAll('[data-carousel-nested]')]
    if (!inner.length) continue

    const sync = () => {
      for (const nestedRoot of inner) {
        const nestedSwiper = instances.get(nestedRoot)
        const slide = nestedRoot.closest('.swiper-slide')
        if (!nestedSwiper || !slide) continue
        nestedSwiper.allowTouchMove = slide.classList.contains('swiper-slide-fully-visible')
      }
    }

    swiper.on('slideChange', sync)
    swiper.on('transitionEnd', sync)
    swiper.on('resize', sync)
    sync()
  }
}
