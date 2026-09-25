-- Bind guest orders only through the verified customer session service. A
-- later email/account change cannot transfer an already claimed order.
CREATE TABLE commerce_order_owners (
  order_id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  auth_user_id TEXT NOT NULL,
  verified_email TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('checkout_identity','verified_email')),
  created_at TEXT NOT NULL,
  FOREIGN KEY(seller_id,order_id) REFERENCES orders(seller_id,id) ON DELETE RESTRICT
);
CREATE INDEX idx_commerce_owned_orders ON commerce_order_owners(auth_user_id,order_id);
CREATE TRIGGER commerce_owner_guard BEFORE INSERT ON commerce_order_owners
BEGIN
  SELECT RAISE(ABORT,'commerce_customer_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM orders o WHERE o.id=NEW.order_id AND o.seller_id=NEW.seller_id AND o.commerce_version=1
      AND (NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),'')=NEW.auth_user_id
        OR (COALESCE(json_extract(o.customer_snapshot_json,'$.authUserId'),'')=''
          AND lower(trim(json_extract(o.customer_snapshot_json,'$.email')))=NEW.verified_email))
  );
END;
CREATE TRIGGER commerce_owners_no_update BEFORE UPDATE ON commerce_order_owners BEGIN SELECT RAISE(ABORT,'commerce_immutable_owner'); END;
CREATE TRIGGER commerce_owners_no_delete BEFORE DELETE ON commerce_order_owners BEGIN SELECT RAISE(ABORT,'commerce_immutable_owner'); END;
CREATE TRIGGER commerce_customer_snapshot_immutable BEFORE UPDATE ON orders
WHEN OLD.commerce_version=1 AND (NEW.customer_snapshot_json!=OLD.customer_snapshot_json OR NEW.shipping_address_json IS NOT OLD.shipping_address_json)
BEGIN SELECT RAISE(ABORT,'commerce_immutable_customer_snapshot'); END;

CREATE TABLE commerce_returns (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  order_revision INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision>0),
  state TEXT NOT NULL DEFAULT 'requested' CHECK (state IN ('requested','approved','declined','withdrawn','receiving','inspected','closed')),
  reason TEXT NOT NULL CHECK (reason IN ('damaged','wrong_item','not_as_described','changed_mind','delivery_failed','other')),
  customer_note TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('merchant','customer')),
  actor_auth_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(seller_id,request_key),
  UNIQUE(seller_id,id),
  FOREIGN KEY(seller_id,order_id) REFERENCES orders(seller_id,id) ON DELETE RESTRICT
);
CREATE INDEX idx_returns_store ON commerce_returns(seller_id,created_at DESC,id DESC);
CREATE INDEX idx_returns_order ON commerce_returns(order_id,id);
CREATE TABLE commerce_return_items (
  return_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  order_item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10000),
  PRIMARY KEY(return_id,order_item_id),
  FOREIGN KEY(seller_id,return_id) REFERENCES commerce_returns(seller_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(seller_id,order_item_id) REFERENCES order_items(seller_id,id) ON DELETE RESTRICT
);
CREATE TABLE commerce_return_actions (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  return_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  previous_revision INTEGER NOT NULL,
  order_revision INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('approve','decline','withdraw','inspect','close')),
  target_state TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('merchant','customer')),
  actor_auth_user_id TEXT NOT NULL,
  public_message TEXT NOT NULL DEFAULT '',
  private_note TEXT NOT NULL DEFAULT '',
  receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
  created_at TEXT NOT NULL,
  UNIQUE(return_id,request_key),
  UNIQUE(return_id,previous_revision),
  FOREIGN KEY(seller_id,return_id) REFERENCES commerce_returns(seller_id,id) ON DELETE RESTRICT
);
CREATE INDEX idx_return_order_item ON commerce_return_items(order_item_id,return_id);
CREATE TABLE commerce_return_inspections (
  action_id TEXT NOT NULL REFERENCES commerce_return_actions(id) ON DELETE RESTRICT,
  return_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  order_item_id TEXT NOT NULL,
  received_quantity INTEGER NOT NULL CHECK (received_quantity BETWEEN 1 AND 10000),
  restocked_quantity INTEGER NOT NULL CHECK (restocked_quantity BETWEEN 0 AND received_quantity),
  PRIMARY KEY(action_id,order_item_id),
  FOREIGN KEY(return_id,order_item_id) REFERENCES commerce_return_items(return_id,order_item_id) ON DELETE RESTRICT,
  FOREIGN KEY(seller_id,return_id) REFERENCES commerce_returns(seller_id,id) ON DELETE RESTRICT
);
CREATE INDEX idx_return_inspected_item ON commerce_return_inspections(return_id,order_item_id);

