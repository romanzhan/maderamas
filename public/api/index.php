<?php

declare(strict_types=1);

// Единственная точка входа сервера (бэкенд.md §2): четыре адреса, всё остальное — 404.
//   GET  /api/health                 живой ли сервер (проверка после деплоя)
//   POST /api/orders                 оформить заказ → номер, токен, ссылка на оплату
//   GET  /api/orders/{token}         статус заказа для страницы «Gracias»
//   POST /api/mercadopago/webhook    уведомления Mercado Pago о платежах
//   /api/admin/…                     список заказов владельца (lib/admin.php, бэкенд.md §13)

require __DIR__ . '/lib/app.php';
require __DIR__ . '/lib/http.php';
require __DIR__ . '/lib/db.php';
require __DIR__ . '/lib/catalog.php';
require __DIR__ . '/lib/orders.php';
require __DIR__ . '/lib/mercadopago.php';
require __DIR__ . '/lib/mail.php';
require __DIR__ . '/lib/admin.php';

// Сверка с Mercado Pago по запросу статуса — не чаще раза в минуту на заказ (бэкенд.md §5)
const RECONCILE_INTERVAL = 60;
// Пределы частоты на один IP (бэкенд.md §7 п. 7)
const ORDERS_PER_HOUR = 10;
const STATUS_CHECKS_PER_MINUTE = 60;
const HOUR_SECONDS = 3600;
const MINUTE_SECONDS = 60;

function healthHandler(): never
{
    // База и каталог открываются здесь же: первый запрос после деплоя создаёт схему,
    // а отсутствие файла сборки всплывает сразу, а не на первом покупателе
    db();
    catalog();
    runtime();
    jsonResponse(200, ['ok' => true]);
}

function createOrderHandler(): never
{
    requireHttps();
    requireSameOrigin();
    $db = db();
    throttle($db, 'orders', ORDERS_PER_HOUR, HOUR_SECONDS);

    $input = readJsonBody();

    // Ловушка для ботов заполнена: «успех» без заказа (бэкенд.md §7 п. 8)
    if (!empty($input['website'])) {
        logLine('info', 'honeypot');
        jsonResponse(201, ['number' => 0, 'token' => bin2hex(random_bytes(16)), 'payUrl' => null]);
    }

    $runtime = runtime();
    ['clean' => $customer, 'errors' => $errors] = validateCustomer($input['customer'] ?? null, $runtime);
    if ($errors !== []) {
        fail(422, 'invalidField', ['fields' => $errors]);
    }

    $items = validateItems($input['items'] ?? null, catalog(), (int) $runtime['maxQtyPerItem']);
    if ($items['error'] === 'outOfStock') {
        fail(409, 'outOfStock', ['productIds' => $items['productIds']]);
    }
    if ($items['error'] !== null) {
        fail(422, 'invalidItem');
    }

    // Без ключа оплаты заказ не заводим вовсе: покупателю нечего было бы делать дальше
    $mp = mpConfig();
    if (!empty($mp['enabled']) && $mp['accessToken'] === '') {
        logLine('error', 'Mercado Pago: нет accessToken в конфиге');
        fail(503, 'paymentUnavailable');
    }

    $order = createOrder($db, $customer, $items['lines'], (int) $runtime['shippingCost']);

    $payUrl = null;
    if (mpEnabled()) {
        try {
            $preference = mpCreatePreference($order, baseUrl(), $runtime);
        } catch (Throwable $error) {
            logLine('error', 'Mercado Pago: оплата не создана', ['order' => $order['number'], 'reason' => $error->getMessage()]);
            updateOrder($db, $order['id'], ['status' => 'cancelled']);
            addEvent($db, $order['id'], 'payment_unavailable', ['reason' => $error->getMessage()]);
            fail(502, 'paymentUnavailable');
        }
        updateOrder($db, $order['id'], ['mp_preference_id' => $preference['id'], 'mp_init_point' => $preference['initPoint']]);
        addEvent($db, $order['id'], 'payment_started', ['preference' => $preference['id']]);
        $payUrl = $preference['initPoint'];
    } else {
        logLine('warn', 'Mercado Pago выключен в конфиге — заказ оформлен без оплаты', ['order' => $order['number']]);
        addEvent($db, $order['id'], 'payment_skipped');
    }

    jsonResponse(201, ['number' => $order['number'], 'token' => $order['token'], 'payUrl' => $payUrl]);
}

