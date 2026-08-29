// Галерея товара (сложные-узлы.md п. 1). Листалка — Swiper с лентой превью,
// полноэкранный просмотр — PhotoSwipe. Обе библиотеки и их стили приходят
// динамическим import() и только на странице, где галерея есть.
//
// Смена цвета дерева перестраивает слайды из данных, вложенных в страницу: второго
// описания картинок нет, а манифест конвейера на страницу не уезжает.
import { a11yText } from './carousel.js'

const THUMBS = { slidesPerView: 4, spaceBetween: 12, watchSlidesProgress: true }

// Подпись приходит из данных владельца: кавычка в названии товара развалила бы разметку
const attr = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')

function slideHtml(slide, index, openLabel) {
  const loading = index === 0 ? 'fetchpriority="high"' : 'loading="lazy"'
  return [
    '<div class="swiper-slide">',
    `<a href="${slide.src}" data-pswp-width="${slide.width}"`,
    ` data-pswp-height="${slide.height}" target="_blank" rel="noopener"`,
    ` aria-label="${attr(openLabel)}">`,
    `<img src="${slide.src}" srcset="${slide.srcset}"`,
    ' sizes="(min-width: 1024px) 50vw, 100vw"',
    ` width="${slide.width}" height="${slide.height}" alt="${attr(slide.alt)}"`,
    ` decoding="async" ${loading} class="aspect-square w-full object-cover" />`,
    '</a></div>',
  ].join('')
}

function thumbHtml(slide) {
  return [
    '<div class="swiper-slide cursor-pointer">',
    `<img src="${slide.src}" srcset="${slide.srcset}" sizes="120px"`,
    ` width="${slide.width}" height="${slide.height}" alt="${attr(slide.thumbAlt)}"`,
    ' loading="lazy" decoding="async"',
    ' class="aspect-square w-full rounded-lg bg-sand object-cover" />',
    '</div>',
  ].join('')
}

export async function initGallery() {
  const root = document.querySelector('[data-gallery]')
  const mainEl = root?.querySelector('[data-gallery-main]')
  if (!mainEl) return

  const [{ default: Swiper }, { A11y, Keyboard, Manipulation, Thumbs }] = await Promise.all([
    import('swiper'),
    import('swiper/modules'),
    import('swiper/css'),
    import('swiper/css/thumbs'),
  ])

  // Manipulation обеим лентам: смена цвета дерева пересобирает слайды, а без модуля
  // Swiper не знает методов removeAllSlides/appendSlide и падает на первой же смене
  const thumbsEl = root.querySelector('[data-gallery-thumbs]')
  const thumbs = thumbsEl ? new Swiper(thumbsEl, { ...THUMBS, modules: [Manipulation] }) : null

  const main = new Swiper(mainEl, {
    modules: [Thumbs, A11y, Keyboard, Manipulation],
    watchOverflow: true,
    keyboard: { enabled: true, onlyInViewport: true },
    a11y: { enabled: true, slideLabelMessage: a11yText(root.dataset.tSlide) },
    ...(thumbs ? { thumbs: { swiper: thumbs } } : {}),
  })

  // PhotoSwipe читает DOM в момент открытия, поэтому после перестройки слайдов
  // переинициализировать его не нужно — достаточно верных data-pswp-*.
  // Отдельно от листалки и под защитой: не загрузился просмотрщик — листалка и смена
  // цвета обязаны работать дальше, а фото по ссылке откроется само
  try {
    const [{ default: PhotoSwipeLightbox }] = await Promise.all([
      import('photoswipe/lightbox'),
      import('photoswipe/style.css'),
    ])

    // Подписи кнопок просмотрщика — из словаря: по умолчанию библиотека ставит
    // английские на странице с lang="es-AR" (тексты.md, преамбула)
    const lightbox = new PhotoSwipeLightbox({
      gallery: mainEl,
      children: 'a',
      pswpModule: () => import('photoswipe'),
      arrowPrevTitle: root.dataset.tPrev,
      arrowNextTitle: root.dataset.tNext,
      zoomTitle: root.dataset.tZoom,
      closeTitle: root.dataset.tClose,
      errorMsg: root.dataset.tError,
    })

    // «Назад» обязан закрывать просмотрщик, а не уводить со страницы товара
    // (сложные-узлы.md п. 6). Своей истории у библиотеки нет, поэтому запись ставим
    // сами — тем же способом, что и панели сайта: открылось → запись, закрылось →
    // шаг назад. Двойного шага не будет: после «назад» записи уже нет
    lightbox.on('afterInit', () => history.pushState({ pswp: true }, ''))
    lightbox.on('close', () => {
      if (history.state?.pswp) history.back()
    })
    window.addEventListener('popstate', () => lightbox.pswp?.close())

    lightbox.init()
  } catch {
    // Просмотрщика не будет — ссылки на фото остаются обычными ссылками
  }

  const source = root.querySelector('[data-gallery-data]')
  if (!source) return
  const byOption = JSON.parse(source.textContent)

  // Страница сообщает о выборе цвета событием: знать друг о друге компоненту выбора
  // и галерее незачем
  const show = (option) => {
    const slides = byOption[option] ?? byOption.default
    if (!slides?.length) return

    main.removeAllSlides()
    main.appendSlide(slides.map((slide, index) => slideHtml(slide, index, root.dataset.tOpen)))
    if (thumbs) {
      thumbs.removeAllSlides()
      thumbs.appendSlide(slides.map(thumbHtml))
      // Один кадр — ленты превью нет (сложные-узлы.md п. 1). Разметка приходит с сервера
      // уже спрятанной или открытой по числу кадров варианта по умолчанию, но у другого
      // цвета дерева кадров может быть иначе, поэтому решаем заново на каждой смене
      thumbsEl.hidden = slides.length < 2
      thumbs.update()
      thumbs.slideTo(0, 0)
    }
    main.update()
    main.slideTo(0, 0)
  }

  root.addEventListener('gallery:variant', (event) => show(event.detail))

  // Выбор мог случиться до того, как мы поднялись: страница пишет его и в сам узел
  if (root.dataset.variant) show(root.dataset.variant)
}
