-- Original routed Checkout sessions; existing SNAP/legacy evidence remains intact.
DROP TRIGGER payment_route_binding_source;
CREATE TRIGGER payment_route_binding_source BEFORE INSERT ON commerce_payment_route_bindings BEGIN
  SELECT RAISE(ABORT,'payment_route_source_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM orders o JOIN commerce_jobs j ON j.id=NEW.job_id
    JOIN commerce_job_attempts a ON a.id=NEW.attempt_id AND a.job_id=j.id AND a.attempt=j.attempts
    WHERE o.id=NEW.order_id AND o.seller_id=NEW.seller_id AND o.commerce_environment=NEW.commerce_environment
      AND o.commerce_version=1 AND json_extract(o.snapshot_json,'$.checkout.paymentFlow') IN ('snap_bca','routed_hosted')
      AND o.checkout_state='creating' AND o.expires_at>NEW.created_at AND o.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND j.order_id=o.id AND j.seller_id=o.seller_id AND j.commerce_environment=o.commerce_environment
      AND j.kind='payment.create' AND j.state='running' AND j.lease_mode='execute'
      AND j.lease_until>NEW.created_at AND j.lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND a.lease_token=j.lease_token AND a.worker_id=j.lease_owner AND a.finished_at IS NULL
      AND NEW.external_id!=json_extract(j.payload_json,'$.providerRequestId')
  );
  SELECT RAISE(ABORT,'payment_route_source_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_wallet_enrollments se
    JOIN commerce_wallet_provider_profiles sp ON sp.enrollment_id=se.id
    JOIN commerce_wallet_provider_bindings sb ON sb.enrollment_id=se.id
    JOIN commerce_wallet_enrollments pe ON pe.id=NEW.platform_enrollment_id AND pe.commerce_environment=se.commerce_environment
    JOIN commerce_wallet_provider_profiles pp ON pp.enrollment_id=pe.id
    JOIN commerce_wallet_provider_bindings pb ON pb.enrollment_id=pe.id
    JOIN sellers ss ON ss.id=se.seller_id AND ss.status='active'
    JOIN sellers ps ON ps.id=pe.seller_id AND ps.status='active'
    WHERE se.id=NEW.seller_enrollment_id AND se.seller_id=NEW.seller_id AND se.commerce_environment=NEW.commerce_environment
      AND sb.credential_fingerprint=NEW.credential_fingerprint AND sb.client_id=NEW.client_id
      AND pb.credential_fingerprint=sb.credential_fingerprint AND pb.client_id=sb.client_id AND pb.parent_profile_id=sb.parent_profile_id
      AND se.id!=pe.id AND sp.cash_account!=pp.cash_account
      AND json_extract(NEW.binding_json,'$.sellerProfileId')=sp.profile_id
      AND json_extract(NEW.binding_json,'$.platformCashAccount')=pp.cash_account
  );
  SELECT RAISE(ABORT,'payment_route_source_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM orders o WHERE o.id=NEW.order_id
      AND json_extract(NEW.binding_json,'$.environment')=o.commerce_environment
      AND json_extract(NEW.binding_json,'$.credentialFingerprint')=NEW.credential_fingerprint
      AND json_extract(NEW.binding_json,'$.externalId')=NEW.external_id
      AND json_extract(NEW.binding_json,'$.orderId')=o.id
      AND json_type(NEW.binding_json,'$.grossAmount')='integer' AND json_extract(NEW.binding_json,'$.grossAmount')=o.total_amount
      AND json_type(NEW.binding_json,'$.platformAmount')='integer'
      AND json_extract(NEW.binding_json,'$.platformAmount')=o.shipping_amount+json_extract(o.snapshot_json,'$.fees.commissionAmount')+1250
      AND json_extract(o.snapshot_json,'$.fees.version')=1
      AND json_extract(o.snapshot_json,'$.fees.plan') IN ('standard','advanced')
      AND json_extract(o.snapshot_json,'$.fees.commissionBasisPoints')=CASE json_extract(o.snapshot_json,'$.fees.plan') WHEN 'advanced' THEN 600 ELSE 500 END
      AND json_type(o.snapshot_json,'$.fees.commissionAmount')='integer'
      AND json_extract(o.snapshot_json,'$.fees.commissionAmount')=(o.subtotal_amount*json_extract(o.snapshot_json,'$.fees.commissionBasisPoints')+5000)/10000
      AND json_extract(o.snapshot_json,'$.fees.adminAmount')=1250
      AND json_extract(o.snapshot_json,'$.fees.processingFeePolicy')='actual_provider_fee'
      AND json_extract(o.snapshot_json,'$.fees.withdrawalMinimum')=250000
      AND json_extract(o.snapshot_json,'$.fees.sellerWithdrawalFee')=0
  );
  SELECT RAISE(ABORT,'payment_route_immutable') WHERE EXISTS(SELECT 1 FROM commerce_payment_route_bindings WHERE order_id=NEW.order_id OR job_id=NEW.job_id OR attempt_id=NEW.attempt_id);
