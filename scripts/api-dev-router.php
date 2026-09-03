<?php

declare(strict_types=1);

// Маршрутизатор встроенного сервера PHP на рабочей машине (бэкенд.md §9): адреса /api/…
// уходят в точку входа сервера, всё остальное отдаётся как файлы из public/. На хостинге
// ту же работу делает public/api/.htaccess.
$path = (string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);

if (str_starts_with($path, '/api/') || $path === '/api') {
    require __DIR__ . '/../public/api/index.php';
    return true;
}

return false;
