-- Central order state and reservations. Existing sandbox files are imported by
-- a separate, explicit cutover; applying this migration never invents payments.
ALTER TABLE orders ADD COLUMN commerce_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN commerce_environment TEXT NOT NULL DEFAULT 'sandbox' CHECK (commerce_environment IN ('sandbox', 'production'));
ALTER TABLE orders ADD COLUMN checkout_state TEXT NOT NULL DEFAULT '' CHECK (checkout_state IN ('', 'creating', 'pending', 'paid', 'expired', 'failed', 'cancelled', 'partially_refunded', 'refunded'));
ALTER TABLE orders ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0);
ALTER TABLE orders ADD COLUMN checkout_key TEXT;
ALTER TABLE orders ADD COLUMN request_hash TEXT;
ALTER TABLE orders ADD COLUMN snapshot_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(snapshot_json));
ALTER TABLE orders ADD COLUMN expires_at TEXT;
ALTER TABLE orders ADD COLUMN paid_at TEXT;
ALTER TABLE orders ADD COLUMN fulfillment_state TEXT NOT NULL DEFAULT 'awaiting_payment';
ALTER TABLE orders ADD COLUMN payment_review INTEGER NOT NULL DEFAULT 0 CHECK (payment_review IN (0, 1));
CREATE UNIQUE INDEX idx_orders_checkout_key ON orders(seller_id, commerce_environment, checkout_key) WHERE checkout_key IS NOT NULL;
CREATE INDEX idx_orders_expiry ON orders(commerce_environment, checkout_state, expires_at);

-- Transactional outbox: provider requests are never made while a DB transaction
-- is open. A timed-out external write is reconciled, not blindly repeated.
CREATE TABLE commerce_jobs (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES sellers(id) ON DELETE RESTRICT,
  order_id TEXT,
  commerce_environment TEXT NOT NULL CHECK (commerce_environment IN ('sandbox', 'production')),
  job_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'retry', 'uncertain', 'succeeded', 'dead')),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  maximum_attempts INTEGER NOT NULL DEFAULT 8 CHECK (maximum_attempts BETWEEN 1 AND 20),
  available_at TEXT NOT NULL,
  lease_token TEXT,
  lease_owner TEXT,
  lease_until TEXT,
  lease_mode TEXT CHECK (lease_mode IS NULL OR lease_mode IN ('execute', 'reconcile')),
  completion_hash TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(seller_id, commerce_environment, job_key),
  FOREIGN KEY(seller_id, order_id) REFERENCES orders(seller_id, id) ON DELETE RESTRICT
);
CREATE INDEX idx_commerce_jobs_due ON commerce_jobs(commerce_environment, state, kind, available_at);

CREATE TABLE commerce_job_attempts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES commerce_jobs(id) ON DELETE RESTRICT,
  attempt INTEGER NOT NULL,
  lease_token TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('execute', 'reconcile')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  outcome TEXT,
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error TEXT NOT NULL DEFAULT '',
  UNIQUE(job_id, attempt)
);

CREATE TRIGGER commerce_job_identity
BEFORE UPDATE ON commerce_jobs
WHEN NEW.id != OLD.id OR NEW.seller_id != OLD.seller_id OR NEW.order_id IS NOT OLD.order_id
  OR NEW.commerce_environment != OLD.commerce_environment OR NEW.job_key != OLD.job_key
  OR NEW.kind != OLD.kind OR NEW.payload_json != OLD.payload_json OR NEW.created_at != OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'commerce_immutable_job');
END;

CREATE TRIGGER commerce_finished_job_attempt
BEFORE UPDATE ON commerce_job_attempts
WHEN OLD.finished_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'commerce_immutable_job_attempt');
END;

