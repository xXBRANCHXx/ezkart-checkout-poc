CREATE TABLE seller_shipping_settings (
  seller_id TEXT PRIMARY KEY REFERENCES sellers(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision>0),
  configuration_json TEXT NOT NULL CHECK (json_valid(configuration_json)),
  updated_at TEXT NOT NULL
);
CREATE TABLE seller_shipping_changes (
  seller_id TEXT NOT NULL REFERENCES sellers(id) ON DELETE RESTRICT,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  expected_revision INTEGER NOT NULL CHECK (expected_revision>=0),
  revision INTEGER NOT NULL CHECK (revision=expected_revision+1),
  actor_auth_user_id TEXT NOT NULL,
  configuration_json TEXT NOT NULL CHECK (json_valid(configuration_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(seller_id,request_key),
  UNIQUE(seller_id,revision)
);
CREATE TRIGGER seller_shipping_change_guard BEFORE INSERT ON seller_shipping_changes
BEGIN
  SELECT RAISE(ABORT,'shipping_actor_forbidden') WHERE NOT EXISTS (
    SELECT 1 FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id
    WHERE m.seller_id=NEW.seller_id AND m.auth_user_id=NEW.actor_auth_user_id AND m.role!='viewer' AND s.status='active'
  );
  SELECT RAISE(ABORT,'shipping_revision_conflict') WHERE NEW.expected_revision!=COALESCE(
    (SELECT revision FROM seller_shipping_settings WHERE seller_id=NEW.seller_id),0);
END;
CREATE TRIGGER seller_shipping_change_apply AFTER INSERT ON seller_shipping_changes
BEGIN
  INSERT INTO seller_shipping_settings(seller_id,revision,configuration_json,updated_at)
  VALUES(NEW.seller_id,NEW.revision,NEW.configuration_json,NEW.created_at)
  ON CONFLICT(seller_id) DO UPDATE SET revision=excluded.revision,configuration_json=excluded.configuration_json,updated_at=excluded.updated_at;
END;
CREATE TRIGGER seller_shipping_change_immutable_update BEFORE UPDATE ON seller_shipping_changes
BEGIN
  SELECT RAISE(ABORT,'immutable_shipping_change');
END;
CREATE TRIGGER seller_shipping_change_immutable_delete BEFORE DELETE ON seller_shipping_changes
BEGIN
  SELECT RAISE(ABORT,'immutable_shipping_change');
END;
CREATE TRIGGER seller_shipping_settings_insert_guard BEFORE INSERT ON seller_shipping_settings
BEGIN
  SELECT RAISE(ABORT,'shipping_receipt_required') WHERE NOT EXISTS (
    SELECT 1 FROM seller_shipping_changes WHERE seller_id=NEW.seller_id AND revision=NEW.revision
      AND configuration_json=NEW.configuration_json AND created_at=NEW.updated_at);
END;
CREATE TRIGGER seller_shipping_settings_update_guard BEFORE UPDATE ON seller_shipping_settings
BEGIN
  SELECT RAISE(ABORT,'shipping_receipt_required') WHERE NEW.seller_id!=OLD.seller_id OR NEW.revision!=OLD.revision+1 OR NOT EXISTS (
    SELECT 1 FROM seller_shipping_changes WHERE seller_id=NEW.seller_id AND revision=NEW.revision
      AND configuration_json=NEW.configuration_json AND created_at=NEW.updated_at);
END;
CREATE TRIGGER seller_shipping_settings_no_delete BEFORE DELETE ON seller_shipping_settings
BEGIN
  SELECT RAISE(ABORT,'shipping_receipt_required');
END;

-- A quote may finish after another tab moves the pickup location. Check inside
-- the reservation transaction; a preflight read alone cannot protect checkout.
CREATE TRIGGER commerce_order_shipping_revision BEFORE INSERT ON orders
WHEN NEW.commerce_version=1 AND json_extract(NEW.snapshot_json,'$.shipping.skipped')=0
BEGIN
  SELECT RAISE(ABORT,'shipping_revision_conflict') WHERE NOT EXISTS (
    SELECT 1 FROM seller_shipping_settings WHERE seller_id=NEW.seller_id
      AND revision=json_extract(NEW.snapshot_json,'$.shipping.settingsRevision')
      AND json_type(NEW.snapshot_json,'$.shipping.settingsRevision')='integer');
END;
CREATE TRIGGER commerce_item_shipping_weight BEFORE INSERT ON order_items
WHEN EXISTS(SELECT 1 FROM orders WHERE id=NEW.order_id AND commerce_version=1)
BEGIN
  SELECT RAISE(ABORT,'commerce_product_changed') WHERE NOT EXISTS (
    SELECT 1 FROM products p LEFT JOIN product_variants v ON v.product_id=p.id AND v.seller_id=p.seller_id
      AND v.id=json_extract(NEW.fulfillment_snapshot_json,'$.variantId')
    WHERE p.id=NEW.product_id AND p.seller_id=NEW.seller_id
      AND CASE WHEN COALESCE(json_extract(NEW.fulfillment_snapshot_json,'$.variantId'),'')='' THEN p.weight_grams ELSE v.weight_grams END
        =json_extract(NEW.fulfillment_snapshot_json,'$.weightGrams'));
END;
