// Перенос магазина на основной домен одной командой: npm run launch
// (npm run launch -- --sin-webhook — без секрета уведомлений Mercado Pago; см. шаг 1)
//
// До запуска боевой адрес вёл на Tiendanube, а новый сайт жил на dev с тестовыми ключами.
// Команда делает всё, что на нашей стороне, и в безопасном порядке: сначала проверяет,
// что шаги владельца сделаны (домен смотрит на хостинг, есть https, папка сайта и боевые
// ключи), и только потом что-то меняет. Упала на середине — повторный запуск доделает:
// каждый шаг проверяет, не сделан ли он уже.
//
// С 30.09.2026 панель хостинга команда готовит сама через API Hostinger (scripts/hostinger.js):
// сайт для домена, записи DNS @ и www (почтовые записи не трогаются), сертификат и суточная
// копия базы в планировщике. Руками у владельца остались только кабинет Mercado Pago
// и Search Console.
//
// Превью и боевой сайт делят один хостинг. Сервер ищет приватную папку вверх от папки
// сайта (бэкенд.md §2), поэтому dev получает свою копию рядом с собой — тестовые ключи
// и тестовые заказы, — а боевой сайт берёт ~/madera-data с боевыми ключами и чистой базой.
import { execSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve4 } from 'node:dns/promises'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { hostinger, waitFor } from './hostinger.js'

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
const backupsDir = resolve(root, 'madera-data', 'backups')

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

// Без секрета уведомлений заказ узнаёт об оплате, только когда покупатель вернулся
// на «Gracias»: уведомления Mercado Pago сервер без подписи не принимает. Запуск без него —
// осознанное решение владельца, поэтому отдельным флагом, а не молча
const withoutWebhook = process.argv.includes('--sin-webhook')

const step = (text) => console.log(`\n— ${text}`)
const fail = (problems) => {
  console.error('\nПеренос не начат, ничего не изменено. Сначала:')
  for (const problem of problems) console.error(`  • ${problem}`)
  process.exit(1)
}

// 1. Проверки — до любых изменений: без боевых ключей DNS не переключается, иначе
// адрес магазина остался бы без магазина
step('Проверяю, готово ли всё для переноса')
const problems = []

const keys = liveKeys()
if (!keys.accessToken.startsWith('APP_USR-')) {
  problems.push('в mercadopago-prod.txt нет боевого access_token (APP_USR-…)')
}
if (!keys.webhookSecret && withoutWebhook) {
  console.log(
    'Внимание: без секрета уведомлений. Оплата отметится в заказе, когда покупатель вернётся ' +
      'на страницу «Gracias»; секрет — строкой webhook_secret=… и повторный npm run launch',
  )
} else if (!keys.webhookSecret) {
  problems.push(
    `в mercadopago-prod.txt нет webhook_secret: в кабинете Mercado Pago, приложение «Madera mas tienda», ` +
      `Modo productivo → Webhooks, адрес ${prodUrl}/api/mercadopago/webhook, событие «Pagos» — ` +
      'и вписать выданный секрет строкой webhook_secret=… ' +
      '(или запуск без него: npm run launch -- --sin-webhook)',
  )
}

if (problems.length) fail(problems)

// 0. Панель хостинга. Каждый шаг смотрит, не сделан ли он уже: повторный запуск безопасен
step('Готовлю хостинг: сайт для домена')
const zonePath = `/api/dns/v1/zones/${apexHost}`
const sites = (await hostinger('GET', '/api/hosting/v1/websites')).data
if (!sites.some((site) => site.domain === apexHost)) {
  const dev = sites.find((site) => site.domain === devHost)
  if (!dev)
    throw new Error(
      `В аккаунте Hostinger нет сайта ${devHost} — не понимаю, на какой тариф ставить`,
    )
  // Домен мог быть припаркован на сайте превью (так его завели в июле): пока он там,
  // отдельный сайт хостинг не создаёт. Снятие парковки удаляет и зону DNS целиком
  // (выяснилось 30.09.2026 — вместе с ней ушла почта), поэтому зона сначала сохраняется,
  // а после создания сайта её записи возвращаются из копии (ниже)
  const parkedPath = `/api/hosting/v1/accounts/${deploy.user}/websites/${devHost}/parked-domains`
  const parked = await hostinger('GET', parkedPath)
  if ((parked?.data ?? parked).some((item) => item.domain === apexHost)) {
    const before = await hostinger('GET', zonePath)
    writeFileSync(
      resolve(backupsDir, `dns-${apexHost}-${Date.now()}.json`),
      JSON.stringify(before, null, 2),
    )
    await hostinger('DELETE', `${parkedPath}/${apexHost}`)
    console.log(`Парковка ${apexHost} на ${devHost} снята (копия зоны DNS в madera-data/backups)`)
  }
  await hostinger('POST', '/api/hosting/v1/websites', { domain: apexHost, order_id: dev.order_id })
  process.stdout.write(`Сайт ${apexHost} заведён, жду его папку на сервере`)
  await waitFor(
    'папка сайта на сервере',
    () => remote(`test -d "$HOME/${deploy.prod.path}" && echo yes || echo no`) === 'yes',
  )
  console.log(' есть')
}

