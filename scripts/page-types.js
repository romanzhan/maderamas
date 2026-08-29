// Типы страниц, заданные адресом. Один список на весь проект: по нему считаются
// и крошки (`page-context.js`), и «голова» страницы (`seo-meta.js`). Два таких списка
// в соседних файлах успели разойтись — в одном был чекаут, в другом нет (ревью
// 29.08.2026), поэтому они сведены сюда.

/**
 * Служебные страницы: человеку нужны, поисковику нет (seo.md п. 2). Значение — ключ
 * словаря с названием страницы.
 */
export const SERVICE_PAGES = {
  '/carrito/': 'cart.title',
  '/checkout/': 'cart.checkout',
  '/favoritos/': 'wishlist.title',
  '/buscar/': 'nav.openSearch',
  '/gracias/': 'thanks.title',
}

/**
 * Содержательные страницы, у которых нет записи в данных: название и описание берутся
 * из словаря. Первый ключ — название (оно же крошка), второй — описание для «головы».
 */
export const CONTENT_PAGES = {
  '/como-funciona/': ['howItWorks.title', 'seo.descHowItWorks'],
  '/contacto/': ['contact.title', 'seo.descContact'],
  '/preguntas-frecuentes/': ['footer.faq', 'seo.descFaq'],
  '/boton-de-arrepentimiento/': ['legal.arrepentimiento', 'seo.descArrepentimiento'],
  '/libro-de-quejas/': ['footer.quejas', 'seo.descQuejas'],
  // Заголовок вкладки короткий («Blog»), а видимый H1 свой: это разные тексты
  '/blog/': ['nav.blog', 'seo.descBlog'],
}

/** Витрина компонентов: служебная страница проекта, закрыта в robots.txt (seo.md п. 9) */
export const SHOWCASE = '/_componentes/'

/** Имя параметра адреса закреплено за осью варианта (данные.md §2) */
export const AXIS_PARAM = { woodColor: 'madera', cushionColor: 'almohadon' }
