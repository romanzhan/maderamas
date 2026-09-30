// Редактор контента в админке (бэкенд.md §15, страницы.md §17). Store, а не компонент:
// раздел выбирается вкладками страницы админки (src/scripts/admin.js), а форма, окно
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
  schema: { collections: {}, texts: { sections: {} } },
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

  // Окно выбора фото: для какого поля, какой поток, одиночный выбор или добавление в список
  picker: { flow: null, apply: null, query: '', uploading: false, error: '', name: '' },

  textsSection: 'home',
  textsQuery: '',
  sitePage: 'home',

  pollTimer: null,

  // Не init: Alpine сам зовёт init() у store при регистрации, без корня страницы
  setup(root) {
    this.texts = { ...root.dataset }
    const schema = document.getElementById('admin-schema')
    if (schema) this.schema = JSON.parse(schema.textContent)
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
    this.col = name
    this.itemIndex = null
    this.query = ''
    this.saveError = ''
    this.saved = false
    this.confirmDelete = null
    this.history = null
    if (this.indexState === 'idle') this.loadIndex()
    // Страницы сайта — не свой файл, а два чужих: фото в настройках, фразы в словаре
    if (name === 'sitePages') {
      this.colState = 'loading'
      await Promise.all(['site', 'texts'].filter((n) => !this.docs[n]).map((n) => this.load(n)))
      if (this.col === name) this.colState = this.docs.site && this.docs.texts ? 'ready' : 'failed'
      return
    }
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
    if (name === 'sitePages') return this.isDirty('site') || this.isDirty('texts')
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
    return (id && this.images[id]?.preview) || null
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
    window.scrollTo({ top: 0 })
  },

  closeItem() {
    this.itemIndex = null
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
    list.push(item)
    this.autoSlug.add(item.id)
    this.openItem(list.length - 1)
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
    this.confirmDelete = null
    this.itemIndex = null
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

  when(iso) {
    return iso ? dateTime(iso) : ''
  },

  value(model, field) {
    const value = getPath(model, field.key)
    if (field.type === 'bool') return Boolean(value)
    return value ?? ''
  },

  update(model, field, raw) {
    let value = raw
    if (field.type === 'number' || field.type === 'money') {
      value = raw === '' ? (field.nullable ? null : 0) : Number(raw)
      if (field.type === 'money' && value !== null) value = Math.round(value)
    } else if (
      field.type === 'select' &&
      field.options?.every((option) => typeof option.value === 'number')
    ) {
      value = Number(raw)
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
    return Object.entries(field.when ?? {}).every(([key, value]) => getPath(model, key) === value)
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

  choose(model, field) {
    const multiple = field.type === 'images'
    this.picker = {
      flow: field.flow,
      query: '',
      uploading: false,
      error: '',
      name: '',
      taken: false,
      apply: (id) => {
        if (multiple) setPath(model, field.key, [...(getPath(model, field.key) ?? []), id])
        else setPath(model, field.key, id)
        Alpine.store('overlay').close()
      },
    }
    Alpine.store('overlay').open('admin-picker')
  },

  slug(text) {
    return slugify(text)
  },

  get pickerImages() {
    const query = this.picker.query.trim().toLowerCase()
    return Object.entries(this.images)
      .filter(([, image]) => image.type === this.picker.flow)
      .filter(([id]) => !query || id.includes(query))
      .map(([id, image]) => ({ id, ...image }))
  },

  pickFile(event) {
    const file = event.target.files?.[0]
    if (file && !this.picker.name) this.picker.name = slugify(file.name.replace(/\.[^.]+$/, ''))
    this.picker.taken = false
  },

  /** replace — после подтверждения: имя занято фото, которое может стоять у других записей */
  async upload(form, replace = false) {
    const file = form.elements.file.files?.[0]
    const id = slugify(this.picker.name)
    if (!file || !id) {
      this.picker.error = this.texts.tUploadMissing
      return
    }
    this.picker.uploading = true
    this.picker.error = ''
    this.picker.taken = false
    const body = new FormData()
    body.append('flow', this.picker.flow)
    body.append('id', id)
    body.append('file', file)
    if (replace) body.append('replace', '1')
    try {
      const response = await this.request('/uploads', { method: 'POST', body })
      const result = await response.json().catch(() => ({}))
      if (result.error === 'taken') {
        this.picker.taken = true
      } else if (!response.ok) {
        this.picker.error = result.detail ?? this.texts.tUploadFailed
      } else {
        this.images = result.images
        this.setBuild(result.build)
        this.picker.apply(result.id)
      }
    } catch {
      this.picker.error = this.texts.tUploadFailed
    }
    this.picker.uploading = false
  },

  // ——— Тексты сайта ———

  get textSections() {
    const data = this.docs.texts?.data ?? {}
    const names = this.schema.texts.sections
    return Object.keys(data).map((id) => ({ id, label: names[id] ?? id }))
  },

  get textRows() {
    const data = this.docs.texts?.data ?? {}
    const query = this.textsQuery.trim().toLowerCase()
    const rows = this.textRowsOf(query ? Object.keys(data) : [this.textsSection])
    return query
      ? rows.filter(
          (row) =>
            row.value.toLowerCase().includes(query) || row.path.toLowerCase().includes(query),
        )
      : rows
  },

  /** Фразы разделов словаря плоским списком: путь → текст */
  textRowsOf(sections) {
    const data = this.docs.texts?.data ?? {}
    const rows = []
    const walk = (node, path) => {
      for (const [key, value] of Object.entries(node)) {
        const full = path ? `${path}.${key}` : key
        if (value && typeof value === 'object') walk(value, full)
        else rows.push({ path: full, value })
      }
    }
    for (const section of sections) if (data[section]) walk(data[section], section)
    return rows
  },

  // ——— Страницы сайта: фото страницы (site.media) и её тексты (словарь) в одном месте ———

  get sitePageConf() {
    return this.schema.sitePages?.find((page) => page.id === this.sitePage) ?? null
  },

  setText(path, value) {
    setPath(this.docs.texts.data, path, value)
  },

  placeholders(text) {
    return [...new Set(String(text).match(/\{\w+\}/g) ?? [])].join(' ')
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
      for (const part of ['site', 'texts']) {
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
    this.itemIndex = null
    this.saveError = ''
    const parts = name === 'sitePages' ? ['site', 'texts'] : [name]
    await Promise.all(parts.map((part) => this.load(part)))
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
