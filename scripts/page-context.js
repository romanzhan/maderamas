// Контекст шаблонов страницы: настройки сайта и спрайт иконок приходят сюда,
// страница может переопределить поля через хеш partial-вызова layout.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  articleUrl,
  image,
  imageAt,
  imageIds,
  inline,
  inlineJson,
  loadData,
  paragraphs,
  productUrl,
  t,
  video,
} from './data.js'
import { MESSAGE_FIELD_LABELS, MESSAGE_TYPE_LABELS } from './message-fields.js'
import { navigation } from './navigation.js'
import { AXIS_PARAM, CONTENT_PAGES, SERVICE_PAGES, SHOWCASE } from './page-types.js'
import { seoMeta } from './seo-meta.js'

// Пункты безопасности общие для всех товаров и страниц (страницы.md §3): пер-товарных
// полей безопасности нет. Список лежит здесь, а не в двух блоках сразу
const SAFETY = [
  { key: 'Corners', icon: 'squircle' },
  { key: 'Stable', icon: 'pyramid' },
  { key: 'Hardware', icon: 'wrench' },
  { key: 'Posture', icon: 'accessibility' },
]

// Шкала оценки для формы отзыва (компоненты.md 3.5): пять звёзд. Списка в шаблоне
// не создать, а число 5 в разметке было бы магическим
const RATING_SCALE = [1, 2, 3, 4, 5]

// Вкладки списка заказов владельца (бэкенд.md §13): id — как у сервера, подпись — словарь
const ADMIN_TABS = [
  { id: 'pending', label: 'admin.tabPending' },
  { id: 'paid', label: 'admin.tabPaid' },
  { id: 'shipped', label: 'admin.tabShipped' },
  { id: 'review', label: 'admin.tabReview' },
  { id: 'all', label: 'admin.tabAll' },
]

// Разделы той же страницы и вкладки сообщений по типу формы (бэкенд.md §14)
const ADMIN_SECTIONS = [
  { id: 'orders', label: 'admin.sectionOrders' },
  { id: 'messages', label: 'admin.sectionMessages' },
]
const ADMIN_MESSAGE_TABS = [
  { id: 'all', label: 'admin.msgTabAll' },
  { id: 'contact', label: 'admin.msgTabContact' },
  { id: 'arrepentimiento', label: 'admin.msgTabArrepentimiento' },
  { id: 'quejas', label: 'admin.msgTabQuejas' },
  { id: 'review', label: 'admin.msgTabReview' },
  { id: 'notify', label: 'admin.msgTabNotify' },
]

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '../src')
const spritePath = resolve(srcDir, 'icons/sprite.svg')
const iconsDir = resolve(srcDir, 'icons/source')

