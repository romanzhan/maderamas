<?php

declare(strict_types=1);

// Список заказов для владельца (бэкенд.md §13): вход по одному паролю, сессия в cookie,
// список с вкладками, заказ подробно, три действия — отправлен, отменить, разобрать.

const ADMIN_COOKIE = 'madera_admin';
const ADMIN_SESSION_TTL = 12 * 3600;
const ADMIN_PAGE_SIZE = 25;
// Пять неверных паролей подряд — пауза на четверть часа (бэкенд.md §7 п. 14)
const ADMIN_LOGIN_ATTEMPTS = 5;
const ADMIN_LOGIN_WINDOW = 15 * 60;

const ADMIN_TABS = [
    'pending' => "status IN ('created', 'pending', 'rejected')",
    'paid' => "status = 'paid' AND shipped_at IS NULL",
    // Возвращённый после отправки заказ — уже не «отправленный», а «devuelto» во «Todos»
    'shipped' => "shipped_at IS NOT NULL AND status = 'paid'",
    'review' => "status = 'review'",
    'all' => '1 = 1',
];

/** Сессия хранится хешем: утечка базы не должна дарить вход в список заказов */
function sessionKey(string $token): string
{
    return hash('sha256', $token);
}

function adminSessionValid(PDO $db): bool
{
    $token = (string) ($_COOKIE[ADMIN_COOKIE] ?? '');
    if (!preg_match('/^[a-f0-9]{64}$/', $token)) {
        return false;
    }
    $select = $db->prepare('SELECT expires_at FROM sessions WHERE key = ?');
    $select->execute([sessionKey($token)]);
    $expires = $select->fetchColumn();

    return $expires !== false && strtotime((string) $expires) > time();
}

function requireAdmin(PDO $db): void
{
    if (!adminSessionValid($db)) {
        fail(401, 'unauthorized');
    }
}

