<?php
/**
 * Title: Portada — bloque principal
 * Slug: maderamas/hero
 * Categories: maderamas
 * Description: Секция-герой для главной страницы.
 *
 * @package Maderamas
 */

?>
<!-- wp:group {"style":{"spacing":{"padding":{"top":"var:preset|spacing|60","bottom":"var:preset|spacing|60"}}},"backgroundColor":"base-2","layout":{"type":"constrained","wideSize":"1240px"}} -->
<div class="wp-block-group has-base-2-background-color has-background" style="padding-top:var(--wp--preset--spacing--60);padding-bottom:var(--wp--preset--spacing--60)">
	<!-- wp:heading {"textAlign":"center","level":1,"fontSize":"xxx-large"} -->
	<h1 class="wp-block-heading has-text-align-center has-xxx-large-font-size"><?php echo esc_html_x( 'Muebles de madera para chicos', 'Pattern placeholder', 'maderamas' ); ?></h1>
	<!-- /wp:heading -->

	<!-- wp:paragraph {"align":"center","fontSize":"large","textColor":"contrast-2"} -->
	<p class="has-text-align-center has-contrast-2-color has-text-color has-large-font-size"><?php echo esc_html_x( 'Hechos a mano en Argentina, pensados para durar.', 'Pattern placeholder', 'maderamas' ); ?></p>
	<!-- /wp:paragraph -->

	<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"},"style":{"spacing":{"margin":{"top":"var:preset|spacing|40"}}}} -->
	<div class="wp-block-buttons" style="margin-top:var(--wp--preset--spacing--40)">
		<!-- wp:button -->
		<div class="wp-block-button"><a class="wp-block-button__link wp-element-button"><?php echo esc_html_x( 'Ver catálogo', 'Pattern placeholder', 'maderamas' ); ?></a></div>
		<!-- /wp:button -->
	</div>
	<!-- /wp:buttons -->
</div>
<!-- /wp:group -->
