ALTER TABLE orders ADD COLUMN accepted_at TEXT;
ALTER TABLE orders ADD COLUMN fulfillment_review INTEGER NOT NULL DEFAULT 0 CHECK (fulfillment_review IN (0,1));

CREATE TABLE commerce_fulfillment_actions (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  order_revision INTEGER NOT NULL,
  actor_auth_user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('accept','pickup','cancel_pickup','refresh')),
  shipment_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
  created_at TEXT NOT NULL,
  UNIQUE(seller_id,request_key),
  FOREIGN KEY(seller_id,order_id) REFERENCES orders(seller_id,id) ON DELETE RESTRICT
);
CREATE TABLE commerce_shipments (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  commerce_environment TEXT NOT NULL CHECK (commerce_environment IN ('sandbox','production')),
  sequence INTEGER NOT NULL CHECK (sequence>0),
  reference TEXT NOT NULL,
  action_id TEXT NOT NULL REFERENCES commerce_fulfillment_actions(id),
  provider_id TEXT,
  provider_account_hash TEXT CHECK (provider_account_hash IS NULL OR (length(provider_account_hash)=64 AND provider_account_hash NOT GLOB '*[^0-9a-f]*')),
  state TEXT NOT NULL DEFAULT 'queued',
  maximum_stage INTEGER NOT NULL DEFAULT 0,
  status_at TEXT NOT NULL DEFAULT '',
  status_received_at TEXT NOT NULL DEFAULT '',
  tracking_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(tracking_json)),
  actual_price INTEGER CHECK (actual_price IS NULL OR actual_price>=0),
  bound_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(order_id,sequence),
  UNIQUE(commerce_environment,reference),
  UNIQUE(commerce_environment,provider_id),
  UNIQUE(seller_id,id),
  FOREIGN KEY(seller_id,order_id) REFERENCES orders(seller_id,id) ON DELETE RESTRICT
);
CREATE INDEX idx_shipments_order ON commerce_shipments(order_id,sequence DESC);

-- Authenticated provider callbacks may arrive before creation returns an ID.
-- Retain them until the corresponding verified creation/recovery binds the ID.
CREATE TABLE commerce_shipping_inbox (
  received_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  commerce_environment TEXT NOT NULL CHECK (commerce_environment IN ('sandbox','production')),
  provider_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('webhook','create','refresh','cancel')),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  received_at TEXT NOT NULL,
  applied_at TEXT,
  shipment_id TEXT REFERENCES commerce_shipments(id) ON DELETE RESTRICT
);
CREATE INDEX idx_shipping_inbox_pending ON commerce_shipping_inbox(commerce_environment,provider_id,applied_at,received_at,id);
CREATE INDEX idx_shipping_inbox_history ON commerce_shipping_inbox(shipment_id,received_at DESC,id DESC);
CREATE INDEX idx_shipping_inbox_backlog ON commerce_shipping_inbox(commerce_environment,applied_at,received_sequence);

CREATE TRIGGER commerce_fulfillment_action_guard BEFORE INSERT ON commerce_fulfillment_actions
BEGIN
  SELECT RAISE(ABORT,'fulfillment_actor_forbidden') WHERE NOT EXISTS (
    SELECT 1 FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id
    WHERE m.seller_id=NEW.seller_id AND m.auth_user_id=NEW.actor_auth_user_id AND m.role!='viewer' AND s.status='active'
  );
  SELECT RAISE(ABORT,'commerce_revision_conflict') WHERE NOT EXISTS (
    SELECT 1 FROM orders o WHERE o.id=NEW.order_id AND o.seller_id=NEW.seller_id
      AND o.commerce_version=1 AND o.revision=NEW.order_revision
  );
  SELECT RAISE(ABORT,'fulfillment_order_ineligible') WHERE NEW.kind IN ('accept','pickup') AND NOT EXISTS (
    SELECT 1 FROM orders o WHERE o.id=NEW.order_id AND o.checkout_state='paid' AND o.payment_review=0
      AND o.fulfillment_review=0 AND json_extract(o.snapshot_json,'$.shipping.skipped')=0
      AND ((NEW.kind='accept' AND o.fulfillment_state='awaiting_acceptance') OR
        (NEW.kind='pickup' AND o.accepted_at IS NOT NULL AND o.fulfillment_state IN ('awaiting_pickup_arrangement','cancelled')))
      AND NOT EXISTS (SELECT 1 FROM order_items i WHERE i.order_id=o.id
        AND NOT EXISTS (SELECT 1 FROM inventory_reservations h WHERE h.order_item_id=i.id AND h.state='committed')
        AND NOT EXISTS (SELECT 1 FROM commerce_stock_allocations a WHERE a.order_item_id=i.id))
  );
