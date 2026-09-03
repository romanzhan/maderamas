<?php

declare(strict_types=1);

// Источник правды для цен и настроек (бэкенд.md §3): сервер читает те же производные
// файлы сборки, что и браузер, — своей копии товаров у него нет.

function readJsonFile(string $path): array
{
    if (!is_file($path)) {
        throw new RuntimeException('Нет файла сборки ' . basename($path) . ' — сервер работает только рядом с собранным сайтом');
    }
    $data = json_decode((string) file_get_contents($path), true);
    if (!is_array($data)) {
        throw new RuntimeException('Файл ' . basename($path) . ' повреждён');
    }

    return $data;
}

/** catalog.json лежит в корне сайта — на уровень выше папки api (данные.md §8) */
function catalog(): array
{
    static $catalog = null;

    return $catalog ??= readJsonFile(API_DIR . '/../catalog.json');
}

/** runtime.json — производный файл только для сервера (бэкенд.md §3) */
function runtime(): array
{
    static $runtime = null;

    return $runtime ??= readJsonFile(API_DIR . '/runtime.json');
}

function findProduct(array $catalog, string $id): ?array
{
    foreach ($catalog['products'] as $product) {
        if ($product['id'] === $id) {
            return $product;
        }
    }

    return null;
}

/**
 * Цена и наличие комбинации — то же правило, что у корзины в браузере (src/scripts/cart.js,
 * variantOf): id опций через «--», с каждой оси берётся первая совпавшая опция, комбинация
 * известна, только если нашлись все id. Расхождение с браузером здесь означало бы,
 * что покупатель видел одну цену, а заплатил другую.
 */
function resolveVariant(array $product, ?string $variantId): ?array
{
    $ids = array_values(array_filter(explode('--', $variantId ?? ''), fn (string $id) => $id !== ''));

    $chosen = [];
    foreach ($product['options'] ?? [] as $axis) {
        foreach ($axis as $option) {
            if (in_array($option['id'], $ids, true)) {
                $chosen[] = $option;
                break;
            }
        }
    }
    if (count($chosen) !== count($ids)) {
        return null;
    }

    $price = (int) $product['price'];
    $names = [];
    $inStock = (bool) $product['inStock'];
    foreach ($chosen as $option) {
        $price += (int) ($option['priceDelta'] ?? 0);
        $names[] = (string) $option['name'];
        $inStock = $inStock && !empty($option['inStock']);
    }

    return ['price' => $price, 'variant' => implode(' · ', $names), 'inStock' => $inStock];
}
