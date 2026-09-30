// Сверка контента рабочей машины с сервером (бэкенд.md §15). После запуска админки
// данные сайта правят двое: владелец в админке (файлы на сервере, ~/madera-content)
// и разработчик в проекте. Чтобы правки не затирали друг друга, у каждого файла
// помнится отпечаток, на котором стороны в последний раз совпали
// (madera-data/content-sync.json). Изменилась одна сторона — берётся она; обе —
// остановка со списком спорных файлов: решает человек (--take-server / --take-local).
//
// Запуск: npm run content:pull — забрать правки из админки перед работой. Публикация
// зовёт то же самое до отправки кода, поэтому свежие данные уходят и в репозиторий.
import { execSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const recordPath = resolve(root, 'madera-data', 'content-sync.json')
const CONTENT = 'madera-content'

// Что правит админка — тот же список, что CONTENT_COLLECTIONS в public/api/lib/content.php
// и потоки картинок в scripts/images.js. Манифест картинок и список провинций — не
// контент: первый пишет конвейер, второй — часть кода
export const CONTENT_DATA = [
  'data/products.json',
  'data/categories.json',
  'data/articles.json',
  'data/pages.json',
  'data/faq.json',
  'data/reviews.json',
  'data/instagram.json',
  'data/site.config.json',
  'data/dictionaries/es.json',
]
const IMAGE_DIRS = ['products', 'content', 'instagram', 'og', 'video'].map(
  (dir) => `images-source/${dir}`,
)

const deploy = JSON.parse(readFileSync(resolve(root, 'madera-data', 'deploy.json'), 'utf8'))
const sshArgs = [
  '-i',
  deploy.key.replace(/^~/, homedir()),
  '-p',
  String(deploy.port),
  '-o',
  'IdentitiesOnly=yes',
  '-o',
  'BatchMode=yes',
  '-o',
  'ConnectTimeout=30',
  `${deploy.user}@${deploy.host}`,
]

function ssh(script, input) {
  const result = spawnSync('ssh', [...sshArgs, script], {
    input,
    encoding: 'buffer',
    maxBuffer: 1 << 30,
  })
  if (result.status !== 0)
    throw new Error(`Сервер: ${result.stderr.toString() || result.stdout.toString()}`.trim())
  return result.stdout
}

const hash = (buffer) => createHash('sha256').update(buffer).digest('hex')

function localFiles() {
  const files = {}
  for (const file of CONTENT_DATA) {
    const path = resolve(root, file)
    if (existsSync(path)) files[file] = hash(readFileSync(path))
  }
  for (const dir of IMAGE_DIRS) {
    const base = resolve(root, dir)
    if (!existsSync(base)) continue
    for (const name of readdirSync(base, { recursive: true })) {
      const path = join(base, name)
      if (statSync(path).isFile())
        files[relative(root, path).replaceAll('\\', '/')] = hash(readFileSync(path))
    }
  }
  return files
}

function serverFiles() {
  const list = [...CONTENT_DATA, ...IMAGE_DIRS].join(' ')
  const out = ssh(
    `mkdir -p ~/${CONTENT} && cd ~/${CONTENT} && ` +
      `for f in ${list}; do [ -e "$f" ] && find "$f" -type f -exec sha256sum {} +; done; true`,
  ).toString()
  const files = {}
  for (const line of out.split('\n')) {
    const match = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/)
    if (match) files[match[2]] = match[1]
  }
  return files
}

/** Файлы уезжают одним tar-потоком: сотни фото одним соединением, а не сотней */
function pull(files) {
  if (!files.length) return
  const archive = ssh(`cd ~/${CONTENT} && tar -cf - ${files.map((f) => `'${f}'`).join(' ')}`)
  const result = spawnSync('tar', ['-xf', '-', '-C', root], { input: archive })
  if (result.status !== 0) throw new Error(`Не распаковалось: ${result.stderr}`)
}

function push(files) {
  if (!files.length) return
  const archive = spawnSync('tar', ['-cf', '-', '-C', root, ...files], { maxBuffer: 1 << 30 })
  if (archive.status !== 0) throw new Error(`Не упаковалось: ${archive.stderr}`)
  ssh(`mkdir -p ~/${CONTENT} && tar -xf - -C ~/${CONTENT}`, archive.stdout)
}

/**
 * Сверить и привести к одному виду. Возвращает, что куда уехало. Бросает ошибку при
 * споре, если не сказано, чья сторона главнее.
 */
export function syncContent({ prefer = null, log = console.log } = {}) {
  const record = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')) : {}
  const local = localFiles()
  const server = serverFiles()

  const toPull = []
  const toPush = []
  const removeLocal = []
  const removeServer = []
  const conflicts = []

  for (const file of new Set([...Object.keys(local), ...Object.keys(server)])) {
    const [l, s, r] = [local[file], server[file], record[file]]
    if (l === s) continue
    const localChanged = l !== r
    const serverChanged = s !== r
    let side = null
    if (serverChanged && !localChanged) side = 'server'
    else if (localChanged && !serverChanged) side = 'local'
    else side = prefer

    if (side === 'server') (s ? toPull : removeLocal).push(file)
    else if (side === 'local') (l ? toPush : removeServer).push(file)
    else conflicts.push(file)
  }

  if (conflicts.length) {
    throw new Error(
      'Один и тот же файл изменён и в админке, и в проекте:\n' +
        conflicts.map((file) => `  • ${file}`).join('\n') +
        '\nРешить: npm run content:pull -- --take-server (взять админку) или --take-local (взять проект)',
    )
  }

  pull(toPull)
  for (const file of removeLocal) rmSync(resolve(root, file), { force: true })

  // Админка пишет JSON по-своему; в проекте он держится в оформлении Prettier. Забранные
  // файлы приводятся к нему и уезжают обратно — иначе каждая сверка видела бы «правку»
  const pulledJson = toPull.filter((file) => file.endsWith('.json'))
  if (pulledJson.length) {
    execSync(`npx prettier --write ${pulledJson.join(' ')}`, { cwd: root, stdio: 'ignore' })
    toPush.push(...pulledJson)
  }

  push(toPush)
  if (removeServer.length)
    ssh(`cd ~/${CONTENT} && rm -f ${removeServer.map((f) => `'${f}'`).join(' ')}`)

  writeFileSync(recordPath, `${JSON.stringify(localFiles(), null, 2)}\n`)

  const pulled = toPull.length + removeLocal.length
  const pushed = toPush.length - pulledJson.length + removeServer.length
  log(
    pulled || pushed
      ? `Контент сверен: из админки ${pulled}, в админку ${pushed}`
      : 'Контент сверен: проект и админка совпадают',
  )
  return { pulled, pushed }
}

// Запуск напрямую: npm run content:pull [-- --take-server | --take-local]
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const prefer = process.argv.includes('--take-server')
    ? 'server'
    : process.argv.includes('--take-local')
      ? 'local'
      : null
  try {
    syncContent({ prefer })
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