CREATE TABLE commerce_order_events (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  previous_revision INTEGER NOT NULL,
  data_json TEXT NOT NULL CHECK (json_valid(data_json)),
  created_at TEXT NOT NULL,
  UNIQUE(order_id, event_key),
  FOREIGN KEY(seller_id, order_id) REFERENCES orders(seller_id, id) ON DELETE RESTRICT
);
CREATE INDEX idx_commerce_events_order ON commerce_order_events(order_id, previous_revision);

CREATE TABLE commerce_payment_captures (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider = 'doku'),
  commerce_environment TEXT NOT NULL CHECK (commerce_environment IN ('sandbox', 'production')),
  provider_reference TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL CHECK (currency = 'IDR'),
  capture_kind TEXT NOT NULL CHECK (capture_kind IN ('order_payment', 'duplicate_payment')),
  verified_at TEXT NOT NULL,
  UNIQUE(provider, commerce_environment, provider_reference),
  FOREIGN KEY(seller_id, order_id) REFERENCES orders(seller_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX idx_commerce_primary_capture ON commerce_payment_captures(order_id) WHERE capture_kind = 'order_payment';

CREATE TABLE inventory_reservations (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  order_item_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  variant_id TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10000),
  unit_price_amount INTEGER NOT NULL CHECK (unit_price_amount > 0),
  state TEXT NOT NULL CHECK (state IN ('reserved', 'committed', 'released')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(order_item_id),
  FOREIGN KEY(seller_id, order_id) REFERENCES orders(seller_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(seller_id, order_item_id) REFERENCES order_items(seller_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(seller_id, product_id) REFERENCES products(seller_id, id) ON DELETE RESTRICT
);
CREATE INDEX idx_inventory_reserved ON inventory_reservations(seller_id, product_id, variant_id, state);

-- A stale read cannot reserve a changed price, hidden option, suspended store,
-- or the last unit already held by another checkout. Failure rolls back the
-- complete order batch, including its customer and every earlier line.
CREATE TRIGGER commerce_reserve_inventory
BEFORE INSERT ON inventory_reservations
BEGIN
  SELECT RAISE(ABORT, 'commerce_product_changed') WHERE NOT EXISTS (
    SELECT 1 FROM order_items i JOIN orders o ON o.id = i.order_id AND o.seller_id = i.seller_id
    WHERE i.id = NEW.order_item_id AND i.seller_id = NEW.seller_id AND i.order_id = NEW.order_id
      AND i.product_id = NEW.product_id AND i.quantity = NEW.quantity AND i.unit_price_amount = NEW.unit_price_amount
      AND json_extract(i.fulfillment_snapshot_json, '$.variantId') = NEW.variant_id AND o.checkout_state = 'creating'
  );
  SELECT RAISE(ABORT, 'commerce_product_changed') WHERE NEW.state != 'reserved'
    OR NOT EXISTS (
      SELECT 1 FROM products p JOIN sellers s ON s.id = p.seller_id
      WHERE p.id = NEW.product_id AND p.seller_id = NEW.seller_id
        AND p.type = 'physical' AND p.status = 'active' AND s.status = 'active'
        AND ((NEW.variant_id = '' AND p.price_amount = NEW.unit_price_amount
          AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id))
        OR EXISTS (SELECT 1 FROM product_variants v WHERE v.id = NEW.variant_id
          AND v.product_id = p.id AND v.seller_id = p.seller_id
          AND v.price_amount = NEW.unit_price_amount
          AND COALESCE(json_extract(v.options_json, '$.hidden'), 0) = 0))
    );
  SELECT RAISE(ABORT, 'commerce_insufficient_stock') WHERE
    COALESCE((CASE WHEN NEW.variant_id = ''
      THEN (SELECT stock_quantity FROM products WHERE id = NEW.product_id AND seller_id = NEW.seller_id)
      ELSE (SELECT stock_quantity FROM product_variants WHERE id = NEW.variant_id AND product_id = NEW.product_id AND seller_id = NEW.seller_id)
    END), 0) < NEW.quantity + COALESCE((SELECT SUM(quantity) FROM inventory_reservations
      WHERE seller_id = NEW.seller_id AND product_id = NEW.product_id
        AND variant_id = NEW.variant_id AND state = 'reserved'), 0);
END;

CREATE TRIGGER commerce_reservation_identity
BEFORE UPDATE ON inventory_reservations
WHEN NEW.id != OLD.id OR NEW.seller_id != OLD.seller_id OR NEW.order_id != OLD.order_id
  OR NEW.order_item_id != OLD.order_item_id OR NEW.product_id != OLD.product_id
  OR NEW.variant_id != OLD.variant_id OR NEW.quantity != OLD.quantity
  OR NEW.unit_price_amount != OLD.unit_price_amount OR NEW.created_at != OLD.created_at
  OR (NEW.state != OLD.state AND OLD.state != 'reserved')
BEGIN
  SELECT RAISE(ABORT, 'commerce_immutable_reservation');
END;

CREATE TRIGGER commerce_consume_inventory
AFTER UPDATE OF state ON inventory_reservations
WHEN OLD.state = 'reserved' AND NEW.state = 'committed'
BEGIN
  UPDATE products SET stock_quantity = stock_quantity - NEW.quantity, updated_at = NEW.updated_at
    WHERE id = NEW.product_id AND seller_id = NEW.seller_id AND NEW.variant_id = '';
  UPDATE product_variants SET stock_quantity = stock_quantity - NEW.quantity, updated_at = NEW.updated_at
    WHERE id = NEW.variant_id AND product_id = NEW.product_id AND seller_id = NEW.seller_id;
  UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(stock_quantity), 0) FROM product_variants
      WHERE product_id = NEW.product_id AND seller_id = NEW.seller_id AND COALESCE(json_extract(options_json, '$.hidden'), 0) = 0),
    updated_at = NEW.updated_at WHERE id = NEW.product_id AND seller_id = NEW.seller_id AND NEW.variant_id != '';
