// Состав навигации собирается здесь один раз и расходится в шапку, бургер-меню и подвал
// (`страницы.md`, раздел «Навигация сайта»). Пункт, добавленный сюда, появляется везде;
// выключённый флаг убирает его отовсюду.
import { loadData, t } from './data.js'

// В меню пункт короче названия категории («Sillas» против «Sillas evolutivas»), поэтому
// подпись берётся из словаря по id категории. У новой категории ключа может не быть —
// тогда работает её собственное название, а не падение сборки.
function categoryLabel(category, dictionary) {
  return dictionary.nav[category.id] ?? category.name
}

export function navigation(currentPath) {
  const { site, categories, dictionary } = loadData()

  // Страница товара тоже подсвечивает свою категорию: адрес товара начинается с неё
  const isCurrent = (href) => currentPath.startsWith(href)
  const item = (label, href) => ({ label, href, current: isCurrent(href) })

  const catalog = [...categories]
    .sort((a, b) => a.order - b.order)
    .map((category) => item(categoryLabel(category, dictionary), `/${category.slug}/`))

  const blog = site.features.blog ? [item(t('nav.blog'), '/blog/')] : []
  const nosotros = item(t('nav.nosotros'), '/nosotros/')
  const contacto = item(t('nav.contacto'), '/contacto/')

  // Второй уровень бургер-меню и колонка «Ayuda» в подвале — один список;
  // в подвале к нему добавляется «Contacto», в меню он есть первым уровнем
  const help = [
    item(t('footer.envios'), '/envios-y-pagos/'),
    item(t('footer.devoluciones'), '/cambios-y-devoluciones/'),
    item(t('footer.faq'), '/preguntas-frecuentes/'),
  ]

  return {
    main: [...catalog, nosotros, ...blog, contacto],
    // Только категории и полными именами: пустое поле поиска показывает их списком
    // (решение владельца 27.08.2026), а в найденном та же категория приходит из
    // catalog.json — коротких подписей меню там нет, и один список назывался бы
    // по-разному в двух состояниях одной панели.
    // «Ver catálogo» ведёт в первую категорию — отдельной страницы каталога нет
    // id нужен странице результатов поиска: она прячет несовпавшие пункты по нему
    categories: [...categories]
      .sort((a, b) => a.order - b.order)
      .map((category) => ({ ...item(category.name, `/${category.slug}/`), id: category.id })),
    catalogHref: catalog[0]?.href ?? '/',
    // Адрес второй категории: он тоже из данных, а не строкой по месту
    accesoriosHref: catalog[1]?.href ?? catalog[0]?.href ?? '/',
    help,
    helpFooter: [...help, contacto],
    shop: [...catalog, item(t('howItWorks.title'), '/como-funciona/'), nosotros, ...blog],
    // Data Fiscal — последняя строка юридической колонки (страницы.md, «Навигация
    // сайта»); ссылка ведёт на страницу ARCA, поэтому открывается в новой вкладке
    // Botón de Arrepentimiento стоит здесь же: с 27.08.2026 это его единственное место
    legal: [
      item(t('footer.terminos'), '/terminos/'),
      item(t('footer.privacidad'), '/privacidad/'),
      item(t('legal.arrepentimiento'), '/boton-de-arrepentimiento/'),
      item(t('footer.quejas'), '/libro-de-quejas/'),
      ...(site.legal.dataFiscalUrl
        ? [{ ...item(t('footer.dataFiscal'), site.legal.dataFiscalUrl), external: true }]
        : []),
    ],
  }
}
