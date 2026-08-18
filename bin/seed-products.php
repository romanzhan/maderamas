<?php
/**
 * Наполнение каталога реальными товарами Madera Más.
 *
 * Идемпотентно: ищет товары по SKU, при повторном запуске обновляет,
 * а не дублирует. Источник данных — docs/content-guide.md (сведено из
 * Mercado Libre как источника истины + дополнено Tiendanube/Word-документом
 * там, где в ML не хватало цены). Фото — не заводим (плейсхолдер
 * WooCommerce), реальные фотографии заказчик готовит отдельно.
 *
 * Запуск (WP-CLI, идемпотентно — можно перезапускать):
 *   wp eval-file bin/seed-products.php
 *
 * @package Maderamas
 */

if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) {
	die( "Запускать только через WP-CLI: wp eval-file bin/seed-products.php\n" );
}

if ( ! class_exists( 'WooCommerce' ) ) {
	WP_CLI::error( 'WooCommerce не активен — нечего заполнять.' );
}

/**
 * Создаёт (или находит) категорию товара.
 *
 * @param string $name Название категории.
 * @return int ID термина.
 */
function maderamas_seed_category( $name ) {
	$term = get_term_by( 'name', $name, 'product_cat' );
	if ( $term ) {
		return (int) $term->term_id;
	}
	$result = wp_insert_term( $name, 'product_cat' );
	if ( is_wp_error( $result ) ) {
		WP_CLI::error( 'Не удалось создать категорию ' . $name . ': ' . $result->get_error_message() );
	}
	return (int) $result['term_id'];
}

/**
 * Создаёт (или находит) глобальный атрибут pa_color с нужными значениями.
 *
 * @param string[] $values Значения атрибута.
 * @return array{taxonomy: string, term_ids: array<string,int>} Таксономия и id термов по названию.
 */
function maderamas_seed_color_attribute( $values ) {
	$taxonomy = wc_attribute_taxonomy_name( 'color' );

	if ( ! taxonomy_exists( $taxonomy ) ) {
		$attribute_id = wc_create_attribute(
			array(
				'name'         => 'Color',
				'slug'         => 'color',
				'type'         => 'select',
				'order_by'     => 'menu_order',
				'has_archives' => false,
			)
		);
		if ( is_wp_error( $attribute_id ) ) {
			WP_CLI::error( 'Не удалось создать атрибут pa_color: ' . $attribute_id->get_error_message() );
		}
		// WooCommerce регистрирует таксономию на следующей загрузке — обновляем на лету.
		delete_transient( 'wc_attribute_taxonomies' );
		register_taxonomy(
			$taxonomy,
			'product',
			array(
				'hierarchical' => false,
				'show_ui'      => false,
				'query_var'    => true,
				'rewrite'      => false,
			)
		);
	}

	$term_ids = array();
	foreach ( $values as $value ) {
		$term = get_term_by( 'name', $value, $taxonomy );
		if ( $term ) {
			$term_ids[ $value ] = (int) $term->term_id;
			continue;
		}
		$result = wp_insert_term( $value, $taxonomy );
		if ( is_wp_error( $result ) ) {
			WP_CLI::error( 'Не удалось создать значение атрибута ' . $value . ': ' . $result->get_error_message() );
		}
		$term_ids[ $value ] = (int) $result['term_id'];
	}

	return array(
		'taxonomy' => $taxonomy,
		'term_ids' => $term_ids,
	);
}

/**
 * Собирает описание из строк характеристик — единый формат по каталогу.
 *
 * @param string $intro Вводный абзац.
 * @param array  $specs Пары «характеристика => значение».
 * @return string HTML-описание.
 */
function maderamas_seed_build_description( $intro, $specs ) {
	$html  = '<p>' . esc_html( $intro ) . '</p>';
	$html .= '<ul>';
	foreach ( $specs as $label => $value ) {
		$html .= '<li><strong>' . esc_html( $label ) . ':</strong> ' . esc_html( $value ) . '</li>';
	}
	$html .= '</ul>';
	return $html;
}

