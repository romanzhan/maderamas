// Одна механика на все выдвижные панели сайта (сложные-узлы.md п. 6): открытие пишет
// запись в историю, «назад» её закрывает, а крестик, подложка и Esc вызывают
// history.back() — поэтому лишние записи не копятся. Здесь же блокировка фона и
// фокус-ловушка.
const html = document.documentElement

// Чем человек сейчас пользуется — клавиатурой или пальцем. От этого зависит, возвращать
// ли фокус видимым: у клавиатуры без кольца теряешься, а после касания кольцо на кнопке
// выглядит браком (замечание владельца 28.08.2026). Safari к тому же считает
// программный фокус на кнопке «клавиатурным» и рисует кольцо сам
let keyboard = false
window.addEventListener('keydown', (event) => {
  if (event.key === 'Tab') keyboard = true
})
window.addEventListener('pointerdown', () => (keyboard = false), { capture: true })

// Сколько ждём ответа истории на history.back(), прежде чем закрыть панель сами
// (стандарты-размеров.md п. 12: закрытие панели — 200–300 мс)
const STUCK_MS = 300

// Панели раскрываются от шапки, а не от верха окна: открытая промо-полоса остаётся
// видимой над ними (решение владельца 27.08.2026). Положение считается в момент
// открытия и до закрытия не меняется — прокрутка на это время заблокирована.
// Два числа: верх шапки (там разворачивается поиск, он шапку собой закрывает) и её низ
// (там раскрывается меню — шапка при нём остаётся на месте)
function measureHeader() {
  const header = document.querySelector('header')
  if (!header) return
  const top = Math.max(0, Math.round(header.getBoundingClientRect().top))
  html.style.setProperty('--overlay-top', `${top}px`)
  html.style.setProperty('--overlay-below', `${top + header.offsetHeight}px`)
}

// Компенсировать исчезнувшую полосу прокрутки не нужно: место под неё зарезервировано
// в базовых стилях (scrollbar-gutter), поэтому ничего не дёргается — ни страница,
// ни фиксированная кнопка.
//
// Запасной приём из сложные-узлы.md п. 2 (фиксированная страница со смещением) пробовали
// 28.08.2026 и откатили: он ломал открытие панели — смена раскладки всей страницы
// в тот же миг обрывала переход, и панель оставалась невидимой. Липкую шапку на iOS
// лечим точечно, ниже.
function lockScroll(on) {
  html.classList.toggle('overlay-open', on)
  if (on) return

  // iOS Safari не перерисовывает липкую шапку после снятия блокировки прокрутки:
  // после закрытия бургер-меню её просто не было до первого касания (замечание
  // владельца 28.08.2026). Просим перерисовку явно — чтение размера её и вызывает
  const header = document.querySelector('header')
  if (!header) return
  header.style.transform = 'translateZ(0)'
  void header.offsetHeight
  header.style.transform = ''
}

// Фокус-ловушка без библиотеки: соседи панели становятся inert — туда не попасть ни
// табом, ни скринридером, и подложку не нужно ловить обработчиками. Условие одно:
// панель — прямой потомок body.
// keepHeader — шапка остаётся живой: у меню она не фон, а часть механики, там же
// стоит кнопка, которая меню и закрывает.
// data-overlay-keep — узел, который обязан работать поверх любой панели: уведомление
// с кнопкой «Deshacer» появляется как раз из открытой корзины, и под замком его
// нельзя было бы нажать (28.08.2026)
function setInert(panel, on, keepHeader) {
  for (const node of document.body.children) {
    if (node === panel || node.hasAttribute('data-overlay-keep')) continue
    if (keepHeader && node.tagName === 'HEADER') continue
    node.inert = on
  }
}

/**
 * Обычное нажатие: без модификаторов и не в новую вкладку. По такому ссылка обязана
 * вести себя как ссылка — открыть новую вкладку, а не наш обработчик.
 */
