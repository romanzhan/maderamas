// Страница товара: одно состояние выбранной комбинации на всю страницу
// (сложные-узлы.md п. 12). От него — цена, наличие, кнопка, полоса внизу, галерея
// и адрес страницы. Независимых обработчиков по месту нет.
import { money } from './format.js'

export function productPage() {
  return {
    data: null,
    texts: {},
    selected: {},
    inCart: false,
    showBar: false,
    // Допродажа аксессуара (компоненты.md 3.11): галочка и выбранный у него цвет.
    // Аксессуар живёт своим состоянием — он уходит в корзину отдельной строкой
    accessory: null,
    accessoryOn: false,
    accessorySelected: {},

    init() {
      const source = this.$el.querySelector('[data-product-data]')
      if (!source) return
      this.data = JSON.parse(source.textContent)
      // Строка с подстановкой приходит из разметки: испанских строк в скриптах нет
      this.texts = { ...this.$el.dataset }

      // Прямой заход с параметрами открывает страницу с этими опциями; неизвестное
      // значение молча игнорируется (сложные-узлы.md п. 12)
      const params = new URLSearchParams(location.search)
      for (const [axis, options] of Object.entries(this.data.axes)) {
        const asked = params.get(this.data.params[axis])
        const known = options.some((option) => option.id === asked)
        this.selected[axis] = known ? asked : this.data.defaults[axis]
      }

      const extra = this.$el.querySelector('[data-accessory-data]')
      if (extra) {
        this.accessory = JSON.parse(extra.textContent)
        this.accessorySelected = { ...this.accessory.defaults }
      }

      this.syncSwatches()
      this.showGallery()
      this.inCart = this.$store.cart.has(this.data.id, this.variantId)

      // Полоса покупки внизу появляется, когда своя кнопка уехала вверх: две
      // одинаковые кнопки на одном экране сбивают с толку
      const anchor = this.$el.querySelector('[data-buy-anchor]')
      if (!anchor) return
      const watcher = new IntersectionObserver(
        ([entry]) => {
          this.showBar = !entry.isIntersecting && entry.boundingClientRect.top < 0
          // Плавающая кнопка WhatsApp поднимается над полосой (компоненты.md 1.3):
          // насколько — знает CSS, здесь только признак
          document.documentElement.classList.toggle('cta-bar', this.showBar)
        },
        { threshold: 0 },
      )
      watcher.observe(anchor)
    },

    /** Id комбинации — id опций через `--` в порядке осей (данные.md §2) */
    get variantId() {
      if (!this.data) return ''
      return Object.keys(this.data.axes)
        .map((axis) => this.selected[axis])
        .filter(Boolean)
        .join('--')
    },

    get options() {
      if (!this.data) return []
      return Object.entries(this.selected)
        .map(([axis, id]) => this.data.axes[axis].find((option) => option.id === id))
        .filter(Boolean)
    },

    get delta() {
      return this.options.reduce((sum, option) => sum + (option.priceDelta ?? 0), 0)
    },

    get priceLabel() {
      return this.data ? money(this.data.price + this.delta) : ''
    },

    get oldPriceLabel() {
      return this.data?.oldPrice ? money(this.data.oldPrice + this.delta) : ''
    },

    /** Комбинация аксессуара — тем же правилом, что и у самого товара (данные.md §2) */
    get accessoryVariantId() {
      if (!this.accessory) return ''
      return Object.keys(this.accessory.axes)
        .map((axis) => this.accessorySelected[axis])
        .filter(Boolean)
        .join('--')
    },

    get accessoryPriceLabel() {
      if (!this.accessory) return ''
      const delta = Object.entries(this.accessorySelected).reduce((sum, [axis, id]) => {
        const option = this.accessory.axes[axis]?.find((item) => item.id === id)
        return sum + (option?.priceDelta ?? 0)
      }, 0)
      return money(this.accessory.price + delta)
    },

    // Слушатель висит на всём блоке цветов, а не на каждом поле: событие приносит
    // имя оси, и чужое имя тихо ничего не меняет
    selectAccessory(name, id) {
      // Имя поля приходит с префиксом: у товара и у аксессуара может быть одна и та же
      // ось, а радиогруппы с общим именем слились бы в одну на весь документ
      const axis = name.replace('accesorio-', '')
      if (!this.accessory || !(axis in this.accessorySelected)) return
      this.accessorySelected[axis] = id
    },

    /** Юридический спутник цены (seo.md п. 8): сумма без национальных налогов */
    get netLabel() {
      if (!this.data) return ''
      const net = Math.round((this.data.price + this.delta) / (1 + (this.data.ivaRate ?? 0) / 100))
      return (this.texts.priceNoTaxes ?? '').replace('{amount}', money(net))
    },

    /** Наличие комбинации = наличие товара и каждой выбранной опции (данные.md §2) */
    get inStock() {
      if (!this.data) return true
      return this.data.inStock && this.options.every((option) => option.inStock)
    },

    select(axis, id) {
      if (!this.data || !(axis in this.selected) || this.selected[axis] === id) return
      this.selected[axis] = id
      this.inCart = this.$store.cart.has(this.data.id, this.variantId)
      this.showGallery()
      this.writeUrl()
    },

    /**
     * Галерею меняет только цвет дерева: у остальных осей своих фото не бывает.
     * Выбор пишется и в сам узел галереи: она поднимается позже (динамический import),
     * и событие, посланное до этого, до неё бы не дошло — заход по ссылке с ?madera=
     * открывал бы фото не того цвета.
     */
    showGallery() {
      const gallery = document.querySelector('[data-gallery]')
      if (!gallery || !this.selected.woodColor) return

      gallery.dataset.variant = this.selected.woodColor
      gallery.dispatchEvent(new CustomEvent('gallery:variant', { detail: this.selected.woodColor }))
    },

    // Выбор цвета не наматывает историю: replaceState, а не pushState
    writeUrl() {
      const params = new URLSearchParams(location.search)
      for (const [axis, id] of Object.entries(this.selected)) params.set(this.data.params[axis], id)
      const query = params.toString()
      history.replaceState(history.state, '', query ? `?${query}` : location.pathname)
    },

    // Свотчи отрисованы на сервере с отметкой на первой опции: если адрес просит другую,
    // отметку надо перенести, иначе видимый выбор разойдётся с состоянием страницы
    syncSwatches() {
      for (const [axis, id] of Object.entries(this.selected)) {
        const input = this.$el.querySelector(`input[name="${axis}"][value="${id}"]`)
        if (input && !input.checked) {
          input.checked = true
          input.dispatchEvent(new Event('change', { bubbles: true }))
        }
      }
    },

    add() {
      if (!this.inStock || !this.data) return
      const field = this.$el.querySelector('#cantidad')
      const qty = Math.max(1, Number(field?.value) || 1)
      this.$store.cart.add(this.data.id, this.variantId, qty)
      // Отмеченный аксессуар уходит вместе со стулом, но отдельной строкой: у него
      // своя цена и свой цвет (компоненты.md 3.11)
      if (this.accessoryOn && this.accessory) {
        this.$store.cart.add(this.accessory.id, this.accessoryVariantId, 1)
      }
      this.inCart = true
      // Корзина показывается сразу: иначе единственный признак добавления —
      // счётчик в шапке, и его замечают не все
      this.$store.overlay.open('cart')
    },
  }
}
