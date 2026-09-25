-- Application stock mutations and manual counts share an append-only history.
-- Product/variant IDs here are snapshots: deleting a catalog entry retains its
-- audit trail. No historical order is imported or credited by this migration.
CREATE TABLE inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id TEXT NOT NULL REFERENCES sellers(id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL,
  variant_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  sku TEXT NOT NULL,
  quantity_before INTEGER NOT NULL CHECK (quantity_before >= 0),
  quantity_after INTEGER NOT NULL CHECK (quantity_after >= 0),
  reason TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  actor_auth_user_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(seller_id, reference_id, product_id, variant_id)
);
CREATE INDEX idx_inventory_history ON inventory_movements(seller_id, id DESC);
CREATE INDEX idx_inventory_item_history ON inventory_movements(seller_id, product_id, variant_id, id DESC);

INSERT INTO inventory_movements (seller_id,product_id,variant_id,title,sku,quantity_before,quantity_after,reason,reference_id,note,created_at)
SELECT p.seller_id,p.id,'',p.title,COALESCE(p.sku,''),0,p.stock_quantity,'opening','migration-0011','Existing catalog balance, not a verified physical count',strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM products p WHERE p.type='physical' AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id=p.id)
UNION ALL
SELECT p.seller_id,p.id,v.id,p.title || ' — ' || v.name,v.sku,0,COALESCE(v.stock_quantity,0),'opening','migration-0011','Existing catalog balance, not a verified physical count',strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM products p JOIN product_variants v ON v.product_id=p.id AND v.seller_id=p.seller_id WHERE p.type='physical';

CREATE TABLE inventory_adjustments (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES sellers(id) ON DELETE RESTRICT,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('count','received','damaged','lost','correction','alert')),
  note TEXT NOT NULL DEFAULT '',
  actor_auth_user_id TEXT NOT NULL,
  draft_revision INTEGER,
  receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
  created_at TEXT NOT NULL,
  UNIQUE(seller_id, request_key)
);
CREATE TABLE inventory_policies (
  seller_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  variant_id TEXT NOT NULL DEFAULT '',
  reorder_point INTEGER NOT NULL CHECK (reorder_point BETWEEN 0 AND 1000000000),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(seller_id,product_id,variant_id),
  FOREIGN KEY(seller_id,product_id) REFERENCES products(seller_id,id) ON DELETE CASCADE
);
CREATE TABLE inventory_count_drafts (
  seller_id TEXT NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  auth_user_id TEXT NOT NULL REFERENCES app_users(auth_user_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(seller_id,auth_user_id)
);

DROP TRIGGER catalog_revision_guard;
CREATE TRIGGER catalog_revision_guard
BEFORE INSERT ON seller_events
WHEN NEW.event_type IN ('product.updated','product.deleted','inventory.adjusted')
BEGIN
  SELECT RAISE(ABORT, 'catalog_revision_conflict') WHERE NOT EXISTS (
    SELECT 1 FROM products WHERE id=NEW.entity_id AND seller_id=NEW.seller_id
      AND revision=json_extract(NEW.payload_json,'$.expectedRevision')
      AND json_type(NEW.payload_json,'$.expectedRevision')='integer'
  );
END;
CREATE TRIGGER inventory_movements_no_update BEFORE UPDATE ON inventory_movements BEGIN SELECT RAISE(ABORT,'inventory_immutable_history'); END;
CREATE TRIGGER inventory_movements_no_delete BEFORE DELETE ON inventory_movements BEGIN SELECT RAISE(ABORT,'inventory_immutable_history'); END;
CREATE TRIGGER inventory_adjustments_no_update BEFORE UPDATE ON inventory_adjustments BEGIN SELECT RAISE(ABORT,'inventory_immutable_history'); END;
CREATE TRIGGER inventory_adjustments_no_delete BEFORE DELETE ON inventory_adjustments BEGIN SELECT RAISE(ABORT,'inventory_immutable_history'); END;
CREATE TRIGGER inventory_adjustment_draft_guard BEFORE INSERT ON inventory_adjustments
WHEN NEW.draft_revision IS NOT NULL
BEGIN
  SELECT RAISE(ABORT,'inventory_draft_conflict') WHERE NOT EXISTS (
    SELECT 1 FROM inventory_count_drafts WHERE seller_id=NEW.seller_id AND auth_user_id=NEW.actor_auth_user_id
      AND revision=NEW.draft_revision AND json_extract(payload_json,'$.requestKey')=NEW.request_key
  );
END;

-- Payment consumption is also audited inside its stock transaction. The
-- reservation's state transition makes both the deduction and history one-use.
DROP TRIGGER commerce_consume_inventory;
CREATE TRIGGER commerce_consume_inventory
AFTER UPDATE OF state ON inventory_reservations
WHEN OLD.state='reserved' AND NEW.state='committed'
BEGIN
  INSERT INTO inventory_movements(seller_id,product_id,variant_id,title,sku,quantity_before,quantity_after,reason,reference_id,note,created_at)
    SELECT p.seller_id,p.id,NEW.variant_id,p.title || CASE WHEN v.id IS NULL THEN '' ELSE ' — ' || v.name END,
      COALESCE(v.sku,p.sku,''),COALESCE(v.stock_quantity,p.stock_quantity),COALESCE(v.stock_quantity,p.stock_quantity)-NEW.quantity,
      'payment',NEW.order_id,'Verified payment',NEW.updated_at
    FROM products p LEFT JOIN product_variants v ON v.id=NEW.variant_id AND v.product_id=p.id AND v.seller_id=p.seller_id
    WHERE p.id=NEW.product_id AND p.seller_id=NEW.seller_id;
  UPDATE products SET stock_quantity=stock_quantity-NEW.quantity,updated_at=NEW.updated_at
    WHERE id=NEW.product_id AND seller_id=NEW.seller_id AND NEW.variant_id='';
  UPDATE product_variants SET stock_quantity=stock_quantity-NEW.quantity,updated_at=NEW.updated_at
    WHERE id=NEW.variant_id AND product_id=NEW.product_id AND seller_id=NEW.seller_id;
  UPDATE products SET stock_quantity=(SELECT COALESCE(SUM(stock_quantity),0) FROM product_variants
      WHERE product_id=NEW.product_id AND seller_id=NEW.seller_id AND COALESCE(json_extract(options_json,'$.hidden'),0)=0),
    updated_at=NEW.updated_at WHERE id=NEW.product_id AND seller_id=NEW.seller_id AND NEW.variant_id!='';
END;
