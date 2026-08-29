import { isPlainClick } from './overlay.js'

// Поведение шапки: тень появляется при прокрутке. Прятать шапку при движении вниз
// мы перестали 27.08.2026 — решение владельца: она висит всегда, на любой ширине.
// Состояние лежит в store, потому что за него держится не только сама шапка.
export function siteHeader() {
  return {
    init() {
      const header = this.$store.header
      const update = () => (header.scrolled = window.scrollY > 0)

      update()
      window.addEventListener('scroll', update, { passive: true })
    },

    // Лупа — ссылка на страницу поиска, и с Ctrl/Cmd она обязана открыть вкладку;
    // панель перехватывает только обычное нажатие
    openSearch(event) {
      if (!isPlainClick(event)) return
      event.preventDefault()

      // На странице результатов панель не открывается: своя строка поиска уже на экране,
      // и лупа просто ставит в неё курсор (состояния-экранов.md п. 4 и 6 — то же правило,
      // что у корзины ниже)
      const field = document.getElementById('buscar-q')
      if (location.pathname === '/buscar/' && field) {
        field.focus()
        field.scrollIntoView({ block: 'center' })
        return
      }

      this.$store.overlay.open('search')
    },

    // На самой странице корзины панель не открывается: иконка просто ведёт наверх
    // этой же страницы (состояния-экранов.md п. 6)
    openCart(event) {
      if (!isPlainClick(event)) return
      event.preventDefault()

      // На /carrito/ панель не открывается: корзина уже на экране (состояния-экранов.md
      // п. 6). Просто поднимаемся к ней — переход по ссылке перезагрузил бы страницу
      // и потерял состояние, то же правило, что у лупы выше
      if (location.pathname === '/carrito/') {
        window.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }

      this.$store.overlay.open('cart')
    },
  }
}
