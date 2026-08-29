// Избранное: страница и кнопка-сердце (состояния-экранов.md п. 5). Само состояние
// живёт в store и в localStorage — здесь только вид.

/**
 * Страница избранного. Карточки всех товаров отрисованы на сборке, а показываются
 * отмеченные. Отсюда важное: «пусто или нет» нельзя считать по счётчику store —
 * там лежат сырые записи localStorage, и товар, снятый с продажи, продолжал бы
 * считаться, оставляя пустую сетку без выхода со страницы. Поэтому считаем только
 * те отметки, которым на странице есть что показать.
 */
export function favoritesView() {
  return {
    known: [],

    init() {
      this.known = (this.$el.dataset.ids ?? '').split(' ').filter(Boolean)
    },

    get shown() {
      return this.known.filter((id) => this.$store.wishlist.has(id)).length
    },
  }
}

/**
 * Кнопка-сердце на карточке товара. Удаление из избранного показывает уведомление
 * с «Deshacer» — так же, как удаление строки в корзине (состояния-экранов.md п. 5).
 * Тексты приходят из разметки: испанских строк в скриптах не бывает.
 */
export function wishlistButton(productId) {
  return {
    toggle() {
      const wasSaved = this.$store.wishlist.has(productId)
      this.$store.wishlist.toggle(productId)

      this.$store.toast.notify({
        text: wasSaved ? this.$el.dataset.tRemoved : this.$el.dataset.tAdded,
        actionLabel: this.$el.dataset.tUndo,
        action: () => this.$store.wishlist.toggle(productId),
      })
    },
  }
}
