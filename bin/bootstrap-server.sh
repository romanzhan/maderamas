#!/usr/bin/env bash
#
# Разовая настройка сервера под maderamas.com.ar.
#
# Запускается ОДИН раз на свежем сервере, до первого автодеплоя.
# Ставит ядро WordPress, плагины и приводит настройки к аргентинским.
# Тему и mu-plugins сюда привозит GitHub Actions, не этот скрипт.
#
# Использование:
#   export DB_NAME=maderamas DB_USER=maderamas DB_PASS='...'
#   export SITE_URL=https://dev.maderamas.com.ar
#   export ADMIN_USER=roman ADMIN_EMAIL=mr.romanzhan@gmail.com ADMIN_PASS='...'
#   export ENV_TYPE=staging          # staging | production
#   bash bootstrap-server.sh /var/www/maderamas
#
# Версии держим ровно те же, что в .wp-env.json и docs/plugins.md,
# иначе локалка и сервер начнут расходиться.

set -euo pipefail

WP_VERSION='7.0.2'
WC_VERSION='10.9.4'
MP_VERSION='8.9.0'

WEBROOT="${1:-}"

die() { printf 'ОШИБКА: %s\n' "$1" >&2; exit 1; }

[ -n "$WEBROOT" ] || die 'не указан каталог сайта. Пример: bash bootstrap-server.sh /var/www/maderamas'

for var in DB_NAME DB_USER DB_PASS SITE_URL ADMIN_USER ADMIN_EMAIL ADMIN_PASS ENV_TYPE; do
	[ -n "${!var:-}" ] || die "не задана переменная $var"
done

case "$ENV_TYPE" in
	staging|production) ;;
	*) die "ENV_TYPE должен быть staging или production, получено: $ENV_TYPE" ;;
esac

command -v wp >/dev/null || die 'не найден WP-CLI. Установка: https://wp-cli.org/#installing'

mkdir -p "$WEBROOT"
cd "$WEBROOT"

echo "→ Ядро WordPress $WP_VERSION"
if [ ! -f wp-includes/version.php ]; then
	wp core download --version="$WP_VERSION" --locale=es_AR
fi

echo '→ wp-config.php'
if [ ! -f wp-config.php ]; then
	wp config create \
		--dbname="$DB_NAME" \
		--dbuser="$DB_USER" \
		--dbpass="$DB_PASS" \
		--locale=es_AR \
		--extra-php <<-PHP
			/* Тип окружения. От него зависит запрет индексации в maderamas-core. */
			define( 'WP_ENVIRONMENT_TYPE', '$ENV_TYPE' );

			/* Код приезжает только деплоем из git. */
			define( 'DISALLOW_FILE_EDIT', true );
			define( 'DISALLOW_FILE_MODS', true );

			/* Отладку на сервере не показываем посетителям. */
			define( 'WP_DEBUG', $( [ "$ENV_TYPE" = 'staging' ] && echo true || echo false ) );
			define( 'WP_DEBUG_DISPLAY', false );
			define( 'WP_DEBUG_LOG', true );
		PHP
fi

echo '→ Установка WordPress'
if ! wp core is-installed 2>/dev/null; then
	wp core install \
		--url="$SITE_URL" \
		--title='Maderamas' \
		--admin_user="$ADMIN_USER" \
		--admin_email="$ADMIN_EMAIL" \
		--admin_password="$ADMIN_PASS" \
		--skip-email
fi

echo '→ Плагины'
# DISALLOW_FILE_MODS запрещает установку из админки, но не через WP-CLI с --force.
wp plugin install "https://downloads.wordpress.org/plugin/woocommerce.${WC_VERSION}.zip" --force --activate
wp plugin install "https://downloads.wordpress.org/plugin/woocommerce-mercadopago.${MP_VERSION}.zip" --force
wp plugin delete hello akismet 2>/dev/null || true

echo '→ Настройки сайта'
wp language core install es_AR --activate 2>/dev/null || true
wp option update timezone_string 'America/Argentina/Buenos_Aires'
wp rewrite structure '/%postname%/' --hard

echo '→ Настройки WooCommerce'
wp option update woocommerce_currency ARS
wp option update woocommerce_default_country 'AR:C'
wp option update woocommerce_dimension_unit cm
wp option update woocommerce_weight_unit kg
wp option update woocommerce_onboarding_profile '{"skipped":true}' --format=json

# URL сохраняем как на Tiendanube: /productos/ и /productos/<slug>/.
# Это позволяет пережить переезд без редиректов на карточках товаров.
echo '→ Структура URL каталога (совместимость с Tiendanube)'
wp option update woocommerce_permalinks '{"product_base":"/productos","category_base":"categoria","tag_base":"etiqueta","attribute_base":""}' --format=json
SHOP_PAGE="$( wp option get woocommerce_shop_page_id 2>/dev/null || echo 0 )"
if [ "$SHOP_PAGE" != '0' ] && [ -n "$SHOP_PAGE" ]; then
	wp post update "$SHOP_PAGE" --post_name=productos
fi
wp rewrite flush --hard

echo '→ Тема'
if wp theme is-installed maderamas 2>/dev/null; then
	wp theme activate maderamas
	# Лишние темы на сервере — это неиспользуемый код, который всё равно
	# надо обновлять. Держим только свою.
	wp theme list --status=inactive --field=name | xargs -r wp theme delete 2>/dev/null || true
else
	echo '  тема ещё не выкачена — активируйте после первого деплоя:'
	echo '    wp theme activate maderamas'
fi

cat <<EOF

Готово. Сайт: $SITE_URL
Окружение: $ENV_TYPE

Дальше:
  1. Проверить HTTPS и автопродление сертификата.
  2. Для staging — закрыть сайт Basic Auth на уровне nginx.
     Запрет индексации уже включён кодом (maderamas-core), но пароль надёжнее.
  3. Создать SSH-ключ только для деплоя и положить публичную часть
     в ~/.ssh/authorized_keys, приватную — в секрет DEPLOY_SSH_KEY на GitHub.
  4. Настроить ежедневный бэкап базы и uploads.
EOF