export function pageContext(pagePath) {
  const { site, dictionary, provinces, products, categories, articles, faq, pages, instagram } =
    loadData()

  // Флаг reviews выключает отзывы целиком, а не только секцию на странице товара:
  // звёзды не выводятся нигде (состояния-экранов.md п. 3). Гасим у источника — иначе
  // флаг пришлось бы проверять в семи местах, и одно из них однажды забудут
  const reviews = site.features.reviews ? loadData().reviews : []

  // Путь файла страницы = её адрес: /sillas/index.html → /sillas/. Нужен навигации,
  // чтобы подсветить текущий пункт меню
  const currentPath = pagePath.replace(/index\.html$/, '').replace(/\.html$/, '/')

  // Спрайт вставляется в начало страницы целиком: <use href="#icon-…"> видит только
  // символы того же документа. Нет спрайта — страница живёт без иконок, а не падает
  const sprite = existsSync(spritePath) ? readFileSync(spritePath, 'utf8') : ''

  // Адреса каналов связи собираются здесь, а не в каждом шаблоне: захочет владелец
  // предзаполненный текст в WhatsApp — меняется одна строка (принцип 16)
  const links = {
    whatsapp: `https://wa.me/${site.contacts.whatsapp}`,
    email: `mailto:${site.contacts.email}`,
    instagram: site.contacts.instagram,
    // В подвале строка Instagram показывает имя аккаунта — так же, как соседние
    // строки показывают номер и почту
    instagramHandle: `@${site.contacts.instagram.split('/').filter(Boolean).pop()}`,
  }

  // Полоса объявления может вести и на чужой сайт (Instagram), и на свою страницу
  // («Envíos y pagos»). Новую вкладку открывает только чужой адрес — признак тот же,
  // что у ссылок навигации
  const announcementUrl = site.announcement.url ?? ''
  const announcementExternal = announcementUrl.startsWith('http')

  // Отпечаток текста объявления: по нему запоминается закрытие полосы. Меняется текст —
  // меняется отпечаток, и полоса возвращается к тем, кто закрыл прежнюю
  // (сложные-узлы.md п. 13). Это не защита, а различитель, поэтому хватает суммы кодов
  const announcementId = [...(site.announcement.text ?? '')]
    .reduce((hash, character) => (hash * 31 + character.codePointAt(0)) % 1e9, 7)
    .toString(36)

  // Брендовый значок (Simple Icons) рисуется заливкой, интерфейсный (Lucide) — контуром.
  // Отличить их можно по самому файлу: у контурных есть stroke. Иначе владелец, выбрав
  // в настройках любую иконку кроме двух брендовых, получил бы закрашенное пятно
  const iconName = site.announcement.icon
  const iconSource = iconName ? resolve(iconsDir, `${iconName}.svg`) : null
  const announcementIconFilled = Boolean(
    iconSource && existsSync(iconSource) && !readFileSync(iconSource, 'utf8').includes('stroke='),
  )

  // Год в подписи подвала берётся со сборки: статика пересобирается при любой правке,
  // а на новогоднюю ночь без правок никто не смотрит
  const year = new Date().getFullYear()

  // Готовые наборы для главной собираются здесь, а не в шаблонах: логики в шаблонах
  // не бывает (стек-и-библиотеки.md), а выбирать флагман и сортировать статьи кому-то
  // надо. Пустой набор — блок на странице просто не рисуется (состояния-экранов.md п. 1)
  const featured = products.filter((product) => product.featured)
  const byId = (id) => products.find((product) => product.id === id)

  // Подбор по возрасту: адреса, фото и цены берутся у самих товаров — второго списка
  // цен в проекте быть не может (принцип 16). Нет товара — плитки просто нет
  // Тон плитки приходит отсюда: в шаблоне логики не бывает, а цвет текста на промо-фоне
  // жёстко связан с тоном (визуальная-система.md §2.2) — на жёлтом тёмный, иначе светлый
  const picker = [
    { id: 'silla-para-bebe', image: 'bebe-roble-1', key: 'Baby', tone: 'blue' },
    { id: 'silla-evolutiva', image: 'evolutiva-roble-1', key: 'Kid', tone: 'green' },
    { id: 'torre-aprendizaje', image: 'home-picker-torre', key: 'Helper', tone: 'yellow' },
  ]
    .map(({ id, image, key, tone }) => {
      const product = byId(id)
      if (!product) return null
      return {
        href: productUrl(product),
        image,
        key,
        ...listPrice(product, site),
        [tone]: true,
        onDark: tone !== 'yellow',
      }
    })
    .filter(Boolean)
  // Бейдж «Nuevo» гаснет сам: срок в настройках, дата у товара (данные.md §2)
  const newBefore = Date.now() - site.catalog.newBadgeDays * 24 * 60 * 60 * 1000

  // Карточка товара: к цене добавляются звёзды, адрес, картинки и бейджи. Собрано одной
  // функцией, потому что карточка одна и та же в каталоге, на главной, в похожих,
  // в избранном, в поиске и во врезке блога — второго правила «desde» тоже нет
  const withCard = (product) => {
    const photos = imageIds(product.images)
    return {
      ...product,
      ...listPrice(product, site),
      ...ratingOf(product.id, reviews),
      href: productUrl(product),
      isNew: Date.parse(product.createdAt) > newBefore,
      // Первое фото и второе (оно показывается под курсором). Разбор формы {id, alt}
      // живёт в одном месте: семь шаблонов делали это выражение сами
      imageId: photos[0],
      imageIdHover: photos[1],
    }
  }

  // Все товары карточками, в порядке каталога. Лента главной, избранное и страница
  // результатов поиска показывают один и тот же набор — второго списка быть не должно
  const cards = [...products].sort((a, b) => a.order - b.order).map(withCard)

  // Самая дешёвая цена категории: плитка «Sillas evolutivas» ведёт в каталог и обязана
  // обещать то, что там действительно есть
  const cheapestIn = (categoryId) => {
    const prices = products
      .filter((product) => product.categoryId === categoryId)
      .map((product) => listPrice(product, site).price)

    // Пустая категория: цены нет — плитка покажет название без обещания, а не «Infinity»
    return prices.length ? Math.min(...prices) : null
  }

  const home = {
    // Кадры для секции регулировки: инфографику готовит владелец, до неё встают
    // заглушки той же геометрии
    adjustFrames: ['home-ajuste-1', 'home-ajuste-2', 'home-ajuste-3'],
    cheapestSilla: cheapestIn('sillas'),
    // Кадр для разворота флагмана выбран отдельно от карточки (решение владельца
    // 29.08.2026): в карточке нужен первый кадр съёмки, а на развороте — тот, где стул
    // виден целиком и в интерьере. Так же выбраны кадры для плиток подбора выше
    flagshipImage: 'evolutiva-roble-2',
    flagship: withCard(products.find((product) => product.id === 'silla-evolutiva') ?? products[0]),
    featured: (featured.length ? featured : products).map(withCard),
    // В ленте на главной показываем всё, что есть: карточки листаются вбок,
    // а полный каталог всё равно за кнопкой «Ver todas»
    all: cards,
    // Все отзывы, а не только пятёрки: отбор по оценке показывал бы витрину вместо
    // мнения покупателей, и в день первой четвёрки страница начала бы врать
    // (замечание при осмотре главной 28.08.2026)
    reviews: [...reviews].sort((a, b) => b.date.localeCompare(a.date)),
    articles: [...articles].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6),
    faq: [...faq].sort((a, b) => a.order - b.order),
    picker,
    // Посты Instagram из данных: официальную ленту не встраиваем (страницы.md §1,
    // блок 9). Вид плитки — производное от кадров, а не отдельное поле: пост с одним
    // кадром это фото, с несколькими — карусель, с роликом — рилс, и хранить это
    // третьим полем значило бы позволить ему разойтись с содержимым
    instagram: instagram.map(instagramPost),
  }

  // Страница категории собирается здесь по адресу: файл страницы тонкий и знать
  // о своей категории не обязан (страницы.md §2)
  const category = categories.find((item) => currentPath === `/${item.slug}/`) ?? null
  const catalog = category ? categoryPage(category, products, withCard) : null

  // Инфостраница — тем же способом: адрес знает, какая это запись pages.json.
  // Тело и разделы разбираются здесь: разбирать текст в шаблоне нечем (данные.md §6)
  const info = pages.find((item) => currentPath === `/${item.slug}/`) ?? null
  const page = info ? contentPage(info) : null

  // Блог: список и статья (страницы.md §14). Флаг выключен — обоих нет, и страницы
  // блога не генерируются вовсе
  const byDate = [...articles].sort((a, b) => b.date.localeCompare(a.date))
  const blog = currentPath === '/blog/' && site.features.blog ? { articles: byDate } : null

  const foundArticle = site.features.blog
    ? (byDate.find((item) => currentPath === articleUrl(item)) ?? null)
    : null
  const article = foundArticle ? articlePage(foundArticle, byDate, products, withCard) : null

  // Вопросы по темам (страницы.md §12). Подпись темы — ключ словаря по её id, как
  // у категорий в меню; нет ключа — встаёт сам id, и это видно в предупреждении сборки
  const faqPage = currentPath === '/preguntas-frecuentes/' ? groupFaq(faq, dictionary) : null

  // Страница товара — тем же способом: адрес знает, какой это товар
  const found = products.find((item) => currentPath === productUrl(item)) ?? null
  const product = found
    ? productPage(found, { categories, products, reviews, site, withCard })
    : null

  // Страница «как это работает» показывает устройство на флагмане: числа и пункты
  // берутся у него же, второго списка характеристик в проекте нет
  const flagship = products.find((item) => item.id === 'silla-evolutiva') ?? products[0]
  const how =
    currentPath === '/como-funciona/' && flagship
      ? productPage(flagship, { categories, products, reviews, site, withCard })
      : null

  // Крошки: видимые и разметка — одно и то же (seo.md п. 4). Родителя помечаем здесь,
  // потому что на телефоне видна только его строка, а в шаблоне логики не бывает.
  // Служебные страницы получают крошки без микроразметки (seo.md п. 4): цепочка
  // «Inicio → название» помогает человеку, а поисковику этих страниц не видно.
  // Чекаут в списке служебных есть, но крошек не показывает: у него шапка bare
  // и путь назад ведёт только в корзину (страницы.md §7)
  const inicio = { label: t('nav.home'), href: '/' }
  const breadcrumbs = catalog
    ? markBreadcrumbs([inicio, { label: category.name }])
    : product
      ? markBreadcrumbs([
          inicio,
          { label: product.category.name, href: `/${product.category.slug}/` },
          { label: product.name },
        ])
      : page
        ? markBreadcrumbs([inicio, { label: page.heading }])
        : article
          ? markBreadcrumbs([
              inicio,
              { label: t('nav.blog'), href: '/blog/' },
              { label: article.title },
            ])
          : SERVICE_PAGES[currentPath]
            ? markBreadcrumbs([inicio, { label: t(SERVICE_PAGES[currentPath]) }], { plain: true })
            : CONTENT_PAGES[currentPath]
              ? markBreadcrumbs([inicio, { label: t(CONTENT_PAGES[currentPath][0]) }])
              : null

  // empty — явный пустой контекст для вложенных вызовов: без него partial наследует всё
  // окружение вызывающего и «чужой» флаг молча включает ветку (см. стек-и-библиотеки п. 3)
  // Витрина показывает крошки образцом: собственной цепочки у неё нет
  const showcase = currentPath.startsWith(SHOWCASE)
    ? {
        breadcrumbs: markBreadcrumbs([
          inicio,
          { label: t('nav.sillas') },
          { label: 'Silla Evolutiva' },
        ]),
        // Витрине нужен образец недоступного варианта: в данных сейчас все опции
        // в наличии, а состояние «перечёркнут» реестр требует показывать
        woodColors: (products[0]?.options?.woodColor ?? []).map((option, index) => ({
          ...option,
          inStock: index !== 2,
        })),
        // Образец абзацев для компонента prose: берём настоящий текст инфостраницы,
        // чтобы на витрине был виден просвет между абзацами, а не один абзац
        body: paragraphs(pages[0]?.body ?? ''),
      }
    : null

  // «Голова» страницы считается одним местом для всех типов страниц (seo.md §2)
  const seo = seoMeta({ site, currentPath, category, catalog, product, page, article, faq })

  return {
    seo,
    catalog,
    product,
    how,
    page,
    blog,
    // Все статьи, новые первыми: их показывает страница результатов поиска — она
    // отрисовывает карточки заранее и прячет несовпавшие
    articles: byDate,
    article,
    faqPage,
    breadcrumbs,
    showcase,
    adminTabs: ADMIN_TABS,
    adminSections: ADMIN_SECTIONS,
    adminMessageTabs: ADMIN_MESSAGE_TABS,
    // Подписи полей и названия типов сообщений — из того же списка, что и письма владельцу
    adminMessageLabels: Object.entries(MESSAGE_FIELD_LABELS).map(([field, key]) => ({ field, key })),
    adminMessageTypes: Object.entries(MESSAGE_TYPE_LABELS).map(([type, key]) => ({ type, key })),
    site,
    sprite,
    cards,
    safety: SAFETY,
    ratingScale: RATING_SCALE,
    provinces,
    products,
    year,
    links,
    announcementExternal,
    announcementId,
    announcementIconFilled,
    nav: navigation(currentPath),
    home,
    empty: {},
  }
}

