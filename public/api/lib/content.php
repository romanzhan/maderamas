<?php

declare(strict_types=1);

// Админка контента (бэкенд.md §15): чтение и сохранение данных сайта, загрузка фото,
// история версий и состояние публикации. Данные — те же JSON-файлы, из которых
// собирается сайт; после запуска их хранит сервер (~/madera-content), а сборщик
// (scripts/server-build.sh) пересобирает сайт, когда видит флаг .pending.
//
// Проверка по существу (цены, ссылки между товарами, картинки) — у сборки
// (scripts/validate-data.js): одна проверка на все пути правки. Здесь — только то,
// без чего файл сломал бы саму админку или код сайта: тип корня, уникальные id,
// неизменный набор ключей там, где ключи читает код (тексты и настройки).

// Имя в адресе → файл относительно папки контента и вид корня
const CONTENT_COLLECTIONS = [
    'products' => ['data/products.json', 'list'],
    'categories' => ['data/categories.json', 'list'],
    'articles' => ['data/articles.json', 'list'],
    'activities' => ['data/activities.json', 'list'],
    'pages' => ['data/pages.json', 'list'],
    'faq' => ['data/faq.json', 'list'],
    'reviews' => ['data/reviews.json', 'list'],
    'instagram' => ['data/instagram.json', 'list'],
    'site' => ['data/site.config.json', 'object'],
    'texts' => ['data/dictionaries/es.json', 'object'],
];

