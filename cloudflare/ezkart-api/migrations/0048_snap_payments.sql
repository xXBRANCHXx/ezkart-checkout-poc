-- SNAP requests have a durable, immutable dispatch fence before any provider
-- write. Original provider receipts and capture/account changes commit together.
CREATE TABLE commerce_snap_payment_bindings (
  order_id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  job_id TEXT NOT NULL UNIQUE REFERENCES commerce_jobs(id) ON DELETE RESTRICT,
  attempt_id TEXT NOT NULL UNIQUE REFERENCES commerce_job_attempts(id) ON DELETE RESTRICT,
  credential_fingerprint TEXT NOT NULL CHECK(length(credential_fingerprint)=64 AND credential_fingerprint NOT GLOB '*[^a-f0-9]*'),
  client_id TEXT NOT NULL,
  external_id TEXT NOT NULL CHECK(length(external_id)=32 AND external_id NOT GLOB '*[^0-9]*'),
  binding_json TEXT NOT NULL CHECK(json_valid(binding_json)),
  created_at TEXT NOT NULL,
  UNIQUE(commerce_environment,client_id,external_id),
  FOREIGN KEY(seller_id,order_id) REFERENCES orders(seller_id,id) ON DELETE RESTRICT
);
CREATE TRIGGER commerce_snap_binding_guard BEFORE INSERT ON commerce_snap_payment_bindings
BEGIN
  SELECT RAISE(ABORT,'commerce_snap_dispatch_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM orders o JOIN commerce_jobs j ON j.id=NEW.job_id
      JOIN commerce_job_attempts a ON a.id=NEW.attempt_id AND a.job_id=j.id AND a.attempt=j.attempts
    WHERE o.id=NEW.order_id AND o.seller_id=NEW.seller_id AND o.commerce_environment=NEW.commerce_environment
      AND o.commerce_version=1 AND json_extract(o.snapshot_json,'$.checkout.paymentFlow')='snap_bca'
      AND o.checkout_state='creating' AND o.expires_at>NEW.created_at AND o.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND j.order_id=o.id AND j.seller_id=o.seller_id AND j.commerce_environment=o.commerce_environment
      AND j.kind='payment.create' AND j.state='running' AND j.lease_mode='execute' AND j.lease_until>NEW.created_at
      AND j.lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND a.lease_token=j.lease_token AND a.worker_id=j.lease_owner AND a.finished_at IS NULL
      AND json_extract(j.payload_json,'$.providerRequestId')=NEW.external_id
      AND json_extract(NEW.binding_json,'$.environment')=o.commerce_environment
      AND json_extract(NEW.binding_json,'$.credentialFingerprint')=NEW.credential_fingerprint
      AND json_extract(NEW.binding_json,'$.externalId')=NEW.external_id
      AND json_extract(NEW.binding_json,'$.orderId')=o.id
      AND json_type(NEW.binding_json,'$.amount')='integer' AND json_extract(NEW.binding_json,'$.amount')=o.total_amount
      AND json_extract(NEW.binding_json,'$.name')=json_extract(o.customer_snapshot_json,'$.name')
      AND json_extract(NEW.binding_json,'$.email')=json_extract(o.customer_snapshot_json,'$.email')
      AND julianday(json_extract(NEW.binding_json,'$.expiresAt'))=julianday(o.expires_at)
  );
END;
CREATE TRIGGER commerce_snap_bindings_no_update BEFORE UPDATE ON commerce_snap_payment_bindings BEGIN SELECT RAISE(ABORT,'commerce_immutable_snap'); END;
CREATE TRIGGER commerce_snap_bindings_no_delete BEFORE DELETE ON commerce_snap_payment_bindings BEGIN SELECT RAISE(ABORT,'commerce_immutable_snap'); END;

