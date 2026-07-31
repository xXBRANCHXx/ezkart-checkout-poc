CREATE TABLE IF NOT EXISTS ezkart_checkout_sessions (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    merchant_slug VARCHAR(80) NOT NULL,
    merchant_order_reference VARCHAR(100) NOT NULL,
    idempotency_key VARCHAR(160) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'IDR',
    status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
    merchandise_total BIGINT UNSIGNED NOT NULL,
    total_weight_grams INT UNSIGNED NOT NULL,
    shipping_price BIGINT UNSIGNED NOT NULL DEFAULT 0,
    payment_total BIGINT UNSIGNED NOT NULL,
    merchant_platform_fee BIGINT UNSIGNED NOT NULL DEFAULT 0,
    customer_name VARCHAR(120) NOT NULL DEFAULT '',
    customer_email VARCHAR(160) NOT NULL DEFAULT '',
    customer_phone VARCHAR(40) NOT NULL DEFAULT '',
    destination_address VARCHAR(500) NOT NULL DEFAULT '',
    destination_note VARCHAR(500) NOT NULL DEFAULT '',
    destination_area_id VARCHAR(120) NOT NULL DEFAULT '',
    destination_area_name VARCHAR(255) NOT NULL DEFAULT '',
    destination_postal_code VARCHAR(20) NOT NULL DEFAULT '',
    courier_company VARCHAR(60) NOT NULL DEFAULT '',
    courier_type VARCHAR(80) NOT NULL DEFAULT '',
    courier_name VARCHAR(120) NOT NULL DEFAULT '',
    courier_service_name VARCHAR(160) NOT NULL DEFAULT '',
    courier_duration VARCHAR(80) NOT NULL DEFAULT '',
    collection_method VARCHAR(30) NOT NULL DEFAULT 'pickup',
    quote_token TEXT NULL,
    success_url VARCHAR(500) NOT NULL,
    cancel_url VARCHAR(500) NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    UNIQUE KEY uniq_ezkart_merchant_order (merchant_slug, merchant_order_reference),
    UNIQUE KEY uniq_ezkart_idempotency (merchant_slug, idempotency_key),
    KEY idx_ezkart_session_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ezkart_checkout_items (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    session_id VARCHAR(64) NOT NULL,
    sku VARCHAR(120) NOT NULL,
    item_name VARCHAR(160) NOT NULL,
    quantity INT UNSIGNED NOT NULL,
    unit_price BIGINT UNSIGNED NOT NULL,
    unit_weight_grams INT UNSIGNED NOT NULL,
    line_total BIGINT UNSIGNED NOT NULL,
    line_weight_grams INT UNSIGNED NOT NULL,
    created_at DATETIME(6) NOT NULL,
    KEY idx_ezkart_items_session (session_id),
    CONSTRAINT fk_ezkart_items_session FOREIGN KEY (session_id)
        REFERENCES ezkart_checkout_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ezkart_payments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    session_id VARCHAR(64) NOT NULL,
    provider VARCHAR(40) NOT NULL DEFAULT 'duitku',
    provider_reference VARCHAR(160) NOT NULL DEFAULT '',
    provider_payment_url VARCHAR(500) NOT NULL DEFAULT '',
    provider_payment_code VARCHAR(80) NOT NULL DEFAULT '',
    provider_order_id VARCHAR(180) NOT NULL DEFAULT '',
    amount BIGINT UNSIGNED NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    callback_json LONGTEXT NULL,
    paid_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    UNIQUE KEY uniq_ezkart_payment_session (session_id),
    KEY idx_ezkart_payment_status (status, created_at),
    CONSTRAINT fk_ezkart_payment_session FOREIGN KEY (session_id)
        REFERENCES ezkart_checkout_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ezkart_shipments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    session_id VARCHAR(64) NOT NULL,
    provider VARCHAR(40) NOT NULL DEFAULT 'biteship',
    provider_order_id VARCHAR(120) NULL DEFAULT NULL,
    tracking_id VARCHAR(160) NOT NULL DEFAULT '',
    waybill_id VARCHAR(180) NOT NULL DEFAULT '',
    routing_code VARCHAR(120) NOT NULL DEFAULT '',
    status VARCHAR(80) NOT NULL DEFAULT '',
    quoted_price BIGINT UNSIGNED NOT NULL,
    actual_price BIGINT UNSIGNED NOT NULL DEFAULT 0,
    last_error VARCHAR(500) NOT NULL DEFAULT '',
    provider_json LONGTEXT NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    UNIQUE KEY uniq_ezkart_shipment_session (session_id),
    UNIQUE KEY uniq_ezkart_biteship_order (provider_order_id),
    KEY idx_ezkart_shipment_status (status, created_at),
    CONSTRAINT fk_ezkart_shipment_session FOREIGN KEY (session_id)
        REFERENCES ezkart_checkout_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ezkart_webhook_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    provider VARCHAR(40) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    dedupe_hash CHAR(64) NOT NULL,
    payload_json LONGTEXT NOT NULL,
    processing_status VARCHAR(30) NOT NULL DEFAULT 'RECEIVED',
    processing_error VARCHAR(500) NOT NULL DEFAULT '',
    received_at DATETIME(6) NOT NULL,
    processed_at DATETIME(6) NULL,
    UNIQUE KEY uniq_ezkart_webhook_dedupe (provider, dedupe_hash),
    KEY idx_ezkart_webhook_received (provider, received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ezkart_ledger_entries (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    session_id VARCHAR(64) NOT NULL,
    account VARCHAR(80) NOT NULL,
    direction VARCHAR(10) NOT NULL,
    amount BIGINT UNSIGNED NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'IDR',
    description VARCHAR(255) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    UNIQUE KEY uniq_ezkart_ledger_entry (session_id, account, direction),
    KEY idx_ezkart_ledger_session (session_id),
    CONSTRAINT fk_ezkart_ledger_session FOREIGN KEY (session_id)
        REFERENCES ezkart_checkout_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
