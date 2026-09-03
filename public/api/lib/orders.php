<?php

declare(strict_types=1);

// Заказ: проверка входа, пересчёт, хранение, статусы (бэкенд.md §4).

/** Ровно те поля, что стоят в разметке чекаута; всё остальное отбрасывается */
const CUSTOMER_FIELDS = [
    'billing_first_name',
    'billing_last_name',
    'billing_email',
    'billing_phone',
    'billing_address_1',
    'billing_address_2',
    'billing_postcode',
    'billing_state',
    'billing_city',
    'billing_dni',
    'billing_references',
    'order_comments',
];

const ORDER_NUMBER_BASE = 1000;

/**
 * Разрешённые переходы статусов по платежам (бэкенд.md §4): назад от «оплачен» дороги нет,
 * а из «review» автоматика не выводит вовсе — иначе повтор того же уведомления вернул бы
 * спорный заказ в «оплачен» и разослал письма второй раз. Из «review» заказ выводит
 * владелец руками (список заказов, этап 5).
 */
const STATUS_TRANSITIONS = [
    'created' => ['pending', 'paid', 'rejected', 'cancelled', 'review'],
    'pending' => ['paid', 'rejected', 'cancelled', 'review'],
    'rejected' => ['pending', 'paid', 'cancelled', 'review'],
    'paid' => ['refunded', 'review'],
    'review' => [],
    'cancelled' => ['review'],
    'refunded' => [],
];

/** Строк в заказе больше, чем товаров в каталоге, быть не может — предел с запасом */
const MAX_ORDER_LINES = 50;

/**
 * Строка от покупателя: только строка, без управляющих символов (переводы строк —
 * лишь у многострочных полей), обрезанная по краям и не длиннее предела.
 * null — значение не годится вовсе.
 */
function cleanString(mixed $value, int $max, bool $multiline = false): ?string
{
    if (!is_string($value)) {
        return null;
    }
    $pattern = $multiline ? '/[^\P{C}\n]/u' : '/\p{C}/u';
    $clean = trim((string) preg_replace($pattern, '', $value));
    if (!mb_check_encoding($clean, 'UTF-8') || mb_strlen($clean) > $max) {
        return null;
    }

    return $clean;
}

/**
 * Те же правила, что у формы (формы-и-поля.md п. 4): браузерную проверку обходят одной
 * строкой в консоли, поэтому сервер проверяет всё заново. Возвращает чистые значения
 * и список полей с ошибками.
 */
function validateCustomer(mixed $input, array $runtime): array
{
    if (!is_array($input)) {
        return ['clean' => [], 'errors' => CUSTOMER_FIELDS];
    }

    // Шаблоны полей — те же строки, что стоят в атрибутах pattern формы: они приезжают
    // в runtime.json из scripts/data.js, второго списка правил в проекте нет
    $pattern = fn (string $kind) => '/^(?:' . $runtime['patterns'][$kind] . ')$/u';

    $rules = [
        'billing_first_name' => ['max' => 60, 'required' => true, 'pattern' => $pattern('nombre')],
        'billing_last_name' => ['max' => 60, 'required' => true, 'pattern' => $pattern('nombre')],
        'billing_email' => ['max' => 120, 'required' => true, 'email' => true],
        'billing_phone' => ['max' => 10, 'required' => true, 'pattern' => $pattern('telefono')],
        'billing_address_1' => ['max' => 120, 'required' => true],
        'billing_address_2' => ['max' => 60, 'required' => false],
        'billing_postcode' => ['max' => 8, 'required' => true, 'pattern' => $pattern('cp')],
        'billing_state' => ['max' => 1, 'required' => true, 'oneOf' => array_keys($runtime['provinces'])],
        'billing_city' => ['max' => 80, 'required' => true],
        // DNI — единственное поле со своим шаблоном: форма проверяет запись с точками
        // (12.345.678), а хранится он без точек, поэтому здесь — 7–8 цифр после их снятия
        'billing_dni' => ['max' => 10, 'required' => true, 'digits' => true, 'pattern' => '/^\d{7,8}$/'],
        'billing_references' => ['max' => 200, 'required' => false, 'multiline' => true],
        'order_comments' => ['max' => 500, 'required' => false, 'multiline' => true],
    ];

    $clean = [];
    $errors = [];
    foreach ($rules as $field => $rule) {
        $value = cleanString($input[$field] ?? '', $rule['max'], $rule['multiline'] ?? false);
        // DNI приходит с точками из маски формы, хранится без них
        if ($value !== null && !empty($rule['digits'])) {
            $value = str_replace('.', '', $value);
        }

        $bad = $value === null
            || ($rule['required'] && $value === '')
            || ($value !== '' && isset($rule['pattern']) && !preg_match($rule['pattern'], $value))
            || ($value !== '' && !empty($rule['email']) && filter_var($value, FILTER_VALIDATE_EMAIL) === false)
            || ($value !== '' && isset($rule['oneOf']) && !in_array($value, $rule['oneOf'], true));

        if ($bad) {
            $errors[] = $field;
            continue;
        }
        $clean[$field] = $value;
    }

    return ['clean' => $clean, 'errors' => $errors];
}