END;
CREATE TRIGGER commerce_shipment_request_guard BEFORE INSERT ON commerce_shipments
BEGIN
  SELECT RAISE(ABORT,'fulfillment_order_ineligible') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_fulfillment_actions a JOIN orders o ON o.id=a.order_id
    WHERE a.id=NEW.action_id AND a.shipment_id=NEW.id AND a.kind='pickup' AND a.seller_id=NEW.seller_id
      AND a.order_id=NEW.order_id AND a.order_revision=o.revision AND o.commerce_environment=NEW.commerce_environment
      AND NEW.sequence=1+COALESCE((SELECT MAX(sequence) FROM commerce_shipments WHERE order_id=o.id),0)
      AND NOT EXISTS (SELECT 1 FROM commerce_shipments s WHERE s.order_id=o.id AND s.state!='cancelled')
  );
END;
CREATE TRIGGER commerce_shipment_identity BEFORE UPDATE ON commerce_shipments
WHEN NEW.id!=OLD.id OR NEW.seller_id!=OLD.seller_id OR NEW.order_id!=OLD.order_id
  OR NEW.commerce_environment!=OLD.commerce_environment OR NEW.sequence!=OLD.sequence OR NEW.reference!=OLD.reference
  OR NEW.action_id!=OLD.action_id OR NEW.created_at!=OLD.created_at
  OR (OLD.provider_id IS NOT NULL AND NEW.provider_id IS NOT OLD.provider_id)
  OR (OLD.provider_account_hash IS NOT NULL AND NEW.provider_account_hash IS NOT OLD.provider_account_hash)
  OR (OLD.bound_at IS NOT NULL AND NEW.bound_at IS NOT OLD.bound_at)
BEGIN SELECT RAISE(ABORT,'commerce_immutable_shipment'); END;
CREATE TRIGGER commerce_shipment_account_guard BEFORE UPDATE OF provider_id ON commerce_shipments
WHEN NEW.provider_id IS NOT NULL AND NEW.provider_account_hash IS NULL
BEGIN SELECT RAISE(ABORT,'commerce_immutable_shipment'); END;
CREATE TRIGGER commerce_shipment_no_delete BEFORE DELETE ON commerce_shipments BEGIN SELECT RAISE(ABORT,'commerce_immutable_shipment'); END;
CREATE TRIGGER commerce_fulfillment_actions_no_update BEFORE UPDATE ON commerce_fulfillment_actions BEGIN SELECT RAISE(ABORT,'commerce_immutable_action'); END;
CREATE TRIGGER commerce_fulfillment_actions_no_delete BEFORE DELETE ON commerce_fulfillment_actions BEGIN SELECT RAISE(ABORT,'commerce_immutable_action'); END;
CREATE TRIGGER commerce_shipping_inbox_identity BEFORE UPDATE ON commerce_shipping_inbox
WHEN NEW.received_sequence!=OLD.received_sequence OR NEW.id!=OLD.id OR NEW.commerce_environment!=OLD.commerce_environment OR NEW.provider_id!=OLD.provider_id
  OR NEW.source!=OLD.source OR NEW.payload_json!=OLD.payload_json OR NEW.received_at!=OLD.received_at
  OR OLD.applied_at IS NOT NULL OR OLD.shipment_id IS NOT NULL
BEGIN SELECT RAISE(ABORT,'commerce_immutable_shipping_event'); END;
CREATE TRIGGER commerce_shipping_inbox_no_delete BEFORE DELETE ON commerce_shipping_inbox BEGIN SELECT RAISE(ABORT,'commerce_immutable_shipping_event'); END;
CREATE TRIGGER commerce_shipping_refresh_guard BEFORE INSERT ON commerce_shipping_inbox
WHEN NEW.source='refresh' AND EXISTS (SELECT 1 FROM commerce_shipping_inbox i
  WHERE i.commerce_environment=NEW.commerce_environment AND i.provider_id=NEW.provider_id AND i.applied_at IS NULL)
BEGIN SELECT RAISE(ABORT,'commerce_revision_conflict'); END;
