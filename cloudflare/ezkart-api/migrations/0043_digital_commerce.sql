-- Freeze the purchased catalog version independently of later catalog edits.
CREATE TABLE commerce_digital_purchases (
  order_item_id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (seller_id,order_item_id) REFERENCES order_items(seller_id,id),
  FOREIGN KEY (seller_id,order_id) REFERENCES orders(seller_id,id),
  FOREIGN KEY (seller_id,product_id,version_id) REFERENCES digital_product_versions(seller_id,product_id,id)
);
CREATE INDEX idx_digital_purchases_order ON commerce_digital_purchases(order_id,order_item_id);

-- A grant of purchase access requires the primary verified collection. It is
-- neither delivery evidence nor a wallet credit. Current access is checked on
-- every request, including after an R2 await.
CREATE TABLE commerce_digital_entitlements (
  order_item_id TEXT PRIMARY KEY REFERENCES commerce_digital_purchases(order_item_id),
  capture_id TEXT NOT NULL REFERENCES commerce_payment_captures(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_digital_entitlements_capture ON commerce_digital_entitlements(capture_id);
CREATE TABLE commerce_digital_download_grants (
  id TEXT PRIMARY KEY,
  order_item_id TEXT NOT NULL REFERENCES commerce_digital_entitlements(order_item_id),
  auth_user_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE (auth_user_id,request_key)
);
CREATE INDEX idx_digital_grants_item_actor ON commerce_digital_download_grants(order_item_id,auth_user_id,created_at);
CREATE TABLE commerce_digital_download_requests (
  id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES commerce_digital_download_grants(id),
  requested_range TEXT NOT NULL,
  authorized_at TEXT NOT NULL
);
CREATE INDEX idx_digital_download_requests_grant ON commerce_digital_download_requests(grant_id,authorized_at);

CREATE TRIGGER commerce_digital_item_guard BEFORE INSERT ON order_items
WHEN NEW.product_type='digital' AND EXISTS (SELECT 1 FROM orders WHERE id=NEW.order_id AND commerce_version=1)
BEGIN
  SELECT RAISE(ABORT,'commerce_digital_changed') WHERE NOT EXISTS (
    SELECT 1 FROM products p JOIN sellers s ON s.id=p.seller_id
    JOIN digital_product_files f ON f.product_id=p.id AND f.seller_id=p.seller_id
    JOIN digital_product_versions v ON v.id=f.version_id
    JOIN digital_file_uploads u ON u.id=v.upload_id
    JOIN orders o ON o.id=NEW.order_id AND o.seller_id=p.seller_id
    WHERE p.id=NEW.product_id AND p.seller_id=NEW.seller_id AND p.type='digital'
      AND p.status='active' AND s.status='active' AND o.checkout_state='creating'
      AND json_extract(NEW.fulfillment_snapshot_json,'$.weightGrams')=0
      AND v.id=json_extract(NEW.fulfillment_snapshot_json,'$.digitalFile.id')
      AND v.version=json_extract(NEW.fulfillment_snapshot_json,'$.digitalFile.version')
      AND u.filename=json_extract(NEW.fulfillment_snapshot_json,'$.digitalFile.filename')
      AND u.size_bytes=json_extract(NEW.fulfillment_snapshot_json,'$.digitalFile.size')
      AND u.state='ready' AND u.retained_at IS NOT NULL
      AND ((json_extract(NEW.fulfillment_snapshot_json,'$.variantId')='' AND p.price_amount=NEW.unit_price_amount
        AND NOT EXISTS (SELECT 1 FROM product_variants WHERE product_id=p.id))
      OR EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id=p.id AND pv.seller_id=p.seller_id
        AND pv.id=json_extract(NEW.fulfillment_snapshot_json,'$.variantId') AND pv.price_amount=NEW.unit_price_amount
        AND COALESCE(json_extract(pv.options_json,'$.hidden'),0)=0))
  );
END;
CREATE TRIGGER commerce_digital_item_purchase AFTER INSERT ON order_items
WHEN NEW.product_type='digital' AND EXISTS (SELECT 1 FROM orders WHERE id=NEW.order_id AND commerce_version=1)
BEGIN
  INSERT INTO commerce_digital_purchases(order_item_id,seller_id,order_id,product_id,version_id,created_at)
  VALUES (NEW.id,NEW.seller_id,NEW.order_id,NEW.product_id,json_extract(NEW.fulfillment_snapshot_json,'$.digitalFile.id'),NEW.created_at);
END;
CREATE TRIGGER commerce_digital_purchase_guard BEFORE INSERT ON commerce_digital_purchases
BEGIN
  SELECT RAISE(ABORT,'commerce_digital_changed') WHERE NOT EXISTS (
    SELECT 1 FROM order_items i JOIN orders o ON o.id=i.order_id AND o.seller_id=i.seller_id
    JOIN digital_product_files f ON f.product_id=i.product_id AND f.seller_id=i.seller_id
    WHERE i.id=NEW.order_item_id AND i.seller_id=NEW.seller_id AND i.order_id=NEW.order_id
      AND i.product_id=NEW.product_id AND i.product_type='digital' AND o.commerce_version=1 AND o.checkout_state='creating'
      AND f.version_id=NEW.version_id AND json_extract(i.fulfillment_snapshot_json,'$.digitalFile.id')=NEW.version_id
      AND i.created_at=NEW.created_at
  );
END;
CREATE TRIGGER commerce_digital_purchase_no_update BEFORE UPDATE ON commerce_digital_purchases
BEGIN SELECT RAISE(ABORT,'commerce_immutable_digital_purchase'); END;
CREATE TRIGGER commerce_digital_purchase_no_delete BEFORE DELETE ON commerce_digital_purchases
BEGIN SELECT RAISE(ABORT,'commerce_immutable_digital_purchase'); END;

CREATE TRIGGER commerce_digital_entitlement_guard BEFORE INSERT ON commerce_digital_entitlements
BEGIN
  SELECT RAISE(ABORT,'commerce_digital_payment_required') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_digital_purchases p JOIN orders o ON o.id=p.order_id AND o.seller_id=p.seller_id
    JOIN commerce_payment_captures c ON c.order_id=o.id AND c.seller_id=o.seller_id
    WHERE p.order_item_id=NEW.order_item_id AND c.id=NEW.capture_id AND c.capture_kind='order_payment'
      AND c.commerce_environment=o.commerce_environment AND c.amount=o.total_amount AND c.currency=o.currency
      AND o.commerce_version=1 AND o.checkout_state='paid'
  );
