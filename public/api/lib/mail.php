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

// Сеть до почтового сервера: дольше ждать нет смысла — заказ уже записан
const SMTP_TIMEOUT = 15;

/**
 * Отправка через почтовый сервер хостинга с паролем ящика (бэкенд.md §6): письмо уходит
 * от настоящего ящика домена, подписанное хостингом, — так его не принимают за подделку.
 * Разговор по SMTP короткий и стандартный, библиотека ради него не нужна (там же).
 * Получатели — «кому» плюс скрытые копии; в самом письме скрытых копий не видно.
 */
function smtpSend(array $smtp, string $from, array $recipients, string $message): void
{
    $socket = @stream_socket_client(
        'ssl://' . $smtp['host'] . ':' . $smtp['port'],
        $errno,
        $errstr,
        SMTP_TIMEOUT,
    );
    if ($socket === false) {
        throw new RuntimeException('SMTP: нет соединения — ' . $errstr);
    }
    stream_set_timeout($socket, SMTP_TIMEOUT);

    // Ответ сервера может быть многострочным («250-…», последняя строка «250 …»)
    $expect = function (string $code) use ($socket): void {
        do {
            $line = fgets($socket);
            if ($line === false) {
                throw new RuntimeException('SMTP: сервер замолчал');
            }
        } while (isset($line[3]) && $line[3] === '-');
        if (!str_starts_with($line, $code)) {
            throw new RuntimeException('SMTP: ' . trim($line));
        }
    };
    $command = function (string $line, string $code) use ($socket, $expect): void {
        fwrite($socket, $line . "\r\n");
        $expect($code);
    };

    try {
        $expect('220');
        $command('EHLO ' . substr(strrchr($from, '@'), 1), '250');
        $command('AUTH LOGIN', '334');
        $command(base64_encode((string) $smtp['user']), '334');
        $command(base64_encode((string) $smtp['password']), '235');
        $command('MAIL FROM:<' . $from . '>', '250');
        foreach ($recipients as $recipient) {
            $command('RCPT TO:<' . $recipient . '>', '250');
        }
        $command('DATA', '354');
        // Строка из одной точки закончила бы письмо раньше времени — точки в начале удваиваются
        fwrite($socket, preg_replace('/^\./m', '..', $message) . "\r\n.\r\n");
        $expect('250');
        fwrite($socket, "QUIT\r\n");
    } finally {
        fclose($socket);
    }
}

/** Настроена ли отправка через ящик: без пароля идти на почтовый сервер бессмысленно */
function smtpConfigured(array $mail): bool
{
    $smtp = $mail['smtp'] ?? [];

    return !empty($smtp['host']) && !empty($smtp['user']) && !empty($smtp['password']);
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
    // Скрытые копии — только адреса из конфига: владелец следит за перепиской магазина
    $bcc = array_values(array_filter((array) ($mail['bcc'] ?? []), fn ($address) => is_string($address) && $address !== '' && $address !== $to));

    // Недоступный почтовый механизм даёт предупреждение PHP, а предупреждения у нас —
    // исключения (app.php). Письмо — не повод ронять заказ (бэкенд.md §6)
    try {
        if (smtpConfigured($mail)) {
            $message = implode("\r\n", array_merge(
                ['To: ' . $to, 'Subject: ' . mb_encode_mimeheader($subject, 'UTF-8'), 'Date: ' . gmdate('r'),
                    'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . substr(strrchr($mail['from'], '@'), 1) . '>'],
                $headers,
                ['', str_replace("\n", "\r\n", $body)],
            ));
            smtpSend($mail['smtp'], $mail['from'], [$to, ...$bcc], $message);
            $sent = true;
        } else {
            // Почтовый механизм PHP — только там, где ящика нет (рабочая машина)
            if ($bcc !== []) {
                $headers[] = 'Bcc: ' . implode(', ', $bcc);
            }
            $sent = mail($to, mb_encode_mimeheader($subject, 'UTF-8'), $body, implode("\r\n", $headers));
        }
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
