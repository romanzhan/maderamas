// Страница результатов поиска (страницы.md §4). Карточки товаров, категории и статьи
// отрисованы на сборке все и сразу, а скрипт только прячет то, что не совпало, — тот же
// приём, что у фильтров каталога и у избранного. Так на странице не появляется второй
// разметки карточки, а «назад» возвращает её мгновенно.
//
// Индекс и правила совпадения — общие с панелью поиска в шапке (src/scripts/search.js):
// одна и та же опечатка обязана находить одно и то же в обоих местах.
import { loadIndex } from './search.js'
import { SLOW_AFTER } from './timing.js'

const MIN_CHARS = 2

export function searchResults() {
  // Индекс держим вне состояния Alpine: реактивный прокси оборачивал бы внутренности
  // Fuse, а перерисовке они не нужны вовсе (та же причина, что в панели поиска)
  let index = null

  return {
    // Запрос, по которому показана страница: он приходит из адреса и живёт до отправки
    // формы. Набранное в поле — отдельный черновик: иначе заголовок и подсказки
    // говорили бы про одно, а карточки показывали другое (поймано ревью 28.08.2026)
    query: '',
    draft: '',
    // idle → loading → ready | error
    status: 'idle',
    slow: false,
    found: { products: [], categories: [], articles: [] },

    init() {
      // Запрос живёт в адресе: страницу результатов можно переслать себе и открыть
      // заново. Поле ниже — обычная форма, её отправка перезагружает страницу с новым q
      this.query = new URLSearchParams(location.search).get('q') ?? ''
      this.draft = this.query
      if (this.term.length >= MIN_CHARS) this.load()
    },

    /** Единственная мера длины запроса: пробелы не текст, и по ним не ищут */
    get term() {
      return this.query.trim()
    },

    async load() {
      if (this.status === 'loading') return

      this.status = 'loading'
      const slowTimer = setTimeout(() => (this.slow = true), SLOW_AFTER)

      try {
        index ??= await loadIndex()
        this.run()
        this.status = 'ready'
      } catch {
        this.status = 'error'
      } finally {
        clearTimeout(slowTimer)
        this.slow = false
      }
    },

    run() {
      // Без предела: на странице результатов показываем всё, что нашлось, — предел
      // есть только у подсказок в панели, где список не прокручивают
      const ids = (name) => index[name].search(this.term).map(({ item }) => item.id)

      this.found = {
        products: ids('products'),
        categories: ids('categories'),
        articles: ids('articles'),
      }
    },

    has(group, id) {
      return this.found[group].includes(id)
    },

    get count() {
      return this.found.products.length + this.found.categories.length + this.found.articles.length
    },
  }
}
