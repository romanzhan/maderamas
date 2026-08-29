// Единая точка доступа к данным на сборке (принцип 28).
// Вёрстка и служебные скрипты не читают эти файлы напрямую — только отсюда.
// Исключение — необязательный en.json: его читает валидатор, когда включён второй язык.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { money } from '../src/scripts/format.js'

const dataDir = resolve(dirname(fileURLToPath(import.meta.url)), '../data')

// Данные правит владелец, а не программист: любая его опечатка должна называть файл
// и говорить, что с ним не так, — стек Node ему ничего не объясняет (данные.md §1.3)
function read(file, shape) {
  let value

  try {
    value = JSON.parse(readFileSync(resolve(dataDir, file), 'utf8'))
  } catch (error) {
    const hint =
      error.code === 'ENOENT'
        ? 'файла нет'
        : `нарушена разметка JSON (чаще всего лишняя или пропущенная запятая) — ${error.message}`
    throw new Error(`Файл data/${file}: ${hint}`)
  }

  const ok =
    shape === 'list'
      ? Array.isArray(value)
      : value !== null && !Array.isArray(value) && typeof value === 'object'
  if (!ok) {
    const expected =
      shape === 'list' ? 'списком в квадратных скобках' : 'объектом в фигурных скобках'
    throw new Error(`Файл data/${file} должен быть ${expected}`)
  }

  return value
}

// Без кеша: десяток маленьких файлов читается мгновенно, зато правка данных
// видна на dev-сервере сразу, без перезапуска
export function loadData() {
  return {
    site: read('site.config.json', 'object'),
    dictionary: read('dictionaries/es.json', 'object'),
    products: read('products.json', 'list'),
    categories: read('categories.json', 'list'),
    articles: read('articles.json', 'list'),
    reviews: read('reviews.json', 'list'),
    faq: read('faq.json', 'list'),
    pages: read('pages.json', 'list'),
    provinces: read('provinces.json', 'list'),
    images: read('images.json', 'object'),
  }
}

/** Текст по ключу словаря: t('qty.max', { n: 10 }); в шаблонах — {{t "qty.max" n=10}} */
export function t(key, options) {
  const { dictionary } = loadData()
  const value = key.split('.').reduce((node, part) => node?.[part], dictionary)

  if (typeof value !== 'string') {
    throw new Error(`Нет ключа словаря "${key}" в data/dictionaries/es.json`)
  }

  const vars = options?.hash ?? options ?? {}
  return value.replace(/\{(\w+)\}/g, (match, name) => {
    // Забытая подстановка уехала бы покупателю как «{n} productos» — ловим на сборке
    if (!(name in vars)) throw new Error(`Ключу словаря "${key}" не передали ${match}`)
    return String(vars[name])
  })
}

/**
 * Картинка из манифеста конвейера (картинки.md §3) — единственное место, где вёрстка
 * узнаёт про файлы и размеры. Нет записи — вернёт null, и блок покажет заглушку бренда,
 * а не сломается.
 */
export function image(id) {
  if (!id) return null

  const { images } = loadData()
  const entry = images[id]
  if (!entry) return null

  const sizes = [...entry.sizes].sort((a, b) => a - b)
  const largest = sizes[sizes.length - 1]

  return {
    src: `/images/${entry.files[largest]}`,
    srcset: sizes.map((size) => `/images/${entry.files[size]} ${size}w`).join(', '),
    width: entry.width,
    height: entry.height,
  }
}

/**
 * Шаблоны проверки полей (формы-и-поля.md §4). Аргентинские форматы были выписаны
 * по одиннадцати формам: правка формата нашла бы не все, и половина форм осталась бы
 * со старым правилом. Имя помощника не `pattern`, чтобы не спорить с одноимённым
 * параметром компонента поля.
 */
const PATTERNS = {
  // Дефис экранирован намеренно: атрибут pattern браузер собирает с флагом `v`, где
  // дефис служебный. Незакрытый дефис не даёт ошибки — выражение просто не собирается,
  // и поле молча перестаёт проверяться (поймано ревью 29.08.2026)
  nombre: String.raw`[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'\- ]+`,
  telefono: '[0-9]{10}',
  dni: '[0-9.]{9,10}',
  cp: '[0-9]{4}|[A-Z][0-9]{4}[A-Z]{3}',
}

// Собираем шаблон ровно так, как это сделает браузер: не собрался — падаем на сборке,
// а не пропускаем молча что попало в заказ
for (const [kind, value] of Object.entries(PATTERNS)) {
  try {
    new RegExp('^(?:' + value + ')$', 'v')
  } catch (error) {
    throw new Error(`Шаблон проверки "${kind}" браузер не соберёт: ${error.message}`)
  }
}

