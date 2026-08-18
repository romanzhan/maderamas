<?php
/**
 * Title: Portada — bloque principal
 * Slug: maderamas/hero
 * Categories: maderamas
 * Description: Hero de la home — carrusel edge-to-edge donde cada slide es
 * una oferta autónoma (fondo + badge + título + texto + botones + foto del
 * producto cambian juntos), no solo una imagen rotando junto a texto fijo.
 * Datos y fotos — productos reales ya cargados en WooCommerce (fuente:
 * Mercado Libre, ver docs/content-guide.md), no placeholders.
 *
 * @package Maderamas
 */

if ( ! class_exists( 'WooCommerce' ) ) {
	return;
}

/**
 * Tres productos ya cargados que representan bien el catálogo: la silla
 * insignia, la silla alta y la línea Montessori (nueva). IDs vienen del
 * seed real (bin/seed-products.php) — si cambian los IDs en el futuro,
 * este pattern deja de mostrar el slide correspondiente en vez de romper
 * la página (guard `$maderamas_product instanceof WC_Product` más abajo).
 */
$maderamas_hero_slides = array(
	array(
		'product_id' => 13,
		'badge'      => _x( '1 a 14 años', 'Hero badge — rango de edad', 'maderamas' ),
		'heading'    => _x( 'La silla que crece con tu hijo', 'Hero heading', 'maderamas' ),
		'cta'        => _x( 'Ver silla evolutiva', 'Hero CTA', 'maderamas' ),
		'bg'         => 'bg-gradient-to-br from-accent/25 via-base to-base',
	),
	array(
		'product_id' => 18,
		'badge'      => _x( '5 niveles de altura', 'Hero badge — feature', 'maderamas' ),
		'heading'    => _x( 'Una silla alta que dura toda la infancia', 'Hero heading', 'maderamas' ),
		'cta'        => _x( 'Ver silla alta', 'Hero CTA', 'maderamas' ),
		'bg'         => 'bg-gradient-to-br from-promo-orange/15 via-base to-base',
	),
	array(
		'product_id' => 26,
		'badge'      => _x( 'Línea nueva', 'Hero badge — novedad', 'maderamas' ),
		'heading'    => _x( 'Línea Montessori para jugar y aprender', 'Hero heading', 'maderamas' ),
		'cta'        => _x( 'Ver línea Montessori', 'Hero CTA', 'maderamas' ),
		'bg'         => 'bg-gradient-to-br from-promo-green/15 via-base to-base',
	),
);

$maderamas_shop_url = function_exists( 'wc_get_page_permalink' ) ? wc_get_page_permalink( 'shop' ) : home_url( '/' );

/**
 * Arma los datos de un slide a partir del producto real — o null si el
 * producto no existe (evita romper la home si algún día se borra).
 *
 * Closure, no función global con nombre: este archivo puede requerirse
 * más de una vez por request (registro explícito + escaneo propio de
 * WordPress/editor de bloques, ver functions.php), y una función global
 * duplicada sería un fatal error "cannot redeclare".
 */
$maderamas_hero_build_slide = static function ( $maderamas_slide_config ) {
	$maderamas_product = wc_get_product( $maderamas_slide_config['product_id'] );

	if ( ! $maderamas_product instanceof WC_Product ) {
		return null;
	}

	$maderamas_image_id  = $maderamas_product->get_image_id();
	$maderamas_image_url = $maderamas_image_id ? wp_get_attachment_image_url( $maderamas_image_id, 'large' ) : wc_placeholder_img_src( 'large' );
	$maderamas_image_alt = $maderamas_image_id ? get_post_meta( $maderamas_image_id, '_wp_attachment_image_alt', true ) : $maderamas_product->get_name();

	return array_merge(
		$maderamas_slide_config,
		array(
			'name'      => $maderamas_product->get_name(),
			'permalink' => get_permalink( $maderamas_product->get_id() ),
			'excerpt'   => wp_strip_all_tags( $maderamas_product->get_short_description() ),
			'price'     => $maderamas_product->get_price_html(),
			'image_url' => $maderamas_image_url,
			'image_alt' => $maderamas_image_alt ? $maderamas_image_alt : $maderamas_product->get_name(),
		)
	);
};

