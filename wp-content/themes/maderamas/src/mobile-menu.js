/**
 * Мобильное меню — бургер + выезжающая панель.
 *
 * Заменяет собой встроенное поведение блока core/navigation на мобильных
 * (его модальное окно плохо стилизуется и выглядит «из коробки» — прямое
 * замечание заказчика). Сам блок core/navigation в разметке остаётся
 * только как источник ссылок для десктопного меню; на мобильных его
 * триггер и модалка скрыты через CSS (см. src/style.css), а эта панель —
 * полностью наша, с явной анимацией, фокус-ловушкой и блокировкой скролла.
 *
 * Разметка ожидается такая (см. parts/header.html):
 * <button data-mobile-menu-open aria-controls="mobile-menu" aria-expanded="false">…</button>
 * <div id="mobile-menu" data-mobile-menu>
 *   <div data-mobile-menu-backdrop></div>
 *   <div data-mobile-menu-panel>
 *     <button data-mobile-menu-close>…</button>
 *     …ссылки…
 *   </div>
 * </div>
 */

const FOCUSABLE_SELECTOR =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Инициализирует мобильное меню, если разметка есть на странице.
 *
 * @return {void}
 */
export function initMobileMenu() {
	const menu = document.querySelector( '[data-mobile-menu]' );
	const openButton = document.querySelector( '[data-mobile-menu-open]' );

	if ( ! menu || ! openButton ) {
		return;
	}

	const closeButton = menu.querySelector( '[data-mobile-menu-close]' );
	const backdrop = menu.querySelector( '[data-mobile-menu-backdrop]' );
	const panel = menu.querySelector( '[data-mobile-menu-panel]' );

	let lastFocused = null;

	const isOpen = () => menu.classList.contains( 'is-open' );

	const open = () => {
		if ( isOpen() ) {
			return;
		}

		lastFocused = menu.ownerDocument.activeElement;
		menu.classList.add( 'is-open' );
		menu.removeAttribute( 'inert' );
		openButton.setAttribute( 'aria-expanded', 'true' );
		document.body.classList.add( 'overflow-hidden' );

		// Ждём кадр, чтобы transition сыграл от исходного transform, а не
		// применился мгновенно вместе с снятием display:none.
		window.requestAnimationFrame( () => {
			menu.classList.add( 'is-visible' );
			( closeButton || panel )?.focus();
		} );
	};

	const close = () => {
		if ( ! isOpen() ) {
			return;
		}

		menu.classList.remove( 'is-open', 'is-visible' );
		menu.setAttribute( 'inert', '' );
		openButton.setAttribute( 'aria-expanded', 'false' );
		document.body.classList.remove( 'overflow-hidden' );
		( lastFocused || openButton ).focus();
	};

	const trapFocus = ( event ) => {
		if ( 'Tab' !== event.key || ! panel ) {
			return;
		}

		const focusable = Array.from(
			panel.querySelectorAll( FOCUSABLE_SELECTOR )
		);

		if ( ! focusable.length ) {
			return;
		}

		const first = focusable[ 0 ];
		const last = focusable[ focusable.length - 1 ];
		const active = panel.ownerDocument.activeElement;

		if ( event.shiftKey && active === first ) {
			event.preventDefault();
			last.focus();
		} else if ( ! event.shiftKey && active === last ) {
			event.preventDefault();
			first.focus();
		}
	};

	openButton.addEventListener( 'click', open );
	closeButton?.addEventListener( 'click', close );
	backdrop?.addEventListener( 'click', close );

	menu.addEventListener( 'keydown', ( event ) => {
		if ( 'Escape' === event.key ) {
			close();
		} else {
			trapFocus( event );
		}
	} );

	// Переход по ссылке внутри панели — тоже закрываем, иначе меню
	// перекрывает следующую страницу до навигации.
	panel
		?.querySelectorAll( 'a[href]' )
		.forEach( ( link ) => link.addEventListener( 'click', close ) );
}
