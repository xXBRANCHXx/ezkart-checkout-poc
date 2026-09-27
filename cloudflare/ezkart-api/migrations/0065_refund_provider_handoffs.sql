-- Non-card DOKU refunds use an original settled payment and a support request.
-- These records prepare/track that request. They never prove that money returned.
CREATE TABLE commerce_refund_bank_details (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  refund_id TEXT NOT NULL REFERENCES commerce_refunds(id) ON DELETE RESTRICT,
  actor_auth_user_id TEXT NOT NULL,
  previous_id TEXT REFERENCES commerce_refund_bank_details(id) ON DELETE RESTRICT,
  request_hash TEXT NOT NULL UNIQUE,
  bank_name TEXT NOT NULL CHECK(length(bank_name) BETWEEN 2 AND 100),
  account_name TEXT NOT NULL CHECK(length(account_name) BETWEEN 2 AND 100),
  account_number TEXT NOT NULL CHECK(length(account_number) BETWEEN 5 AND 34 AND account_number NOT GLOB '*[^0-9]*'),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_refund_bank_latest ON commerce_refund_bank_details(refund_id,sequence DESC);
CREATE VIEW commerce_refund_current_bank AS SELECT b.* FROM commerce_refund_bank_details b
  WHERE b.sequence=(SELECT MAX(x.sequence) FROM commerce_refund_bank_details x WHERE x.refund_id=b.refund_id);

CREATE TABLE commerce_refund_provider_requests (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  refund_id TEXT NOT NULL UNIQUE REFERENCES commerce_refunds(id) ON DELETE RESTRICT,
  bank_id TEXT NOT NULL REFERENCES commerce_refund_bank_details(id) ON DELETE RESTRICT,
  settlement_id TEXT NOT NULL REFERENCES commerce_settlement_assessments(id) ON DELETE RESTRICT,
  actor_auth_user_id TEXT NOT NULL,
  proof_expires_at INTEGER NOT NULL,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  refund_revision INTEGER NOT NULL,
  order_revision INTEGER NOT NULL,
  evidence_version INTEGER NOT NULL CHECK(evidence_version BETWEEN 0 AND 40),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  created_at TEXT NOT NULL,
  UNIQUE(actor_auth_user_id,request_key)
);
CREATE TABLE commerce_refund_provider_submissions (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  provider_request_id TEXT NOT NULL UNIQUE REFERENCES commerce_refund_provider_requests(id) ON DELETE RESTRICT,
  actor_auth_user_id TEXT NOT NULL,
  proof_expires_at INTEGER NOT NULL,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('support_ticket','email')),
  reference TEXT NOT NULL CHECK(length(reference) BETWEEN 3 AND 200),
  submitted_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE(actor_auth_user_id,request_key)
);

-- Snapshot fields come from the original verified SNAP receipt, capture and
-- current conserved settlement. No caller supplies a brand, invoice or amount.
CREATE VIEW commerce_refund_handoff_sources AS
SELECT r.id AS refund_id,b.id AS bank_id,a.id AS settlement_id,r.revision AS refund_revision,o.revision AS order_revision,
  (SELECT COALESCE(SUM(1+(state='ready')),0) FROM commerce_refund_attachments WHERE refund_id=r.id) AS evidence_version,
  json_object('version',1,'provider','doku','method','bca_virtual_account','environment',r.commerce_environment,
    'brandId',sn.client_id,'invoiceNumber',o.id,'transactionDate',json_extract(p.body_json,'$.trxDateTime'),
    'transactionAmount',c.amount,'currency','IDR','refundAmount',r.amount,'shippingRefundAmount',r.shipping_amount,
    'captureId',c.id,'paymentReference',c.provider_reference,'credentialFingerprint',sn.credential_fingerprint,
    'settlementId',a.id,'settlementReference',sr.provider_reference,'bankId',b.id,
    'items',json((SELECT json_group_array(json_object('orderItemId',i.order_item_id,'amount',i.amount))
      FROM (SELECT order_item_id,amount FROM commerce_refund_items WHERE refund_id=r.id ORDER BY order_item_id) i))) AS snapshot_json
