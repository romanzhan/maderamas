<?php
/**
 * Настройки WooCommerce, специфичные для maderamas.com.ar.
 *
 * Наполняется в Фазах 2 и 4: атрибуты каталога, товары под заказ,
 * зоны доставки по провинциям и обязательные юридические блоки
 * (Botón de arrepentimiento, Defensa de las y los Consumidores).
 *
 * @package Maderamas
 */

defined( 'ABSPATH' ) || exit;

/**
 * Инициализация модуля.
 *
 * Все хуки регистрируем только если WooCommerce реально активен, иначе
 * отключение плагина уронит сайт фатальной ошибкой.
 *
 * @return void
 */
function maderamas_woo_bootstrap() {
	if ( ! class_exists( 'WooCommerce' ) ) {
		return;
	}

	// Хуки магазина добавляются здесь по мере реализации Фаз 2 и 4.
}
add_action( 'plugins_loaded', 'maderamas_woo_bootstrap' );
