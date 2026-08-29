// Конвейер изображений (картинки.md): проверка пропорций → размеры → WebP → манифест.
// Идемпотентен: имя файла содержит хеш исходника, обработанное повторно не пересчитывается.
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = resolve(projectRoot, 'images-source')
const outputRoot = resolve(projectRoot, 'public/images')
const manifestPath = resolve(projectRoot, 'data/images.json')

const WEBP_QUALITY = 78
const OG_QUALITY = 80

// ratio задан → исходник обязан прийти ровно в этих пропорциях. Исключение — crop:
// такой поток режет по центру и говорит об этом предупреждением с именем файла.
// Без crop любое отклонение остаётся ошибкой (картинки.md §2.1)
const FLOWS = {
  product: {
    dir: 'products',
    sizes: [400, 800, 1200],
    ratio: [1, 1],
    // Фото товаров сняты вертикально, и других у бренда нет: режем по центру
    // (решение владельца 27.08.2026 — он посмотрел результат до правки)
    crop: true,
    budgetsKb: { 400: 60, 800: 150, 1200: 400 },
  },
  // 1920 в шкале ради кадров во всю ширину (герой главной): без этой ступени экран
  // на 1920 брал бы самый крупный файл и тянул лишние сотни килобайт под LCP
  content: { dir: 'content', sizes: [480, 960, 1600, 1920], ownWidth: true, budgetsKb: {} },
  // Превью для соцсетей: один JPEG, ограничение парсеров WhatsApp
  og: { dir: 'og', sizes: [1200], ratio: [1200, 630], format: 'jpeg', budgetsKb: { 1200: 300 } },
  // Кадры-обложки постов Instagram: вертикальные 3:4 — так лента и выглядит у самой
  // Instagram, а у нас это уже существующая пропорция шкалы (стандарты-размеров.md).
  // Режем по центру, как товары: у рилса обложка бывает 9:16, и низ с подписями
  // отрезать не жалко. Плитка в ленте не шире 400 CSS-пикселей, поэтому шкала короткая
  social: {
    dir: 'instagram',
    sizes: [400, 800],
    ratio: [3, 4],
    crop: true,
    budgetsKb: { 400: 60, 800: 150 },
  },
}

// Видео постов Instagram. Через sharp оно не проходит и перекодировать его нечем:
// ffmpeg — это новая зависимость ради шести файлов (принцип 7). Поэтому файл только
// копируется под именем с хешем — вёрстка по-прежнему не знает путей, а замена
// исходника сама сбрасывает кеш браузера
const VIDEO = {
  dir: 'video',
  out: 'public/video',
  extensions: new Set(['.mp4']),
  budgetKb: 3000,
}

const SOURCE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])
// Имя исходника становится id и частью имени файла. Пробел в нём развалит srcset,
// который сам разделяется пробелами, — поэтому тот же формат, что у id в данных
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const warnings = []
const errors = []
const manifest = {}

async function processFlow(type, flow) {
  const dir = join(sourceRoot, flow.dir)
  if (!existsSync(dir)) return

  for (const file of readdirSync(dir)) {
    if (!SOURCE_EXTENSIONS.has(extname(file).toLowerCase())) continue

    const source = readFileSync(join(dir, file))
    const { width, height } = await displaySize(source)

    if (!ratioFits(flow, width, height, file)) continue

    const id = file.slice(0, -extname(file).length)

    if (!ID.test(id)) {
      errors.push(`${file}: в имени только строчные латинские буквы, цифры и дефисы`)
      continue
    }

    if (id in manifest) {
      errors.push(`${file}: имя "${id}" уже занято картинкой из другого потока — переименуйте`)
      continue
    }

    const hash = createHash('sha256').update(source).digest('hex').slice(0, 8)
    const extension = flow.format === 'jpeg' ? 'jpg' : 'webp'
    // При кадрировании годится только меньшая сторона: из неё и получится квадрат
    const usable = flow.crop ? Math.min(width, height) : width
    const sizes = flow.sizes.filter((size) => size <= usable)

    // Контентный кадр шире самого крупного шага (816 при шкале 480/960/1600): добавляем
    // его собственную ширину, иначе половина присланных пикселей пропадает, а на крупном
    // экране картинка мылит. Только для этого потока: у товаров шкала кончается на 1200
    // с бюджетом лайтбокса, и присланный 2400 добавил бы четвёртый размер мимо правил
    const biggest = sizes[sizes.length - 1]
    if (flow.ownWidth && biggest && usable > biggest * 1.1) sizes.push(usable)

    // Исходник мельче самого маленького размера: в манифест идёт его фактическая
    // ширина — иначе srcset пообещает браузеру пиксели, которых в файле нет
    if (!sizes.length) {
      sizes.push(usable)
      warnings.push(
        `${file}: исходник узкий (${usable} px) — качество на крупных экранах пострадает`,
      )
    }

    const files = {}

    for (const size of sizes) {
      const name = `${id}-${size}-${hash}.${extension}`
      const target = join(outputRoot, name)

      if (!existsSync(target)) await render(source, target, flow, size, usable)

      const budget = flow.budgetsKb[size]
      const weightKb = Math.round(statSync(target).size / 1024)
      if (budget && weightKb > budget) {
        warnings.push(`${name}: ${weightKb} КБ при бюджете ${budget} КБ`)
      }

      files[size] = name
    }

    // Размеры в манифесте — крупнейшего готового файла, а не исходника: по ним вёрстка
    // резервирует место и PhotoSwipe открывает лайтбокс (сложные-узлы.md п. 1)
    const largest = Math.min(Math.max(...sizes), usable)
    const [ratioW, ratioH] = flow.ratio ?? [width, height]

    manifest[id] = {
      type,
      width: largest,
      height: Math.round((largest * ratioH) / ratioW),
      sizes,
      format: extension === 'jpg' ? 'jpeg' : 'webp',
      files,
    }
  }
}

