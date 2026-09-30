<?php
declare(strict_types=1);

// Copy this file to config.runtime.php on the server. config.runtime.php is
// ignored by Git and must never be committed.
return [
    // Each deployed website keeps a different ignored config.runtime.php.
    // Supabase is Auth-only. D1 and R2 are reached through the matching
    // Cloudflare Worker rather than a PostgreSQL connection string.
    // Live workbench: beta + a dedicated ezkart-api-beta.*.workers.dev endpoint.
    // See docs/beta-readiness.md before changing the hosted configuration.
    'deployment_environment' => 'test',
    'cloudflare_api_url' => 'https://api-test.ezkart.id',
    // Central-commerce cutover must follow docs/commerce-storage.md. Keep legacy
    // until the PHP checkout/admin migration and reconciliation are complete.
    'commerce_storage' => 'legacy',
    // Match the Worker COMMERCE_SERVICE_SECRET; keep at least 32 random bytes.
    // This key is server-only and separate for every deployment environment.
    'commerce_service_secret' => '',
    // Keep withdrawals held until the complete payout workflow is accepted.
    // Bank inquiries also require Worker COMMERCE_WITHDRAWAL_INQUIRY=enabled.
    // See docs/withdrawal-bank-inquiries.md; this does not enable bank payments.
    // Separate courier booking/cancellation activation. Also requires Worker
    // COMMERCE_FULFILLMENT=enabled. Webhooks and tracking reads remain available.
    'commerce_fulfillment' => 'held',
    'commerce_withdrawals' => 'held',
    'commerce_withdrawal_inquiry' => 'held',
    // Also requires Worker COMMERCE_WITHDRAWAL_PAYMENT=enabled. Keep both held
    // until DOKU activation, platform-paid fees and live acceptance are confirmed.
    'commerce_withdrawal_payment' => 'held',
    // Absolute mode-0700 directory outside the application and public web root.
    'commerce_withdrawal_recovery_directory' => '',
    // Supabase is used only to verify Google identity. The publishable/anon
    // key is safe to use for client identification; never paste a service-role
    // key here. Keep the Google client secret in Supabase itself.
    'supabase_url' => 'https://rwxxjqvoidpkuqftgkjd.supabase.co',
    'supabase_publishable_key' => 'REPLACE_WITH_SUPABASE_PUBLISHABLE_OR_ANON_KEY',
    // Test and beta default to open_beta; production defaults to allowlist unless this
    // is explicitly changed to open after the data-isolation review.
    'admin_auth_mode' => 'open_beta',
    // Optional privileged accounts that may read the legacy shared sandbox
    // order store and use passwordless email. Other verified Google users get
    // an isolated beta workspace and cannot read those legacy records.
    'admin_allowed_emails' => 'REPLACE_WITH_OWNER_GOOGLE_ACCOUNT_EMAIL',
    // Optional absolute path outside the public web root. When omitted, Ezkart
    // creates a private, environment-specific sibling of the document root.
    'admin_session_storage' => '',
    // Customer Google sign-in uses the same provider, with a separate private session.
    'customer_session_storage' => '',
    // Optional private, self-hosted map index. No geocoding account or API key.
    // Defaults to ezkart-geocoding beside the public document root.
    'address_geocoding_directory' => '',
    // The server-side switch selects BOTH providers. Default is sandbox.
    // Beta and production deployments require production provider settings.
    // The test deployment may use either mode, after all provider checks pass.
    'commerce_environment' => 'sandbox',
    // Private dashboard bridge key, or ../.ezkart-executive-bridge/secret.php.
    'executive_bridge_secret' => '',
    'doku_sandbox_client_id' => 'REPLACE_WITH_DOKU_SANDBOX_CLIENT_ID',
    'doku_sandbox_secret_key' => 'REPLACE_WITH_DOKU_SANDBOX_SECRET_KEY',
    'doku_sandbox_payment_flow' => 'direct_bca', // Ezkart UI; non-SNAP BCA sandbox API.
    'doku_production_payment_flow' => '', // Select snap_bca only after channel, callbacks and central storage acceptance.
    'doku_sandbox_snap_bca_partner_service_id' => '', // Assigned BCA BIN digits; padded by the adapter.
    'doku_sandbox_snap_bca_customer_prefix' => '', // Assigned BCA customer prefix, including any leading zero.
    'doku_production_snap_bca_partner_service_id' => '', // Do not substitute another bank's BIN.
    'doku_production_snap_bca_customer_prefix' => '',
    'doku_production_client_id' => '',
    'doku_production_secret_key' => '',
    // SNAP signing keys are server-only PEM contents. Keep the private files
    // outside the web root; register only each corresponding public key at DOKU.
    'doku_sandbox_snap_private_key' => '',
    'doku_production_snap_private_key' => '',
    'doku_sandbox_parent_profile_id' => '',
    'doku_production_parent_profile_id' => '',
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
