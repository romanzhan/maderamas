// «Голова» страницы: заголовок, описание, canonical, robots, превью для соцсетей
// и микроразметка (seo.md §2, §4, §5, §6, §7). Всё считается здесь, в одном месте:
// шаблон только расставляет готовое, а второго набора правил заголовков в проекте нет.
//
// Испанских строк тут не бывает — шаблоны заголовков лежат в словаре (`seo.*`),
// подстановки делает t().
import { articleUrl, image, imageIds, inlineJson, productUrl, t } from './data.js'
import { AXIS_PARAM, CONTENT_PAGES, SERVICE_PAGES, SHOWCASE } from './page-types.js'

// Ось варианта → свойство разметки (seo.md §4)
const VARIES_BY = { woodColor: 'material', cushionColor: 'color' }

/**
 * Всё, что уходит в <head> текущей страницы.
 * Возвращает готовые строки и список блоков микроразметки — в шаблоне логики не бывает.
 */
export function seoMeta({ site, currentPath, category, catalog, product, page, article, faq }) {
  const siteUrl = site.seo.siteUrl.replace(/\/$/, '')
  const absolute = (path) => (path ? `${siteUrl}${path}` : null)
  // Размеры баннера идут из манифеста, а не числами: og-поток даёт 1200×630, но
  // обложка статьи — обычная контентная картинка, и её пропорции конвейер не меняет
  // (картинки.md §2). Соврать о размере значит получить обрезанное превью
  const ogFrom = (id) => {
    const file = image(id)
    return file ? { url: absolute(file.src), width: file.width, height: file.height } : null
  }

  // Разделы за флагом: выключенный флаг убирает страницу целиком, а не оставляет
  // её пустой (состояния-экранов.md п. 5 и 9)
  const missing =
    (currentPath === '/blog/' && !site.features.blog) ||
    (currentPath === '/favoritos/' && !site.features.wishlist)

  const meta = {
    title: '',
    description: null,
    canonical: absolute(currentPath),
    noindex: false,
    ogType: 'website',
    og: ogFrom(site.seo.defaultOgImage),
    siteName: t('seo.siteName'),
    jsonLd: [],
  }

  if (missing) {
    // Выключенный флаг: страницы не существует, и вместо неё показан блок 404
    // (состояния-экранов.md п. 5 и 9). Заголовок и robots обязаны говорить то же самое
    meta.title = t('seo.titlePage', { title: t('notFound.title') })
    meta.noindex = true
    meta.canonical = null
  } else if (currentPath === '/') {
    meta.title = site.seo.homeTitle
    meta.description = site.seo.homeDescription
  } else if (catalog) {
    meta.title = category.seo.title ?? t('seo.titleCategory', { name: category.name })
    meta.description = category.seo.description ?? category.description
  } else if (product) {
    meta.title =
      product.seo.title ??
      t('seo.titleProduct', {
        name: product.name,
        category: product.category.name,
      })
    meta.description = product.seo.description ?? product.shortDescription
    meta.ogType = 'product'
    meta.og = ogFrom(product.ogImage) ?? meta.og
  } else if (article) {
    meta.title = article.seo.title ?? t('seo.titleArticle', { title: article.title })
    meta.description = article.seo.description ?? article.excerpt
    meta.ogType = 'article'
    meta.og = ogFrom(article.cover) ?? meta.og
  } else if (page) {
    meta.title = page.seo.title ?? t('seo.titlePage', { title: page.heading })
    meta.description = page.seo.description ?? page.lead
  } else if (CONTENT_PAGES[currentPath]) {
    const [title, description] = CONTENT_PAGES[currentPath]
    meta.title = t('seo.titlePage', { title: t(title) })
    meta.description = t(description)
  } else if (SERVICE_PAGES[currentPath]) {
    meta.title = t('seo.titlePage', { title: t(SERVICE_PAGES[currentPath]) })
    meta.noindex = true
  } else if (currentPath === '/404/') {
    // Файл лежит как 404.html, поэтому адрес приходит с завершающим слешем
    meta.title = t('seo.titlePage', { title: t('notFound.title') })
    meta.canonical = null
  } else if (currentPath.startsWith(SHOWCASE)) {
    // Витрина закрыта в robots.txt, и meta robots ей поэтому не ставится: одно средство
    // на страницу, не оба (seo.md п. 9). Из карты сайта её выводит список HIDDEN там же.
    // Заголовок витрина задаёт сама — он служебный и по-русски
    meta.canonical = null
  } else {
    // Страницу завели, а тип ей не назначили: пусть лучше выпадет из индекса,
    // чем уедет туда без заголовка и описания
    meta.noindex = true
    meta.canonical = null
  }

  meta.jsonLd.push(organizationLd(site, siteUrl, absolute))
  if (currentPath === '/') meta.jsonLd.push(websiteLd(site, siteUrl))
  if (product) meta.jsonLd.push(productLd(product, { siteUrl, absolute }))
  if (article) meta.jsonLd.push(articleLd(article, { siteUrl, absolute }))
  // Разметка вопросов живёт на своей странице, а не на обеих сразу: список один и тот же,
  // и две страницы с одной разметкой конкурировали бы друг с другом (решение 28.08.2026)
  if (currentPath === '/preguntas-frecuentes/') meta.jsonLd.push(faqLd(faq))

  // Наружу отдаём готовые строки: шаблон вставляет их как есть
  meta.jsonLd = meta.jsonLd.map(inlineJson)

  return meta
}

