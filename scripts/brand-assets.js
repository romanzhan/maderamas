// Знак, надпись и палитра для всего, что рисуется скриптами вне браузера: значки сайта
// и брендовый баннер (`brand.js`), превью товаров для WhatsApp (`og-products.js`).
// Один источник, а не копия в каждом скрипте (принцип 16): сменится знак или глиняный —
// сменятся все картинки сразу, а не те, о которых вспомнили.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const iconsDir = resolve(projectRoot, 'src/icons/source')

/**
 * Палитра читается из того же места, где живёт вся палитра сайта (`@theme` в main.css).
 * Своих значений здесь нет: сменится глиняный — значки и баннер сменятся вместе с сайтом,
 * а не останутся молча старыми (принцип 17).
 */
function palette() {
  const css = readFileSync(resolve(projectRoot, 'src/styles/main.css'), 'utf8')
  return Object.fromEntries(
    [...css.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{3,8});/gi)].map(([, name, value]) => [
      name,
      value,
    ]),
  )
}

export const COLOR = palette()

/** Размер холста знака — из него самого: другой viewBox не должен молча сдвигать знак */
function viewBox(name) {
  const file = readFileSync(resolve(iconsDir, `${name}.svg`), 'utf8')
  const box = file.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
  if (!box) throw new Error(`У ${name}.svg нет viewBox — размер знака взять неоткуда`)
  return { w: Number(box[1]), h: Number(box[2]) }
}

/**
 * Содержимое svg без обёртки: нужны только сами контуры. Знак нарисован currentColor —
 * ему цвет задаём мы; надпись сама делится на два цвета токенами палитры, и эту
 * двухцветность надо сохранить: «madera» тёмная, «más» глиняная.
 */
export function paths(name, fill) {
  const file = readFileSync(resolve(iconsDir, `${name}.svg`), 'utf8')
  const inner = file.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '')

  return inner
    .replace(/var\(--color-([a-z-]+)\)/g, (match, token) => COLOR[token] ?? match)
    .replace(/currentColor/g, fill)
}

export const ISOTIPO = viewBox('isotipo')
export const LOGOTIPO = viewBox('logotipo')
