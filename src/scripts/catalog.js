// Фильтры и сортировка каталога (сложные-узлы.md п. 4). Состояние живёт в адресе
// страницы: «назад» возвращает прошлый набор фильтров, ссылку можно переслать.
//
// Карточки отрисованы все и сразу: на десятке товаров фильтр прячет лишние, а порядок
// задаёт свойством order — перерисовывать список незачем, а поисковик видит весь
// каталог в разметке. Никакой серверной машинерии здесь нет и не будет.
const SORTS = ['relevancia', 'precio-asc', 'precio-desc', 'nuevos']
const DEFAULT_SORT = 'relevancia'

function readItems(grid) {
  return [...grid.querySelectorAll('[data-catalog-item]')].map((el, index) => ({
    el,
    index,
    price: Number(el.dataset.price),
    created: el.dataset.created,
    inStock: el.dataset.stock === '1',
    colors: el.dataset.colors ? el.dataset.colors.split(' ') : [],
  }))
}

// Нет в наличии всегда внизу — при любом порядке (состояния-экранов.md п. 2)
const COMPARE = {
  relevancia: (a, b) => a.index - b.index,
  'precio-asc': (a, b) => a.price - b.price,
  'precio-desc': (a, b) => b.price - a.price,
  nuevos: (a, b) => b.created.localeCompare(a.created) || a.index - b.index,
}

export function catalogStore(Alpine) {
  return {
    ready: false,
    sort: DEFAULT_SORT,
    colors: [],
    inStockOnly: false,
    // Черновик — выбор внутри нижней панели на телефоне: он не трогает адрес,
    // пока человек не нажал «Ver resultados»
    draftColors: [],
    draftInStockOnly: false,
    visible: 0,
    items: [],
    texts: {},

    init() {
      const grid = document.querySelector('[data-catalog-grid]')
      const root = document.querySelector('[data-catalog]')
      if (!grid || !root) return

      this.items = readItems(grid)
      this.texts = { ...root.dataset }
      this.countEl = root.querySelector('[data-catalog-count]')
      this.emptyEl = root.querySelector('[data-catalog-empty]')
      this.ready = true

      this.readUrl()
      this.apply()
      // Ссылку с фильтрами могли прислать: подпись сортировки на сервере всегда
      // «по умолчанию», и её надо подтянуть за адресом. Ждём такта — store поднимается
      // раньше компонентов, и списка сортировки в этот момент ещё нет
      Alpine.nextTick(() => this.syncSort())

      // «Назад» восстанавливает набор из адреса и не прокручивает список к началу
      window.addEventListener('popstate', () => {
        if (!this.ready) return
        this.readUrl()
        this.apply()
        this.syncSort()
      })
    },

    get active() {
      return this.colors.length > 0 || this.inStockOnly
    },

    get activeCount() {
      return this.colors.length + (this.inStockOnly ? 1 : 0)
    },

    get filterLabel() {
      if (!this.activeCount) return this.texts.tFilter ?? ''
      return (this.texts.tFilterN ?? '').replace('{n}', this.activeCount)
    },

    /** Сколько товаров останется, если применить черновик панели */
    get draftVisible() {
      return this.items.filter((item) =>
        this.matches(item, this.draftColors, this.draftInStockOnly),
      ).length
    },

    get applyLabel() {
      return (this.texts.tApply ?? '').replace('{n}', this.draftVisible)
    },

    /** Неизвестные параметры и значения игнорируются молча (сложные-узлы.md п. 4) */
    readUrl() {
      const params = new URLSearchParams(location.search)
      const sort = params.get('orden')
      this.sort = SORTS.includes(sort) ? sort : DEFAULT_SORT

      const known = new Set(this.items.flatMap((item) => item.colors))
      this.colors = (params.get('color') ?? '').split(',').filter((color) => known.has(color))

      this.inStockOnly = params.get('disponible') === '1'
      this.syncDraft()
    },

    writeUrl() {
      const params = new URLSearchParams(location.search)
      const set = (name, value) => (value ? params.set(name, value) : params.delete(name))

      set('orden', this.sort === DEFAULT_SORT ? '' : this.sort)
      set('color', this.colors.join(','))
      set('disponible', this.inStockOnly ? '1' : '')

      const query = params.toString()
      history.pushState({}, '', query ? `${location.pathname}?${query}` : location.pathname)
    },

    matches(item, colors = this.colors, inStockOnly = this.inStockOnly) {
      if (inStockOnly && !item.inStock) return false
      if (!colors.length) return true
      return item.colors.some((color) => colors.includes(color))
    },

    apply() {
      const shown = this.items.filter((item) => this.matches(item))
      shown.sort((a, b) => Number(b.inStock) - Number(a.inStock) || COMPARE[this.sort](a, b))

      const inShown = new Set(shown.map((item) => item.el))
      for (const item of this.items) item.el.hidden = !inShown.has(item.el)
      shown.forEach((item, position) => (item.el.style.order = position))

      this.visible = shown.length
      this.updateCount()
      if (this.emptyEl) this.emptyEl.hidden = this.visible > 0
    },

    updateCount() {
      if (!this.countEl) return
      this.countEl.textContent =
        this.visible === 1
          ? (this.texts.tCountOne ?? '')
          : (this.texts.tCountMany ?? '').replace('{n}', this.visible)
    },

    /** Список сортировки — отдельный компонент со своим значением; после «назад» его
     *  надо подтянуть за адресом, иначе подпись покажет прошлый порядок */
    syncSort() {
      const native = document.getElementById('orden')
      const field = document.getElementById('orden-field')
      if (!native || !field) return
      native.value = this.sort
      Alpine.$data(field).value = this.sort
    },

    setSort(value) {
      if (!this.ready || !SORTS.includes(value) || value === this.sort) return
      this.sort = value
      this.writeUrl()
      this.apply()
    },

    /** Применение с компьютера: мгновенно при каждом изменении */
    commit() {
      if (!this.ready) return
      this.syncDraft()
      this.writeUrl()
      this.apply()
    },

    /** Применение с телефона: одно действие на всю панель */
    commitDraft() {
      this.colors = [...this.draftColors]
      this.inStockOnly = this.draftInStockOnly
      this.writeUrl()
      this.apply()
    },

    clear() {
      this.colors = []
      this.inStockOnly = false
      this.commit()
    },

    syncDraft() {
      this.draftColors = [...this.colors]
      this.draftInStockOnly = this.inStockOnly
    },
  }
}
