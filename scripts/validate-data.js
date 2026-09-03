// Проверка контрактов данных (данные.md §10) и сборка производного catalog.json (§8).
// Ошибка данных останавливает сборку с понятным сообщением.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { articleUrl, formPattern, image, imageIds, loadData, productUrl } from './data.js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Картинки, зашитые в блоки, а не в данные (картинки.md §2.6).
// Пополняется вместе с вёрсткой блока, который их выводит. Отсутствие такой картинки —
// предупреждение, а не ошибка: часть кадров владелец присылает по ходу, и до них
// в вёрстке стоит заглушка бренда — это штатное состояние, а не поломка сборки.
const CONTENT_IMAGE_IDS = [
  // Герой главной: один снимок тремя обрезками (src/blocks/home/hero.hbs)
  'home-hero-narrow',
  'home-hero-mid',
  'home-hero-wide',
  // Широкий кадр секции атмосферы (src/blocks/home/atmosphere.hbs)
  'home-atmosfera',
  // Кадры регулировки стула — инфографику готовит владелец (page-context, home.adjustFrames)
  'home-ajuste-1',
  'home-ajuste-2',
  'home-ajuste-3',
  // Кадр-передышка на странице «как это работает» (src/blocks/how/page.hbs)
  'como-funciona-foto',
  // Страница «Nosotros»: широкий кадр мастерской и снимок рядом с этапами работы
  // (src/blocks/about/page.hbs)
  'nosotros-taller',
  'nosotros-proceso',
  // Фото, зашитые в блоки главной: подбор по возрасту и разворот флагмана
  'bebe-roble-1',
  'evolutiva-roble-1',
  'home-picker-torre',
  'evolutiva-roble-2',
  'evolutiva-roble-5',
  'evolutiva-nogal-3',
  'evolutiva-blanco-2',
  'torre-2',
]

const REVIEW_SOURCES = new Set(['site', 'mercadolibre', 'whatsapp'])

// Корень адресов уже занят служебными страницами — категория с таким slug перекрыла бы их.
// Родственный список HIDDEN в scripts/seo.js решает другую задачу (что не пускать в
// sitemap), поэтому наборы похожи, но не равны: blog индексируется, а тут занят.
// Витрина /_componentes/ не перечислена — подчёркивание не проходит формат slug и так.
const RESERVED_SLUGS = new Set([
  'blog',
  'buscar',
  'carrito',
  'checkout',
  'favoritos',
  'gracias',
  'pedidos',
  '404',
])

// Адреса, на которые ссылается каркас (страницы.md, «Навигация сайта»). Это адреса
// инфостраниц, поэтому им самим они разрешены — закрыты только для категорий:
// категория с таким slug молча перекрыла бы пункт меню или подвала
const FRAME_SLUGS = new Set([
  'nosotros',
  'contacto',
  'envios-y-pagos',
  'cambios-y-devoluciones',
  'preguntas-frecuentes',
  'terminos',
  'privacidad',
  'boton-de-arrepentimiento',
  'libro-de-quejas',
])

// Полный состав site.config.json — контракт из данные.md §7
const CONFIG_SECTIONS = [
  'features',
  'cuotas',
  'currencies',
  'languages',
  'cart',
  'catalog',
  'announcement',
  'promo',
  'contacts',
  'shipping',
  'seo',
  'legal',
]

// Логотип и знак лежат среди иконок (картинки.md), но иконками не являются
const BRAND_MARKS = new Set(['logotipo', 'isotipo'])

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const HEX = /^#[0-9a-fA-F]{6}$/

// Юрисдикций Аргентины ровно столько, коды — ISO 3166-2:AR (формы-и-поля.md п. 4)
const PROVINCE_COUNT = 24

const errors = []
const warnings = []

const fail = (message) => errors.push(message)