/**
 * Сверка без расписания (бэкенд.md §5): для заказа, который ещё ждёт денег — в том числе
 * после отказа, ведь повтор оплаты идёт той же ссылкой, — статус запрашивается
 * у Mercado Pago напрямую: уведомление могло не дойти или запоздать.
 */
function reconcile(PDO $db, array $order, string $baseUrl, string $returnedPaymentId): array
{
    if (!mpEnabled() || !in_array($order['status'], ['created', 'pending', 'rejected'], true)) {
        return $order;
    }

    try {
        // Покупатель вернулся с оплаты: Mercado Pago дописывает в обратный адрес id платежа,
        // и этот платёж читается напрямую — поиск по номеру заказа отстаёт на секунды,
        // а страница в это время предлагала бы «Pagar» по уже оплаченному заказу
        if ($returnedPaymentId !== '') {
            $payment = mpGetPayment($returnedPaymentId);
            if ($payment !== null && (string) ($payment['external_reference'] ?? '') === (string) $order['number']) {
                $newStatus = applyPayment($db, $order, $payment);
                if ($newStatus !== null) {
                    notifyOrderStatus($db, fetchOrderById($db, $order['id']), $newStatus, $baseUrl);
                    return fetchOrderById($db, $order['id']);
                }
            }
        }

        $checkedAt = $order['mp_checked_at'] ? strtotime($order['mp_checked_at']) : 0;
        if (time() - $checkedAt < RECONCILE_INTERVAL) {
            return fetchOrderById($db, $order['id']);
        }
        $payments = mpSearchPayments((string) $order['number']);
    } catch (Throwable $error) {
        logLine('warn', 'Mercado Pago: сверка не удалась', ['order' => $order['number'], 'reason' => $error->getMessage()]);
        return fetchOrderById($db, $order['id']);
    }

    foreach ($payments as $payment) {
        $newStatus = applyPayment($db, $order, $payment);
        if ($newStatus !== null) {
            notifyOrderStatus($db, fetchOrderById($db, $order['id']), $newStatus, $baseUrl);
            break;
        }
    }
    updateOrder($db, $order['id'], ['mp_checked_at' => nowUtc()]);

    return fetchOrderById($db, $order['id']);
}

function orderStatusHandler(string $token): never
{
    requireHttps();
    requireSameOrigin();
    $db = db();
    throttle($db, 'status', STATUS_CHECKS_PER_MINUTE, MINUTE_SECONDS);

    $order = fetchOrderByToken($db, $token);
    if ($order === null) {
        fail(404, 'notFound');
    }

    // Id платежа из обратного адреса Mercado Pago (число); всё остальное — как будто его нет
    $returnedPaymentId = (string) ($_GET['payment'] ?? '');
    if (!preg_match('/^\d{1,20}$/', $returnedPaymentId)) {
        $returnedPaymentId = '';
    }

    jsonResponse(200, orderView(reconcile($db, $order, baseUrl(), $returnedPaymentId)));
}

