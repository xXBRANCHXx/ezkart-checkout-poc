-- Review cases preserve original decisions; no action here executes a refund.
CREATE TABLE commerce_support_permissions (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  auth_user_id TEXT NOT NULL REFERENCES app_users(auth_user_id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK(role IN ('reviewer','viewer','revoked')),
  request_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  operator TEXT NOT NULL CHECK(length(operator) BETWEEN 3 AND 100),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_support_member ON commerce_support_permissions(commerce_environment,auth_user_id,sequence DESC);
CREATE VIEW commerce_support_staff AS SELECT p.* FROM commerce_support_permissions p WHERE sequence=(
  SELECT MAX(x.sequence) FROM commerce_support_permissions x WHERE x.auth_user_id=p.auth_user_id AND x.commerce_environment=p.commerce_environment);
CREATE TRIGGER support_permission_insert BEFORE INSERT ON commerce_support_permissions BEGIN
  SELECT RAISE(ABORT,'support_permission_immutable') WHERE EXISTS(SELECT 1 FROM commerce_support_permissions WHERE id=NEW.id OR sequence=NEW.sequence OR request_key=NEW.request_key);
END;
CREATE TRIGGER support_permission_update BEFORE UPDATE ON commerce_support_permissions BEGIN SELECT RAISE(ABORT,'support_permission_immutable'); END;
CREATE TRIGGER support_permission_delete BEFORE DELETE ON commerce_support_permissions BEGIN SELECT RAISE(ABORT,'support_permission_immutable'); END;

CREATE TABLE commerce_refund_disputes (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  refund_id TEXT NOT NULL UNIQUE,
  seller_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  actor_kind TEXT NOT NULL CHECK(actor_kind IN ('buyer','merchant')),
  actor_auth_user_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  refund_revision INTEGER NOT NULL CHECK(refund_revision>0),
  evidence_version INTEGER NOT NULL CHECK(evidence_version BETWEEN 0 AND 40),
  message TEXT NOT NULL CHECK(length(trim(message)) BETWEEN 3 AND 2000),
  state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','awaiting_buyer','awaiting_store','approved','declined','withdrawn')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  last_action_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(actor_auth_user_id,request_key),
  FOREIGN KEY(seller_id,refund_id) REFERENCES commerce_refunds(seller_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(seller_id,order_id) REFERENCES orders(seller_id,id) ON DELETE RESTRICT
);
CREATE INDEX idx_disputes_queue ON commerce_refund_disputes(commerce_environment,state,sequence DESC);
CREATE TABLE commerce_refund_dispute_actions (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  dispute_id TEXT NOT NULL REFERENCES commerce_refund_disputes(id) ON DELETE RESTRICT,
  actor_kind TEXT NOT NULL CHECK(actor_kind IN ('buyer','merchant','support')),
  actor_auth_user_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  previous_revision INTEGER NOT NULL CHECK(previous_revision>0),
  refund_revision INTEGER NOT NULL CHECK(refund_revision>0),
  order_revision INTEGER NOT NULL CHECK(order_revision>0),
  evidence_version INTEGER NOT NULL CHECK(evidence_version BETWEEN 0 AND 40),
  proof_expires_at INTEGER,
  kind TEXT NOT NULL CHECK(kind IN ('reply','ask_buyer','ask_store','approve','decline','withdraw','reopen')),
  message TEXT NOT NULL CHECK(length(trim(message)) BETWEEN 3 AND 2000),
  created_at TEXT NOT NULL,
  UNIQUE(actor_auth_user_id,request_key),
  UNIQUE(dispute_id,previous_revision)
);
CREATE INDEX idx_dispute_actions ON commerce_refund_dispute_actions(dispute_id,sequence);

CREATE TRIGGER refund_dispute_open_guard BEFORE INSERT ON commerce_refund_disputes BEGIN
  SELECT RAISE(ABORT,'dispute_immutable') WHERE EXISTS(SELECT 1 FROM commerce_refund_disputes WHERE id=NEW.id OR sequence=NEW.sequence OR refund_id=NEW.refund_id OR (actor_auth_user_id=NEW.actor_auth_user_id AND request_key=NEW.request_key));
  SELECT RAISE(ABORT,'dispute_refund_changed') WHERE NEW.state!='open' OR NEW.revision!=1 OR NEW.last_action_id IS NOT NULL OR NEW.updated_at!=NEW.created_at
    OR NOT EXISTS(SELECT 1 FROM commerce_refunds r WHERE r.id=NEW.refund_id AND r.seller_id=NEW.seller_id AND r.order_id=NEW.order_id
      AND r.commerce_environment=NEW.commerce_environment AND r.revision=NEW.refund_revision AND r.state!='withdrawn')
    OR NEW.evidence_version!=(SELECT COALESCE(SUM(1+(state='ready')),0) FROM commerce_refund_attachments WHERE refund_id=NEW.refund_id);
  SELECT RAISE(ABORT,'dispute_actor_forbidden') WHERE NOT (
    (NEW.actor_kind='merchant' AND EXISTS(SELECT 1 FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id
      WHERE m.seller_id=NEW.seller_id AND m.auth_user_id=NEW.actor_auth_user_id AND m.role!='viewer' AND s.status='active'))
    OR (NEW.actor_kind='buyer' AND EXISTS(SELECT 1 FROM orders o LEFT JOIN commerce_order_owners a ON a.order_id=o.id
      WHERE o.id=NEW.order_id AND COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=NEW.actor_auth_user_id)));
  SELECT RAISE(ABORT,'dispute_allocation_exceeded') WHERE EXISTS(SELECT 1 FROM commerce_refund_items own JOIN order_items i ON i.id=own.order_item_id WHERE own.refund_id=NEW.refund_id
      AND own.amount+COALESCE((SELECT SUM(ri.amount) FROM commerce_refund_items ri JOIN commerce_refunds r ON r.id=ri.refund_id
        WHERE ri.order_item_id=own.order_item_id AND r.id!=NEW.refund_id AND (r.state IN ('requested','approved') OR EXISTS(SELECT 1 FROM commerce_refund_disputes d WHERE d.refund_id=r.id AND d.state IN ('open','awaiting_buyer','awaiting_store')))),0)>i.quantity*i.unit_price_amount)
    OR EXISTS(SELECT 1 FROM commerce_refunds own JOIN orders o ON o.id=own.order_id WHERE own.id=NEW.refund_id
      AND own.shipping_amount+COALESCE((SELECT SUM(r.shipping_amount) FROM commerce_refunds r
        WHERE r.order_id=own.order_id AND r.id!=own.id AND (r.state IN ('requested','approved') OR EXISTS(SELECT 1 FROM commerce_refund_disputes d WHERE d.refund_id=r.id AND d.state IN ('open','awaiting_buyer','awaiting_store')))),0)>o.shipping_amount);
END;

CREATE TRIGGER refund_dispute_action_guard BEFORE INSERT ON commerce_refund_dispute_actions BEGIN
  SELECT RAISE(ABORT,'dispute_immutable') WHERE EXISTS(SELECT 1 FROM commerce_refund_dispute_actions WHERE id=NEW.id OR sequence=NEW.sequence OR (actor_auth_user_id=NEW.actor_auth_user_id AND request_key=NEW.request_key));
  SELECT RAISE(ABORT,'dispute_revision_changed') WHERE NOT EXISTS(SELECT 1 FROM commerce_refund_disputes d WHERE d.id=NEW.dispute_id
    AND d.revision=NEW.previous_revision AND ((NEW.kind!='reopen' AND d.state IN ('open','awaiting_buyer','awaiting_store'))
      OR (NEW.kind='reopen' AND d.state IN ('approved','declined','withdrawn'))));
  SELECT RAISE(ABORT,'dispute_actor_forbidden') WHERE NOT EXISTS(SELECT 1 FROM commerce_refund_disputes d WHERE d.id=NEW.dispute_id AND (
    (NEW.actor_kind='support' AND NEW.kind!='withdraw' AND EXISTS(SELECT 1 FROM commerce_support_staff p WHERE p.auth_user_id=NEW.actor_auth_user_id AND p.commerce_environment=d.commerce_environment AND p.role='reviewer'))
    OR (NEW.kind IN ('reply','withdraw') AND (NEW.kind!='withdraw' OR (d.actor_kind=NEW.actor_kind AND d.actor_auth_user_id=NEW.actor_auth_user_id)) AND
(
    (NEW.actor_kind='merchant' AND EXISTS(SELECT 1 FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id
      WHERE m.seller_id=d.seller_id AND m.auth_user_id=NEW.actor_auth_user_id AND m.role!='viewer' AND s.status='active'))
    OR (NEW.actor_kind='buyer' AND EXISTS(SELECT 1 FROM orders o LEFT JOIN commerce_order_owners a ON a.order_id=o.id
      WHERE o.id=d.order_id AND COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=NEW.actor_auth_user_id))))));
  SELECT RAISE(ABORT,'dispute_proof_expired') WHERE NEW.actor_kind='support' AND (NEW.proof_expires_at IS NULL OR NEW.proof_expires_at<=unixepoch('now') OR NEW.proof_expires_at>unixepoch('now')+630);
  SELECT RAISE(ABORT,'dispute_proof_invalid') WHERE NEW.actor_kind!='support' AND NEW.proof_expires_at IS NOT NULL;
  SELECT RAISE(ABORT,'dispute_evidence_changed') WHERE NEW.kind IN ('approve','decline','reopen') AND NOT EXISTS(
    SELECT 1 FROM commerce_refund_disputes d JOIN commerce_refunds r ON r.id=d.refund_id JOIN orders o ON o.id=d.order_id
    WHERE d.id=NEW.dispute_id AND r.revision=NEW.refund_revision AND o.revision=NEW.order_revision
      AND NEW.evidence_version=(SELECT COALESCE(SUM(1+(state='ready')),0) FROM commerce_refund_attachments WHERE refund_id=r.id)
      AND (NEW.kind!='approve' OR (o.checkout_state='paid' AND o.payment_review=0)));
  SELECT RAISE(ABORT,'dispute_allocation_exceeded') WHERE NEW.kind IN ('approve','reopen') AND (EXISTS(SELECT 1 FROM commerce_refund_items own JOIN order_items i ON i.id=own.order_item_id WHERE own.refund_id=(SELECT refund_id FROM commerce_refund_disputes WHERE id=NEW.dispute_id)
      AND own.amount+COALESCE((SELECT SUM(ri.amount) FROM commerce_refund_items ri JOIN commerce_refunds r ON r.id=ri.refund_id
        WHERE ri.order_item_id=own.order_item_id AND r.id!=(SELECT refund_id FROM commerce_refund_disputes WHERE id=NEW.dispute_id) AND (r.state IN ('requested','approved') OR EXISTS(SELECT 1 FROM commerce_refund_disputes d WHERE d.refund_id=r.id AND d.state IN ('open','awaiting_buyer','awaiting_store')))),0)>i.quantity*i.unit_price_amount)
    OR EXISTS(SELECT 1 FROM commerce_refunds own JOIN orders o ON o.id=own.order_id WHERE own.id=(SELECT refund_id FROM commerce_refund_disputes WHERE id=NEW.dispute_id)
      AND own.shipping_amount+COALESCE((SELECT SUM(r.shipping_amount) FROM commerce_refunds r
        WHERE r.order_id=own.order_id AND r.id!=own.id AND (r.state IN ('requested','approved') OR EXISTS(SELECT 1 FROM commerce_refund_disputes d WHERE d.refund_id=r.id AND d.state IN ('open','awaiting_buyer','awaiting_store')))),0)>o.shipping_amount));
  SELECT RAISE(ABORT,'dispute_rate_limit') WHERE (SELECT COUNT(*) FROM commerce_refund_dispute_actions WHERE actor_auth_user_id=NEW.actor_auth_user_id AND dispute_id=NEW.dispute_id AND created_at>=strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'-1 hour'))>=30;
END;
CREATE TRIGGER refund_dispute_project_action AFTER INSERT ON commerce_refund_dispute_actions BEGIN
  UPDATE commerce_refunds SET revision=revision+1,state=CASE NEW.kind WHEN 'approve' THEN 'approved' ELSE 'declined' END,
    last_action_id=NEW.id,updated_at=NEW.created_at WHERE id=(SELECT refund_id FROM commerce_refund_disputes WHERE id=NEW.dispute_id) AND NEW.kind IN ('approve','decline');
  UPDATE commerce_refund_disputes SET revision=revision+1,last_action_id=NEW.id,updated_at=NEW.created_at,
    state=CASE NEW.kind WHEN 'approve' THEN 'approved' WHEN 'decline' THEN 'declined' WHEN 'withdraw' THEN 'withdrawn'
      WHEN 'reopen' THEN 'open' WHEN 'ask_buyer' THEN 'awaiting_buyer' WHEN 'ask_store' THEN 'awaiting_store'
      ELSE CASE WHEN (state='awaiting_buyer' AND NEW.actor_kind='buyer') OR (state='awaiting_store' AND NEW.actor_kind='merchant') THEN 'open' ELSE state END END
    WHERE id=NEW.dispute_id;
END;
CREATE TRIGGER refund_dispute_update_guard BEFORE UPDATE ON commerce_refund_disputes BEGIN
  SELECT RAISE(ABORT,'dispute_immutable') WHERE NEW.sequence IS NOT OLD.sequence OR NEW.id IS NOT OLD.id OR NEW.refund_id IS NOT OLD.refund_id
    OR NEW.seller_id IS NOT OLD.seller_id OR NEW.order_id IS NOT OLD.order_id OR NEW.commerce_environment IS NOT OLD.commerce_environment
    OR NEW.actor_kind IS NOT OLD.actor_kind OR NEW.actor_auth_user_id IS NOT OLD.actor_auth_user_id OR NEW.request_key IS NOT OLD.request_key OR NEW.request_hash IS NOT OLD.request_hash
    OR NEW.refund_revision IS NOT OLD.refund_revision OR NEW.evidence_version IS NOT OLD.evidence_version OR NEW.message IS NOT OLD.message OR NEW.created_at IS NOT OLD.created_at
    OR NEW.revision!=OLD.revision+1 OR NOT EXISTS(SELECT 1 FROM commerce_refund_dispute_actions a WHERE a.id=NEW.last_action_id AND a.dispute_id=OLD.id AND a.previous_revision=OLD.revision AND a.created_at=NEW.updated_at
      AND NEW.state=CASE a.kind WHEN 'approve' THEN 'approved' WHEN 'decline' THEN 'declined' WHEN 'withdraw' THEN 'withdrawn' WHEN 'reopen' THEN 'open' WHEN 'ask_buyer' THEN 'awaiting_buyer' WHEN 'ask_store' THEN 'awaiting_store'
        ELSE CASE WHEN (OLD.state='awaiting_buyer' AND a.actor_kind='buyer') OR (OLD.state='awaiting_store' AND a.actor_kind='merchant') THEN 'open' ELSE OLD.state END END);
END;
CREATE TRIGGER refund_dispute_delete_guard BEFORE DELETE ON commerce_refund_disputes BEGIN SELECT RAISE(ABORT,'dispute_immutable'); END;
CREATE TRIGGER refund_dispute_action_update BEFORE UPDATE ON commerce_refund_dispute_actions BEGIN SELECT RAISE(ABORT,'dispute_immutable'); END;
CREATE TRIGGER refund_dispute_action_delete BEFORE DELETE ON commerce_refund_dispute_actions BEGIN SELECT RAISE(ABORT,'dispute_immutable'); END;
CREATE TRIGGER refund_action_during_dispute BEFORE INSERT ON commerce_refund_actions BEGIN
  SELECT RAISE(ABORT,'refund_dispute_open') WHERE EXISTS(SELECT 1 FROM commerce_refund_disputes WHERE refund_id=NEW.refund_id AND state IN ('open','awaiting_buyer','awaiting_store'));
END;

DROP TRIGGER commerce_refund_create_guard;
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
          WHERE ri.order_item_id=i.id AND (r.state IN ('requested','approved') OR EXISTS(SELECT 1 FROM commerce_refund_disputes d WHERE d.refund_id=r.id AND d.state IN ('open','awaiting_buyer','awaiting_store')))),0)));
  SELECT RAISE(ABORT,'refund_allocation_exceeded') WHERE NEW.shipping_amount+COALESCE((SELECT SUM(r.shipping_amount)
    FROM commerce_refunds r WHERE r.order_id=NEW.order_id AND (r.state IN ('requested','approved') OR EXISTS(SELECT 1 FROM commerce_refund_disputes d WHERE d.refund_id=r.id AND d.state IN ('open','awaiting_buyer','awaiting_store')))),0)>(SELECT shipping_amount FROM orders WHERE id=NEW.order_id);
  SELECT RAISE(ABORT,'refund_request_limit') WHERE (SELECT COUNT(*) FROM commerce_refunds r
    WHERE r.order_id=NEW.order_id AND r.created_at>=strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'-1 hour'))>=20;
