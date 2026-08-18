/**
 * Степпер количества (+/-) для полей `input.qty` WooCommerce.
 *
 * WooCommerce рендерит только голый `<input type="number">` — на десктопе
 * это нативный спиннер браузера (мелкие стрелочки), на части мобильных
 * браузеров вообще без визуальных кнопок. Оборачиваем существующий инпут
 * (не создаём новый — сохраняются name/min/max/step/value от WooCommerce)
 * кнопками +/- на иконках Lucide, с уважением к min/max/step/disabled.
 */

const MINUS_SVG =
	'<svg class="maderamas-icon size-4" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14" /></svg>';
const PLUS_SVG =
	'<svg class="maderamas-icon size-4" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg>';

/**
 * @return {void}
 */
export function initQuantitySteppers() {
	document
		.querySelectorAll( 'input.qty:not([data-stepper-ready])' )
		.forEach( setupStepper );
}

/**
 * @param {HTMLInputElement} input Поле количества WooCommerce.
 * @return {void}
 */
function setupStepper( input ) {
	input.setAttribute( 'data-stepper-ready', '' );

	const wrapper = document.createElement( 'div' );
	wrapper.className = 'quantity-stepper';

	input.insertAdjacentElement( 'beforebegin', wrapper );

	const minusButton = document.createElement( 'button' );
	minusButton.type = 'button';
	minusButton.className = 'quantity-stepper-button';
	minusButton.setAttribute( 'aria-label', 'Restar uno' );
	minusButton.innerHTML = MINUS_SVG;

	const plusButton = document.createElement( 'button' );
	plusButton.type = 'button';
	plusButton.className = 'quantity-stepper-button';
	plusButton.setAttribute( 'aria-label', 'Sumar uno' );
	plusButton.innerHTML = PLUS_SVG;

	wrapper.appendChild( minusButton );
	wrapper.appendChild( input );
	wrapper.appendChild( plusButton );

	const step = Number( input.step ) || 1;

	const clamp = ( value ) => {
		const min = input.min === '' ? -Infinity : Number( input.min );
		const max = input.max === '' ? Infinity : Number( input.max );
		return Math.min( Math.max( value, min ), max );
	};

	const setValue = ( value ) => {
		input.value = String( clamp( value ) );
		input.dispatchEvent( new Event( 'change', { bubbles: true } ) );
	};

	minusButton.addEventListener( 'click', () => {
		setValue( ( Number( input.value ) || 0 ) - step );
	} );

	plusButton.addEventListener( 'click', () => {
		setValue( ( Number( input.value ) || 0 ) + step );
	} );
}