export function formPattern(kind) {
  const value = PATTERNS[kind]
  if (!value) throw new Error(`Нет шаблона проверки "${kind}" — см. PATTERNS в scripts/data.js`)
  return value
}

/**
 * JSON внутрь <script type="application/json">. Закрывающая последовательность внутри
 * строки оборвала бы тег раньше времени, поэтому косая черта экранируется: в данные
 * попадают названия товаров от владельца, и одно неудачное название уронило бы страницу.
 * Одно место на весь проект — и для разметки поисковика, и для данных браузеру.
 */
export function inlineJson(value) {
  return JSON.stringify(value).replaceAll('</', '<\\/')
}

/**
 * Список id картинок товара. Элемент данных — строка-id либо объект {id, alt}
 * (данные.md §2), и разбирать эти две формы по месту нельзя: где-нибудь забудут.
 */
export function imageIds(images) {
  return (images ?? []).map((item) => (typeof item === 'string' ? item : item.id))
}

/** Склейка строк для шаблона: t (concat "home.picker" key "Title") */
export function concat(...parts) {
  return parts.slice(0, -1).join('')
}

/** Адрес товара знает только это место: /{categoria}/{producto}/ (seo.md п. 3) */
export function productUrl(product) {
  const { categories } = loadData()
  const category = categories.find((item) => item.id === product.categoryId)
  return category ? `/${category.slug}/${product.slug}/` : '/'
}

/** Адрес статьи знает только это место — остальные его спрашивают, а не собирают сами */
export function articleUrl(article) {
  return `/blog/${article.slug}/`
}

/**
 * Цена без национальных налогов (Res. 4/2025) — обязательный спутник цены.
 * Это отдельное число: из итоговой цены вынимается IVA по ставке из настроек.
 */
export function moneyNet(gross) {
  const { site } = loadData()
  return money(Math.round(gross / (1 + site.legal.ivaRate / 100)))
}

/** Сравнение для шаблона: {{#if (eq a b)}} — своей логики в шаблонах не бывает */
export function eq(a, b) {
  return a === b
}

/** Дата в аргентинском формате: 2026-08-25 → «25/08/2026» (тексты.md §3) */
export function date(iso) {
  const [year, month, day] = String(iso ?? '').split('-')
  return year && month && day ? `${day}/${month}/${year}` : ''
}

// Дата словами нужна только статьям (тексты.md §3), поэтому формат заведён один раз здесь
const longDate = new Intl.DateTimeFormat('es-AR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

/** Дата словами: 2026-08-25 → «25 de agosto de 2026» — так даты пишутся в статьях */
export function dateLong(iso) {
  const parts = String(iso ?? '').split('-')
  if (parts.length !== 3) return ''
  return longDate.format(new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])))
}

/** «Или» для шаблона: {{#if (or a b)}} — там же и по той же причине */
export function or(a, b) {
  return Boolean(a || b)
}

// Пустая строка разделяет абзацы — так же, как в описаниях товаров
const PARAGRAPH_BREAK = /\n{2,}/

const HTML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
// Только внутренние адреса: ссылка наружу из текста статьи — решение, а не вёрстка,
// и заводить её молча нельзя (принцип 6)
const INLINE_LINK = /\[([^\]]+)\]\((\/[^\s)]*)\)/g
const INLINE_STRONG = /\*\*([^*]+)\*\*/g

/**
 * Простая разметка внутри абзаца (данные.md §6): `**важное**` и ссылка `[текст](/ruta/)`.
 * Больше ничего — вся структура текста живёт в разделах записи, а не в строке, и полный
 * markdown потребовал бы разбора чужой библиотекой ради двух приёмов.
 * Текст экранируется до разметки: данные пишем мы, но подставлять в HTML сырую строку —
 * привычка, которая однажды выстрелит.
 */
export function inline(text) {
  return String(text)
    .replace(/[&<>"]/g, (char) => HTML_ESCAPE[char])
    .replace(INLINE_LINK, '<a href="$2">$1</a>')
    .replace(INLINE_STRONG, '<strong>$1</strong>')
}

/**
 * Абзацы из текста с переводами строк: разбирать текст в шаблоне нечем.
 * Возвращает готовый HTML абзаца (см. inline), поэтому в разметке он выводится
 * тройными скобками.
 */
export function paragraphs(text) {
  if (typeof text !== 'string') return []
  return text.split(PARAGRAPH_BREAK).filter(Boolean).map(inline)
}