END;

DROP TRIGGER commerce_refund_update_guard;
CREATE TRIGGER commerce_refund_update_guard BEFORE UPDATE ON commerce_refunds BEGIN
  SELECT RAISE(ABORT,'refund_immutable') WHERE NEW.sequence IS NOT OLD.sequence OR NEW.id IS NOT OLD.id OR NEW.seller_id IS NOT OLD.seller_id
    OR NEW.order_id IS NOT OLD.order_id OR NEW.commerce_environment IS NOT OLD.commerce_environment OR NEW.capture_id IS NOT OLD.capture_id
    OR NEW.actor_kind IS NOT OLD.actor_kind OR NEW.actor_auth_user_id IS NOT OLD.actor_auth_user_id OR NEW.request_key IS NOT OLD.request_key
    OR NEW.request_hash IS NOT OLD.request_hash OR NEW.order_revision IS NOT OLD.order_revision OR NEW.data_json IS NOT OLD.data_json
    OR NEW.amount IS NOT OLD.amount OR NEW.shipping_amount IS NOT OLD.shipping_amount OR NEW.created_at IS NOT OLD.created_at

    OR NEW.revision!=OLD.revision+1 OR NOT (
      (OLD.state='requested' AND EXISTS(SELECT 1 FROM commerce_refund_actions a WHERE a.id=NEW.last_action_id AND a.refund_id=OLD.id
        AND a.previous_revision=OLD.revision AND a.created_at=NEW.updated_at AND NEW.state=CASE a.kind WHEN 'approve' THEN 'approved' WHEN 'decline' THEN 'declined' ELSE 'withdrawn' END))
      OR EXISTS(SELECT 1 FROM commerce_refund_dispute_actions a JOIN commerce_refund_disputes d ON d.id=a.dispute_id
        WHERE a.id=NEW.last_action_id AND d.refund_id=OLD.id AND d.state IN ('open','awaiting_buyer','awaiting_store') AND d.revision=a.previous_revision
          AND a.refund_revision=OLD.revision AND a.created_at=NEW.updated_at AND a.actor_kind='support' AND a.kind IN ('approve','decline')
          AND NEW.state=CASE a.kind WHEN 'approve' THEN 'approved' ELSE 'declined' END));
