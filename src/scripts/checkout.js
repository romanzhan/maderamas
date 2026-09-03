// Чекаут (страницы.md §7, сложные-узлы.md п. 5). Собран из двух готовых частей:
// вид корзины (строки, итог, наличие) и слой валидации формы. Своей копии ни того,
// ни другого здесь нет — иначе итог на чекауте и итог в корзине однажды разошлись бы.
//
// Что добавляет сам чекаут: автосохранение введённого, проверку «есть что оформлять»
// и отправку заказа на сервер (бэкенд.md §4): туда уходят только id товаров, id опций
// и количество плюс поля формы — цены сервер считает сам. В ответ приходит ссылка
// на оплату Mercado Pago, и покупатель уходит по ней; обратно он вернётся на «Gracias».
import { cartView } from './cart.js'
import { siteForm } from './form.js'
import { SLOW_AFTER } from './timing.js'

// Ничего платёжного здесь не бывает никогда (сложные-узлы.md п. 5) — платёжных полей
// у нас и нет: оплата уходит в Mercado Pago после подтверждения заказа
const DRAFT_KEY = 'madera.checkout'
const ORDERS_URL = '/api/orders'

export function checkoutView(maxQty, shippingCost) {
  const cart = cartView(maxQty)
  // Отметка времени против ботов на чекауте не ставится: форма приходит уже заполненной
  // из сохранённого черновика, и покупателю остаётся одно нажатие — он законно
  // укладывается в три секунды (поймано ревью 28.08.2026). Ловушка-поле остаётся
  const form = siteForm({ send: (view) => view.placeOrder(), spamTimer: false })

  const checkout = {
    // Итог на телефоне свёрнут: форма важнее, а сумма всегда видна в полосе внизу
    summaryOpen: false,
    // Наличие изменилось с момента добавления (состояния-экранов.md п. 7)
    stockChanged: false,
    // Выбранная провинция: от неё зависит подпись поля («Barrio» вместо «Localidad»
    // для CABA — формы-и-поля.md п. 4)
    province: '',

    init() {
      cart.init.call(this)
      form.init.call(this)
      this.shipping = shippingCost
      this.restore()

      // Пустая корзина на чекауте — не экран, а тупик: возвращаем в корзину.
      // Ждём именно загрузки: до неё «нет строк» значит «ещё не знаем»
      this.$watch('ready', () => this.guard())
      this.guard()

      // Возврат «назад» со страницы «спасибо» или со страницы оплаты: браузер достаёт
      // чекаут из своего кеша целиком, init() второй раз не бывает. Корзина к этому моменту
      // может быть пуста — покупатель видел бы рабочую форму с итогом в ноль (поймано ревью
      // 29.08.2026); а кнопка осталась бы заблокированной с момента ухода на оплату —
      // снимаем блокировку, чтобы передумавший мог оформить заказ заново (ревью 03.09.2026)
      window.addEventListener('pageshow', (event) => {
        if (!event.persisted) return
        this.sending = false
        this.sent = false
        this.guard()
      })
    },

    guard() {
      // После оформления корзина пустеет намеренно — это не повод никуда отправлять
      if (this.sent || !this.ready || this.failed) return
      if (!this.lines.length) location.replace('/carrito/')
    },

    /**
     * Автосохранение по мере ввода (сложные-узлы.md п. 5): человек ушёл посмотреть
     * товар и вернулся — введённое на месте. Живёт в sessionStorage, то есть до
     * закрытия вкладки: держать чужой адрес дольше незачем.
     */
    save() {
      const draft = {}
      // Способ оплаты в черновик не идёт: узел требует не хранить ничего платёжного,
      // а выбор всё равно один и проставлен по умолчанию (сложные-узлы.md п. 5)
      for (const field of this.fields()) {
        if (field.name === 'payment_method') continue
        draft[field.name] = field.value
      }

      try {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
      } catch {
        // Записать не вышло (приватный режим) — форма продолжает работать как есть
      }
    },

    restore() {
      let draft = null
      try {
        draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null')
      } catch {
        draft = null
      }
      if (!draft) return

      for (const field of this.fields()) {
        const value = draft[field.name]
        if (typeof value !== 'string' || !value) continue
        field.value = value
        // Событие тут не нужно и не сработало бы: восстановление идёт из init()
        // родителя, то есть до того, как Alpine навесит обработчики на форму.
        // Подпись своего списка встаёт правильно потому, что selectField читает
        // значение спрятанного select позже, при своей инициализации
        if (field.name === 'billing_state') this.province = value
      }
    },

    // Ввод идёт через слой валидации, а сохранение добавляется поверх: два обработчика
    // на одном событии разошлись бы порядком
    onInput(event) {
      form.onInput.call(this, event)
      if (event.target.name === 'billing_state') this.province = event.target.value
      this.save()
    },

    async submit() {
      // Каталог не загрузился — состав заказа неизвестен, и оформлять нечего:
      // сообщение с «Reintentar» уже на экране (состояния-экранов.md п. 0)
      if (this.failed || !this.lines.length) return

      // Наличие могло измениться, пока покупатель заполнял форму
      if (this.hasNoStock) {
        this.stockChanged = true
        return
      }
      this.stockChanged = false
      await form.submit.call(this)
    },

    /**
     * Оформление на сервере (бэкенд.md §4). Успех — переход на оплату; сервер сказал
     * «нет в наличии» — то же сообщение, что при смене наличия в корзине, и false,
     * чтобы слой формы не показывал общую ошибку поверх; всё остальное — исключение,
     * и над кнопкой встаёт `errors.submit`, а введённое остаётся на месте.
     * Ни корзину, ни черновик формы здесь не чистим — это делает «Gracias», когда оплата
     * прошла или ждёт подтверждения: вернувшийся со страницы оплаты без платежа должен
     * найти форму заполненной, а корзину целой.
     */
    async placeOrder() {
      const customer = {}
      for (const field of this.fields()) {
        if (field.name !== 'payment_method') customer[field.name] = field.value
      }
      const payload = {
        items: this.lines.map(({ productId, variantId, qty }) => ({
          productId,
          variantId: variantId ?? null,
          qty,
        })),
        customer,
        website: this.$refs.form.elements.website?.value ?? '',
      }

      const response = await fetch(ORDERS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await response.json().catch(() => null)

      if (response.ok && result?.token) {
        location.assign(result.payUrl ?? `/gracias/?pedido=${result.token}`)
        return true
      }

      if (result?.error === 'outOfStock') {
        this.stockChanged = true
        return false
      }

      throw new Error(result?.error ?? `HTTP ${response.status}`)
    },
  }

  // Своё сильнее общего; из общего форма важнее корзины — общих имён у них нет.
  // Копируются описания свойств, а не значения: у вида корзины есть геттеры (lines,
  // subtotal), и обычное присваивание вычислило бы их один раз, до привязки к Alpine
  for (const source of [form, cart]) {
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(source))) {
      if (!(key in checkout)) Object.defineProperty(checkout, key, descriptor)
    }
  }

  return checkout
}

