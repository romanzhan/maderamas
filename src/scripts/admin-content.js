// Редактор контента в админке (бэкенд.md §15, страницы.md §17). Store, а не компонент:
// раздел выбирается меню страницы админки (src/scripts/admin.js), а форма, окно
// выбора фото и полоса публикации делят одно состояние.
//
// Формы не написаны для каждого раздела отдельно: их описывает data/admin-schema.json
// (поля, подписи, подсказки), а разметка раскладывает поля по типу
// (src/blocks/admin/content.hbs). Новое поле в данных = строка в схеме, а не новая форма.
//
// Раздел грузится целиком и целиком сохраняется: у сервера один файл на раздел и одна
// версия файла — сохранение поверх чужой правки он отклоняет (409), а не смешивает.
// Проверку по существу делает сборка на сервере; её ответ показывает полоса публикации.

import Alpine from 'alpinejs'
// Календарь для полей с датой (<calendar-date>): механика библиотеки, вид — main.css.
// Грузится вместе с редактором, то есть только в админке
import 'cally'
import { dateTime, money } from './format.js'

const API = '/api/admin'
// Пока публикация идёт или ждёт своей минуты — спрашиваем сервер чаще
const POLL_MS = 5000

const today = () => new Date().toISOString().slice(0, 10)

/** Адрес из названия: «Silla Alta Evolutiva» → silla-alta-evolutiva */
export function slugify(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Значение по пути с точками: get(product, 'attributes.dimensions.width') */
export function getPath(object, path) {
  return path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), object)
}

/** Запись по пути; промежуточные объекты создаются, даже если там был null */
export function setPath(object, path, value) {
  const keys = path.split('.')
  let node = object
  for (const key of keys.slice(0, -1)) {
    if (node[key] == null || typeof node[key] !== 'object') node[key] = {}
    node = node[key]
  }
  node[keys.at(-1)] = value
}

const clone = (value) => JSON.parse(JSON.stringify(value))

/** Свободный id в списке: silla, silla-2, silla-3… */
function uniqueId(base, taken) {
  const root = base || 'nuevo'
  let id = root
  for (let n = 2; taken.has(id); n++) id = `${root}-${n}`
  return id
}