/**
 * Строки заказа из того, что прислал браузер: только id и количество — цены и наличие
 * берутся из каталога (бэкенд.md §3). Товар без наличия останавливает заказ целиком:
 * покупатель увидит то же сообщение, что и при смене наличия в корзине.
 */
function validateItems(mixed $items, array $catalog, int $maxQty): array
{
    if (!is_array($items) || $items === [] || count($items) > MAX_ORDER_LINES) {
        return ['lines' => [], 'error' => 'invalidItem', 'productIds' => []];
    }

    $lines = [];
    $outOfStock = [];
    foreach ($items as $item) {
        $productId = is_array($item) ? ($item['productId'] ?? null) : null;
        $variantId = is_array($item) ? ($item['variantId'] ?? null) : null;
        $qty = is_array($item) ? ($item['qty'] ?? null) : null;

        if (!is_string($productId) || ($variantId !== null && !is_string($variantId)) || !is_int($qty)) {
            return ['lines' => [], 'error' => 'invalidItem', 'productIds' => []];
        }
        if ($qty < 1 || $qty > $maxQty) {
            return ['lines' => [], 'error' => 'invalidItem', 'productIds' => []];
        }

        $product = findProduct($catalog, $productId);
        $variant = $product ? resolveVariant($product, $variantId) : null;
        if (!$product || !$variant) {
            return ['lines' => [], 'error' => 'invalidItem', 'productIds' => []];
        }
        if (!$variant['inStock']) {
            $outOfStock[] = $productId;
            continue;
        }

        $lines[] = [
            'productId' => $productId,
            'variantId' => $variantId !== '' ? $variantId : null,
            'name' => (string) $product['name'],
            'variant' => $variant['variant'],
            'unitPrice' => $variant['price'],
            'qty' => $qty,
            'sum' => $variant['price'] * $qty,
        ];
    }

    if ($outOfStock !== []) {
        return ['lines' => [], 'error' => 'outOfStock', 'productIds' => array_values(array_unique($outOfStock))];
    }

    return ['lines' => $lines, 'error' => null, 'productIds' => []];
}

function orderNumber(int $id): int
{
    return ORDER_NUMBER_BASE + $id;
}

/** Название строки заказа для оплаты и письма — одно правило на оба места */
function lineTitle(array $line): string
{
    return $line['name'] . ($line['variant'] !== '' ? ' · ' . $line['variant'] : '');
}

/** Адрес страницы заказа для обратных ссылок Mercado Pago и писем */
function orderUrl(string $baseUrl, array $order): string
{
    return $baseUrl . '/gracias/?pedido=' . $order['token'];
}

function orderIdFromNumber(string $number): ?int
{
    if (!ctype_digit($number)) {
        return null;
    }
    $id = (int) $number - ORDER_NUMBER_BASE;

    return $id > 0 ? $id : null;
}

function createOrder(PDO $db, array $customer, array $lines, int $shipping): array
{
    $subtotal = array_sum(array_column($lines, 'sum'));
    $now = nowUtc();
    $token = bin2hex(random_bytes(16));

    $db->prepare(
        'INSERT INTO orders (token, status, created_at, updated_at, customer, items, subtotal, shipping, total, currency)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )->execute([
        $token,
        'created',
        $now,
        $now,
        json_encode($customer, JSON_UNESCAPED_UNICODE),
        json_encode($lines, JSON_UNESCAPED_UNICODE),
        $subtotal,
        $shipping,
        $subtotal + $shipping,
        'ARS',
    ]);
    $id = (int) $db->lastInsertId();
    addEvent($db, $id, 'created');

    return fetchOrderById($db, $id);
}

