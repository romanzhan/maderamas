// Перенос магазина на основной домен одной командой: npm run launch
//
// До запуска боевой адрес вёл на Tiendanube, а новый сайт жил на dev с тестовыми ключами.
// Команда делает всё, что на нашей стороне, и в безопасном порядке: сначала проверяет,
// что шаги владельца сделаны (домен смотрит на хостинг, есть https, папка сайта и боевые
// ключи), и только потом что-то меняет. Упала на середине — повторный запуск доделает:
// каждый шаг проверяет, не сделан ли он уже.
//
// Превью и боевой сайт делят один хостинг. Сервер ищет приватную папку вверх от папки
// сайта (бэкенд.md §2), поэтому dev получает свою копию рядом с собой — тестовые ключи
// и тестовые заказы, — а боевой сайт берёт ~/madera-data с боевыми ключами и чистой базой.
import { execSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve4 } from 'node:dns/promises'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const deployPath = resolve(root, 'madera-data', 'deploy.json')
const NODE = '/opt/alt/alt-nodejs22/root/usr/bin/node'
const keysPath = resolve(root, 'mercadopago-prod.txt')

const deploy = JSON.parse(readFileSync(deployPath, 'utf8'))
if (!deploy.prod) throw new Error('В madera-data/deploy.json нет блока prod: { path, url }')
const key = deploy.key.replace(/^~/, homedir())
const prodUrl = deploy.prod.url.replace(/\/$/, '')
const prodHost = new URL(prodUrl).host
const apexHost = prodHost.replace(/^www\./, '')
const devHost = new URL(deploy.url).host

/** Команда на сервере; stdin — то, что уходит ей на вход (секреты не попадают в строку команды) */
function remote(script, input = '') {
  const result = spawnSync(
    'ssh',
    [
      '-i',
      key,
      '-p',
      String(deploy.port),
      '-o',
      'IdentitiesOnly=yes',
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=30',
      `${deploy.user}@${deploy.host}`,
      script,
    ],
    { input, encoding: 'utf8' },
  )
  if (result.status !== 0) throw new Error(`Сервер: ${result.stderr || result.stdout}`.trim())
  return result.stdout.trim()
}

/** Ключи из mercadopago-prod.txt (строки имя=значение; # — комментарий) */
function liveKeys() {
  if (!existsSync(keysPath)) throw new Error('Нет mercadopago-prod.txt с боевыми ключами')
  const pairs = Object.fromEntries(
    readFileSync(keysPath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => /^[a-z_]+=/.test(line))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]),
  )
  return { accessToken: pairs.access_token ?? '', webhookSecret: pairs.webhook_secret ?? '' }
}

const step = (text) => console.log(`\n— ${text}`)
const fail = (problems) => {
  console.error('\nПеренос не начат, ничего не изменено. Сначала:')
  for (const problem of problems) console.error(`  • ${problem}`)
  process.exit(1)
}

// 1. Проверки: всё, что должен сделать владелец, сделано
step('Проверяю, готово ли всё для переноса')
const problems = []

const keys = liveKeys()
if (!keys.accessToken.startsWith('APP_USR-')) {
  problems.push('в mercadopago-prod.txt нет боевого access_token (APP_USR-…)')
}
if (!keys.webhookSecret) {
  problems.push(
    `в mercadopago-prod.txt нет webhook_secret: в кабинете Mercado Pago, приложение «Madera mas tienda», ` +
      `Modo productivo → Webhooks, адрес ${prodUrl}/api/mercadopago/webhook, событие «Pagos» — ` +
      'и вписать выданный секрет строкой webhook_secret=…',
  )
}

const folder = remote(`test -d "$HOME/${deploy.prod.path}" && echo yes || echo no`)
if (folder !== 'yes') {
  problems.push(
    `на сервере нет ~/${deploy.prod.path}: домен не добавлен как сайт в панели Hostinger`,
  )
} else {
  // Проверка на деле, а не по записям DNS: адреса CDN хостинга у разных доменов разные.
  // Файл с уникальным содержимым кладётся в папку боевого сайта и читается по обоим
  // адресам через https — пришёл он, значит домен, сертификат и папка сходятся.
  // Заливка потом сносит его вместе со всем лишним
  const probe = `lanzamiento-${Date.now()}.txt`
  const token = randomUUID()
  remote(`cat > "$HOME/${deploy.prod.path}/${probe}"`, token)
  for (const host of [prodHost, apexHost]) {
    const body = await fetch(`https://${host}/${probe}`, { signal: AbortSignal.timeout(20_000) })
      .then((response) => response.text())
      .catch((error) => `ошибка: ${error.cause?.code ?? error.message}`)
    if (!body.includes(token)) {
      const ips = (await resolve4(host).catch(() => [])).join(', ') || 'ничего'
      problems.push(
        `https://${host} не отдаёт наш сервер (DNS указывает на ${ips}; ${body.slice(0, 60)}): ` +
          'проверить записи DNS @ и www и сертификат SSL в панели Hostinger',
      )
    }
  }
  remote(`rm -f "$HOME/${deploy.prod.path}/${probe}"`)
}

