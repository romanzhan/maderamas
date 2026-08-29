// Счётчик количества (компоненты.md ч. 2). Предел приходит из настроек
// (cart.maxQtyPerItem): реального остатка в статике нет, он появится с WooCommerce.
export function quantity({ value = 1, max = 10 } = {}) {
  return {
    value,
    max,

    get atMin() {
      return this.value <= 1
    },

    get atMax() {
      return this.value >= this.max
    },

    step(delta) {
      // Значение приходит из текстового поля строкой: без Number «5» + 1 склеится в «51»
      this.value = Math.min(this.max, Math.max(1, Number(this.value) + delta))
    },

    // Правим значение только когда человек ушёл из поля: иначе стирание последней
    // цифры мгновенно подставляло бы единицу и мешало набирать
    normalize() {
      const digits = parseInt(String(this.value).replace(/\D/g, ''), 10)
      this.value = Number.isNaN(digits) ? 1 : Math.min(this.max, Math.max(1, digits))
    },
  }
}