CREATE TABLE commerce_snap_payment_receipts (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES commerce_snap_payment_bindings(order_id) ON DELETE RESTRICT,
  credential_fingerprint TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('bca-create','bca-notification','bca-status')),
  external_id TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  body_json TEXT NOT NULL CHECK(json_valid(body_json) AND length(CAST(body_json AS BLOB))<=262144),
  request_json TEXT CHECK(request_json IS NULL OR (json_valid(request_json) AND length(CAST(request_json AS BLOB))<=8000)),
  account_number TEXT NOT NULL CHECK(length(account_number)=16 AND account_number NOT GLOB '*[^0-9]*'),
  payment_reference TEXT,
  received_at TEXT NOT NULL,
  CHECK((operation='bca-notification' AND request_json IS NULL AND payment_reference IS NOT NULL)
    OR (operation!='bca-notification' AND request_json IS NOT NULL AND payment_reference IS NULL))
);
CREATE UNIQUE INDEX idx_snap_create_receipt ON commerce_snap_payment_receipts(order_id) WHERE operation='bca-create';
CREATE INDEX idx_snap_receipts_order ON commerce_snap_payment_receipts(order_id,received_at,id);
CREATE INDEX idx_snap_receipts_capture ON commerce_snap_payment_receipts(order_id,payment_reference) WHERE payment_reference IS NOT NULL;
CREATE TRIGGER commerce_snap_receipt_guard BEFORE INSERT ON commerce_snap_payment_receipts
BEGIN
  SELECT RAISE(ABORT,'commerce_snap_receipt_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_snap_payment_bindings b WHERE b.order_id=NEW.order_id AND b.credential_fingerprint=NEW.credential_fingerprint
      AND (NEW.operation!='bca-create' OR NEW.external_id=b.external_id)
      AND substr(NEW.account_number,1,length(ltrim(json_extract(b.binding_json,'$.partnerServiceId'))||json_extract(b.binding_json,'$.customerPrefix')))
        =ltrim(json_extract(b.binding_json,'$.partnerServiceId'))||json_extract(b.binding_json,'$.customerPrefix')
  ) OR EXISTS(SELECT 1 FROM commerce_payment_accounts a WHERE a.order_id=NEW.order_id AND a.account_number!=NEW.account_number)
    OR EXISTS(SELECT 1 FROM commerce_snap_payment_receipts r WHERE r.order_id=NEW.order_id AND r.account_number!=NEW.account_number);
END;
CREATE TRIGGER commerce_snap_receipts_no_update BEFORE UPDATE ON commerce_snap_payment_receipts BEGIN SELECT RAISE(ABORT,'commerce_immutable_snap'); END;
CREATE TRIGGER commerce_snap_receipts_no_delete BEFORE DELETE ON commerce_snap_payment_receipts BEGIN SELECT RAISE(ABORT,'commerce_immutable_snap'); END;

DROP TRIGGER commerce_payment_account_guard;
CREATE TRIGGER commerce_payment_account_guard BEFORE INSERT ON commerce_payment_accounts
BEGIN
  SELECT RAISE(ABORT,'commerce_payment_binding_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM orders o JOIN commerce_jobs j ON j.order_id=o.id AND j.seller_id=o.seller_id
    WHERE o.id=NEW.order_id AND o.seller_id=NEW.seller_id AND o.commerce_version=1
      AND j.kind='payment.create' AND json_extract(j.payload_json,'$.providerRequestId')=NEW.provider_request_id
      AND ((json_extract(o.snapshot_json,'$.checkout.paymentFlow')='direct_bca' AND o.commerce_environment='sandbox')
        OR (json_extract(o.snapshot_json,'$.checkout.paymentFlow')='snap_bca' AND EXISTS (
          SELECT 1 FROM commerce_snap_payment_receipts r WHERE r.order_id=o.id AND r.account_number=NEW.account_number
            AND r.operation IN ('bca-create','bca-notification'))))
  ) OR EXISTS (SELECT 1 FROM commerce_payment_accounts a WHERE a.order_id=NEW.order_id
      AND (a.account_number!=NEW.account_number OR a.provider_request_id!=NEW.provider_request_id));
END;
CREATE TRIGGER commerce_snap_capture_guard BEFORE INSERT ON commerce_payment_captures
WHEN EXISTS(SELECT 1 FROM orders o WHERE o.id=NEW.order_id AND json_extract(o.snapshot_json,'$.checkout.paymentFlow')='snap_bca')
BEGIN
  SELECT RAISE(ABORT,'commerce_snap_capture_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_snap_payment_receipts r JOIN commerce_payment_accounts a ON a.order_id=r.order_id AND a.account_number=r.account_number
    WHERE r.order_id=NEW.order_id AND r.operation='bca-notification' AND r.payment_reference=NEW.provider_reference
      AND json_extract(r.body_json,'$.paidAmount.currency')=NEW.currency
      AND json_extract(r.body_json,'$.paidAmount.value')=CAST(NEW.amount AS TEXT)||'.00'
  );
END;
CREATE TRIGGER commerce_snap_job_retry_guard BEFORE UPDATE OF state ON commerce_jobs
WHEN NEW.state='retry' AND EXISTS(SELECT 1 FROM commerce_snap_payment_bindings b WHERE b.job_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'commerce_snap_reconcile_required'); END;