END;

DROP VIEW commerce_earnings_inputs;
CREATE VIEW commerce_earnings_inputs AS
SELECT c.capture_id,c.seller_id,c.order_id,c.commerce_environment,
  o.subtotal_amount-json_extract(o.snapshot_json,'$.fees.commissionAmount')-1250 AS original_seller_amount,
  o.checkout_state,o.fulfillment_state,o.payment_review,o.fulfillment_review,
  d.id AS delivery_id,d.confirmed_at AS delivered_at,
  a.id AS settlement_id,r.state AS settlement_state,r.reason AS settlement_reason,f.current AS history_current,
  pr.id AS recognition_id,rr.state AS recognition_state,COALESCE(rr.fee_amount,0) AS actual_fee,
  (SELECT COUNT(*) FROM commerce_payment_captures x WHERE x.order_id=o.id AND x.capture_kind='duplicate_payment') AS additional_captures,
  (SELECT json_group_array(json(value)) FROM (SELECT CASE WHEN d.id IS NULL THEN json_object('id',x.id,'revision',x.revision,'state',x.state,'amount',CAST(x.amount AS TEXT))
      ELSE json_object('id',x.id,'revision',x.revision,'state',x.state,'amount',CAST(x.amount AS TEXT),'disputeId',d.id,'disputeRevision',d.revision,'disputeState',d.state) END AS value
    FROM commerce_refunds x LEFT JOIN commerce_refund_disputes d ON d.refund_id=x.id AND d.state IN ('open','awaiting_buyer','awaiting_store')
    WHERE x.order_id=o.id AND (x.state IN ('requested','approved') OR d.id IS NOT NULL) ORDER BY x.id)) AS refunds_json,
  (SELECT json_group_array(json(value)) FROM (SELECT json_object('id',x.id,'revision',x.revision,'state',x.state) AS value
    FROM commerce_returns x WHERE x.order_id=o.id AND x.state NOT IN ('declined','withdrawn') ORDER BY x.id)) AS returns_json,
  (SELECT json_group_array(json(value)) FROM (SELECT json_object('id',x.id,'kind',x.kind,'state',x.state) AS value
    FROM commerce_jobs x WHERE x.order_id=o.id AND (x.kind LIKE 'shipment.%' OR x.kind='payment.create')
      AND (x.state IN ('uncertain','dead') OR (x.kind='shipment.cancel' AND x.state IN ('queued','running','retry'))) ORDER BY x.id)) AS jobs_json