CREATE TRIGGER commerce_return_create_guard BEFORE INSERT ON commerce_returns
BEGIN
  SELECT RAISE(ABORT,'return_order_changed') WHERE NEW.state!='requested' OR NEW.revision!=1 OR NOT EXISTS (
    SELECT 1 FROM orders o WHERE o.id=NEW.order_id AND o.seller_id=NEW.seller_id AND o.commerce_version=1
      AND o.checkout_state IN ('paid','partially_refunded','refunded') AND o.revision=NEW.order_revision
      AND ((NEW.actor_kind='customer' AND o.fulfillment_state='delivered')
        OR (NEW.actor_kind='merchant' AND o.fulfillment_state IN ('delivered','return_in_transit','returned')))
      AND EXISTS (SELECT 1 FROM commerce_payment_captures c WHERE c.order_id=o.id AND c.capture_kind='order_payment')
  );
  SELECT RAISE(ABORT,'return_actor_forbidden') WHERE NOT (
    (NEW.actor_kind='merchant' AND EXISTS (SELECT 1 FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id
      WHERE m.seller_id=NEW.seller_id AND m.auth_user_id=NEW.actor_auth_user_id AND m.role!='viewer' AND s.status='active'))
    OR (NEW.actor_kind='customer' AND EXISTS (SELECT 1 FROM orders o LEFT JOIN commerce_order_owners a ON a.order_id=o.id
      WHERE o.id=NEW.order_id AND COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=NEW.actor_auth_user_id))
  );
END;

CREATE TRIGGER commerce_return_item_guard BEFORE INSERT ON commerce_return_items
BEGIN
  SELECT RAISE(ABORT,'return_quantity_exceeded') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_returns r JOIN order_items i ON i.order_id=r.order_id AND i.seller_id=r.seller_id
      JOIN orders o ON o.id=r.order_id AND o.revision=r.order_revision
    WHERE r.id=NEW.return_id AND r.seller_id=NEW.seller_id AND r.state='requested' AND r.revision=1 AND i.id=NEW.order_item_id
      AND i.product_type='physical'
      AND (EXISTS (SELECT 1 FROM inventory_reservations h WHERE h.order_item_id=i.id AND h.state='committed')
        OR EXISTS (SELECT 1 FROM commerce_stock_allocations a WHERE a.order_item_id=i.id))
      AND i.quantity >= NEW.quantity + COALESCE((SELECT SUM(CASE WHEN prior.state IN ('declined','withdrawn','closed')
        THEN COALESCE((SELECT SUM(n.received_quantity) FROM commerce_return_inspections n WHERE n.return_id=ri.return_id AND n.order_item_id=ri.order_item_id),0)
        ELSE ri.quantity END) FROM commerce_return_items ri JOIN commerce_returns prior ON prior.id=ri.return_id
        WHERE ri.order_item_id=i.id),0)
  );
END;

CREATE TRIGGER commerce_return_action_guard BEFORE INSERT ON commerce_return_actions
BEGIN
  SELECT RAISE(ABORT,'return_revision_conflict') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_returns r JOIN orders o ON o.id=r.order_id AND o.seller_id=r.seller_id
    WHERE r.id=NEW.return_id AND r.seller_id=NEW.seller_id AND r.revision=NEW.previous_revision AND o.revision=NEW.order_revision
      AND ((NEW.kind='approve' AND r.state='requested' AND NEW.target_state='approved' AND NEW.actor_kind='merchant')
        OR (NEW.kind='decline' AND r.state='requested' AND NEW.target_state='declined' AND NEW.actor_kind='merchant')
        OR (NEW.kind='withdraw' AND r.state='requested' AND NEW.target_state='withdrawn')
        OR (NEW.kind='inspect' AND r.state IN ('approved','receiving') AND NEW.target_state IN ('receiving','inspected') AND NEW.actor_kind='merchant')
        OR (NEW.kind='close' AND r.state IN ('approved','receiving') AND NEW.target_state='closed' AND NEW.actor_kind='merchant'))
  );
  SELECT RAISE(ABORT,'return_actor_forbidden') WHERE NOT (
    (NEW.actor_kind='merchant' AND EXISTS (SELECT 1 FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id
      WHERE m.seller_id=NEW.seller_id AND m.auth_user_id=NEW.actor_auth_user_id AND m.role!='viewer' AND s.status='active'))
    OR (NEW.actor_kind='customer' AND NEW.kind='withdraw' AND EXISTS (
      SELECT 1 FROM commerce_returns r JOIN orders o ON o.id=r.order_id LEFT JOIN commerce_order_owners a ON a.order_id=o.id
      WHERE r.id=NEW.return_id AND COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=NEW.actor_auth_user_id))
  );
