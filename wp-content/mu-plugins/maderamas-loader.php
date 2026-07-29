<?php
/**
 * Plugin Name: Maderamas — загрузчик
 * Description: Подключает модули магазина. WordPress автоматически загружает из mu-plugins только файлы в корне каталога, подпапки игнорирует — поэтому нужен этот файл.
 * Version: 0.1.0
 * Author: Maderamas
 * Text Domain: maderamas
 *
 * @package Maderamas
 */

defined( 'ABSPATH' ) || exit;

/**
 * Модули в порядке загрузки.
 *
 * core → i18n → woo: язык должен быть определён до того, как WooCommerce
 * начнёт формировать строки и письма.
 */
$maderamas_modules = array(
	'maderamas-core/maderamas-core.php',
	'maderamas-i18n/maderamas-i18n.php',
	'maderamas-woo/maderamas-woo.php',
);

foreach ( $maderamas_modules as $maderamas_module ) {
	$maderamas_module_path = __DIR__ . '/' . $maderamas_module;

	if ( file_exists( $maderamas_module_path ) ) {
		require_once $maderamas_module_path;
	}
}

unset( $maderamas_modules, $maderamas_module, $maderamas_module_path );