END;


CREATE TABLE commerce_hosted_payment_bindings (
 order_id TEXT PRIMARY KEY, seller_id TEXT NOT NULL,
 commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
 job_id TEXT NOT NULL UNIQUE REFERENCES commerce_jobs(id) ON DELETE RESTRICT,
 attempt_id TEXT NOT NULL UNIQUE REFERENCES commerce_job_attempts(id) ON DELETE RESTRICT,
 credential_fingerprint TEXT NOT NULL CHECK(length(credential_fingerprint)=64),client_id TEXT NOT NULL,
 external_id TEXT NOT NULL,binding_json TEXT NOT NULL CHECK(json_valid(binding_json)),created_at TEXT NOT NULL,
 UNIQUE(commerce_environment,client_id,external_id),
 FOREIGN KEY(seller_id,order_id) REFERENCES orders(seller_id,id) ON DELETE RESTRICT
);
CREATE TRIGGER commerce_hosted_binding_source BEFORE INSERT ON commerce_hosted_payment_bindings BEGIN
 SELECT RAISE(ABORT,'commerce_hosted_dispatch_mismatch') WHERE NOT EXISTS(
  SELECT 1 FROM orders o JOIN commerce_jobs j ON j.id=NEW.job_id
  JOIN commerce_job_attempts a ON a.id=NEW.attempt_id AND a.job_id=j.id AND a.attempt=j.attempts
  JOIN commerce_payment_route_bindings b ON b.order_id=o.id JOIN commerce_payment_route_receipts r ON r.order_id=b.order_id
  WHERE o.id=NEW.order_id AND o.seller_id=NEW.seller_id AND o.commerce_environment=NEW.commerce_environment
   AND o.commerce_version=1 AND json_extract(o.snapshot_json,'$.checkout.paymentFlow')='routed_hosted'
   AND o.checkout_state='creating' AND o.expires_at>NEW.created_at AND o.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
   AND j.order_id=o.id AND j.seller_id=o.seller_id AND j.commerce_environment=o.commerce_environment
   AND j.kind='payment.create' AND j.state='running' AND j.lease_mode='execute'
   AND j.lease_until>NEW.created_at AND j.lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now')
   AND a.lease_token=j.lease_token AND a.worker_id=j.lease_owner AND a.finished_at IS NULL
   AND json_extract(j.payload_json,'$.providerRequestId')=NEW.external_id
   AND b.job_id=j.id AND b.credential_fingerprint=NEW.credential_fingerprint AND b.client_id=NEW.client_id
   AND json_extract(NEW.binding_json,'$.routing.profileId')=json_extract(b.binding_json,'$.sellerProfileId')
   AND json_extract(NEW.binding_json,'$.routing.splitRuleId')=r.split_rule_id
   AND json_extract(NEW.binding_json,'$.orderId')=o.id AND json_extract(NEW.binding_json,'$.externalId')=NEW.external_id
   AND json_extract(NEW.binding_json,'$.environment')=o.commerce_environment
   AND json_extract(NEW.binding_json,'$.credentialFingerprint')=NEW.credential_fingerprint
   AND json_type(NEW.binding_json,'$.amount')='integer' AND json_extract(NEW.binding_json,'$.amount')=o.total_amount
   AND json_extract(NEW.binding_json,'$.name')=json_extract(o.customer_snapshot_json,'$.name')
   AND json_extract(NEW.binding_json,'$.email')=json_extract(o.customer_snapshot_json,'$.email')
   AND julianday(json_extract(NEW.binding_json,'$.expiresAt'))=julianday(o.expires_at)
 );
 SELECT RAISE(ABORT,'commerce_hosted_immutable') WHERE EXISTS(SELECT 1 FROM commerce_hosted_payment_bindings WHERE order_id=NEW.order_id OR job_id=NEW.job_id);
