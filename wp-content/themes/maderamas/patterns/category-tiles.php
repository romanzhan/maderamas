<?php
/**
 * Title: Plaquitas de categoría
 * Slug: maderamas/category-tiles
 * Categories: maderamas
 * Description: 4 plaquitas de color (paleta promo) — estructura del
 * brand-гайд (docs/design-system.md → «Структура главной страницы», п.4).
 *
 * @package Maderamas
 */

$maderamas_shop_url = function_exists( 'wc_get_page_permalink' ) ? wc_get_page_permalink( 'shop' ) : home_url( '/' );

$maderamas_tiles = array(
	array(
		'title' => _x( 'Sillas evolutivas', 'Category tile', 'maderamas' ),
		'sub'   => _x( 'Desde $110.000', 'Category tile', 'maderamas' ),
		'bg'    => 'bg-promo-electric',
		'url'   => $maderamas_shop_url,
	),
	array(
		'title' => _x( 'Línea Montessori', 'Category tile', 'maderamas' ),
		'sub'   => _x( 'Juegos y aprendizaje', 'Category tile', 'maderamas' ),
		'bg'    => 'bg-promo-raspberry',
		'url'   => $maderamas_shop_url,
	),
	array(
		'title' => _x( 'Almohadones', 'Category tile', 'maderamas' ),
		'sub'   => _x( 'Elegí tu diseño', 'Category tile', 'maderamas' ),
		'bg'    => 'bg-promo-yellow',
		'text'  => 'text-contrast',
		'url'   => $maderamas_shop_url,
	),
	array(
		'title' => _x( 'Envío gratis', 'Category tile', 'maderamas' ),
		'sub'   => _x( 'En tu 1ª compra', 'Category tile', 'maderamas' ),
		'bg'    => 'bg-promo-green',
		'url'   => $maderamas_shop_url,
	),
);
?>
<!-- wp:group {"className":"px-4 py-10 md:px-8","layout":{"type":"constrained","wideSize":"1240px"}} -->
<div class="wp-block-group px-4 py-10 md:px-8">
	<!-- wp:html -->
	<div class="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
		<?php foreach ( $maderamas_tiles as $maderamas_tile ) : ?>
			<a
				href="<?php echo esc_url( $maderamas_tile['url'] ); ?>"
				class="relative flex min-h-[120px] flex-col justify-between overflow-hidden rounded-2xl p-5 no-underline <?php echo esc_attr( $maderamas_tile['bg'] ); ?> <?php echo esc_attr( $maderamas_tile['text'] ?? 'text-white' ); ?>"
				style="text-decoration:none"
			>
				<span class="max-w-[80%] font-display text-[17px] font-extrabold leading-tight tracking-tight">
					<?php echo esc_html( $maderamas_tile['title'] ); ?>
				</span>
				<span class="text-[13px] opacity-90"><?php echo esc_html( $maderamas_tile['sub'] ); ?></span>
				<span class="absolute -bottom-3.5 -right-3.5 h-[70px] w-[70px] rounded-2xl bg-white/20"></span>
			</a>
		<?php endforeach; ?>
	</div>
	<!-- /wp:html -->
</div>
<!-- /wp:group -->
