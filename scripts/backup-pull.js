// Копии с сервера — на рабочую машину (бэкенд.md §10): ночные копии лежат на том же
// хостинге, что и сайт, и при потере аккаунта пропали бы вместе с ним. Команда забирает
// то, чего здесь ещё нет, в madera-data/server-backups (не в git), и сверяет отпечатки
// с SHA256SUMS той ночи. Фото (images-*.tar) — только самую свежую неделю.
// Запуск: npm run backup:pull; публикация зовёт её сама в конце.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const target = resolve(root, 'madera-data', 'server-backups')
// Локально держим два месяца: дальше копии нужны разве что для истории, а она в журналах
const KEEP_DAYS = 60

const deploy = JSON.parse(readFileSync(resolve(root, 'madera-data', 'deploy.json'), 'utf8'))
const ssh = (script) =>
  spawnSync(
    'ssh',
    [
      '-i',
      deploy.key.replace(/^~/, homedir()),
      '-p',
      String(deploy.port),
      '-o',
      'IdentitiesOnly=yes',
      '-o',
      'BatchMode=yes',
      `${deploy.user}@${deploy.host}`,
      script,
    ],
    { encoding: 'buffer', maxBuffer: 2 ** 31 - 1 },
  )

mkdirSync(target, { recursive: true })
const listing = ssh('cd ~/madera-data/backups && ls -1')
if (listing.status !== 0) throw new Error(`Сервер: ${listing.stderr}`)
const remote = listing.stdout.toString().split('\n').filter(Boolean)

const newestImages = remote.filter((name) => name.startsWith('images-')).sort().at(-1)
const wanted = remote.filter(
  (name) =>
    !existsSync(resolve(target, name)) &&
    (!name.startsWith('images-') || name === newestImages),
)

if (wanted.length) {
  const archive = ssh(`cd ~/madera-data/backups && tar -cf - ${wanted.map((n) => `'${n}'`).join(' ')}`)
  if (archive.status !== 0) throw new Error(`Не скачалось: ${archive.stderr}`)
  // Папка — через cwd, не -C: tar из Git for Windows портит путь вида D:\… в аргументе
  const unpack = spawnSync('tar', ['-xf', '-'], { cwd: target, input: archive.stdout })
  if (unpack.status !== 0) throw new Error(`Не распаковалось: ${unpack.stderr}`)
}

// Отпечатки: копия, которая не сходится со своей ночной записью, — повод разбираться
const bad = []
for (const sums of readdirSync(target).filter((name) => name.startsWith('SHA256SUMS-'))) {
  for (const line of readFileSync(resolve(target, sums), 'utf8').split('\n').filter(Boolean)) {
    const [hash, name] = line.split(/\s+\*?\.?\/?/)
    const file = resolve(target, name)
    if (!existsSync(file)) continue
    if (createHash('sha256').update(readFileSync(file)).digest('hex') !== hash) bad.push(name)
  }
}

const cutoff = Date.now() - KEEP_DAYS * 86400_000
for (const name of readdirSync(target)) {
  const day = name.match(/(\d{4}-\d{2}-\d{2})/)?.[1]
  if (day && Date.parse(day) < cutoff) rmSync(resolve(target, name))
}

console.log(`Копии с сервера: новых ${wanted.length}, всего здесь ${readdirSync(target).length}`)
if (bad.length) {
  console.error(`ВНИМАНИЕ: отпечатки не сошлись — ${bad.join(', ')}`)
  process.exitCode = 1
}
