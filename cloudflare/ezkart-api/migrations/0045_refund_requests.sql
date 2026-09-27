-- Purchase-bound refund decisions. Approval is not provider execution or payment evidence.
CREATE TABLE commerce_refunds (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  seller_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  commerce_environment TEXT NOT NULL CHECK (commerce_environment IN ('sandbox','production')),
  capture_id TEXT NOT NULL REFERENCES commerce_payment_captures(id) ON DELETE RESTRICT,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('buyer','merchant')),
  actor_auth_user_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  order_revision INTEGER NOT NULL CHECK (order_revision>0),
  data_json TEXT NOT NULL CHECK (json_valid(data_json)),
  amount INTEGER NOT NULL CHECK (amount BETWEEN 1 AND 100000000000),
  shipping_amount INTEGER NOT NULL CHECK (shipping_amount BETWEEN 0 AND 100000000),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision>0),
  state TEXT NOT NULL DEFAULT 'requested' CHECK (state IN ('requested','approved','declined','withdrawn')),
  last_action_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(actor_auth_user_id,request_key),
  UNIQUE(seller_id,id),
  FOREIGN KEY(seller_id,order_id) REFERENCES orders(seller_id,id) ON DELETE RESTRICT
);
CREATE INDEX idx_refunds_store ON commerce_refunds(seller_id,commerce_environment,sequence DESC);
CREATE INDEX idx_refunds_order ON commerce_refunds(order_id,sequence DESC);
CREATE TABLE commerce_refund_items (
  refund_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  order_item_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount BETWEEN 1 AND 100000000000),
  PRIMARY KEY(refund_id,order_item_id),
  FOREIGN KEY(seller_id,refund_id) REFERENCES commerce_refunds(seller_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(seller_id,order_item_id) REFERENCES order_items(seller_id,id) ON DELETE RESTRICT
);
CREATE INDEX idx_refund_item_allocation ON commerce_refund_items(order_item_id,refund_id);
CREATE TABLE commerce_refund_actions (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  refund_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('buyer','merchant')),
  actor_auth_user_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  previous_revision INTEGER NOT NULL CHECK (previous_revision>0),
  order_revision INTEGER NOT NULL CHECK (order_revision>0),
  kind TEXT NOT NULL CHECK (kind IN ('approve','decline','withdraw')),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 3 AND 2000),
  created_at TEXT NOT NULL,
  UNIQUE(actor_auth_user_id,request_key),
  UNIQUE(refund_id,previous_revision),
  FOREIGN KEY(seller_id,refund_id) REFERENCES commerce_refunds(seller_id,id) ON DELETE RESTRICT
);
CREATE INDEX idx_refund_actions ON commerce_refund_actions(refund_id,sequence DESC);

