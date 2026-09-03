<?php

declare(strict_types=1);

// Письма покупателю и владельцу (бэкенд.md §6): простой текст, тексты из словаря
// (через runtime.json), отправка почтовым механизмом хостинга.

/** Тот же формат суммы, что на сайте (src/scripts/format.js): «$ 130.000», неразрывный пробел */
function money(int $amount): string
{
    return "$\u{A0}" . number_format($amount, 0, ',', '.');
}

function fillText(string $template, array $values): string
{
    foreach ($values as $key => $value) {
        $template = str_replace('{' . $key . '}', (string) $value, $template);
    }

    return $template;
}

function sendMail(string $to, string $subject, string $body): bool
{
    $mail = config()['mail'];
    if ($mail['from'] === '') {
        logLine('warn', 'mail: адрес отправителя не настроен — письмо не отправлено');
        return false;
    }

    $headers = [
        'From: ' . mb_encode_mimeheader((string) $mail['fromName'], 'UTF-8') . ' <' . $mail['from'] . '>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
    ];
    if (!empty($mail['replyTo'])) {
        $headers[] = 'Reply-To: ' . $mail['replyTo'];
    }

    // Недоступный почтовый механизм даёт предупреждение PHP, а предупреждения у нас —
    // исключения (app.php). Письмо — не повод ронять заказ (бэкенд.md §6)
    try {
        $sent = mail($to, mb_encode_mimeheader($subject, 'UTF-8'), $body, implode("\r\n", $headers));
    } catch (Throwable $error) {
        logLine('warn', 'mail: отправка не удалась', ['subject' => $subject, 'reason' => $error->getMessage()]);
        return false;
    }
    if (!$sent) {
        logLine('warn', 'mail: отправка не удалась', ['subject' => $subject]);
    }

    return $sent;
}

function orderLinesText(array $order): string
{
    $lines = [];
    foreach ($order['items'] as $line) {
        $lines[] = sprintf('- %s × %d — %s', lineTitle($line), $line['qty'], money($line['sum']));
    }

    return implode("\n", $lines);
}

function orderTotalsText(array $order, array $texts): string
{
    $shipping = $order['shipping'] > 0
        ? $texts['shipping'] . ': ' . money($order['shipping'])
        : $texts['shippingFree'];

    return $shipping . "\n" . fillText($texts['total'], ['amount' => money($order['total'])]);
}

/** Письмо «заказ в пути» — когда владелец отметил отправку (бэкенд.md §13) */
function notifyShipped(PDO $db, array $order, string $baseUrl): void
{
    $runtime = runtime();
    $texts = $runtime['texts'];
    $customer = $order['customer'];

    $body = [
        fillText($texts['greeting'], ['name' => $customer['billing_first_name']]),
        '',
        $texts['shippedIntro'],
    ];
    if (!empty($order['tracking'])) {
        $body[] = fillText($texts['tracking'], ['code' => $order['tracking']]);
    }
    $body = array_merge($body, [
        '',
        fillText($texts['order'], ['n' => $order['number']]),
        orderLinesText($order),
        '',
        fillText($texts['orderLink'], ['url' => orderUrl($baseUrl, $order)]),
        fillText($texts['questions'], ['phone' => $runtime['ownerPhone']]),
        '',
        $runtime['siteName'],
    ]);

    $sent = sendMail(
        $customer['billing_email'],
        fillText($texts['subjectShipped'], ['n' => $order['number']]),
        implode("\n", $body),
    );
    addEvent($db, $order['id'], $sent ? 'email_customer_sent' : 'email_customer_failed', ['status' => 'shipped']);
}

/**
 * Почему заказ ушёл в «review» — по последней записи о смене статуса в хронологии
 * (бэкенд.md §4): владелец должен прочитать причину, а не искать её сам.
 */
