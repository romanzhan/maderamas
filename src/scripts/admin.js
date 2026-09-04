// Список заказов владельца (страницы.md §17, бэкенд.md §13): вход по паролю, вкладки
// по состоянию, заказ подробно, три действия. Это store, а не компонент страницы:
// окна подтверждения обязаны лежать прямыми потомками body (компоненты.md 5.1),
// а общее состояние у них и у страницы возможно только через store.
// Тексты приходят из разметки data-атрибутами: испанских строк в скриптах не бывает.
import Alpine from 'alpinejs'
import { dateTime, money } from './format.js'

const API = '/api/admin'
const DEFAULT_TAB = 'paid'
const DEFAULT_SECTION = 'orders'

// Тон плашки состояния сообщения: новое ждёт, отвеченное — серое, отзыв — опубликован
// или отклонён
const MESSAGE_STATUS_KIND = {
  new: 'warning',
  attended: 'neutral',
  approved: 'success',
  rejected: 'error',
}

// Тон плашки состояния: зелёный — всё хорошо, жёлтый — ждём, красный — нужно смотреть,
// серый — заказа больше нет (визуальная-система.md, тона состояний)
const STATUS_KIND = {
  created: 'warning',
  pending: 'warning',
  rejected: 'error',
  review: 'error',
  paid: 'success',
  shipped: 'success',
  cancelled: 'neutral',
  refunded: 'neutral',
}

// Хронология: вид записи → ключ подписи в data-атрибутах страницы
const EVENT_TEXT = {
  created: 'eventCreated',
  payment_started: 'eventPaymentStarted',
  payment_skipped: 'eventPaymentSkipped',
  payment_unavailable: 'eventPaymentUnavailable',
  webhook_received: 'eventWebhookReceived',
  status_changed: 'eventStatusChanged',
  payment_recorded: 'eventPaymentRecorded',
  payment_ignored: 'eventPaymentIgnored',
  transition_refused: 'eventTransitionRefused',
  email_customer_sent: 'eventEmailCustomerSent',
  email_customer_failed: 'eventEmailCustomerFailed',
  email_owner_sent: 'eventEmailOwnerSent',
  email_owner_failed: 'eventEmailOwnerFailed',
  shipped: 'eventShipped',
  cancelled_by_owner: 'eventCancelledByOwner',
  resolved: 'eventResolved',
}

const capitalize = (value) => value.charAt(0).toUpperCase() + value.slice(1)

