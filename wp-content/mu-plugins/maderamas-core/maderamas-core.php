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
 *
 * Константа принадлежит ядру WordPress, поэтому правило о префиксах к ней не применимо.
 */
if ( ! defined( 'DISALLOW_FILE_EDIT' ) ) {
	define( 'DISALLOW_FILE_EDIT', true ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedConstantFound
}

/**
 * Убирает версию WordPress из HTML и из RSS.
 *
 * @return void
 */
function maderamas_core_remove_version_meta() {
	remove_action( 'wp_head', 'wp_generator' );
}
add_action( 'init', 'maderamas_core_remove_version_meta' );

/**
 * Отключает скрипты эмодзи.
 *
 * Экономит два запроса и около 15 КБ на каждой странице; современные браузеры
 * рисуют эмодзи сами.
 *
 * @return void
 */
function maderamas_core_disable_emojis() {
	remove_action( 'wp_head', 'print_emoji_detection_script', 7 );
	remove_action( 'admin_print_scripts', 'print_emoji_detection_script' );
	remove_action( 'wp_print_styles', 'print_emoji_styles' );
	remove_action( 'admin_print_styles', 'print_emoji_styles' );
	remove_filter( 'the_content_feed', 'wp_staticize_emoji' );
	remove_filter( 'comment_text_rss', 'wp_staticize_emoji' );
	remove_filter( 'wp_mail', 'wp_staticize_emoji_for_email' );
}
add_action( 'init', 'maderamas_core_disable_emojis' );

/**
 * Запрещает индексацию на всех окружениях, кроме продакшна.
 *
 * Пока идёт разработка, на домене живёт старый магазин на Tiendanube.
 * Если тестовый стенд попадёт в индекс, поисковик увидит две копии одного
 * каталога и склеит их — с непредсказуемым выбором главной версии.
 *
 * Значение берём из WP_ENVIRONMENT_TYPE в wp-config, а не из настроек в базе:
 * так признак привязан к окружению и не может быть случайно переключён
 * из админки или затёрт переносом базы с прода.
 *
 * @return void
 */
function maderamas_core_block_indexing_outside_production() {
	if ( 'production' === wp_get_environment_type() ) {
		return;
	}

	add_filter( 'pre_option_blog_public', '__return_zero' );
}
add_action( 'plugins_loaded', 'maderamas_core_block_indexing_outside_production' );

/**
 * Отключает XML-RPC.
 *
 * Магазину он не нужен, а брутфорс по нему — типовая атака на WordPress.
 *
 * @return bool
 */
function maderamas_core_disable_xmlrpc() {
	return false;
}
add_filter( 'xmlrpc_enabled', 'maderamas_core_disable_xmlrpc' );