FROM commerce_refunds r JOIN orders o ON o.id=r.order_id AND o.seller_id=r.seller_id AND o.commerce_environment=r.commerce_environment
JOIN commerce_refund_current_bank b ON b.refund_id=r.id
JOIN commerce_payment_captures c ON c.id=r.capture_id AND c.order_id=o.id AND c.provider='doku'
  AND c.capture_kind='order_payment' AND c.amount=o.total_amount AND c.currency='IDR'
JOIN commerce_snap_payment_bindings sn ON sn.order_id=o.id
JOIN commerce_snap_payment_receipts p ON p.id=(SELECT x.id FROM commerce_snap_payment_receipts x
  WHERE x.order_id=o.id AND x.operation='bca-notification' AND x.payment_reference=c.provider_reference ORDER BY x.received_at,x.id LIMIT 1)
JOIN commerce_settlement_assessments a ON a.sequence=(SELECT MAX(x.sequence) FROM commerce_settlement_assessments x WHERE x.capture_id=c.id)
JOIN commerce_settlement_results sr ON sr.assessment_sequence=a.sequence AND sr.state='settled'
JOIN commerce_settlement_source_freshness sf ON sf.assessment_sequence=a.sequence AND sf.current=1
WHERE r.state='approved' AND o.checkout_state='paid' AND o.payment_review=0
  AND json_extract(o.snapshot_json,'$.checkout.paymentFlow')='snap_bca'
  AND json_extract(p.body_json,'$.trxId')=o.id AND julianday(json_extract(p.body_json,'$.trxDateTime')) IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM commerce_payment_captures x WHERE x.order_id=o.id AND x.capture_kind='duplicate_payment')
  AND NOT EXISTS(SELECT 1 FROM commerce_refund_disputes d WHERE d.refund_id=r.id AND d.state IN ('open','awaiting_buyer','awaiting_store'));

