// Состояние сборки на хостинге для админки (бэкенд.md §15): scripts/server-build.sh
// зовёт его на каждом шаге. Запуск: node build-status.js <файл состояния> <state> <журнал>
// state: building | ok | error. У ошибки в сообщение уходит хвост журнала — в нём
// строка проверки данных, по которой владелец поймёт, что поправить.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const [file, state, log] = process.argv.slice(2)
const now = new Date().toISOString().slice(0, 19) + 'Z'
const previous = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}

// Строки npm и сборщика бесполезны владельцу; ошибки проверки данных начинаются
// с «Ошибка»/«Товар»/«Статья» и т. п. — берём последние содержательные строки
const tail = () =>
  (existsSync(log) ? readFileSync(log, 'utf8') : '')
    .split(/\r?\n/)
    .filter((line) => line.trim() && !/^(>|npm |\s+at |node:)/.test(line))
    .slice(-12)
    .join('\n')

const status = {
  state,
  startedAt: state === 'building' ? now : (previous.startedAt ?? now),
  finishedAt: state === 'building' ? null : now,
  message: state === 'error' ? tail() : '',
}

writeFileSync(file, JSON.stringify(status, null, 2) + '\n')
