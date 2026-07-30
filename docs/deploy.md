# Деплой

Два окружения:

| Окружение | Когда выкатывается | Адрес |
| --- | --- | --- |
| `staging` | автоматически на каждый push в `main` | `dev.maderamas.com.ar` |
| `production` | только вручную, с подтверждением | `www.maderamas.com.ar` (после переезда) |

На момент разработки прод занят старым магазином на Tiendanube. Ничего, кроме
поддомена `dev`, мы не трогаем — живой магазин продолжает работать.

## Главное правило

Данные движутся строго в одну сторону по каждому типу:

```
КОД      локалка → git → сервер     (тема и mu-plugins)
КОНТЕНТ  сервер → локалка           (база данных и uploads)
```

Деплой **никогда** не трогает базу данных, `wp-content/uploads`, ядро WordPress
и сторонние плагины. Затереть каталог деплоем физически невозможно.

## Как staging защищён от индексации

Модуль `maderamas-core` принудительно ставит `noindex`, если
`WP_ENVIRONMENT_TYPE` в `wp-config.php` не равен `production`. Признак привязан
к окружению, а не к настройке в базе, поэтому его нельзя случайно переключить
из админки или затереть переносом базы с прода.

Этого достаточно против поисковиков, но сверху всё равно нужен **Basic Auth
на уровне nginx** — иначе недоделанный магазин доступен всем, кто угадает адрес.

## Первичная настройка сервера

Разово, до первого автодеплоя. Ниже — общий сценарий для VPS (пригодится
для прода после переезда). Текущий staging живёт не на VPS, а на шаредхостинге
Hostinger — см. следующий раздел.

1. **VPS.** Ubuntu 24.04. Панель по вкусу — CloudPanel даёт nginx, PHP-FPM,
   MariaDB и Let's Encrypt из коробки.
2. **DNS.** В Route 53 добавить A-запись `dev.maderamas.com.ar` → IP сервера.
   Апекс и `www` не менять.
3. **PHP 8.3**, MariaDB, база и пользователь под сайт.
4. **WP-CLI** — см. <https://wp-cli.org/#installing>.
5. **Скрипт настройки:**

   ```bash
   export DB_NAME=maderamas DB_USER=maderamas DB_PASS='...'
   export SITE_URL=https://dev.maderamas.com.ar
   export ADMIN_USER=roman ADMIN_EMAIL=mr.romanzhan@gmail.com ADMIN_PASS='...'
   export ENV_TYPE=staging
   bash bin/bootstrap-server.sh /var/www/maderamas
   ```

   Скрипт ставит ядро и плагины теми же версиями, что в `.wp-env.json`,
   выставляет аргентинские настройки и структуру URL каталога.
6. **SSL** на поддомен, проверить автопродление.
7. **Basic Auth** на весь сайт, кроме `/wp-admin/admin-ajax.php` (иначе
   отвалится часть функций админки).

## Staging сейчас: Hostinger (шаредхостинг)

Пока `dev.maderamas.com.ar` никуда не смотрит, staging временно живёт на
Hostinger Premium (шаредхостинг), на технический домен вида
`https://<случайное-имя>.hostingersite.com/`. Когда понадобится постоянный
адрес — направить DNS `dev.maderamas.com.ar` на этот аккаунт и сменить
`SITE_URL` через `wp option update siteurl/home`.

Отличия от сценария с VPS:

- **Root нет.** Все настройки — через hPanel или по SSH из-под пользователя
  хостинга. `bin/bootstrap-server.sh` тут не запускают с нуля — WordPress
  уже установлен мастером Hostinger.
- **SSH.** Включается в hPanel → Advanced → SSH Access. Там же — хост, порт
  (обычно не 22) и логин. WP-CLI на Hostinger уже стоит (`wp --info`).
- **wp-config.php уже существует**, поэтому блок создания конфига в
  `bin/bootstrap-server.sh` не сработает — `WP_ENVIRONMENT_TYPE`,
  `DISALLOW_FILE_EDIT` и `DISALLOW_FILE_MODS` дописываются в него руками,
  перед строкой `/* That's all, stop editing! */`:

  ```php
  define( 'WP_ENVIRONMENT_TYPE', 'staging' );
  define( 'DISALLOW_FILE_EDIT', true );
  define( 'DISALLOW_FILE_MODS', true );
  ```

  `WP_ENVIRONMENT_TYPE` обязателен — от него зависит запрет индексации
  в `maderamas-core`.