/**
 * Цена товара в списках (данные.md §2): минимальная цена доступной комбинации,
 * и подпись «desde», если разброс по вариантам вообще есть. Считается в одном месте —
 * каталог, главная и подбор показывают одно и то же число.
 */
function listPrice(product, site) {
  const axes = Object.values(product.options ?? {})
  const deltas = axes.flat().map((option) => option.priceDelta ?? 0)

  // Минимум — по доступным опциям (данные.md §2: «минимальная цена доступной
  // комбинации»). Если доступных нет вовсе, считаем по всем: цена «от» у распроданного
  // товара всё равно справочная
  const minimum = axes.reduce((sum, axis) => {
    const usable = axis.filter((option) => option.inStock)
    const from = (usable.length ? usable : axis).map((option) => option.priceDelta ?? 0)
    return sum + Math.min(...from)
  }, 0)

  // Старая цена сдвигается тем же минимумом, что и текущая: иначе у товара с вариантами
  // зачёркнутая цена относилась бы к другой комбинации, и процент скидки соврал бы
  const price = product.price + minimum
  const old = product.oldPrice ? product.oldPrice + minimum : null

  return {
    price,
    old,
    // Размер скидки — целый процент вниз от старой цены (компоненты.md 3.3)
    discount: old ? `-${Math.round(((old - price) / old) * 100)}%` : null,
    priceFrom: deltas.some((delta) => delta !== 0),
    // Есть из чего выбирать — карточка ведёт на страницу товара, а не кладёт в корзину
    hasOptions: axes.length > 0,
    // Плашка envío существует только при бесплатной доставке (компоненты.md 3.6):
    // поставит владелец стоимость — плашка исчезнет сама, а не останется врать.
    // У распроданного товара её нет вовсе (замечание владельца 29.08.2026): бесплатная
    // доставка — довод купить, а купить сейчас нельзя, и рядом с «Sin stock» плашка
    // обещает то, чего не будет
    freeShipping: site.shipping.cost === 0 && product.inStock,
  }
}