/**
 * Страница «спасибо» (страницы.md §8, бэкенд.md §8). Токен заказа приходит в адресе
 * со страницы оплаты Mercado Pago, статус — с сервера. Без токена или с незнакомым
 * токеном показывать нечего — на главную. Корзина и черновик формы очищаются, когда
 * оплата прошла или ждёт подтверждения: заказ состоялся. Вернувшийся без оплаты
 * («reservado», «no se aprobó») сохраняет и корзину, и заполненную форму.
 */
export function thanksPage() {
  return {
    // loading → ready | failed
    state: 'loading',
    // Загрузка тянется дольше обычного — к скелетону добавляется строка «ещё немного»
    // (состояния-экранов.md п. 0)
    slow: false,
    token: '',
    // Id платежа, который Mercado Pago дописывает в обратный адрес: сервер по нему
    // узнаёт результат раньше, чем дойдёт уведомление (бэкенд.md §5)
    paymentId: '',
    order: null,
    texts: {},

    init() {
      this.texts = { ...this.$el.dataset }
      const params = new URLSearchParams(location.search)
      const token = params.get('pedido') ?? ''
      if (!/^[a-f0-9]{32}$/.test(token)) {
        location.replace('/')
        return
      }
      this.token = token
      this.paymentId = params.get('payment_id') ?? params.get('collection_id') ?? ''
      this.load()
    },

    async load() {
      this.state = 'loading'
      const slowTimer = setTimeout(() => (this.slow = true), SLOW_AFTER)
      try {
        const query = this.paymentId ? `?payment=${encodeURIComponent(this.paymentId)}` : ''
        const response = await fetch(`/api/orders/${this.token}${query}`, {
          headers: { Accept: 'application/json' },
        })
        if (response.status === 404) {
          location.replace('/')
          return
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        this.order = await response.json()
      } catch {
        this.state = 'failed'
        return
      } finally {
        clearTimeout(slowTimer)
        this.slow = false
      }

      this.state = 'ready'
      if (!this.inProgress) return

      if (this.$store.cart.items.length) {
        this.$store.cart.items = []
        this.$store.cart.save()
      }
      try {
        sessionStorage.removeItem(DRAFT_KEY)
      } catch {
        // Черновик не стёрся — переживём: следующий заказ начнётся с заполненной формы
      }
    },

    get status() {
      return this.order?.status ?? ''
    },

    /** Заказ ждёт денег: не оплачен, отклонён или платёж ещё не подтверждён */
    get awaitingPayment() {
      return ['created', 'rejected', 'pending'].includes(this.status)
    },

    /** Всё в порядке или скоро будет — покупателю есть что ждать дальше */
    get inProgress() {
      return this.status === 'paid' || this.status === 'pending'
    },

    /** Строка словаря по статусу: data-title-paid, data-lead-created… */
    text(kind) {
      const key = kind + this.status.charAt(0).toUpperCase() + this.status.slice(1)
      return this.texts[key] ?? ''
    },

    get orderLabel() {
      return (this.texts.order ?? '').replace('{n}', () => String(this.order?.number ?? ''))
    },

    get payLabel() {
      return this.status === 'rejected' ? this.texts.retryPay : this.texts.pay
    },
  }
}