FROM commerce_capture_accounting c JOIN orders o ON o.id=c.order_id AND o.seller_id=c.seller_id
JOIN commerce_financial_journals j ON j.capture_id=c.capture_id AND j.kind='capture' AND j.allocation_state='allocated'
LEFT JOIN commerce_order_delivery_receipts d ON d.capture_id=c.capture_id
LEFT JOIN commerce_settlement_assessments a ON a.sequence=(SELECT MAX(x.sequence) FROM commerce_settlement_assessments x WHERE x.capture_id=c.capture_id)
LEFT JOIN commerce_settlement_results r ON r.assessment_sequence=a.sequence
LEFT JOIN commerce_settlement_source_freshness f ON f.assessment_sequence=a.sequence
LEFT JOIN commerce_settlement_assessments pr ON pr.sequence=(SELECT x.sequence FROM commerce_settlement_assessments x
  JOIN commerce_settlement_results y ON y.assessment_sequence=x.sequence AND y.state IN ('settled','voided')
  WHERE x.capture_id=c.capture_id ORDER BY x.sequence DESC LIMIT 1)
LEFT JOIN commerce_settlement_results rr ON rr.assessment_sequence=pr.sequence
WHERE c.allocation_state='allocated' AND c.gross_amount BETWEEN 1 AND 100000000000;