// Фото с телефона хранится боком плюс тег поворота в EXIF. sharp разворачивает его сам
// (autoOrient), но metadata отдаёт сырые пиксели — размеры считаем как увидит человек
async function displaySize(source) {
  const { width, height, orientation } = await sharp(source).metadata()
  const turned = orientation >= 5 && orientation <= 8
  return { width: turned ? height : width, height: turned ? width : height }
}

function render(source, target, flow, size, usableWidth) {
  const width = Math.min(size, usableWidth)
  const resized = sharp(source, { autoOrient: true }).resize({
    width,
    height: flow.ratio ? Math.round((width * flow.ratio[1]) / flow.ratio[0]) : undefined,
    // Кадрируем по центру: середина кадра у предметной съёмки и есть товар
    ...(flow.crop ? { fit: 'cover', position: 'centre' } : {}),
  })

  return flow.format === 'jpeg'
    ? resized.jpeg({ quality: OG_QUALITY, mozjpeg: true }).toFile(target)
    : resized.webp({ quality: WEBP_QUALITY }).toFile(target)
}

// Кривой исходник — ошибка с именем файла, а не тихий кроп под нужную пропорцию.
// Поток с crop кадрирует, но молчать всё равно не имеет права: владелец должен знать,
// у каких кадров подрезаны края, и заменить те, где это плохо смотрится
function ratioFits(flow, width, height, file) {
  if (!flow.ratio) return true

  const [ratioW, ratioH] = flow.ratio
  if (width * ratioH === height * ratioW) return true

  if (flow.crop) {
    warnings.push(`${file}: ${width}×${height} обрезано по центру до квадрата`)
    return true
  }

  const expected = ratioW === ratioH ? 'квадратный (1:1)' : '1200×630'
  errors.push(`${file}: пропорции ${width}×${height} не подходят — нужен исходник ${expected}`)
  return false
}

/**
 * Видео: копия с хешем в имени, без обработки. Требования к исходнику владелец
 * выполняет сам (картинки.md §6) — здесь только проверяется вес, чтобы страница
 * не потяжелела молча.
 */
function processVideo() {
  const dir = join(sourceRoot, VIDEO.dir)
  if (!existsSync(dir)) return

  const outDir = resolve(projectRoot, VIDEO.out)
  mkdirSync(outDir, { recursive: true })

  for (const file of readdirSync(dir)) {
    const extension = extname(file).toLowerCase()
    if (!VIDEO.extensions.has(extension)) continue

    const id = file.slice(0, -extension.length)
    if (!ID.test(id)) {
      errors.push(`${file}: в имени только строчные латинские буквы, цифры и дефисы`)
      continue
    }
    if (id in manifest) {
      errors.push(`${file}: имя "${id}" уже занято картинкой — переименуйте`)
      continue
    }

    const source = readFileSync(join(dir, file))
    const hash = createHash('sha256').update(source).digest('hex').slice(0, 8)
    const name = `${id}-${hash}.mp4`
    const target = join(outDir, name)

    if (!existsSync(target)) writeFileSync(target, source)

    const weightKb = Math.round(source.length / 1024)
    if (weightKb > VIDEO.budgetKb) {
      warnings.push(`${name}: ${weightKb} КБ при бюджете ${VIDEO.budgetKb} КБ — сожмите ролик`)
    }

    manifest[id] = { type: 'video', format: 'mp4', files: { original: name } }
  }
}

function removeStaleFiles() {
  const keep = new Set(Object.values(manifest).flatMap((entry) => Object.values(entry.files)))

  for (const file of readdirSync(outputRoot)) {
    if (!keep.has(file)) rmSync(join(outputRoot, file))
  }

  // Ролики лежат отдельно от картинок, и мусор в их папке копится по тем же правилам
  const videoDir = resolve(projectRoot, VIDEO.out)
  if (!existsSync(videoDir)) return
  for (const file of readdirSync(videoDir)) {
    if (!keep.has(file)) rmSync(join(videoDir, file))
  }
}

// Нет ни одной папки с исходниками — значит, их просто ещё не прислали. Молча выходим:
// иначе пустой манифест снёс бы и файлы, и запись о них (у владельца исходников нет в git)
if (![...Object.values(FLOWS), VIDEO].some((flow) => existsSync(join(sourceRoot, flow.dir)))) {
  console.log('Исходников нет — конвейер пропущен, манифест не тронут.')
  process.exit(0)
}

mkdirSync(outputRoot, { recursive: true })

for (const [type, flow] of Object.entries(FLOWS)) {
  await processFlow(type, flow)
}

processVideo()

for (const warning of warnings) console.warn(`Предупреждение: ${warning}`)

if (errors.length) {
  console.error(`Исходники не прошли проверку (${errors.length}):`)
  for (const error of errors) console.error(`  — ${error}`)
  process.exit(1)
}

removeStaleFiles()
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Картинок в манифесте: ${Object.keys(manifest).length}.`)