/**
 * Средняя оценка товара по его отзывам. Звёзды на карточке показываются только когда
 * отзывы есть (компоненты.md 3.6), поэтому без них поле остаётся пустым, а не нулём.
 * Считается здесь и для карточки, и для страницы товара — второго подсчёта нет.
 */
function ratingOf(productId, reviews) {
  const own = reviews.filter((review) => review.productId === productId)
  if (!own.length) return { rating: null, reviewsCount: 0 }

  const sum = own.reduce((total, review) => total + review.rating, 0)
  return { rating: sum / own.length, reviewsCount: own.length }
}

/**
 * Инфостраница (данные.md §6): вводный текст и разделы разбираются на абзацы здесь —
 * разбирать текст в шаблоне нечем. Пустой раздел не рисуется вовсе
 * (состояния-экранов.md п. 10).
 */
function contentPage(entry) {
  return {
    ...entry,
    heading: entry.title,
    body: paragraphs(entry.body),
    sections: (entry.sections ?? []).map((section) => ({
      ...section,
      body: paragraphs(section.body),
    })),
  }
}

/**
 * Пост Instagram (страницы.md §1, блок 9). Кадры приходят готовыми: адрес ролика
 * и обложка берутся из манифеста здесь, а не в разметке — вёрстка путей не знает
 * (картинки.md §3).
 */