// Потоки конвейера картинок (scripts/images.js): имя → папка исходников и что принимаем
const CONTENT_UPLOAD_FLOWS = [
    'product' => ['dir' => 'products', 'types' => ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp']],
    'content' => ['dir' => 'content', 'types' => ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp']],
    'social' => ['dir' => 'instagram', 'types' => ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp']],
    'og' => ['dir' => 'og', 'types' => ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp']],
    'video' => ['dir' => 'video', 'types' => ['video/mp4' => 'mp4']],
];

const CONTENT_BODY_LIMIT = 2 * 1024 * 1024;
const CONTENT_JSON_DEPTH = 32;
// Снимок до каждой правки; старше этого числа — удаляются: откат нужен на дни, не на годы
const CONTENT_HISTORY_KEEP = 60;
const CONTENT_UPLOAD_LIMIT = 40 * 1024 * 1024;
const CONTENT_VIDEO_LIMIT = 120 * 1024 * 1024;
// Id — тот же формат, что у имён исходников картинок и id в данных
const CONTENT_ID_PATTERN = '/^[a-z0-9]+(?:-[a-z0-9]+)*$/';

/**
 * Папка контента: из настройки content.dir или поиском вверх, как madera-data. На сервере
 * это ~/madera-content — одна на превью и боевой сайт, иначе правка в админке одного
 * из них не дошла бы до другого. На рабочей машине — корень проекта (data/ и
 * images-source/ лежат там же).
 */
function contentDir(): string
{
    static $found = null;
    if ($found !== null) {
        return $found;
    }

    $configured = (string) (config()['content']['dir'] ?? '');
    if ($configured !== '') {
        if (!is_dir($configured . '/data')) {
            throw new RuntimeException('content.dir в config.php не указывает на папку с data/');
        }
        return $found = rtrim($configured, '/\\');
    }

    $dir = realpath(API_DIR);
    for ($depth = 0; $depth < DATA_DIR_SEARCH_DEPTH && $dir !== false; $depth++) {
        if (is_dir($dir . DIRECTORY_SEPARATOR . 'madera-content')) {
            return $found = $dir . DIRECTORY_SEPARATOR . 'madera-content';
        }
        $parent = dirname($dir);
        if ($parent === $dir) {
            break;
        }
        $dir = $parent;
    }

    throw new RuntimeException('Папка madera-content не найдена');
}

function contentFile(string $name): string
{
    return contentDir() . '/' . CONTENT_COLLECTIONS[$name][0];
}

/** Версия — отпечаток содержимого: сохранение поверх чужой правки ловится сравнением */
function contentVersion(string $raw): string
{
    return substr(hash('sha256', $raw), 0, 16);
}

function readContentRaw(string $name): string
{
    $file = contentFile($name);
    if (!is_file($file)) {
        throw new RuntimeException("Нет файла контента {$name}");
    }
    return (string) file_get_contents($file);
}

/** Файл, которого может ещё не быть (состояние сборки, манифест): нет — пустая строка */
function readOptional(string $file): string
{
    return is_file($file) ? (string) file_get_contents($file) : '';
}

/** Флаг для сборщика: подхватит его в ближайшую минуту (scripts/server-build.sh) */
function requestRebuild(string $reason): void
{
    file_put_contents(contentDir() . '/.pending', nowUtc() . ' ' . $reason . "\n", FILE_APPEND | LOCK_EX);
}

function writeFileAtomic(string $file, string $body): void
{
    $dir = dirname($file);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    $tmp = $file . '.tmp-' . bin2hex(random_bytes(4));
    // Недописанный файл (кончилось место) не должен встать на место целого
    if (file_put_contents($tmp, $body, LOCK_EX) !== strlen($body) || !rename($tmp, $file)) {
        if (is_file($tmp)) {
            unlink($tmp);
        }
        throw new RuntimeException("Не записался {$file}");
    }
}

/** Сводка для админки: версии коллекций, картинки, состояние публикации */
function adminContentIndexHandler(): never
{
    requireAdmin(db());

    $versions = [];
    foreach (array_keys(CONTENT_COLLECTIONS) as $name) {
        $versions[$name] = contentVersion(readContentRaw($name));
    }

    jsonResponse(200, [
        'versions' => $versions,
        'images' => contentImages(),
        'build' => buildStatus(),
    ]);
}

function adminContentGetHandler(string $name): never
{
    requireAdmin(db());
    $raw = readContentRaw($name);

    // Без true: пустой {} (options товара без вариантов) должен остаться объектом —
    // массивом [] он потерял бы в админке всё, что в него допишут
    jsonResponse(200, ['data' => json_decode($raw), 'version' => contentVersion($raw)]);
}

function adminContentSaveHandler(string $name): never
{
    requireHttps();
    requireSameOrigin();
    requireAdmin(db());

    [$input, $body] = readContentBody();
    $data = $input['data'];
    $base = (string) ($input['version'] ?? '');

    // Два сохранения разом (две вкладки) иначе оба прошли бы сверку версии,
    // и второе молча затёрло бы первое. Снимается с концом запроса
    $lock = fopen(contentDir() . '/.lock-' . $name, 'c');
    flock($lock, LOCK_EX);

    $file = contentFile($name);
    $currentRaw = readContentRaw($name);
    // Файл изменился после того, как админка его открыла (вторая вкладка, публикация
    // с рабочей машины) — сохранять поверх нельзя: чужая правка пропала бы молча
    if (!hash_equals(contentVersion($currentRaw), $base)) {
        fail(409, 'conflict');
    }

    $problem = contentProblem($name, $data, json_decode($currentRaw, true));
    if ($problem !== null) {
        fail(422, 'invalid', ['detail' => $problem]);
    }

    // Пишется разбор объектами — по той же причине, что в adminContentGetHandler
    $raw = json_encode($body->data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($raw === false) {
        fail(422, 'invalid', ['detail' => 'Данные не превращаются в JSON']);
    }
    $raw .= "\n";
    saveHistory($name, $currentRaw);
    writeFileAtomic($file, $raw);
    requestRebuild('admin:' . $name);
    logLine('info', 'admin: сохранён контент', ['collection' => $name]);

    jsonResponse(200, ['version' => contentVersion($raw), 'build' => buildStatus()]);
}

/**
 * Тело сохранения больше обычного (тексты сайта целиком), поэтому свой предел.
 * Два разбора: массивами — для проверок, объектами — для записи.
 */
function readContentBody(): array
{
    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > CONTENT_BODY_LIMIT) {
        fail(413, 'badRequest');
    }
    $raw = file_get_contents('php://input', false, null, 0, CONTENT_BODY_LIMIT + 1);
    if ($raw === false || strlen($raw) > CONTENT_BODY_LIMIT) {
        fail(413, 'badRequest');
    }
    $data = json_decode($raw, true, CONTENT_JSON_DEPTH);
    if (!is_array($data) || !array_key_exists('data', $data)) {
        fail(400, 'badRequest');
    }
    return [$data, json_decode($raw, false, CONTENT_JSON_DEPTH)];
}

/**
 * Что сломало бы код, а не только содержание. Остальное проверит сборка и не
 * опубликует сломанное — сайт останется прежним, а админка покажет её ответ.
 */
function contentProblem(string $name, mixed $data, mixed $current): ?string
{
    $kind = CONTENT_COLLECTIONS[$name][1];

    if ($kind === 'list') {
        if (!is_array($data) || !array_is_list($data)) {
            return 'Ожидался список записей';
        }
        $seen = [];
        foreach ($data as $index => $item) {
            $position = $index + 1;
            if (!is_array($item) || array_is_list($item)) {
                return "Запись №{$position} — не объект";
            }
            $id = $item['id'] ?? null;
            if (!is_string($id) || !preg_match(CONTENT_ID_PATTERN, $id)) {
                return "Запись №{$position}: id только из строчных латинских букв, цифр и дефисов";
            }
            if (isset($seen[$id])) {
                return "Id «{$id}» встречается дважды";
            }
            $seen[$id] = true;
        }
        return null;
    }

    if (!is_array($data) || array_is_list($data)) {
        return 'Ожидался объект настроек';
    }
    // Ключи текстов и настроек читает код сайта: пропавший ключ уронил бы сборку, лишний
    // никто бы не прочёл. Поэтому набор ключей неизменен — меняются только значения
    $expected = leafPaths($current);
    $actual = leafPaths($data);
    $missing = array_diff(array_keys($expected), array_keys($actual));
    $extra = array_diff(array_keys($actual), array_keys($expected));
    if ($missing) {
        return 'Пропали ключи: ' . implode(', ', array_slice($missing, 0, 5));
    }
    if ($extra) {
        return 'Лишние ключи: ' . implode(', ', array_slice($extra, 0, 5));
    }

    if ($name === 'texts') {
        foreach ($actual as $path => $value) {
            if (!is_string($value)) {
                return "Текст «{$path}» должен быть строкой";
            }
            // Подстановки вроде {n} заполняет код: потерянная или новая сломала бы фразу
            if (placeholders($value) !== placeholders((string) $expected[$path])) {
                return "В тексте «{$path}» должны остаться подстановки " . implode(' ', placeholders((string) $expected[$path]) ?: ['(нет)']);
            }
        }
    }
    return null;
}

/** Пути всех листьев объекта: {a:{b:1}} → ['a.b' => 1]. Списки — листья целиком */
function leafPaths(mixed $node, string $prefix = ''): array
{
    if (!is_array($node) || array_is_list($node) || $node === []) {
        return [$prefix => $node];
    }
    $paths = [];
    foreach ($node as $key => $value) {
        $paths += leafPaths($value, $prefix === '' ? (string) $key : $prefix . '.' . $key);
    }
    return $paths;
}

function placeholders(string $text): array
{
    preg_match_all('/\{(\w+)\}/', $text, $matches);
    $names = array_unique($matches[0]);
    sort($names);
    return $names;
}

function historyDir(string $name): string
{
    return contentDir() . '/history/' . $name;
}

function saveHistory(string $name, string $raw): void
{
    $dir = historyDir($name);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    // Имя — момент правки: по нему список сортируется и откатывается
    writeFileAtomic($dir . '/' . gmdate('Ymd-His') . '-' . bin2hex(random_bytes(2)) . '.json', $raw);

    $files = glob($dir . '/*.json') ?: [];
    rsort($files);
    foreach (array_slice($files, CONTENT_HISTORY_KEEP) as $old) {
        unlink($old);
    }
}

function adminHistoryListHandler(string $name): never
{
    requireAdmin(db());
    $files = glob(historyDir($name) . '/*.json') ?: [];
    rsort($files);

    $versions = array_map(static function (string $file): array {
        $stamp = basename($file, '.json');
        $moment = DateTimeImmutable::createFromFormat('Ymd-His', substr($stamp, 0, 15), new DateTimeZone('UTC'));
        return ['id' => $stamp, 'savedAt' => $moment ? $moment->format('Y-m-d\TH:i:s\Z') : null];
    }, $files);

    jsonResponse(200, ['versions' => $versions]);
}

function adminHistoryGetHandler(string $name, string $id): never
{
    requireAdmin(db());
    $file = historyDir($name) . '/' . $id . '.json';
    if (!is_file($file)) {
        fail(404, 'notFound');
    }
    jsonResponse(200, ['data' => json_decode((string) file_get_contents($file))]);
}

/**
 * Картинки для выбора в админке: готовые — из манифеста последней сборки (с адресом
 * превью), загруженные, но ещё не обработанные — из папки исходников (без превью).
 */
function contentImages(): array
{
    $manifest = json_decode(readOptional(contentDir() . '/data/images.json'), true) ?: [];
    $images = [];
    foreach ($manifest as $id => $entry) {
        $files = $entry['files'] ?? [];
        $sizes = array_filter(array_keys($files), 'is_numeric');
        sort($sizes);
        $images[$id] = [
            'type' => $entry['type'] ?? '',
            'preview' => $sizes ? '/images/' . $files[$sizes[0]] : null,
            'ready' => true,
        ];
    }

    foreach (CONTENT_UPLOAD_FLOWS as $flow => $settings) {
        foreach (glob(contentDir() . '/images-source/' . $settings['dir'] . '/*') ?: [] as $file) {
            $id = pathinfo($file, PATHINFO_FILENAME);
            if (!isset($images[$id]) && preg_match(CONTENT_ID_PATTERN, $id)) {
                $images[$id] = ['type' => $flow, 'preview' => null, 'ready' => false];
            }
        }
    }
    ksort($images);
    return $images;
}

/**
 * Загрузка фото или ролика в исходники: дальше его нарежет конвейер при сборке.
 * Имя файла = id картинки; тот же id в другом потоке — отказ, иначе конвейер
 * не поймёт, какой из двух файлов главный. Занятое имя в том же потоке — только
 * с явной заменой (replace=1): одно фото стоит у нескольких товаров, и тихая замена
 * поменяла бы их все. Исходники больше нигде не хранятся, поэтому прежний файл
 * не стирается, а уходит в trash/.
 */
function adminUploadHandler(): never
{
    requireHttps();
    requireSameOrigin();
    requireAdmin(db());

    $flow = (string) ($_POST['flow'] ?? '');
    $id = (string) ($_POST['id'] ?? '');
    $file = $_FILES['file'] ?? null;
    if (!isset(CONTENT_UPLOAD_FLOWS[$flow]) || !preg_match(CONTENT_ID_PATTERN, $id)) {
        fail(422, 'invalid', ['detail' => 'Имя файла — только строчные латинские буквы, цифры и дефисы']);
    }
    if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'])) {
        fail(422, 'invalid', ['detail' => 'Файл не дошёл до сервера']);
    }

    $settings = CONTENT_UPLOAD_FLOWS[$flow];
    $type = (string) (new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']);
    $extension = $settings['types'][$type] ?? null;
    if ($extension === null) {
        fail(422, 'invalid', ['detail' => $flow === 'video' ? 'Нужен ролик MP4' : 'Нужна картинка JPG, PNG или WebP']);
    }
    $limit = $flow === 'video' ? CONTENT_VIDEO_LIMIT : CONTENT_UPLOAD_LIMIT;
    if ((int) $file['size'] > $limit) {
        fail(422, 'invalid', ['detail' => 'Файл больше ' . intdiv($limit, 1024 * 1024) . ' МБ']);
    }

    foreach (CONTENT_UPLOAD_FLOWS as $otherFlow => $other) {
        if ($otherFlow !== $flow && glob(contentDir() . '/images-source/' . $other['dir'] . '/' . $id . '.*')) {
            fail(409, 'conflict', ['detail' => "Имя «{$id}» уже занято в другом разделе картинок"]);
        }
    }

    $dir = contentDir() . '/images-source/' . $settings['dir'];
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    $existing = glob($dir . '/' . $id . '.*') ?: [];
    if ($existing && ($_POST['replace'] ?? '') !== '1') {
        fail(409, 'taken');
    }
    // Прежний файл с любым расширением — в корзину: иначе конвейер увидел бы два
    // исходника одной картинки
    foreach ($existing as $old) {
        $trash = contentDir() . '/trash/' . $settings['dir'];
        if (!is_dir($trash)) {
            mkdir($trash, 0755, true);
        }
        rename($old, $trash . '/' . gmdate('Ymd-His') . '-' . basename($old));
    }
    if (!move_uploaded_file($file['tmp_name'], $dir . '/' . $id . '.' . $extension)) {
        throw new RuntimeException("Не сохранился загруженный файл {$id}");
    }
    requestRebuild('upload:' . $id);
    logLine('info', 'admin: загружен файл', ['flow' => $flow, 'id' => $id]);

    jsonResponse(200, ['id' => $id, 'images' => contentImages(), 'build' => buildStatus()]);
}

/**
 * Состояние публикации. Пишет его сборщик (scripts/build-status.js); флаг .pending
 * значит «правка есть, сборка ещё не начата».
 */
function buildStatus(): array
{
    $status = json_decode(readOptional(contentDir() . '/build-status.json'), true) ?: [];
    // Сборка идёт до минуты; «идёт» дольше 20 минут — процесс снят хостингом и уже
    // ничего не допишет (scripts/server-build.sh ловит только мягкое завершение)
    $started = strtotime((string) ($status['startedAt'] ?? '')) ?: 0;
    if (($status['state'] ?? '') === 'building' && $started < time() - 1200) {
        $status = ['state' => 'error', 'message' => 'Сборка оборвалась на полпути.'];
    }
    return [
        'state' => $status['state'] ?? 'unknown',
        'message' => $status['message'] ?? '',
        'finishedAt' => $status['finishedAt'] ?? null,
        'pending' => is_file(contentDir() . '/.pending'),
    ];
}

function adminBuildHandler(): never
{
    requireAdmin(db());
    jsonResponse(200, ['build' => buildStatus()]);
}

/** Повтор после неудачной сборки: сохранять нечего, а собрать заново нужно */
function adminRebuildHandler(): never
{
    requireHttps();
    requireSameOrigin();
    requireAdmin(db());
    requestRebuild('admin:retry');
    jsonResponse(200, ['build' => buildStatus()]);
}
