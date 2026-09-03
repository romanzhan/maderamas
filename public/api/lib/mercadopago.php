<?php

declare(strict_types=1);

// Mercado Pago, режим Checkout Pro (бэкенд.md §5): три запроса и одна подпись.
// Библиотека не подключается сознательно (там же). Поля запросов и формат подписи —
// из документации разработчика Mercado Pago (developers.mercadopago.com.ar):
//   «Checkout Pro → Integrar → Crear preferencia»        POST /checkout/preferences
//   «Referencias de API → Pagos → Obtener pago»            GET  /v1/payments/{id}
//   «Referencias de API → Pagos → Buscar pagos»            GET  /v1/payments/search
//   «Notificaciones → Webhooks → Validar origen»           заголовок x-signature

const MP_API = 'https://api.mercadopago.com';
// Сеть до Mercado Pago: дольше этого ждать бессмысленно — покупатель уже ушёл
const MP_CONNECT_TIMEOUT = 10;
const MP_TIMEOUT = 20;
// Предел длины названия магазина в выписке по карте (поле statement_descriptor)
const MP_DESCRIPTOR_MAX = 16;

function mpConfig(): array
{
    return config()['mercadopago'];
}

/** Оплата включена и ключ на месте. Выключенный флаг — только на рабочей машине (бэкенд.md §5) */
function mpEnabled(): bool
{
    $mp = mpConfig();

    return !empty($mp['enabled']) && $mp['accessToken'] !== '';
}

function mpRequest(string $method, string $path, ?array $body = null, ?string $idempotencyKey = null): array
{
    $headers = ['Authorization: Bearer ' . mpConfig()['accessToken'], 'Accept: application/json'];
    $options = [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => MP_CONNECT_TIMEOUT,
        CURLOPT_TIMEOUT => MP_TIMEOUT,
    ];
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
        $options[CURLOPT_POSTFIELDS] = json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
    // Повтор того же запроса (сеть моргнула) не создаст вторую оплату на тот же заказ
    if ($idempotencyKey !== null) {
        $headers[] = 'X-Idempotency-Key: ' . $idempotencyKey;
    }
    $options[CURLOPT_HTTPHEADER] = $headers;

    $curl = curl_init(MP_API . $path);
    curl_setopt_array($curl, $options);
    $raw = curl_exec($curl);
    if ($raw === false) {
        $reason = curl_error($curl);
        curl_close($curl);
        throw new RuntimeException('Mercado Pago недоступен: ' . $reason);
    }
    $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    curl_close($curl);

    $data = json_decode((string) $raw, true);

    return ['status' => $status, 'data' => is_array($data) ? $data : []];
}

/** Название магазина в выписке по карте: латиница и заглавные, как требует поле */
function statementDescriptor(string $siteName): string
{
    $ascii = strtr($siteName, ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ñ' => 'n', 'ü' => 'u',
        'Á' => 'A', 'É' => 'E', 'Í' => 'I', 'Ó' => 'O', 'Ú' => 'U', 'Ñ' => 'N', 'Ü' => 'U']);

    return substr(strtoupper((string) preg_replace('/[^A-Za-z0-9 ]/', '', $ascii)), 0, MP_DESCRIPTOR_MAX);
}

/**
 * Создаёт оплату и возвращает её id и ссылку. Обратные адреса строятся от текущего
 * хоста: превью и боевой домен работают без настроек. Без HTTPS (рабочая машина)
 * Mercado Pago не примет автовозврат — поле тогда не отправляется.
 */
