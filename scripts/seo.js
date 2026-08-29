// Служебные файлы поиска (seo.md п. 9): sitemap.xml и robots.txt — после сборки.
// Список URL берётся из собранных страниц, поэтому в карту не попадает то, чего нет.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { articleUrl, loadData } from './data.js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distRoot = resolve(projectRoot, 'dist')

// Витрина закрыта в robots.txt: своей meta у неё нет, а в карту ей нельзя
const HIDDEN = ['/_componentes/']
const DISALLOW = '/_componentes/'

// Второго списка «что не индексируем» не держим: страница сама несёт meta noindex,
// и карта читает её же (27.08.2026 — иначе списки расходятся, и в карту попадает
// закрытая страница)
const NOINDEX = 'name="robots" content="noindex"'

const { site, articles } = loadData()
const siteUrl = site.seo.siteUrl.replace(/\/$/, '')

const toUrl = (file) => `/${file.replaceAll(sep, '/').replace(/index\.html$/, '')}`

const urls = readdirSync(distRoot, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('index.html'))
  .filter((file) => !readFileSync(resolve(distRoot, file), 'utf8').includes(NOINDEX))
  .map(toUrl)
  .filter((url) => !HIDDEN.includes(url))
  .sort()

const lastmodByUrl = new Map(articles.map((article) => [articleUrl(article), article.date]))

const entries = urls.map((url) => {
  const lastmod = lastmodByUrl.get(url)
  return [
    '  <url>',
    `    <loc>${siteUrl}${url}</loc>`,
    ...(lastmod ? [`    <lastmod>${lastmod}</lastmod>`] : []),
    '  </url>',
  ].join('\n')
})

// Пустая карта сайта хуже отсутствующей: <urlset> без единого <url> не проходит
// проверку схемы sitemaps.org, а Search Console считает такой файл ошибкой. Пока
// индексируемых страниц нет, не пишем ни карту, ни ссылку на неё в robots.txt
if (entries.length > 0) {
  writeFileSync(
    resolve(distRoot, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`,
  )
}

const sitemapLine = entries.length > 0 ? `\nSitemap: ${siteUrl}/sitemap.xml\n` : ''

// Превью для приёмки (dev-домен) закрывается от поиска целиком: это копия магазина
// на чужом адресе, и в выдаче она конкурировала бы с настоящим сайтом за собственный
// бренд. Карту сайта туда тоже не пишем — звать робота в закрытое место незачем
const robots = process.env.PREVIEW
  ? `User-agent: *
Disallow: /
`
  : `User-agent: *
Disallow: ${DISALLOW}
${sitemapLine}`

writeFileSync(resolve(distRoot, 'robots.txt'), robots)

if (siteUrl.includes('PLACEHOLDER')) {
  console.warn('Предупреждение: в sitemap.xml и robots.txt стоит домен-заглушка')
}
console.log(
  urls.length > 0
    ? `В sitemap.xml страниц: ${urls.length}.`
    : 'Индексируемых страниц пока нет — sitemap.xml не создаётся.',
)
