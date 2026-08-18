<?php
/**
 * Title: Banner promocional
 * Slug: maderamas/promo-banner
 * Categories: maderamas
 * Description: Banner de acción con gradiente promo — estructura del
 * brand-гайд (docs/design-system.md, п.6). Texto de ejemplo, editar
 * desde el editor de bloques para cada campaña real.
 *
 * @package Maderamas
 */

$maderamas_shop_url = function_exists( 'wc_get_page_permalink' ) ? wc_get_page_permalink( 'shop' ) : home_url( '/' );
?>
<!-- wp:group {"className":"px-4 pb-14 md:px-8","layout":{"type":"constrained","wideSize":"1240px"}} -->
<div class="wp-block-group px-4 pb-14 md:px-8">
	<!-- wp:group {"className":"flex flex-col items-start justify-between gap-6 rounded-2xl bg-gradient-to-r from-promo-orange to-promo-raspberry p-8 text-white sm:flex-row sm:items-center md:p-10","layout":{"type":"flex","justifyContent":"space-between"}} -->
	<div class="wp-block-group flex flex-col items-start justify-between gap-6 rounded-2xl bg-gradient-to-r from-promo-orange to-promo-raspberry p-8 text-white sm:flex-row sm:items-center md:p-10">

		<!-- wp:group {"layout":{"type":"constrained"}} -->
		<div class="wp-block-group">
			<!-- wp:heading {"level":3,"className":"!m-0 !text-white tracking-tight","fontSize":"xx-large","style":{"typography":{"lineHeight":"1.05"}}} -->
			<h3 class="wp-block-heading !m-0 !text-white tracking-tight has-xx-large-font-size"><?php echo esc_html_x( 'Semana del bebé', 'Promo banner heading', 'maderamas' ); ?><br><?php echo esc_html_x( 'hasta 25% OFF', 'Promo banner heading', 'maderamas' ); ?></h3>
			<!-- /wp:heading -->

			<!-- wp:paragraph {"className":"!mt-2 !mb-0 !text-white opacity-95","fontSize":"medium"} -->
			<p class="!mt-2 !mb-0 !text-white opacity-95 has-medium-font-size"><?php echo esc_html_x( 'En sillas evolutivas y accesorios seleccionados.', 'Promo banner subtext', 'maderamas' ); ?></p>
			<!-- /wp:paragraph -->
		</div>
		<!-- /wp:group -->

		<!-- wp:buttons {"layout":{"type":"flex"}} -->
		<div class="wp-block-buttons">
			<!-- wp:button {"className":"!rounded-pill !bg-white !text-promo-raspberry shrink-0","style":{"typography":{"fontWeight":"800"}}} -->
			<div class="wp-block-button !rounded-pill !bg-white !text-promo-raspberry shrink-0"><a class="wp-block-button__link wp-element-button" href="<?php echo esc_url( $maderamas_shop_url ); ?>"><?php echo esc_html_x( 'Ver ofertas', 'Promo banner CTA', 'maderamas' ); ?></a></div>
			<!-- /wp:button -->
		</div>
		<!-- /wp:buttons -->

	</div>
	<!-- /wp:group -->
</div>
<!-- /wp:group -->
