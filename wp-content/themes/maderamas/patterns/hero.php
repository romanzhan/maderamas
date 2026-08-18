<?php
/**
 * Title: Portada — bloque principal
 * Slug: maderamas/hero
 * Categories: maderamas
 * Description: Hero de la home — texto + carrusel. Estructura aprobada en
 * el brand-гайд (docs/design-system.md → «Структура главной страницы»),
 * con la incorporación del carrusel pedida por el cliente por encima del
 * mockup base.
 *
 * @package Maderamas
 */

$maderamas_hero_slides = array(
	array(
		'label' => _x( 'Silla Evolutiva Infantil', 'Hero slide placeholder', 'maderamas' ),
		'badge' => '-20%',
	),
	array(
		'label' => _x( 'Silla Alta de Comer Evolutiva', 'Hero slide placeholder', 'maderamas' ),
		'badge' => '',
	),
	array(
		'label' => _x( 'Línea Montessori', 'Hero slide placeholder', 'maderamas' ),
		'badge' => '',
	),
);

// WooCommerce siempre debería estar activo en este sitio, pero no lo damos
// por hecho — si se desactiva, el CTA cae de vuelta a la home en lugar de
// romper la página (regla del proyecto, ver CLAUDE.md → WooCommerce).
$maderamas_shop_url = function_exists( 'wc_get_page_permalink' ) ? wc_get_page_permalink( 'shop' ) : home_url( '/' );
?>
<!-- wp:group {"className":"bg-gradient-to-b from-[#F3EADD] to-surface","layout":{"type":"constrained","wideSize":"1240px"}} -->
<div class="wp-block-group bg-gradient-to-b from-[#F3EADD] to-surface">
	<!-- wp:group {"className":"grid gap-10 py-10 md:grid-cols-2 md:items-center md:gap-12 md:py-16","layout":{"type":"default"}} -->
	<div class="wp-block-group grid gap-10 py-10 md:grid-cols-2 md:items-center md:gap-12 md:py-16">

		<!-- wp:group {"className":"order-2 md:order-1","layout":{"type":"default"}} -->
		<div class="wp-block-group order-2 md:order-1">
			<!-- wp:paragraph {"className":"!mb-4 inline-block rounded-pill bg-[#EBEDE0] px-4 py-1.5 text-xs font-semibold tracking-wide text-[#4E5738]","fontSize":"small"} -->
			<p class="!mb-4 inline-block rounded-pill bg-[#EBEDE0] px-4 py-1.5 text-xs font-semibold tracking-wide text-[#4E5738] has-small-font-size"><?php echo esc_html_x( 'DE 6 MESES A 10 AÑOS', 'Hero badge', 'maderamas' ); ?></p>
			<!-- /wp:paragraph -->

			<!-- wp:heading {"level":1,"className":"!mb-4 !leading-[1.05] tracking-tight","fontSize":"xxx-large"} -->
			<h1 class="wp-block-heading !mb-4 !leading-[1.05] tracking-tight has-xxx-large-font-size"><?php echo esc_html_x( 'La silla que crece con tu hijo', 'Hero heading', 'maderamas' ); ?></h1>
			<!-- /wp:heading -->

			<!-- wp:paragraph {"className":"!mb-6 max-w-md","textColor":"contrast-2","fontSize":"large"} -->
			<p class="!mb-6 max-w-md has-contrast-2-color has-text-color has-large-font-size"><?php echo esc_html_x( 'Madera maciza, altura y profundidad ajustables. Una compra para toda la infancia.', 'Hero paragraph', 'maderamas' ); ?></p>
			<!-- /wp:paragraph -->

			<!-- wp:buttons {"layout":{"type":"flex","flexWrap":"wrap"}} -->
			<div class="wp-block-buttons">
				<!-- wp:button {"className":"!rounded-pill"} -->
				<div class="wp-block-button !rounded-pill"><a class="wp-block-button__link wp-element-button" href="<?php echo esc_url( $maderamas_shop_url ); ?>"<?php echo esc_html_x( 'Ver sillas', 'Hero CTA', 'maderamas' ); ?></a></div>
				<!-- /wp:button -->

				<!-- wp:button {"className":"is-style-outline !rounded-pill"} -->
				<div class="wp-block-button is-style-outline !rounded-pill"><a class="wp-block-button__link wp-element-button" href="#como-funciona"><?php echo esc_html_x( 'Cómo funciona', 'Hero CTA', 'maderamas' ); ?></a></div>
				<!-- /wp:button -->
			</div>
			<!-- /wp:buttons -->
		</div>
		<!-- /wp:group -->

		<!-- wp:html -->
		<div class="order-1 md:order-2">
			<div
				class="js-swiper swiper relative overflow-hidden rounded-2xl"
				data-autoplay="6000"
				data-loop="true"
			>
				<div class="swiper-wrapper">
					<?php foreach ( $maderamas_hero_slides as $maderamas_slide ) : ?>
						<div class="swiper-slide">
							<div class="relative flex aspect-[4/3] items-center justify-center [background-image:repeating-linear-gradient(45deg,#E4D3B8,#E4D3B8_12px,#DCC9A8_12px,#DCC9A8_24px)] sm:aspect-[16/10]">
								<?php if ( ! empty( $maderamas_slide['badge'] ) ) : ?>
									<span class="absolute right-4 top-4 flex h-14 w-14 items-center justify-center rounded-full bg-promo-raspberry font-display text-sm font-extrabold text-white shadow-lg">
										<?php echo esc_html( $maderamas_slide['badge'] ); ?>
									</span>
								<?php endif; ?>
								<span class="rounded-lg bg-surface/90 px-4 py-2 font-mono text-xs text-muted">
									<?php echo esc_html_x( 'FOTO', 'Placeholder de imagen', 'maderamas' ); ?> · <?php echo esc_html( $maderamas_slide['label'] ); ?>
								</span>
							</div>
						</div>
					<?php endforeach; ?>
				</div>
				<div class="swiper-pagination"></div>
				<button type="button" class="swiper-button-prev !text-contrast" aria-label="<?php echo esc_attr_x( 'Anterior', 'Carrusel', 'maderamas' ); ?>"></button>
				<button type="button" class="swiper-button-next !text-contrast" aria-label="<?php echo esc_attr_x( 'Siguiente', 'Carrusel', 'maderamas' ); ?>"></button>
			</div>
		</div>
		<!-- /wp:html -->

	</div>
	<!-- /wp:group -->
</div>
<!-- /wp:group -->
