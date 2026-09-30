// Служебные файлы поиска (seo.md п. 9): sitemap.xml и robots.txt — после сборки.
// Список URL берётся из собранных страниц, поэтому в карту не попадает то, чего нет.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { articleUrl, image, imageIds, loadData, productUrl } from './data.js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distRoot = resolve(projectRoot, 'dist')

// Витрина закрыта в robots.txt: своей meta у неё нет, а в карту ей нельзя.
// Сервер заказов роботу тем более не нужен — он отвечает JSON, а не страницами;
// список заказов владельца — под паролем, роботу там делать нечего
const HIDDEN = ['/_componentes/']
const DISALLOW = ['/_componentes/', '/api/', '/admin/']

// Второго списка «что не индексируем» не держим: страница сама несёт meta noindex,
// и карта читает её же (27.08.2026 — иначе списки расходятся, и в карту попадает
// закрытая страница)
const NOINDEX = 'name="robots" content="noindex"'

const { site, articles, products } = loadData()
const siteUrl = site.seo.siteUrl.replace(/\/$/, '')
// Хост магазина как шаблон для правила сервера: точка в нём — «любой символ»
const canonicalHostPattern = new URL(siteUrl).host.replaceAll('.', '\\.')

const toUrl = (file) => `/${file.replaceAll(sep, '/').replace(/index\.html$/, '')}`

const urls = readdirSync(distRoot, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('index.html'))
  .filter((file) => !readFileSync(resolve(distRoot, file), 'utf8').includes(NOINDEX))
  .map(toUrl)
  .filter((url) => !HIDDEN.includes(url))
  .sort()

const lastmodByUrl = new Map(articles.map((article) => [articleUrl(article), article.date]))

// Фото товаров (все цвета) и обложки статей — в карту: так их быстрее находит поиск
// по картинкам, в том числе фото других цветов, которые на странице видны не сразу
const imageFiles = (ids) => [
  ...new Set(
    ids
      .map((id) => image(id)?.src)
      .filter(Boolean)
      .map((src) => `${siteUrl}${src}`),
  ),
]
const imagesByUrl = new Map([
  ...products
    // Товар без раздела живёт нигде (productUrl отдаёт «/») — его фото не на главной
    .filter((product) => productUrl(product) !== '/')
    .map((product) => [
      productUrl(product),
      imageFiles([
        ...imageIds(product.images),
        ...Object.values(product.options ?? {}).flatMap((options) =>
          options.flatMap((option) => imageIds(option.images ?? [])),
        ),
      ]),
    ]),
  ...articles.map((article) => [articleUrl(article), imageFiles([article.cover])]),
])

const entries = urls.map((url) => {
  const lastmod = lastmodByUrl.get(url)
  return [
    '  <url>',
    `    <loc>${siteUrl}${url}</loc>`,
    ...(lastmod ? [`    <lastmod>${lastmod}</lastmod>`] : []),
    ...(imagesByUrl.get(url) ?? []).map(
      (src) => `    <image:image><image:loc>${src}</image:loc></image:image>`,
    ),
    '  </url>',
  ].join('\n')
})

// Пустая карта сайта хуже отсутствующей: <urlset> без единого <url> не проходит
// проверку схемы sitemaps.org, а Search Console считает такой файл ошибкой. Пока
// индексируемых страниц нет, не пишем ни карту, ни ссылку на неё в robots.txt
const preview = Boolean(process.env.PREVIEW)

