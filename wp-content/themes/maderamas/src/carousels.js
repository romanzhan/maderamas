/**
 * Инициализация каруселей (Swiper) — библиотека, не самописная реализация
 * (см. docs/design-system.md). Один общий инициализатор на все карусели
 * сайта (hero, галерея товара, отзывы и т.п. — задачи 003+), настройка
 * через data-атрибуты на самом элементе `.js-swiper`, чтобы не плодить
 * отдельный JS-модуль на каждую секцию.
 */

import Swiper from 'swiper';
import { Autoplay, Navigation, Pagination } from 'swiper/modules';

import 'swiper/css';
import 'swiper/css/pagination';
import 'swiper/css/navigation';

/**
 * Инициализирует все карусели на странице.
 *
 * Разметка ожидается такая:
 * <div class="js-swiper swiper" data-autoplay="6000" data-loop="true">
 *   <div class="swiper-wrapper">...</div>
 *   <div class="swiper-pagination"></div>
 *   <div class="swiper-button-prev"></div>
 *   <div class="swiper-button-next"></div>
 * </div>
 *
 * @return {void}
 */
export function initCarousels() {
	const reduceMotion = window.matchMedia(
		'(prefers-reduced-motion: reduce)'
	).matches;

	document.querySelectorAll( '.js-swiper' ).forEach( ( el ) => {
		const autoplayDelay = Number( el.dataset.autoplay ) || 0;
		const loop = el.dataset.loop === 'true';

		new Swiper( el, {
			modules: [ Autoplay, Navigation, Pagination ],
			loop,
			speed: 500,
			slidesPerView: 1,
			spaceBetween: 16,
			pagination: el.querySelector( '.swiper-pagination' )
				? { el: '.swiper-pagination', clickable: true }
				: false,
			navigation: el.querySelector( '.swiper-button-next' )
				? {
						nextEl: '.swiper-button-next',
						prevEl: '.swiper-button-prev',
				  }
				: false,
			// Уважаем системную настройку — не крутим автоплей, если
			// пользователь просил меньше движения на экране.
			autoplay:
				autoplayDelay && ! reduceMotion
					? { delay: autoplayDelay, disableOnInteraction: true }
					: false,
		} );
	} );
}