function decodeOrder(array $row): array
{
    $row['id'] = (int) $row['id'];
    $row['number'] = orderNumber($row['id']);
    $row['customer'] = json_decode((string) $row['customer'], true) ?: [];
    $row['items'] = json_decode((string) $row['items'], true) ?: [];
    foreach (['subtotal', 'shipping', 'total'] as $field) {
        $row[$field] = (int) $row[$field];
    }

    return $row;
}

function fetchOrderById(PDO $db, int $id): ?array
{
    $select = $db->prepare('SELECT * FROM orders WHERE id = ?');
    $select->execute([$id]);
    $row = $select->fetch();

    return $row ? decodeOrder($row) : null;
}

function fetchOrderByToken(PDO $db, string $token): ?array
{
    $select = $db->prepare('SELECT * FROM orders WHERE token = ?');
    $select->execute([$token]);
    $row = $select->fetch();

    return $row ? decodeOrder($row) : null;
}

/** Точечное обновление полей заказа; список колонок закрыт, чтобы имя поля не пришло снаружи */
function updateOrder(PDO $db, int $id, array $fields): void
{
    $allowed = [
        'status', 'mp_preference_id', 'mp_init_point', 'mp_payment_id', 'mp_status', 'mp_status_detail',
        'mp_checked_at', 'shipped_at', 'tracking',
    ];
    $sets = ['updated_at = ?'];
    $values = [nowUtc()];
    foreach ($fields as $column => $value) {
        if (!in_array($column, $allowed, true)) {
            throw new InvalidArgumentException('Поле заказа не обновляется: ' . $column);
        }
        $sets[] = $column . ' = ?';
        $values[] = $value;
    }
    $values[] = $id;
    $db->prepare('UPDATE orders SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($values);
}

/** Хронология заказа — по ней разбираются спорные случаи (бэкенд.md §4) */
function addEvent(PDO $db, int $orderId, string $kind, ?array $detail = null): void
{
    $db->prepare('INSERT INTO events (order_id, at, kind, detail) VALUES (?, ?, ?, ?)')->execute([
        $orderId,
        nowUtc(),
        $kind,
        $detail === null ? null : json_encode($detail, JSON_UNESCAPED_UNICODE),
    ]);
}

function canTransition(string $from, string $to): bool
{
    return in_array($to, STATUS_TRANSITIONS[$from] ?? [], true);
}

/**
 * Применение платежа Mercado Pago к заказу (бэкенд.md §5 пп. 3–5): сумма и валюта
 * сверяются до «оплачен», повтор того же уведомления ничего не меняет, назад от «оплачен»
 * статус не ходит. Возвращает новый статус или null, если заказ не изменился.
 */
function applyPayment(PDO $db, array $order, array $payment): ?string
{
    $paymentId = (string) ($payment['id'] ?? '');
    $mpStatus = (string) ($payment['status'] ?? '');
    $mapped = mpMapStatus($mpStatus);
    if ($mapped === null || $paymentId === '') {
        addEvent($db, $order['id'], 'payment_ignored', ['payment' => $paymentId, 'status' => $mpStatus]);
        return null;
    }

    // Аккаунт Mercado Pago у владельца общий с прежним магазином, а номера заказов —
    // короткие числа: совпадение external_reference с чужим платежом реально. Наш платёж
    // узнаётся по токену заказа, который мы сами положили в metadata при создании оплаты
    $paymentToken = (string) ($payment['metadata']['order_token'] ?? '');
    if (!hash_equals($order['token'], $paymentToken)) {
        addEvent($db, $order['id'], 'payment_ignored', ['payment' => $paymentId, 'reason' => 'foreignToken']);
        logLine('warn', 'Платёж с нашим номером заказа, но чужим токеном — пропущен', [
            'order' => $order['number'],
            'payment' => $paymentId,
        ]);
        return null;
    }

    // Уведомление и сверка приходят одновременно: автовозврат приводит покупателя на
    // «Gracias» ровно тогда, когда Mercado Pago шлёт webhook. Заказ перечитывается под
    // блокировкой записи — иначе оба увидели бы «создан» и оба отправили бы письма
    $db->exec('BEGIN IMMEDIATE');
    try {
        $order = fetchOrderById($db, $order['id']) ?? throw new RuntimeException('Заказ исчез из базы');
        $result = applyPaymentLocked($db, $order, $payment, $paymentId, $mpStatus, $mapped);
        $db->exec('COMMIT');
    } catch (Throwable $error) {
        $db->exec('ROLLBACK');
        throw $error;
    }

    return $result;
}

/** Тело applyPayment внутри транзакции: заказ здесь — свежая строка из базы */
function applyPaymentLocked(PDO $db, array $order, array $payment, string $paymentId, string $mpStatus, string $mapped): ?string
{
    // Сумма у Mercado Pago — дробное число, у нас — целые песо: сравниваем с допуском
    // меньше сентаво, а не на равенство
    $amountMatches = abs((float) ($payment['transaction_amount'] ?? 0) - $order['total']) < 0.005
        && ($payment['currency_id'] ?? '') === $order['currency'];

    $target = $mapped;
    // Деньги пришли, но не те; пришли по заказу, который уже отменён; или пришли второй раз
    // по уже оплаченному (ссылка Mercado Pago многоразовая) — руками разобраться и вернуть
    $duplicatePayment = $order['status'] === 'paid' && $mapped === 'paid' && $paymentId !== $order['mp_payment_id'];
    if (in_array($mapped, ['paid', 'pending'], true) && (!$amountMatches || $order['status'] === 'cancelled' || $duplicatePayment)) {
        $target = 'review';
    }

    $paymentFields = [
        'mp_payment_id' => $paymentId,
        'mp_status' => $mpStatus,
        'mp_status_detail' => (string) ($payment['status_detail'] ?? ''),
        'mp_checked_at' => nowUtc(),
    ];

    $sameAsBefore = $order['mp_payment_id'] === $paymentId
        && $order['mp_status'] === $mpStatus
        && $order['status'] === $target;
    if ($sameAsBefore) {
        updateOrder($db, $order['id'], ['mp_checked_at' => nowUtc()]);
        return null;
    }

    if (!canTransition($order['status'], $target)) {
        // Второй отклонённый платёж по тому же заказу статуса не меняет, но запомнить
        // его надо: по events потом разбирают, что именно происходило с оплатой
        if ($target === $order['status'] && $paymentId !== $order['mp_payment_id']) {
            updateOrder($db, $order['id'], $paymentFields);
            addEvent($db, $order['id'], 'payment_recorded', ['payment' => $paymentId, 'mpStatus' => $mpStatus]);
            return null;
        }
        addEvent($db, $order['id'], 'transition_refused', [
            'from' => $order['status'],
            'to' => $target,
            'payment' => $paymentId,
        ]);
        updateOrder($db, $order['id'], ['mp_checked_at' => nowUtc()]);
        return null;
    }

    updateOrder($db, $order['id'], ['status' => $target] + $paymentFields);
    addEvent($db, $order['id'], 'status_changed', [
        'from' => $order['status'],
        'to' => $target,
        'payment' => $paymentId,
        'mpStatus' => $mpStatus,
        'amountMatches' => $amountMatches,
        'duplicatePayment' => $duplicatePayment,
    ]);

    return $target;
}

/**
 * То, что видит страница «Gracias» (бэкенд.md §8): внутренний «review» для покупателя —
 * ожидание. Ссылка на оплату отдаётся только когда платить действительно нужно: заказ
 * в ожидании уже оплачен талоном или переводом, вторая кнопка «Pagar» дала бы второй платёж.
 */
function orderView(array $order): array
{
    $status = $order['status'] === 'review' ? 'pending' : $order['status'];
    $payable = in_array($status, ['created', 'rejected'], true);

    // Ровно то, что страница показывает: номер, состояние и ссылка на оплату. Состав
    // и суммы покупатель видит в письме, наружу по токену они не отдаются
    return [
        'number' => $order['number'],
        'status' => $status,
        'payUrl' => $payable ? $order['mp_init_point'] : null,
    ];
}
