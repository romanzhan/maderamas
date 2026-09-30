// Страницы-сущности пишет скрипт, а не человек (журнал, решение 24.08.2026): у каждого
// товара и каждой статьи свой файл, и писать десяток одинаковых руками — столько же
// шансов разойтись. Файл тонкий: всё содержимое в общем блоке, а какая это сущность,
// определяет адрес страницы.
// Папки сгенерированных страниц в git не попадают (.gitignore).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadData } from './data.js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pagesRoot = resolve(projectRoot, 'src/pages')

const PRODUCT_TEMPLATE = `{{!-- Страница товара. Файл создан скриптом (scripts/generate-pages.js) —
      руками не правится: правится общий блок product/page.
      Заголовок и «голова» страницы считаются по её адресу (scripts/seo-meta.js). --}}
{{#> layout}}
  {{> product/page}}
{{/layout}}
`

const ARTICLE_TEMPLATE = `{{!-- Статья блога. Файл создан скриптом (scripts/generate-pages.js) —
      руками не правится: правится общий блок blog/article.
      Заголовок и «голова» страницы считаются по её адресу (scripts/seo-meta.js). --}}
{{#> layout}}
  {{> blog/article}}
{{/layout}}
`

// Разделы каталога и инфостраницы, заведённые в админке (бэкенд.md §15), тоже получают
// файл сами. Существующие файлы первого уровня писал человек — их скрипт не трогает;
// свои он узнаёт по метке и убирает, когда запись удалили
const GENERATED_MARK = 'Файл создан скриптом (scripts/generate-pages.js) для записи'
const topTemplate = (block, what) => `{{!-- ${what}. ${GENERATED_MARK} из данных —
      руками не правится: правится общий блок ${block}. --}}
{{#> layout}}
  {{> ${block}}}
{{/layout}}
`

const { site, products, categories, articles, pages } = loadData()
const slugById = new Map(categories.map((category) => [category.id, category.slug]))

// Ключ — путь папки внутри src/pages, значение — содержимое index.html
const wanted = new Map()
for (const product of products) {
  const categorySlug = slugById.get(product.categoryId)
  if (!categorySlug) continue
  wanted.set(`${categorySlug}/${product.slug}`, PRODUCT_TEMPLATE)
}

// Флаг blog выключен — раздела не существует, и страниц статей тоже
// (состояния-экранов.md п. 9): пустая карта ниже сотрёт уже созданные
if (site.features.blog) {
  for (const article of articles) wanted.set(`blog/${article.slug}`, ARTICLE_TEMPLATE)
}

// Сущность убрали из данных — её страница должна исчезнуть, а не остаться сиротой
for (const parent of [...new Set(slugById.values()), 'blog']) {
  const parentDir = resolve(pagesRoot, parent)
  let existing = []
  try {
    existing = readdirSync(parentDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    // Раздела без единой сгенерированной страницы ещё нет на диске — создастся ниже
  }

  for (const name of existing) {
    if (!wanted.has(`${parent}/${name}`)) {
      rmSync(resolve(parentDir, name), { recursive: true, force: true })
    }
  }
}

for (const [path, contents] of wanted) {
  const dir = resolve(pagesRoot, path)
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, 'index.html'), contents)
}

// Первый уровень: раздел каталога или инфостраница без своего файла
const topWanted = new Map([
  ...categories.map((category) => [category.slug, topTemplate('catalog/page', 'Раздел каталога')]),
  ...pages.map((page) => [page.slug, topTemplate('content/page', 'Инфостраница')]),
])
const isGenerated = (slug) => {
  const file = resolve(pagesRoot, slug, 'index.html')
  return existsSync(file) && readFileSync(file, 'utf8').includes(GENERATED_MARK)
}
for (const entry of readdirSync(pagesRoot, { withFileTypes: true })) {
  if (entry.isDirectory() && isGenerated(entry.name) && !topWanted.has(entry.name)) {
    rmSync(resolve(pagesRoot, entry.name), { recursive: true, force: true })
  }
}
let topCreated = 0
for (const [slug, contents] of topWanted) {
  const file = resolve(pagesRoot, slug, 'index.html')
  if (existsSync(file) && !isGenerated(slug)) continue
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, contents)
  topCreated++
}

console.log(`Сгенерированных страниц: ${wanted.size + topCreated}.`)