CREATE TRIGGER commerce_refund_create_guard BEFORE INSERT ON commerce_refunds BEGIN
  SELECT RAISE(ABORT,'refund_immutable') WHERE EXISTS(SELECT 1 FROM commerce_refunds r
    WHERE r.sequence=NEW.sequence OR r.id=NEW.id OR (r.actor_auth_user_id=NEW.actor_auth_user_id AND r.request_key=NEW.request_key));
  SELECT RAISE(ABORT,'refund_order_changed') WHERE NEW.state!='requested' OR NEW.revision!=1 OR NEW.last_action_id IS NOT NULL
    OR NEW.updated_at!=NEW.created_at OR NOT EXISTS(SELECT 1 FROM orders o JOIN commerce_payment_captures c ON c.order_id=o.id
      WHERE o.id=NEW.order_id AND o.seller_id=NEW.seller_id AND o.commerce_environment=NEW.commerce_environment
        AND o.commerce_version=1 AND o.revision=NEW.order_revision AND o.checkout_state='paid' AND o.payment_review=0
        AND c.id=NEW.capture_id AND c.capture_kind='order_payment' AND c.amount=o.total_amount AND c.currency='IDR');
  SELECT RAISE(ABORT,'refund_actor_forbidden') WHERE NOT (
    (NEW.actor_kind='merchant' AND EXISTS(SELECT 1 FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id
      WHERE m.seller_id=NEW.seller_id AND m.auth_user_id=NEW.actor_auth_user_id AND m.role!='viewer' AND s.status='active'))
    OR (NEW.actor_kind='buyer' AND EXISTS(SELECT 1 FROM orders o LEFT JOIN commerce_order_owners a ON a.order_id=o.id
      WHERE o.id=NEW.order_id AND COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=NEW.actor_auth_user_id)));
  SELECT RAISE(ABORT,'refund_content_invalid') WHERE json_type(NEW.data_json) IS NOT 'object'
    OR json_type(NEW.data_json,'$.reason') IS NOT 'text' OR json_extract(NEW.data_json,'$.reason') NOT IN ('not_received','damaged','wrong_item','not_as_described','file_problem','changed_mind','other')
    OR json_type(NEW.data_json,'$.note') IS NOT 'text' OR length(trim(json_extract(NEW.data_json,'$.note'))) NOT BETWEEN 3 AND 2000
    OR json_type(NEW.data_json,'$.items') IS NOT 'array' OR json_array_length(NEW.data_json,'$.items')>50
    OR json_type(NEW.data_json,'$.shippingAmount') IS NOT 'integer' OR json_extract(NEW.data_json,'$.shippingAmount')!=NEW.shipping_amount
    OR NEW.amount!=NEW.shipping_amount+COALESCE((SELECT SUM(json_extract(value,'$.amount')) FROM json_each(NEW.data_json,'$.items')),0)
    OR (SELECT COUNT(DISTINCT json_extract(value,'$.orderItemId')) FROM json_each(NEW.data_json,'$.items'))!=json_array_length(NEW.data_json,'$.items');
  SELECT RAISE(ABORT,'refund_allocation_exceeded') WHERE EXISTS(SELECT 1 FROM json_each(NEW.data_json,'$.items') line
    WHERE json_type(line.value) IS NOT 'object' OR json_type(line.value,'$.orderItemId') IS NOT 'text'
      OR json_type(line.value,'$.amount') IS NOT 'integer' OR json_extract(line.value,'$.amount')<1
      OR NOT EXISTS(SELECT 1 FROM order_items i WHERE i.id=json_extract(line.value,'$.orderItemId') AND i.order_id=NEW.order_id AND i.seller_id=NEW.seller_id
        AND i.product_type IN ('physical','digital') AND i.quantity*i.unit_price_amount>=json_extract(line.value,'$.amount')+COALESCE((
          SELECT SUM(ri.amount) FROM commerce_refund_items ri JOIN commerce_refunds r ON r.id=ri.refund_id
          WHERE ri.order_item_id=i.id AND r.state IN ('requested','approved')),0)));
  SELECT RAISE(ABORT,'refund_allocation_exceeded') WHERE NEW.shipping_amount+COALESCE((SELECT SUM(r.shipping_amount)
    FROM commerce_refunds r WHERE r.order_id=NEW.order_id AND r.state IN ('requested','approved')),0)>(SELECT shipping_amount FROM orders WHERE id=NEW.order_id);
  SELECT RAISE(ABORT,'refund_request_limit') WHERE (SELECT COUNT(*) FROM commerce_refunds r
    WHERE r.order_id=NEW.order_id AND r.created_at>=strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'-1 hour'))>=20;
END;

CREATE TRIGGER commerce_refund_item_guard BEFORE INSERT ON commerce_refund_items BEGIN
  SELECT RAISE(ABORT,'refund_immutable') WHERE EXISTS(SELECT 1 FROM commerce_refund_items WHERE refund_id=NEW.refund_id AND order_item_id=NEW.order_item_id);
  SELECT RAISE(ABORT,'refund_content_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_refunds r,json_each(r.data_json,'$.items') line
    WHERE r.id=NEW.refund_id AND r.seller_id=NEW.seller_id AND r.state='requested' AND r.revision=1
      AND json_extract(line.value,'$.orderItemId')=NEW.order_item_id AND json_extract(line.value,'$.amount')=NEW.amount);
END;
CREATE TRIGGER commerce_refund_project_items AFTER INSERT ON commerce_refunds BEGIN
  INSERT INTO commerce_refund_items(refund_id,seller_id,order_item_id,amount)
    SELECT NEW.id,NEW.seller_id,json_extract(value,'$.orderItemId'),json_extract(value,'$.amount') FROM json_each(NEW.data_json,'$.items');
END;

