// Уведомления (сложные-узлы.md п. 8): один механизм на весь сайт, одна точка вызова.
// Тексты сюда приходят готовыми — испанских строк в скриптах не бывает (принцип 27),
// а ключи словаря знает та разметка, которая уведомление вызывает.
const LIFE_MS = 7000

export const toast = {
  visible: false,
  text: '',
  actionLabel: '',
  action: null,
  timer: null,

  notify({ text, actionLabel = '', action = null } = {}) {
    this.text = text ?? ''
    this.actionLabel = actionLabel
    this.action = action
    this.visible = true
    this.hold()
    this.resume()
  },

  /** Наведение держит уведомление на экране: прочитать «Deshacer» надо успеть */
  hold() {
    window.clearTimeout(this.timer)
    this.timer = null
  },

  resume() {
    if (!this.visible) return
    this.hold()
    this.timer = window.setTimeout(() => this.dismiss(), LIFE_MS)
  },

  run() {
    const action = this.action
    this.dismiss()
    action?.()
  },

  dismiss() {
    this.hold()
    this.visible = false
    this.action = null
  },
}
