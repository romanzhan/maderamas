// Игры раздела Para familias на экране (страницы.md §14б): memotest, «цвета, формы
// и числа» и печать одного листа раскраски. Грузится только на страницах игр (main.js, data-game) — остальным
// страницам этот код не нужен. Наборы карт и фигур приходят из данных JSON-ом
// в разметке, тексты — из словаря атрибутами data-t-*, как у админки.

/** Перемешать копию списка (тасование Фишера — Йетса) */
function shuffled(list) {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

const pickOne = (list) => list[Math.floor(Math.random() * list.length)]

/** Подстановка в строку словаря: fill('Intentos: {n}', { n: 3 }) */
const fill = (text, vars) =>
  text.replace(/\{(\w+)\}/g, (match, name) => String(vars[name] ?? match))

const readGame = (element) =>
  JSON.parse(element.querySelector('script[type="application/json"]').textContent)

/**
 * Фокус на первую карту или вариант после новой раздачи. Кадр ожидания после $nextTick:
 * к этому моменту Alpine уже заменил элементы ленты, и фокус не уходит на удаляемые
 */
function focusFirstIn(component) {
  component.$nextTick(() =>
    requestAnimationFrame(() => component.root.querySelector('ul button')?.focus()),
  )
}

// Колонок столько, чтобы колода легла ровными рядами без хвоста в последнем
const MEMOTEST_COLUMNS = {
  8: 'grid-cols-4',
  12: 'grid-cols-4 lg:grid-cols-6',
  16: 'grid-cols-4 lg:grid-cols-8',
  24: 'grid-cols-4 sm:grid-cols-6 lg:grid-cols-8',
}

// Пара, которая не совпала, видна секунду: меньше — не успевают запомнить, больше — ждут
const MISMATCH_MS = 1000

export function memotest() {
  return {
    cards: [],
    pairs: 6,
    deck: [],
    open: [],
    moves: 0,
    busy: false,
    timer: null,
    message: '',
    texts: {},

    init() {
      // Корень игры запоминается здесь: в методе, вызванном кнопкой, $el — сама кнопка
      this.root = this.$el
      this.texts = { ...this.$el.dataset }
      this.cards = readGame(this.$el).cards
      this.pairs = Number(this.$el.dataset.pairs) || Math.min(6, this.cards.length)
      this.shuffle()
    },

    choose(pairs) {
      this.pairs = pairs
      this.shuffle()
    },

    /** focus — после нажатия «Mezclar» или «Jugar de nuevo»: кнопка, на которой стоял фокус,
     *  пропадает или остаётся в стороне, и с клавиатуры игра начиналась бы с поиска колоды */
    shuffle(focus = false) {
      // Промах прошлой партии закрыл бы карты новой и снял бы блокировку раньше времени
      clearTimeout(this.timer)
      const chosen = shuffled(this.cards).slice(0, this.pairs)
      this.deck = shuffled([...chosen, ...chosen]).map((card, key) => ({
        ...card,
        key,
        open: false,
        done: false,
      }))
      this.open = []
      this.moves = 0
      this.busy = false
      this.message = ''
      if (focus) focusFirstIn(this)
    },

    flip(card) {
      if (this.busy || card.open || card.done) return
      card.open = true
      this.open.push(card)
      // Открытую карту слышно, а не только видно: подпись кнопки меняется молча
      if (this.open.length < 2) {
        this.message = card.name
        return
      }

      this.moves++
      const [first, second] = this.open
      this.open = []
      if (first.icon === second.icon) {
        first.done = second.done = true
        first.open = second.open = false
        this.message = this.won ? this.wonLabel : fill(this.texts.tMatch, { name: first.name })
        return
      }

      this.busy = true
      // С именами обеих карт: одинаковую фразу второй раз подряд экранный диктор не прочтёт
      this.message = fill(this.texts.tNoMatch, { first: first.name, second: second.name })
      this.timer = setTimeout(() => {
        first.open = second.open = false
        this.busy = false
      }, MISMATCH_MS)
    },

    get found() {
      return this.deck.filter((card) => card.done).length / 2
    },

    get won() {
      return this.deck.length > 0 && this.deck.every((card) => card.done)
    },

    get columns() {
      return MEMOTEST_COLUMNS[this.deck.length] ?? 'grid-cols-4'
    },

    get movesLabel() {
      return fill(this.texts.tMoves, { n: this.moves })
    },

    get foundLabel() {
      return fill(this.texts.tFound, { found: this.found, total: this.pairs })
    },

    get wonLabel() {
      return fill(this.texts.tWon, { n: this.moves })
    },

    /** Закрытая карта читается номером, открытая — названием животного */
    label(card, index) {
      return card.open || card.done ? card.name : fill(this.texts.tCardHidden, { n: index + 1 })
    },
  }
}

// Заливка фигуры тоном из данных. Классы выписаны целиком: сборщик стилей находит
// их в коде по полному имени, собранное на лету имя он бы не увидел
const FILLS = {
  blue: 'fill-promo-blue',
  pink: 'fill-promo-pink',
  yellow: 'fill-promo-yellow',
  green: 'fill-promo-green',
  orange: 'fill-promo-orange',
}

// Считать до шести: столько предметов малыш охватывает взглядом и пересчитывает пальцем
const MAX_COUNT = 6
const SHAPE_OPTIONS = 4
const NUMBER_OPTIONS = 3

export function shapesGame() {
  return {
    data: { shapes: [], colors: [], counters: [] },
    mode: 'shapes',
    round: null,
    state: 'ask',
    wrong: [],
    score: 0,
    fills: FILLS,
    texts: {},

    init() {
      // Корень игры запоминается здесь: в методе, вызванном кнопкой, $el — сама кнопка
      this.root = this.$el
      this.texts = { ...this.$el.dataset }
      this.data = readGame(this.$el)
      this.next()
    },

    setMode(mode) {
      this.mode = mode
      this.score = 0
      this.next()
    },

    /** focus — после «Siguiente»: кнопка пропадает вместе с верным ответом, и фокус
     *  уходил бы в начало страницы */
    next(focus = false) {
      const previous = this.round
      this.state = 'ask'
      this.wrong = []
      // Тот же вопрос дважды подряд выглядел бы как зависшая игра
      do {
        this.round = this.mode === 'shapes' ? this.shapeRound() : this.countRound()
      } while (
        previous &&
        this.round.prompt === previous.prompt &&
        this.round.answer === previous.answer
      )
      if (focus) focusFirstIn(this)
    },

    colorName(shape, color) {
      return shape.feminine ? (color.feminineName ?? color.name) : color.name
    },

    shapeRound() {
      const { shapes, colors } = this.data
      const target = { shape: pickOne(shapes), color: pickOne(colors) }
      const key = ({ shape, color }) => `${shape.icon}-${color.tone}`

      // Отвлекающие варианты: та же фигура другого цвета и тот же цвет другой фигуры —
      // так проверяется и цвет, и форма, а не одно из двух. Остальное — любое
      const options = [target]
      const add = (option) => {
        if (option && !options.some((item) => key(item) === key(option))) options.push(option)
      }
      add({ shape: target.shape, color: pickOne(colors.filter((c) => c !== target.color)) })
      add({ shape: pickOne(shapes.filter((s) => s !== target.shape)), color: target.color })
      // Предел — по разным сочетаниям, а не по числу строк: две строки одного тона
      // дают одно сочетание, и счёт по строкам крутил бы цикл вечно
      const distinct =
        new Set(shapes.map((s) => s.icon)).size * new Set(colors.map((c) => c.tone)).size
      while (options.length < Math.min(SHAPE_OPTIONS, distinct)) {
        add({ shape: pickOne(shapes), color: pickOne(colors) })
      }

      return {
        prompt: fill(this.texts.tAskShape, {
          shape: target.shape.name,
          color: this.colorName(target.shape, target.color),
        }),
        answer: key(target),
        options: shuffled(options).map((option) => ({
          key: key(option),
          icon: option.shape.icon,
          tone: option.color.tone,
          label: fill(this.texts.tOptionShape, {
            shape: option.shape.name,
            color: this.colorName(option.shape, option.color),
          }),
          correct: key(option) === key(target),
        })),
      }
    },

    countRound() {
      const counter = pickOne(this.data.counters)
      const count = 1 + Math.floor(Math.random() * MAX_COUNT)
      const numbers = [count]
      while (numbers.length < NUMBER_OPTIONS) {
        const n = 1 + Math.floor(Math.random() * MAX_COUNT)
        if (!numbers.includes(n)) numbers.push(n)
      }

      return {
        prompt: counter.question,
        answer: String(count),
        icon: counter.icon,
        items: Array.from({ length: count }, (_, index) => index),
        // По возрастанию, а не вразброс: ребёнок ищет число на привычном месте
        options: numbers
          .sort((a, b) => a - b)
          .map((n) => ({ key: String(n), label: String(n), correct: n === count })),
      }
    },

    pick(option) {
      if (this.state === 'right' || this.isWrong(option)) return
      if (option.correct) {
        this.state = 'right'
        this.score++
      } else {
        this.state = 'wrong'
        this.wrong.push(option.key)
      }
    },

    isWrong(option) {
      return this.wrong.includes(option.key)
    },

    get scoreLabel() {
      return fill(this.texts.tScore, { n: this.score })
    },
  }
}

/**
 * Раскраски: печать одного листа. Лист отмечается на время печати — правило печати
 * (main.css) прячет остальные; отметка снимается, когда окно печати закрыли
 */
export function coloringSheets() {
  return {
    printOne(button) {
      const page = button.closest('[data-print-page]')
      page.setAttribute('data-print-only', '')
      window.addEventListener('afterprint', () => page.removeAttribute('data-print-only'), {
        once: true,
      })
      window.print()
    },
  }
}
