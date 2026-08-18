<?php
/**
 * Точка входа темы Maderamas.
 *
 * Тема отвечает только за оформление. Бизнес-логика магазина живёт в
 * wp-content/mu-plugins/, чтобы правка или замена темы её не ломала.
 *
 * @package Maderamas
 */

defined( 'ABSPATH' ) || exit;

/**
 * Версия темы. Используется для инвалидации кэша ассетов.
 */
define( 'MADERAMAS_VERSION', '0.1.0' );

/**
 * Базовая настройка темы.
 *
 * @return void
 */
function maderamas_setup() {
	load_theme_textdomain( 'maderamas', get_template_directory() . '/languages' );

	add_theme_support( 'wp-block-styles' );
	add_theme_support( 'responsive-embeds' );
	add_theme_support( 'editor-styles' );
	add_theme_support( 'html5', array( 'style', 'script' ) );

	// WooCommerce: подтверждаем поддержку, чтобы Woo не показывал предупреждение
	// и отдавал свои блочные шаблоны вместо legacy-разметки.
	add_theme_support( 'woocommerce' );
	add_theme_support( 'wc-product-gallery-zoom' );
	add_theme_support( 'wc-product-gallery-lightbox' );
	add_theme_support( 'wc-product-gallery-slider' );
}
add_action( 'after_setup_theme', 'maderamas_setup' );

/**
 * Подключение собранных ассетов темы.
 *
 * Файлы собираются @wordpress/scripts из src/ в build/ и в git не попадают —
 * сборка выполняется локально командой `npm run build` и в CI перед деплоем.
 *
 * @return void
 */
function maderamas_enqueue_assets() {
	$fonts_path = get_theme_file_path( 'assets/fonts/fonts.css' );

	if ( file_exists( $fonts_path ) ) {
		wp_enqueue_style(
			'maderamas-fonts',
			get_theme_file_uri( 'assets/fonts/fonts.css' ),
			array(),
			(string) filemtime( $fonts_path )
		);
	}

	$style_path = get_theme_file_path( 'build/style-index.css' );

	if ( file_exists( $style_path ) ) {
		wp_enqueue_style(
			'maderamas-styles',
			get_theme_file_uri( 'build/style-index.css' ),
			array(),
			(string) filemtime( $style_path )
		);
	}

	// @wordpress/scripts выделяет CSS, импортированный из style.css/scss, в
	// отдельный style-index.css (см. выше) — а CSS сторонних библиотек,
	// импортированный прямо из JS (тут — стили Swiper из src/carousels.js),
	// уходит в обычный build/index.css. Оба нужны на фронте.
	$vendor_style_path = get_theme_file_path( 'build/index.css' );

	if ( file_exists( $vendor_style_path ) ) {
		wp_enqueue_style(
			'maderamas-vendor-styles',
			get_theme_file_uri( 'build/index.css' ),
			array(),
			(string) filemtime( $vendor_style_path )
		);
	}

	$asset_path = get_theme_file_path( 'build/index.asset.php' );

	if ( file_exists( $asset_path ) ) {
		$asset = require $asset_path;

		wp_enqueue_script(
			'maderamas-scripts',
			get_theme_file_uri( 'build/index.js' ),
			$asset['dependencies'],
			$asset['version'],
			array( 'strategy' => 'defer' )
		);
	}
}
add_action( 'wp_enqueue_scripts', 'maderamas_enqueue_assets' );

/**
 * Категория для паттернов темы.
 *
 * Паттерны — это готовые секции, из которых заказчик собирает страницы,
 * не трогая код.
 *
 * @return void
 */
function maderamas_register_pattern_categories() {
	register_block_pattern_category(
		'maderamas',
		array( 'label' => __( 'Maderamas', 'maderamas' ) )
	);
}
add_action( 'init', 'maderamas_register_pattern_categories' );