function webhookHandler(): never
{
    requireHttps();

    // Тело нужно только чтобы достать тип и id; читается с тем же пределом, что у заказов
    $body = json_decode((string) file_get_contents('php://input', false, null, 0, BODY_LIMIT), true);
    $body = is_array($body) ? $body : [];
    // PHP превращает параметр data.id в data_id; тип приходит как type или topic
    $type = (string) ($_GET['type'] ?? $_GET['topic'] ?? $body['type'] ?? '');
    $dataId = (string) ($_GET['data_id'] ?? $body['data']['id'] ?? $_GET['id'] ?? '');

    // Уведомления о чём угодно, кроме платежей (merchant_order и прочее), нам не нужны:
    // отвечаем «200», чтобы Mercado Pago не повторял их
    if ($type !== 'payment' || $dataId === '') {
        jsonResponse(200, ['ok' => true]);
    }

    // В строку подписи входит data.id из адреса запроса (документация «Validar origen»)
    $verified = mpVerifySignature(
        (string) ($_SERVER['HTTP_X_SIGNATURE'] ?? ''),
        (string) ($_SERVER['HTTP_X_REQUEST_ID'] ?? ''),
        (string) ($_GET['data_id'] ?? ''),
        (string) mpConfig()['webhookSecret'],
    );
    if (!$verified) {
        // Форма адреса отличает подделку от уведомления старого канала (?topic=payment&id=…),
        // который мы не заказываем и проверить не можем (бэкенд.md §5)
        logLine('warn', 'webhook: подпись не сошлась', [
            'payment' => $dataId,
            'query' => array_keys($_GET),
        ]);
        fail(401, 'forbidden');
    }

    // Тело уведомления не используется: платёж перечитывается у Mercado Pago (бэкенд.md §5 п. 2)
    $payment = mpGetPayment($dataId);
    if ($payment === null) {
        logLine('warn', 'webhook: платёж не найден у Mercado Pago', ['payment' => $dataId]);
        jsonResponse(200, ['ok' => true]);
    }

    $db = db();
    $orderId = orderIdFromNumber((string) ($payment['external_reference'] ?? ''));
    $order = $orderId ? fetchOrderById($db, $orderId) : null;
    if ($order === null) {
        logLine('warn', 'webhook: заказ не найден', ['payment' => $dataId, 'reference' => $payment['external_reference'] ?? null]);
        jsonResponse(200, ['ok' => true]);
    }

    addEvent($db, $order['id'], 'webhook_received', ['payment' => $dataId, 'mpStatus' => $payment['status'] ?? null]);
    $newStatus = applyPayment($db, $order, $payment);

    // Ответ уходит сразу, письма — после него (бэкенд.md §5 п. 6)
    finishResponse(200, ['ok' => true]);
    if ($newStatus !== null) {
        notifyOrderStatus($db, fetchOrderById($db, $order['id']), $newStatus, baseUrl());
    }
    exit;
}

$method = requestMethod();
$path = requestPath();

if ($method === 'GET' && $path === '/health') {
    healthHandler();
}
if ($method === 'POST' && $path === '/orders') {
    createOrderHandler();
}
if ($method === 'GET' && preg_match('#^/orders/([a-f0-9]{32})$#', $path, $matches)) {
    orderStatusHandler($matches[1]);
}
if ($method === 'POST' && $path === '/mercadopago/webhook') {
    webhookHandler();
}

if ($method === 'POST' && $path === '/admin/login') {
    adminLoginHandler();
}
if ($method === 'POST' && $path === '/admin/logout') {
    adminLogoutHandler();
}
if ($method === 'GET' && $path === '/admin/session') {
    adminSessionHandler();
}
if ($method === 'GET' && $path === '/admin/orders') {
    adminListHandler();
}
if ($method === 'GET' && preg_match('#^/admin/orders/(\d{4,9})$#', $path, $matches)) {
    adminDetailHandler($matches[1]);
}
if ($method === 'POST' && preg_match('#^/admin/orders/(\d{4,9})/(ship|cancel|resolve)$#', $path, $matches)) {
    match ($matches[2]) {
        'ship' => adminShipHandler($matches[1]),
        'cancel' => adminCancelHandler($matches[1]),
        'resolve' => adminResolveHandler($matches[1]),
    };
}

fail(404, 'notFound');