function setAdminCookie(string $value, int $expires): void
{
    setcookie(ADMIN_COOKIE, $value, [
        'expires' => $expires,
        'path' => '/api/admin',
        // На рабочей машине сервер живёт без HTTPS — там cookie с Secure не дошла бы
        'secure' => !isLocalDevServer(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

function adminLoginHandler(): never
{
    requireHttps();
    requireSameOrigin();
    $db = db();
    throttle($db, 'login', ADMIN_LOGIN_ATTEMPTS, ADMIN_LOGIN_WINDOW);

    $hash = (string) config()['admin']['passwordHash'];
    if ($hash === '') {
        logLine('error', 'admin: пароль не задан в конфиге');
        fail(503, 'adminDisabled');
    }

    $input = readJsonBody();
    $password = $input['password'] ?? '';
    if (!is_string($password) || !password_verify($password, $hash)) {
        fail(401, 'wrongPassword');
    }

    // Просроченные сессии подчищаются здесь: расписания у сервера нет
    $db->prepare('DELETE FROM sessions WHERE expires_at < ?')->execute([nowUtc()]);

    $token = bin2hex(random_bytes(32));
    $expiresAt = time() + ADMIN_SESSION_TTL;
    $db->prepare('INSERT INTO sessions (key, created_at, expires_at) VALUES (?, ?, ?)')
        ->execute([sessionKey($token), nowUtc(), gmdate('Y-m-d\TH:i:s\Z', $expiresAt)]);
    setAdminCookie($token, $expiresAt);

    jsonResponse(200, ['ok' => true]);
}

function adminLogoutHandler(): never
{
    requireHttps();
    requireSameOrigin();
    $db = db();
    $token = (string) ($_COOKIE[ADMIN_COOKIE] ?? '');
    if ($token !== '') {
        $db->prepare('DELETE FROM sessions WHERE key = ?')->execute([sessionKey($token)]);
    }
    setAdminCookie('', time() - DAY_SECONDS);
    jsonResponse(200, ['ok' => true]);
}

function adminSessionHandler(): never
{
    requireHttps();
    requireSameOrigin();
    requireAdmin(db());
    jsonResponse(200, ['ok' => true]);
}

/** Строка списка: то, что видно во вкладке, без состава и адреса */
function adminOrderRow(array $order, array $runtime): array
{
    $customer = $order['customer'];

    return [
        'number' => $order['number'],
        'createdAt' => $order['created_at'],
        'name' => trim($customer['billing_first_name'] . ' ' . $customer['billing_last_name']),
        'place' => $customer['billing_city'] . ', ' . ($runtime['provinces'][$customer['billing_state']] ?? $customer['billing_state']),
        'total' => $order['total'],
        'status' => $order['status'],
        'shipped' => $order['shipped_at'] !== null,
    ];
}

function adminListHandler(): never
{
    requireHttps();
    requireSameOrigin();
    $db = db();
    requireAdmin($db);
    $runtime = runtime();

    $tab = queryString('tab') ?: 'paid';
    if (!isset(ADMIN_TABS[$tab])) {
        fail(400, 'badRequest');
    }
    $page = max(1, (int) queryString('page'));
    $query = trim(queryString('q'));

    $where = ADMIN_TABS[$tab];
    $params = [];
    if ($query !== '') {
        // Ищем только по номеру: он и есть единственное, что покупатель называет
        $id = orderIdFromNumber($query);
        $where .= ' AND id = ?';
        $params[] = $id ?? 0;
    }

    // На одну строку больше, чем показываем: так узнаём, есть ли следующая страница
    $select = $db->prepare(
        "SELECT * FROM orders WHERE $where ORDER BY id DESC LIMIT ? OFFSET ?",
    );
    $select->execute([...$params, ADMIN_PAGE_SIZE + 1, ($page - 1) * ADMIN_PAGE_SIZE]);
    $rows = $select->fetchAll();
    $hasMore = count($rows) > ADMIN_PAGE_SIZE;

    $orders = array_map(
        fn (array $row) => adminOrderRow(decodeOrder($row), $runtime),
        array_slice($rows, 0, ADMIN_PAGE_SIZE),
    );

    jsonResponse(200, ['orders' => $orders, 'page' => $page, 'hasMore' => $hasMore]);
}

function adminOrderOr404(PDO $db, string $number): array
{
    $id = orderIdFromNumber($number);
    $order = $id ? fetchOrderById($db, $id) : null;
    if ($order === null) {
        fail(404, 'notFound');
    }

    return $order;
}

function adminDetailHandler(string $number): never
{
    requireHttps();
    requireSameOrigin();
    $db = db();
    requireAdmin($db);
    $order = adminOrderOr404($db, $number);
    $runtime = runtime();

    $select = $db->prepare('SELECT at, kind, detail FROM events WHERE order_id = ? ORDER BY id');
    $select->execute([$order['id']]);
    $events = array_map(fn (array $row) => [
        'at' => $row['at'],
        'kind' => $row['kind'],
        'detail' => $row['detail'] ? json_decode((string) $row['detail'], true) : null,
    ], $select->fetchAll());

    $customer = $order['customer'];
    jsonResponse(200, [
        'number' => $order['number'],
        'status' => $order['status'],
        'createdAt' => $order['created_at'],
        'shippedAt' => $order['shipped_at'],
        'tracking' => $order['tracking'],
        'customer' => $customer + ['stateName' => $runtime['provinces'][$customer['billing_state']] ?? $customer['billing_state']],
        'items' => $order['items'],
        'subtotal' => $order['subtotal'],
        'shipping' => $order['shipping'],
        'total' => $order['total'],
        'payment' => [
            'id' => $order['mp_payment_id'],
            'status' => $order['mp_status'],
            'detail' => $order['mp_status_detail'],
        ],
        'events' => $events,
    ]);
}

/** Действие владельца над заказом (бэкенд.md §13): проверка входа и тела — общая */
function adminActionInput(): array
{
    requireHttps();
    requireSameOrigin();
    $db = db();
    requireAdmin($db);

    return [$db, readJsonBody()];
}

function adminShipHandler(string $number): never
{
    [$db, $input] = adminActionInput();
    $order = adminOrderOr404($db, $number);
    if ($order['status'] !== 'paid' || $order['shipped_at'] !== null) {
        fail(409, 'notAllowed');
    }
    $tracking = cleanString($input['tracking'] ?? '', 60);
    if ($tracking === null) {
        fail(422, 'invalidField', ['fields' => ['tracking']]);
    }

    updateOrder($db, $order['id'], ['shipped_at' => nowUtc(), 'tracking' => $tracking !== '' ? $tracking : null]);
    addEvent($db, $order['id'], 'shipped', $tracking !== '' ? ['tracking' => $tracking] : null);

    finishResponse(200, ['ok' => true]);
    notifyShipped($db, fetchOrderById($db, $order['id']), baseUrl());
    exit;
}

function adminCancelHandler(string $number): never
{
    [$db] = adminActionInput();
    $order = adminOrderOr404($db, $number);
    if (!in_array($order['status'], ['created', 'pending', 'rejected'], true)) {
        fail(409, 'notAllowed');
    }

    updateOrder($db, $order['id'], ['status' => 'cancelled']);
    addEvent($db, $order['id'], 'cancelled_by_owner', ['from' => $order['status']]);
    jsonResponse(200, ['ok' => true]);
}

/** Сообщения из форм: вкладка «Mensajes» (бэкенд.md §14). Новые сверху, тип — фильтр */
function adminMessagesHandler(): never
{
    requireHttps();
    requireSameOrigin();
    $db = db();
    requireAdmin($db);

    $type = queryString('type') ?: 'all';
    if ($type !== 'all' && !in_array($type, MESSAGE_TYPES, true)) {
        fail(400, 'badRequest');
    }
    $page = max(1, (int) queryString('page'));

    $where = $type === 'all' ? '1 = 1' : 'type = ?';
    $params = $type === 'all' ? [] : [$type];
    $select = $db->prepare("SELECT * FROM messages WHERE $where ORDER BY id DESC LIMIT ? OFFSET ?");
    $select->execute([...$params, ADMIN_PAGE_SIZE + 1, ($page - 1) * ADMIN_PAGE_SIZE]);
    $rows = $select->fetchAll();
    $hasMore = count($rows) > ADMIN_PAGE_SIZE;

    $messages = array_map(fn (array $row) => [
        'id' => (int) $row['id'],
        'type' => $row['type'],
        'status' => $row['status'],
        'code' => messageCode($row['type'], (int) $row['id']),
        'createdAt' => $row['created_at'],
        'mailStatus' => $row['mail_status'],
        'fields' => json_decode((string) $row['data'], true) ?: [],
    ], array_slice($rows, 0, ADMIN_PAGE_SIZE));

    jsonResponse(200, ['messages' => $messages, 'page' => $page, 'hasMore' => $hasMore]);
}

/** «Atendido» — для любого сообщения; «Publicar»/«Rechazar» — только для отзыва */
function adminMessageStatusHandler(int $id): never
{
    [$db, $input] = adminActionInput();
    $select = $db->prepare('SELECT type, status FROM messages WHERE id = ?');
    $select->execute([$id]);
    $message = $select->fetch();
    if (!$message) {
        fail(404, 'notFound');
    }

    $status = $input['status'] ?? '';
    $allowed = $message['type'] === 'review' ? ['attended', 'approved', 'rejected'] : ['attended'];
    if (!in_array($status, $allowed, true)) {
        fail(422, 'invalidField', ['fields' => ['status']]);
    }

    $db->prepare('UPDATE messages SET status = ?, updated_at = ? WHERE id = ?')->execute([$status, nowUtc(), $id]);
    jsonResponse(200, ['ok' => true]);
}

function adminResolveHandler(string $number): never
{
    [$db, $input] = adminActionInput();
    $order = adminOrderOr404($db, $number);
    if ($order['status'] !== 'review') {
        fail(409, 'notAllowed');
    }
    $decision = $input['decision'] ?? '';
    $note = cleanString($input['note'] ?? '', 500, true);
    if (!in_array($decision, ['paid', 'cancelled'], true) || $note === null) {
        fail(422, 'invalidField', ['fields' => ['decision', 'note']]);
    }

    updateOrder($db, $order['id'], ['status' => $decision]);
    addEvent($db, $order['id'], 'resolved', ['to' => $decision, 'note' => $note]);

    finishResponse(200, ['ok' => true]);
    // Покупатель, чей платёж владелец признал верным, письма об оплате обычно ещё не получал —
    // кроме случая «второй платёж по уже оплаченному»: там оно ушло при первом платеже.
    // Самому владельцу письмо о его же решении не нужно
    if ($decision === 'paid' && !customerAlreadyMailed($db, $order['id'], 'paid')) {
        notifyOrderStatus($db, fetchOrderById($db, $order['id']), 'paid', baseUrl(), false);
    }
    exit;
}