/** Организация — один блок на всех страницах, данные из настроек (seo.md п. 6) */
function organizationLd(site, siteUrl, absolute) {
  const contacts = site.contacts

  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${siteUrl}/#organization`,
    name: site.legal.razonSocial ?? t('seo.siteName'),
    url: `${siteUrl}/`,
    logo: absolute('/icon-512.png'),
    email: contacts.email,
    telephone: contacts.phone,
    sameAs: [contacts.instagram].filter(Boolean),
    ...(contacts.address
      ? {
          address: {
            '@type': 'PostalAddress',
            streetAddress: contacts.address,
            addressCountry: 'AR',
          },
        }
      : {}),
    ...(site.legal.cuit ? { taxID: site.legal.cuit } : {}),
    // Возвратная политика размечается один раз здесь, а не в каждом товаре (seo.md п. 4)
    hasMerchantReturnPolicy: {
      '@type': 'MerchantReturnPolicy',
      applicableCountry: 'AR',
      returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
      merchantReturnDays: 10,
      returnMethod: 'https://schema.org/ReturnByMail',
      returnFees: 'https://schema.org/FreeReturn',
    },
  }
}

function websiteLd(site, siteUrl) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: t('seo.siteName'),
    url: `${siteUrl}/`,
  }
}

/** Все комбинации вариантов: id через `--` в порядке осей (данные.md §2) */
function combinations(axes) {
  return axes.reduce(
    (rows, axis) =>
      rows.flatMap((row) => axis.options.map((option) => [...row, { axis: axis.key, option }])),
    [[]],
  )
}

/**
 * Товар. С вариантами — ProductGroup плюс запись на каждую комбинацию (seo.md §4);
 * без вариантов — обычный Product. Средний рейтинг не размечается вовсе: отзывы у нас
 * с Mercado Libre, а размечать чужие запрещено (seo.md п. 5).
 */
function productLd(product, { siteUrl, absolute }) {
  const url = `${siteUrl}${productUrl(product)}`
  const sku = product.sku ?? product.id
  const images = imageIds(product.images)
    .map((id) => absolute(image(id)?.src))
    .filter(Boolean)

  const base = {
    '@context': 'https://schema.org',
    name: product.name,
    description: product.shortDescription,
    brand: { '@type': 'Brand', name: t('seo.siteName') },
    ...(images.length ? { image: images } : {}),
  }

  const offer = (price, inStock, offerUrl) => ({
    '@type': 'Offer',
    url: offerUrl,
    price,
    priceCurrency: product.currency ?? 'ARS',
    itemCondition: 'https://schema.org/NewCondition',
    availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
  })

  const axes = Object.entries(product.options ?? {}).map(([key, options]) => ({ key, options }))
  if (!axes.length) {
    return { ...base, '@type': 'Product', sku, offers: offer(product.price, product.inStock, url) }
  }

  return {
    ...base,
    '@type': 'ProductGroup',
    productGroupID: sku,
    variesBy: axes.map((axis) => `https://schema.org/${VARIES_BY[axis.key] ?? axis.key}`),
    hasVariant: combinations(axes).map((combination) => {
      const price = combination.reduce(
        (sum, { option }) => sum + (option.priceDelta ?? 0),
        product.price,
      )
      const inStock = product.inStock && combination.every(({ option }) => option.inStock)
      const params = combination
        .map(({ axis, option }) => `${AXIS_PARAM[axis] ?? axis}=${option.id}`)
        .join('&')
      const own = combination.flatMap(({ option }) =>
        (option.images ?? []).map((id) => absolute(image(id)?.src)).filter(Boolean),
      )

      return {
        '@type': 'Product',
        sku: `${sku}--${combination.map(({ option }) => option.id).join('--')}`,
        name: `${product.name} — ${combination.map(({ option }) => option.name).join(' · ')}`,
        ...Object.fromEntries(
          combination
            .filter(({ axis }) => VARIES_BY[axis])
            .map(({ axis, option }) => [VARIES_BY[axis], option.name]),
        ),
        ...(own.length ? { image: own } : {}),
        offers: offer(price, inStock, `${url}?${params}`),
      }
    }),
  }
}

function articleLd(article, { siteUrl, absolute }) {
  // Картинка размечается только своя: подставлять сюда брендовый баннер значило бы
  // размечать то, чего на странице нет (seo.md п. 6, «ничего невидимого не размечается»)
  const cover = absolute(image(article.cover)?.src)

  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.excerpt,
    datePublished: article.date,
    mainEntityOfPage: `${siteUrl}${articleUrl(article)}`,
    ...(cover ? { image: cover } : {}),
    author: { '@id': `${siteUrl}/#organization` },
    publisher: { '@id': `${siteUrl}/#organization` },
  }
}

/** Вопросы видимы на самой странице — размечаем ровно их (seo.md п. 6) */
function faqLd(faq) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [...faq]
      .sort((a, b) => a.order - b.order)
      .map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: { '@type': 'Answer', text: item.answer },
      })),
  }
}
