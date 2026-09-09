// Значки сайта и брендовый баннер для соцсетей (seo.md п. 7 и п. 9). Собираются из тех
// же двух файлов, что и логотип на сайте (`src/icons/source/`), — рисовать знак заново
// нельзя (принцип 1). Отдельный скрипт, а не разовая правка: сменится знак — набор
// пересобирается одной командой, а не вспоминается по кускам.
//
// Через конвейер картинок это не идёт: favicon — статика в /public (seo.md п. 9),
// а OG-баннер конвейер только сожмёт, собрать его всё равно надо здесь.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { COLOR, ISOTIPO, LOGOTIPO, paths, projectRoot } from './brand-assets.js'
import { t } from './data.js'

const publicDir = resolve(projectRoot, 'public')
const ogDir = resolve(projectRoot, 'images-source/og')

/** Квадратный значок: знак на кремовом поле с полями, чтобы не резался маской */
function iconSvg(size) {
  const pad = size * 0.18
  const inner = size - pad * 2
  const scale = inner / ISOTIPO.h
  const left = (size - ISOTIPO.w * scale) / 2

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${COLOR.cream}"/>
  <g transform="translate(${left} ${pad}) scale(${scale})">${paths('isotipo', COLOR.clay)}</g>
</svg>`
}

/**
 * Баннер для WhatsApp и соцсетей: знак и надпись по центру кремового поля.
 * Строго 1200×630 — этого требует конвейер и парсеры соцсетей (seo.md п. 7).
 */
function ogSvg() {
  const [width, height] = [1200, 630]
  const markHeight = 200
  const markScale = markHeight / ISOTIPO.h
  const wordWidth = 520
  const wordScale = wordWidth / LOGOTIPO.w
  const gap = 56
  const block = markHeight + gap + LOGOTIPO.h * wordScale
  const top = (height - block) / 2

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${COLOR.cream}"/>
  <g transform="translate(${(width - ISOTIPO.w * markScale) / 2} ${top}) scale(${markScale})">
    ${paths('isotipo', COLOR.clay)}
  </g>
  <g transform="translate(${(width - wordWidth) / 2} ${top + markHeight + gap}) scale(${wordScale})">
    ${paths('logotipo', COLOR.charcoal)}
  </g>
</svg>`
}

/**
 * ICO вокруг готового PNG. sharp формат .ico не пишет, а браузеры и поисковые роботы
 * по-прежнему просят /favicon.ico по корню; контейнер ICO разрешает PNG внутри,
 * поэтому хватает двадцати двух байт заголовка.
 */
function ico(png, size) {
  const header = Buffer.alloc(22)
  header.writeUInt16LE(0, 0) // зарезервировано
  header.writeUInt16LE(1, 2) // тип: значок
  header.writeUInt16LE(1, 4) // один размер в файле
  header.writeUInt8(size, 6)
  header.writeUInt8(size, 7)
  header.writeUInt8(0, 8) // палитры нет
  header.writeUInt8(0, 9)
  header.writeUInt16LE(1, 10) // плоскостей
  header.writeUInt16LE(32, 12) // бит на точку
  header.writeUInt32LE(png.length, 14)
  header.writeUInt32LE(22, 18) // смещение данных
  return Buffer.concat([header, png])
}

// Манифест ровно в объёме seo.md п. 9: имя, короткое имя, значки и цвета. Ни display,
// ни start_url — они делают сайт устанавливаемым приложением, а мы прямо не PWA
const MANIFEST = {
  // Имя видит покупатель на ярлыке и вкладке — берём из словаря, а не второй записью
  name: t('seo.siteName'),
  short_name: t('seo.siteName'),
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
  ],
  theme_color: COLOR.cream,
  background_color: COLOR.cream,
}

const png = (size) =>
  sharp(Buffer.from(iconSvg(size)))
    .png()
    .toBuffer()

mkdirSync(publicDir, { recursive: true })
mkdirSync(ogDir, { recursive: true })

writeFileSync(resolve(publicDir, 'icon.svg'), `${iconSvg(512)}\n`)
writeFileSync(resolve(publicDir, 'favicon.ico'), ico(await png(32), 32))
writeFileSync(resolve(publicDir, 'apple-touch-icon.png'), await png(180))
writeFileSync(resolve(publicDir, 'icon-192.png'), await png(192))
writeFileSync(resolve(publicDir, 'icon-512.png'), await png(512))
writeFileSync(resolve(publicDir, 'site.webmanifest'), `${JSON.stringify(MANIFEST, null, 2)}\n`)

// Баннер кладём в исходники конвейера: он же проверит пропорции и вес (картинки.md §2)
await sharp(Buffer.from(ogSvg()))
  .jpeg({ quality: 90, mozjpeg: true })
  .toFile(resolve(ogDir, 'og-brand.jpg'))

console.log('Значки сайта и баннер og-brand пересобраны.')