function reviewReasonKey(PDO $db, int $orderId): string
{
    $select = $db->prepare(
        "SELECT detail FROM events WHERE order_id = ? AND kind = 'status_changed' ORDER BY id DESC LIMIT 1",
    );
    $select->execute([$orderId]);
    $detail = json_decode((string) $select->fetchColumn(), true) ?: [];

    if (isset($detail['amountMatches']) && !$detail['amountMatches']) {
        return 'reviewAmount';
    }
    if (!empty($detail['duplicatePayment'])) {
        return 'reviewDuplicate';
    }

    return 'reviewCancelled';
}

/**
 * Письма по смене статуса (бэкенд.md §6): покупателю — при «оплачен» и «ждём оплату»,
 * владельцу — при тех же двух и при расхождении суммы (кроме случая, когда статус
 * поставил он сам, — withOwner = false). Неудача отправки записывается, заказ от неё
 * не страдает.
 */
function notifyOrderStatus(PDO $db, array $order, string $status, string $baseUrl, bool $withOwner = true): void
{
    $runtime = runtime();
    $texts = $runtime['texts'];
    $customer = $order['customer'];
    $number = $order['number'];
    $orderUrl = orderUrl($baseUrl, $order);

    if ($status === 'paid' || $status === 'pending') {
        $subject = fillText($texts[$status === 'paid' ? 'subjectPaid' : 'subjectPending'], ['n' => $number]);
        $body = implode("\n", [
            fillText($texts['greeting'], ['name' => $customer['billing_first_name']]),
            '',
            $texts[$status === 'paid' ? 'paidIntro' : 'pendingIntro'],
            '',
            fillText($texts['order'], ['n' => $number]),
            orderLinesText($order),
            orderTotalsText($order, $texts),
            '',
            $texts['nextPrepare'],
            $texts['nextContact'],
            '',
            fillText($texts['orderLink'], ['url' => $orderUrl]),
            fillText($texts['questions'], ['phone' => $runtime['ownerPhone']]),
            '',
            $runtime['siteName'],
        ]);
        $sent = sendMail($customer['billing_email'], $subject, $body);
        addEvent($db, $order['id'], $sent ? 'email_customer_sent' : 'email_customer_failed', ['status' => $status]);
    }

    if ($withOwner && in_array($status, ['paid', 'pending', 'review'], true)) {
        $subjectKey = ['paid' => 'ownerSubjectPaid', 'pending' => 'ownerSubjectPending', 'review' => 'ownerSubjectReview'][$status];
        $statusKey = ['paid' => 'statusPaid', 'pending' => 'statusPending', 'review' => 'statusReview'][$status];
        $address = implode("\n", array_filter([
            $customer['billing_address_1'],
            $customer['billing_address_2'],
            $customer['billing_city'] . ', ' . ($runtime['provinces'][$customer['billing_state']] ?? $customer['billing_state']),
            $customer['billing_postcode'],
        ]));

        $parts = [
            fillText($texts['order'], ['n' => $number]) . ' — ' . $texts[$statusKey],
        ];
        if ($status === 'review') {
            $parts[] = $texts[reviewReasonKey($db, $order['id'])];
        }
        $parts = array_merge($parts, [
            '',
            $texts['customerTitle'],
            $customer['billing_first_name'] . ' ' . $customer['billing_last_name'],
            $customer['billing_email'],
            $customer['billing_phone'],
            $texts['dni'] . ' ' . $customer['billing_dni'],
            '',
            $texts['deliveryTitle'],
            $address,
        ]);
        if ($customer['billing_references'] !== '') {
            $parts = array_merge($parts, ['', $texts['referencesTitle'], $customer['billing_references']]);
        }
        $parts = array_merge($parts, ['', orderLinesText($order), orderTotalsText($order, $texts)]);
        if ($customer['order_comments'] !== '') {
            $parts = array_merge($parts, ['', $texts['notesTitle'], $customer['order_comments']]);
        }
        $parts = array_merge($parts, ['', $orderUrl]);

        $sent = sendMail($runtime['ownerEmail'], fillText($texts[$subjectKey], ['n' => $number]), implode("\n", $parts));
        addEvent($db, $order['id'], $sent ? 'email_owner_sent' : 'email_owner_failed', ['status' => $status]);
    }
}
