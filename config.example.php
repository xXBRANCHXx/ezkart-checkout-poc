<?php
declare(strict_types=1);

// Copy this file to config.runtime.php on the server. config.runtime.php is
// ignored by Git and must never be committed.
return [
    // Each deployed website keeps a different ignored config.runtime.php.
    // test.ezkart.id uses "test" plus its test Supabase project/branch ref.
    // ezkart.id uses "production" plus its production Supabase project ref.
    'deployment_environment' => 'test',
    'supabase_url' => 'https://REPLACE_WITH_TEST_PROJECT_REF.supabase.co',
    'supabase_anon_key' => 'REPLACE_WITH_TEST_ANON_KEY',
    'supabase_expected_project_ref' => 'REPLACE_WITH_TEST_PROJECT_REF',
    'midtrans_merchant_id' => 'REPLACE_WITH_SANDBOX_MERCHANT_ID',
    'midtrans_client_key' => 'REPLACE_WITH_SANDBOX_CLIENT_KEY',
    'midtrans_server_key' => 'REPLACE_WITH_SANDBOX_SERVER_KEY',
    'biteship_api_key' => 'biteship_test.REPLACE_WITH_TEST_API_KEY',
    'biteship_origin_postal_code' => '12345',
    // Biteship needs a pickup contact and full address before it can create the
    // test shipment after Midtrans confirms payment.
    'biteship_origin_contact_name' => 'REPLACE_WITH_PICKUP_CONTACT_NAME',
    'biteship_origin_contact_phone' => 'REPLACE_WITH_PICKUP_PHONE',
    'biteship_origin_contact_email' => '',
    'biteship_origin_address' => 'REPLACE_WITH_COMPLETE_PICKUP_ADDRESS',
    'biteship_origin_note' => '',
    'biteship_shipper_organization' => 'Ezkart Sandbox',
    // Comma-separated Biteship courier codes enabled for test quotes.
    'biteship_couriers' => 'jne,sicepat,jnt',
    'sandbox_admin_password' => 'REPLACE_WITH_A_STRONG_ADMIN_PASSWORD',
    // Optional absolute path outside the public web root.
    'midtrans_order_storage' => '',
];