CREATE TRIGGER refund_bank_insert BEFORE INSERT ON commerce_refund_bank_details BEGIN
  SELECT RAISE(ABORT,'refund_bank_immutable') WHERE EXISTS(SELECT 1 FROM commerce_refund_bank_details WHERE sequence=NEW.sequence OR id=NEW.id OR request_hash=NEW.request_hash);
  SELECT RAISE(ABORT,'refund_bank_actor_forbidden') WHERE NOT EXISTS(SELECT 1 FROM commerce_refunds r JOIN orders o ON o.id=r.order_id
    LEFT JOIN commerce_order_owners a ON a.order_id=o.id WHERE r.id=NEW.refund_id
      AND COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=NEW.actor_auth_user_id);
  SELECT RAISE(ABORT,'refund_bank_changed') WHERE NEW.previous_id IS NOT (SELECT id FROM commerce_refund_current_bank WHERE refund_id=NEW.refund_id)
    OR NOT EXISTS(SELECT 1 FROM commerce_refunds WHERE id=NEW.refund_id AND state='approved')
    OR EXISTS(SELECT 1 FROM commerce_refund_provider_requests WHERE refund_id=NEW.refund_id)
    OR EXISTS(SELECT 1 FROM commerce_refund_disputes WHERE refund_id=NEW.refund_id AND state IN ('open','awaiting_buyer','awaiting_store'));
  SELECT RAISE(ABORT,'refund_bank_rate_limit') WHERE (SELECT COUNT(*) FROM commerce_refund_bank_details WHERE actor_auth_user_id=NEW.actor_auth_user_id
    AND created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour'))>=10;
END;
CREATE TRIGGER refund_bank_update BEFORE UPDATE ON commerce_refund_bank_details BEGIN SELECT RAISE(ABORT,'refund_bank_immutable'); END;
CREATE TRIGGER refund_bank_delete BEFORE DELETE ON commerce_refund_bank_details BEGIN SELECT RAISE(ABORT,'refund_bank_immutable'); END;

CREATE TRIGGER refund_provider_request_insert BEFORE INSERT ON commerce_refund_provider_requests BEGIN
  SELECT RAISE(ABORT,'refund_handoff_immutable') WHERE EXISTS(SELECT 1 FROM commerce_refund_provider_requests WHERE sequence=NEW.sequence OR id=NEW.id OR refund_id=NEW.refund_id
    OR (actor_auth_user_id=NEW.actor_auth_user_id AND request_key=NEW.request_key));
  SELECT RAISE(ABORT,'refund_handoff_actor_forbidden') WHERE NOT EXISTS(SELECT 1 FROM commerce_refunds r JOIN commerce_support_staff p
    ON p.commerce_environment=r.commerce_environment WHERE r.id=NEW.refund_id AND p.auth_user_id=NEW.actor_auth_user_id AND p.role='reviewer');
  SELECT RAISE(ABORT,'refund_handoff_proof_expired') WHERE NEW.proof_expires_at<=unixepoch('now') OR NEW.proof_expires_at>unixepoch('now')+630;
  SELECT RAISE(ABORT,'refund_handoff_source_changed') WHERE NOT EXISTS(SELECT 1 FROM commerce_refund_handoff_sources s WHERE s.refund_id=NEW.refund_id
    AND s.bank_id=NEW.bank_id AND s.settlement_id=NEW.settlement_id AND s.refund_revision=NEW.refund_revision AND s.order_revision=NEW.order_revision
    AND s.evidence_version=NEW.evidence_version AND s.snapshot_json=NEW.snapshot_json);
END;
CREATE TRIGGER refund_provider_request_update BEFORE UPDATE ON commerce_refund_provider_requests BEGIN SELECT RAISE(ABORT,'refund_handoff_immutable'); END;
CREATE TRIGGER refund_provider_request_delete BEFORE DELETE ON commerce_refund_provider_requests BEGIN SELECT RAISE(ABORT,'refund_handoff_immutable'); END;

CREATE TRIGGER refund_provider_submission_insert BEFORE INSERT ON commerce_refund_provider_submissions BEGIN
  SELECT RAISE(ABORT,'refund_handoff_immutable') WHERE EXISTS(SELECT 1 FROM commerce_refund_provider_submissions WHERE sequence=NEW.sequence OR id=NEW.id OR provider_request_id=NEW.provider_request_id
    OR (actor_auth_user_id=NEW.actor_auth_user_id AND request_key=NEW.request_key));
  SELECT RAISE(ABORT,'refund_handoff_actor_forbidden') WHERE NOT EXISTS(SELECT 1 FROM commerce_refund_provider_requests q JOIN commerce_refunds r ON r.id=q.refund_id
    JOIN commerce_support_staff p ON p.commerce_environment=r.commerce_environment WHERE q.id=NEW.provider_request_id AND p.auth_user_id=NEW.actor_auth_user_id AND p.role='reviewer');
  SELECT RAISE(ABORT,'refund_handoff_proof_expired') WHERE NEW.proof_expires_at<=unixepoch('now') OR NEW.proof_expires_at>unixepoch('now')+630;
  SELECT RAISE(ABORT,'refund_handoff_date_invalid') WHERE julianday(NEW.submitted_at) IS NULL OR NEW.submitted_at>(strftime('%Y-%m-%dT%H:%M:%fZ','now','+30 seconds'))
    OR NEW.submitted_at<(SELECT strftime('%Y-%m-%dT%H:%M:%S.000Z',created_at) FROM commerce_refund_provider_requests WHERE id=NEW.provider_request_id);
END;
CREATE TRIGGER refund_provider_submission_update BEFORE UPDATE ON commerce_refund_provider_submissions BEGIN SELECT RAISE(ABORT,'refund_handoff_immutable'); END;
CREATE TRIGGER refund_provider_submission_delete BEFORE DELETE ON commerce_refund_provider_submissions BEGIN SELECT RAISE(ABORT,'refund_handoff_immutable'); END;

-- Once a provider packet exists, a later review cannot free its allocated money
-- by changing the approval. Discussion/reopening remain available for recovery.
CREATE TRIGGER refund_handoff_preserve_approval BEFORE UPDATE OF state,revision ON commerce_refunds
WHEN EXISTS(SELECT 1 FROM commerce_refund_provider_requests WHERE refund_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'refund_handoff_review_required'); END;