function instagramPost(post) {
  const frames = (post.frames ?? []).map((frame) => ({
    image: frame.image,
    video: video(frame.video),
    // Постер ролика — та же обложка, но одним адресом: атрибут poster шкалы ширин
    // не понимает, а плитка в ленте не шире 400 CSS-пикселей
    poster: imageAt(frame.image, 800),
  }))

  return {
    ...post,
    frames,
    multiple: frames.length > 1,
    hasVideo: frames.some((frame) => frame.video),
  }
}

/**
 * Статья блога (страницы.md §14): лид абзацами, разделы, товары из подборки автора
 * и соседние статьи. Соседи берутся из общего списка по дате — второго порядка статей
 * в проекте нет. Разделы устроены так же, как у инфостраницы (данные.md §4): один
 * контракт на два вида длинного текста, второго изобретать незачем.
 */
function articlePage(article, byDate, products, withCard) {
  const others = byDate.filter((item) => item.id !== article.id)
  const sections = (article.sections ?? []).map((section) => ({
    ...section,
    body: paragraphs(section.body),
    items: (section.items ?? []).map(inline),
    note: section.note && { ...section.note, text: inline(section.note.text) },
    quote: section.quote && inline(section.quote),
  }))

  return {
    ...article,
    body: paragraphs(article.body),
    sections,
    readingMinutes: readingMinutes(article),
    related: (article.relatedProducts ?? [])
      .map((id) => products.find((item) => item.id === id))
      .filter(Boolean)
      .map(withCard),
    // Соседние статьи: ближайшие по списку, а не «похожие» — похожесть нам считать нечем
    more: others.slice(0, 3),
  }
}

