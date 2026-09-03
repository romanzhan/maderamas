<?php

declare(strict_types=1);

// Каркас сервера (бэкенд.md §2, §7): где лежат данные, как читается конфиг, как пишется
// журнал и как выглядит любой ответ. Подключается первым, остальные модули на него опираются.

const API_DIR = __DIR__ . '/..';
const DAY_SECONDS = 86400;
// От папки api до домашней папки хостинга — четыре уровня; запас на другую раскладку
const DATA_DIR_SEARCH_DEPTH = 8;

// Подробности ошибок покупатель не видит никогда — только код; всё остальное в журнал
// (бэкенд.md §7 п. 10)
error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');

/**
 * Приватная папка ищется вверх от папки api, пока не найдётся: на хостинге это
 * ~/madera-data, на рабочей машине — madera-data/ в корне проекта. Переезд сайта
 * на другой домен того же аккаунта поэтому не требует ни одной правки (бэкенд.md §2).
 */
function dataDir(): string
{
    static $found = null;
    if ($found !== null) {
        return $found;
    }

    $dir = realpath(API_DIR);
    for ($depth = 0; $depth < DATA_DIR_SEARCH_DEPTH && $dir !== false; $depth++) {
        $candidate = $dir . DIRECTORY_SEPARATOR . 'madera-data';
        if (is_dir($candidate)) {
            return $found = $candidate;
        }
        $parent = dirname($dir);
        if ($parent === $dir) {
            break;
        }
        $dir = $parent;
    }

    throw new RuntimeException('Папка madera-data не найдена ни рядом с сайтом, ни выше');
}

/** Настройки и секреты из madera-data/config.php; отсутствующие ключи получают пустые значения */
function config(): array
{
    static $config = null;
    if ($config !== null) {
        return $config;
    }

    $file = dataDir() . '/config.php';
    if (!is_file($file)) {
        throw new RuntimeException('Нет файла madera-data/config.php — образец в madera-data.example/');
    }
    $loaded = require $file;
    if (!is_array($loaded)) {
        throw new RuntimeException('config.php должен возвращать массив настроек');
    }

    return $config = array_replace_recursive([
        'mercadopago' => ['enabled' => true, 'accessToken' => '', 'webhookSecret' => ''],
        'mail' => [
            'from' => '', 'fromName' => '', 'replyTo' => null, 'bcc' => [],
            'smtp' => ['host' => '', 'port' => 465, 'user' => '', 'password' => ''],
        ],
        'admin' => ['passwordHash' => ''],
    ], $loaded);
}

function nowUtc(): string
{
    return gmdate('Y-m-d\TH:i:s\Z');
}

/**
 * Журнал сервера: строка JSON на событие, файл на месяц. Персональных данных сюда
 * не пишут (бэкенд.md §7 п. 15) — только коды, номера заказов и причины.
 */
function logLine(string $level, string $message, array $context = []): void
{
    $dir = dataDir() . '/logs';
    if (!is_dir($dir)) {
        mkdir($dir, 0700, true);
    }
    $line = json_encode(
        ['at' => nowUtc(), 'level' => $level, 'msg' => $message] + $context,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES,
    );
    file_put_contents($dir . '/api-' . gmdate('Y-m') . '.log', $line . PHP_EOL, FILE_APPEND | LOCK_EX);
}

function sendJsonHeaders(int $status): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
}

function jsonResponse(int $status, array $body): never
{
    sendJsonHeaders($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * Ответ отдаётся сразу, а скрипт продолжает работать: так webhook Mercado Pago получает
 * свой «200» до того, как мы возьмёмся за письма (бэкенд.md §5 п. 6).
 */
function finishResponse(int $status, array $body): void
{
    sendJsonHeaders($status);
    header('Connection: close');
    $payload = json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    header('Content-Length: ' . strlen((string) $payload));
    echo $payload;

    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    } elseif (function_exists('litespeed_finish_request')) {
        litespeed_finish_request();
    } else {
        flush();
    }
}

function fail(int $status, string $code, array $extra = []): never
{
    jsonResponse($status, ['error' => $code] + $extra);
}

// Предупреждения PHP — тоже ошибки: молча продолжать с испорченными данными хуже,
// чем честно ответить «server» и записать причину
set_error_handler(function (int $severity, string $message, string $file, int $line): bool {
    throw new ErrorException($message, 0, $severity, $file, $line);
});

set_exception_handler(function (Throwable $error): void {
    try {
        logLine('error', $error->getMessage(), [
            'file' => basename($error->getFile()),
            'line' => $error->getLine(),
        ]);
    } catch (Throwable) {
        // Журнал недоступен — терять из-за этого ответ незачем
    }
    if (!headers_sent()) {
        jsonResponse(500, ['error' => 'server']);
    }
});

// Ошибки самого PHP (не наши исключения) — в тот же каталог журналов
try {
    ini_set('error_log', dataDir() . '/logs/php-' . gmdate('Y-m') . '.log');
} catch (Throwable) {
    // Без папки данных сервер всё равно не заработает — об этом скажет первый запрос
}
