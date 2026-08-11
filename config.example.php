<?php
declare(strict_types=1);

// Copy this file to config.runtime.php on the server. config.runtime.php is
// ignored by Git and must never be committed.
return [
    'midtrans_merchant_id' => 'REPLACE_WITH_SANDBOX_MERCHANT_ID',
    'midtrans_client_key' => 'REPLACE_WITH_SANDBOX_CLIENT_KEY',
    'midtrans_server_key' => 'REPLACE_WITH_SANDBOX_SERVER_KEY',
    'sandbox_admin_password' => 'REPLACE_WITH_A_STRONG_ADMIN_PASSWORD',
    // Optional absolute path outside the public web root.
    'midtrans_order_storage' => '',
];
