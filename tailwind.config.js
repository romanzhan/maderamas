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

module.exports = {
	content: [
		'./wp-content/themes/maderamas/**/*.{php,html,js}',
		'./wp-content/mu-plugins/**/*.php',
	],
	theme: {
		extend: {
			colors,
			fontFamily,
			borderRadius: {
				pill: '999px',
			},
		},
	},
	// Хардкод-цвета вида bg-[#xxxxxx] эффективно запрещены — тема не грузит
	// tailwind CDN и не генерит произвольные классы вне content-скана, но
	// дисциплина всё равно на ревью: используем только именованные токены.
	plugins: [],
};