export const admin = {
  texts: {},
  // Корень страницы и её вкладки: список вкладок один — тот, что напечатала сборка
  root: null,
  tabs: [],
  // checking → out | in
  auth: 'checking',
  loginError: '',
  loggingIn: false,

  tab: DEFAULT_TAB,
  query: '',
  orders: [],
  page: 1,
  hasMore: false,
  // idle | loading | ready | failed — заказы грузятся при первом заходе в раздел
  list: 'idle',
  loadingMore: false,

  // Открытый заказ; null — показан список
  order: null,
  // Заказ открыт из списка (своя запись в истории) — «назад» вернёт к списку;
  // открытый по прямой ссылке записи не имеет, и «назад» увёл бы с сайта
  pushedOrder: false,

  // Разделы страницы: заказы и сообщения из форм (бэкенд.md §14)
  sections: [],
  section: DEFAULT_SECTION,
  messageTabs: [],
  msgTab: 'all',
  messages: [],
  msgPage: 0,
  msgHasMore: false,
  // idle | loading | ready | failed — сообщения грузятся при первом заходе в раздел
  msgList: 'idle',
  msgLoadingMore: false,
  // Раскрытое сообщение и то, над которым идёт действие
  openMessage: null,
  msgActing: null,
  msgActionFailed: null,
  // loading | ready | failed
  detail: 'idle',
  acting: false,
  actionFailed: false,

  start(element) {
    this.root = element
    this.texts = { ...element.dataset }
    this.tabs = [...element.querySelectorAll('[data-tab]')].map((button) => button.dataset.tab)
    this.sections = [...element.querySelectorAll('[data-section]')].map(
      (button) => button.dataset.section,
    )
    this.messageTabs = [...element.querySelectorAll('[data-msg-tab]')].map(
      (button) => button.dataset.msgTab,
    )

    const params = new URLSearchParams(location.search)
    const tab = params.get('tab')
    if (this.tabs.includes(tab)) this.tab = tab
    const section = params.get('s')
    if (this.sections.includes(section)) this.section = section

    // «Назад» браузера закрывает заказ и возвращает список (чеклист Г): открытие
    // заказа пишет запись в историю с его номером. Окна подтверждения пишут свою запись
    // и закрываются тем же «назад» (сложные-узлы.md п. 6) — возврат к записи заказа
    // не должен перечитывать уже открытый заказ, а запись окна нас не касается
    window.addEventListener('popstate', (event) => {
      if (event.state?.overlay) return
      const number = event.state?.order
      if (!number) this.leaveOrder()
      else if (this.order?.number !== number) this.openOrder(number, false)
    })

    this.checkSession()
  },

  /** Запрос к серверу заказов; потерянная сессия возвращает к форме входа */
  async request(path, body = null) {
    const response = await fetch(API + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (response.status === 401 && path !== '/login') {
      this.auth = 'out'
      // Сессия истекла посреди окна подтверждения: окно держит форму пароля недоступной
      const overlay = Alpine.store('overlay')
      if (overlay.active) overlay.close()
      throw new Error('unauthorized')
    }
    return response
  },

  async checkSession() {
    try {
      const response = await this.request('/session')
      this.auth = response.ok ? 'in' : 'out'
    } catch {
      this.auth = 'out'
    }
    if (this.auth === 'in') this.enter()
  },

  /** Вход состоялся (или сессия жива): список и, если в адресе есть номер, заказ */
  enter() {
    if (this.section === 'messages') this.loadMessages()
    else this.load()
    const number = Number(location.hash.slice(1))
    if (Number.isInteger(number) && number > 0) this.openOrder(number, false)
  },

  /** Адрес хранит раздел и вкладку заказов: перезагрузка и ссылка открывают то же место */
  syncUrl() {
    const params = new URLSearchParams()
    if (this.section !== DEFAULT_SECTION) params.set('s', this.section)
    if (this.section === DEFAULT_SECTION && this.tab !== DEFAULT_TAB) params.set('tab', this.tab)
    const query = params.toString()
    history.replaceState(history.state, '', location.pathname + (query ? `?${query}` : ''))
  },

  setSection(section) {
    if (!this.sections.includes(section) || section === this.section) return
    this.section = section
    this.syncUrl()
    // Каждый раздел грузится при первом заходе в него, а не заранее
    if (section === 'messages' && this.msgList === 'idle') this.loadMessages()
    if (section === 'orders' && this.list === 'idle') this.load()
  },

  /** Стрелки по вкладкам — общее правило для всех трёх полос (компоненты.md 4.4) */
  stepTabs(event, tabs, current, select, attribute) {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key]
    if (!step) return
    event.preventDefault()
    const next = tabs[(tabs.indexOf(current) + step + tabs.length) % tabs.length]
    select(next)
    event.currentTarget.parentElement.querySelector(`[${attribute}="${next}"]`)?.focus()
  },

  sectionKey(event) {
    this.stepTabs(
      event,
      this.sections,
      this.section,
      (next) => this.setSection(next),
      'data-section',
    )
  },

  async login(password) {
    if (this.loggingIn) return
    // Пустое поле — не повод ходить на сервер и тратить попытку (формы-и-поля.md п. 3.4)
    if (!password) {
      this.loginError = this.texts.tRequired
      return
    }
    this.loggingIn = true
    this.loginError = ''
    try {
      const response = await this.request('/login', { password })
      if (response.ok) {
        this.auth = 'in'
        this.enter()
      } else if (response.status === 401) {
        this.loginError = this.texts.tWrongPassword
      } else if (response.status === 429) {
        this.loginError = this.texts.tTooManyAttempts
      } else {
        this.loginError = this.texts.tActionFailed
      }
    } catch {
      this.loginError = this.texts.tActionFailed
    }
    this.loggingIn = false
  },

  async logout() {
    try {
      await this.request('/logout', {})
    } catch {
      // Сессия и так закрыта — форма входа покажется в любом случае
    }
    this.auth = 'out'
    this.orders = []
    this.list = 'idle'
    this.messages = []
    this.msgList = 'idle'
    this.leaveOrder()
  },

  /** Список вместо заказа; вместе с заказом гаснет и его состояние загрузки */
  leaveOrder() {
    this.order = null
    this.detail = 'idle'
  },

  setTab(tab) {
    if (!this.tabs.includes(tab) || tab === this.tab) return
    this.tab = tab
    // Поиск действует внутри вкладки: смена вкладки снимает его и в состоянии, и в поле
    this.query = ''
    const search = this.root?.querySelector('input[name="q"]')
    if (search) search.value = ''
    this.syncUrl()
    this.load()
  },

  tabKey(event) {
    this.stepTabs(event, this.tabs, this.tab, (next) => this.setTab(next), 'data-tab')
  },

  setMsgTab(tab) {
    if (!this.messageTabs.includes(tab) || tab === this.msgTab) return
    this.msgTab = tab
    this.openMessage = null
    this.loadMessages()
  },

  msgTabKey(event) {
    this.stepTabs(
      event,
      this.messageTabs,
      this.msgTab,
      (next) => this.setMsgTab(next),
      'data-msg-tab',
    )
  },

  async loadMessages(more = false) {
    if (more) {
      if (this.msgLoadingMore || !this.msgHasMore) return
      this.msgLoadingMore = true
    } else {
      this.msgList = 'loading'
      this.msgPage = 0
    }

    const params = new URLSearchParams({ type: this.msgTab, page: String(this.msgPage + 1) })
    try {
      const response = await this.request(`/messages?${params}`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      this.messages = more ? [...this.messages, ...data.messages] : data.messages
      this.msgPage = data.page
      this.msgHasMore = data.hasMore
      this.msgList = 'ready'
    } catch {
      if (more) Alpine.store('toast').notify({ text: this.texts.tNetwork })
      else this.msgList = 'failed'
    }
    this.msgLoadingMore = false
  },

  toggleMessage(id) {
    this.openMessage = this.openMessage === id ? null : id
    this.msgActionFailed = null
  },

  /** Действие над сообщением: «отвечено», у отзыва — «опубликовать» / «отклонить» */
  async msgAct(id, status) {
    if (this.msgActing) return
    this.msgActing = id
    this.msgActionFailed = null
    try {
      const response = await this.request(`/messages/${id}/status`, { status })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      this.messages = this.messages.map((message) =>
        message.id === id ? { ...message, status } : message,
      )
    } catch {
      this.msgActionFailed = id
    }
    this.msgActing = null
  },

  msgTypeLabel(type) {
    return this.texts[`tType${capitalize(type)}`] ?? type
  },

  msgStatusLabel(status) {
    return this.texts[`tMsg${capitalize(status)}`] ?? status
  },

  msgStatusKind(status) {
    return MESSAGE_STATUS_KIND[status] ?? 'neutral'
  },

  /** Кто написал: имя, а у «сообщить о поступлении» — почта и товар */
  msgSummary(message) {
    const fields = message.fields
    return [fields.nombre ?? fields.email, fields.producto].filter(Boolean).join(' · ')
  },

  fieldLabel(name) {
    return this.texts[`l${capitalize(name)}`] ?? name
  },

  search(value) {
    this.query = value.trim()
    this.load()
  },

  async load(more = false) {
    if (more) {
      if (this.loadingMore || !this.hasMore) return
      this.loadingMore = true
    } else {
      this.list = 'loading'
      this.page = 0
    }

    const params = new URLSearchParams({ tab: this.tab, page: String(this.page + 1) })
    if (this.query) params.set('q', this.query)

    try {
      const response = await this.request(`/orders?${params}`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      this.orders = more ? [...this.orders, ...data.orders] : data.orders
      this.page = data.page
      this.hasMore = data.hasMore
      this.list = 'ready'
    } catch {
      // Догрузка не удалась — уже показанные строки остаются, о сбое говорит уведомление
      if (more) Alpine.store('toast').notify({ text: this.texts.tNetwork })
      else this.list = 'failed'
    }
    this.loadingMore = false
  },

  async openOrder(number, push = true) {
    if (push) {
      history.pushState({ order: number }, '', `#${number}`)
      this.pushedOrder = true
    } else if (history.state?.order !== number) {
      // Заказ открыт по прямой ссылке или после перезагрузки: записи в истории у него
      // нет, а окна подтверждения возвращаются «назад» именно к ней
      history.replaceState({ order: number }, '', `#${number}`)
      this.pushedOrder = false
    }
    this.detail = 'loading'
    this.order = { number }
    try {
      const response = await this.request(`/orders/${number}`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      this.order = await response.json()
      this.detail = 'ready'
    } catch {
      this.detail = 'failed'
    }
  },

  closeOrder() {
    if (this.pushedOrder) {
      history.back()
      return
    }
    // Заказ по прямой ссылке: назад идти некуда, номер из адреса убирается,
    // иначе перезагрузка откроет заказ снова
    this.leaveOrder()
    history.replaceState(null, '', location.pathname + location.search)
  },

  /** Состояние для показа: отправленный оплаченный заказ — своё, поверх «оплачен» */
  statusOf(order) {
    return order.status === 'paid' && (order.shipped || order.shippedAt) ? 'shipped' : order.status
  },

  statusLabel(status) {
    return this.texts[`tStatus${capitalize(status)}`] ?? status
  },

  statusKind(status) {
    return STATUS_KIND[status] ?? 'neutral'
  },

  eventText(event) {
    const template = this.texts[`t${capitalize(EVENT_TEXT[event.kind] ?? '')}`] ?? event.kind
    return template
      .replace('{from}', () => this.statusLabel(event.detail?.from ?? ''))
      .replace('{to}', () => this.statusLabel(event.detail?.to ?? ''))
  },

  fmtMoney: money,
  fmtDate: dateTime,

  get canShip() {
    return this.order?.status === 'paid' && !this.order.shippedAt
  },
  get canCancel() {
    return ['created', 'pending', 'rejected'].includes(this.order?.status)
  },
  get canResolve() {
    return this.order?.status === 'review'
  },

  /** Ссылка на WhatsApp покупателя: wa.me = 549 + десять цифр (формы-и-поля.md п. 4) */
  whatsappUrl(phone) {
    return `https://wa.me/549${phone}`
  },

  openAction(name) {
    this.actionFailed = false
    Alpine.store('overlay').open(name)
  },

  /** Действие над заказом из окна подтверждения; поля приходят из формы окна */
  async act(kind, form) {
    if (this.acting || !this.order) return
    this.acting = true
    this.actionFailed = false

    const fields = Object.fromEntries(new FormData(form).entries())
    try {
      const response = await this.request(`/orders/${this.order.number}/${kind}`, fields)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      Alpine.store('overlay').close()
      form.reset()
      await Promise.all([this.openOrder(this.order.number, false), this.load()])
    } catch {
      this.actionFailed = true
    }
    this.acting = false
  },
}