// Скорость обычного чтения про себя — около 200 слов в минуту. Меньше минуты не бывает:
// «0 min de lectura» читается ошибкой, а не короткой заметкой
const WORDS_PER_MINUTE = 200

/**
 * Время чтения статьи в минутах — считается по всему её тексту, отдельным полем
 * в данных его нет. Считается по исходной записи, а не по подготовленной: подписи
 * разделов и пункты списков читатель тоже читает.
 */
function readingMinutes(article) {
  const parts = [article.excerpt, article.body]
  for (const section of article.sections ?? []) {
    parts.push(section.title, section.body, ...(section.items ?? []))
    parts.push(section.note?.text, section.quote)
  }

  const words = parts.filter(Boolean).join(' ').split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE))
}

/**
 * Вопросы по темам (страницы.md §12). Порядок тем — порядок первого появления в данных,
 * порядок вопросов внутри — поле order. Подпись темы приходит из словаря по её id;
 * ключа нет — встаёт сам id, и об этом предупреждает сборка.
 */
function groupFaq(faq, dictionary) {
  const topics = []

  for (const item of [...faq].sort((a, b) => a.order - b.order)) {
    let topic = topics.find((known) => known.id === item.topic)
    if (!topic) {
      topic = { id: item.topic, label: dictionary.faqTopics?.[item.topic] ?? item.topic, items: [] }
      topics.push(topic)
    }
    topic.items.push(item)
  }

  return { topics }
}

/** Последняя строка — текущая страница, предпоследняя — родитель: на телефоне видна она */
function markBreadcrumbs(items, { plain = false } = {}) {
  return {
    plain,
    items: items.map((item, index) => ({
      ...item,
      position: index + 1,
      current: index === items.length - 1,
      parent: index === items.length - 2,
    })),
  }
}

/**
 * Каталог категории (страницы.md §2). Товары и наборы значений для фильтров считаются
 * здесь: шаблон только раскладывает готовое.
 */
function categoryPage(category, products, withCard) {
  const items = products
    .filter((product) => product.categoryId === category.id)
    .sort((a, b) => a.order - b.order)

  // Цвета дерева — только те, что действительно есть у товаров этой категории:
  // фильтр с пунктом, который ничего не находит, хуже отсутствующего фильтра
  const woodColors = []
  for (const product of items) {
    for (const color of product.options?.woodColor ?? []) {
      if (!woodColors.some((known) => known.id === color.id)) {
        woodColors.push({ id: color.id, name: color.name, swatch: color.swatch })
      }
    }
  }

  return {
    category,
    // Порядки сортировки (страницы.md §2). Список здесь, а не в шаблоне: те же коды
    // читает скрипт из адреса страницы
    sortOptions: [
      { code: 'relevancia', name: t('catalog.sortRelevance') },
      { code: 'precio-asc', name: t('catalog.sortPriceAsc') },
      { code: 'precio-desc', name: t('catalog.sortPriceDesc') },
      { code: 'nuevos', name: t('catalog.sortNewest') },
    ],
    // Фильтр наличия появляется, только когда есть чего фильтровать
    hasStockFilter: items.some((product) => !product.inStock),
    woodColors,
    hasFilters: woodColors.length > 0 || items.some((product) => !product.inStock),
    // Карточка собирается той же функцией, что на главной и в поиске: в каталоге
    // к ней добавляется только список цветов, по которому фильтрует скрипт
    products: items.map((product) => ({
      ...withCard(product),
      colorIds: (product.options?.woodColor ?? []).map((color) => color.id).join(' '),
    })),
  }
}