END;
CREATE TRIGGER commerce_digital_paid_entitlements AFTER UPDATE OF checkout_state ON orders
WHEN NEW.commerce_version=1 AND NEW.checkout_state='paid' AND OLD.checkout_state NOT IN ('paid','partially_refunded','refunded')
BEGIN
  INSERT INTO commerce_digital_entitlements(order_item_id,capture_id,created_at)
  SELECT p.order_item_id,c.id,NEW.paid_at FROM commerce_digital_purchases p
    JOIN commerce_payment_captures c ON c.order_id=p.order_id AND c.seller_id=p.seller_id AND c.capture_kind='order_payment'
    WHERE p.order_id=NEW.id;
END;
CREATE TRIGGER commerce_digital_entitlement_no_update BEFORE UPDATE ON commerce_digital_entitlements
BEGIN SELECT RAISE(ABORT,'commerce_immutable_digital_entitlement'); END;
CREATE TRIGGER commerce_digital_entitlement_no_delete BEFORE DELETE ON commerce_digital_entitlements
BEGIN SELECT RAISE(ABORT,'commerce_immutable_digital_entitlement'); END;

CREATE TRIGGER commerce_digital_grant_guard BEFORE INSERT ON commerce_digital_download_grants
BEGIN
  SELECT RAISE(ABORT,'commerce_digital_access_changed') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_digital_purchases p JOIN commerce_digital_entitlements e ON e.order_item_id=p.order_item_id
    JOIN orders o ON o.id=p.order_id LEFT JOIN commerce_order_owners a ON a.order_id=o.id
    WHERE p.order_item_id=NEW.order_item_id AND o.checkout_state='paid' AND o.payment_review=0
      AND COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=NEW.auth_user_id
      AND NEW.expires_at=strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'+1 day')
  );
  SELECT RAISE(ABORT,'commerce_digital_download_limit') WHERE (SELECT COUNT(*) FROM commerce_digital_download_grants
    WHERE order_item_id=NEW.order_item_id AND auth_user_id=NEW.auth_user_id
      AND created_at>strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'-1 hour'))>=20;
