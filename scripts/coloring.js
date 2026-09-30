// Листы-раскраски для раздела Para familias через OpenAI Images (решение владельца
// 30.09.2026: рисунки ИИ, показать до публикации). Пайплайн взят из проекта iseo.fi
// (bin/images.mjs): одно описание стиля, меняется только сюжет.
//
// Запуск: node scripts/coloring.js <имя>="<что нарисовано>" [...]
// пример: node scripts/coloring.js carpincho="a friendly capybara sitting by a pond"
//
// Лист → images-source/content/colorear-<имя>.png (поток content, картинки.md): дальше его
// нарезает обычный конвейер (npm run images). Картинка доводится до чистого чёрного
// по белому — серые полутона на домашнем принтере печатаются грязью.
// Ключ — не в проекте: OPENAI_API_KEY или ~/.config/iseo/openai_key (ключ iseo.fi).
import { mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import sharp from 'sharp'

const root = resolve(import.meta.dirname, '..')
const outDir = resolve(root, 'images-source', 'content')

const key =
  process.env.OPENAI_API_KEY ??
  readFileSync(resolve(homedir(), '.config', 'iseo', 'openai_key'), 'utf8').trim()

const pairs = process.argv.slice(2).filter((arg) => arg.includes('='))
if (!pairs.length) {
  console.error('Запуск: node scripts/coloring.js имя="сюжет по-английски" ...')
  process.exit(1)
}

// Стиль один на все листы: одинаковая толщина линий и крупные замкнутые области —
// ребёнку 3–6 лет нужно куда попадать карандашом
const STYLE = (subject) =>
  `${subject}. Black-and-white coloring book page for young children aged 3 to 6. ` +
  'Clean bold black outlines of uniform thickness, all shapes closed, large simple areas ' +
  'easy to color, friendly cute style, pure white background. No shading, no gray, no ' +
  'fills, no hatching, no color, no texture. Centered composition with generous white ' +
  'margins on all sides, vertical page. No text, no letters, no numbers, no logos, ' +
  'no watermark, no frame, no border.'

mkdirSync(outDir, { recursive: true })

for (const pair of pairs) {
  const [name, ...rest] = pair.split('=')
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-image-2',
      prompt: STYLE(rest.join('=')),
      size: '1024x1536',
      quality: 'high',
      background: 'opaque',
      output_format: 'png',
      n: 1,
    }),
  })
  if (!response.ok) {
    console.error(name, response.status, (await response.text()).slice(0, 300))
    continue
  }
  const png = Buffer.from((await response.json()).data[0].b64_json, 'base64')
  const target = resolve(outDir, `colorear-${name}.png`)
  // Порог 160 из 255: сглаженный край линии остаётся чёрным, светлый шум уходит в белый
  await sharp(png).grayscale().threshold(160).png().toFile(target)
  console.log('ok', target)
}
