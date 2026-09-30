// Публикация кода на хостинг с рабочей машины. Запуск: npm run deploy
// (публикация.mjs вызывает его сам после отправки проекта в репозиторий).
//
// С 30.09.2026 сайт собирает сам хостинг (бэкенд.md §15): там лежат данные, которые
// правит админка, и собирать где-то ещё значило бы собирать из устаревших. Поэтому здесь:
//   1. сверка контента с сервером (scripts/content-sync.js) — правки админки не теряются;
//   2. код проекта одним tar-потоком в ~/madera-build (без данных и готовых картинок —
//      их сборщик берёт из ~/madera-content и делает сам);
//   3. зависимости на сервере, если поменялся package-lock.json;
//   4. сборка там же (scripts/server-build.sh --force) — во все цели из targets.json:
//      превью dev и, после запуска, боевой сайт;
//   5. проверка живых адресов каждой цели.
//
// Куда и каким ключом — madera-data/deploy.json (не в git): host, port, user, path, key, url;
// боевой сайт — блок prod: { path, url }.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { CONTENT_DATA, syncContent } from './content-sync.js'

const root = resolve(import.meta.dirname, '..')
const deploy = JSON.parse(readFileSync(resolve(root, 'madera-data', 'deploy.json'), 'utf8'))
const NODE = '/opt/alt/alt-nodejs22/root/usr/bin'
const BUILD = 'madera-build'

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
  return { ok: result.status === 0, out: result.stdout.toString(), err: result.stderr.toString() }
}

function sshOrFail(script, input, what) {
  const result = ssh(script, input)
  if (!result.ok) throw new Error(`${what}: ${result.err || result.out}`.trim())
  return result.out
}

// 1. Контент
syncContent()