// hasSlug: false — только у сущностей без адреса (FAQ, отзывы); у остальных slug
// обязателен, его пропажа означает страницу без URL
function checkIdAndSlug(
  list,
  label,
  { hasSlug = true, seenSlugs = new Set(), reserved = RESERVED_SLUGS } = {},
) {
  const seenIds = new Set()

  for (const item of list) {
    if (!SLUG.test(item.id ?? '')) fail(`${label}: неверный id "${item.id}"`)
    if (seenIds.has(item.id)) fail(`${label}: id "${item.id}" повторяется`)
    seenIds.add(item.id)

    if (!hasSlug) continue

    if (!SLUG.test(item.slug ?? '')) {
      fail(`${label} "${item.id}": неверный или пропущенный slug`)
      continue
    }
    if (reserved.has(item.slug)) {
      fail(
        `${label} "${item.id}": адрес "${item.slug}" уже занят страницей сайта — выберите другой`,
      )
    } else if (seenSlugs.has(item.slug)) {
      fail(`${label}: slug "${item.slug}" повторяется`)
    }
    seenSlugs.add(item.slug)
  }
}

// Проверяется первой: без разделов настроек все остальные проверки падают стеком Node,
// а владельцу нужно имя пропавшего раздела
function checkConfigSections(site) {
  const broken = CONFIG_SECTIONS.filter(
    (name) => typeof site[name] !== 'object' || !site[name] || Array.isArray(site[name]),
  )
  for (const name of broken) fail(`site.config.json: пропал или сломан раздел "${name}"`)

  if (!broken.includes('legal')) {
    const rate = site.legal.ivaRate
    if (typeof rate !== 'number' || rate < 0 || rate >= 100) {
      fail('site.config.json: legal.ivaRate — ставка налога в процентах, число от 0 до 99')
    }
  }

  // Иконку полосы объявления выбирает владелец по имени файла: опечатка иначе даст
  // пустое место в полосе и ничего больше не скажет
  if (!broken.includes('announcement') && site.announcement.icon) {
    const name = site.announcement.icon
    const source = resolve(projectRoot, `src/icons/source/${name}.svg`)
    if (!existsSync(source)) {
      fail(`site.config.json: иконки "${name}" нет — имена лежат в src/icons/source`)
    } else if (BRAND_MARKS.has(name)) {
      fail(`site.config.json: "${name}" — это знак бренда, а не иконка для полосы`)
    }
  }

  // Адрес без подписи оставил бы полосу с кнопкой без текста
  if (!broken.includes('announcement') && site.announcement.url) {
    if (typeof site.announcement.cta !== 'string' || !site.announcement.cta.trim()) {
      fail('site.config.json: у объявления есть url, значит нужна подпись кнопки (cta)')
    }
  }

  if (!broken.includes('seo') && (typeof site.seo.siteUrl !== 'string' || !site.seo.siteUrl)) {
    fail('site.config.json: seo.siteUrl должен быть адресом сайта (строкой)')
    return false
  }
  return broken.length === 0
}

// Список провинций попадает в чекаут и на сервер заказов (runtime.json): недостача или
// кривой код там обнаружатся уже на живом заказе
function checkProvinces(provinces) {
  if (provinces.length !== PROVINCE_COUNT) {
    fail(`provinces.json: должно быть ${PROVINCE_COUNT} юрисдикций, а не ${provinces.length}`)
  }

  const seen = new Set()
  for (const province of provinces) {
    if (!/^[A-Z]$/.test(province.code ?? '')) {
      fail(`provinces.json: неверный код "${province.code}" — нужна одна заглавная буква`)
    }
    if (seen.has(province.code)) fail(`provinces.json: код "${province.code}" повторяется`)
    seen.add(province.code)

    if (typeof province.name !== 'string' || !province.name.trim()) {
      fail(`provinces.json: у кода "${province.code}" пустое название`)
    }
  }
}

/**
 * У инфостраницы есть свой файл-страница. Страницы товаров и статей пишет скрипт,
 * а инфостраницы лежат первым уровнем и создаются руками (стек-и-библиотеки.md п. 3):
 * переименовали slug в данных — и запись осталась без адреса, а адрес без записи.
 */
function checkPageFiles(pages) {
  for (const page of pages) {
    const file = resolve(projectRoot, `src/pages/${page.slug}/index.html`)
    if (!existsSync(file)) {
      fail(
        `Инфостраница "${page.id}": нет файла src/pages/${page.slug}/index.html — ` +
          'запись есть, а страницы по этому адресу нет',
      )
    }
  }
}