END;
CREATE TABLE commerce_hosted_payment_receipts (
 id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES commerce_hosted_payment_bindings(order_id) ON DELETE RESTRICT,
 credential_fingerprint TEXT NOT NULL,operation TEXT NOT NULL CHECK(operation IN ('checkout-create','checkout-notification')),
 external_id TEXT NOT NULL,sent_at TEXT NOT NULL,observed_at TEXT NOT NULL,body_hash TEXT NOT NULL,
 body_json TEXT NOT NULL CHECK(json_valid(body_json) AND length(CAST(body_json AS BLOB))<=262144),
 request_json TEXT CHECK(request_json IS NULL OR (json_valid(request_json) AND length(CAST(request_json AS BLOB))<=16000)),
 payment_reference TEXT,received_at TEXT NOT NULL,
 CHECK((operation='checkout-create' AND request_json IS NOT NULL AND payment_reference IS NULL)
  OR(operation='checkout-notification' AND request_json IS NULL))
);
CREATE UNIQUE INDEX idx_hosted_create_receipt ON commerce_hosted_payment_receipts(order_id) WHERE operation='checkout-create';
CREATE INDEX idx_hosted_receipts_order ON commerce_hosted_payment_receipts(order_id,received_at,id);
CREATE TRIGGER commerce_hosted_receipt_source BEFORE INSERT ON commerce_hosted_payment_receipts BEGIN
 SELECT RAISE(ABORT,'commerce_hosted_receipt_mismatch') WHERE NOT EXISTS(
  SELECT 1 FROM commerce_hosted_payment_bindings b WHERE b.order_id=NEW.order_id AND b.credential_fingerprint=NEW.credential_fingerprint
  AND(NEW.operation!='checkout-create' OR NEW.external_id=b.external_id)
 );
END;
CREATE TRIGGER commerce_hosted_capture_guard BEFORE INSERT ON commerce_payment_captures
WHEN EXISTS(SELECT 1 FROM orders o WHERE o.id=NEW.order_id AND json_extract(o.snapshot_json,'$.checkout.paymentFlow')='routed_hosted') BEGIN
 SELECT RAISE(ABORT,'commerce_hosted_capture_mismatch') WHERE NOT EXISTS(
  SELECT 1 FROM commerce_hosted_payment_receipts r WHERE r.order_id=NEW.order_id AND r.operation='checkout-notification'
   AND r.payment_reference=NEW.provider_reference AND json_extract(r.body_json,'$.transaction.status')='SUCCESS'
   AND json_extract(r.body_json,'$.order.invoice_number')=NEW.order_id
   AND (json_type(r.body_json,'$.order.currency') IS NULL OR json_extract(r.body_json,'$.order.currency')=NEW.currency)
   AND CAST(json_extract(r.body_json,'$.order.amount') AS TEXT) IN (CAST(NEW.amount AS TEXT),CAST(NEW.amount AS TEXT)||'.00')
 );
END;
CREATE TRIGGER commerce_hosted_binding_no_update BEFORE UPDATE ON commerce_hosted_payment_bindings BEGIN SELECT RAISE(ABORT,'commerce_hosted_immutable'); END;
CREATE TRIGGER commerce_hosted_binding_no_delete BEFORE DELETE ON commerce_hosted_payment_bindings BEGIN SELECT RAISE(ABORT,'commerce_hosted_immutable'); END;
CREATE TRIGGER commerce_hosted_receipt_no_update BEFORE UPDATE ON commerce_hosted_payment_receipts BEGIN SELECT RAISE(ABORT,'commerce_hosted_immutable'); END;
CREATE TRIGGER commerce_hosted_receipt_no_delete BEFORE DELETE ON commerce_hosted_payment_receipts BEGIN SELECT RAISE(ABORT,'commerce_hosted_immutable'); END;
CREATE TRIGGER commerce_hosted_no_retry BEFORE UPDATE OF state ON commerce_jobs
WHEN NEW.state='retry' AND EXISTS(SELECT 1 FROM commerce_hosted_payment_bindings b WHERE b.job_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'commerce_hosted_reconcile_required'); END;
DROP TRIGGER commerce_payment_session_guard;
CREATE TRIGGER commerce_payment_session_guard BEFORE INSERT ON commerce_payment_sessions
BEGIN
  SELECT RAISE(ABORT,'commerce_payment_binding_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM orders o JOIN commerce_jobs j ON j.order_id=o.id AND j.seller_id=o.seller_id
    WHERE o.id=NEW.order_id AND o.seller_id=NEW.seller_id AND o.commerce_version=1 AND o.commerce_environment=NEW.commerce_environment
      AND j.kind='payment.create' AND json_extract(j.payload_json,'$.providerRequestId')=NEW.provider_request_id
      AND json_extract(NEW.details_json,'$.providerRequestId')=NEW.provider_request_id
      AND json_extract(NEW.details_json,'$.flow')=json_extract(o.snapshot_json,'$.checkout.paymentFlow')
      AND (json_extract(NEW.details_json,'$.flow')='hosted' OR (json_extract(NEW.details_json,'$.flow')='routed_hosted' AND EXISTS (SELECT 1 FROM commerce_hosted_payment_receipts r WHERE r.order_id=o.id AND r.operation='checkout-create' AND json_extract(r.body_json,'$.response.payment.url')=json_extract(NEW.details_json,'$.paymentUrl'))) OR EXISTS (
        SELECT 1 FROM commerce_payment_accounts a WHERE a.order_id=o.id AND a.account_number=json_extract(NEW.details_json,'$.accountNumber')))
  ) OR EXISTS (SELECT 1 FROM commerce_payment_sessions s WHERE s.order_id=NEW.order_id AND s.details_json!=NEW.details_json);
