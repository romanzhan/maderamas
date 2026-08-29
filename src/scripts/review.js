// Раскрытие длинного отзыва (компоненты.md 7.2). Обрезку строк анимировать нельзя —
// её ведёт line-clamp, поэтому движением высоты занимается max-height, а обрезка
// снимается на время движения и возвращается, когда оно кончилось.
// Длительность та же, что у утилиты review-text в стилях.
const DURATION = 200

export function reviewCard() {
  return {
    open: false,
    overflows: false,
    height: null,
    watcher: null,

    init() {
      // Замер по наблюдателю, а не сразу: карточка живёт в ленте, и на момент запуска
      // Alpine ширины у неё ещё нет — Swiper поднимается позже, динамическим import.
      // Тот же наблюдатель ловит и смену ширины окна: с ней меняется число строк
      // $nextTick обязателен: на момент init Alpine ещё не дошёл до вложенных узлов,
      // и ссылки на абзац с текстом просто нет
      this.$nextTick(() => {
        this.measure()
        // Наблюдатель — на потом: ширина карточки в ленте окончательна не сразу
        // (Swiper поднимается динамическим import), да и окно меняют. Сам по себе
        // он не годится: в фоновой вкладке отрисовки нет, и первое сообщение
        // придёт только когда вкладку откроют (сложные-узлы.md п. 13а)
        this.watcher = new ResizeObserver(() => this.measure())
        this.watcher.observe(this.$refs.text)
      })
    },

    destroy() {
      this.watcher?.disconnect()
    },

    /**
     * Обрезан ли текст на самом деле. По длине это не считается: в узкой карточке
     * ленты те же 110 знаков занимают шесть строк, а в широкой — три, и кнопка
     * «Leer más» то пропадала у обрезанного отзыва, то висела у целого
     * (поймано в браузере 28.08.2026).
     */
    measure() {
      if (this.open) return
      const text = this.$refs.text

      text.classList.remove('is-clipped')
      const full = text.scrollHeight
      text.classList.add('is-clipped')

      this.overflows = full > text.clientHeight + 1
    },

    toggle() {
      const text = this.$refs.text
      this.open = !this.open

      if (this.open) {
        // Обрезку снимаем до замера: у обрезанного абзаца scrollHeight равен видимой
        // части, и раскрытие остановилось бы на той же высоте
        text.classList.remove('is-clipped')
        this.height = `${text.scrollHeight}px`
        return
      }

      this.height = null
      // Вернуть обрезку сразу — значит схлопнуть текст мгновенно вместо движения
      setTimeout(() => text.classList.add('is-clipped'), DURATION)
    },
  }
}
