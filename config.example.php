<?php
declare(strict_types=1);

return [
    'app_enabled' => 'false',
    'app_mode' => 'sandbox',
    'app_url' => 'https://checkout.zerofoods.id',
    'app_signing_secret' => 'replace-with-at-least-32-random-characters',
    'admin_password_hash' => password_hash('replace-this-password', PASSWORD_DEFAULT),

    'db_host' => 'localhost',
    'db_port' => '3306',
    'db_name' => 'replace_database_name',
    'db_user' => 'replace_database_user',
    'db_password' => 'replace_database_password',

    'zero_merchant_secret' => 'replace-with-a-separate-random-integration-secret',
    'allowed_return_hosts' => 'zerofoods.id,www.zerofoods.id',
    'merchant_platform_fee' => '0',

    'biteship_api_token' => 'biteship_test.REPLACE_ME',
    // Current API reference examples use the raw token. Set to "Bearer" only if Biteship support requires it.
    'biteship_authorization_prefix' => '',
    'biteship_origin_area_id' => 'REPLACE_WITH_BITESHIP_AREA_ID',
    'biteship_origin_area_name' => 'REPLACE_WITH_WAREHOUSE_AREA_AND_POSTCODE',
    'biteship_origin_contact_name' => 'ZERO Fulfillment',
    'biteship_origin_contact_phone' => 'REPLACE_WITH_PICKUP_PHONE',
    'biteship_origin_address' => 'REPLACE_WITH_PICKUP_ADDRESS',
    'biteship_couriers' => 'jne,sicepat,anteraja,jnt,tiki',
    'biteship_webhook_header' => 'X-Ezkart-Webhook-Secret',
    'biteship_webhook_secret' => 'replace-with-a-random-webhook-secret',

    'duitku_merchant_code' => 'REPLACE_WITH_SANDBOX_MERCHANT_CODE',
    'duitku_merchant_key' => 'REPLACE_WITH_SANDBOX_MERCHANT_KEY',
    'duitku_enforce_callback_ip' => 'false',
];