END;

CREATE TRIGGER onboarding_hosted_gate BEFORE INSERT ON commerce_hosted_payment_bindings WHEN NEW.commerce_environment='production' BEGIN
 SELECT RAISE(ABORT,'seller_onboarding_required') WHERE NOT EXISTS(SELECT 1 FROM seller_onboarding_ready WHERE seller_id=NEW.seller_id);
END;
DROP VIEW commerce_settlement_scopes;
CREATE VIEW commerce_settlement_scopes AS
SELECT a.*,c.amount AS gross_amount,c.verified_at,o.created_at AS order_created_at,
  b.credential_fingerprint,b.seller_enrollment_id,b.platform_enrollment_id,
  json_extract(b.binding_json,'$.platformAmount') AS platform_amount,
  sp.cash_account AS seller_cash,sp.pending_account AS seller_pending,
  pp.cash_account AS platform_cash,pp.pending_account AS platform_pending,
  sc.id AS seller_collection_id,pc.id AS platform_collection_id,
  MAX(so.observed_at,po.observed_at) AS observed_at
FROM commerce_settlement_assessments a JOIN commerce_payment_captures c ON c.id=a.capture_id
  AND c.seller_id=a.seller_id AND c.order_id=a.order_id AND c.commerce_environment=a.commerce_environment
  AND c.capture_kind='order_payment' AND c.provider='doku' AND c.currency='IDR'
  AND c.amount BETWEEN 1 AND 100000000000
JOIN orders o ON o.id=c.order_id AND o.seller_id=c.seller_id AND o.total_amount=c.amount
JOIN commerce_financial_journals j ON j.capture_id=c.id AND j.kind='capture' AND j.allocation_state='allocated'
JOIN commerce_payment_route_bindings b ON b.order_id=o.id AND b.seller_id=o.seller_id AND b.commerce_environment=a.commerce_environment
JOIN commerce_payment_route_receipts r ON r.order_id=b.order_id AND r.credential_fingerprint=b.credential_fingerprint
JOIN (SELECT order_id,credential_fingerprint,binding_json,'snap_bca' AS payment_flow FROM commerce_snap_payment_bindings
 UNION ALL SELECT order_id,credential_fingerprint,binding_json,'routed_hosted' FROM commerce_hosted_payment_bindings) sn ON sn.order_id=o.id
  AND sn.payment_flow=json_extract(o.snapshot_json,'$.checkout.paymentFlow') AND sn.credential_fingerprint=b.credential_fingerprint
  AND json_extract(sn.binding_json,'$.routing.profileId')=json_extract(b.binding_json,'$.sellerProfileId')
  AND json_extract(sn.binding_json,'$.routing.splitRuleId')=r.split_rule_id
JOIN commerce_wallet_provider_profiles sp ON sp.enrollment_id=b.seller_enrollment_id
JOIN commerce_wallet_provider_profiles pp ON pp.enrollment_id=b.platform_enrollment_id
JOIN commerce_provider_financial_collections sc ON sc.sequence=a.seller_collection_sequence
  AND sc.enrollment_id=b.seller_enrollment_id AND sc.credential_fingerprint=b.credential_fingerprint AND sc.commerce_environment=a.commerce_environment
JOIN commerce_provider_financial_collections pc ON pc.sequence=a.platform_collection_sequence
  AND pc.enrollment_id=b.platform_enrollment_id AND pc.credential_fingerprint=b.credential_fingerprint AND pc.commerce_environment=a.commerce_environment
JOIN commerce_provider_collection_observations sm ON sm.collection_sequence=sc.sequence AND sm.role='balance_after'
JOIN commerce_provider_financial_observations so ON so.sequence=sm.observation_sequence
JOIN commerce_provider_collection_observations pm ON pm.collection_sequence=pc.sequence AND pm.role='balance_after'
JOIN commerce_provider_financial_observations po ON po.sequence=pm.observation_sequence;