CREATE TRIGGER earnings_after_dispute_open AFTER INSERT ON commerce_refund_disputes BEGIN
  INSERT INTO commerce_earnings_assessments(id,version,seller_id,order_id,capture_id,commerce_environment,previous_id,state,net_amount,available_amount,reserved_amount,source_json,recorded_at)
    SELECT 'earn_'||lower(hex(randomblob(20))),1,seller_id,order_id,capture_id,commerce_environment,assessment_id,state,net_amount,available_amount,reserved_amount,source_json,strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM commerce_earnings_positions WHERE reconciled=0 AND order_id=NEW.order_id;
END;

CREATE TRIGGER earnings_after_dispute_change AFTER UPDATE OF state,revision ON commerce_refund_disputes BEGIN
  INSERT INTO commerce_earnings_assessments(id,version,seller_id,order_id,capture_id,commerce_environment,previous_id,state,net_amount,available_amount,reserved_amount,source_json,recorded_at)
    SELECT 'earn_'||lower(hex(randomblob(20))),1,seller_id,order_id,capture_id,commerce_environment,assessment_id,state,net_amount,available_amount,reserved_amount,source_json,strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM commerce_earnings_positions WHERE reconciled=0 AND order_id=NEW.order_id;
END;

-- Review updates use the existing purchase-bound return/refund notification choices.
DROP TRIGGER commerce_notification_event_guard;
CREATE TRIGGER commerce_notification_event_guard BEFORE INSERT ON commerce_notification_events BEGIN
  SELECT RAISE(ABORT,'notification_source_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_jobs j WHERE j.id=NEW.job_id
    AND j.seller_id=NEW.seller_id AND j.commerce_environment=NEW.commerce_environment AND j.order_id IS NEW.order_id
    AND j.lease_token=NEW.source_lease_token AND j.state='running' AND j.lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND j.created_at=NEW.occurred_at AND (
      (j.kind='notification.order_state' AND NEW.category IN ('payment_confirmed','payment_pending','payment_failed'))
      OR (j.kind='notification.payment_pending' AND NEW.category='payment_pending')
      OR (j.kind IN ('notification.payment_review','notification.stock_recovered') AND NEW.category='payment_review' AND NEW.audience='merchant')
      OR (j.kind='notification.shipment_updated' AND NEW.category='shipping')
      OR (j.kind='notification.return_updated' AND NEW.category='returns' AND json_extract(j.payload_json,'$.returnId')=NEW.return_id
        AND EXISTS(SELECT 1 FROM commerce_returns r WHERE r.id=NEW.return_id AND r.order_id=NEW.order_id AND r.seller_id=NEW.seller_id))
      OR (j.kind='notification.refund_updated' AND NEW.category='returns' AND NEW.audience='both'
        AND NEW.return_id IS NULL AND json_extract(j.payload_json,'$.refundId')=NEW.refund_id
        AND json_extract(NEW.data_json,'$.refundId')=NEW.refund_id
        AND json_extract(NEW.data_json,'$.state')=json_extract(j.payload_json,'$.state')
        AND EXISTS(SELECT 1 FROM commerce_refunds r WHERE r.id=NEW.refund_id AND r.seller_id=NEW.seller_id
          AND r.order_id=NEW.order_id AND r.commerce_environment=NEW.commerce_environment AND (
            (json_extract(j.payload_json,'$.state')='requested' AND json_type(j.payload_json,'$.actionId') IS NULL
              AND r.created_at=j.created_at AND j.job_key='refund_request:'||r.id)
            OR EXISTS(SELECT 1 FROM commerce_refund_actions a WHERE a.id=json_extract(j.payload_json,'$.actionId')
              AND a.refund_id=r.id AND a.created_at=j.created_at AND j.job_key='refund_action:'||a.id
              AND json_extract(j.payload_json,'$.state')=CASE a.kind WHEN 'approve' THEN 'approved' WHEN 'decline' THEN 'declined' ELSE 'withdrawn' END))))
      OR (j.kind='notification.dispute_updated' AND NEW.category='returns' AND NEW.audience='both' AND NEW.return_id IS NULL
        AND json_extract(j.payload_json,'$.refundId')=NEW.refund_id AND json_extract(NEW.data_json,'$.refundId')=NEW.refund_id
        AND json_extract(NEW.data_json,'$.disputeId')=json_extract(j.payload_json,'$.disputeId')
        AND json_extract(NEW.data_json,'$.reviewKind')=json_extract(j.payload_json,'$.reviewKind')
        AND EXISTS(SELECT 1 FROM commerce_refund_disputes d WHERE d.id=json_extract(j.payload_json,'$.disputeId')
          AND d.refund_id=NEW.refund_id AND d.seller_id=NEW.seller_id AND d.order_id=NEW.order_id AND d.commerce_environment=NEW.commerce_environment AND (
            (json_extract(j.payload_json,'$.reviewKind')='open' AND json_type(j.payload_json,'$.actionId') IS NULL
              AND d.created_at=j.created_at AND j.job_key='dispute_open:'||d.id)
            OR EXISTS(SELECT 1 FROM commerce_refund_dispute_actions a WHERE a.id=json_extract(j.payload_json,'$.actionId')
              AND a.dispute_id=d.id AND a.created_at=j.created_at AND j.job_key='dispute_action:'||a.id
              AND a.kind=json_extract(j.payload_json,'$.reviewKind')))))
      OR (j.kind='notification.weekly_activity' AND NEW.category='weekly_activity')
      OR (j.kind='notification.message_received' AND NEW.category='messages' AND EXISTS(SELECT 1 FROM commerce_message_events m JOIN commerce_conversations c ON c.id=m.conversation_id
        WHERE m.id=json_extract(j.payload_json,'$.eventId') AND m.kind='message' AND c.id=NEW.conversation_id AND c.seller_id=NEW.seller_id
          AND c.commerce_environment=NEW.commerce_environment AND NEW.audience=(CASE m.actor_kind WHEN 'buyer' THEN 'merchant' ELSE 'buyer' END)))
    ));
  SELECT RAISE(ABORT,'notification_immutable') WHERE EXISTS(SELECT 1 FROM commerce_notification_events WHERE id=NEW.id OR job_id=NEW.job_id);
