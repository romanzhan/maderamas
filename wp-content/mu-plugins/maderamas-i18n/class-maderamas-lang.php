<?php
/**
 * Реестр языков сайта и определение текущего языка.
 *
 * @package Maderamas
 */

defined( 'ABSPATH' ) || exit;

/**
 * Языки сайта.
 */
final class Maderamas_Lang {

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
	 * Разбор префикса URL появится в Фазе 3; пока всегда язык по умолчанию.
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
	 * Проверяет, что язык поддерживается сайтом.
	 *
	 * @param string $lang Код языка.
	 * @return bool
	 */
	public static function is_supported( $lang ) {
		return array_key_exists( $lang, self::LANGUAGES );
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
		return sprintf( '_maderamas_i18n_%1$s_%2$s', $lang, $field );
	}
}
