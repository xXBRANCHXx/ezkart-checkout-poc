-- A payment's seller and flat platform allocation are frozen before creating
-- its DOKU split rule. Neither a rule nor a VA receipt proves settlement.
CREATE TABLE commerce_payment_route_bindings (
  order_id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  job_id TEXT NOT NULL UNIQUE REFERENCES commerce_jobs(id) ON DELETE RESTRICT,
  attempt_id TEXT NOT NULL UNIQUE REFERENCES commerce_job_attempts(id) ON DELETE RESTRICT,
  seller_enrollment_id TEXT NOT NULL REFERENCES commerce_wallet_provider_profiles(enrollment_id) ON DELETE RESTRICT,
  platform_enrollment_id TEXT NOT NULL REFERENCES commerce_wallet_provider_profiles(enrollment_id) ON DELETE RESTRICT,
  credential_fingerprint TEXT NOT NULL,
  client_id TEXT NOT NULL,
  external_id TEXT NOT NULL CHECK(length(external_id)=32 AND external_id NOT GLOB '*[^0-9]*'),
  binding_json TEXT NOT NULL CHECK(json_valid(binding_json)),
  created_at TEXT NOT NULL,
  UNIQUE(commerce_environment,client_id,external_id),
  FOREIGN KEY(seller_id,order_id) REFERENCES orders(seller_id,id) ON DELETE RESTRICT
);

CREATE TABLE commerce_payment_route_receipts (
  order_id TEXT PRIMARY KEY REFERENCES commerce_payment_route_bindings(order_id) ON DELETE RESTRICT,
  credential_fingerprint TEXT NOT NULL,
  split_rule_id TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
  received_at TEXT NOT NULL,
  UNIQUE(credential_fingerprint,split_rule_id)
);

