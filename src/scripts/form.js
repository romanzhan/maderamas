// Единственный слой вывода ошибок форм на весь проект (формы-и-поля.md п. 1): контакт,
// две юридические формы и чекаут работают через него. Правила проверки — нативные
// (Constraint Validation API), тексты — наши.
//
// Жёсткие условия оттуда же: `novalidate` на форме, `reportValidity()` не вызывается
// никогда (он показывает браузерный пузырь в обход novalidate), стилизация по CSS
// `:invalid` запрещена — вид ошибки даёт только наш класс и `aria-invalid`.
// Тексты приходят из разметки data-атрибутами: испанских строк в скриптах не бывает.

// Опечатки в почтовых доменах: подсказка, а не ошибка (формы-и-поля.md п. 2, сост. 13).
// Список короткий намеренно — это самые частые домены в Аргентине, а не словарь мира
const DOMAINS = ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com.ar', 'icloud.com']

// Отправка быстрее трёх секунд после открытия страницы — это не человек (п. 5, анти-спам)
const MIN_FILL_MS = 3000

// Макетная отправка: показать состояние «действие выполняется» и вернуть управление.
// Настоящий обработчик появится с WordPress (страницы.md п. 8)
const FAKE_SEND_MS = 600

/**
 * Ровно одна опечатка: лишняя буква, пропущенная, не та — и перестановка соседних.
 * Перестановка считается одной ошибкой намеренно: «gmial» вместо «gmail» — самая
 * частая опечатка в домене, а по обычному Левенштейну она стоит две и не ловится.
 */
function nearlyEqual(value, target) {
  if (value === target) return false
  if (Math.abs(value.length - target.length) > 1) return false

  const rows = Array.from({ length: value.length + 1 }, () => new Array(target.length + 1).fill(0))
  for (let i = 0; i <= value.length; i++) rows[i][0] = i
  for (let j = 0; j <= target.length; j++) rows[0][j] = j

  for (let i = 1; i <= value.length; i++) {
    for (let j = 1; j <= target.length; j++) {
      const cost = value[i - 1] === target[j - 1] ? 0 : 1
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost)

      if (i > 1 && j > 1 && value[i - 1] === target[j - 2] && value[i - 2] === target[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1)
      }
    }
  }

  return rows[value.length][target.length] === 1
}

/**
 * Куда ставить фокус при ошибке. У своего списка значение хранит спрятанный select
 * (`sr-only`, `aria-hidden`), и фокус на нём не виден ни глазом, ни скринридеру —
 * озвучивает и показывает ошибку видимая кнопка-комбобокс (компоненты.md ч. 2).
 */
function focusTarget(field) {
  return document.getElementById(`${field.id}-trigger`) ?? field
}