function mpCreatePreference(array $order, string $baseUrl, array $runtime): array
{
    $items = [];
    foreach ($order['items'] as $line) {
        $items[] = [
            'id' => $line['productId'] . ($line['variantId'] ? '--' . $line['variantId'] : ''),
            'title' => lineTitle($line),
            'quantity' => $line['qty'],
            'unit_price' => $line['unitPrice'],
            'currency_id' => $order['currency'],
        ];
    }
    if ($order['shipping'] > 0) {
        $items[] = [
            'id' => 'envio',
            'title' => $runtime['texts']['shipping'],
            'quantity' => 1,
            'unit_price' => $order['shipping'],
            'currency_id' => $order['currency'],
        ];
    }

    $customer = $order['customer'];
    $thanksUrl = orderUrl($baseUrl, $order);
    $body = [
        'items' => $items,
        'payer' => [
            'name' => $customer['billing_first_name'],
            'surname' => $customer['billing_last_name'],
            'email' => $customer['billing_email'],
            'phone' => ['number' => $customer['billing_phone']],
            'identification' => ['type' => 'DNI', 'number' => $customer['billing_dni']],
            'address' => [
                'zip_code' => $customer['billing_postcode'],
                'street_name' => $customer['billing_address_1'],
            ],
        ],
        'external_reference' => (string) $order['number'],
        'back_urls' => ['success' => $thanksUrl, 'pending' => $thanksUrl, 'failure' => $thanksUrl],
        'statement_descriptor' => statementDescriptor((string) $runtime['siteName']),
        // Токен возвращается в metadata платежа — по нему сервер отличает наш платёж
        // от чужого с тем же номером (orders.php, applyPayment)
        'metadata' => ['order_token' => $order['token'], 'order_number' => $order['number']],
    ];
    // Адрес уведомлений в предпочтение не кладём: такие уведомления приходят вторым
    // каналом (?topic=payment&id=…) и подписаны ключом, которого Mercado Pago не выдаёт, —
    // проверить их нельзя. Уведомления настраиваются в кабинете приложения (Webhooks),
    // они подписаны секретом из конфига (песочница 03.09.2026, бэкенд.md §5)
    if (str_starts_with($baseUrl, 'https://')) {
        $body['auto_return'] = 'approved';
    }

    $response = mpRequest('POST', '/checkout/preferences', $body, $order['token']);
    if ($response['status'] !== 201 || empty($response['data']['id']) || empty($response['data']['init_point'])) {
        throw new RuntimeException(sprintf(
            'Mercado Pago не создал оплату: HTTP %d %s',
            $response['status'],
            json_encode($response['data']['message'] ?? $response['data']['error'] ?? '', JSON_UNESCAPED_UNICODE),
        ));
    }

    return ['id' => (string) $response['data']['id'], 'initPoint' => (string) $response['data']['init_point']];
}

function mpGetPayment(string $id): ?array
{
    $response = mpRequest('GET', '/v1/payments/' . rawurlencode($id));

    return $response['status'] === 200 ? $response['data'] : null;
}

/** Платежи по номеру заказа, свежие первыми — для сверки без webhook (бэкенд.md §5) */
function mpSearchPayments(string $externalReference): array
{
    $query = http_build_query([
        'external_reference' => $externalReference,
        'sort' => 'date_last_updated',
        'criteria' => 'desc',
    ]);
    $response = mpRequest('GET', '/v1/payments/search?' . $query);

    return $response['status'] === 200 ? ($response['data']['results'] ?? []) : [];
}

/**
 * Подпись уведомления. Заголовок x-signature = "ts=…,v1=…"; подписывается строка
 * "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" (части без значения пропускаются,
 * буквенно-цифровой data.id — в нижнем регистре) секретом из конфига, HMAC-SHA256.
 */
function mpVerifySignature(string $signature, string $requestId, string $dataId, string $secret): bool
{
    if ($secret === '' || $signature === '') {
        return false;
    }

    $ts = null;
    $v1 = null;
    foreach (explode(',', $signature) as $part) {
        $pair = explode('=', $part, 2);
        if (count($pair) !== 2) {
            continue;
        }
        [$key, $value] = array_map('trim', $pair);
        if ($key === 'ts') {
            $ts = $value;
        } elseif ($key === 'v1') {
            $v1 = $value;
        }
    }
    if ($ts === null || $v1 === null) {
        return false;
    }

    $id = ctype_alnum($dataId) ? strtolower($dataId) : $dataId;
    $manifest = '';
    if ($id !== '') {
        $manifest .= 'id:' . $id . ';';
    }
    if ($requestId !== '') {
        $manifest .= 'request-id:' . $requestId . ';';
    }
    $manifest .= 'ts:' . $ts . ';';

    return hash_equals(hash_hmac('sha256', $manifest, $secret), $v1);
}

/** Статус платежа Mercado Pago → статус заказа (бэкенд.md §5 п. 4); неизвестный — null */
function mpMapStatus(string $status): ?string
{
    return match ($status) {
        'approved' => 'paid',
        'pending', 'in_process', 'authorized', 'in_mediation' => 'pending',
        'rejected' => 'rejected',
        'cancelled' => 'cancelled',
        'refunded', 'charged_back' => 'refunded',
        default => null,
    };
}
