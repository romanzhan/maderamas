/**
 * Точка входа фронтенд-ассетов темы.
 *
 * Стили импортируются сюда, чтобы @wordpress/scripts собрал их
 * в build/style-index.css.
 */

import './style.css';
import { initCarousels } from './carousels';
import { initMobileMenu } from './mobile-menu';

document.addEventListener( 'DOMContentLoaded', () => {
	initCarousels();
	initMobileMenu();
} );