/**
 * Разделы инфостраницы (данные.md §6): у каждого свой id, заголовок и текст, список
 * пунктов — необязательный. Раздел без текста дал бы на странице пустой заголовок.
 */
/**
 * Разделы длинного текста — один контракт у инфостраницы и у статьи (данные.md §4),
 * поэтому и проверка одна. У статьи сверх общего есть врезка и вынесенная фраза:
 * инфостранице они не нужны, но запрещать их там нечем и незачем.
 */
function checkSections(list, label) {
  for (const entry of list) {
    const sections = entry.sections ?? []
    if (!Array.isArray(sections)) {
      fail(`${label} "${entry.id}": sections должен быть списком`)
      continue
    }

    const seen = new Set()
    for (const section of sections) {
      const where = `${label} "${entry.id}", раздел "${section.id}"`
      if (!SLUG.test(section.id ?? '')) fail(`${where}: неверный или пропущенный id`)
      if (seen.has(section.id)) fail(`${where}: id раздела повторяется`)
      seen.add(section.id)

      for (const field of ['title', 'body']) {
        if (typeof section[field] !== 'string' || !section[field].trim()) {
          fail(`${where}: пустое поле ${field}`)
        }
      }

      if (section.items !== undefined) {
        const ok =
          Array.isArray(section.items) &&
          section.items.every((item) => typeof item === 'string' && item.trim())
        if (!ok) fail(`${where}: items — список непустых строк`)
      }

      // Нумерованный список без самого списка — забытое поле, а не пустой раздел
      if (section.ordered !== undefined && !Array.isArray(section.items)) {
        fail(`${where}: ordered стоит, а items нет`)
      }

      if (section.note !== undefined) {
        const note = section.note
        const titleOk = note?.title === undefined || typeof note.title === 'string'
        if (typeof note?.text !== 'string' || !note.text.trim() || !titleOk) {
          fail(`${where}: note — объект с непустым text и необязательным title`)
        }
      }

      if (section.quote !== undefined) {
        if (typeof section.quote !== 'string' || !section.quote.trim()) {
          fail(`${where}: quote — непустая строка`)
        }
      }
    }
  }
}

// Ссылка внутри текста ведёт только на свою страницу (данные.md §6): наружу — это
// решение владельца, а не вёрстка. Чужой адрес разметка молча оставила бы скобками
// прямо в тексте, поэтому ловим на сборке. Существование самой страницы здесь
// не проверяется: постоянного обхода ссылок в проекте нет намеренно (принцип 21)
const TEXT_LINK = /\[[^\]]+\]\(([^)]*)\)/g

function checkTextLinks(list, label) {
  const texts = (value) => {
    if (typeof value === 'string') return [value]
    if (Array.isArray(value)) return value.flatMap(texts)
    if (value && typeof value === 'object') return Object.values(value).flatMap(texts)
    return []
  }

  for (const entry of list) {
    for (const text of texts(entry)) {
      for (const [, href] of text.matchAll(TEXT_LINK)) {
        if (!href.startsWith('/')) {
          fail(
            `${label} "${entry.id}": ссылка "${href}" в тексте — в статьях и описаниях ` +
              `бывают только свои адреса, начинающиеся с /`,
          )
        }
      }
    }
  }
}

/** У каждой записи есть seo: { title, description } — строка или null, третьего нет */
function checkSeoBlock(list, label) {
  for (const item of list) {
    const seo = item.seo
    if (typeof seo !== 'object' || !seo || Array.isArray(seo)) {
      fail(`${label} "${item.id}": пропал блок seo — нужен { "title": null, "description": null }`)
      continue
    }

    for (const field of ['title', 'description']) {
      const value = seo[field]
      if (value !== null && typeof value !== 'string') {
        fail(`${label} "${item.id}": seo.${field} — строка или null`)
      }
    }
  }
}

function checkRequiredText(list, label, fields) {
  for (const item of list) {
    for (const field of fields) {
      if (typeof item[field] !== 'string' || !item[field].trim()) {
        fail(`${label} "${item.id}": пустое поле ${field}`)
      }
    }
  }
}

