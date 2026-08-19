<?php
declare(strict_types=1);

// Copy this file to config.runtime.php on the server. config.runtime.php is
// ignored by Git and must never be committed.
return [
    // Each deployed website keeps a different ignored config.runtime.php.
    // Supabase is Auth-only. D1 and R2 are reached through the matching
    // Cloudflare Worker rather than a PostgreSQL connection string.
    'deployment_environment' => 'test',
    'cloudflare_api_url' => 'https://api-test.ezkart.id',
    // Supabase is used only to verify Google identity. The publishable/anon
    // key is safe to use for client identification; never paste a service-role
    // key here. Keep the Google client secret in Supabase itself.
    'supabase_url' => 'https://rwxxjqvoidpkuqftgkjd.supabase.co',
    'supabase_publishable_key' => 'REPLACE_WITH_SUPABASE_PUBLISHABLE_OR_ANON_KEY',
    // Test defaults to open_beta; production defaults to allowlist unless this
    // is explicitly changed to open after the data-isolation review.
    'admin_auth_mode' => 'open_beta',
    // Optional privileged accounts that may read the legacy shared sandbox
    // order store and use passwordless email. Other verified Google users get
    // an isolated beta workspace and cannot read those legacy records.
    'admin_allowed_emails' => 'REPLACE_WITH_OWNER_GOOGLE_ACCOUNT_EMAIL',
    // Optional absolute path outside the public web root. When omitted, Ezkart
    // creates a private, environment-specific sibling of the document root.
    'admin_session_storage' => '',
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
