/**
 * Конфиг Tailwind.
 *
 * Цвета НЕ хардкодятся здесь — читаются из theme.json темы, который
 * остаётся источником истины (нужен редактору блоков и обязателен по
 * правилам проекта, см. CLAUDE.md → «Дизайн-токены»). Если меняете
 * палитру — правьте theme.json, этот файл подхватит изменения сам.
 */

const fs = require( 'fs' );
const path = require( 'path' );

const themeJsonPath = path.resolve(
	__dirname,
	'wp-content/themes/maderamas/theme.json'
);
const themeJson = JSON.parse( fs.readFileSync( themeJsonPath, 'utf8' ) );

/**
 * { primary: '#B4633F', 'primary-dark': '#97482B', ... } из palette theme.json.
 */
const colors = Object.fromEntries(
	themeJson.settings.color.palette.map( ( { slug, color } ) => [ slug, color ] )
);

/**
 * { display: "'Onest', ...", body: "'Golos Text', ..." } из fontFamilies theme.json.
 */
const fontFamily = Object.fromEntries(
	themeJson.settings.typography.fontFamilies.map( ( { slug, fontFamily: family } ) => [
		slug,
		family.split( ',' ).map( ( f ) => f.trim() ),
	] )
);

/**
 * { small: '0.875rem', medium: '1rem', ... } из fontSizes theme.json.
 * Fluid-размеры (clamp) собирает сам WordPress через CSS-переменные —
 * здесь берём просто базовое (не fluid) значение как безопасный дефолт
 * для мест вне блочного редактора (например, компонентных классов).
 * Именованные слаги (small/medium/large/...) не пересекаются со
 * стоковой шкалой Tailwind (xs/sm/base/lg/...), поэтому это чистое
 * добавление, а не переопределение уже используемых классов.
 */
const fontSize = Object.fromEntries(
	themeJson.settings.typography.fontSizes.map( ( { slug, size } ) => [ slug, size ] )
);

// Числовые spacingSizes theme.json (10/20/30/40/50/60) и радиусы sm/md/lg/xl
// сознательно НЕ прокидываются в Tailwind: эти же имена — уже часть стоковой
// шкалы Tailwind (p-10, rounded-lg и т.д.) и уже используются в паттернах
// со стоковым смыслом (см. patterns/hero.php, parts/footer.html). Слияние
// переопределило бы их значение и тихо сломало готовую вёрстку. spacingSizes
// остаются доступны в редакторе блоков через var(--wp--preset--spacing--*).

/**
 * { fast: '150ms', base: '220ms', slow: '350ms' } из settings.custom.duration theme.json —
 * единая скорость переходов/анимаций на весь сайт (hover, dropdown, carousel).
 */
const transitionDuration = Object.fromEntries(
	Object.entries( themeJson.settings.custom.duration ).map( ( [ slug, value ] ) => [ slug, value ] )
);

/**
 * { soft: '0 2px 8px ...', lifted: '...', focus: '...' } из settings.shadow.presets theme.json.
 */
const boxShadow = Object.fromEntries(
	themeJson.settings.shadow.presets.map( ( { slug, shadow } ) => [ slug, shadow ] )
);

module.exports = {
	content: [
		'./wp-content/themes/maderamas/**/*.{php,html,js}',
		'./wp-content/mu-plugins/**/*.php',
	],
	theme: {
		extend: {
			colors,
			fontFamily,
			fontSize,
			borderRadius: {
				pill: '999px',
			},
			transitionDuration,
			boxShadow,
		},
	},
	// Хардкод-цвета вида bg-[#xxxxxx] эффективно запрещены — тема не грузит
	// tailwind CDN и не генерит произвольные классы вне content-скана, но
	// дисциплина всё равно на ревью: используем только именованные токены.
	plugins: [ require( '@tailwindcss/forms' )( { strategy: 'class' } ) ],
};