$maderamas_categories = array(
	'sillas'     => maderamas_seed_category( 'Sillas Evolutivas' ),
	'accesorios' => maderamas_seed_category( 'Accesorios' ),
	'montessori' => maderamas_seed_category( 'Montessori' ),
);

$maderamas_color = maderamas_seed_color_attribute( array( 'Roble Americano', 'Nogal', 'Blanco', 'Crudo' ) );

/**
 * Каталог — см. docs/content-guide.md для источников и обоснования цифр.
 */
$maderamas_products = array(
	array(
		'sku'                => 'MM-EVOL-INFANTIL',
		'name'               => 'Silla Evolutiva Infantil',
		'type'               => 'variable',
		'category'           => 'sillas',
		'short_description'  => 'Silla evolutiva de altura regulable, inspirada en la pedagogía Montessori. Acompaña a tu hijo desde el año hasta la infancia, sin necesidad de cambiar de silla.',
		'intro'              => 'La silla evolutiva infantil es el mueble perfecto para acompañar el crecimiento de tu hijo, con altura de asiento y reposapiés ajustables.',
		'specs'              => array(
			'Edad recomendada'  => '1 a 14 años',
			'Peso máximo'       => '80 kg',
			'Altura'            => '85 cm',
			'Ancho'             => '47 cm',
			'Profundidad'       => '49 cm',
			'Material'          => 'MDF de 18 mm',
		),
		'variations'         => array(
			array(
				'color' => 'Roble Americano',
				'price' => 154950,
			),
			array(
				'color' => 'Nogal',
				'price' => 166202.50,
			),
			array(
				'color' => 'Blanco',
				'price' => 147202.50,
			),
			array(
				'color' => 'Crudo',
				'price' => 129960,
			),
		),
	),
	array(
		'sku'                => 'MM-ALTA-EVOL',
		'name'               => 'Silla Alta de Comer Evolutiva',
		'type'               => 'variable',
		'category'           => 'sillas',
		'short_description'  => 'Silla alta evolutiva para comer, con 5 niveles de altura de asiento. Estructura firme en MDF macizo, ideal para el hogar, bares y restaurantes.',
		'intro'              => 'La Silla Alta de Comer Evolutiva de Madera Más acompaña el crecimiento de tus hijos, con altura de asiento regulable en 5 niveles (4 cm entre cada uno).',
		'specs'              => array(
			'Edad recomendada'    => '1 a 14 años',
			'Peso máximo'         => '80 kg',
			'Altura'              => '75 cm',
			'Ancho'               => '49 cm',
			'Profundidad'         => '47 cm',
			'Altura máx. asiento' => '58 cm',
			'Material'            => 'MDF de 18 mm',
		),
		'variations'         => array(
			array(
				'color' => 'Roble Americano',
				'price' => 142694.28,
			),
			array(
				'color' => 'Nogal',
				'price' => 166107.50,
			),
			array(
				'color' => 'Blanco',
				'price' => 130000,
			),
			array(
				'color' => 'Crudo',
				'price' => 110000,
			),
		),
	),
	array(
		'sku'               => 'MM-SILLA-BEBE',
		'name'              => 'Silla Infantil para Comer',
		'type'              => 'simple',
		'category'          => 'sillas',
		'price'             => 122550,
		'short_description' => 'Silla para bebés desde los 6 meses, con arnés de seguridad de 3 puntos, respaldo alto y apoyapiés. Diseño estable y de fácil limpieza.',
		'intro'             => 'Silla infantil diseñada pensando en la máxima seguridad del bebé: arnés de 3 puntos, respaldo alto y patas con inclinación antivuelco.',
		'specs'             => array(
			'Edad recomendada' => '6 meses a 4 años',
			'Peso máximo'      => '40 kg',
			'Altura'           => '85 cm',
			'Ancho'            => '38 cm',
			'Profundidad'      => '50 cm',
			'Material'         => 'MDF laminado',
			'Garantía'         => '60 días',
		),
	),
	array(
		'sku'               => 'MM-ALMOHADONES',
		'name'              => 'Almohadones para Silla Evolutiva',
		'type'              => 'simple',
		'category'          => 'accesorios',
		'price'             => 59000,
		'short_description' => 'Almohadones a medida para sillas evolutivas: mayor comodidad y postura correcta durante las comidas y el estudio. Funda desmontable y lavable.',
		'intro'             => 'Producto personalizado: al finalizar la compra, contactanos para confirmar el color y diseño de la tela.',
		'specs'             => array(
			'Relleno'  => 'Espuma',
			'Funda'    => 'Gabardina acrílica, desmontable y lavable',
			'Formato'  => 'Unidad',
		),
	),
	array(
		'sku'               => 'MM-MESA-EVOL',
		'name'              => 'Mesa para la Silla Evolutiva',
		'type'              => 'simple',
		'category'          => 'accesorios',
		'price'             => 30000,
		'short_description' => 'Mesa complementaria que se engancha a la silla evolutiva, ideal para comer, dibujar o jugar.',
		'intro'             => 'La mesa para silla evolutiva se engancha de forma segura y firme, transformando la silla en un espacio completo para las actividades diarias.',
		'specs'             => array(
			'Edad recomendada' => 'A partir de 1 año',
		),
	),
	array(
		'sku'               => 'MM-SET-MESA-2SILLAS',
		'name'              => 'Set Mesa + 2 Sillas Montessori',
		'type'              => 'simple',
		'category'          => 'montessori',
		'price'             => 164850,
		'short_description' => 'Juego de mesa y 2 sillas infantiles, ideal para dibujar, jugar y compartir momentos en un ambiente seguro y divertido.',
		'intro'             => 'Conjunto de mesa y 2 sillas infantiles en color crudo, listo para pintar o barnizar. Se entrega desarmado.',
		'specs'             => array(
			'Edad recomendada'    => '2 a 4 años',
			'Peso máx. (silla)'   => '35 kg',
			'Medidas silla'       => '22 × 26 × 44 cm (largo × ancho × alto)',
			'Medidas mesa'        => '40 × 60 × 40 cm (largo × ancho × alto)',
			'Material'            => 'MDF de 15 mm',
		),
	),
	array(
		'sku'               => 'MM-EQUILIBRISTAS',
		'name'              => 'Equilibristas Montessori Apilables x20',
		'type'              => 'simple',
		'category'          => 'montessori',
		'price'             => 18000,
		'short_description' => 'Juego de equilibrio Montessori: 20 personitas apilables de madera para construir, combinar y desarrollar la motricidad fina.',
		'intro'             => 'Juego didáctico inspirado en la metodología Montessori. Estimula la coordinación, la concentración y la creatividad.',
		'specs'             => array(
			'Cantidad'          => '20 piezas',
			'Medidas por pieza' => '6 × 6 cm',
			'Edad recomendada'  => 'Desde 1,5 años',
			'Material'          => 'MDF de 18 mm',
		),
	),
	array(
		'sku'               => 'MM-BANQUITO',
		'name'              => 'Banco Banquito La Estrella Montessori',
		'type'              => 'simple',
		'category'          => 'montessori',
		'price'             => 79950,
		'short_description' => 'Banquito escalera Montessori que ayuda a los más chicos a alcanzar lugares altos de forma segura, fomentando la autonomía.',
		'intro'             => 'Diseñado para fomentar la autonomía y el desarrollo de habilidades motoras, ideal para la cocina, el baño o actividades en familia.',
		'specs'             => array(
			'Altura'      => '50 cm',
			'Ancho'       => '37 cm',
			'Profundidad' => '41 cm',
		),
	),
	array(
		'sku'               => 'MM-PATA-PATA',
		'name'              => 'Pata Pata Montessori',
		'type'              => 'simple',
		'category'          => 'montessori',
		'price'             => 59900,
		'short_description' => 'Caminador Montessori que acompaña los primeros pasos, con ruedas giratorias de goma. Se entrega ensamblado.',
		'intro'             => 'El Caminador Montessori Pata Pata acompaña el desarrollo motor de los más chicos, permitiéndoles explorar su entorno de forma segura.',
		'specs'             => array(
			'Edad recomendada' => '6 meses a 2 años',
			'Peso máximo'      => '25 kg',
			'Altura'           => '35 cm',
			'Largo'            => '50 cm',
			'Material'         => 'MDF de 18 mm',
		),
	),
	array(
		'sku'               => 'MM-TORRE-APRENDIZAJE',
		'name'              => 'Torre de Aprendizaje Plegable Montessori',
		'type'              => 'simple',
		'category'          => 'montessori',
		'price'             => 179910,
		'short_description' => 'Torre de aprendizaje plegable: el complemento ideal para que los niños participen de forma segura en las actividades diarias.',
		'intro'             => 'Diseñada bajo principios Montessori, con barandillas de seguridad integradas y base amplia para mayor estabilidad. Uso recomendado bajo supervisión de un adulto.',
		'specs'             => array(
			'Peso máximo' => '60 kg',
			'Material'    => 'MDF de 15 mm',
		),
	),
);