/** Номер обращения для юридических форм (seo.md п. 8): дата плюс короткий счётчик */
function requestCode() {
  const now = new Date()
  const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate(),
  ).padStart(2, '0')}`
  return `${day}-${Math.floor(Math.random() * 9000 + 1000)}`
}

/**
 * Форма проекта. Параметры: code — выдавать номер обращения в блоке успеха;
 * onSent — что сделать после удачной отправки (чекаут уходит на страницу «спасибо»).
 */
export function siteForm({ code: withCode = false, onSent = null, spamTimer = true } = {}) {
  return {
    errors: {},
    warnings: {},
    // Домен из подсказки лежит отдельно от её текста: разбирать готовую испанскую фразу
    // обратно значило бы, что любая правка словаря тихо ломает кнопку «принять»
    suggestions: {},
    // Галочка проверенного значения (формы-и-поля.md п. 2, сост. 4) — только у полей
    // с нетривиальной проверкой и только когда нет предупреждения
    valids: {},
    // Поле, в которое человек уже что-то вводил: до этого молчим (формы-и-поля.md п. 3)
    dirty: {},
    sending: false,
    sent: false,
    // Не просто `failed`: чекаут собран из этой формы и вида корзины, а у корзины
    // своё `failed` — не загрузился каталог. Одно имя на две разные беды спутало бы их
    sendFailed: false,
    code: '',
    texts: {},
    openedAt: 0,

    init() {
      this.texts = { ...this.$el.dataset }
      this.openedAt = Date.now()
    },

    /** Поля формы, которые вообще участвуют в проверке (ловушка для ботов — не поле) */
    fields() {
      return [...this.$refs.form.elements].filter(
        (element) => element.name && element.willValidate && element.name !== 'website',
      )
    },

    /** Текст ошибки поля по флагам ValidityState: браузерный текст не годится — он на языке браузера */
    messageFor(field) {
      // Обязательный сброс перед каждой перепроверкой: иначе поле останется невалидным
      // навсегда (формы-и-поля.md п. 1, классическая ловушка)
      field.setCustomValidity('')
      if (field.validity.valid) return ''

      const state = field.validity
      if (state.valueMissing) return this.texts.msgRequired
      if (state.typeMismatch && field.type === 'email') return this.texts.msgEmail
      if (state.tooShort) return this.texts.msgShort
      // Своя подсказка поля важнее общей: «El DNI tiene 7 u 8 números» вместо «revisá»
      return field.dataset.msgPattern || this.texts.msgCheck
    },

    /** Похоже на опечатку в домене — возвращаем правильный домен или пустую строку */
    suggestionFor(field) {
      if (field.type !== 'email' || !field.value.includes('@')) return ''

      const domain = field.value.split('@').pop().toLowerCase()
      return DOMAINS.find((known) => nearlyEqual(domain, known)) ?? ''
    },

    /** Состояние поля целиком: ошибка, предупреждение и галочка считаются вместе */
    stateFor(field) {
      const error = this.messageFor(field)
      const domain = error ? '' : this.suggestionFor(field)

      return {
        error,
        domain,
        warning: domain ? this.texts.msgEmailSuggest.replace('{domain}', () => domain) : '',
        // Пустое поле проверенным не считается: галочка у пустой строки бессмысленна
        valid: Boolean(!error && !domain && field.value && field.dataset.checkValid),
      }
    },

    apply(field, state) {
      const name = field.name
      this.errors = { ...this.errors, [name]: state.error }
      this.warnings = { ...this.warnings, [name]: state.warning }
      this.suggestions = { ...this.suggestions, [name]: state.domain }
      this.valids = { ...this.valids, [name]: state.valid }
      field.setAttribute('aria-invalid', state.error ? 'true' : 'false')
    },

    check(field) {
      this.apply(field, this.stateFor(field))
    },

    /**
     * Приведение значения на лету. Отдельной библиотеки масок под это не ставим:
     * все наши «маски» сводятся к цифровым ограничениям — телефон только цифры и
     * максимум 10, DNI цифрами с точками, почтовый индекс без пробелов и заглавными
     * (формы-и-поля.md п. 4; условность снятия Maskito — стек-и-библиотеки.md).
     * Вставка из буфера проходит через тот же обработчик, поэтому нормализуется тоже.
     */
    format(field) {
      const kind = field.dataset.format
      if (!kind) return

      const before = field.value
      let value = before

      if (kind === 'phone') {
        // Полный номер из WhatsApp (+54 9 11 5555-4444) и запись с нулём (011 …) —
        // обычный способ его написать. Резать первые десять цифр нельзя: в них попадёт
        // код страны, и обрезок пройдёт проверку как верный (поймано ревью 29.08.2026).
        // Ждём то, что написано в подсказке: код области и номер, без 0 и без 15
        value = before
          .replace(/\D/g, '')
          .replace(/^54/, '')
          .replace(/^9/, '')
          .replace(/^0/, '')
          .slice(0, 10)
      }
      if (kind === 'dni') {
        // Точки ставим по три цифры справа: 12345678 → 12.345.678
        value = before
          .replace(/\D/g, '')
          .slice(0, 8)
          .replace(/\B(?=(\d{3})+(?!\d))/g, '.')
      }
      if (kind === 'zip')
        value = before
          .replace(/[^a-zA-Z0-9]/g, '')
          .toUpperCase()
          .slice(0, 8)

      if (value !== before) field.value = value
    },

    /** Ушёл из поля: проверяем только то, что заполняли (формы-и-поля.md п. 3, 1a) */
    onBlur(event) {
      if (this.dirty[event.target.name]) this.check(event.target)
    },

    /**
     * Ввод: видимая ошибка гаснет в момент исправления, новых не появляется.
     * Автозаполнение тоже даёт input — поэтому перепроверка молчаливая (п. 3, 2a)
     */
    onInput(event) {
      const field = event.target
      this.format(field)
      this.dirty = { ...this.dirty, [field.name]: true }

      // Значение правят — галочка «заполнено верно» гаснет сразу: она обещает, что
      // в поле именно то, что нужно. Ошибку при этом не показываем — она появится
      // по уходу из поля, как велит вежливая валидация
      if (this.valids[field.name]) this.valids = { ...this.valids, [field.name]: false }
      if (this.errors[field.name]) this.check(field)
    },

    /** Принять подсказку домена в одно нажатие (формы-и-поля.md п. 2, сост. 13) */
    acceptSuggestion(name) {
      const field = this.$refs.form.elements[name]
      const domain = this.suggestions[name]
      if (!field || !domain) return

      field.value = `${field.value.split('@')[0]}@${domain}`
      this.check(field)
      field.focus()
    },

    async submit() {
      if (this.sending) return

      // Проверяется всё и показывается всё разом; кнопка до этого не блокируется
      let first = null
      for (const field of this.fields()) {
        const state = this.stateFor(field)
        this.apply(field, state)
        if (state.error && !first) first = field
      }

      if (first) {
        // Прокрутка и фокус — к тому, что человек видит: у своего списка это кнопка,
        // а не спрятанный select (формы-и-поля.md п. 3.4)
        const target = focusTarget(first)
        target.scrollIntoView({ block: 'center', behavior: 'smooth' })
        target.focus({ preventScroll: true })
        return
      }

      // Ловушка для ботов и слишком быстрая отправка: молча показываем успех и ничего
      // не делаем — так бот не узнает, что его отсеяли (формы-и-поля.md п. 5)
      const trap = this.$refs.form.elements.website
      // Отметка времени — только для публичных форм обратной связи. На чекауте её нет:
      // форма приходит заполненной из черновика, и одно нажатие через две секунды —
      // это покупатель, а не бот
      const tooFast = spamTimer && Date.now() - this.openedAt < MIN_FILL_MS
      if (trap?.value || tooFast) {
        this.finish()
        return
      }

      this.sendFailed = false
      this.sending = true
      await new Promise((resolve) => setTimeout(resolve, FAKE_SEND_MS))
      this.sending = false

      // Отправлять пока некуда: обработчик придёт с WordPress. Единственная честная
      // причина отказа в статике — отсутствие связи, и её мы показываем по-настоящему
      if (!navigator.onLine) {
        this.sendFailed = true
        return
      }

      this.finish()
    },

    finish() {
      // Встроенная мини-форма показывает успех уведомлением, а не блоком: так велит
      // формы-и-поля.md п. 5 («тост — только для встроенных мини-форм»). Текст приходит
      // из разметки, как и все остальные тексты слоя
      if (this.texts.toast) {
        this.$store.toast.notify({ text: this.texts.toast })
        this.reset()
      } else {
        this.sent = true
        if (withCode) this.code = requestCode()
        // Блок успеха обязан объявиться скринридеру: без фокуса на заголовке человек
        // с диктором не узнает, что отправка прошла (формы-и-поля.md п. 5)
        this.$nextTick(() => this.$refs.success?.focus())
      }

      // Что делать дальше, решает разметка: окно закрывает себя само. Событие всплывает
      // намеренно — во время отправки `$el` указывает на саму форму, а слушатель висит
      // на её обёртке, где живёт состояние (поймано при проверке 29.08.2026)
      this.$el.dispatchEvent(new CustomEvent('form:sent', { bubbles: true }))
      onSent?.(this)
    },

    /** Форма в исходное состояние: пустые поля, снятые ошибки. Фокус не трогаем */
    reset() {
      this.sent = false
      this.errors = {}
      this.warnings = {}
      this.suggestions = {}
      this.valids = {}
      this.dirty = {}
      this.$refs.form.reset()
      this.openedAt = Date.now()

      // Сброс формы событий не рождает, а счётчик символов и высота многострочного поля
      // живут на вводе — просим их пересчитаться. Обязательно после перерисовки: пока
      // форма спрятана, высота содержимого измеряется нулём
      this.$nextTick(() => {
        for (const field of this.fields()) {
          field.dispatchEvent(new Event('input', { bubbles: true }))
        }
        this.dirty = {}
      })
    },

    /** Повторная отправка — только явным действием (формы-и-поля.md п. 5) */
    again() {
      this.reset()
      this.$nextTick(() => this.$refs.form.elements[0]?.focus())
    },
  }
}
