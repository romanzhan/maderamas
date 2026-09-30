#!/bin/bash
# Ночные копии всего, что нельзя пересобрать из кода (бэкенд.md §10, владелец 30.09.2026:
# «чтобы при редеплоях ничего не девалось и всегда можно было вернуться»). Запускает
# планировщик хостинга в 03:30. Копии — в ~/madera-data/backups (папка 700, файлы 600):
#   orders-ДАТА.sqlite, config-ДАТА.php — база заказов и ключи (cli.php backup);
#   content-ДАТА.tgz — всё из админки: тексты, товары, настройки, история версий,
#                      корзина удалённых файлов (без исходников фото — они ниже);
#   logs-ДАТА.tgz    — журналы API: входы в админку, решения, оплаты, письма;
#   images-ДАТА.tar  — исходники фото и видео, раз в неделю (воскресенье): они большие
#                      и меняются редко;
#   SHA256SUMS-ДАТА  — отпечатки файлов этой ночи: подмену копии задним числом видно.
# Хранятся 30 дней, фото — 4 недели. С рабочей машины копии забирает npm run backup:pull.
set -uo pipefail

BACKUPS="$HOME/madera-data/backups"
DAY=$(date -u +%F)
LOG="$HOME/madera-data/logs/backup.log"
mkdir -p "$BACKUPS" && chmod 700 "$BACKUPS"
umask 077

log() { echo "$(date -u +%FT%TZ) $*" >>"$LOG"; }
failed=0

# База — средствами SQLite (живой файл может быть на середине записи), и конфиг
php "$HOME/domains/maderamas.com.ar/public_html/api/cli.php" backup >>"$LOG" 2>&1 || {
  log 'ОШИБКА: копия базы'
  failed=1
}

tar -C "$HOME" --exclude='madera-content/images-source' -czf "$BACKUPS/content-$DAY.tgz" madera-content 2>>"$LOG" || {
  log 'ОШИБКА: копия контента'
  failed=1
}

tar -C "$HOME/madera-data" -czf "$BACKUPS/logs-$DAY.tgz" logs 2>>"$LOG" || {
  log 'ОШИБКА: копия журналов'
  failed=1
}

if [ "$(date -u +%u)" = 7 ] || ! ls "$BACKUPS"/images-*.tar >/dev/null 2>&1; then
  tar -C "$HOME/madera-content" -cf "$BACKUPS/images-$DAY.tar" images-source 2>>"$LOG" || {
    log 'ОШИБКА: копия фото'
    failed=1
  }
fi

chmod 600 "$BACKUPS"/* 2>/dev/null
(cd "$BACKUPS" && sha256sum ./*-"$DAY".* >"SHA256SUMS-$DAY" 2>>"$LOG")

find "$BACKUPS" -maxdepth 1 \( -name 'content-*.tgz' -o -name 'logs-*.tgz' -o -name 'SHA256SUMS-*' \) -mtime +30 -delete
find "$BACKUPS" -maxdepth 1 -name 'images-*.tar' -mtime +28 -delete

[ "$failed" = 0 ] && log "копии $DAY готовы" || log "копии $DAY — с ошибками, см. выше"
exit "$failed"