END;

CREATE TRIGGER commerce_return_inspection_guard BEFORE INSERT ON commerce_return_inspections
BEGIN
  SELECT RAISE(ABORT,'return_quantity_exceeded') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_return_actions a JOIN commerce_return_items ri ON ri.return_id=a.return_id
      JOIN commerce_returns r ON r.id=a.return_id JOIN orders o ON o.id=r.order_id
    WHERE a.id=NEW.action_id AND a.kind='inspect' AND a.seller_id=NEW.seller_id AND a.return_id=NEW.return_id
      AND r.revision=a.previous_revision AND r.state IN ('approved','receiving') AND o.revision=a.order_revision
      AND ri.order_item_id=NEW.order_item_id AND ri.quantity >= NEW.received_quantity + COALESCE((
        SELECT SUM(n.received_quantity) FROM commerce_return_inspections n WHERE n.return_id=NEW.return_id AND n.order_item_id=NEW.order_item_id),0)
  );
  SELECT RAISE(ABORT,'return_original_option_missing') WHERE NEW.restocked_quantity>0 AND NOT EXISTS (
    SELECT 1 FROM order_items i JOIN products p ON p.id=i.product_id AND p.seller_id=i.seller_id
    LEFT JOIN product_variants v ON v.id=json_extract(i.fulfillment_snapshot_json,'$.variantId') AND v.product_id=p.id AND v.seller_id=p.seller_id
    WHERE i.id=NEW.order_item_id AND i.seller_id=NEW.seller_id AND p.type='physical' AND p.status IN ('active','archived')
      AND ((json_extract(i.fulfillment_snapshot_json,'$.variantId')='' AND NOT EXISTS (SELECT 1 FROM product_variants allv WHERE allv.product_id=p.id)) OR v.id IS NOT NULL)
      AND COALESCE(v.stock_quantity,p.stock_quantity)+NEW.restocked_quantity<=1000000000
  );
END;