if (problems.length) fail(problems)
console.log('Всё на месте')

// 2. Сервер: копия, отдельная папка превью, боевые ключи и чистая база
step('Разделяю превью и боевой сайт на сервере')
const devData = `$HOME/domains/${devHost}/madera-data`
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
remote(
  [
    'set -e',
    'mkdir -p "$HOME/backups"',
    `tar -C "$HOME" -czf "$HOME/backups/madera-data-antes-del-lanzamiento-${stamp}.tgz" madera-data`,
    // Превью забирает нынешнюю папку целиком: тестовые ключи и тестовые заказы остаются с ним
    `if [ ! -d "${devData}" ]; then cp -a "$HOME/madera-data" "${devData}"; chmod 700 "${devData}"; fi`,
  ].join(' && '),
)

// Ключи уходят на вход php, а не в строку команды: строки команд видны в списке процессов
const writeKeys = [
  '$in = json_decode(stream_get_contents(STDIN), true);',
  '$file = getenv("HOME") . "/madera-data/config.php";',
  '$c = require $file;',
  '$c["mercadopago"]["accessToken"] = $in["accessToken"];',
  '$c["mercadopago"]["webhookSecret"] = $in["webhookSecret"];',
  '$c["mercadopago"]["enabled"] = true;',
  'file_put_contents($file, "<?php\\n\\nreturn " . var_export($c, true) . ";\\n");',
  'chmod($file, 0600);',
].join(' ')
remote(
  [
    'set -e',
    'cd "$HOME/madera-data"',
    // Тестовые заказы боевому сайту не нужны: база уезжает в копию, сервер создаст новую
    `if [ ! -f .lanzado ]; then for f in orders.sqlite orders.sqlite-wal orders.sqlite-shm; do ` +
      `if [ -f "$f" ]; then mv "$f" "$HOME/backups/$f-prueba-${stamp}"; fi; done; touch .lanzado; fi`,
    `php -r '${writeKeys}'`,
  ].join(' && '),
  JSON.stringify(keys),
)
console.log('Готово: копия в ~/backups, превью на тестовых ключах, боевой сайт — на боевых')

// 3. Боевой сайт — вторая цель сборщика (бэкенд.md §15): с этого момента и публикация,
// и правки в админке собирают оба сайта. Дальше обычная публикация со своими проверками
step('Собираю и заливаю боевой сайт')
remote(
  `${NODE} -e '
    const fs = require("fs")
    const file = process.env.HOME + "/madera-build/targets.json"
    const targets = JSON.parse(fs.readFileSync(file, "utf8"))
    if (!targets.some((t) => t.name === "prod")) {
      targets.push({ name: "prod", path: process.argv[1], url: process.argv[2], preview: false })
    }
    fs.writeFileSync(file, JSON.stringify(targets, null, 2))
  ' "${deploy.prod.path}" "${prodUrl}"`,
)
execSync('node scripts/deploy.js', { cwd: root, stdio: 'inherit' })

// 4. Один адрес магазина: голый домен и http уводят на https://www
step('Проверяю перенаправления')
const redirectProblems = []
for (const from of [
  `http://${apexHost}/sillas/`,
  `https://${apexHost}/sillas/`,
  `http://${prodHost}/sillas/`,
]) {
  const response = await fetch(from, {
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null)
  const to = response?.headers.get('location') ?? ''
  console.log(`${response?.status ?? 0} ${from} → ${to}`)
  if (response?.status !== 301 || to !== `${prodUrl}/sillas/`) redirectProblems.push(from)
}
if (redirectProblems.length) {
  throw new Error(`Сайт залит, но перенаправления не работают: ${redirectProblems.join(', ')}`)
}

console.log(`
Магазин открыт: ${prodUrl}

Осталось руками:
  1. Один настоящий платёж на минимальную сумму — и проверить письмо и заказ в /admin/.
  2. Планировщик Hostinger: копия базы раз в сутки теперь с боевого сайта —
     php ~/${deploy.prod.path}/api/cli.php backup
  3. Google Search Console: добавить ${prodUrl} и отправить ${prodUrl}/sitemap.xml
`)
