-- A released reservation remains historical evidence. Late payment recovery
-- records a new, one-use allocation instead of rewriting that reservation.
CREATE TABLE commerce_stock_resolutions (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  order_id TEXT NOT NULL UNIQUE,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  order_revision INTEGER NOT NULL,
  actor_auth_user_id TEXT NOT NULL,
  note TEXT NOT NULL,
  receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
  created_at TEXT NOT NULL,
  UNIQUE(seller_id,request_key),
  FOREIGN KEY(seller_id,order_id) REFERENCES orders(seller_id,id) ON DELETE RESTRICT
);
CREATE TABLE commerce_stock_allocations (
  resolution_id TEXT NOT NULL REFERENCES commerce_stock_resolutions(id) ON DELETE RESTRICT,
  seller_id TEXT NOT NULL,
  order_item_id TEXT NOT NULL UNIQUE,
  product_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10000),
  PRIMARY KEY(resolution_id,order_item_id),
  FOREIGN KEY(seller_id,order_item_id) REFERENCES order_items(seller_id,id) ON DELETE RESTRICT
);

CREATE TRIGGER commerce_stock_resolution_guard BEFORE INSERT ON commerce_stock_resolutions
BEGIN
  SELECT RAISE(ABORT,'stock_review_changed') WHERE NOT EXISTS (
    SELECT 1 FROM orders o JOIN seller_memberships m ON m.seller_id=o.seller_id
    JOIN sellers s ON s.id=o.seller_id
    WHERE o.id=NEW.order_id AND o.seller_id=NEW.seller_id AND o.commerce_version=1
      AND o.checkout_state='paid' AND o.fulfillment_state='stock_review' AND o.payment_review=0
      AND o.revision=NEW.order_revision AND m.auth_user_id=NEW.actor_auth_user_id
      AND m.role!='viewer' AND s.status='active'
      AND EXISTS (SELECT 1 FROM commerce_payment_captures c WHERE c.order_id=o.id AND c.capture_kind='order_payment')
  );
END;

CREATE TRIGGER commerce_stock_allocation_guard BEFORE INSERT ON commerce_stock_allocations
BEGIN
  SELECT RAISE(ABORT,'stock_review_changed') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_stock_resolutions r JOIN order_items i ON i.order_id=r.order_id AND i.seller_id=r.seller_id
    JOIN inventory_reservations h ON h.order_item_id=i.id AND h.seller_id=i.seller_id
    JOIN orders o ON o.id=r.order_id AND o.seller_id=r.seller_id
    WHERE r.id=NEW.resolution_id AND r.seller_id=NEW.seller_id AND i.id=NEW.order_item_id
      AND i.product_id=NEW.product_id AND i.quantity=NEW.quantity
      AND json_extract(i.fulfillment_snapshot_json,'$.variantId')=NEW.variant_id
      AND h.state='released' AND o.checkout_state='paid' AND o.fulfillment_state='stock_review'
      AND o.revision=r.order_revision
  );
  SELECT RAISE(ABORT,'stock_review_product_changed') WHERE NOT EXISTS (
    SELECT 1 FROM products p WHERE p.seller_id=NEW.seller_id AND p.id=NEW.product_id
      AND p.type='physical' AND p.status IN ('active','archived')
      AND ((NEW.variant_id='' AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id=p.id))
        OR EXISTS (SELECT 1 FROM product_variants v WHERE v.id=NEW.variant_id AND v.product_id=p.id AND v.seller_id=p.seller_id))
  );
  SELECT RAISE(ABORT,'commerce_insufficient_stock') WHERE COALESCE(CASE WHEN NEW.variant_id=''
    THEN (SELECT stock_quantity FROM products WHERE id=NEW.product_id AND seller_id=NEW.seller_id)
    ELSE (SELECT stock_quantity FROM product_variants WHERE id=NEW.variant_id AND product_id=NEW.product_id AND seller_id=NEW.seller_id)
  END,0) < NEW.quantity + COALESCE((SELECT SUM(quantity) FROM inventory_reservations
    WHERE seller_id=NEW.seller_id AND product_id=NEW.product_id AND variant_id=NEW.variant_id AND state='reserved'),0);
END;

CREATE TRIGGER commerce_stock_allocation_consume AFTER INSERT ON commerce_stock_allocations
BEGIN
  INSERT INTO inventory_movements(seller_id,product_id,variant_id,title,sku,quantity_before,quantity_after,reason,reference_id,actor_auth_user_id,note,created_at)
    SELECT NEW.seller_id,p.id,NEW.variant_id,p.title || CASE WHEN v.id IS NULL THEN '' ELSE ' — ' || v.name END,
      COALESCE(v.sku,p.sku,''),COALESCE(v.stock_quantity,p.stock_quantity),COALESCE(v.stock_quantity,p.stock_quantity)-NEW.quantity,
      'late_payment_allocation',r.id,r.actor_auth_user_id,r.order_id || ': ' || r.note,r.created_at
    FROM products p JOIN commerce_stock_resolutions r ON r.id=NEW.resolution_id
    LEFT JOIN product_variants v ON v.id=NEW.variant_id AND v.product_id=p.id AND v.seller_id=p.seller_id
    WHERE p.id=NEW.product_id AND p.seller_id=NEW.seller_id;
  UPDATE products SET stock_quantity=stock_quantity-NEW.quantity,
    updated_at=(SELECT created_at FROM commerce_stock_resolutions WHERE id=NEW.resolution_id)
    WHERE id=NEW.product_id AND seller_id=NEW.seller_id AND NEW.variant_id='';
  UPDATE product_variants SET stock_quantity=stock_quantity-NEW.quantity,
    updated_at=(SELECT created_at FROM commerce_stock_resolutions WHERE id=NEW.resolution_id)
    WHERE id=NEW.variant_id AND product_id=NEW.product_id AND seller_id=NEW.seller_id;
  UPDATE products SET stock_quantity=(SELECT COALESCE(SUM(stock_quantity),0) FROM product_variants
      WHERE product_id=NEW.product_id AND seller_id=NEW.seller_id AND COALESCE(json_extract(options_json,'$.hidden'),0)=0),
    updated_at=(SELECT created_at FROM commerce_stock_resolutions WHERE id=NEW.resolution_id)
    WHERE id=NEW.product_id AND seller_id=NEW.seller_id AND NEW.variant_id!='';
END;

CREATE TRIGGER commerce_stock_resolutions_no_update BEFORE UPDATE ON commerce_stock_resolutions BEGIN SELECT RAISE(ABORT,'stock_review_immutable'); END;
CREATE TRIGGER commerce_stock_resolutions_no_delete BEFORE DELETE ON commerce_stock_resolutions BEGIN SELECT RAISE(ABORT,'stock_review_immutable'); END;
CREATE TRIGGER commerce_stock_allocations_no_update BEFORE UPDATE ON commerce_stock_allocations BEGIN SELECT RAISE(ABORT,'stock_review_immutable'); END;
CREATE TRIGGER commerce_stock_allocations_no_delete BEFORE DELETE ON commerce_stock_allocations BEGIN SELECT RAISE(ABORT,'stock_review_immutable'); END;