// 2. Код. Данные и готовые картинки не едут: первые — из ~/madera-content, вторые
// сборщик делает сам из исходников
const files = spawnSync('git', ['ls-files', '-co', '--exclude-standard'], {
  cwd: root,
  encoding: 'utf8',
})
  .stdout.split('\n')
  .filter((file) => file && existsSync(resolve(root, file)))
  .filter((file) => !CONTENT_DATA.includes(file))
  .filter((file) => !/^public\/(images|video)\//.test(file) && file !== 'data/images.json')
const archive = spawnSync('tar', ['-cf', '-', '-C', root, ...files], { maxBuffer: 1 << 30 })
if (archive.status !== 0) throw new Error(`Код не упаковался: ${archive.stderr}`)

// Промежуточная папка и rsync --delete: в ~/madera-build остаётся ровно код проекта.
// Исключения — то, что сборщик держит между запусками: зависимости, картинки,
// сгенерированные страницы, цели, журнал
const protect = [
  ...CONTENT_DATA,
  'data/images.json',
  'node_modules/',
  'dist/',
  'images-source/',
  'public/images/',
  'public/video/',
  'public/catalog.json',
  'public/api/runtime.json',
  'targets.json',
  'build.log',
  '.package-lock.sha',
].map((path) => `--exclude '/${path}'`)
// 3. Зависимости — там же и только если поменялся список: npm ci на хостинге идёт минуты.
// Всё под замком сборщика: минутная сборка после правки в админке не должна собирать
// наполовину заменённый код
const lockHash = createHash('sha256')
  .update(readFileSync(resolve(root, 'package-lock.json')))
  .digest('hex')
const upload = sshOrFail(
  [
    'set -e',
    'exec 9>"$HOME/.madera-build.lock"',
    'flock -w 1200 9',
    `stage=$HOME/${BUILD}-stage`,
    'rm -rf "$stage" && mkdir -p "$stage"',
    'tar -C "$stage" -xf -',
    `rsync -a --delete ${protect.join(' ')} "$stage/" "$HOME/${BUILD}/"`,
    'rm -rf "$stage"',
    `cd ~/${BUILD}`,
    `if [ "$(cat .package-lock.sha 2>/dev/null)" != ${lockHash} ]; then`,
    `  export PATH=${NODE}:$PATH`,
    '  npm ci --no-audit --no-fund >/dev/null',
    `  echo ${lockHash} > .package-lock.sha`,
    '  echo deps',
    'fi',
  ].join('\n'),
  archive.stdout,
  'Код или зависимости не доехали до сервера',
)
console.log(
  `Код на сервере: ${files.length} файлов${upload.includes('deps') ? ', зависимости обновлены' : ''}`,
)

// Цели сборки: с 30.09.2026 одна — боевой сайт (dev закрыт, на нём только переадресация
// на www). Список живёт на сервере; пропал — восстанавливается без dev
const targets = ssh(`cat ~/${BUILD}/targets.json`)
if (!targets.ok) {
  const prod = [{ name: 'prod', path: deploy.prod.path, url: deploy.prod.url, preview: false }]
  sshOrFail(`cat > ~/${BUILD}/targets.json`, JSON.stringify(prod, null, 2), 'Цели не записались')
}
const siteTargets = JSON.parse(targets.ok ? targets.out : ssh(`cat ~/${BUILD}/targets.json`).out)

// 4. Сборка — тот же сборщик, что после правки в админке
console.log('Сборка на сервере…')
const build = ssh(`bash ~/${BUILD}/scripts/server-build.sh --force`)
if (!build.ok) {
  const status = ssh('cat ~/madera-content/build-status.json').out
  const message = status ? JSON.parse(status).message : ssh(`tail -30 ~/${BUILD}/build.log`).out
  throw new Error(`Сборка на сервере не прошла:\n${message}`)
}

// 5. Живые адреса каждой цели: страницы, 404, сервер заказов; превью закрыто от поиска,
// боевой сайт — открыт и с картой сайта
const problems = []
for (const target of siteTargets) {
  const site = target.url.replace(/\/$/, '')
  const status = async (path, init) => {
    try {
      return (
        await fetch(site + path, {
          redirect: 'manual',
          signal: AbortSignal.timeout(20_000),
          ...init,
        })
      ).status
    } catch {
      return 0
    }
  }
  const text = (path, init) =>
    fetch(site + path, { signal: AbortSignal.timeout(20_000), ...init })
      .then((response) => (init?.method === 'HEAD' ? response : response.text()))
      .catch(() => null)

  for (const path of [
    '/',
    '/sillas/',
    '/sillas/silla-evolutiva/',
    '/carrito/',
    '/checkout/',
    '/blog/',
    '/admin/',
  ]) {
    const code = await status(path)
    console.log(`${code} ${site}${path}`)
    if (code !== 200) problems.push(`${target.name} ${path}`)
  }
  if ((await status('/no-existe-xyz/')) !== 404) problems.push(`${target.name}: своя страница 404`)
  if (!((await text('/api/health')) ?? '').includes('"ok":true'))
    problems.push(`${target.name} /api/health`)
  if ((await status('/api/runtime.json')) === 200)
    problems.push(`${target.name}: runtime.json открыт снаружи`)

  const robots = (await text('/robots.txt')) ?? ''
  const head = await text('/', { method: 'HEAD' })
  const noindex = /noindex/i.test(head?.headers?.get('x-robots-tag') ?? '')
  if (target.preview) {
    // Превью закрывает заголовок noindex, а robots.txt обход разрешает — иначе робот
    // не увидел бы запрета (seo.md п. 9, 30.09.2026). Запрет обхода здесь — ошибка
    if (/^Disallow: \/$/m.test(robots))
      problems.push(`${target.name}: robots.txt запрещает обход — робот не увидит noindex`)
    if (!noindex) problems.push(`${target.name}: нет заголовка X-Robots-Tag: noindex`)
  } else {
    if (/^Disallow: \/$/m.test(robots))
      problems.push(`${target.name}: robots.txt закрывает боевой сайт`)
    if (noindex) problems.push(`${target.name}: боевой сайт отдаёт X-Robots-Tag: noindex`)
    if ((await status('/sitemap.xml')) !== 200) problems.push(`${target.name}: нет sitemap.xml`)
  }
}

if (problems.length) throw new Error(`Сайт собран, но проверка не прошла: ${problems.join(', ')}`)
console.log(`Собрано и проверено: ${siteTargets.map((target) => target.url).join(', ')}`)