END;
CREATE TRIGGER commerce_digital_grant_no_update BEFORE UPDATE ON commerce_digital_download_grants
BEGIN SELECT RAISE(ABORT,'commerce_immutable_download_grant'); END;
CREATE TRIGGER commerce_digital_grant_no_delete BEFORE DELETE ON commerce_digital_download_grants
BEGIN SELECT RAISE(ABORT,'commerce_immutable_download_grant'); END;
CREATE TRIGGER commerce_digital_download_guard BEFORE INSERT ON commerce_digital_download_requests
BEGIN
  SELECT RAISE(ABORT,'commerce_digital_access_changed') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_digital_download_grants g JOIN commerce_digital_purchases p ON p.order_item_id=g.order_item_id
    JOIN orders o ON o.id=p.order_id LEFT JOIN commerce_order_owners a ON a.order_id=o.id
    WHERE g.id=NEW.grant_id AND g.expires_at>NEW.authorized_at AND o.checkout_state='paid' AND o.payment_review=0
      AND COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=g.auth_user_id
  );
  SELECT RAISE(ABORT,'commerce_digital_download_limit') WHERE (SELECT COUNT(*) FROM commerce_digital_download_requests
    WHERE grant_id=NEW.grant_id AND authorized_at>strftime('%Y-%m-%dT%H:%M:%fZ',NEW.authorized_at,'-1 hour'))>=300;
END;
CREATE TRIGGER commerce_digital_download_no_update BEFORE UPDATE ON commerce_digital_download_requests
BEGIN SELECT RAISE(ABORT,'commerce_immutable_download_request'); END;
CREATE TRIGGER commerce_digital_download_no_delete BEFORE DELETE ON commerce_digital_download_requests
BEGIN SELECT RAISE(ABORT,'commerce_immutable_download_request'); END;

-- A digital-only order explicitly has no shipment in either environment. It
-- must never masquerade as the sandbox bypass or admit a physical order item.
CREATE TRIGGER commerce_no_shipping_order BEFORE INSERT ON orders
WHEN NEW.commerce_version=1 AND json_extract(NEW.snapshot_json,'$.shipping.kind')='none'
BEGIN
  SELECT RAISE(ABORT,'commerce_shipping_contract') WHERE NEW.shipping_amount!=0
    OR json_extract(NEW.snapshot_json,'$.shipping.amount') IS NOT 0
    OR json_extract(NEW.snapshot_json,'$.shipping.skipped') IS NOT 0;
END;
CREATE TRIGGER commerce_no_shipping_physical_item BEFORE INSERT ON order_items
WHEN NEW.product_type='physical' AND EXISTS (SELECT 1 FROM orders WHERE id=NEW.order_id AND commerce_version=1
  AND json_extract(snapshot_json,'$.shipping.kind')='none')
BEGIN SELECT RAISE(ABORT,'commerce_shipping_contract'); END;

-- Preserve all existing physical safeguards; scope them to shippable items.
DROP TRIGGER commerce_order_shipping_revision;
CREATE TRIGGER commerce_order_shipping_revision BEFORE INSERT ON orders
WHEN NEW.commerce_version=1 AND COALESCE(json_extract(NEW.snapshot_json,'$.shipping.kind'),'carrier')!='none' AND json_extract(NEW.snapshot_json,'$.shipping.skipped')=0
BEGIN
  SELECT RAISE(ABORT,'shipping_revision_conflict') WHERE NOT EXISTS (
    SELECT 1 FROM seller_shipping_settings WHERE seller_id=NEW.seller_id
      AND revision=json_extract(NEW.snapshot_json,'$.shipping.settingsRevision')
      AND json_type(NEW.snapshot_json,'$.shipping.settingsRevision')='integer');
