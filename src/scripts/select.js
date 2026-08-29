// Поведение кастомного выпадающего списка (компоненты.md ч. 2).
// Значение хранит спрятанный нативный <select>: он же уходит в отправку формы и питает
// Constraint API, поэтому проверка «не выбрано» работает штатно (формы-и-поля.md п. 1).

const TYPEAHEAD_RESET = 500

// «Cordoba» должна находить «Córdoba»: тот же принцип, что у поиска по каталогу
const plain = (text) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

export function selectField() {
  return {
    open: false,
    highlighted: -1,
    value: '',
    options: [],
    placeholder: '',
    prefix: '',
    typed: '',
    typedAt: 0,

    // Пункты и текст-заглушка берутся из спрятанного select — второго списка в проекте
    // нет, значит и разойтись им негде
    init() {
      const native = this.$refs.native
      // Префикс — от id спрятанного select: он один на компонент и не зависит от того,
      // из какого элемента вызван optionId (иначе aria-activedescendant укажет в пустоту)
      this.prefix = native.id
      this.placeholder = native.options[0]?.text ?? ''
      this.options = [...native.options]
        .filter((option) => option.value)
        .map((option) => ({ code: option.value, name: option.text }))
      this.value = native.value
    },

    get selected() {
      return this.options.find((option) => option.code === this.value) ?? null
    },

    get label() {
      return this.selected ? this.selected.name : this.placeholder
    },

    optionId(index) {
      return `${this.prefix}-option-${index}`
    },

    show() {
      this.open = true
      this.highlighted = Math.max(
        0,
        this.options.findIndex((option) => option.code === this.value),
      )
      this.$nextTick(() => {
        this.scrollToHighlighted()
        // У нижней кромки экрана панель раскрывается за сгибом — подтягиваем её в кадр
        this.$refs.list.parentElement.scrollIntoView({ block: 'nearest' })
      })
    },

    hide({ focusTrigger = true } = {}) {
      this.open = false
      if (focusTrigger) this.$refs.trigger.focus()
    },

    choose(index) {
      const option = this.options[index]
      if (!option) return

      this.value = option.code
      // Нативный select — источник значения для формы; событие нужно слою валидации
      this.$refs.native.value = option.code
      this.$refs.native.dispatchEvent(new Event('change', { bubbles: true }))
      this.hide()
    },

    move(step) {
      if (!this.open) return this.show()

      const last = this.options.length - 1
      this.highlighted = Math.min(last, Math.max(0, this.highlighted + step))
      this.scrollToHighlighted()
    },

    moveTo(index) {
      this.highlighted = index
      this.scrollToHighlighted()
    },

    scrollToHighlighted() {
      const list = this.$refs.list
      if (!list) return

      // На краях прокручиваем до упора, иначе внутренний отступ списка срезается
      if (this.highlighted === 0) return void (list.scrollTop = 0)
      if (this.highlighted === this.options.length - 1) {
        return void (list.scrollTop = list.scrollHeight)
      }

      // Не children: Alpine оставляет <template> первым ребёнком, и счёт сбивался на один
      list.querySelectorAll('li')[this.highlighted]?.scrollIntoView({ block: 'nearest' })
    },

    // Набор букв подряд ищет пункт по началу названия — так же ведёт себя родной список
    typeahead(key) {
      const now = Date.now()
      this.typed = now - this.typedAt > TYPEAHEAD_RESET ? key : this.typed + key
      this.typedAt = now

      const found = this.options.findIndex((option) =>
        plain(option.name).startsWith(plain(this.typed)),
      )
      if (found < 0) return

      if (this.open) this.moveTo(found)
      else this.choose(found)
    },

    onKey(event) {
      const { key } = event

      if (key === 'Escape') {
        if (this.open) this.hide()
        return
      }
      if (key === 'Tab') {
        if (this.open) this.open = false
        return
      }

      const handlers = {
        ArrowDown: () => this.move(1),
        ArrowUp: () => this.move(-1),
        Home: () => (this.open ? this.moveTo(0) : this.show()),
        End: () => (this.open ? this.moveTo(this.options.length - 1) : this.show()),
        Enter: () => (this.open ? this.choose(this.highlighted) : this.show()),
        // Пробел выбирает, но не мешает набирать «buenos aires»
        ' ': () =>
          this.typed
            ? this.typeahead(' ')
            : this.open
              ? this.choose(this.highlighted)
              : this.show(),
      }

      if (handlers[key]) {
        event.preventDefault()
        handlers[key]()
        return
      }

      if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        this.typeahead(key)
      }
    },
  }
}
