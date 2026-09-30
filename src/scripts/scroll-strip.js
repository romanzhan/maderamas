// Полоса вкладок, которая не помещается в ширину (компоненты.md 4.4): прокрутка без
// полосы прокрутки, у краёв — стрелки, пока в ту сторону есть что показать.
// Размер полосы меняется и когда она просто появляется (x-show), поэтому края
// пересчитываются по ResizeObserver, а не только по resize окна.

export function scrollStrip() {
  return {
    atStart: true,
    atEnd: true,

    init() {
      const strip = this.$refs.strip
      const update = () => this.edges()
      strip.addEventListener('scroll', update, { passive: true })
      new ResizeObserver(update).observe(strip)
      update()
    },

    edges() {
      const strip = this.$refs.strip
      // Пиксель запаса: дробная ширина при масштабе браузера не даёт ровного нуля
      this.atStart = strip.scrollLeft <= 1
      this.atEnd = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 1
    },

    /** На две трети ширины: последняя видимая вкладка остаётся на экране ориентиром */
    go(direction) {
      const strip = this.$refs.strip
      const calmer = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      strip.scrollBy({
        left: (direction * strip.clientWidth * 2) / 3,
        behavior: calmer ? 'auto' : 'smooth',
      })
    },
  }
}
