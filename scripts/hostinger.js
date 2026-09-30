// Панель Hostinger через её API (https://developers.hostinger.com): то, что раньше владелец
// делал руками в hPanel перед запуском, — сайт для домена, записи DNS, сертификат,
// задание планировщика. Ключ — в ~/.claude/secrets/hostinger-api-key (не в проекте).
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const BASE = 'https://developers.hostinger.com'

function apiKey() {
  try {
    return readFileSync(
      resolve(homedir(), '.claude', 'secrets', 'hostinger-api-key'),
      'utf8',
    ).trim()
  } catch {
    throw new Error('Нет ключа API Hostinger: ~/.claude/secrets/hostinger-api-key')
  }
}

export async function hostinger(method, path, body) {
  const response = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      Accept: 'application/json',
      ...(body && { 'Content-Type': 'application/json' }),
    },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })
  const text = await response.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }
  if (!response.ok) {
    throw new Error(`Hostinger ${method} ${path}: ${response.status} ${text.slice(0, 300)}`)
  }
  return data
}

export const wait = (ms) => new Promise((done) => setTimeout(done, ms))

/**
 * Ждать, пока проверка не вернёт истину; между попытками — пауза. Время вышло — ошибка
 * с тем, чего ждали: владелец увидит причину, а не зависшую команду
 */
export async function waitFor(what, check, { every = 15_000, limit = 20 * 60_000 } = {}) {
  const until = Date.now() + limit
  for (;;) {
    if (await check()) return
    if (Date.now() > until) throw new Error(`Не дождался: ${what}`)
    process.stdout.write('.')
    await wait(every)
  }
}
