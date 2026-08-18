<?php
/**
 * Импорт фотографий товаров с Mercado Libre (источник истины по каталогу,
 * см. docs/content-guide.md) в медиатеку и карточки WooCommerce.
 *
 * Не идемпотентно специально не делаем «умным» — рассчитан на разовый
 * запуск при наполнении каталога. Повторный запуск на уже заполненном
 * товаре добавит дубли, так что перед повтором лучше почистить галерею
 * вручную либо удалить прежние вложения.
 *
 * Ожидает структуру каталога с картинками:
 *   <photos-dir>/<SKU>/1.ext, 2.ext, 3.ext, ...
 * и текстовый манифест «SKU|Название товара» (по строке на товар) —
 * название идёт в alt/title вложений.
 *
 * Запуск (WP-CLI):
 *   wp eval-file bin/import-product-photos.php <photos-dir> <sku-names.txt>
 *
 * @package Maderamas
 */

if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) {
	die( "Запускать только через WP-CLI.\n" );
}

if ( ! class_exists( 'WooCommerce' ) ) {
	WP_CLI::error( 'WooCommerce не активен.' );
}

require_once ABSPATH . 'wp-admin/includes/image.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/media.php';

$photos_dir     = isset( $args[0] ) ? rtrim( $args[0], '/\\' ) : null;
$sku_names_file = isset( $args[1] ) ? $args[1] : null;

if ( ! $photos_dir || ! is_dir( $photos_dir ) ) {
	WP_CLI::error( 'Не найден каталог с фото: ' . (string) $photos_dir );
}
if ( ! $sku_names_file || ! file_exists( $sku_names_file ) ) {
	WP_CLI::error( 'Не найден файл с названиями товаров: ' . (string) $sku_names_file );
}

$sku_names = array();
foreach ( file( $sku_names_file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES ) as $line ) {
	list( $sku, $name ) = array_map( 'trim', explode( '|', $line, 2 ) );
	$sku_names[ $sku ] = $name;
}

/**
 * Сайдлоадит файл в медиатеку, прикреплённый к товару, с alt/title.
 *
 * @param string $file_path Путь к локальному файлу.
 * @param int    $product_id ID товара-родителя вложения.
 * @param string $title Название для title/alt.
 * @return int|WP_Error ID вложения.
 */
function maderamas_sideload_photo( $file_path, $product_id, $title ) {
	$filetype = wp_check_filetype( basename( $file_path ), null );

	$upload = wp_upload_bits( basename( $file_path ), null, file_get_contents( $file_path ) );
	if ( ! empty( $upload['error'] ) ) {
		return new WP_Error( 'upload_failed', $upload['error'] );
	}

	$attachment = array(
		'post_mime_type' => $filetype['type'],
		'post_title'     => $title,
		'post_content'   => '',
		'post_status'    => 'inherit',
		'post_parent'    => $product_id,
	);

	$attachment_id = wp_insert_attachment( $attachment, $upload['file'], $product_id );
	if ( is_wp_error( $attachment_id ) ) {
		return $attachment_id;
	}

	$attachment_data = wp_generate_attachment_metadata( $attachment_id, $upload['file'] );
	wp_update_attachment_metadata( $attachment_id, $attachment_data );
	update_post_meta( $attachment_id, '_wp_attachment_image_alt', $title );

	return $attachment_id;
}

$skus = array_diff( scandir( $photos_dir ), array( '.', '..' ) );
$done = 0;

foreach ( $skus as $sku ) {
	$sku_dir = $photos_dir . '/' . $sku;
	if ( ! is_dir( $sku_dir ) ) {
		continue;
	}

	$product_id = wc_get_product_id_by_sku( $sku );
	if ( ! $product_id ) {
		WP_CLI::warning( "Товар с SKU $sku не найден, пропускаю." );
		continue;
	}

	$title = $sku_names[ $sku ] ?? $sku;
	$files = array_diff( scandir( $sku_dir ), array( '.', '..' ) );
	natsort( $files );

	$attachment_ids = array();
	foreach ( $files as $file ) {
		$id = maderamas_sideload_photo( $sku_dir . '/' . $file, $product_id, $title . ' — Madera Más' );
		if ( is_wp_error( $id ) ) {
			WP_CLI::warning( "$sku ($file): " . $id->get_error_message() );
			continue;
		}
		$attachment_ids[] = $id;
	}

	if ( empty( $attachment_ids ) ) {
		WP_CLI::warning( "$sku: не удалось загрузить ни одной фотографии." );
		continue;
	}

	set_post_thumbnail( $product_id, $attachment_ids[0] );

	$gallery_ids = array_slice( $attachment_ids, 1 );
	update_post_meta( $product_id, '_product_image_gallery', implode( ',', $gallery_ids ) );

	WP_CLI::log( "$sku ($title): " . count( $attachment_ids ) . ' фото (1 обложка + ' . count( $gallery_ids ) . ' в галерее).' );
	++$done;
}

WP_CLI::success( "Готово: обработано товаров — $done." );
