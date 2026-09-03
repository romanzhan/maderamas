<?php

declare(strict_types=1);

// База заказов: SQLite в приватной папке (бэкенд.md §2, §12). Схема создаётся при первом
// обращении; её версия лежит в таблице meta, чтобы будущие изменения шли миграциями,
// а не правкой файла руками.

const SCHEMA_VERSION = 2;

function db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }

    $file = dataDir() . '/orders.sqlite';
    $isNew = !is_file($file);

    $pdo = new PDO('sqlite:' . $file, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    // WAL: чтение статуса заказа не ждёт записи webhook и наоборот; busy_timeout — вместо
    // ошибки «база занята» при двух запросах в одну секунду
    $pdo->exec('PRAGMA journal_mode = WAL');
    $pdo->exec('PRAGMA busy_timeout = 5000');
    $pdo->exec('PRAGMA foreign_keys = ON');

    if ($isNew) {
        chmod($file, 0600);
    }
    migrate($pdo);

    return $pdo;
}

function migrate(PDO $pdo): void
{
    $pdo->exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    $current = (int) ($pdo->query("SELECT value FROM meta WHERE key = 'schema_version'")->fetchColumn() ?: 0);
    if ($current >= SCHEMA_VERSION) {
        return;
    }

    $pdo->beginTransaction();
    if ($current < 1) {
        $pdo->exec(<<<'SQL'
            CREATE TABLE orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                customer TEXT NOT NULL,
                items TEXT NOT NULL,
                subtotal INTEGER NOT NULL,
                shipping INTEGER NOT NULL,
                total INTEGER NOT NULL,
                currency TEXT NOT NULL,
                mp_preference_id TEXT,
                mp_init_point TEXT,
                mp_payment_id TEXT,
                mp_status TEXT,
                mp_status_detail TEXT,
                mp_checked_at TEXT
            );
            CREATE TABLE events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER NOT NULL REFERENCES orders(id),
                at TEXT NOT NULL,
                kind TEXT NOT NULL,
                detail TEXT
            );
            CREATE INDEX events_order ON events(order_id);
            CREATE TABLE throttle (
                key TEXT PRIMARY KEY,
                count INTEGER NOT NULL,
                window_start INTEGER NOT NULL
            );
            SQL);
    }
    // Список заказов для владельца (бэкенд.md §13): отметка отправки и сессии входа
    if ($current < 2) {
        $pdo->exec(<<<'SQL'
            ALTER TABLE orders ADD COLUMN shipped_at TEXT;
            ALTER TABLE orders ADD COLUMN tracking TEXT;
            CREATE TABLE sessions (
                key TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            );
            SQL);
    }
    $pdo->prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)")
        ->execute([(string) SCHEMA_VERSION]);
    $pdo->commit();
}
