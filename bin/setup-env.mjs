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

const steps = [
	{
		title: 'Локаль сайта — испанский (Аргентина)',
		args: [ 'language', 'core', 'install', 'es_AR', '--activate' ],
		allowFailure: true, // Уже установлена — не повод падать.
	},
	{
		title: 'Часовой пояс и формат даты',
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
		args: [ 'option', 'update', 'woocommerce_onboarding_profile', '{"skipped":true}', '--format=json' ],
		allowFailure: true,
	},
];

let failed = 0;

for ( const step of steps ) {
	process.stdout.write( `→ ${ step.title }\n` );

	const result = spawnSync(
		'npx',
		[ 'wp-env', 'run', '--quiet', 'cli', 'wp', ...step.args ],
		{ stdio: 'inherit', shell: process.platform === 'win32' }
	);

	if ( result.status !== 0 ) {
		if ( step.allowFailure ) {
			process.stdout.write( `  пропущено (шаг необязательный)\n` );
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

process.stdout.write( '\nЛокальная среда готова: http://localhost:8888 (админка: admin / password)\n' );
