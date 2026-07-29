#!/usr/bin/env node
/**
 * Первичная настройка локальной среды.
 *
 * Запускается один раз после `npm run env:start` и приводит свежий WordPress
 * к тому виду, в котором мы разрабатываем: испанская локаль, наша тема,
 * WooCommerce с аргентинскими настройками, человекопонятные ссылки.
 *
 * Скрипт идемпотентный — повторный запуск ничего не ломает.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/**
 * Точка входа wp-env.
 *
 * Вызываем её напрямую через node, а не через npx с shell: true. На Windows
 * оболочка съедает двойные кавычки в аргументах, из-за чего JSON вида
 * {"skipped":true} доезжает до WP-CLI как {skipped:true} и тот его отвергает.
 */
const WP_ENV_BIN = path.resolve( 'node_modules/@wordpress/env/bin/wp-env' );

if ( ! existsSync( WP_ENV_BIN ) ) {
	process.stderr.write(
		'Не найден @wordpress/env. Выполни "npm install" и повтори.\n'
	);
	process.exit( 1 );
}

const steps = [
	{
		title: 'Локаль сайта — испанский (Аргентина)',
		args: [ 'language', 'core', 'install', 'es_AR', '--activate' ],
		allowFailure: true, // Уже установлена — не повод падать.
	},
	{
		title: 'Часовой пояс',
		args: [ 'option', 'update', 'timezone_string', 'America/Argentina/Buenos_Aires' ],
	},
	{
		title: 'Человекопонятные ссылки',
		args: [ 'rewrite', 'structure', '/%postname%/', '--hard' ],
	},
	{
		title: 'Активация темы maderamas',
		args: [ 'theme', 'activate', 'maderamas' ],
	},
	{
		title: 'Активация WooCommerce',
		args: [ 'plugin', 'activate', 'woocommerce' ],
	},
	{
		title: 'Валюта — аргентинское песо',
		args: [ 'option', 'update', 'woocommerce_currency', 'ARS' ],
	},
	{
		title: 'Страна магазина — Аргентина',
		args: [ 'option', 'update', 'woocommerce_default_country', 'AR:C' ],
	},
	{
		title: 'Единицы измерения (см / кг)',
		args: [ 'option', 'update', 'woocommerce_dimension_unit', 'cm' ],
	},
	{
		title: 'Единица веса',
		args: [ 'option', 'update', 'woocommerce_weight_unit', 'kg' ],
	},
	{
		title: 'Пропустить мастер первичной настройки WooCommerce',
		args: [
			'option',
			'update',
			'woocommerce_onboarding_profile',
			'{"skipped":true}',
			'--format=json',
		],
	},
];

let failed = 0;

for ( const step of steps ) {
	process.stdout.write( `→ ${ step.title }\n` );

	const result = spawnSync(
		process.execPath,
		[ WP_ENV_BIN, 'run', 'cli', '--', 'wp', ...step.args ],
		{ stdio: 'inherit' }
	);

	if ( 0 !== result.status ) {
		if ( step.allowFailure ) {
			process.stdout.write( '  пропущено (шаг необязательный)\n' );
			continue;
		}
		process.stderr.write( `  ОШИБКА на шаге: ${ step.title }\n` );
		failed += 1;
	}
}

if ( failed > 0 ) {
	process.stderr.write(
		`\nЗавершено с ошибками: ${ failed }. Убедись, что Docker запущен и выполнено "npm run env:start".\n`
	);
	process.exit( 1 );
}

process.stdout.write(
	'\nЛокальная среда готова: http://localhost:8888 (админка: admin / password)\n'
);
