<?php

declare(strict_types=1);

// Команды для консоли и планировщика хостинга (бэкенд.md §7 п. 16). Из браузера
// недоступен: и по .htaccess, и по проверке ниже — двух замков на одну дверь не жалко.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/lib/app.php';
require __DIR__ . '/lib/db.php';

const BACKUP_KEEP_DAYS = 30;
// Сообщения из форм хранятся два года (решение владельца 03.09.2026, бэкенд.md §14);
// заказы не удаляются никогда
const MESSAGES_KEEP_DAYS = 730;

/** Копия базы средствами SQLite (не копированием файла: тот может быть на середине записи) */
function backup(): void
{
    $source = dataDir() . '/orders.sqlite';
    if (!is_file($source)) {
        echo "База ещё не создана — копировать нечего\n";
        return;
    }

    $dir = dataDir() . '/backups';
    if (!is_dir($dir)) {
        mkdir($dir, 0700, true);
    }
    $target = $dir . '/orders-' . gmdate('Y-m-d') . '.sqlite';

    $from = new SQLite3($source, SQLITE3_OPEN_READONLY);
    $to = new SQLite3($target);
    $from->backup($to);
    $to->close();
    $from->close();
    chmod($target, 0600);

    // Ключи и пароли восстанавливать неоткуда, кроме как отсюда: копия конфига лежит
    // рядом с копией базы, с теми же правами
    copy(dataDir() . '/config.php', $dir . '/config-' . gmdate('Y-m-d') . '.php');
    chmod($dir . '/config-' . gmdate('Y-m-d') . '.php', 0600);

    foreach (array_merge(glob($dir . '/orders-*.sqlite') ?: [], glob($dir . '/config-*.php') ?: []) as $file) {
        if (filemtime($file) < time() - BACKUP_KEEP_DAYS * DAY_SECONDS) {
            unlink($file);
        }
    }
    echo 'Копия сделана: ' . basename($target) . "\n";
}

/** Чистка старых сообщений: чужие данные без нужды не хранятся (Ley 25.326) */
function purge(): void
{
    $before = gmdate('Y-m-d\TH:i:s\Z', time() - MESSAGES_KEEP_DAYS * DAY_SECONDS);
    $statement = db()->prepare('DELETE FROM messages WHERE created_at < ?');
    $statement->execute([$before]);
    echo 'Удалено сообщений старше двух лет: ' . $statement->rowCount() . "\n";
}

/**
 * Последние заказы с хронологией и строки журнала про вебхук и почту за сегодня —
 * проверка тестовой оплаты (бэкенд.md §10). Только чтение
 */
function orders(int $limit): void
{
    $db = db();
    $rows = $db->query('SELECT * FROM orders ORDER BY id DESC LIMIT ' . max(1, $limit))->fetchAll();
    if (!$rows) {
        echo "Заказов нет\n";
    }
    $events = $db->prepare('SELECT at, kind, detail FROM events WHERE order_id = ? ORDER BY id');
    foreach ($rows as $order) {
        $customer = json_decode((string) $order['customer'], true) ?: [];
        echo "\n#{$order['id']} · {$order['status']} · {$order['total']} {$order['currency']} · {$order['created_at']}\n";
        echo '  ', $customer['billing_first_name'] ?? '', ' ', $customer['billing_last_name'] ?? '',
            ' <', $customer['billing_email'] ?? '', ">\n";
        echo "  MP: платёж {$order['mp_payment_id']} · {$order['mp_status']} {$order['mp_status_detail']}",
            " · сверка {$order['mp_checked_at']}\n";
        $events->execute([$order['id']]);
        foreach ($events as $event) {
            echo "  {$event['at']}  {$event['kind']}  ", mb_substr((string) $event['detail'], 0, 160), "\n";
        }
    }

    $log = dataDir() . '/logs/api-' . gmdate('Y-m') . '.log';
    echo "\nЖурнал за сегодня (вебхук, Mercado Pago, почта):\n";
    foreach (is_file($log) ? file($log) : [] as $line) {
        if (str_contains($line, gmdate('Y-m-d')) && preg_match('/webhook|mercadopago|mail/i', $line)) {
            echo '  ', trim($line), "\n";
        }
    }
}

/**
 * Секрет уведомлений Mercado Pago — со стандартного ввода, не из строки команды: строки
 * команд видны в списке процессов. Остальной конфиг не трогается (бэкенд.md §5, §10)
 */
function webhookSecret(): void
{
    $secret = trim((string) stream_get_contents(STDIN));
    if (!preg_match('/^[A-Za-z0-9]{16,128}$/', $secret)) {
        fwrite(STDERR, "Секрет не похож на ключ Mercado Pago — конфиг не изменён\n");
        exit(1);
    }
    $file = dataDir() . '/config.php';
    // Копия — с теми же правами, что и сам конфиг: в ней ключи и пароли
    $copy = $file . '.bak-' . gmdate('Ymd-His');
    copy($file, $copy);
    chmod($copy, 0600);
    $config = require $file;
    $config['mercadopago']['webhookSecret'] = $secret;
    file_put_contents($file, "<?php\n\nreturn " . var_export($config, true) . ";\n");
    chmod($file, 0600);
    echo "Секрет уведомлений записан\n";
}

match ($argv[1] ?? '') {
    'backup' => backup(),
    'purge' => purge(),
    'orders' => orders((int) ($argv[2] ?? 3)),
    'webhook-secret' => webhookSecret(),
    default => fwrite(STDERR, "Использование: php cli.php backup | purge | orders [n] | webhook-secret < секрет\n"),
};