function checkDate(value, where) {
  if (!DATE.test(value ?? '')) {
    fail(`${where}: дата "${value}" не в формате ГГГГ-ММ-ДД`)
    return
  }
  if (new Date(value) > new Date()) fail(`${where}: дата "${value}" в будущем`)
}

function checkImages(ids, where, manifest) {
  for (const id of ids) {
    if (id && !(id in manifest)) {
      fail(`${where}: картинки "${id}" нет в манифесте data/images.json — запустите npm run images`)
    }
  }
}

/**
 * Посты Instagram (данные.md §4а). Кадр обязателен всегда, ролик необязателен;
 * вид плитки нигде не хранится — он выводится из кадров, поэтому и проверять его нечего.
 */
function checkInstagram(posts, images) {
  const seen = new Set()

  for (const post of posts) {
    const where = `Пост Instagram "${post.id}"`
    if (!SLUG.test(post.id ?? '')) fail(`${where}: неверный или пропущенный id`)
    if (seen.has(post.id)) fail(`${where}: id повторяется`)
    seen.add(post.id)

    if (typeof post.alt !== 'string' || !post.alt.trim()) {
      fail(`${where}: нет подписи alt — её читают вслух и видят при отключённых картинках`)
    }

    // Ссылка ведёт на сам пост: плитка без выхода в Instagram — тупик
    if (!String(post.url ?? '').startsWith('https://instagram.com/')) {
      fail(`${where}: url должен начинаться с https://instagram.com/`)
    }

    const frames = post.frames ?? []
    if (!Array.isArray(frames) || !frames.length) {
      fail(`${where}: нужен хотя бы один кадр в frames`)
      continue
    }

    for (const [index, frame] of frames.entries()) {
      const frameWhere = `${where}, кадр ${index + 1}`
      const cover = images[frame.image]
      if (!cover) {
        fail(`${frameWhere}: обложки "${frame.image}" нет в манифесте — запустите npm run images`)
      } else if (cover.type !== 'social') {
        // Не ошибка: пока настоящих постов нет, в ленте стоят кадры товарной съёмки.
        // Но такой кадр обрежется по центру под вертикаль, и знать об этом надо
        warnings.push(
          `${frameWhere}: обложка "${frame.image}" не из папки images-source/instagram — ` +
            `её обрежет по центру под вертикальный кадр`,
        )
      }

      if (frame.video) {
        const clip = images[frame.video]
        if (!clip) {
          fail(`${frameWhere}: ролика "${frame.video}" нет в манифесте — запустите npm run images`)
        } else if (clip.type !== 'video') {
          fail(`${frameWhere}: "${frame.video}" — это картинка, а не ролик`)
        }
      }
    }
  }
}

/** То же для картинок блоков: отсутствие — предупреждение, на их месте живёт заглушка */
function checkContentImages(ids, manifest) {
  for (const id of ids) {
    if (!(id in manifest)) {
      warnings.push(`картинка блока "${id}" ещё не прислана — на её месте заглушка бренда`)
    }
  }
}