/**
 * Аксессуар для блока допродажи. Считается тем же способом, что и сам товар: оси,
 * выбранное по умолчанию и данные для браузера — чтобы цена в блоке менялась вместе
 * с выбранным цветом, а в корзину уходила именно выбранная комбинация.
 */
function accessoryFor(item, site) {
  const axes = Object.entries(item.options ?? {}).map(([key, options]) => ({
    key,
    label: `product.${key}`,
    options,
    selected: (options.find((option) => option.inStock) ?? options[0])?.id,
  }))

  const defaults = Object.fromEntries(axes.map((axis) => [axis.key, axis.selected]))

  return {
    id: item.id,
    name: item.name,
    href: productUrl(item),
    imageId: imageIds(item.images)[0],
    ...listPrice(item, site),
    axes,
    clientJson: inlineJson({
      id: item.id,
      price: item.price,
      defaults,
      axes: Object.fromEntries(
        axes.map((axis) => [
          axis.key,
          axis.options.map(({ id, priceDelta, inStock }) => ({ id, priceDelta, inStock })),
        ]),
      ),
    }),
  }
}

/** Похожие товары: сначала подборка владельца, иначе соседи по категории */
function relatedFor(product, products) {
  const chosen = (product.related ?? [])
    .map((id) => products.find((item) => item.id === id))
    .filter((item) => item && item.id !== product.id)

  if (chosen.length) return chosen

  return products
    .filter((item) => item.categoryId === product.categoryId && item.id !== product.id)
    .sort((a, b) => a.order - b.order)
}

/**
 * Страница товара (страницы.md §3). Всё, что странице нужно знать, считается здесь:
 * оси вариантов, галерея по опциям, характеристики, отзывы, похожие товары.
 * В шаблоне логики не бывает, а в скрипте не бывает испанских строк.
 */