$created = 0;
$updated = 0;

foreach ( $maderamas_products as $data ) {
	$existing_id = wc_get_product_id_by_sku( $data['sku'] );
	$is_variable = 'variable' === $data['type'];

	if ( $existing_id ) {
		$product = $is_variable ? new WC_Product_Variable( $existing_id ) : wc_get_product( $existing_id );
		++$updated;
	} else {
		$product = $is_variable ? new WC_Product_Variable() : new WC_Product_Simple();
		++$created;
	}

	$product->set_name( $data['name'] );
	$product->set_status( 'publish' );
	$product->set_catalog_visibility( 'visible' );
	$product->set_sku( $data['sku'] );
	$product->set_short_description( $data['short_description'] );
	$product->set_description( maderamas_seed_build_description( $data['intro'], $data['specs'] ) );
	$product->set_category_ids( array( $maderamas_categories[ $data['category'] ] ) );
	$product->set_manage_stock( false );
	$product->set_stock_status( 'instock' );

	if ( $is_variable ) {
		$attribute = new WC_Product_Attribute();
		$attribute->set_id( wc_attribute_taxonomy_id_by_name( 'color' ) );
		$attribute->set_name( $maderamas_color['taxonomy'] );
		$attribute->set_options( array_values( array_map(
			static function ( $variation ) use ( $maderamas_color ) {
				return $maderamas_color['term_ids'][ $variation['color'] ];
			},
			$data['variations']
		) ) );
		$attribute->set_position( 0 );
		$attribute->set_visible( true );
		$attribute->set_variation( true );
		$product->set_attributes( array( $attribute ) );
	}

	$product_id = $product->save();

	if ( $is_variable ) {
		// Убираем вариации, которых больше нет в источнике (на случай правок каталога).
		$existing_variation_ids = $product->get_children();
		$wanted_colors           = wp_list_pluck( $data['variations'], 'color' );

		foreach ( $existing_variation_ids as $variation_id ) {
			$variation       = new WC_Product_Variation( $variation_id );
			$variation_color = $variation->get_attribute( $maderamas_color['taxonomy'] );
			if ( ! in_array( $variation_color, $wanted_colors, true ) ) {
				$variation->delete( true );
			}
		}

		foreach ( $data['variations'] as $variation_data ) {
			$variation_id = null;
			foreach ( $product->get_children() as $child_id ) {
				$child = new WC_Product_Variation( $child_id );
				if ( $child->get_attribute( $maderamas_color['taxonomy'] ) === $variation_data['color'] ) {
					$variation_id = $child_id;
					break;
				}
			}

			$variation = $variation_id ? new WC_Product_Variation( $variation_id ) : new WC_Product_Variation();
			$variation->set_parent_id( $product_id );
			$variation->set_attributes( array( $maderamas_color['taxonomy'] => $variation_data['color'] ) );
			$variation->set_regular_price( (string) $variation_data['price'] );
			$variation->set_status( 'publish' );
			$variation->set_manage_stock( false );
			$variation->set_stock_status( 'instock' );
			$variation->save();
		}
	} else {
		$product->set_regular_price( (string) $data['price'] );
		$product->save();
	}

	WP_CLI::log( ( $existing_id ? 'Обновлён' : 'Создан' ) . ': ' . $data['name'] . ' (' . $data['sku'] . ')' );
}

WP_CLI::success( "Готово: создано $created, обновлено $updated товаров." );