CREATE TRIGGER payment_route_binding_source BEFORE INSERT ON commerce_payment_route_bindings BEGIN
  SELECT RAISE(ABORT,'payment_route_source_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM orders o JOIN commerce_jobs j ON j.id=NEW.job_id
    JOIN commerce_job_attempts a ON a.id=NEW.attempt_id AND a.job_id=j.id AND a.attempt=j.attempts
    WHERE o.id=NEW.order_id AND o.seller_id=NEW.seller_id AND o.commerce_environment=NEW.commerce_environment
      AND o.commerce_version=1 AND json_extract(o.snapshot_json,'$.checkout.paymentFlow')='snap_bca'
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

CREATE TRIGGER payment_route_receipt_source BEFORE INSERT ON commerce_payment_route_receipts BEGIN
  SELECT RAISE(ABORT,'payment_route_receipt_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_payment_route_bindings b WHERE b.order_id=NEW.order_id AND b.credential_fingerprint=NEW.credential_fingerprint
      AND json_extract(NEW.evidence_json,'$.environment')=b.commerce_environment
      AND json_extract(NEW.evidence_json,'$.credentialFingerprint')=b.credential_fingerprint
      AND json_extract(NEW.evidence_json,'$.operation')='split-rules'
      AND json_extract(NEW.evidence_json,'$.externalId')=b.external_id
      AND json_extract(json_extract(NEW.evidence_json,'$.responseBody'),'$.splitRuleId')=NEW.split_rule_id
      AND json_extract(json_extract(NEW.evidence_json,'$.responseBody'),'$.transactionType')='PAYMENT'
      AND json_array_length(json_extract(NEW.evidence_json,'$.responseBody'),'$.rules')=1
      AND json_extract(json_extract(NEW.evidence_json,'$.responseBody'),'$.rules[0].type')='FLAT'
      AND json_extract(json_extract(NEW.evidence_json,'$.responseBody'),'$.rules[0].currency')='IDR'
      AND CAST(json_extract(json_extract(NEW.evidence_json,'$.responseBody'),'$.rules[0].accountNumber') AS TEXT)=json_extract(b.binding_json,'$.platformCashAccount')
      AND json_extract(json_extract(NEW.evidence_json,'$.responseBody'),'$.rules[0].value')=json_extract(b.binding_json,'$.platformAmount')
  );
  SELECT RAISE(ABORT,'payment_route_receipt_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_payment_route_bindings b WHERE b.order_id=NEW.order_id
      AND json_type(json_extract(NEW.evidence_json,'$.responseBody'),'$.responseCode')='text'
      AND json_extract(json_extract(NEW.evidence_json,'$.responseBody'),'$.responseCode') GLOB '200[0-9][0-9][0-9][0-9]'
      AND json_extract(json_extract(NEW.evidence_json,'$.requestBody'),'$.transactionType')='PAYMENT'
      AND json_array_length(json_extract(NEW.evidence_json,'$.requestBody'),'$.rules')=1
      AND json_extract(json_extract(NEW.evidence_json,'$.requestBody'),'$.rules[0].type')='FLAT'
      AND json_extract(json_extract(NEW.evidence_json,'$.requestBody'),'$.rules[0].currency')='IDR'
      AND CAST(json_extract(json_extract(NEW.evidence_json,'$.requestBody'),'$.rules[0].accountNumber') AS TEXT)=json_extract(b.binding_json,'$.platformCashAccount')
      AND json_extract(json_extract(NEW.evidence_json,'$.requestBody'),'$.rules[0].value')=json_extract(b.binding_json,'$.platformAmount')
  );
  SELECT RAISE(ABORT,'payment_route_immutable') WHERE EXISTS(SELECT 1 FROM commerce_payment_route_receipts WHERE order_id=NEW.order_id OR (credential_fingerprint=NEW.credential_fingerprint AND split_rule_id=NEW.split_rule_id));
END;

CREATE TRIGGER payment_route_bindings_no_update BEFORE UPDATE ON commerce_payment_route_bindings BEGIN SELECT RAISE(ABORT,'payment_route_immutable'); END;
CREATE TRIGGER payment_route_bindings_no_delete BEFORE DELETE ON commerce_payment_route_bindings BEGIN SELECT RAISE(ABORT,'payment_route_immutable'); END;
CREATE TRIGGER payment_route_receipts_no_update BEFORE UPDATE ON commerce_payment_route_receipts BEGIN SELECT RAISE(ABORT,'payment_route_immutable'); END;
CREATE TRIGGER payment_route_receipts_no_delete BEFORE DELETE ON commerce_payment_route_receipts BEGIN SELECT RAISE(ABORT,'payment_route_immutable'); END;

-- Existing unrouted bindings stay readable for callbacks/reconciliation. Every
-- new dispatch requires its own already accepted original split receipt.
CREATE TRIGGER commerce_snap_route_required BEFORE INSERT ON commerce_snap_payment_bindings BEGIN
  SELECT RAISE(ABORT,'payment_route_required') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_payment_route_bindings r JOIN commerce_payment_route_receipts p ON p.order_id=r.order_id
    WHERE r.order_id=NEW.order_id AND r.seller_id=NEW.seller_id AND r.commerce_environment=NEW.commerce_environment
      AND r.job_id=NEW.job_id AND r.credential_fingerprint=NEW.credential_fingerprint AND r.client_id=NEW.client_id
      AND json_extract(NEW.binding_json,'$.routing.profileId')=json_extract(r.binding_json,'$.sellerProfileId')
      AND json_extract(NEW.binding_json,'$.routing.splitRuleId')=p.split_rule_id
  );
  SELECT RAISE(ABORT,'commerce_immutable_snap') WHERE EXISTS(SELECT 1 FROM commerce_snap_payment_bindings WHERE order_id=NEW.order_id OR job_id=NEW.job_id);
END;

CREATE TRIGGER payment_route_unknown_retry BEFORE UPDATE OF state ON commerce_jobs
WHEN NEW.state='retry' AND EXISTS(SELECT 1 FROM commerce_payment_route_bindings b WHERE b.job_id=NEW.id
  AND NOT EXISTS(SELECT 1 FROM commerce_payment_route_receipts r WHERE r.order_id=b.order_id))
BEGIN SELECT RAISE(ABORT,'payment_route_reconcile_required'); END;
