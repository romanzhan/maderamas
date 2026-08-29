// Вид корзины: панель и страница показывают одно и то же состояние одним компонентом
// (сложные-узлы.md п. 3). Само состояние живёт в store и в localStorage; здесь оно
// только дополняется данными товара — названием, ценой, фото — из catalog.json.
//
// Каталог грузится один раз на страницу и общий для обоих видов: панель и страница
// корзины на одном экране одновременно не живут, но запрашивать файл дважды незачем.
// И только когда есть что показывать (сложные-узлы.md п. 3а): пустой корзине каталог
// не нужен, а панель лежит в каркасе на каждой странице сайта.
import { loadCatalog } from './catalog-data.js'
import { money } from './format.js'

/** Цена комбинации = цена товара плюс доплаты выбранных опций (данные.md §2) */
function variantOf(product, variantId) {
  const ids = (variantId ?? '').split('--').filter(Boolean)
  const options = Object.values(product.options ?? {})
    .map((axis) => axis.find((option) => ids.includes(option.id)))
    .filter(Boolean)

  return {
    // Владелец убрал цвет — строка становится записью ни о чём: показать её значило бы
    // назвать чужую цену и без цвета (сложные-узлы.md п. 3, то же правило, что
    // у исчезнувшего товара). Такую строку зовущий выбрасывает
    known: options.length === ids.length,
    price: product.price + options.reduce((sum, option) => sum + (option.priceDelta ?? 0), 0),
    variant: options.map((option) => option.name).join(' · '),
    // Кружок цвета рядом с названием: одним текстом цвет не читается (замечание
    // владельца 28.08.2026). Берём у первой оси — цвет дерева всегда первый
    swatch: options[0]?.swatch ?? null,
    inStock: product.inStock && options.every((option) => option.inStock),
  }
}

export function cartView(maxQty) {
  return {
    ready: false,
    failed: false,
    loading: false,
    products: null,
    texts: {},
    // Стоимость доставки известна только на чекауте: до него её не считают вовсе
    // (состояния-экранов.md п. 6), и в итоге корзины она равна подытогу
    shipping: 0,

    /** Формат суммы один на весь сайт — шаблон зовёт его же (тексты.md §3) */
    fmt(value) {
      return money(value)
    },

    init() {
      // Строки уведомления приходят из разметки: испанских строк в скриптах не бывает
      this.texts = { ...this.$el.dataset }

      // Товар положили при закрытой панели — каталог понадобится к её открытию
      this.$watch(
        () => this.$store.cart.items.length,
        (count) => count && this.load(),
      )
      if (this.$store.cart.items.length) this.load()
      else this.ready = true
    },

    async load() {
      if (this.loading || this.products) return
      this.loading = true
      this.failed = false
      // Пока идёт загрузка, пустого состояния быть не должно: покупатель только что
      // положил товар и увидел бы «корзина пуста»
      this.ready = false

      try {
        const catalog = await loadCatalog()
        this.products = catalog?.products ?? []
      } catch {
        // Сеть подвела — говорим об этом прямо. Показать «корзина пуста» здесь было бы
        // худшим из возможных сообщений: покупатель решит, что потерял заказ
        this.failed = true
      }

      this.loading = false
      this.ready = true

      // Каталог наконец есть — чистим записи о том, чего в нём больше нет. До этого
      // момента счётчик в шапке считал их вместе со всеми и показывал больше, чем
      // покупатель увидит в корзине (поймано ревью 29.08.2026)
      if (this.products) {
        const known = new Set(this.products.map((product) => product.id))
        this.$store.cart.prune((item) => {
          const product = this.products.find((entry) => entry.id === item.productId)
          return Boolean(product) && variantOf(product, item.variantId).known
        })
        this.$store.wishlist.prune(known)
      }
    },

    /**
     * Строки корзины: записи localStorage, дополненные данными товара. Записи о товарах,
     * которых больше нет в каталоге, тихо выпадают — корзина не документ, извиняться
     * за пропавший товар нам нечем (сложные-узлы.md п. 3)
     */
    get lines() {
      if (!this.products) return []

      return this.$store.cart.items
        .map((item) => {
          const product = this.products.find((entry) => entry.id === item.productId)
          if (!product) return null

          const variant = variantOf(product, item.variantId)
          if (!variant.known) return null

          return {
            ...item,
            name: product.name,
            href: product.href,
            photo: product.photo,
            ...variant,
            sum: variant.price * item.qty,
            atMax: item.qty >= maxQty,
          }
        })
        .filter(Boolean)
    },

    get count() {
      return this.lines.reduce((sum, line) => sum + line.qty, 0)
    },

    // Товар без наличия в итог не идёт (состояния-экранов.md п. 6)
    get subtotal() {
      return this.lines.reduce((sum, line) => (line.inStock ? sum + line.sum : sum), 0)
    },

    get total() {
      return this.subtotal + this.shipping
    },

    get hasNoStock() {
      return this.lines.some((line) => !line.inStock)
    },

    step(line, delta) {
      const next = line.qty + delta
      if (next < 1 || next > maxQty) return
      this.$store.cart.setQty(line.productId, line.variantId, next)
    },

    remove(line) {
      const removed = this.$store.cart.remove(line.productId, line.variantId)
      if (!removed) return

      // Удаление применяется сразу, отложенного «удаления по таймеру» нет
      // (компоненты.md 3.8): уведомление лишь держит снимок строки и предлагает вернуть
      this.$store.toast.notify({
        text: this.texts.tRemoved,
        actionLabel: this.texts.tUndo,
        action: () => this.$store.cart.insert(removed.line, removed.index),
      })
    },
  }
}
