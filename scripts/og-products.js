// Превью товаров для WhatsApp и соцсетей (seo.md п. 7): у каждого товара своя картинка
// 1200×630, собранная из его первого фото и знака бренда. Решение владельца 09.09.2026:
// горизонтальных кадров под превью нет и не предвидится, а одинаковый баннер на всех
// ссылках делал товары неотличимыми в переписке.
//
// Это не авто-кроп квадрата (он запрещён seo.md п. 7 — обрезал бы товар), а раскладка:
// фото целиком слева, знак и надпись справа на кремовом поле. Результат кладётся
// в исходники og-потока, дальше его сжимает и проверяет обычный конвейер (`npm run images`).
// Свой баннер товара (`ogImage` в данных) этот скрипт не трогает и не перекрывает:
// seo-meta берёт его первым, собранный — вторым, брендовый — третьим.
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { COLOR, ISOTIPO, LOGOTIPO, paths, projectRoot } from './brand-assets.js'
import { imageIds, loadData } from './data.js'

const productsDir = resolve(projectRoot, 'images-source/products')
const ogDir = resolve(projectRoot, 'images-source/og')

// Те же 1200×630, что у брендового баннера: конвейер принимает og-поток только в этой
// пропорции (картинки.md §2). Фото занимает квадрат по левому краю на всю высоту,
// знак с надписью стоят по центру оставшегося поля
const WIDTH = 1200
const HEIGHT = 630
const PHOTO = HEIGHT
const PANEL_LEFT = PHOTO
const PANEL_WIDTH = WIDTH - PHOTO
const MARK_HEIGHT = 150
const WORD_WIDTH = 380
const GAP = 40

/** Исходник первого фото товара — по id, расширение любое из принятых конвейером */
function sourceFor(id) {
  const file = readdirSync(productsDir).find((name) => name.replace(/\.[a-z]+$/i, '') === id)
  return file ? resolve(productsDir, file) : null
}

function panelSvg() {
  const markScale = MARK_HEIGHT / ISOTIPO.h
  const wordScale = WORD_WIDTH / LOGOTIPO.w
  const block = MARK_HEIGHT + GAP + LOGOTIPO.h * wordScale
  const top = (HEIGHT - block) / 2

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${COLOR.cream}"/>
  <g transform="translate(${PANEL_LEFT + (PANEL_WIDTH - ISOTIPO.w * markScale) / 2} ${top}) scale(${markScale})">
    ${paths('isotipo', COLOR.clay)}
  </g>
  <g transform="translate(${PANEL_LEFT + (PANEL_WIDTH - WORD_WIDTH) / 2} ${top + MARK_HEIGHT + GAP}) scale(${wordScale})">
    ${paths('logotipo', COLOR.charcoal)}
  </g>
</svg>`
}

const { products } = loadData()
mkdirSync(ogDir, { recursive: true })
const panel = Buffer.from(panelSvg())
let made = 0

for (const product of products) {
  const [firstId] = imageIds(product.images)
  const source = firstId ? sourceFor(firstId) : null
  if (!source) {
    console.log(`Пропуск: у товара "${product.id}" нет исходника первого фото — останется брендовый баннер`)
    continue
  }
  const target = resolve(ogDir, `og-${product.id}.jpg`)
  // Квадрат по центру — так же, как режет товары конвейер (картинки.md §2)
  const photo = await sharp(source)
    .resize(PHOTO, PHOTO, { fit: 'cover', position: 'centre' })
    .toBuffer()
  await sharp(panel)
    .composite([{ input: photo, left: 0, top: 0 }])
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(target)
  made++
}

console.log(`Превью товаров собрано: ${made} (в ${existsSync(ogDir) ? 'images-source/og' : ogDir}). Дальше — npm run images.`)
