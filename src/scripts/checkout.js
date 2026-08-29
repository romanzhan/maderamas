// Чекаут (страницы.md §7, сложные-узлы.md п. 5). Собран из двух готовых частей:
// вид корзины (строки, итог, наличие) и слой валидации формы. Своей копии ни того,
// ни другого здесь нет — иначе итог на чекауте и итог в корзине однажды разошлись бы.
//
// Что добавляет сам чекаут: автосохранение введённого, проверку «есть что оформлять»
// и макетную отправку — она пишет номер заказа в sessionStorage и уводит на страницу
// «спасибо» (страницы.md §8). Настоящая отправка появится с WooCommerce.
import { cartView } from './cart.js'
import { siteForm } from './form.js'

// Ничего платёжного здесь не бывает никогда (сложные-узлы.md п. 5) — платёжных полей
// у нас и нет: оплата уходит в Mercado Pago после подтверждения заказа
const DRAFT_KEY = 'madera.checkout'
const ORDER_KEY = 'madera.order'

/** Макетный номер заказа: дата и четыре цифры — так же, как номер обращения у форм */
function orderNumber() {
  const now = new Date()
  const day = `${String(now.getDate()).padStart(2, '0')}${String(now.getMonth() + 1).padStart(2, '0')}`
  return `${day}-${Math.floor(Math.random() * 9000 + 1000)}`
}

export function checkoutView(maxQty, shippingCost) {
  const cart = cartView(maxQty)
  // Отметка времени против ботов на чекауте не ставится: форма приходит уже заполненной
  // из сохранённого черновика, и покупателю остаётся одно нажатие — он законно
  // укладывается в три секунды (поймано ревью 28.08.2026). Ловушка-поле остаётся
  const form = siteForm({ onSent: (view) => view.placeOrder(), spamTimer: false })

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
     * Макетное оформление: номер заказа уезжает в sessionStorage, страница «спасибо»
     * читает его оттуда и очищает корзину. Корзину чистим не здесь: оборвись переход,
     * покупатель остался бы и без заказа, и без корзины.
     */
    placeOrder() {
      try {
        sessionStorage.setItem(ORDER_KEY, JSON.stringify({ number: orderNumber() }))
        sessionStorage.removeItem(DRAFT_KEY)
      } catch {
        // Без sessionStorage номер заказа показать негде — страница «спасибо» вернёт
        // на главную, и это честнее, чем выдуманный номер
      }
      location.assign('/gracias/')
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
 * Страница «спасибо» (страницы.md §8). Номер заказа приходит от чекаута через
 * sessionStorage; его нет — человек попал сюда прямым заходом, и показывать ему
 * нечего. Корзина очищается здесь, а не при отправке: заказ считается оформленным,
 * когда покупатель дошёл до этой страницы.
 */
export function thanksPage() {
  return {
    ready: false,
    number: '',

    init() {
      let order = null
      try {
        order = JSON.parse(sessionStorage.getItem(ORDER_KEY) ?? 'null')
      } catch {
        order = null
      }

      if (!order?.number) {
        location.replace('/')
        return
      }

      this.number = order.number
      if (this.$store.cart.items.length) {
        this.$store.cart.items = []
        this.$store.cart.save()
      }
      this.ready = true
    },
  }
}
