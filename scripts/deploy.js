// Заливка сайта на хостинг с рабочей машины. Запуск: npm run deploy — превью на dev,
// npm run deploy:prod — боевой сайт (публикация.mjs после запуска зовёт оба).
//
// До 21.09.2026 это делал GitHub Actions; владелец отказался платить GitHub, и та же
// цепочка — сборка с PREVIEW=1, проверка сборки, заливка с удалением лишнего, проверка
// адресов — живёт теперь здесь. rsync на этой машине нет, поэтому файлы уезжают одним
// tar-потоком по ssh в промежуточную папку, а rsync --delete делает уже сервер: в папке
// сайта остаётся ровно сборка, а ~/madera-data деплой не трогает (бэкенд.md §2).
//
// Куда и каким ключом — madera-data/deploy.json (не в git): host, port, user, path, key, url;
// боевой сайт — блок prod: { path, url } с тем же ssh-доступом. Превью и боевая сборка
// различаются только закрытостью от поиска (seo.js) — остальное одно и то же.
import { execSync, spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const configPath = resolve(root, 'madera-data', 'deploy.json')
if (!existsSync(configPath)) {
  throw new Error('Нет madera-data/deploy.json (host, port, user, path, key, url) — заливать некуда')
}
const target = process.argv[2] ?? 'dev'
if (!['dev', 'prod'].includes(target)) throw new Error(`Неизвестная цель «${target}»: dev или prod`)
const prod = target === 'prod'

const base = JSON.parse(readFileSync(configPath, 'utf8'))
if (prod && !base.prod) throw new Error('В madera-data/deploy.json нет блока prod: { path, url }')
const cfg = prod ? { ...base, ...base.prod } : base
const key = cfg.key.replace(/^~/, homedir())
const dist = resolve(root, 'dist')

// 1. Сборка: превью закрыто от поиска и без карты сайта, боевая — открыта (seo.md п. 9)
const env = { ...process.env }
if (prod) delete env.PREVIEW
else env.PREVIEW = '1'
execSync('npm run build', { cwd: root, stdio: 'inherit', env })

// 2. Сборка на месте — те же проверки, что делал деплой на GitHub
const nonEmpty = (file) => existsSync(join(dist, file)) && statSync(join(dist, file)).size > 0
for (const [file, what] of [
  ['index.html', 'главной страницы'],
  ['.htaccess', 'правил сервера'],
  ['api/index.php', 'сервера заказов'],
  ['api/runtime.json', 'runtime.json для сервера'],
]) {
  if (!nonEmpty(file)) throw new Error(`В сборке нет ${what} (dist/${file})`)
}
const pages = readdirSync(dist, { recursive: true }).filter((f) => /(^|[\\/])index\.html$/.test(f)).length
console.log(`Страниц в сборке: ${pages}`)
if (pages < 30) throw new Error('Страниц меньше, чем должно быть')

// 3. Заливка: tar-поток → промежуточная папка на сервере → rsync --delete в папку сайта
const remote = [
  'set -e',
  'stage=$HOME/deploy-stage',
  'rm -rf "$stage" && mkdir -p "$stage"',
  'tar -C "$stage" -xf -',
  `rsync -a --delete --chmod=D755,F644 "$stage/" "$HOME/${cfg.path}/"`,
  'rm -rf "$stage"',
].join(' && ')

const upload = () =>
  new Promise((done, fail) => {
    const tar = spawn('tar', ['-C', dist, '-cf', '-', '.'], { stdio: ['ignore', 'pipe', 'inherit'] })
    const ssh = spawn(
      'ssh',
      ['-i', key, '-p', String(cfg.port), '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=30', `${cfg.user}@${cfg.host}`, remote],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    )
    tar.stdout.pipe(ssh.stdin)
    tar.on('error', fail)
    ssh.on('error', fail)
    ssh.on('close', (code) => (code === 0 ? done() : fail(new Error(`ssh завершился с кодом ${code}`))))
  })

let uploaded = false
for (let attempt = 1; attempt <= 3 && !uploaded; attempt++) {
  try {
    await upload()
    uploaded = true
  } catch (error) {
    console.error(`Попытка ${attempt} не прошла: ${error.message}`)
    if (attempt < 3) await new Promise((wake) => setTimeout(wake, 60_000))
  }
}
if (!uploaded) throw new Error('Хостинг не принял заливку за три попытки')

// 4. Проверка живого сайта: страницы, 404, сервер заказов; у превью — закрытость
// от поиска, у боевого — наоборот открытость и карта сайта
const site = cfg.url.replace(/\/$/, '')
const status = async (path, init) => {
  try {
    return (await fetch(site + path, { redirect: 'manual', signal: AbortSignal.timeout(20_000), ...init })).status
  } catch {
    return 0
  }
}
const problems = []
for (const path of ['/', '/sillas/', '/sillas/silla-evolutiva/', '/carrito/', '/checkout/', '/blog/', '/contacto/']) {
  const code = await status(path)
  console.log(`${code} ${path}`)
  if (code !== 200) problems.push(path)
}
if ((await status('/no-existe-xyz/')) !== 404) problems.push('своя страница 404')
const health = await fetch(`${site}/api/health`, { signal: AbortSignal.timeout(20_000) }).then((r) => r.text()).catch(() => '')
if (!health.includes('"ok":true')) problems.push('/api/health')
if ((await status('/api/runtime.json')) === 200) problems.push('runtime.json открыт снаружи')
const robots = await fetch(`${site}/robots.txt`, { signal: AbortSignal.timeout(20_000) }).then((r) => r.text()).catch(() => '')
const head = await fetch(`${site}/`, { method: 'HEAD', signal: AbortSignal.timeout(20_000) }).catch(() => null)
const noindex = /noindex/i.test(head?.headers.get('x-robots-tag') ?? '')
if (prod) {
  if (/^Disallow: \/$/m.test(robots)) problems.push('robots.txt закрывает боевой сайт')
  if (noindex) problems.push('боевой сайт отдаёт X-Robots-Tag: noindex')
  if ((await status('/sitemap.xml')) !== 200) problems.push('нет sitemap.xml')
} else {
  if (!/^Disallow: \/$/m.test(robots)) problems.push('robots.txt не закрывает превью')
  if (!noindex) problems.push('нет заголовка X-Robots-Tag: noindex')
}

if (problems.length) throw new Error(`Сайт залит, но проверка не прошла: ${problems.join(', ')}`)
console.log(`Залито и проверено: ${site}`)