END;

CREATE TRIGGER commerce_product_stock_floor
BEFORE UPDATE OF stock_quantity, type ON products
WHEN NEW.stock_quantity < 0 OR (NEW.type != 'physical' AND EXISTS (
  SELECT 1 FROM inventory_reservations WHERE product_id = OLD.id AND seller_id = OLD.seller_id AND state = 'reserved')) OR
  ((SELECT COALESCE(SUM(quantity), 0) FROM inventory_reservations
      WHERE product_id = OLD.id AND seller_id = OLD.seller_id AND variant_id = '' AND state = 'reserved')
    > COALESCE(NEW.stock_quantity, 0))
BEGIN
  SELECT RAISE(ABORT, 'commerce_reserved_stock');
END;

CREATE TRIGGER commerce_reserved_product_variant_add
BEFORE INSERT ON product_variants
WHEN EXISTS (SELECT 1 FROM inventory_reservations WHERE product_id = NEW.product_id
  AND seller_id = NEW.seller_id AND variant_id = '' AND state = 'reserved')
BEGIN
  SELECT RAISE(ABORT, 'commerce_reserved_stock');
END;

CREATE TRIGGER commerce_variant_stock_floor
BEFORE UPDATE OF stock_quantity ON product_variants
WHEN NEW.stock_quantity < 0 OR
  ((SELECT COALESCE(SUM(quantity), 0) FROM inventory_reservations
      WHERE product_id = OLD.product_id AND seller_id = OLD.seller_id AND variant_id = OLD.id AND state = 'reserved')
    > COALESCE(NEW.stock_quantity, 0))
BEGIN
  SELECT RAISE(ABORT, 'commerce_reserved_stock');
END;

CREATE TRIGGER commerce_reserved_variant_delete
BEFORE DELETE ON product_variants
WHEN EXISTS (SELECT 1 FROM inventory_reservations WHERE variant_id = OLD.id
  AND product_id = OLD.product_id AND seller_id = OLD.seller_id AND state = 'reserved')
