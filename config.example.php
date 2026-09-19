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
    // The server-side switch selects BOTH providers. Default is sandbox.
    // ezkart.id / production deployments reject sandbox settings.
    // The test deployment may use either mode, after all provider checks pass.
    'commerce_environment' => 'sandbox',
    // Private dashboard bridge key, or ../.ezkart-executive-bridge/secret.php.
    'executive_bridge_secret' => '',
    'doku_sandbox_client_id' => 'REPLACE_WITH_DOKU_SANDBOX_CLIENT_ID',
    'doku_sandbox_secret_key' => 'REPLACE_WITH_DOKU_SANDBOX_SECRET_KEY',
    'doku_sandbox_payment_flow' => 'direct_bca', // Ezkart UI; non-SNAP BCA sandbox API.
    'doku_production_payment_flow' => '', // Direct production VA requires SNAP migration; never falls back to hosted.
    'doku_production_client_id' => '',
    'doku_production_secret_key' => '',
    'biteship_sandbox_api_key' => 'biteship_test.REPLACE_WITH_TEST_API_KEY',
    'biteship_production_api_key' => '',
    // Separate random values of at least 32 characters for each webhook mode.
    // Never reuse a provider API key as a webhook token.
    'biteship_sandbox_webhook_token' => 'REPLACE_WITH_A_RANDOM_WEBHOOK_SECRET',
    'biteship_production_webhook_token' => '',
    'biteship_origin_postal_code' => '12345',
    // Biteship needs a pickup contact and full address before it can create the
    // test shipment after the merchant accepts the paid order and explicitly
    // chooses Arrange pickup.
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
    // Ezkart appends /<deployment>/<sandbox|production> to this root.
    'order_storage' => '',
];
