/**
 * Галерея товара — Swiper (главный слайдер + миниатюры + зум по клику).
 *
 * Заменяет встроенную JS-галерею WooCommerce (flexslider/zoom/photoswipe —
 * отключена в functions.php, задача 015): та давала слайдам реальные
 * пропорции конкретного фото, из-за чего высота «плавала» от слайда к
 * слайду — прямая жалоба заказчика. Разметку блока `woocommerce/product-image-gallery`
 * не трогаем (данные/alt/atributos — от WooCommerce, настоящие), эта
 * функция только переразмечает существующие узлы под Swiper и достраивает
 * полосу миниатюр из тех же data-атрибутов, которые Woo уже вывел
 * (data-thumb/data-thumb-alt) — новых данных не запрашивает.
 */

import Swiper from 'swiper';
import { Thumbs, Zoom } from 'swiper/modules';

import 'swiper/css';
import 'swiper/css/thumbs';
import 'swiper/css/zoom';

/**
 * Инициализирует все галереи товара на странице (обычно одна).
 *
 * @return {void}
 */
export function initProductGallery() {
	document
		.querySelectorAll( '.woocommerce-product-gallery' )
		.forEach( setupGallery );
}

/**
 * @param {HTMLElement} gallery Контейнер `.woocommerce-product-gallery`.
 * @return {void}
 */
function setupGallery( gallery ) {
	const wrapper = gallery.querySelector(
		'.woocommerce-product-gallery__wrapper'
	);
	const items = wrapper
		? Array.from(
				wrapper.querySelectorAll(
					'.woocommerce-product-gallery__image'
				)
		  )
		: [];

	if ( ! wrapper || ! items.length ) {
		return;
	}

	// Основной слайдер: переразмечаем уже существующие узлы (не создаём
	// новые — alt/src/href уже настоящие, от WooCommerce).
	wrapper.classList.add( 'swiper', 'maderamas-gallery-main' );

	items.forEach( ( item ) => {
		item.classList.add( 'swiper-slide' );

		const link = item.querySelector( 'a' );

		if ( link ) {
			// Это была ссылка на полноразмерное фото (для JS-выключенного
			// сценария/старой галереи) — теперь зум делает Swiper, переход
			// по клику не нужен и уводил бы со страницы.
			link.classList.add( 'swiper-zoom-container' );
			link.addEventListener( 'click', ( event ) =>
				event.preventDefault()
			);
		}
	} );

	// swiper-wrapper должен быть прямым контейнером слайдов — оборачиваем
	// сами элементы, раз WooCommerce отдал их плоским списком в wrapper.
	const slidesWrapper = document.createElement( 'div' );
	slidesWrapper.className = 'swiper-wrapper';
	items.forEach( ( item ) => slidesWrapper.appendChild( item ) );
	wrapper.appendChild( slidesWrapper );

	// Полоса миниатюр — строим из тех же data-thumb/data-thumb-alt, что
	// Woo уже вывела на каждом слайде (не новый запрос данных).
	const thumbsEl = document.createElement( 'div' );
	thumbsEl.className = 'swiper maderamas-gallery-thumbs';
	thumbsEl.setAttribute( 'aria-label', 'Miniaturas de la galería' );

	const thumbsWrapper = document.createElement( 'div' );
	thumbsWrapper.className = 'swiper-wrapper';
	thumbsEl.appendChild( thumbsWrapper );

	items.forEach( ( item ) => {
		const thumbSrc = item.dataset.thumb;

		if ( ! thumbSrc ) {
			return;
		}

		const slide = document.createElement( 'div' );
		slide.className = 'swiper-slide';

		const img = document.createElement( 'img' );
		img.src = thumbSrc;
		img.alt = item.dataset.thumbAlt || '';
		img.loading = 'lazy';

		slide.appendChild( img );
		thumbsWrapper.appendChild( slide );
	} );

	gallery.insertAdjacentElement( 'afterend', thumbsEl );

	const showThumbs = items.length > 1;
	thumbsEl.hidden = ! showThumbs;

	const thumbsSwiper = showThumbs
		? new Swiper( thumbsEl, {
				slidesPerView: 4,
				spaceBetween: 10,
				watchSlidesProgress: true,
				breakpoints: {
					480: { slidesPerView: 5 },
				},
		  } )
		: null;

	// Навигация — свайпом и по клику на миниатюру (Thumbs module); стрелки
	// назад/вперёд не нужны, когда снимок один — тогда и Swiper вообще
	// не даёт листать (loop:false, слайд один).
	new Swiper( wrapper, {
		modules: [ Thumbs, Zoom ],
		loop: false,
		zoom: {
			maxRatio: 3,
		},
		thumbs: thumbsSwiper ? { swiper: thumbsSwiper } : undefined,
	} );

	// Исходная разметка приходит с style="opacity:0" (WooCommerce её
	// показывала только после того, как flexslider посчитает высоты) —
	// снимаем, Swiper уже сам управляет раскладкой без такого прыжка.
	gallery.style.opacity = '';
	gallery.style.transition = '';
}