// Зона DNS из копии: всё, кроме адресов сайта (@ и www — их ставит шаг переключения ниже).
// Нужна, если зона пропала вместе с парковкой: без неё у магазина нет почты
const savedZones = readdirSync(backupsDir).filter((name) => name.startsWith(`dns-${apexHost}-`))
if (savedZones.length) {
  const saved = JSON.parse(readFileSync(resolve(backupsDir, savedZones.sort().at(-1)), 'utf8'))
  const current = await hostinger('GET', zonePath).catch(() => [])
  const missing = saved.filter(
    (record) =>
      !(record.name === '@' && record.type === 'A') &&
      record.name !== 'www' &&
      !current.some((kept) => kept.name === record.name && kept.type === record.type),
  )
  if (missing.length) {
    await hostinger('PUT', zonePath, {
      overwrite: true,
      zone: missing.map(({ name, type, ttl, records }) => ({
        name,
        type,
        ttl,
        records: records.map(({ content }) => ({ content })),
      })),
    })
    console.log(`DNS: записи из копии возвращены — ${missing.length} (почта и подписи)`)
  }
}

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
// и правки в админке собирают оба сайта. Собирается ДО переключения DNS: адрес ещё ведёт
// на Tiendanube, а в папке уже лежит готовый магазин — окна с пустой заглушкой хостинга нет
step('Собираю боевой сайт в его папку')
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
remote(`bash "$HOME/madera-build/scripts/server-build.sh" --force`)

step('Переключаю домен на хостинг')
// Создавая сайт, хостинг сам ставит в зону свою сеть доставки: ALIAS для @ и CNAME для www
// на *.cdn.hstgr.net, с её сертификатом (так вышло 30.09.2026). Тогда трогать нечего.
// Прямые записи на сервер ставятся, только если домен смотрит мимо хостинга (Tiendanube)
const serverIp = deploy.host
const zone = await hostinger('GET', zonePath)
const pointsHere = (name) =>
  zone
    .filter((record) => record.name === name && ['A', 'ALIAS', 'CNAME'].includes(record.type))
    .flatMap((record) => record.records.map((item) => item.content))
    .some((content) => content.includes('hstgr.net') || content === serverIp)
if (!pointsHere('@') || !pointsHere('www')) {
  await hostinger('PUT', zonePath, {
    overwrite: true,
    zone: [
      { name: '@', type: 'A', ttl: 300, records: [{ content: serverIp }] },
      { name: 'www', type: 'CNAME', ttl: 300, records: [{ content: `${apexHost}.` }] },
    ],
  })
  console.log(`DNS: ${apexHost} → ${serverIp}, www → ${apexHost} (почта не тронута)`)
}

// Готово, когда оба адреса отвечают по https с верным сертификатом. Сертификат выпускает
// хостинг: сеть доставки — сама, прямой сервер — по запросу (ssl/setup)
const answers = async (host) =>
  fetch(`https://${host}/`, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })
    .then((response) => response.status < 500)
    .catch(() => false)
if (!(await answers(apexHost)) || !(await answers(prodHost))) {
  const sslPath = `/api/hosting/v1/accounts/${deploy.user}/websites/${apexHost}/ssl`
  const status = await hostinger('GET', `${sslPath}/status`).catch(() => null)
  const state = status?.data?.status ?? status?.status
  if (!['active', 'installing', 'waiting_for_retry'].includes(state)) {
    await hostinger('POST', `${sslPath}/setup`).catch(() => null)
  }
  process.stdout.write('Жду, пока домен ответит по https')
  await waitFor(
    'https по адресу магазина',
    async () => (await answers(apexHost)) && (await answers(prodHost)),
  )
  console.log(' готово')
}

// Сайт на месте: домен, сертификат и папка сходятся?
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

// Здесь DNS уже переключён — «ничего не изменено» было бы неправдой
if (problems.length)
  throw new Error(`Хостинг готов, но сайт по адресу не отвечает: ${problems.join('; ')}`)
console.log('Всё на месте')

// Обычная публикация со своими проверками адресов — теперь и боевого
step('Публикую и проверяю адреса')
execSync('node scripts/deploy.js', { cwd: root, stdio: 'inherit' })

// 4. Один адрес магазина: голый домен и http уводят на https://www
step('Проверяю перенаправления')
const redirectProblems = []
for (const from of [
  `http://${apexHost}/sillas/`,
  `https://${apexHost}/sillas/`,
  `http://${prodHost}/sillas/`,
]) {
  // Цепочка до двух шагов: сеть доставки хостинга сама уводит http на https, а на www
  // уводит уже наш .htaccess — http://голый.домен доходит до цели за два постоянных перехода
  let url = from
  let ok = false
  for (let hop = 0; hop < 2 && !ok; hop++) {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null)
    const to = response?.headers.get('location') ?? ''
    console.log(`${response?.status ?? 0} ${url} → ${to}`)
    if (response?.status !== 301) break
    ok = to === `${prodUrl}/sillas/`
    url = to
  }
  if (!ok) redirectProblems.push(from)
}
if (redirectProblems.length) {
  throw new Error(`Сайт залит, но перенаправления не работают: ${redirectProblems.join(', ')}`)
}

// 5. Суточная копия базы заказов — теперь с боевого сайта (бэкенд.md §12)
const backupCommand = `php /home/${deploy.user}/${deploy.prod.path}/api/cli.php backup`
const cronPath = `/api/hosting/v1/accounts/${deploy.user}/cron-jobs`
const jobs = await hostinger('GET', cronPath)
if (!(jobs?.data ?? jobs).some((job) => job.command === backupCommand)) {
  await hostinger('POST', cronPath, { time: '30 3 * * *', command: backupCommand })
  console.log('Планировщик: копия базы каждую ночь в 03:30')
}

console.log(`
Магазин открыт: ${prodUrl}

Осталось:
  1. Один настоящий платёж на минимальную сумму — и проверить письмо и заказ в /admin/.
  2. Google Search Console: добавить ${prodUrl} и отправить ${prodUrl}/sitemap.xml${
    keys.webhookSecret
      ? ''
      : `
  3. Секрет уведомлений Mercado Pago: вписать webhook_secret=… в mercadopago-prod.txt
     и повторить npm run launch — остальные шаги он пропустит как сделанные`
  }
`)