BEGIN
  SELECT RAISE(ABORT, 'commerce_reserved_stock');
END;

CREATE TRIGGER commerce_reservations_no_delete
BEFORE DELETE ON inventory_reservations
BEGIN
  SELECT RAISE(ABORT, 'commerce_immutable_reservation');
END;

CREATE TRIGGER commerce_event_revision
BEFORE INSERT ON commerce_order_events
WHEN NOT EXISTS (SELECT 1 FROM orders WHERE id = NEW.order_id AND seller_id = NEW.seller_id
  AND revision = NEW.previous_revision AND commerce_version = 1)
BEGIN
  SELECT RAISE(ABORT, 'commerce_revision_conflict');
END;

CREATE TRIGGER commerce_events_no_update
BEFORE UPDATE ON commerce_order_events
BEGIN
  SELECT RAISE(ABORT, 'commerce_immutable_event');
END;
CREATE TRIGGER commerce_events_no_delete
BEFORE DELETE ON commerce_order_events
BEGIN
  SELECT RAISE(ABORT, 'commerce_immutable_event');
END;

CREATE TRIGGER commerce_capture_matches_order
BEFORE INSERT ON commerce_payment_captures
WHEN NOT EXISTS (SELECT 1 FROM orders WHERE id = NEW.order_id AND seller_id = NEW.seller_id
  AND commerce_environment = NEW.commerce_environment AND total_amount = NEW.amount
  AND currency = NEW.currency AND commerce_version = 1)
BEGIN
  SELECT RAISE(ABORT, 'commerce_payment_mismatch');
END;
CREATE TRIGGER commerce_captures_no_update
BEFORE UPDATE ON commerce_payment_captures
BEGIN
  SELECT RAISE(ABORT, 'commerce_immutable_capture');
END;
CREATE TRIGGER commerce_captures_no_delete
BEFORE DELETE ON commerce_payment_captures
BEGIN
  SELECT RAISE(ABORT, 'commerce_immutable_capture');
END;

CREATE TRIGGER commerce_order_commercial_snapshot
BEFORE UPDATE ON orders
WHEN OLD.commerce_version = 1 AND (
  NEW.id != OLD.id OR NEW.seller_id != OLD.seller_id OR NEW.commerce_version != OLD.commerce_version
  OR NEW.commerce_environment != OLD.commerce_environment OR NEW.currency != OLD.currency
  OR NEW.subtotal_amount != OLD.subtotal_amount OR NEW.shipping_amount != OLD.shipping_amount
  OR NEW.total_amount != OLD.total_amount OR NEW.checkout_key IS NOT OLD.checkout_key
  OR NEW.request_hash IS NOT OLD.request_hash OR NEW.snapshot_json != OLD.snapshot_json
  OR NEW.created_at != OLD.created_at)
BEGIN
  SELECT RAISE(ABORT, 'commerce_immutable_order');
END;

CREATE TRIGGER commerce_order_plan_snapshot
BEFORE INSERT ON orders
WHEN NEW.commerce_version = 1 AND NOT EXISTS (SELECT 1 FROM sellers WHERE id = NEW.seller_id
  AND status = 'active' AND plan = json_extract(NEW.snapshot_json, '$.fees.plan'))
BEGIN
  SELECT RAISE(ABORT, 'commerce_product_changed');
END;

CREATE TRIGGER commerce_order_items_no_update
BEFORE UPDATE ON order_items
WHEN EXISTS (SELECT 1 FROM orders WHERE id = OLD.order_id AND commerce_version = 1)
BEGIN
  SELECT RAISE(ABORT, 'commerce_immutable_order_item');
END;
CREATE TRIGGER commerce_order_items_no_delete
BEFORE DELETE ON order_items
WHEN EXISTS (SELECT 1 FROM orders WHERE id = OLD.order_id AND commerce_version = 1)
BEGIN
  SELECT RAISE(ABORT, 'commerce_immutable_order_item');
END;