- После этого `bin/bootstrap-server.sh` можно запустить как есть (он
  идемпотентен): блоки скачивания ядра и создания конфига пропустятся
  сами, а плагины, аргентинские настройки и структура URL — накатятся.
  Значения `DB_*`/`ADMIN_*` при этом можно передать любые непустые —
  скрипт их не использует, если конфиг уже есть, но требует, чтобы
  переменные были заданы.
- **Basic Auth без nginx.** На Hostinger — Apache/LiteSpeed. Либо
  hPanel → Advanced → Password Protect Directories, либо свой `.htaccess`
  с исключением для `/wp-admin/admin-ajax.php`, как на VPS.

## Ключ для деплоя

Отдельный ключ, только под деплой, без пароля:

```bash
ssh-keygen -t ed25519 -C 'github-deploy-maderamas' -f ~/.ssh/maderamas_deploy -N ''
```

Публичную часть — в `~/.ssh/authorized_keys` на сервере.
Приватную — в секрет `DEPLOY_SSH_KEY`.

## Настройка GitHub

**Settings → Secrets and variables → Actions → Variables** (уровень репозитория):

| Имя | Значение |
| --- | --- |
| `DEPLOY_ENABLED` | `true` — мастер-выключатель, без него деплой не идёт |
| `DEPLOY_PORT` | порт SSH, если не 22 |

**Settings → Environments → создать `staging` и `production`.**
Для `production` включить *Required reviewers* — тогда прод нельзя выкатить
без ручного подтверждения.

Секреты в каждом окружении свои:

| Имя | Что это |
| --- | --- |
| `DEPLOY_HOST` | хост сервера |
| `DEPLOY_USER` | пользователь SSH |
| `DEPLOY_PATH` | абсолютный путь до `wp-content` (workflow проверяет, что путь им заканчивается) |
| `DEPLOY_SSH_KEY` | приватный ключ деплоя |

## Что происходит при деплое

1. Проверка, что все секреты окружения заданы, — иначе падаем с внятной ошибкой,
   а не на середине rsync.
2. `npm ci && npm run build` — сборка ассетов темы.
3. Проверка, что сборка не пустая.
4. `rsync` копирует `wp-content/themes/maderamas/` целиком (каталог наш) и
   `wp-content/mu-plugins/` — но точечно, только файлы и папки с префиксом
   `maderamas*`. Managed-хостинги (Hostinger и подобные) кладут в
   `mu-plugins` свои файлы (автообновления, preview-domain и т.п.) — их
   деплой не трогает.

После **первого** деплоя активировать тему:

```bash
wp theme activate maderamas
```

Дальше активация не нужна — файлы просто обновляются.

## Выкатить на прод

Actions → Deploy → Run workflow → `production`. Затем подтвердить в интерфейсе.
Автоматически на прод не выкатывается никогда.

## Ключи Mercado Pago

Плагин хранит ключи в настройках WordPress, то есть в базе. База не
версионируется и не деплоится, поэтому ключи в git не попадают в принципе.

На staging — только sandbox-ключи. Боевые не должны существовать нигде, кроме
прода: ни в дампах базы, которые снимают на локалку, ни в скриншотах.

## Снять контент с сервера на локалку

```bash
# на сервере
wp db export dump.sql
tar czf uploads.tar.gz wp-content/uploads

# локально, после копирования файлов
npm run wp -- db import dump.sql
npm run wp -- search-replace 'https://dev.maderamas.com.ar' 'http://localhost:8888'
```

`search-replace` обязателен — без него ссылки и картинки будут вести на сервер.

## Переезд с Tiendanube

Отдельная задача, не путать с обычным деплоем. Ключевое: структура URL уже
настроена скриптом так, чтобы карточки товаров сохранили адреса
`/productos/<slug>/` один в один. Редиректы понадобятся только для трёх
категорий. Подробности — при подготовке к переключению.