function validate() {
  const {
    site,
    dictionary,
    products,
    categories,
    articles,
    reviews,
    faq,
    pages,
    provinces,
    instagram,
    images,
  } = loadData()

  if (!checkConfigSections(site)) return { site, products, categories, articles }

  // Категории и инфостраницы делят корень адресов (/sillas/, /nosotros/), поэтому
  // их slug'и проверяются одним общим набором — иначе два разных экрана дадут один URL
  const rootSlugs = new Set()
  checkIdAndSlug(categories, 'Категория', {
    seenSlugs: rootSlugs,
    reserved: new Set([...RESERVED_SLUGS, ...FRAME_SLUGS]),
  })
  checkIdAndSlug(pages, 'Инфостраница', { seenSlugs: rootSlugs })
  checkIdAndSlug(products, 'Товар')
  checkIdAndSlug(articles, 'Статья')
  checkIdAndSlug(faq, 'FAQ', { hasSlug: false })
  checkIdAndSlug(reviews, 'Отзыв', { hasSlug: false })

  // Пункт меню подписывается ключом nav.{id}; без него подставится полное название
  // категории, а пункты меню не переносятся — на 1024 длинная подпись вытеснит иконки
  // справа (компоненты.md 4.1). Молча это не проходит
  for (const category of categories) {
    if (typeof dictionary.nav?.[category.id] !== 'string') {
      warnings.push(
        `Категория "${category.id}": нет короткой подписи для меню — заведите ключ nav.${category.id} в data/dictionaries/es.json (иначе в меню встанет полное название)`,
      )
    }
  }

  checkRequiredText(categories, 'Категория', ['name'])
  checkRequiredText(articles, 'Статья', ['title', 'excerpt', 'body'])
  checkRequiredText(pages, 'Инфостраница', ['title', 'body'])
  checkRequiredText(faq, 'FAQ', ['topic', 'question', 'answer'])
  checkInstagram(instagram, images)
  checkSections(pages, 'Инфостраница')
  checkSections(articles, 'Статья')
  checkTextLinks(articles, 'Статья')
  checkTextLinks(pages, 'Инфостраница')
  checkTextLinks(products, 'Товар')
  checkPageFiles(pages)

  // Блок seo — часть контракта товаров, категорий, статей и инфостраниц (данные.md).
  // Его читает «голова» страницы; забытый блок уронил бы сборку стеком Node вместо
  // понятной строки владельцу
  checkSeoBlock(products, 'Товар')
  checkSeoBlock(categories, 'Категория')
  checkSeoBlock(articles, 'Статья')
  checkSeoBlock(pages, 'Инфостраница')

  // Раздел вопросов подписывается ключом faqTopics.{topic}; без него в заголовке
  // раздела встанет служебный id темы, и владелец увидит на странице «envio»
  for (const topic of new Set(faq.map((item) => item.topic))) {
    if (typeof dictionary.faqTopics?.[topic] !== 'string') {
      warnings.push(
        `FAQ: у темы "${topic}" нет подписи — заведите ключ faqTopics.${topic} в data/dictionaries/es.json (иначе в заголовке раздела встанет сам id)`,
      )
    }
  }
  checkRequiredText(reviews, 'Отзыв', ['author', 'text', 'source'])

  const productIds = new Set(products.map((item) => item.id))
  const categoryIds = new Set(categories.map((item) => item.id))

  for (const product of products) {
    const where = `Товар "${product.id}"`

    if (typeof product.name !== 'string' || !product.name) fail(`${where}: пустое name`)
    if (!Number.isInteger(product.price)) fail(`${where}: price должна быть целым числом`)
    if (typeof product.inStock !== 'boolean') fail(`${where}: inStock должно быть true/false`)
    if (!categoryIds.has(product.categoryId)) {
      fail(`${where}: неизвестная категория "${product.categoryId}"`)
    }
    if (product.oldPrice !== null) {
      if (!Number.isInteger(product.oldPrice)) fail(`${where}: oldPrice должна быть целым числом`)
      else if (product.oldPrice <= product.price)
        fail(`${where}: oldPrice должна быть больше price`)
    }
    checkDate(product.createdAt, where)

    for (const [axis, options] of Object.entries(product.options ?? {})) {
      for (const option of options) {
        const optionWhere = `${where}, вариант "${axis}/${option.id}"`

        // id опции уезжает и в адрес страницы (?madera=), и в id комбинации через `--`,
        // и в sku варианта — двойной дефис внутри разобрал бы комбинацию неверно
        if (!SLUG.test(option.id ?? '')) fail(`${optionWhere}: неверный id опции`)
        // swatch уходит прямо в стиль кружка: опечатка даст молча прозрачный свотч
        if (!HEX.test(option.swatch ?? '')) {
          fail(`${optionWhere}: swatch должен быть цветом вида #RRGGBB`)
        }
        if (typeof option.name !== 'string' || !option.name.trim()) {
          fail(`${optionWhere}: пустое name`)
        }
        if (typeof option.inStock !== 'boolean')
          fail(`${optionWhere}: inStock должно быть true/false`)
        if (!Number.isInteger(option.priceDelta)) {
          fail(`${optionWhere}: priceDelta должна быть целым числом`)
        }
        checkImages(option.images ?? [], optionWhere, images)
      }
    }

    for (const link of [...(product.accessories ?? []), ...(product.related ?? [])]) {
      if (!productIds.has(link)) fail(`${where}: ссылка на несуществующий товар "${link}"`)
      if (link === product.id) fail(`${where}: ссылается сам на себя`)
    }

    checkImages(
      [...imageIds(product.images), product.dimensionsImage, product.ogImage],
      where,
      images,
    )
  }

  for (const category of categories) {
    checkImages([category.image], `Категория "${category.id}"`, images)
  }

  for (const article of articles) {
    const where = `Статья "${article.id}"`
    checkDate(article.date, where)
    checkImages([article.cover], where, images)
    for (const link of article.relatedProducts ?? []) {
      if (!productIds.has(link)) fail(`${where}: ссылка на несуществующий товар "${link}"`)
    }
  }

  for (const review of reviews) {
    const where = `Отзыв "${review.id}"`
    if (!productIds.has(review.productId)) {
      fail(`${where}: ссылка на несуществующий товар "${review.productId}"`)
    }
    if (!Number.isInteger(review.rating) || review.rating < 1 || review.rating > 5) {
      fail(`${where}: rating должен быть целым от 1 до 5`)
    }
    // От source зависит право на микроразметку: размечать можно только свои отзывы,
    // чужие в разметке = ручные санкции Google (seo.md п. 5). Опечатка тут дорогая
    if (!REVIEW_SOURCES.has(review.source)) {
      fail(`${where}: source должен быть одним из ${[...REVIEW_SOURCES].join(', ')}`)
    }
    if (review.source === 'mercadolibre' && !review.sourceUrl) {
      fail(`${where}: у отзыва с Mercado Libre обязателен sourceUrl`)
    }
    if (typeof review.incentivized !== 'boolean') {
      fail(`${where}: incentivized должно быть true/false`)
    }
    checkDate(review.date, where)
    checkImages([review.image], where, images)
  }

  checkProvinces(provinces)

  checkContentImages(CONTENT_IMAGE_IDS, images)
  checkImages([site.seo.defaultOgImage, site.promo.image], 'Настройки сайта', images)

  if (site.features.secondLanguage) checkDictionaryParity(dictionary)
  if (site.seo.siteUrl.includes('PLACEHOLDER')) {
    warnings.push('site.config.json: боевой домен ещё не задан (seo.siteUrl)')
  }

  return { site, products, categories, articles, provinces, dictionary }
}