END;
DROP TRIGGER commerce_item_shipping_weight;
CREATE TRIGGER commerce_item_shipping_weight BEFORE INSERT ON order_items
WHEN NEW.product_type='physical' AND EXISTS(SELECT 1 FROM orders WHERE id=NEW.order_id AND commerce_version=1)
BEGIN
  SELECT RAISE(ABORT,'commerce_product_changed') WHERE NOT EXISTS (
    SELECT 1 FROM products p LEFT JOIN product_variants v ON v.product_id=p.id AND v.seller_id=p.seller_id
      AND v.id=json_extract(NEW.fulfillment_snapshot_json,'$.variantId')
    WHERE p.id=NEW.product_id AND p.seller_id=NEW.seller_id
      AND CASE WHEN COALESCE(json_extract(NEW.fulfillment_snapshot_json,'$.variantId'),'')='' THEN p.weight_grams ELSE v.weight_grams END
        =json_extract(NEW.fulfillment_snapshot_json,'$.weightGrams'));
END;
DROP TRIGGER commerce_fulfillment_action_guard;
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
      AND o.fulfillment_review=0 AND COALESCE(json_extract(o.snapshot_json,'$.shipping.kind'),'carrier')!='none' AND json_extract(o.snapshot_json,'$.shipping.skipped')=0
      AND ((NEW.kind='accept' AND o.fulfillment_state='awaiting_acceptance') OR
        (NEW.kind='pickup' AND o.accepted_at IS NOT NULL AND o.fulfillment_state IN ('awaiting_pickup_arrangement','cancelled')))
      AND NOT EXISTS (SELECT 1 FROM order_items i WHERE i.order_id=o.id AND i.product_type='physical'
        AND NOT EXISTS (SELECT 1 FROM inventory_reservations h WHERE h.order_item_id=i.id AND h.state='committed')
        AND NOT EXISTS (SELECT 1 FROM commerce_stock_allocations a WHERE a.order_item_id=i.id))
  );
END;

-- A fresh challenge requires knowledge of every original byte, not just a
-- publicly readable checksum or a successful server-to-server transfer.
CREATE TABLE commerce_digital_part_challenges (
  grant_id TEXT NOT NULL REFERENCES commerce_digital_download_grants(id),
  part_number INTEGER NOT NULL CHECK (part_number BETWEEN 1 AND 100),
  nonce TEXT NOT NULL CHECK (length(nonce)=64),
  proof_hash TEXT NOT NULL CHECK (length(proof_hash)=64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (grant_id,part_number)
);
CREATE TABLE commerce_digital_part_receipts (
  grant_id TEXT NOT NULL,
  part_number INTEGER NOT NULL,
  proof_hash TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  PRIMARY KEY (grant_id,part_number),
  FOREIGN KEY (grant_id,part_number) REFERENCES commerce_digital_part_challenges(grant_id,part_number)
);
CREATE TABLE commerce_digital_deliveries (
  order_item_id TEXT PRIMARY KEY REFERENCES commerce_digital_entitlements(order_item_id),
  grant_id TEXT NOT NULL REFERENCES commerce_digital_download_grants(id),
  auth_user_id TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  evidence_version INTEGER NOT NULL DEFAULT 1 CHECK (evidence_version=1)
);
CREATE TRIGGER commerce_digital_challenge_guard BEFORE INSERT ON commerce_digital_part_challenges
BEGIN
  SELECT RAISE(ABORT,'commerce_digital_access_changed') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_digital_download_grants g JOIN commerce_digital_purchases p ON p.order_item_id=g.order_item_id
    JOIN orders o ON o.id=p.order_id LEFT JOIN commerce_order_owners a ON a.order_id=o.id
    JOIN digital_product_versions v ON v.id=p.version_id JOIN digital_file_uploads u ON u.id=v.upload_id
    WHERE g.id=NEW.grant_id AND g.expires_at>NEW.created_at AND o.checkout_state='paid' AND o.payment_review=0
      AND u.state='ready' AND NEW.part_number<=u.part_count
      AND COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=g.auth_user_id
  );
