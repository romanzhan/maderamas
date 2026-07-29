<?php
/**
 * Собственный слой перевода.
 *
 * Модель данных: ОДИН пост на все языки, переводы лежат в post_meta.
 * Мы сознательно не дублируем посты по языкам (как это делают WPML и Polylang),
 * потому что у товара WooCommerce должны оставаться единые цена и остаток на складе.
 * При дублировании постов склад разъезжается по языкам — это главный источник
 * ошибок в мультиязычных магазинах.
 *
 * Полная реализация — Фаза 3. Здесь только каркас: определение языка и константы,
 * на которые опираются остальные модули.
 *
 * @package Maderamas
 */

defined( 'ABSPATH' ) || exit;

/**
 * Реестр языков сайта и определение текущего языка.
 */
final class Mdr_Lang {

	/**
	 * Язык по умолчанию. Отдаётся без префикса в URL.
	 *
	 * @var string
	 */
	const DEFAULT_LANG = 'es';

	/**
	 * Поддерживаемые языки: код языка => локаль WordPress.
	 *
	 * Добавление 'pt' и 'ru' сводится к правке этого массива плюс переводы контента.
	 *
	 * @var array<string, string>
	 */
	const LANGUAGES = array(
		'es' => 'es_AR',
		'en' => 'en_US',
	);

	/**
	 * Текущий язык запроса. Null — ещё не определён.
	 *
	 * @var string|null
	 */
	private static $current = null;

	/**
	 * Возвращает код текущего языка.
	 *
	 * @return string
	 */
	public static function current() {
		if ( null === self::$current ) {
			self::$current = self::DEFAULT_LANG;
		}

		return self::$current;
	}

	/**
	 * Текущий язык отличается от языка по умолчанию.
	 *
	 * @return bool
	 */
	public static function is_translated() {
		return self::DEFAULT_LANG !== self::current();
	}

	/**
	 * Имя мета-ключа, в котором хранится перевод поля.
	 *
	 * @param string $field Имя поля: title, content, excerpt, slug.
	 * @param string $lang  Код языка.
	 * @return string
	 */
	public static function meta_key( $field, $lang ) {
		return sprintf( '_mdr_i18n_%1$s_%2$s', $lang, $field );
	}
}
