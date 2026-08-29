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
