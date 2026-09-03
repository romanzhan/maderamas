import Alpine from 'alpinejs'
import { announcementBar } from './announcement.js'
import { catalogStore } from './catalog.js'
import { initCarousels } from './carousel.js'
import { initGallery } from './gallery.js'
import { siteHeader } from './header.js'
import { offlineNotice } from './offline.js'
import { overlay, overlayPanel } from './overlay.js'
import { productPage } from './product.js'
import { quantity } from './quantity.js'
import { reviewCard } from './review.js'
import { searchPanel } from './search.js'
import { toast } from './toast.js'
import { selectField } from './select.js'
import { cartView } from './cart.js'
import { favoritesView, wishlistButton } from './favorites.js'
import { checkoutView, thanksPage } from './checkout.js'
import { siteForm } from './form.js'
import { searchResults } from './search-page.js'
import { cart, notify, syncStores, wishlist } from './store.js'
import { admin } from './admin.js'

// Всё, что Alpine должен знать, регистрируется до старта (сложные-узлы.md п. 14)
document.addEventListener('alpine:init', () => {
  Alpine.store('overlay', overlay)
  Alpine.store('header', { scrolled: false })
  Alpine.store('cart', cart)
  Alpine.store('wishlist', wishlist)
  // Каталог: без сетки на странице store молча ничего не делает
  Alpine.store('catalog', catalogStore(Alpine))
  Alpine.store('toast', toast)
  Alpine.store('notify', notify)
  // Список заказов владельца: без своей страницы store молча ничего не делает
  Alpine.store('admin', admin)

  Alpine.data('selectField', selectField)
  Alpine.data('quantity', quantity)
  Alpine.data('siteHeader', siteHeader)
  Alpine.data('offlineNotice', offlineNotice)
  Alpine.data('overlayPanel', overlayPanel)
  Alpine.data('searchPanel', searchPanel)
  Alpine.data('announcementBar', announcementBar)
  Alpine.data('productPage', productPage)
  Alpine.data('cartView', cartView)
  Alpine.data('reviewCard', reviewCard)
  Alpine.data('siteForm', siteForm)
  Alpine.data('searchResults', searchResults)
  Alpine.data('favoritesView', favoritesView)
  Alpine.data('wishlistButton', wishlistButton)
  Alpine.data('checkoutView', checkoutView)
  Alpine.data('thanksPage', thanksPage)

  // Счётчики заполняются до первой отрисовки, иначе они мигнули бы нулём
  syncStores(Alpine)
})

// «Назад» закрывает открытую панель, а не уводит со страницы (сложные-узлы.md п. 6)
window.addEventListener('popstate', () => Alpine.store('overlay').dismiss())

// Страницу перезагрузили с открытой панелью: сама панель перезагрузку не пережила,
// а её запись в истории пережила. Снимаем с записи пометку, чтобы обработчик «назад»
// не пытался закрывать то, чего уже нет. Саму запись убрать нечем — первое «назад»
// после такой перезагрузки останется на месте
if (history.state?.overlay) history.replaceState(null, '')

// Ручной старт: stores и magic-хелперы регистрируются в alpine:init до него
Alpine.start()

// Ленты страницы: Swiper и его стили приходят только если ленты на странице есть
initCarousels()

// Галерея товара: Swiper и PhotoSwipe приходят только на страницу, где она есть
initGallery()