CREATE TRIGGER commerce_refund_action_guard BEFORE INSERT ON commerce_refund_actions BEGIN
  SELECT RAISE(ABORT,'refund_immutable') WHERE EXISTS(SELECT 1 FROM commerce_refund_actions a
    WHERE a.sequence=NEW.sequence OR a.id=NEW.id OR (a.actor_auth_user_id=NEW.actor_auth_user_id AND a.request_key=NEW.request_key));
  SELECT RAISE(ABORT,'refund_revision_conflict') WHERE NOT EXISTS(SELECT 1 FROM commerce_refunds r JOIN orders o ON o.id=r.order_id
    WHERE r.id=NEW.refund_id AND r.seller_id=NEW.seller_id AND r.state='requested' AND r.revision=NEW.previous_revision
      AND o.revision=NEW.order_revision AND (NEW.kind!='approve' OR (o.checkout_state='paid' AND o.payment_review=0)));
  SELECT RAISE(ABORT,'refund_actor_forbidden') WHERE NOT (
    (NEW.actor_kind='merchant' AND EXISTS(SELECT 1 FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id
      WHERE m.seller_id=NEW.seller_id AND m.auth_user_id=NEW.actor_auth_user_id AND m.role!='viewer' AND s.status='active')
      AND (NEW.kind IN ('approve','decline') OR (NEW.kind='withdraw' AND EXISTS(SELECT 1 FROM commerce_refunds r
        WHERE r.id=NEW.refund_id AND r.actor_kind='merchant' AND r.actor_auth_user_id=NEW.actor_auth_user_id))))
    OR (NEW.actor_kind='buyer' AND NEW.kind='withdraw' AND EXISTS(SELECT 1 FROM commerce_refunds r JOIN orders o ON o.id=r.order_id
      LEFT JOIN commerce_order_owners a ON a.order_id=o.id WHERE r.id=NEW.refund_id
        AND COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=NEW.actor_auth_user_id)));
END;
CREATE TRIGGER commerce_refund_project_action AFTER INSERT ON commerce_refund_actions BEGIN
  UPDATE commerce_refunds SET revision=revision+1,state=CASE NEW.kind WHEN 'approve' THEN 'approved' WHEN 'decline' THEN 'declined' ELSE 'withdrawn' END,
    last_action_id=NEW.id,updated_at=NEW.created_at WHERE id=NEW.refund_id;
END;
CREATE TRIGGER commerce_refund_update_guard BEFORE UPDATE ON commerce_refunds BEGIN
  SELECT RAISE(ABORT,'refund_immutable') WHERE NEW.sequence IS NOT OLD.sequence OR NEW.id IS NOT OLD.id OR NEW.seller_id IS NOT OLD.seller_id
    OR NEW.order_id IS NOT OLD.order_id OR NEW.commerce_environment IS NOT OLD.commerce_environment OR NEW.capture_id IS NOT OLD.capture_id
    OR NEW.actor_kind IS NOT OLD.actor_kind OR NEW.actor_auth_user_id IS NOT OLD.actor_auth_user_id OR NEW.request_key IS NOT OLD.request_key
    OR NEW.request_hash IS NOT OLD.request_hash OR NEW.order_revision IS NOT OLD.order_revision OR NEW.data_json IS NOT OLD.data_json
    OR NEW.amount IS NOT OLD.amount OR NEW.shipping_amount IS NOT OLD.shipping_amount OR NEW.created_at IS NOT OLD.created_at
    OR NEW.revision!=OLD.revision+1 OR OLD.state!='requested' OR NOT EXISTS(SELECT 1 FROM commerce_refund_actions a
      WHERE a.id=NEW.last_action_id AND a.refund_id=OLD.id AND a.previous_revision=OLD.revision AND a.created_at=NEW.updated_at
        AND NEW.state=CASE a.kind WHEN 'approve' THEN 'approved' WHEN 'decline' THEN 'declined' ELSE 'withdrawn' END);
END;
CREATE TRIGGER commerce_refunds_no_delete BEFORE DELETE ON commerce_refunds BEGIN SELECT RAISE(ABORT,'refund_immutable'); END;
CREATE TRIGGER commerce_refund_items_no_update BEFORE UPDATE ON commerce_refund_items BEGIN SELECT RAISE(ABORT,'refund_immutable'); END;
CREATE TRIGGER commerce_refund_items_no_delete BEFORE DELETE ON commerce_refund_items BEGIN SELECT RAISE(ABORT,'refund_immutable'); END;
CREATE TRIGGER commerce_refund_actions_no_update BEFORE UPDATE ON commerce_refund_actions BEGIN SELECT RAISE(ABORT,'refund_immutable'); END;
CREATE TRIGGER commerce_refund_actions_no_delete BEFORE DELETE ON commerce_refund_actions BEGIN SELECT RAISE(ABORT,'refund_immutable'); END;