function checkDictionaryParity(es) {
  const path = resolve(projectRoot, 'data/dictionaries/en.json')
  if (!existsSync(path)) {
    fail('Включён второй язык, но нет data/dictionaries/en.json')
    return
  }
  const en = JSON.parse(readFileSync(path, 'utf8'))
  const keys = (node, prefix = '') =>
    Object.entries(node).flatMap(([key, value]) =>
      typeof value === 'string' ? [`${prefix}${key}`] : keys(value, `${prefix}${key}.`),
    )
  const esKeys = new Set(keys(es))
  const enKeys = new Set(keys(en))
  for (const key of esKeys) if (!enKeys.has(key)) fail(`en.json: нет ключа "${key}"`)
  for (const key of enKeys) if (!esKeys.has(key)) fail(`es.json: нет ключа "${key}"`)
}

function buildCatalog({ site, products, categories, articles }) {
  const catalog = {
    products: products.map((product) => ({
      id: product.id,
      slug: product.slug,
      name: product.name,
      price: product.price,
      oldPrice: product.oldPrice,
      inStock: product.inStock,
      image: imageIds(product.images)[0] ?? null,
      // Адрес и готовое фото — чтобы корзина и поиск рисовали товар, не зная ни
      // про манифест картинок, ни про правила адресов (данные.md §8)
      href: productUrl(product),
      photo: image(imageIds(product.images)[0] ?? null),
      categoryId: product.categoryId,
      createdAt: product.createdAt,
      options: Object.fromEntries(
        Object.entries(product.options ?? {}).map(([axis, options]) => [
          axis,
          options.map(({ id, name, swatch, inStock, priceDelta }) => ({
            id,
            name,
            swatch,
            inStock,
            priceDelta,
          })),
        ]),
      ),
    })),
    categories: categories.map(({ id, slug, name }) => ({ id, slug, name })),
  }

  if (site.features.blog) {
    catalog.articles = articles.map((article) => ({
      id: article.id,
      slug: article.slug,
      title: article.title,
      excerpt: article.excerpt,
      // Адрес — производное поле, как и у товара: браузер не должен знать правил
      // построения адресов (данные.md §8)
      href: articleUrl(article),
    }))
  }

  const target = resolve(projectRoot, 'public/catalog.json')
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, JSON.stringify(catalog))
  return catalog
}