$maderamas_hero_slides = array_values( array_filter( array_map( $maderamas_hero_build_slide, $maderamas_hero_slides ) ) );

if ( empty( $maderamas_hero_slides ) ) {
	return;
}
?>
<!-- wp:group {"align":"full","className":"js-swiper swiper relative","layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull js-swiper swiper relative" data-autoplay="7000" data-loop="<?php echo esc_attr( count( $maderamas_hero_slides ) > 1 ? 'true' : 'false' ); ?>">
	<div class="swiper-wrapper">
		<?php foreach ( $maderamas_hero_slides as $maderamas_index => $maderamas_slide ) : ?>
			<div class="swiper-slide">
				<div class="<?php echo esc_attr( $maderamas_slide['bg'] ); ?>">
					<div class="mx-auto grid max-w-[1240px] gap-8 px-4 py-12 sm:px-8 md:grid-cols-2 md:items-center md:gap-12 md:py-20">

						<div class="order-2 flex flex-col items-start md:order-1">
							<span class="!mb-4 inline-flex items-center rounded-pill bg-surface px-4 py-1.5 text-xs font-semibold tracking-wide text-contrast-2 shadow-soft">
								<?php echo esc_html( $maderamas_slide['badge'] ); ?>
							</span>

							<?php if ( 0 === $maderamas_index ) : ?>
								<h1 class="wp-block-heading !mb-4 !leading-[1.15] tracking-tight has-xxx-large-font-size"><?php echo esc_html( $maderamas_slide['heading'] ); ?></h1>
							<?php else : ?>
								<p class="wp-block-heading !mb-4 !leading-[1.15] tracking-tight has-xxx-large-font-size font-display font-semibold" role="heading" aria-level="1"><?php echo esc_html( $maderamas_slide['heading'] ); ?></p>
							<?php endif; ?>

							<p class="!mb-2 max-w-md has-contrast-2-color has-text-color has-large-font-size"><?php echo esc_html( $maderamas_slide['excerpt'] ); ?></p>

							<p class="!mb-6 text-contrast has-x-large-font-size font-display font-bold"><?php echo wp_kses_post( $maderamas_slide['price'] ); ?></p>

							<div class="flex flex-wrap gap-3">
								<a class="btn-primary" href="<?php echo esc_url( $maderamas_slide['permalink'] ); ?>"><?php echo esc_html( $maderamas_slide['cta'] ); ?></a>
								<a class="btn-outline" href="<?php echo esc_url( $maderamas_shop_url ); ?>"><?php echo esc_html_x( 'Ver catálogo', 'Hero CTA secundario', 'maderamas' ); ?></a>
							</div>
						</div>

						<div class="order-1 flex justify-center md:order-2">
							<img
								class="aspect-square w-full max-w-sm rounded-2xl bg-surface object-contain p-6 shadow-lifted sm:max-w-md"
								src="<?php echo esc_url( $maderamas_slide['image_url'] ); ?>"
								alt="<?php echo esc_attr( $maderamas_slide['image_alt'] ); ?>"
								<?php echo 0 === $maderamas_index ? 'fetchpriority="high"' : 'loading="lazy"'; ?>
								width="600"
								height="600"
							/>
						</div>

					</div>
				</div>
			</div>
		<?php endforeach; ?>
	</div>

	<?php if ( count( $maderamas_hero_slides ) > 1 ) : ?>
		<div class="swiper-pagination !bottom-4"></div>
		<button type="button" class="swiper-button-prev !left-4 !text-contrast" aria-label="<?php echo esc_attr_x( 'Anterior', 'Carrusel', 'maderamas' ); ?>"></button>
		<button type="button" class="swiper-button-next !right-4 !text-contrast" aria-label="<?php echo esc_attr_x( 'Siguiente', 'Carrusel', 'maderamas' ); ?>"></button>
	<?php endif; ?>
</div>
<!-- /wp:group -->
