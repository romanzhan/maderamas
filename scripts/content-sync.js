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
    // Вывод читается байтами (архивы), поэтому и вход — байтами: строка при encoding
    // 'buffer' не перекодируется
    input: typeof input === 'string' ? Buffer.from(input) : input,
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
  // Папка — через cwd, не -C: tar из Git for Windows портит путь вида D:\… в аргументе
  const result = spawnSync('tar', ['-xf', '-'], { cwd: root, input: archive })
  if (result.status !== 0) throw new Error(`Не распаковалось: ${result.stderr}`)
}

/**
 * Сервер меняется только если его файлы всё ещё те, что видела сверка: владелец мог
 * сохранить раздел, пока шла сверка, — тогда отказ, и следующая сверка увидит правку.
 * expected: файл → отпечаток на сервере или undefined («файла не было»)
 */
function unchangedCheck(expected) {
  return Object.entries(expected)
    .map(([file, sum]) =>
      sum ? `[ "$(sha256sum '${file}' 2>/dev/null | cut -c1-64)" = ${sum} ]` : `[ ! -e '${file}' ]`,
    )
    .join(' && ')
}

const CHANGED_MEANWHILE = 'В админке сохранили правку во время сверки — запустите ещё раз'

function push(files, expected) {
  if (!files.length) return
  const archive = spawnSync('tar', ['-cf', '-', '-C', root, ...files], { maxBuffer: 1 << 30 })
  if (archive.status !== 0) throw new Error(`Не упаковалось: ${archive.stderr}`)
  ssh(
    `mkdir -p ~/${CONTENT} && cd ~/${CONTENT} && ` +
      `{ ${unchangedCheck(expected)} || { echo '${CHANGED_MEANWHILE}' >&2; exit 1; }; } && tar -xf -`,
    archive.stdout,
  )
}

function removeFromServer(files, expected) {
  if (!files.length) return
  ssh(
    `cd ~/${CONTENT} && { ${unchangedCheck(expected)} || { echo '${CHANGED_MEANWHILE}' >&2; exit 1; }; } && ` +
      `rm -f ${files.map((f) => `'${f}'`).join(' ')}`,
  )
}

/**
 * Сверить и привести к одному виду. Возвращает, что куда уехало. Бросает ошибку при
 * споре, если не сказано, чья сторона главнее.
 *
 * Запись хранит отпечатки обеих сторон отдельно: админка пишет JSON по-своему, в проекте
 * он в оформлении Prettier, и по содержанию одинаковые файлы байтами разные. Сравнивать
 * стороны между собой поэтому нельзя — только каждую с её прошлым видом.
 *
 * Удалить на сервере то, чего нет в проекте, — только с allowDelete: исходники фото
 * хранятся лишь на машине и на сервере, и проект без папки images-source (новый
 * компьютер) иначе стёр бы все фото сайта.
 */
export function syncContent({ prefer = null, allowDelete = false, log = console.log } = {}) {
  const saved = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')) : {}
  // Запись до 30.09.2026 — один отпечаток на файл, общий для обеих сторон
  const record = Object.fromEntries(
    Object.entries(saved).map(([file, entry]) => [
      file,
      typeof entry === 'string' ? { local: entry, server: entry } : entry,
    ]),
  )
  const local = localFiles()
  const server = serverFiles()

  const toPull = []
  const toPush = []
  const removeLocal = []
  const removeServer = []
  const conflicts = []

  for (const file of new Set([...Object.keys(local), ...Object.keys(server)])) {
    const [l, s, r] = [local[file], server[file], record[file] ?? {}]
    if (l === s) continue
    const localChanged = l !== r.local
    const serverChanged = s !== r.server
    if (!localChanged && !serverChanged) continue
    let side = null
    if (serverChanged && !localChanged) side = 'server'
    else if (localChanged && !serverChanged) side = 'local'
    else side = prefer
    // «Взять админку» возвращает и то, чего на этой машине просто нет
    if (side === 'local' && !l && prefer === 'server') side = 'server'

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

  if (removeServer.length && !allowDelete) {
    throw new Error(
      `В проекте нет ${removeServer.length} файлов, которые есть в админке:\n` +
        removeServer
          .slice(0, 10)
          .map((file) => `  • ${file}`)
          .join('\n') +
        (removeServer.length > 10 ? '\n  …' : '') +
        '\nЕсли их правда удалили в проекте: npm run content:pull -- --allow-delete.' +
        '\nЕсли их просто нет на этой машине: npm run content:pull -- --take-server',
    )
  }

  const expected = (files) => Object.fromEntries(files.map((file) => [file, server[file]]))
  push(toPush, expected(toPush))
  removeFromServer(removeServer, expected(removeServer))

  pull(toPull)
  for (const file of removeLocal) rmSync(resolve(root, file), { force: true })
  // Забранный JSON — в оформление проекта. Обратно не едет: запись помнит обе стороны
  const pulledJson = toPull.filter((file) => file.endsWith('.json'))
  if (pulledJson.length)
    execSync(`npx prettier --write ${pulledJson.join(' ')}`, { cwd: root, stdio: 'ignore' })

  // Новые или заменённые фото из админки: без их нарезки проект не соберётся (в данных
  // уже есть их id), а публикация.mjs фиксирует нарезку вместе с данными
  const pulledImages = [...toPull, ...removeLocal].some((file) => file.startsWith('images-source/'))
  if (pulledImages) execSync('node scripts/images.js', { cwd: root, stdio: 'inherit' })

  // Сервер после сверки: то, что было, плюс отправленное, минус удалённое
  const serverNow = { ...server }
  const after = localFiles()
  for (const file of toPush) serverNow[file] = after[file]
  for (const file of removeServer) delete serverNow[file]
  const next = {}
  for (const file of new Set([...Object.keys(after), ...Object.keys(serverNow)]))
    next[file] = { local: after[file], server: serverNow[file] }
  writeFileSync(recordPath, `${JSON.stringify(next, null, 2)}\n`)

  const pulled = [...toPull, ...removeLocal]
  const pushed = toPush.length + removeServer.length
  log(
    pulled.length || pushed
      ? `Контент сверен: из админки ${pulled.length}, в админку ${pushed}`
      : 'Контент сверен: проект и админка совпадают',
  )
  return { pulled, pushed, images: pulledImages }
}

// Запуск напрямую: npm run content:pull [-- --take-server | --take-local]
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const prefer = process.argv.includes('--take-server')
    ? 'server'
    : process.argv.includes('--take-local')
      ? 'local'
      : null
  try {
    syncContent({ prefer, allowDelete: process.argv.includes('--allow-delete') })
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