// Тексты, без которых сервер не соберёт письмо (бэкенд.md §6). Проверяются здесь, а не
// на первом заказе: пропавший ключ словаря должен ломать сборку, а не письмо покупателю
const EMAIL_KEYS = [
  'subjectPaid',
  'subjectPending',
  'greeting',
  'paidIntro',
  'pendingIntro',
  'total',
  'shippingFree',
  'orderLink',
  'questions',
  'ownerSubjectPaid',
  'ownerSubjectPending',
  'ownerSubjectReview',
  'reviewAmount',
  'reviewCancelled',
  'reviewDuplicate',
  'subjectShipped',
  'shippedIntro',
  'tracking',
  'statusPaid',
  'statusPending',
  'statusReview',
  'customerTitle',
  'deliveryTitle',
  'referencesTitle',
  'notesTitle',
  'dni',
]

/**
 * Производный файл для сервера заказов (бэкенд.md §3, данные.md §12): то немногое из
 * настроек и словаря, что нужно, чтобы посчитать заказ и написать письмо. Пишется
 * рядом с кодом сервера и, как catalog.json, руками не правится и в git не хранится.
 */
function buildRuntime({ site, provinces, dictionary }) {
  for (const key of EMAIL_KEYS) {
    if (typeof dictionary.email?.[key] !== 'string') fail(`es.json: нет ключа "email.${key}"`)
  }

  const runtime = {
    shippingCost: site.shipping.cost,
    maxQtyPerItem: site.cart.maxQtyPerItem,
    provinces: Object.fromEntries(provinces.map(({ code, name }) => [code, name])),
    // Те же шаблоны, что стоят в атрибутах pattern формы: сервер проверяет поля ими же,
    // второго списка правил нет. DNI сервер проверяет уже без точек — ему шаблон не нужен
    patterns: {
      nombre: formPattern('nombre'),
      telefono: formPattern('telefono'),
      cp: formPattern('cp'),
    },
    ownerEmail: site.contacts.email,
    ownerPhone: site.contacts.phone,
    siteName: dictionary.seo.siteName,
    texts: {
      ...dictionary.email,
      // Строки, которые письмо делит со страницей «Gracias» и корзиной, — те же ключи,
      // чтобы формулировки не разошлись
      order: dictionary.thanks.order,
      nextPrepare: dictionary.thanks.nextPrepare,
      nextContact: dictionary.thanks.nextContact,
      shipping: dictionary.cart.shipping,
    },
  }

  const target = resolve(projectRoot, 'public/api/runtime.json')
  writeFileSync(target, JSON.stringify(runtime))
}

// Нечитаемый файл данных вылетает исключением из data.js — показываем владельцу
// одну понятную строку вместо стека Node
try {
  const data = validate()

  for (const warning of warnings) console.warn(`Предупреждение: ${warning}`)

  if (errors.length) {
    console.error(`Данные не прошли проверку (${errors.length}):`)
    for (const error of errors) console.error(`  — ${error}`)
    process.exit(1)
  }

  const catalog = buildCatalog(data)
  buildRuntime(data)
  console.log(
    `Данные в порядке: товаров ${catalog.products.length}, категорий ${catalog.categories.length}.`,
  )
} catch (error) {
  console.error(`Данные не прошли проверку: ${error.message}`)
  process.exit(1)
}
