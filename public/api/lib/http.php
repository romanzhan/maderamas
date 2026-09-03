<?php

declare(strict_types=1);

// Разбор запроса и защита входа (бэкенд.md §7): только HTTPS, только свой сайт,
// ограниченное тело, ограниченная частота.

const BODY_LIMIT = 16 * 1024;

function requestMethod(): string
{
    return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
}

/** Путь после /api без хвостового слеша: /api/orders/abc → /orders/abc */
function requestPath(): string
{
    $uri = (string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    $path = preg_replace('#^/api(?=/|$)#', '', $uri) ?? $uri;
    $path = rtrim($path, '/');

    return $path === '' ? '/' : $path;
}

/** Встроенный сервер PHP на рабочей машине: без HTTPS и с адресом вида localhost:5173 */
function isLocalDevServer(): bool
{
    return PHP_SAPI === 'cli-server';
}

function requireHttps(): void
{
    if (isLocalDevServer()) {
        return;
    }
    $https = ($_SERVER['HTTPS'] ?? '') !== '' && $_SERVER['HTTPS'] !== 'off';
    if (!$https && ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') !== 'https') {
        fail(403, 'httpsRequired');
    }
}

/**
 * Имя хоста уходит в обратные ссылки для Mercado Pago, поэтому принимается только то,
 * что похоже на имя хоста, — а не любая строка из заголовка.
 */
function requestHost(): string
{
    $host = $_SERVER['HTTP_HOST'] ?? '';
    if (!preg_match('/^[A-Za-z0-9.-]+(:\d+)?$/', $host)) {
        fail(400, 'badRequest');
    }

    return $host;
}

/** Адрес сайта для обратных ссылок — из запроса, а не из настроек (бэкенд.md §5) */
function baseUrl(): string
{
    return (isLocalDevServer() ? 'http://' : 'https://') . requestHost();
}

/**
 * Запрос обязан прийти со страницы нашего же сайта. Заголовки Sec-Fetch-Site и Origin
 * ставит браузер, и скрипт чужого сайта их не подменит — это и есть защита от подставных
 * отправок. Webhook сюда не ходит: он приходит от Mercado Pago и защищён подписью.
 */
function requireSameOrigin(): void
{
    $site = $_SERVER['HTTP_SEC_FETCH_SITE'] ?? null;
    if ($site !== null && !in_array($site, ['same-origin', 'none'], true)) {
        fail(403, 'forbidden');
    }

    $origin = $_SERVER['HTTP_ORIGIN'] ?? null;
    if ($origin === null || $origin === 'null') {
        return;
    }
    $host = parse_url($origin, PHP_URL_HOST);
    $port = parse_url($origin, PHP_URL_PORT);
    $expected = (string) $host . ($port ? ':' . $port : '');
    if (!hash_equals(requestHost(), $expected)) {
        fail(403, 'forbidden');
    }
}

/** Тело запроса: только JSON-объект и не больше BODY_LIMIT — всё остальное «badRequest» */
function readJsonBody(): array
{
    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > BODY_LIMIT) {
        fail(413, 'badRequest');
    }
    $raw = file_get_contents('php://input', false, null, 0, BODY_LIMIT + 1);
    if ($raw === false || strlen($raw) > BODY_LIMIT) {
        fail(413, 'badRequest');
    }
    $data = json_decode($raw, true, 8);
    if (!is_array($data)) {
        fail(400, 'badRequest');
    }

    return $data;
}

/**
 * Ограничение частоты на IP (бэкенд.md §7 п. 7). Адрес хранится хешем: счётчику нужно
 * различать клиентов, а не знать их (п. 15).
 */
function throttle(PDO $db, string $bucket, int $limit, int $windowSeconds): void
{
    $key = $bucket . ':' . hash('sha256', $_SERVER['REMOTE_ADDR'] ?? '');
    $now = time();

    $db->beginTransaction();
    // Старые окна не нужны никому — подчищаем попутно, отдельного расписания у нас нет
    $db->prepare('DELETE FROM throttle WHERE window_start < ?')->execute([$now - DAY_SECONDS]);

    $select = $db->prepare('SELECT count, window_start FROM throttle WHERE key = ?');
    $select->execute([$key]);
    $row = $select->fetch();

    if (!$row || $now - (int) $row['window_start'] >= $windowSeconds) {
        $db->prepare(
            'INSERT INTO throttle (key, count, window_start) VALUES (?, 1, ?)
             ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start',
        )->execute([$key, $now]);
        $db->commit();
        return;
    }

    if ((int) $row['count'] >= $limit) {
        $db->commit();
        fail(429, 'tooManyRequests');
    }

    $db->prepare('UPDATE throttle SET count = count + 1 WHERE key = ?')->execute([$key]);
    $db->commit();
}
