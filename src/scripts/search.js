// Живой поиск (сложные-узлы.md п. 11). Панель одна на весь сайт и живёт в каркасе:
// на компьютере разворачивается строкой поверх шапки, на телефоне — во весь экран.
// Индекс — public/catalog.json (сложные-узлы.md п. 3а), совпадения ищет Fuse.js;
// и то и другое грузится при первом открытии панели, а не вместе со страницей.
import { loadCatalog } from './catalog-data.js'
import { money } from './format.js'
import { overlayPanel } from './overlay.js'

const DEBOUNCE = 200 // стандарты-размеров.md п. 12
const SLOW_AFTER = 5000 // «долгая загрузка» — там же
const MIN_CHARS = 2

// Больше в подсказки не помещается без прокрутки, а прокручивать их покупатель не
// станет: за остальным есть «Ver todos los resultados»
const LIMIT = { products: 6, categories: 4, articles: 3 }

// threshold 0.35 — умеренный порог из узла: терпит одну-две опечатки и не сыплет
// мусор. ignoreLocation — совпадение засчитывается в любом месте названия, иначе Fuse
// считает вес от начала строки и «evolutiva» не находит «Silla Alta de Comer Evolutiva»
const MATCHING = {
  ignoreDiacritics: true,
  ignoreLocation: true,
  threshold: 0.35,
  minMatchCharLength: MIN_CHARS,
  includeMatches: true,
}

const ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const escapeHtml = (text) => text.replace(/[&<>"]/g, (character) => ESCAPE[character])

const noResults = () => ({ products: [], categories: [], articles: [] })

/**
 * Подсветка совпадения. Текст экранируется целиком и только потом получает метки:
 * название приходит из данных владельца, и разметка в нём не должна ожить.
 */
function highlight(text, matches, key) {
  const indices = matches?.find((match) => match.key === key)?.indices ?? []
  let html = ''
  let cursor = 0

  for (const [start, end] of indices) {
    // Совпадения приходят по возрастанию, но перекрытие обошлось бы дороже проверки
    if (start < cursor) continue
    html += escapeHtml(text.slice(cursor, start))
    html += `<mark>${escapeHtml(text.slice(start, end + 1))}</mark>`
    cursor = end + 1
  }

  return html + escapeHtml(text.slice(cursor))
}

/**
 * Индекс поиска: те же данные и те же правила совпадения для панели в шапке и для
 * страницы результатов. Второго индекса в проекте нет — иначе одна и та же опечатка
 * находила бы товар в подсказках и не находила на странице.
 */
export async function loadIndex() {
  const [{ default: Fuse }, catalog] = await Promise.all([import('fuse.js'), loadCatalog()])

  // Адрес товара собирается из категории: /{categoria}/{producto}/ (seo.md п. 3)
  const categorySlug = new Map(catalog.categories.map((category) => [category.id, category.slug]))

  return {
    categorySlug,
    products: new Fuse(catalog.products, { ...MATCHING, keys: ['name'] }),
    categories: new Fuse(catalog.categories, { ...MATCHING, keys: ['name'] }),
    // Блог выключен — catalog.json статей не отдаёт вовсе, и группа не появляется сама
    articles: new Fuse(catalog.articles ?? [], { ...MATCHING, keys: ['title', 'excerpt'] }),
  }
}

export function searchPanel() {
  const panel = overlayPanel('search')

  // Индекс и таймер держим вне состояния Alpine: реактивный прокси оборачивает
  // состояние насквозь, вместе с внутренностями Fuse, и каждое чтение в её циклах идёт
  // через ловушку — замерено втрое дороже. Перерисовке эти двое не нужны вовсе.
  let index = null
  let timer = null

  const search = {
    query: '',
    // idle → loading → ready | error; ошибка не блокирует строку ввода
    status: 'idle',
    // Индекс грузится дольше пяти секунд — под заготовками появляется «ещё момент»
    slow: false,
    searching: false,
    results: noResults(),
    activeIndex: -1,

    init() {
      panel.init.call(this)

      this.$watch(
        () => this.open,
        (isOpen) => (isOpen ? this.load() : this.reset()),
      )
    },

    async load() {
      if (index || this.status === 'loading') return

      this.status = 'loading'
      const slowTimer = setTimeout(() => (this.slow = true), SLOW_AFTER)

      try {
        index = await loadIndex()
        this.status = 'ready'
        // Пока индекс грузился, покупатель мог успеть набрать слово
        this.run()
      } catch {
        this.status = 'error'
      } finally {
        clearTimeout(slowTimer)
        this.slow = false
      }
    },

    reset() {
      clearTimeout(timer)
      timer = null
      this.query = ''
      this.searching = false
      this.results = noResults()
      this.activeIndex = -1
    },

    // Прежние результаты держатся на экране до новых: мигать списком на каждой букве
    // нельзя (состояния-экранов.md п. 4)
    onInput() {
      this.searching = true
      clearTimeout(timer)
      timer = setTimeout(() => this.run(), DEBOUNCE)
    },

    run() {
      timer = null
      this.searching = false
      this.activeIndex = -1

      const query = this.term
      if (!index || query.length < MIN_CHARS) {
        this.results = noResults()
        return
      }

      const find = (name) => index[name].search(query, { limit: LIMIT[name] })

      this.results = {
        products: find('products')
          .map((hit) => this.toProduct(hit))
          .filter(Boolean),
        categories: find('categories').map(({ item, matches }) => ({
          key: `categoria-${item.id}`,
          domId: `buscador-categoria-${item.id}`,
          href: `/${item.slug}/`,
          html: highlight(item.name, matches, 'name'),
        })),
        articles: find('articles').map(({ item, matches }) => ({
          key: `articulo-${item.id}`,
          domId: `buscador-articulo-${item.id}`,
          // Адрес приходит из данных: правило «/blog/{slug}/» живёт в одном месте
          // на сборке, и второго такого правила в браузере быть не должно
          href: item.href,
          html: highlight(item.title, matches, 'title'),
        })),
      }
    },

    toProduct({ item, matches }) {
      const slug = index.categorySlug.get(item.categoryId)
      // Товар без своей категории — битые данные; в подсказках он дал бы ссылку в никуда
      if (!slug) return null

      return {
        key: `producto-${item.id}`,
        domId: `buscador-producto-${item.id}`,
        href: `/${slug}/${item.slug}/`,
        html: highlight(item.name, matches, 'name'),
        // Фото приходит готовым из catalog.json: правил построения адресов и манифеста
        // картинок браузер не знает (данные.md §8)
        photo: item.photo,
        price: money(item.price),
        // Скидка бывает и в подсказках: без старой цены строка молча потеряла бы её
        // в день, когда владелец поставит первую (компоненты.md 3.1)
        oldPrice: item.oldPrice ? money(item.oldPrice) : null,
        inStock: item.inStock,
      }
    },

    // Единственная мера длины запроса: пробелы не текст, и по ним не ищут
    get term() {
      return this.query.trim()
    },

    // Порядок групп один и в списке, и на клавиатуре
    get options() {
      return [...this.results.products, ...this.results.categories, ...this.results.articles]
    },

    get count() {
      return this.options.length
    },

    get activeId() {
      return this.options[this.activeIndex]?.domId ?? null
    },

    get allResultsHref() {
      return `/buscar/?q=${encodeURIComponent(this.term)}`
    },

    /** ↑↓ ходят по подсказкам и возвращаются в строку ввода (индекс −1) */
    move(step) {
      const total = this.count
      if (!total) return

      const next = this.activeIndex + step
      this.activeIndex = next < -1 ? total - 1 : next >= total ? -1 : next

      const id = this.activeId
      if (id)
        this.$nextTick(() => document.getElementById(id)?.scrollIntoView({ block: 'nearest' }))
    },

    clear() {
      this.query = ''
      this.run()
      this.$refs.first.focus()
    },

    /** Enter: выбранная подсказка — на неё, иначе на страницу результатов */
    submit(event) {
      event.preventDefault()

      const option = this.options[this.activeIndex]
      if (!option && !this.term) return

      // Своя запись истории снимается до перехода — иначе «назад» с новой страницы
      // упирается в открытую панель (та же причина, что у follow в overlay.js)
      const href = option ? option.href : this.allResultsHref
      this.$store.overlay.close(() => location.assign(href))
    },
  }

  // Своё сильнее общего, остальное берётся у панели как есть. Копируются описания
  // свойств, а не значения: у панели есть геттер open, и обычное присваивание
  // вычислило бы его один раз, до привязки к Alpine
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(panel))) {
    if (!(key in search)) Object.defineProperty(search, key, descriptor)
  }

  return search
}