CREATE TRIGGER commerce_return_restock AFTER INSERT ON commerce_return_inspections WHEN NEW.restocked_quantity>0
BEGIN
  INSERT INTO inventory_movements(seller_id,product_id,variant_id,title,sku,quantity_before,quantity_after,reason,reference_id,actor_auth_user_id,note,created_at)
    SELECT i.seller_id,i.product_id,json_extract(i.fulfillment_snapshot_json,'$.variantId'),p.title || CASE WHEN v.id IS NULL THEN '' ELSE ' — ' || v.name END,
      COALESCE(v.sku,p.sku,''),COALESCE(v.stock_quantity,p.stock_quantity),COALESCE(v.stock_quantity,p.stock_quantity)+NEW.restocked_quantity,
      'return_restock',a.id,a.actor_auth_user_id,a.return_id || ': ' || a.private_note,a.created_at
    FROM order_items i JOIN products p ON p.id=i.product_id AND p.seller_id=i.seller_id
    JOIN commerce_return_actions a ON a.id=NEW.action_id
    LEFT JOIN product_variants v ON v.id=json_extract(i.fulfillment_snapshot_json,'$.variantId') AND v.product_id=p.id AND v.seller_id=p.seller_id
    WHERE i.id=NEW.order_item_id AND i.seller_id=NEW.seller_id;
  UPDATE products SET stock_quantity=stock_quantity+NEW.restocked_quantity,
    updated_at=(SELECT created_at FROM commerce_return_actions WHERE id=NEW.action_id)
    WHERE id=(SELECT product_id FROM order_items WHERE id=NEW.order_item_id) AND seller_id=NEW.seller_id
      AND (SELECT json_extract(fulfillment_snapshot_json,'$.variantId') FROM order_items WHERE id=NEW.order_item_id)='';
  UPDATE product_variants SET stock_quantity=stock_quantity+NEW.restocked_quantity,
    updated_at=(SELECT created_at FROM commerce_return_actions WHERE id=NEW.action_id)
    WHERE id=(SELECT json_extract(fulfillment_snapshot_json,'$.variantId') FROM order_items WHERE id=NEW.order_item_id)
      AND product_id=(SELECT product_id FROM order_items WHERE id=NEW.order_item_id) AND seller_id=NEW.seller_id;
  UPDATE products SET stock_quantity=(SELECT COALESCE(SUM(v.stock_quantity),0) FROM product_variants v
      WHERE v.product_id=products.id AND v.seller_id=NEW.seller_id AND COALESCE(json_extract(v.options_json,'$.hidden'),0)=0),
    updated_at=(SELECT created_at FROM commerce_return_actions WHERE id=NEW.action_id)
    WHERE id=(SELECT product_id FROM order_items WHERE id=NEW.order_item_id) AND seller_id=NEW.seller_id
      AND (SELECT json_extract(fulfillment_snapshot_json,'$.variantId') FROM order_items WHERE id=NEW.order_item_id)!='';
END;

CREATE TRIGGER commerce_return_update_guard BEFORE UPDATE ON commerce_returns
BEGIN
  SELECT RAISE(ABORT,'return_immutable') WHERE NEW.id!=OLD.id OR NEW.seller_id!=OLD.seller_id OR NEW.order_id!=OLD.order_id
    OR NEW.request_key!=OLD.request_key OR NEW.request_hash!=OLD.request_hash OR NEW.order_revision!=OLD.order_revision
    OR NEW.reason!=OLD.reason OR NEW.customer_note!=OLD.customer_note OR NEW.actor_kind!=OLD.actor_kind
    OR NEW.actor_auth_user_id!=OLD.actor_auth_user_id OR NEW.created_at!=OLD.created_at;
  SELECT RAISE(ABORT,'return_revision_conflict') WHERE NEW.revision!=OLD.revision+1 OR NOT EXISTS (
    SELECT 1 FROM commerce_return_actions a WHERE a.return_id=OLD.id AND a.previous_revision=OLD.revision AND a.target_state=NEW.state
  );
  SELECT RAISE(ABORT,'return_inspection_incomplete') WHERE NEW.state='inspected' AND EXISTS (
    SELECT 1 FROM commerce_return_items ri WHERE ri.return_id=OLD.id AND ri.quantity != COALESCE((
      SELECT SUM(n.received_quantity) FROM commerce_return_inspections n WHERE n.return_id=ri.return_id AND n.order_item_id=ri.order_item_id),0)
  );
END;
CREATE TRIGGER commerce_returns_no_delete BEFORE DELETE ON commerce_returns BEGIN SELECT RAISE(ABORT,'return_immutable'); END;
CREATE TRIGGER commerce_return_items_no_update BEFORE UPDATE ON commerce_return_items BEGIN SELECT RAISE(ABORT,'return_immutable'); END;
CREATE TRIGGER commerce_return_items_no_delete BEFORE DELETE ON commerce_return_items BEGIN SELECT RAISE(ABORT,'return_immutable'); END;
CREATE TRIGGER commerce_return_actions_no_update BEFORE UPDATE ON commerce_return_actions BEGIN SELECT RAISE(ABORT,'return_immutable'); END;
CREATE TRIGGER commerce_return_actions_no_delete BEFORE DELETE ON commerce_return_actions BEGIN SELECT RAISE(ABORT,'return_immutable'); END;
CREATE TRIGGER commerce_return_inspections_no_update BEFORE UPDATE ON commerce_return_inspections BEGIN SELECT RAISE(ABORT,'return_immutable'); END;
CREATE TRIGGER commerce_return_inspections_no_delete BEFORE DELETE ON commerce_return_inspections BEGIN SELECT RAISE(ABORT,'return_immutable'); END;