// На превью карты сайта нет вовсе: звать робота в закрытое место незачем, а лежала бы
// она там с боевыми адресами — то есть про другой сайт
if (entries.length > 0 && !preview) {
  writeFileSync(
    resolve(distRoot, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries.join('\n')}
</urlset>
`,
  )
}

const sitemapLine = entries.length > 0 && !preview ? `\nSitemap: ${siteUrl}/sitemap.xml\n` : ''

// Превью для приёмки (dev-домен) закрывается от поиска целиком: это копия магазина
// на чужом адресе, и в выдаче она конкурировала бы с настоящим сайтом за собственный
// бренд. Закрывает его заголовок noindex на каждом ответе (.htaccess ниже), а обход
// robots.txt как раз разрешает: запрети он обход — робот не увидел бы noindex и мог бы
// взять в индекс голый адрес по внешней ссылке (а ссылки на dev есть — в публичном
// репозитории). Canonical страниц превью и так ведёт на боевой адрес
const robots = preview
  ? `User-agent: *
Allow: /
`
  : `User-agent: *
${DISALLOW.map((path) => `Disallow: ${path}`).join('\n')}
${sitemapLine}`

writeFileSync(resolve(distRoot, 'robots.txt'), robots)

// Переезды адресов (seo.md п. 9): адреса прошлого магазина → наши. Каждая цель
// проверяется по сборке: переименуют страницу — сборка остановится, а не станет слать
// людей на 404. Адреса уходят в правило сервера как есть, поэтому в них только
// буквы, цифры и дефисы (у цели — ещё параметр ?a=b) — никаких спецсимволов шаблона
const redirects = JSON.parse(readFileSync(resolve(projectRoot, 'data', 'redirects.json'), 'utf8'))
for (const part of ['pages', 'sections', 'queries', 'productWords']) {
  if (!Array.isArray(redirects[part]))
    throw new Error(`data/redirects.json: нет раздела «${part}» (список)`)
}
const pageExists = (path) => existsSync(resolve(distRoot, `.${path}`, 'index.html'))
const PATH = /^\/[a-z0-9\-/]+\/$/
// Цель тоже уходит в правило как есть: пробел или % в ней сломал бы весь .htaccess,
// то есть ошибка 500 на всём сайте, а не на одном адресе. Слеш в конце обязателен:
// без него сервер добавил бы второй прыжок переадресации
const TARGET = /^\/([a-z0-9-]+\/)*(\?[a-z0-9_=&-]+)?$/
function checkTarget(from, to) {
  if (!TARGET.test(to))
    throw new Error(`data/redirects.json: цель «${to}» — /papka/?param=znachenie`)
  if (!pageExists(new URL(to, siteUrl).pathname))
    throw new Error(`data/redirects.json: ${from} ведёт на ${to}, а такой страницы нет`)
}
// Живой файл правило не трогает: сервер открывает /productos/ и /checkout/ внутренним
// запросом к их index.html, и без этого условия живая страница ушла бы в переадресацию
const NOT_A_FILE = '  RewriteCond %{REQUEST_FILENAME} !-f\n'
// Параметры старого адреса (?return=, ?token=) в новом — мусор; нужен только поиску
const dropQuery = (to) => (to.includes('?') ? to : `${to}?`)
function checkRedirect(from, to, { live = false } = {}) {
  if (!PATH.test(from))
    throw new Error(`data/redirects.json: «${from}» — нужен адрес вида /papka/stranica/`)
  // Живую страницу переадресация спрятала бы, а на саму себя — зациклила
  if (!live && pageExists(from))
    throw new Error(`data/redirects.json: ${from} — живая страница сайта`)
  checkTarget(from, to)
}
const pattern = (path) => path.slice(1, -1)
const rule = (match, to) => `  RewriteRule ^${match}$ ${siteUrl}${to} [L,R=301]`

// Страница прошлого магазина — вместе с её листами каталога (/linea-alta/page/2/)
const pageRules = redirects.pages.map(({ from, to }) => {
  checkRedirect(from, to)
  return rule(`${pattern(from)}(/page/[0-9]+)?/?`, dropQuery(to))
})

// Служебный раздел Tiendanube (поиск, корзина, аккаунт) — со всем, что под ним. Поиск
// (keepQuery) ведёт с тем же ?q=: параметр у нас называется так же. Если адрес
// раздела у нас живой (/checkout/), переадресуется только то, что глубже
const sectionRules = redirects.sections.map(({ from, to, keepQuery }) => {
  checkRedirect(from, to, { live: true })
  const live = pageExists(from)
  return (
    (live ? NOT_A_FILE : '') +
    rule(`${pattern(from)}${live ? '/.+' : '(/.*)?'}`, keepQuery ? to : dropQuery(to))
  )
})

// Ссылка с параметром на живую страницу («отменить заказ» вело на форму контакта)
const queryRules = redirects.queries.map(({ from, query, to }) => {
  checkRedirect(from, to, { live: true })
  if (!/^[a-z0-9_=&-]+$/.test(query)) throw new Error(`data/redirects.json: запрос «${query}»`)
  return [
    `  RewriteCond %{QUERY_STRING} (^|&)${query}(&|$)`,
    rule(`${pattern(from)}/?`, dropQuery(to)),
  ].join('\n')
})

// Товары, чьих точных адресов не осталось (удалённые из Tiendanube до переезда, но
// ещё известные поисковику): по слову в адресе — на наш такой же товар. Порядок
// важен: «mesa-para-la-silla-evolutiva» должна найти столик раньше, чем стул
const wordRules = redirects.productWords.map(({ words, to }) => {
  // Пустой список дал бы шаблон «любой адрес» и увёл бы весь каталог
  if (!words?.length || !words.every((word) => /^[a-z0-9-]{3,}$/.test(word)))
    throw new Error(`data/redirects.json: слова «${words}» — от 3 букв, цифры, дефис`)
  checkTarget(`/productos/…${words[0]}…/`, to)
  return NOT_A_FILE + rule(`productos/[^/]*(${words.join('|')})[^/]*/?`, dropQuery(to))
})

const redirectRules = [...pageRules, ...sectionRules, ...queryRules, ...wordRules].join('\n')

// Правила Apache кладём в саму сборку: заливка сносит на сервере всё лишнее, и если
// дописывать их отдельным шагом после неё, сайт живёт без своей 404 и без кеша до конца
// заливки — а при сбое того шага остаётся без них насовсем
writeFileSync(
  resolve(distRoot, '.htaccess'),
  `ErrorDocument 404 /404.html

# Список заказов жил по адресу /pedidos/ до 30.09.2026 — закладка владельца ведёт в админку
RedirectMatch 301 ^/pedidos/?$ /admin/

# Тип задаём сами: по умолчанию сервер отдаёт скрипты как application/x-javascript,
# и правило кеша ниже до них не доходит
AddType application/javascript .js
AddType application/manifest+json .webmanifest
AddType font/woff2 .woff2

# Файлы сборки несут отпечаток содержимого в имени: меняется файл — меняется имя,
# поэтому их можно держать в кеше год. Страницы — нет: они меняются при той же ссылке
<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType text/html "access plus 0 seconds"
  ExpiresByType text/css "access plus 1 year"
  ExpiresByType application/javascript "access plus 1 year"
  # Хостинг отдаёт скрипты старым типом и AddType выше не перебивает его —
  # называем оба, иначе правило до скриптов не доходит
  ExpiresByType application/x-javascript "access plus 1 year"
  ExpiresByType image/webp "access plus 1 year"
  ExpiresByType image/jpeg "access plus 1 year"
  ExpiresByType image/svg+xml "access plus 1 year"
  ExpiresByType font/woff2 "access plus 1 year"
</IfModule>
${
  preview
    ? `
# Превью закрыто заголовком на каждом ответе — страницы, картинки, видео, файлы.
# always — чтобы заголовок был и на ответах с ошибкой (404 тоже не для индекса).
# noimageindex — картинки со страниц превью тоже не берутся: сеть доставки хостинга
# срезает этот заголовок у самих JPG и PNG (проверено 30.09.2026), а у страниц нет
<IfModule mod_headers.c>
  Header always set X-Robots-Tag "noindex, nofollow, noimageindex"
</IfModule>
`
    : `
# Один адрес магазина (seo.md п. 3): голый домен и http ведут на адрес из seo.siteUrl
# той же страницей, иначе поисковик видит две копии сайта, а покупатель — предупреждение
# браузера. Правило стоит первым: остальные должны видеть уже итоговый адрес
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteCond %{HTTPS} off [OR]
  RewriteCond %{HTTP_HOST} !^${canonicalHostPattern}$ [NC]
  RewriteRule ^ ${siteUrl}%{REQUEST_URI} [L,R=301]

  # Каждая страница лежит файлом index.html, и сервер отдал бы её ещё и по адресу
  # /sillas/index.html — вторая копия той же страницы. Смотрим на исходный запрос
  # (THE_REQUEST), а не на адрес после подстановки: сервер сам дописывает index.html
  # к папке, и правило по REQUEST_URI зациклилось бы
  RewriteCond %{THE_REQUEST} \\s/+((?:[^?\\s]*/)?)index\\.html[?\\s] [NC]
  RewriteRule ^ ${siteUrl}/%1 [L,R=301]

  # Адреса прошлого магазина на Tiendanube (до 30.09.2026) — поисковик и старые ссылки
  # знают их, а не наши (data/redirects.json)
${redirectRules}
  # Остальные товары Tiendanube жили на /productos/{slug}/. Своих страниц глубже
  # /productos/ у нас нет, но сам /productos/ сервер открывает внутренним запросом
  # к productos/index.html — живые файлы и папки правило пропускает, иначе петля
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule ^productos/[^/]+/?$ ${siteUrl}/productos/? [L,R=301]
</IfModule>

# Админка владельца (бэкенд.md §13, §15): robots.txt запрещает обход, поэтому meta
# noindex на странице робот не прочтёт — попадание в индекс по внешней ссылке
# запрещает заголовок, как у превью
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteRule ^admin/ - [E=NOINDEX:1]
</IfModule>
<IfModule mod_headers.c>
  Header set X-Robots-Tag "noindex, nofollow" env=NOINDEX
</IfModule>
`
}`,
)

if (siteUrl.includes('PLACEHOLDER')) {
  console.warn('Предупреждение: в sitemap.xml и robots.txt стоит домен-заглушка')
}
console.log(
  preview
    ? `Превью: сайт закрыт от поиска, карта не создаётся (иначе страниц было бы ${urls.length}).`
    : urls.length > 0
      ? `В sitemap.xml страниц: ${urls.length}.`
      : 'Индексируемых страниц пока нет — sitemap.xml не создаётся.',
)
