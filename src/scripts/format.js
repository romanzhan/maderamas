// Единственные форматы чисел на весь сайт (сложные-узлы.md п. 9, тексты.md п. 3).
// Модуль лежит в браузерной части нарочно: сейчас его зовёт только сборка, а корзина
// возьмёт эти же функции — второго формата денег в проекте не появится.
const pesos = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
const decimals = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 })

/**
 * 130000 → «$ 130.000». Сентаво не показываем нигде: цены в данных целые.
 * Между знаком и суммой неразрывный пробел (тексты.md §3): разрыв строки между
 * ними читается ошибкой вёрстки.
 */
export function money(amount) {
  return `$ ${pesos.format(amount)}`
}

/** 4.5 → «4,5»: в аргентинском формате запятая отделяет десятые */
export function decimal(value) {
  return decimals.format(value)
}

// Время заказа хранится в UTC (бэкенд.md §10), владельцу показывается по Буэнос-Айресу
const dateTimes = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Buenos_Aires',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  // 24 часа: «a. m.»/«p. m.» в аргентинском формате Intl добавляет сам, а на сайте их нет
  hourCycle: 'h23',
})

/** ISO-строка → «03/09/2026 14:05» (тексты.md §3: дата ДД/ММ/ГГГГ) */
export function dateTime(iso) {
  return dateTimes.format(new Date(iso)).replace(',', '')
}