export function isPlainClick(event) {
  return !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

export const overlay = {
  active: null,
  returnTo: null,
  // Действие, обещанное на момент закрытия панели (уход по ссылке, отправка формы)
  pending: null,
  // Закрытие уже началось: history.back() отвечает не сразу, и второй крестик,
  // второй Esc или Esc в момент клика сделали бы второй шаг назад — то есть увели бы
  // со страницы вместо закрытия панели
  closing: false,

  is(name) {
    return this.active === name
  },

  open(name) {
    if (this.active) return
    this.returnTo = document.activeElement
    this.active = name
    measureHeader()
    lockScroll(true)
    history.pushState({ overlay: name }, '')
  },

  /** Закрыть панель. after — что сделать, когда закрытие действительно состоялось */
  close(after) {
    if (!this.active || this.closing) return
    this.closing = true

    if (after) {
      this.pending = after
      window.addEventListener('popstate', after, { once: true })
    }
    history.back()

    // Страховка: «назад» в редких случаях не доходит до нас (встроенные браузеры,
    // придушенная вкладка). Без неё панель остаётся «открытой» в состоянии, но
    // невидимой, и открыть её заново уже нельзя — механика считает, что она открыта
    window.setTimeout(() => {
      if (this.closing) this.dismiss({ cancelPending: true })
    }, STUCK_MS)
  },

  // Единственный путь к закрытию — событие popstate: и «назад» браузера, и наш
  // history.back() приходят сюда, поэтому состояние и история не расходятся
  dismiss({ cancelPending = false } = {}) {
    if (!this.active) return
    this.active = null
    this.closing = false
    lockScroll(false)

    // Закрытие по «назад» — обещанное действие висит на том же событии и отработает
    // само; здесь только забываем ссылку на него
    if (!cancelPending) return void (this.pending = null)

    // А вот если ответ истории не пришёл и панель закрыли по страховке, действие надо
    // снять: иначе оно сработает на следующем «назад» покупателя, и уход по ссылке
    // из давно закрытой панели уведёт его вперёд вместо возврата
    if (this.pending) {
      window.removeEventListener('popstate', this.pending)
      this.pending = null
    }
  },

  // Фокус возвращается отдельным шагом — из панели, после снятия inert: пока сосед
  // остаётся inert, фокус на него просто не встаёт. Пальцем — не возвращаем: кольцо
  // на кнопке, к которой никто не тянулся, читается браком
  restoreFocus() {
    if (keyboard) this.returnTo?.focus?.({ preventScroll: true })
    this.returnTo = null
  },
}

/**
 * Панель оверлея. Второй аргумент — медиазапрос ширины, на которой панель не нужна
 * (у бургер-меню это компьютер): попав в неё с открытой панелью, механика закрывает
 * её сама, иначе страница осталась бы заблокированной под скрытой вёрсткой панелью.
 * Третий — оставить шапку живой (меню раскрывается под ней и её не подменяет).
 */
export function overlayPanel(name, closeAbove, keepHeader) {
  return {
    init() {
      this.$watch(
        () => this.open,
        (isOpen) => {
          setInert(this.$el, isOpen, keepHeader)
          // Фокус уходит на саму панель, а не на первую кнопку: у кнопки браузер
          // рисует кольцо, будто по ней прошли табом. Панель кольца не получает —
          // она не интерактивный элемент, а только приёмник фокуса (tabindex="-1")
          if (isOpen) this.$nextTick(() => this.$refs.first?.focus({ preventScroll: true }))
          else this.$store.overlay.restoreFocus()
        },
      )

      if (!closeAbove) return
      const wide = window.matchMedia(closeAbove)
      wide.addEventListener('change', () => {
        if (wide.matches && this.open) this.close()
      })
    },

    get open() {
      return this.$store.overlay.is(name)
    },

    close() {
      this.$store.overlay.close()
    },

    /**
     * Уход по ссылке из панели: сначала снимаем свою запись истории, потом уходим.
     * Иначе «назад» с новой страницы упирается в запись открытой панели — тот же
     * адрес, ничего видимо не меняется, и жать приходится дважды.
     */
    follow(event) {
      const link = event.target.closest('a[href]')
      if (!link || !this.open || !isPlainClick(event) || link.target === '_blank') return

      event.preventDefault()
      const { href } = link
      this.$store.overlay.close(() => location.assign(href))
    },
  }
}