END;
DROP TRIGGER commerce_notification_job_complete;
CREATE TRIGGER commerce_notification_job_complete BEFORE UPDATE OF state ON commerce_jobs
WHEN NEW.state='succeeded' AND NEW.kind IN ('notification.order_state','notification.payment_pending','notification.payment_review','notification.stock_recovered','notification.shipment_updated','notification.return_updated','notification.refund_updated','notification.dispute_updated','notification.message_received','notification.weekly_activity') BEGIN
  SELECT RAISE(ABORT,'notification_receipt_required') WHERE NOT EXISTS(SELECT 1 FROM commerce_notification_events e WHERE e.job_id=NEW.id AND e.seller_id=NEW.seller_id AND e.commerce_environment=NEW.commerce_environment);
END;
CREATE TRIGGER dispute_open_notification AFTER INSERT ON commerce_refund_disputes BEGIN
  INSERT INTO commerce_jobs(id,seller_id,order_id,commerce_environment,job_key,kind,payload_json,available_at,created_at,updated_at)
    VALUES('job_'||lower(hex(randomblob(16))),NEW.seller_id,NEW.order_id,NEW.commerce_environment,'dispute_open:'||NEW.id,'notification.dispute_updated',
      json_object('orderId',NEW.order_id,'refundId',NEW.refund_id,'disputeId',NEW.id,'reviewKind','open'),NEW.created_at,NEW.created_at,NEW.created_at);
END;
CREATE TRIGGER dispute_action_notification AFTER INSERT ON commerce_refund_dispute_actions BEGIN
  INSERT INTO commerce_jobs(id,seller_id,order_id,commerce_environment,job_key,kind,payload_json,available_at,created_at,updated_at)
    SELECT 'job_'||lower(hex(randomblob(16))),d.seller_id,d.order_id,d.commerce_environment,'dispute_action:'||NEW.id,'notification.dispute_updated',
      json_object('orderId',d.order_id,'refundId',d.refund_id,'disputeId',d.id,'actionId',NEW.id,'reviewKind',NEW.kind),NEW.created_at,NEW.created_at,NEW.created_at
      FROM commerce_refund_disputes d WHERE d.id=NEW.dispute_id;
END;