function productPage(product, { categories, products, reviews, site, withCard }) {
  const category = categories.find((item) => item.id === product.categoryId)

  // Выбранное по умолчанию — первая доступная опция каждой оси (данные.md §2).
  // Ось носит его с собой: отметку на свотче ставит разметка, и первый подряд
  // вариант тут не годится — он может оказаться распроданным
  const axes = Object.entries(product.options ?? {}).map(([key, options]) => ({
    key,
    label: `product.${key}`,
    options,
    selected: (options.find((option) => option.inStock) ?? options[0])?.id,
  }))

  const defaults = Object.fromEntries(axes.map((axis) => [axis.key, axis.selected]))

  // Галерея: у оси цвета дерева свои фото, у остальных осей их не бывает.
  // Скрипту нужны готовые адреса — манифест картинок на страницу не уезжает
  const woodColor = product.options?.woodColor ?? []

  // Alt собирается шаблоном (картинки.md п. 4); данные вправе перебить его объектом
  // {id, alt} (данные.md §2). Подпись миниатюры своя: она кнопка выбора кадра,
  // и повторять ею длинный alt большого фото незачем
  const slidesFor = (items, variant) =>
    items
      .map((item, index) => {
        const ref = typeof item === 'string' ? { id: item } : item
        const file = image(ref.id)
        if (!file) return null

        const n = index + 1
        const alt =
          ref.alt ??
          (variant
            ? t('product.galleryAltVariant', { name: product.name, variant, n })
            : t('product.galleryAlt', { name: product.name, n }))

        return { ...file, alt, thumbAlt: t('product.galleryThumb', { n }) }
      })
      .filter(Boolean)

  const gallery = {}
  for (const option of woodColor) {
    gallery[option.id] = option.images?.length
      ? slidesFor(option.images, option.name)
      : slidesFor(product.images)
  }
  const base = slidesFor(product.images)
  gallery.default = base

  const current = gallery[defaults.woodColor] ?? base

  // Допродажа аксессуара (компоненты.md 3.11): первый доступный из подборки владельца.
  // Аксессуар с вариантами приходит вместе со своими цветами — иначе галочка положила бы
  // в корзину случайный цвет, а подушку выбирают глазами
  const upsell = (product.accessories ?? [])
    .map((id) => products.find((item) => item.id === id))
    .find((item) => item && item.inStock)

  const accessory = upsell ? accessoryFor(upsell, site) : null

  const productReviews = reviews
    .filter((review) => review.productId === product.id)
    .sort((a, b) => b.date.localeCompare(a.date))

  // Длинное описание сворачивается (состояния-экранов.md п. 3); короткое остаётся
  // как есть, и кнопки у него не бывает. Порог — абзацы, а не символы: рвать текст
  // по середине абзаца некрасиво
  const description = paragraphs(product.description)

  const { attributes } = product
  const specs = [
    attributes.material && { label: 'spec.material', value: attributes.material },
    attributes.dimensions && {
      label: 'spec.dimensions',
      value: t('spec.dimensionsValue', {
        w: attributes.dimensions.width,
        d: attributes.dimensions.depth,
        h: attributes.dimensions.height,
        unit: attributes.dimensions.unit,
      }),
    },
    attributes.ageRange && { label: 'spec.age', value: attributes.ageRange },
    attributes.maxLoad && {
      label: 'spec.load',
      value: t('spec.loadValue', { n: attributes.maxLoad }),
    },
    attributes.weight && {
      label: 'spec.weight',
      value: t('spec.weightValue', { n: attributes.weight }),
    },
  ].filter(Boolean)

  // Цена выбранной по умолчанию комбинации: страница открывается уже с ней, и число
  // в разметке обязано совпасть с тем, что посчитает скрипт (данные.md §2)
  const defaultDelta = axes.reduce((sum, axis) => {
    const option = axis.options.find((item) => item.id === defaults[axis.key])
    return sum + (option?.priceDelta ?? 0)
  }, 0)

  return {
    ...product,
    ...listPrice(product, site),
    basePrice: product.price,
    selectedPrice: product.price + defaultDelta,
    selectedOldPrice: product.oldPrice ? product.oldPrice + defaultDelta : null,
    category,
    axes,
    defaults,
    slides: current,
    galleryJson: inlineJson(gallery),
    // Для скрипта — только то, что ему нужно считать: цена, наличие и оси
    clientJson: inlineJson({
      id: product.id,
      price: product.price,
      oldPrice: product.oldPrice,
      inStock: product.inStock,
      // Имя параметра адреса закреплено за осью (данные.md §2). Браузеру карта нужна,
      // чтобы читать и писать адрес; своей копии у него быть не должно
      params: Object.fromEntries(axes.map((axis) => [axis.key, AXIS_PARAM[axis.key]])),
      // Спутник цены (Res. 4/2025) считается от цены комбинации, а она меняется
      // в браузере — значит и ставка нужна здесь
      ivaRate: site.legal.ivaRate,
      defaults,
      axes: Object.fromEntries(
        axes.map((axis) => [
          axis.key,
          axis.options.map(({ id, priceDelta, inStock }) => ({ id, priceDelta, inStock })),
        ]),
      ),
    }),
    description,
    descriptionLong: description.length > 2,
    specs,
    safety: SAFETY,
    accessory,
    reviews: productReviews,
    ...ratingOf(product.id, reviews),
    // То же правило, что на карточке: у распроданного товара доставку не обещаем
    freeShipping: site.shipping.cost === 0 && product.inStock,
    // Подборка владельца (поле related в данных) — главная; она может уводить и в другую
    // категорию, в этом и смысл. Пусто — показываем соседей по категории
    related: relatedFor(product, products).slice(0, 4).map(withCard),
  }
}
