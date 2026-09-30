#!/bin/bash
# Сборщик на хостинге (бэкенд.md §15). Лежит в ~/madera-build/scripts вместе с кодом сайта;
# планировщик панели Hostinger запускает его раз в минуту, публикация с рабочей машины —
# сразу, с --force. Без флага ~/madera-content/.pending (правка из админки) и без --force
# выходит сразу: минутный запуск ничего не стоит.
#
# Порядок: данные и исходники из ~/madera-content → конвейер картинок → для каждой цели
# из targets.json сборка и заливка в папку сайта. Упала проверка данных или сборка —
# сайт остаётся прежним (заливка идёт только после удачной сборки), а в build-status.json
# уходит хвост журнала: его показывает админка.
set -u

NODE_DIR=/opt/alt/alt-nodejs22/root/usr/bin
export PATH="$NODE_DIR:/usr/local/bin:/usr/bin:/bin"
# Сборщик Vite открывает по потоку на ядро (их на сервере 48), а лимит процессов
# хостинга столько не даёт — сборка падала. Двух потоков хватает: ~25 секунд
export RAYON_NUM_THREADS=2 UV_THREADPOOL_SIZE=2
CONTENT="$HOME/madera-content"
BUILD="$HOME/madera-build"
LOG="$BUILD/build.log"

# Одна сборка за раз: минутный запуск не должен наложиться на идущую сборку
exec 9>"$HOME/.madera-build.lock"
flock -n 9 || exit 0

if [ "${1:-}" != "--force" ] && [ ! -f "$CONTENT/.pending" ]; then
  exit 0
fi
# Флаг снимается до сборки: правка, пришедшая во время сборки, поставит его снова
rm -f "$CONTENT/.pending"

status() { node "$BUILD/scripts/build-status.js" "$CONTENT/build-status.json" "$1" "$LOG"; }
: >"$LOG"
status building
cd "$BUILD" || exit 1

fail() {
  echo "$1" >>"$LOG"
  status error
  # Публикация с рабочей машины ждёт код выхода; минутному запуску он безразличен
  exit 1
}

{
  # Данные: всё из data/ контента, кроме манифеста — его пишет конвейер ниже.
  # Код (provinces.json, описания) в data/ сборщика остаётся как был
  rsync -a --exclude images.json "$CONTENT/data/" "$BUILD/data/" &&
    rsync -a --delete "$CONTENT/images-source/" "$BUILD/images-source/"
} >>"$LOG" 2>&1 || fail 'Не удалось взять данные из ~/madera-content'

timeout 900 node scripts/images.js >>"$LOG" 2>&1 || fail 'Конвейер картинок не прошёл'
# Админке нужен свежий список картинок с превью
cp "$BUILD/data/images.json" "$CONTENT/data/images.json"

# Цели: dev всегда, боевой сайт — после запуска (scripts/launch.js дописывает его).
# Список — в переменную, не через <(...): на хостинге нет /dev/fd, и подстановка молча
# давала пустой список, то есть «сборку» без сборки
targets=$(node -e '
  for (const t of require(process.argv[1])) console.log([t.name, t.path, t.preview].join("\t"))
' "$BUILD/targets.json" 2>>"$LOG") && [ -n "$targets" ] || fail 'Не прочитался список целей targets.json'

while IFS=$'\t' read -r name path preview; do
  echo "== $name" >>"$LOG"
  if [ "$preview" = "true" ]; then
    PREVIEW=1 timeout 900 npm run build </dev/null >>"$LOG" 2>&1 || fail "Сборка «$name» не прошла"
  else
    env -u PREVIEW timeout 900 npm run build </dev/null >>"$LOG" 2>&1 || fail "Сборка «$name» не прошла"
  fi
  rsync -a --delete --chmod=D755,F644 "$BUILD/dist/" "$HOME/$path/" >>"$LOG" 2>&1 ||
    fail "Заливка «$name» не прошла"
done <<<"$targets"

status ok
