// Корзина и избранное лежат в localStorage и читаются только отсюда (сложные-узлы.md
// п. 3 и п. 10). Запись появилась 27.08.2026 вместе со страницей товара: кнопке
// «Agregar al carrito» нужно куда-то класть. Панель корзины придёт своей задачей —
// там же отсеются записи о товарах, которых больше нет: для этого нужен catalog.json,
// а он грузится вместе с панелью, не ради счётчика.
const VERSION = 1
const KEY = { cart: 'madera.cart', wishlist: 'madera.wishlist' }
const EMPTY = {
  cart: () => ({ version: VERSION, items: [], updatedAt: null }),
  wishlist: () => ({ version: VERSION, ids: [], updatedAt: null }),
}

// Запись могли испортить чем угодно — от чужого скрипта до ручной правки в консоли.
// Форму проверяем до первого обращения: иначе счётчик падает на каждой странице
const VALID = {
  cart: (value) =>
    Array.isArray(value.items) &&
    value.items.every(
      (item) =>
        item && typeof item.productId === 'string' && Number.isInteger(item.qty) && item.qty > 0,
    ),
  wishlist: (value) => Array.isArray(value.ids) && value.ids.every((id) => typeof id === 'string'),
}

function read(name) {
  try {
    const raw = localStorage.getItem(KEY[name])
    const value = raw ? JSON.parse(raw) : null
    // Корзина — не документ: чужая, битая или устаревшая запись молча начинается
    // заново, миграций мы не пишем
    if (!value || value.version !== VERSION || !VALID[name](value)) return EMPTY[name]()
    return value
  } catch {
    return EMPTY[name]()
  }
}

function write(name, value) {
  try {
    localStorage.setItem(KEY[name], JSON.stringify({ ...value, updatedAt: Date.now() }))
  } catch {
    // Записать не вышло (приватный режим, переполнение) — корзина остаётся в памяти
    // вкладки: потерять её при перезагрузке хуже, чем не дать положить товар
  }
}

// Больше 99 в счётчике не помещается и не нужно (компоненты.md 4.1)
const label = (count) => (count > 99 ? '99+' : String(count))

export const cart = {
  items: [],
  // Предел из настроек (данные.md §6). Приходит из разметки: настройки читает сборка,
  // а не браузер. Без него два добавления подряд давали количество выше предела —
  // счётчик в корзине его уже не отдаёт, а в итог оно уходило
  maxPerItem: Infinity,
  get count() {
    return this.items.reduce((sum, item) => sum + item.qty, 0)
  },
  get label() {
    return label(this.count)
  },
  load() {
    this.items = read('cart').items
  },

  /**
   * Записи, которым в каталоге больше нечего показать: товар снят с продажи или у него
   * убрали цвет. Выбрасываются, когда каталог наконец известен — до этого счётчик
   * в шапке считал их вместе со всеми и обещал больше, чем покупатель увидит в корзине.
   * Что считать живой записью, решает зовущий: про варианты хранилище не знает
   */
  prune(isLive) {
    const kept = this.items.filter(isLive)
    if (kept.length === this.items.length) return
    this.items = kept
    this.save()
  },

  // Строка корзины — это товар плюс комбинация вариантов: один и тот же стул в дубе
  // и в орехе стоит по-разному и в корзине лежит двумя строками (данные.md §2)
  find(productId, variantId) {
    return this.items.find(
      (item) => item.productId === productId && (item.variantId ?? '') === (variantId ?? ''),
    )
  },

  has(productId, variantId) {
    return Boolean(this.find(productId, variantId))
  },

  add(productId, variantId, qty = 1) {
    const existing = this.find(productId, variantId)
    if (existing) existing.qty = Math.min(this.maxPerItem, existing.qty + qty)
    else this.items.push({ productId, variantId, qty: Math.min(this.maxPerItem, qty) })

    this.save()
  },

  setQty(productId, variantId, qty) {
    const line = this.find(productId, variantId)
    if (!line) return
    line.qty = Math.min(this.maxPerItem, Math.max(1, qty))
    this.save()
  },

  /** Удаление применяется сразу; вернуть строку умеет insert (компоненты.md 3.8) */
  remove(productId, variantId) {
    const index = this.items.findIndex(
      (item) => item.productId === productId && (item.variantId ?? '') === (variantId ?? ''),
    )
    if (index < 0) return null

    const [line] = this.items.splice(index, 1)
    this.save()
    return { line, index }
  },

  /** «Deshacer»: строка возвращается на прежнее место, а не в конец списка */
  insert(line, index) {
    this.items.splice(Math.min(index, this.items.length), 0, line)
    this.save()
  },

  save() {
    write('cart', { version: VERSION, items: this.items })
  },
}

export const wishlist = {
  ids: [],
  get count() {
    return this.ids.length
  },
  get label() {
    return label(this.count)
  },
  load() {
    this.ids = read('wishlist').ids
  },

  has(productId) {
    return this.ids.includes(productId)
  },

  toggle(productId) {
    this.ids = this.has(productId)
      ? this.ids.filter((id) => id !== productId)
      : [...this.ids, productId]

    this.save()
  },

  /** Отметки на снятых с продажи товарах: выбрасываются, когда каталог наконец известен */
  prune(known) {
    const kept = this.ids.filter((id) => known.has(id))
    if (kept.length === this.ids.length) return
    this.ids = kept
    this.save()
  },

  save() {
    write('wishlist', { version: VERSION, ids: this.ids })
  },
}

/**
 * Какой товар ждут в окне «сообщить о поступлении» (состояния-экранов.md п. 3).
 * Кнопка кладёт сюда название, окно его показывает: окно одно на весь сайт, а кнопок
 * три — в карточке каталога, на странице товара и в закреплённой полосе.
 */
export const notify = {
  name: '',

  /**
   * Кнопка «сообщить о поступлении»: название товара лежит в атрибуте ближайшей
   * обёртки — в имени может оказаться апостроф, и выражение Alpine оборвалось бы на нём.
   * Само окно открывается по событию: так три кнопки не повторяют одно и то же
   * выражение, а окно остаётся хозяином своего открытия
   */
  ask(element) {
    this.name = element.closest('[data-notify]')?.dataset.notify ?? ''
    window.dispatchEvent(new CustomEvent('notify:ask'))
  },
}

export function syncStores(Alpine) {
  const max = Number(document.body.dataset.cartMax)
  if (Number.isInteger(max) && max > 0) Alpine.store('cart').maxPerItem = max

  const reload = () => {
    Alpine.store('cart').load()
    Alpine.store('wishlist').load()
  }

  reload()
  // Покупатель мог поменять корзину в другой вкладке или вернуться «назад» из кеша
  // страниц — счётчик обязан это заметить (сложные-узлы.md п. 3)
  window.addEventListener('storage', reload)
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) reload()
  })
}
