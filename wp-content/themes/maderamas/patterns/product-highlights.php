<?php
/**
 * Title: Destacados de catálogo
 * Slug: maderamas/product-highlights
 * Categories: maderamas
 * Description: Grilla de productos reales de WooCommerce (no hardcodeados
 * — así el carrito funciona y el catálogo se actualiza solo). Estructura
 * del brand-гайд, sección «Nuestras sillas» (docs/design-system.md).
 *
 * @package Maderamas
 */

$maderamas_shop_url = function_exists( 'wc_get_page_permalink' ) ? wc_get_page_permalink( 'shop' ) : home_url( '/' );
?>
<!-- wp:group {"className":"px-4 pb-10 md:px-8","layout":{"type":"constrained","wideSize":"1240px"}} -->
<div class="wp-block-group px-4 pb-10 md:px-8">

	<!-- wp:group {"className":"mb-5 flex items-baseline justify-between","layout":{"type":"flex","justifyContent":"space-between"}} -->
	<div class="wp-block-group mb-5 flex items-baseline justify-between">
		<!-- wp:heading {"level":3,"className":"!m-0 tracking-tight","fontSize":"x-large"} -->
		<h3 class="wp-block-heading !m-0 tracking-tight has-x-large-font-size"><?php echo esc_html_x( 'Nuestras sillas', 'Product grid heading', 'maderamas' ); ?></h3>
		<!-- /wp:heading -->

		<!-- wp:paragraph {"className":"!m-0"} -->
		<p class="!m-0"><a class="text-sm font-semibold text-primary no-underline transition-colors duration-base hover:text-primary-dark" href="<?php echo esc_url( $maderamas_shop_url ); ?>" style="text-decoration:none"><?php echo esc_html_x( 'Ver todas →', 'Product grid link', 'maderamas' ); ?></a></p>
		<!-- /wp:paragraph -->
	</div>
	<!-- /wp:group -->

	<!-- wp:woocommerce/product-collection {"queryId":1,"query":{"perPage":4,"pages":0,"offset":0,"postType":"product","order":"desc","orderBy":"date","search":"","exclude":[],"inherit":false,"taxQuery":{},"isProductCollectionBlock":true,"woocommerceOnSale":false,"woocommerceStockStatus":["instock","onbackorder"],"woocommerceAttributes":[],"woocommerceHandPickedProducts":[]},"tagName":"div","displayLayout":{"type":"flex","columns":4,"shrinkColumns":true},"className":"maderamas-product-grid"} -->
	<div class="wp-block-woocommerce-product-collection maderamas-product-grid">
		<!-- wp:woocommerce/product-template -->
			<!-- wp:group {"className":"card overflow-hidden","layout":{"type":"constrained"}} -->
			<div class="wp-block-group card overflow-hidden">
				<!-- wp:woocommerce/product-image {"showSaleBadge":true,"imageSizing":"thumbnail","isDescendentOfQueryLoop":true} -->
					<!-- wp:woocommerce/product-sale-badge {"isDescendentOfQueryLoop":true,"align":"left","className":"!bg-promo-raspberry"} /-->
				<!-- /wp:woocommerce/product-image -->

				<!-- wp:group {"className":"px-3 pb-3 pt-2.5","layout":{"type":"constrained"}} -->
				<div class="wp-block-group px-3 pb-3 pt-2.5">
					<!-- wp:post-title {"level":4,"isLink":true,"className":"!m-0 !mb-1 !no-underline","fontSize":"small","style":{"typography":{"lineHeight":"1.3"}}} /-->

					<!-- wp:woocommerce/product-price {"isDescendentOfQueryLoop":true,"fontSize":"medium","className":"!mb-2"} /-->

					<!-- wp:woocommerce/product-button {"isDescendentOfQueryLoop":true,"textAlign":"center","className":"is-style-outline !rounded-pill !w-full"} /-->
				</div>
				<!-- /wp:group -->
			</div>
			<!-- /wp:group -->
		<!-- /wp:woocommerce/product-template -->

		<!-- wp:woocommerce/product-collection-no-results -->
			<!-- wp:paragraph {"className":"text-muted"} -->
			<p class="text-muted"><?php echo esc_html_x( 'Todavía no hay productos publicados.', 'Empty product grid', 'maderamas' ); ?></p>
			<!-- /wp:paragraph -->
		<!-- /wp:woocommerce/product-collection-no-results -->
	</div>
	<!-- /wp:woocommerce/product-collection -->

</div>
<!-- /wp:group -->
