import { readdirSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import handlebars from 'vite-plugin-handlebars'
import { pageContext } from './scripts/page-context.js'
import {
  articleUrl,
  concat,
  date,
  dateLong,
  eq,
  formPattern,
  image,
  moneyNet,
  or,
  paragraphs,
  productUrl,
  t,
  video,
} from './scripts/data.js'
import { decimal, money } from './src/scripts/format.js'

const projectRoot = dirname(fileURLToPath(import.meta.url))
const pagesRoot = resolve(projectRoot, 'src/pages')
const partialDirectories = [
  resolve(projectRoot, 'src/blocks'),
  resolve(projectRoot, 'src/components'),
]

// Входы не перечисляются руками: путь файла внутри src/pages = путь URL
const pageEntries = readdirSync(pagesRoot, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.html'))
  .map((file) => resolve(pagesRoot, file))

// Стили и скрипты лежат выше корня страниц: в dev их отдаёт /@fs, в сборке — путь
// относительно самой страницы (у вложенных страниц он другой).
const toUrlPath = (path) => path.split(sep).join('/')

function assetUrl(pagePath, file, isDev) {
  const target = resolve(projectRoot, file)
  if (isDev) return `/@fs/${toUrlPath(target)}`
  return toUrlPath(relative(dirname(resolve(pagesRoot, `.${pagePath}`)), target))
}

export default ({ command }) => {
  const isDev = command === 'serve'

  return {
    root: pagesRoot,
    publicDir: resolve(projectRoot, 'public'),
    build: {
      outDir: resolve(projectRoot, 'dist'),
      emptyOutDir: true,
      rollupOptions: { input: pageEntries },
    },
    server: {
      fs: { allow: [projectRoot] },
      // Сервер заказов на рабочей машине живёт во встроенном сервере PHP (`npm run api`,
      // бэкенд.md §9); dev-сервер передаёт ему /api, чтобы чекаут ходил на настоящий
      // сервер с того же адреса, что и на хостинге. Заголовок Host не подменяется:
      // сервер сверяет его с Origin страницы (бэкенд.md §7 п. 4), а короткая строковая
      // форма настройки подменяла бы его молча
      proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } },
    },
    plugins: [
      tailwindcss(),
      handlebars({
        partialDirectory: partialDirectories,
        context: (pagePath) => ({
          ...pageContext(pagePath),
          assets: {
            styles: assetUrl(pagePath, 'src/styles/main.css', isDev),
            script: assetUrl(pagePath, 'src/scripts/main.js', isDev),
          },
        }),
        helpers: {
          t,
          money,
          decimal,
          moneyNet,
          image,
          productUrl,
          articleUrl,
          concat,
          formPattern,
          date,
          dateLong,
          eq,
          or,
          paragraphs,
          video,
        },
      }),
      // Блоки, компоненты и данные лежат выше корня Vite, поэтому в наблюдение
      // dev-сервера сами не попадают, а сверка путей внутри vite-plugin-handlebars
      // не переживает виндовые обратные слеши. Чужой код не патчим (принцип 33) —
      // следим рядом. Данные тут так же важны, как разметка: владелец правит цену
      // или добавляет статью и должен увидеть это сразу, а не после перезапуска
      // (27.08.2026: из-за этого на экране висели три статьи вместо шести).
      {
        name: 'reload-on-source-change',
        configureServer(server) {
          server.watcher.add([...partialDirectories, resolve(projectRoot, 'data')])
        },
        handleHotUpdate({ file, server }) {
          if (file.endsWith('.hbs') || file.endsWith('.json')) {
            server.hot.send({ type: 'full-reload' })
            return []
          }
        },
      },
    ],
  }
}
