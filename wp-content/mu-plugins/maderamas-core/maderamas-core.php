<?php
/**
 * Общие настройки сайта, не зависящие от темы и от WooCommerce.
 *
 * @package Maderamas
 */

defined( 'ABSPATH' ) || exit;

/**
 * Запрет редактирования файлов темы и плагинов из админки.
 *
 * Код приезжает только через деплой из git. Правка через админку создала бы
 * расхождение между продом и репозиторием, которое молча затрётся следующим деплоем.
 */
if ( ! defined( 'DISALLOW_FILE_EDIT' ) ) {
	define( 'DISALLOW_FILE_EDIT', true );
}

/**
 * Убирает версию WordPress из HTML и из RSS.
 *
 * @return void
 */
function mdr_core_remove_version_meta() {
	remove_action( 'wp_head', 'wp_generator' );
}
add_action( 'init', 'mdr_core_remove_version_meta' );

/**
 * Отключает скрипты эмодзи.
 *
 * Экономит два запроса и ~15 КБ на каждой странице; современные браузеры
 * рисуют эмодзи сами.
 *
 * @return void
 */
function mdr_core_disable_emojis() {
	remove_action( 'wp_head', 'print_emoji_detection_script', 7 );
	remove_action( 'admin_print_scripts', 'print_emoji_detection_script' );
	remove_action( 'wp_print_styles', 'print_emoji_styles' );
	remove_action( 'admin_print_styles', 'print_emoji_styles' );
	remove_filter( 'the_content_feed', 'wp_staticize_emoji' );
	remove_filter( 'comment_text_rss', 'wp_staticize_emoji' );
	remove_filter( 'wp_mail', 'wp_staticize_emoji_for_email' );
}
add_action( 'init', 'mdr_core_disable_emojis' );

/**
 * Отключает XML-RPC.
 *
 * Магазину он не нужен, а брутфорс по нему — типовая атака на WordPress.
 *
 * @return bool
 */
function mdr_core_disable_xmlrpc() {
	return false;
}
add_filter( 'xmlrpc_enabled', 'mdr_core_disable_xmlrpc' );