END;
CREATE TRIGGER commerce_digital_receipt_guard BEFORE INSERT ON commerce_digital_part_receipts
BEGIN
  SELECT RAISE(ABORT,'commerce_digital_proof_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_digital_part_challenges c JOIN commerce_digital_download_grants g ON g.id=c.grant_id
    JOIN commerce_digital_purchases p ON p.order_item_id=g.order_item_id JOIN orders o ON o.id=p.order_id
    LEFT JOIN commerce_order_owners a ON a.order_id=o.id
    WHERE c.grant_id=NEW.grant_id AND c.part_number=NEW.part_number AND c.proof_hash=NEW.proof_hash
      AND g.expires_at>NEW.verified_at AND o.checkout_state='paid' AND o.payment_review=0
      AND COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=g.auth_user_id
  );
END;
CREATE TRIGGER commerce_digital_delivery_guard BEFORE INSERT ON commerce_digital_deliveries
BEGIN
  SELECT RAISE(ABORT,'commerce_digital_proof_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_digital_download_grants g JOIN commerce_digital_purchases p ON p.order_item_id=g.order_item_id
    JOIN digital_product_versions v ON v.id=p.version_id JOIN digital_file_uploads u ON u.id=v.upload_id
    JOIN orders o ON o.id=p.order_id LEFT JOIN commerce_order_owners a ON a.order_id=o.id
    WHERE g.id=NEW.grant_id AND p.order_item_id=NEW.order_item_id AND g.auth_user_id=NEW.auth_user_id
      AND g.expires_at>NEW.verified_at AND o.checkout_state='paid' AND o.payment_review=0
      AND COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=g.auth_user_id
      AND (SELECT COUNT(*) FROM commerce_digital_part_receipts r WHERE r.grant_id=g.id)=u.part_count
  );
END;
CREATE TRIGGER commerce_digital_complete_delivery AFTER INSERT ON commerce_digital_part_receipts
BEGIN
  INSERT INTO commerce_digital_deliveries(order_item_id,grant_id,auth_user_id,verified_at)
  SELECT p.order_item_id,g.id,g.auth_user_id,NEW.verified_at FROM commerce_digital_download_grants g
    JOIN commerce_digital_purchases p ON p.order_item_id=g.order_item_id
    JOIN digital_product_versions v ON v.id=p.version_id JOIN digital_file_uploads u ON u.id=v.upload_id
    WHERE g.id=NEW.grant_id AND (SELECT COUNT(*) FROM commerce_digital_part_receipts r WHERE r.grant_id=g.id)=u.part_count
      AND NOT EXISTS (SELECT 1 FROM commerce_digital_deliveries d WHERE d.order_item_id=p.order_item_id);
END;
CREATE TRIGGER commerce_digital_challenge_no_update BEFORE UPDATE ON commerce_digital_part_challenges
BEGIN SELECT RAISE(ABORT,'commerce_immutable_download_challenge'); END;
CREATE TRIGGER commerce_digital_challenge_no_delete BEFORE DELETE ON commerce_digital_part_challenges
BEGIN SELECT RAISE(ABORT,'commerce_immutable_download_challenge'); END;
CREATE TRIGGER commerce_digital_receipt_no_update BEFORE UPDATE ON commerce_digital_part_receipts
BEGIN SELECT RAISE(ABORT,'commerce_immutable_download_receipt'); END;
CREATE TRIGGER commerce_digital_receipt_no_delete BEFORE DELETE ON commerce_digital_part_receipts
BEGIN SELECT RAISE(ABORT,'commerce_immutable_download_receipt'); END;
CREATE TRIGGER commerce_digital_delivery_no_update BEFORE UPDATE ON commerce_digital_deliveries
BEGIN SELECT RAISE(ABORT,'commerce_immutable_digital_delivery'); END;
CREATE TRIGGER commerce_digital_delivery_no_delete BEFORE DELETE ON commerce_digital_deliveries
BEGIN SELECT RAISE(ABORT,'commerce_immutable_digital_delivery'); END;
