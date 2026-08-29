// Спрайт иконок: SVG из src/icons/source собираются в один файл с <symbol id="icon-{имя}">.
// Источник — Lucide (интерфейс) и Simple Icons (бренды); свои иконки не рисуем (принцип 1).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = resolve(projectRoot, 'src/icons/source')
const spritePath = resolve(projectRoot, 'src/icons/sprite.svg')

// Толщину штриха тоже оставляем вёрстке: у размера 16 она должна быть больше,
// иначе линия выходит тоньше нормы (стандарты-размеров.md п. 4).
// Заливку намеренно НЕ переносим: атрибут внутри <symbol> побеждает любые классы
// снаружи (у <use> своё теневое дерево), и «заполненная звезда» осталась бы контуром.
// Решает вёрстка — компонент icon ставит fill-none или fill-current.
// Остальное (width, height, class, xmlns) тоже задаёт вёрстка.
const KEEP_ATTRIBUTES = /\b(viewBox|stroke|stroke-linecap|stroke-linejoin)="[^"]*"/g

function toSymbol(file) {
  const svg = readFileSync(join(sourceDir, file), 'utf8')
  const openingTag = svg.match(/<svg\b[^>]*>/)?.[0]
  const inner = svg
    .replace(/<svg\b[^>]*>|<\/svg>/g, '')
    .replace(/<title>[\s\S]*?<\/title>/g, '')
    .trim()

  if (!openingTag || !inner) throw new Error(`Иконка ${file}: не разобрался в SVG`)

  const attributes = openingTag.match(KEEP_ATTRIBUTES) ?? []
  const name = file.slice(0, -extname(file).length)
  return `  <symbol id="icon-${name}" ${attributes.join(' ')}>${inner}</symbol>`
}

if (!existsSync(sourceDir)) {
  mkdirSync(sourceDir, { recursive: true })
}

const icons = readdirSync(sourceDir)
  .filter((file) => extname(file).toLowerCase() === '.svg')
  .sort()

const sprite = [
  '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="display: none">',
  ...icons.map(toSymbol),
  '</svg>',
].join('\n')

writeFileSync(spritePath, `${sprite}\n`)
console.log(`Иконок в спрайте: ${icons.length}.`)
