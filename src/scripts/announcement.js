// Полоса объявления (сложные-узлы.md п. 13). Закрытие запоминается по отпечатку текста:
// сменил владелец объявление — полоса вернулась, потому что это уже другое объявление.
// Прячет полосу не Alpine, а класс на <html>: его ставит короткий скрипт в <head>
// до первой отрисовки, иначе закрытая полоса успевала бы мигнуть и сдвинуть страницу.
const KEY = 'madera.announcement'
const CLOSED = 'announcement-closed'

// Закрытие панели по шкале таймингов (стандарты-размеров.md п. 12: 200–300 мс).
// Это не анимация ради красоты, а сглаживание скачка: без него страница дёргается
// вверх на всю высоту полосы (просьба владельца 27.08.2026)
const DURATION = 250

function remember(id) {
  try {
    // На dev-сервере закрытие не запоминается: иначе полоса пропадает из вёрстки
    // до конца работы и её не на чем смотреть (просьба владельца 27.08.2026)
    if (!import.meta.env.DEV) localStorage.setItem(KEY, id)
  } catch {
    // Запись могла не пройти (приватный режим, переполнение) — полосу всё равно
    // закрываем: не закрыться по нажатию хуже, чем забыть об этом к следующему разу
  }
}

export function announcementBar(id) {
  return {
    close() {
      remember(id)

      // Не $el напрямую: в обработчике нажатия он указывает на сам крестик,
      // а схлопывать надо полосу целиком
      const bar = this.$el.closest('[data-announcement]')
      const inner = bar?.querySelector('[data-announcement-inner]')
      const skip = window.matchMedia('(prefers-reduced-motion: reduce)').matches

      if (!bar || !inner || skip) {
        document.documentElement.classList.add(CLOSED)
        return
      }

      // Высоту нужно зафиксировать числом: от auto к нулю переход не считается
      const height = bar.offsetHeight
      bar.style.height = `${height}px`
      bar.style.overflow = 'hidden'
      // Чтение размера заставляет браузер применить начальное состояние до перехода
      void bar.offsetHeight

      bar.style.transition = `height ${DURATION}ms ease-in`
      inner.style.transition = `transform ${DURATION}ms ease-in`
      bar.style.height = '0px'
      // Содержимое уезжает вверх, пока полоса схлопывается: иначе оно просто
      // обрезалось бы снизу и это читалось бы обрывом, а не уходом
      inner.style.transform = `translateY(-${height}px)`

      window.setTimeout(() => {
        document.documentElement.classList.add(CLOSED)
        bar.removeAttribute('style')
        inner.removeAttribute('style')
      }, DURATION)
    },
  }
}