export const adminContent = {
  schema: { collections: {}, sitePages: [] },
  texts: {},
  // Сводка сервера: версии разделов, картинки, публикация
  images: {},
  build: { state: 'unknown', message: '', finishedAt: null, pending: false },
  indexState: 'idle',

  // Загруженные разделы: имя → { data, version, saved } (saved — снимок для «изменено?»)
  docs: {},
  col: null,
  // idle | loading | ready | failed
  colState: 'idle',
  itemIndex: null,
  query: '',
  saving: false,
  saveError: '',
  saved: false,
  confirmDelete: null,
  // Id новых, ещё не сохранённых записей: их адрес идёт за названием, пока его не
  // поправили руками. У сохранённой записи адрес не трогаем — на него уже ведут ссылки
  autoSlug: new Set(),

  history: null,
  historyState: 'idle',

  // Окно выбора фото: для какого поля, какой поток, одно фото или несколько в список
  picker: { flow: null, multiple: false, apply: null, query: '', selected: [], base: '' },
  // Загрузка идёт пачкой: сколько файлов из скольких уже на сервере
  upload: { busy: false, done: 0, total: 0, error: '' },
  // Только что загруженное фото сервер нарежет при публикации, а до тех пор превью —
  // сам выбранный файл из памяти браузера
  localPreviews: {},

  textsQuery: '',
  // Открытая страница в «Страницах»; null — список страниц
  sitePage: null,
  // Запись или страница открыты с записью в истории браузера: «назад» закроет их
  viewPushed: false,

  pollTimer: null,

  // Не init: Alpine сам зовёт init() у store при регистрации, без корня страницы
  setup(root) {
    this.texts = { ...root.dataset }
    const schema = document.getElementById('admin-schema')
    if (schema) this.schema = JSON.parse(schema.textContent)
    this.textIndex = this.buildTextIndex()
    const page = new URLSearchParams(location.search).get('p')
    if (this.schema.sitePages?.some((entry) => entry.id === page)) {
      this.sitePage = page
      this.viewPushed = Boolean(history.state?.adminView)
    }
    // Уход со страницы с несохранённым — браузер переспросит (формы-и-поля.md, черновики)
    window.addEventListener('beforeunload', (event) => {
      if (Object.keys(this.docs).some((name) => this.isDirty(name))) event.preventDefault()
    })
  },

  isContent(section) {
    return section in this.schema.collections || section === 'texts' || section === 'sitePages'
  },

  async request(path, options = {}) {
    const response = await fetch(API + path, {
      ...options,
      headers: { Accept: 'application/json', ...(options.headers ?? {}) },
    })
    if (response.status === 401) {
      Alpine.store('admin').auth = 'out'
      throw new Error('unauthorized')
    }
    return response
  },

  async loadIndex() {
    this.indexState = 'loading'
    try {
      const response = await this.request('/content')
      if (!response.ok) throw new Error(String(response.status))
      const body = await response.json()
      this.images = body.images
      this.setBuild(body.build)
      this.indexState = 'ready'
    } catch {
      this.indexState = 'failed'
    }
  },

  async open(name) {
    // Страница из адреса (?p=) открывается только при первом входе; заход в «Страницы»
    // из меню начинается со списка
    if (this.col !== null) this.sitePage = null
    this.col = name
    this.itemIndex = null
    this.viewPushed = false
    this.query = ''
    this.saveError = ''
    this.saved = false
    this.confirmDelete = null
    this.history = null
    if (this.indexState === 'idle') this.loadIndex()
    // Страницы сайта — не свой файл, а чужие: фото в настройках, фразы в словаре,
    // текстовые страницы — своим разделом, который открывается отсюда же
    if (name === 'sitePages' || name === 'texts') {
      const parts = name === 'texts' ? ['texts'] : ['site', 'texts', 'pages']
      this.colState = 'loading'
      await Promise.all(parts.filter((n) => !this.docs[n]).map((n) => this.load(n)))
      if (this.col === name) this.colState = parts.every((n) => this.docs[n]) ? 'ready' : 'failed'
      return
    }
    this.colState = this.docs[name] ? 'ready' : 'loading'
    // Товарам, статьям и отзывам нужны списки товаров и разделов для выбора
    const needs = new Set([name, 'products', 'categories', 'texts'])
    await Promise.all([...needs].filter((n) => !this.docs[n]).map((n) => this.load(n)))
  },

  async load(name) {
    if (name === this.col) this.colState = 'loading'
    try {
      const response = await this.request(`/content/${name}`)
      if (!response.ok) throw new Error(String(response.status))
      const { data, version } = await response.json()
      this.docs[name] = { data, version, saved: JSON.stringify(data) }
      if (name === this.col) this.colState = 'ready'
    } catch {
      if (name === this.col) this.colState = 'failed'
    }
  },

  get conf() {
    return this.schema.collections[this.col] ?? null
  },

  get doc() {
    return this.docs[this.col] ?? null
  },

  isDirty(name = this.col) {
    if (name === 'sitePages') return ['site', 'texts', 'pages'].some((part) => this.isDirty(part))
    const doc = this.docs[name]
    return Boolean(doc) && JSON.stringify(doc.data) !== doc.saved
  },

  // ——— Список записей ———

  get rows() {
    if (!this.doc || !Array.isArray(this.doc.data)) return []
    const query = this.query.trim().toLowerCase()
    return this.doc.data
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !query || JSON.stringify(item).toLowerCase().includes(query))
  },

  title(item, conf = this.conf) {
    const value = getPath(item, conf?.titleField ?? 'id')
    return (typeof value === 'string' && value.trim()) || item.id || '—'
  },

  /** Превью записи в списке: первое фото или обложка */
  thumb(item) {
    const value = this.conf?.imageField ? getPath(item, this.conf.imageField) : null
    const id = Array.isArray(value) ? value[0] : value
    return this.preview(typeof id === 'object' && id ? id.id : id)
  },

  preview(id) {
    return (id && (this.images[id]?.preview || this.localPreviews[id])) || null
  },

  /** Подробности под названием в списке: у товара цена и наличие, у статьи дата… */
  rowMeta(item) {
    const parts = []
    if (this.col === 'products') {
      const category = this.docs.categories?.data.find((entry) => entry.id === item.categoryId)
      parts.push(this.money(item.price))
      if (category) parts.push(category.name)
      const colors = item.options?.woodColor?.length ?? 0
      if (colors > 1) parts.push(this.texts.tColors.replace('{n}', colors))
    } else if (this.col === 'articles' || this.col === 'reviews') {
      if (this.col === 'reviews') {
        const product = this.docs.products?.data.find((entry) => entry.id === item.productId)
        parts.push('★'.repeat(item.rating ?? 0))
        if (product) parts.push(product.name)
      }
      if (item.date) parts.push(this.day(item.date))
    } else if (this.col === 'faq') {
      parts.push(this.docs.texts?.data.faqTopics?.[item.topic] ?? item.topic)
    } else {
      const url = this.url(item)
      if (url) parts.push(url)
    }
    return parts.join(' · ')
  },

  /** Плашки в строке списка: то, что стоит заметить, не открывая запись */
  rowFlags(item) {
    const flags = []
    if (this.col === 'products') {
      if (!item.inStock) flags.push({ kind: 'error', text: this.texts.tOutOfStock })
      if (item.featured) flags.push({ kind: 'neutral', text: this.texts.tOnHome })
    }
    if (this.autoSlug.has(item.id)) flags.push({ kind: 'warning', text: this.texts.tNotSaved })
    return flags
  },

  day(iso) {
    const [year, month, date] = String(iso).split('-')
    return date ? `${date}.${month}.${year}` : iso
  },

  /** Адрес записи на сайте — чтобы посмотреть результат после публикации */
  url(item) {
    const prefix = this.conf?.urlPrefix
    // Новой записи на сайте ещё нет — ссылка вела бы на 404
    if (prefix === undefined || !item.slug || this.autoSlug.has(item.id)) return null
    if (prefix === 'category') {
      const category = this.docs.categories?.data.find((entry) => entry.id === item.categoryId)
      return category ? `/${category.slug}/${item.slug}/` : null
    }
    return prefix ? `/${prefix}/${item.slug}/` : `/${item.slug}/`
  },

  openItem(index) {
    this.itemIndex = index
    this.confirmDelete = null
    this.saved = false
    this.pushView()
    window.scrollTo({ top: 0 })
  },

  // ——— Открытая запись или страница и «назад» ———

  pushView() {
    if (this.viewPushed) return
    history.pushState({ adminView: true }, '', location.href)
    this.viewPushed = true
  },

  /** Кнопка «назад» на экране: через историю, если запись её оставила, — тогда и «назад»
   *  браузера, и кнопка ведут себя одинаково */
  back() {
    if (this.viewPushed) history.back()
    else this.closeView()
  },

  /** Вернуться к списку раздела; текстовая страница возвращает к списку всех страниц */
  closeView() {
    this.viewPushed = false
    this.confirmDelete = null
    if (this.col === 'pages') {
      this.itemIndex = null
      Alpine.store('admin').setSection('sitePages')
      return
    }
    this.itemIndex = null
    if (this.sitePage) {
      this.sitePage = null
      Alpine.store('admin').syncUrl()
    }
  },

  get item() {
    return this.itemIndex === null ? null : (this.doc?.data[this.itemIndex] ?? null)
  },

  addItem() {
    const conf = this.conf
    const list = this.doc.data
    const item = clone(conf.new ?? {})
    const taken = new Set(list.map((entry) => entry.id))
    const base = slugify(getPath(item, conf.titleField) ?? '')
    item.id = uniqueId(base, taken)
    if ('slug' in item || conf.fields.some((field) => field.key === 'slug')) item.slug = item.id
    if (this.col === 'products') {
      item.createdAt = today()
      item.categoryId = this.docs.categories?.data[0]?.id ?? ''
    }
    if (this.col === 'articles' || this.col === 'reviews') item.date = today()
    if (this.col === 'faq') item.topic = this.selectOptions({ source: 'faqTopics' })[0]?.value ?? ''
    if (this.col === 'reviews') item.productId = this.docs.products?.data[0]?.id ?? ''
    // Лента Instagram на сайте берёт первые 12 постов: новый, добавленный в конец,
    // на сайт бы не попал
    const at = this.col === 'instagram' ? 0 : list.length
    list.splice(at, 0, item)
    this.autoSlug.add(item.id)
    this.openItem(at)
  },

  duplicateItem(index) {
    const list = this.doc.data
    const copy = clone(list[index])
    copy.id = uniqueId(`${copy.id}-copia`, new Set(list.map((entry) => entry.id)))
    if ('slug' in copy) copy.slug = copy.id
    list.splice(index + 1, 0, copy)
    this.openItem(index + 1)
  },

  /** Удаление в два нажатия: первое спрашивает, второе удаляет */
  removeItem(index) {
    if (this.confirmDelete !== index) {
      this.confirmDelete = index
      return
    }
    this.doc.data.splice(index, 1)
    this.itemIndex = null
    this.back()
  },

  move(list, index, step) {
    const target = index + step
    if (target < 0 || target >= list.length) return
    const [entry] = list.splice(index, 1)
    list.splice(target, 0, entry)
    if (list === this.doc.data && this.itemIndex === index) this.itemIndex = target
  },

  // ——— Поля ———

  money(value) {
    return money(Number(value) || 0)
  },

  /** Заголовок календаря: «август 2026» (месяц — из листания календаря или из даты поля) */
  monthTitle(value) {
    const date = value instanceof Date ? value : value ? new Date(`${value}T00:00:00Z`) : new Date()
    const month = new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'UTC' }).format(date)
    return `${month} ${date.getUTCFullYear()}`
  },

  /** Кнопки «−» и «+» у числа: шаг единица, ниже нуля не опускаемся */
  step(model, field, delta) {
    const current = Number(this.value(model, field)) || 0
    // Дробное (вес 7,9) шагает от себя же, без хвостов вида 8.899999
    const next = Math.max(0, Math.round((current + delta) * 100) / 100)
    this.update(model, field, String(next))
  },

  when(iso) {
    return iso ? dateTime(iso) : ''
  },

  value(model, field) {
    const value = getPath(model, field.key)
    if (field.type === 'bool') return Boolean(value)
    return value ?? ''
  },

  /** false — значение не записано (в числе мусор): поле вернёт прежнее */
  update(model, field, raw) {
    let value = raw
    if (field.type === 'number' || field.type === 'money') {
      // Поля текстовые, браузер буквы не отсекает: деньги пишут «45.000» и «$ 45 000»,
      // вес — «7,9». Всё, что не число, не сохраняем — иначе в данные ушёл бы null
      const cleaned =
        field.type === 'money'
          ? String(raw).replace(/[^\d-]/g, '')
          : String(raw).replace(/\s/g, '').replace(/,/g, '.')
      if (cleaned === '') {
        value = field.nullable ? null : 0
      } else {
        value = Number(cleaned)
        if (Number.isNaN(value)) return false
        if (field.type === 'money') value = Math.round(value)
      }
    } else if (
      field.type === 'select' &&
      field.options?.every((option) => typeof option.value === 'number')
    ) {
      // Пункт «—» — пусто, а не ноль
      value = raw === '' ? (field.nullable ? null : '') : Number(raw)
    } else if (field.type === 'slug') {
      value = slugify(raw)
    } else if (typeof raw === 'string' && field.nullable && raw.trim() === '') {
      value = null
    }
    setPath(model, field.key, value)

    if (model !== this.item || !this.autoSlug.has(model.id)) return
    if (field.key === 'slug') {
      this.autoSlug.delete(model.id)
    } else if (field.key === this.conf.titleField) {
      const taken = new Set(
        this.doc.data.filter((entry) => entry !== model).map((entry) => entry.id),
      )
      const id = uniqueId(slugify(value), taken)
      this.autoSlug.delete(model.id)
      this.autoSlug.add(id)
      model.id = id
      if ('slug' in model) model.slug = id
    }
  },

  /** Условие показа поля из схемы: when: { kind: 'memotest' } */
  visible(model, field) {
    // unless — поле не нужно, когда в списке по этому пути есть записи со своими фото:
    // у товара с цветами фото живут в самих цветах
    const owners = field.unless ? getPath(model, field.unless) : null
    if (Array.isArray(owners) && owners.some((entry) => entry?.images?.length)) return false
    return Object.entries(field.when ?? {}).every(([key, value]) => getPath(model, key) === value)
  },

  /**
   * Поля записи карточками: заголовок группы в схеме открывает новую карточку.
   * Поля «для опытных» (адреса, коды) собираются в конец карточки под раскрывашку —
   * их почти никогда не меняют, а ошибка в них ломает ссылки
   */
  groups(fields, model) {
    const groups = []
    let group = null
    for (const field of fields) {
      if (field.type === 'heading') {
        group = {
          label: field.label,
          hint: field.hint ?? '',
          when: field.when,
          fields: [],
          advanced: [],
        }
        groups.push(group)
        continue
      }
      if (!group) {
        group = { label: this.texts.tMainGroup, hint: '', fields: [], advanced: [] }
        groups.push(group)
      }
      group[field.advanced ? 'advanced' : 'fields'].push(field)
    }
    return groups
      .map((entry, index) => ({ ...entry, id: `group-${index}` }))
      .filter((entry) => this.visible(model, entry))
  },

  simple(fields) {
    return fields.filter((field) => !field.advanced)
  },

  advanced(fields) {
    return fields.filter((field) => field.advanced)
  },

  jump(id) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  },

  /** Подпись строки вложенного списка: у цвета — доплата, фото, наличие */
  rowNote(row) {
    const parts = []
    if (row.priceDelta) parts.push(`+${this.money(row.priceDelta)}`)
    if (Array.isArray(row.images)) {
      parts.push(
        row.images.length
          ? this.texts.tPhotos.replace('{n}', row.images.length)
          : this.texts.tNoPhotos,
      )
    }
    if (row.inStock === false) parts.push(this.texts.tOutOfStock)
    return parts.join(' · ')
  },

  rowThumb(row) {
    const images = Array.isArray(row.images) ? row.images : row.image ? [row.image] : []
    const first = images[0]
    return this.preview(typeof first === 'object' && first ? first.id : first)
  },

  /** Варианты выпадающего списка: из схемы, из другого раздела или из тем вопросов */
  selectOptions(field) {
    if (field.options)
      return field.options.map((option) => ({ ...option, value: String(option.value) }))
    if (field.source === 'faqTopics') {
      const topics = this.docs.texts?.data.faqTopics ?? {}
      return Object.entries(topics).map(([value, label]) => ({ value, label }))
    }
    if (field.collection) {
      const conf = this.schema.collections[field.collection]
      return (this.docs[field.collection]?.data ?? []).map((entry) => ({
        value: entry.id,
        label: this.title(entry, conf),
        thumb: conf?.imageField
          ? this.rowThumb({ images: [getPath(entry, conf.imageField)].flat() })
          : null,
      }))
    }
    return []
  },

  // Ссылки на записи другого раздела (допродажа, похожие, товары под статьёй)
  refs(model, field) {
    return getPath(model, field.key) ?? []
  },

  toggleRef(model, field, id) {
    const list = [...this.refs(model, field)]
    const at = list.indexOf(id)
    if (at === -1) list.push(id)
    else list.splice(at, 1)
    setPath(model, field.key, list)
  },

  // Список строк (пункты раздела) и список вложенных записей (цвета, разделы, кадры)
  listOf(model, field) {
    const list = getPath(model, field.key)
    return Array.isArray(list) ? list : []
  },

  addRow(model, field) {
    const list = [...this.listOf(model, field)]
    list.push(field.type === 'strings' ? '' : clone(field.new ?? {}))
    setPath(model, field.key, list)
  },

  removeRow(model, field, index) {
    const list = [...this.listOf(model, field)]
    list.splice(index, 1)
    setPath(model, field.key, list)
  },

  setString(model, field, index, text) {
    const list = [...this.listOf(model, field)]
    list[index] = text
    setPath(model, field.key, list)
  },

  // ——— Фото ———

  imagesOf(model, field) {
    return (getPath(model, field.key) ?? []).map((entry) =>
      typeof entry === 'object' ? entry.id : entry,
    )
  },

  /**
   * Окно выбора фото. В поле «несколько фото» можно отметить несколько готовых или
   * загрузить сразу несколько файлов — все встанут в конец списка по порядку.
   * Имя новому файлу придумывает сама админка: латиница из имени файла или, если его
   * не прочесть (IMG_0042, «фото.jpg»), из названия записи — человеку не нужно
   * знать про имена и занятые имена вовсе
   */
  choose(model, field) {
    if (this.upload.busy) return
    const multiple = field.type === 'images'
    const context = [
      this.item ? this.title(this.item) : (this.sitePage ?? ''),
      model !== this.item && typeof model?.name === 'string' ? model.name : '',
    ]
    this.picker = {
      flow: field.flow,
      multiple,
      query: '',
      selected: [],
      base: slugify(context.filter(Boolean).join(' ')) || 'foto',
      apply: (ids) => {
        if (multiple) setPath(model, field.key, [...(getPath(model, field.key) ?? []), ...ids])
        else setPath(model, field.key, ids[0])
      },
    }
    this.upload = { busy: false, done: 0, total: 0, error: '' }
    Alpine.store('overlay').open('admin-picker')
  },

  get pickerImages() {
    const query = slugify(this.picker.query)
    return Object.entries(this.images)
      .filter(([, image]) => image.type === this.picker.flow)
      .filter(([id]) => !query || id.includes(query))
      .map(([id, image]) => ({ id, ...image }))
  },

  /** Готовое фото: одно — сразу в поле; в списке — отметить, добавит кнопка */
  pickExisting(id) {
    if (!this.picker.multiple) {
      this.picker.apply([id])
      Alpine.store('overlay').close()
      return
    }
    const at = this.picker.selected.indexOf(id)
    if (at === -1) this.picker.selected.push(id)
    else this.picker.selected.splice(at, 1)
  },

  pickSelected() {
    this.picker.apply([...this.picker.selected])
    Alpine.store('overlay').close()
  },

  /** Имя для нового файла: читаемое из имени файла, иначе из названия записи */
  fileId(file, picker = this.picker) {
    const own = slugify(file.name.replace(/\.[^.]+$/, ''))
    const base =
      /[a-z]{3}/.test(own) && !/^(img|dsc|pxl|image|foto|photo|screenshot)\b/.test(own)
        ? own
        : picker.base
    return uniqueId(base.slice(0, 60).replace(/-+$/, ''), new Set(Object.keys(this.images)))
  },

  async uploadFiles(fileList) {
    const files = [...(fileList ?? [])]
    if (!files.length || this.upload.busy) return
    // Поле, для которого начали загрузку, запоминается: окно могут закрыть на середине
    const picker = this.picker
    const chosen = picker.multiple ? files : files.slice(0, 1)
    this.upload = { busy: true, done: 0, total: chosen.length, error: '' }
    const ids = []
    for (const file of chosen) {
      const id = await this.uploadOne(file, picker)
      if (!id) break
      ids.push(id)
      this.upload.done++
    }
    this.upload.busy = false
    // Загруженные до сбоя фото уже в поле; окно остаётся открытым, пока видна ошибка
    if (ids.length) picker.apply(ids)
    if (this.upload.error && chosen.length > 1) {
      this.upload.error += ` ${this.texts.tUploadPartial.replace('{done}', ids.length).replace('{total}', chosen.length)}`
    }
    const overlay = Alpine.store('overlay')
    if (!this.upload.error && overlay.active === 'admin-picker') overlay.close()
  },

  async uploadOne(file, picker) {
    // Имя могли занять в соседней вкладке — тогда берём следующее свободное
    for (let attempt = 0; attempt < 3; attempt++) {
      const id = this.fileId(file, picker)
      const body = new FormData()
      body.append('flow', picker.flow)
      body.append('id', id)
      body.append('file', file)
      try {
        const response = await this.request('/uploads', { method: 'POST', body })
        const result = await response.json().catch(() => ({}))
        if (response.status === 409) {
          this.images[id] = { type: picker.flow, preview: null, ready: false }
          continue
        }
        if (!response.ok) {
          this.upload.error = `${file.name}: ${result.detail ?? this.texts.tUploadFailed}`
          return null
        }
        this.images = result.images
        if (file.type.startsWith('image/'))
          this.localPreviews[result.id] = URL.createObjectURL(file)
        this.setBuild(result.build)
        return result.id
      } catch {
        this.upload.error = `${file.name}: ${this.texts.tUploadFailed}`
        return null
      }
    }
    this.upload.error = `${file.name}: ${this.texts.tUploadFailed}`
    return null
  },

  // ——— Тексты: подпись каждой фразы по-русски — из описания страниц в схеме ———

  /** Путь фразы → где она на сайте и как называется: страница, блок, подпись */
  buildTextIndex() {
    const index = {}
    for (const page of this.schema.sitePages ?? []) {
      for (const block of page.blocks) {
        for (const field of block.fields) {
          if (field.text)
            index[field.text] = {
              ...field,
              page: page.id,
              pageTitle: page.title,
              block: block.title,
            }
        }
      }
    }
    return index
  },

  textValue(path) {
    return getPath(this.docs.texts?.data, path) ?? ''
  },

  setText(path, value) {
    setPath(this.docs.texts.data, path, value)
  },

  /** Фраза изменена и не сохранена — подсвечивается, чтобы правку было видно */
  textChanged(path) {
    return this.changedIn('texts', path)
  },

  /** Значение по пути отличается от сохранённого на сервере */
  changedIn(name, path) {
    const doc = this.docs[name]
    if (!doc) return false
    doc.savedData ??= { raw: null, data: null }
    if (doc.savedData.raw !== doc.saved)
      doc.savedData = { raw: doc.saved, data: JSON.parse(doc.saved) }
    return getPath(doc.savedData.data, path) !== getPath(doc.data, path)
  },

  placeholders(text) {
    return [...new Set(String(text).match(/\{\w+\}/g) ?? [])].join(' ')
  },

  /** Поиск по всем фразам сайта: по испанскому тексту и по русской подписи */
  get textResults() {
    const query = this.textsQuery.trim().toLowerCase()
    if (query.length < 2) return []
    return Object.values(this.textIndex)
      .filter((entry) =>
        [this.textValue(entry.text), entry.label, entry.block, entry.pageTitle].some((part) =>
          String(part).toLowerCase().includes(query),
        ),
      )
      .slice(0, 50)
  },

  // ——— Страницы сайта: блоки страницы сверху вниз, в каждом — фото и фразы ———

  get sitePageConf() {
    return this.schema.sitePages?.find((page) => page.id === this.sitePage) ?? null
  },

  get mainPages() {
    return (this.schema.sitePages ?? []).filter((page) => !page.service)
  },

  get servicePages() {
    return (this.schema.sitePages ?? []).filter((page) => page.service)
  },

  openPage(id) {
    this.sitePage = id
    this.saved = false
    this.pushView()
    Alpine.store('admin').syncUrl()
    window.scrollTo({ top: 0 })
  },

  /** Текстовые страницы — записи своего раздела; открываются прямо из списка страниц */
  openTextPage(index) {
    Alpine.store('admin').setSection('pages')
    this.openItem(index)
  },

  addTextPage() {
    Alpine.store('admin').setSection('pages')
    this.addItem()
  },

  /** Переход из блока страницы в раздел, где правится его содержимое */
  goto(section) {
    Alpine.store('admin').pickSection(section)
  },

  sectionTitle(section) {
    return this.schema.collections[section]?.title ?? ''
  },

  blockSimple(block) {
    return block.fields.filter((field) => !field.sr)
  },

  blockHidden(block) {
    return block.fields.filter((field) => field.sr)
  },

  /** Сколько фраз на странице изменено — счётчик на карточке в списке страниц */
  pageChanges(page) {
    let count = 0
    for (const block of page.blocks)
      for (const field of block.fields)
        if (field.text ? this.textChanged(field.text) : this.changedIn('site', field.key)) count++
    return count
  },

  // ——— Сохранение ———

  /**
   * Приведение к контракту данных перед отправкой (данные.md): пустые оси вариантов
   * убираются (иначе товар считался бы «с выбором»), пустые необязательные блоки
   * статьи — тоже, порядок списка становится полем order.
   */
  normalize(name, data) {
    const result = clone(data)
    const conf = this.schema.collections[name]
    if (!Array.isArray(result)) return result

    result.forEach((item, index) => {
      if (conf?.orderField) item[conf.orderField] = index + 1
      if (!item.id && item.slug) item.id = item.slug
      for (const field of conf?.fields ?? []) {
        if (field.type !== 'list') continue
        const rows = getPath(item, field.key)
        if (!Array.isArray(rows)) continue
        const taken = new Set()
        for (const row of rows) {
          if ('id' in row || field.fields.some((sub) => sub.key === 'id')) {
            row.id = uniqueId(row.id || slugify(getPath(row, field.titleField ?? 'title')), taken)
            taken.add(row.id)
          }
          this.dropEmpty(row, ['items', 'quote'])
          if (row.note && !row.note.title && !row.note.text) delete row.note
          if (row.ordered === false) delete row.ordered
        }
      }
    })

    if (name === 'products') {
      for (const product of result) {
        const size = product.attributes?.dimensions
        if (size) {
          const empty = ['width', 'depth', 'height'].every((key) => size[key] == null)
          product.attributes.dimensions = empty ? null : { ...size, unit: 'cm' }
        }
        for (const axis of Object.keys(product.options ?? {})) {
          if (!product.options[axis]?.length) delete product.options[axis]
        }
        product.options ??= {}
        // Товар с цветами: общие фото = фото первого цвета, у которого они есть. По ним
        // строятся карточка каталога, превью ссылки и разметка для Google — вторым
        // списком их больше не ведут руками (владелец 30.09.2026: «дублируются фотки»)
        const colored = product.options.woodColor?.find((option) => option.images?.length)
        if (colored) product.images = [...colored.images]
      }
    }
    if (name === 'articles') {
      for (const article of result) if (!article.video?.id) delete article.video
    }
    return result
  },

  dropEmpty(object, keys) {
    for (const key of keys) {
      const value = object[key]
      if (value == null || value === '' || (Array.isArray(value) && !value.length))
        delete object[key]
    }
  },

  /**
   * Обязательные поля и наименьшая длина списков (min в схеме) — до сервера: пустое
   * название или игра без карт не уйдут в сборку и не остановят публикацию всего сайта.
   * Скрытые условием when поля не проверяются — к этой записи они не относятся
   */
  missing(name, data) {
    const conf = this.schema.collections[name]
    if (!conf || !Array.isArray(data)) return null
    for (const item of data) {
      for (const field of conf.fields) {
        if (!this.visible(item, field)) continue
        const value = getPath(item, field.key)
        if (field.required && ['', null, undefined].includes(value)) {
          return `«${this.title(item, conf)}»: ${field.label}`
        }
        if (field.min && (Array.isArray(value) ? value.length : 0) < field.min) {
          return `«${this.title(item, conf)}»: ${field.label} — ${this.texts.tMinItems.replace('{n}', field.min)}`
        }
      }
    }
    return null
  },

  async save(name = this.col) {
    if (name === 'sitePages') {
      // Каждый файл — своим запросом со своей версией; споткнулся первый — второй ждёт
      for (const part of ['site', 'texts', 'pages']) {
        if (!this.isDirty(part)) continue
        await this.save(part)
        if (this.saveError) return
      }
      return
    }
    const doc = this.docs[name]
    if (!doc || this.saving) return
    const data = this.normalize(name, doc.data)
    const missing = this.missing(name, data)
    if (missing) {
      this.saveError = `${this.texts.tRequiredField} ${missing}`
      return
    }
    this.saving = true
    this.saveError = ''
    this.saved = false
    const sent = JSON.stringify(doc.data)
    try {
      const response = await this.request(`/content/${name}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, version: doc.version }),
      })
      const result = await response.json().catch(() => ({}))
      if (response.ok) {
        // Набранное, пока шёл запрос, не пропадает: модель заменяется сохранённым видом,
        // только если её с отправки не трогали, иначе правки остаются несохранёнными
        if (JSON.stringify(doc.data) === sent) doc.data = data
        doc.version = result.version
        doc.saved = JSON.stringify(data)
        this.autoSlug.clear()
        this.saved = true
        this.setBuild(result.build)
      } else if (response.status === 409) {
        this.saveError = this.texts.tConflict
      } else if (response.status === 422) {
        this.saveError = result.detail ?? this.texts.tSaveFailed
      } else {
        this.saveError = this.texts.tSaveFailed
      }
    } catch {
      this.saveError = this.texts.tSaveFailed
    }
    this.saving = false
  },

  /** Отказаться от несохранённого — вернуть то, что лежит на сервере */
  async discard(name = this.col) {
    this.saveError = ''
    const parts = name === 'sitePages' ? ['site', 'texts', 'pages'] : [name]
    await Promise.all(parts.map((part) => this.load(part)))
    // Открытая запись остаётся открытой в прежнем виде; новой, несохранённой, больше нет
    if (this.itemIndex !== null && !this.doc?.data[this.itemIndex]) this.back()
    this.autoSlug.clear()
  },

  // ——— История ———

  async openHistory() {
    this.historyState = 'loading'
    try {
      const response = await this.request(`/content/${this.col}/history`)
      if (!response.ok) throw new Error(response.status)
      this.history = (await response.json()).versions
      this.historyState = 'ready'
    } catch {
      this.historyState = 'failed'
    }
  },

  /** Версия из истории встаёт в редактор; сохраняет её обычная кнопка */
  async restore(id) {
    try {
      const response = await this.request(`/content/${this.col}/history/${id}`)
      if (!response.ok) throw new Error(response.status)
      this.doc.data = (await response.json()).data
      this.itemIndex = null
      this.back()
      this.history = null
    } catch {
      this.saveError = this.texts.tSaveFailed
    }
  },

  // ——— Публикация ———

  setBuild(build) {
    if (build) this.build = build
    clearTimeout(this.pollTimer)
    if (this.build.pending || this.build.state === 'building') {
      this.pollTimer = setTimeout(() => this.pollBuild(), POLL_MS)
    }
  },

  async pollBuild() {
    try {
      const response = await this.request('/build')
      const { build } = await response.json()
      const finished =
        this.build.state === 'building' && build.state !== 'building' && !build.pending
      this.setBuild(build)
      // Сборка закончилась — у новых фото появились превью
      if (finished) this.loadIndex()
    } catch {
      this.pollTimer = setTimeout(() => this.pollBuild(), POLL_MS * 3)
    }
  },

  async rebuild() {
    try {
      const response = await this.request('/build', { method: 'POST' })
      if (!response.ok) throw new Error(response.status)
      this.setBuild((await response.json()).build)
    } catch {
      this.saveError = this.texts.tSaveFailed
    }
  },

  get buildLabel() {
    if (this.build.pending) return this.texts.tBuildPending
    return (
      {
        building: this.texts.tBuildBuilding,
        ok: this.texts.tBuildOk,
        error: this.texts.tBuildError,
      }[this.build.state] ?? this.texts.tBuildUnknown
    )
  },

  get buildTone() {
    if (this.build.pending || this.build.state === 'building') return 'warning'
    return { ok: 'success', error: 'error' }[this.build.state] ?? 'neutral'
  },
}
