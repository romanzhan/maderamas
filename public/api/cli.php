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

    foreach (glob($dir . '/orders-*.sqlite') ?: [] as $file) {
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

match ($argv[1] ?? '') {
    'backup' => backup(),
    'purge' => purge(),
    default => fwrite(STDERR, "Использование: php cli.php backup | purge\n"),
};
