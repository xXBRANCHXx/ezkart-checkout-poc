-- Atomic boundary between cancellable reservations and possible bank transport.
-- A grant or accepted response is not proof of final bank delivery. Reservation
-- liabilities stay intact until outcome reconciliation and payout accounting.
CREATE TABLE commerce_withdrawal_payment_grants (
  withdrawal_id TEXT PRIMARY KEY REFERENCES commerce_withdrawals(id) ON DELETE RESTRICT,
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  confirmation_id TEXT NOT NULL UNIQUE REFERENCES commerce_withdrawal_confirmations(id) ON DELETE RESTRICT,
  owner_auth_id TEXT NOT NULL,
  proof_expires_at TEXT NOT NULL,
  credential_fingerprint TEXT NOT NULL,
  client_id TEXT NOT NULL,
  payment_external_id TEXT NOT NULL,
  inquiry_digest TEXT NOT NULL,
  request_body TEXT NOT NULL CHECK(json_valid(request_body)),
  funds_json TEXT NOT NULL CHECK(json_valid(funds_json)),
  created_at TEXT NOT NULL,
  UNIQUE(commerce_environment,client_id,payment_external_id)
);

CREATE TABLE commerce_withdrawal_payment_receipts (
  withdrawal_id TEXT PRIMARY KEY REFERENCES commerce_withdrawal_payment_grants(withdrawal_id) ON DELETE RESTRICT,
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  credential_fingerprint TEXT NOT NULL,
  provider_reference TEXT NOT NULL CHECK(length(provider_reference) BETWEEN 1 AND 64),
  bank_reference TEXT NOT NULL CHECK(length(bank_reference) BETWEEN 1 AND 64),
  payment_digest TEXT NOT NULL CHECK(length(payment_digest)=64 AND payment_digest NOT GLOB '*[^a-f0-9]*'),
  evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
  requested_at TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE(commerce_environment,credential_fingerprint,provider_reference)
);

CREATE TABLE commerce_withdrawal_payment_diagnostics (
  withdrawal_id TEXT PRIMARY KEY REFERENCES commerce_withdrawal_payment_grants(withdrawal_id) ON DELETE RESTRICT,
  stage TEXT NOT NULL CHECK(stage IN ('provider_payment','persist_receipt','verify_receipt')),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 64 AND reason NOT GLOB '*[^a-z0-9_]*'),
  provider_status INTEGER NOT NULL CHECK(typeof(provider_status)='integer' AND (provider_status=0 OR provider_status BETWEEN 100 AND 599)),
  recorded_at TEXT NOT NULL
);

CREATE TRIGGER withdrawal_payment_grant_source BEFORE INSERT ON commerce_withdrawal_payment_grants BEGIN
  SELECT RAISE(ABORT,'withdrawal_payment_immutable') WHERE EXISTS(SELECT 1 FROM commerce_withdrawal_payment_grants
    WHERE withdrawal_id=NEW.withdrawal_id OR confirmation_id=NEW.confirmation_id
      OR (commerce_environment=NEW.commerce_environment AND client_id=NEW.client_id AND payment_external_id=NEW.payment_external_id));
  SELECT RAISE(ABORT,'withdrawal_payment_source') WHERE NOT EXISTS(
    SELECT 1 FROM commerce_withdrawals w JOIN commerce_withdrawal_inquiry_grants g ON g.withdrawal_id=w.id
    JOIN commerce_withdrawal_inquiry_receipts r ON r.withdrawal_id=w.id
    JOIN commerce_wallet_provider_profiles p ON p.enrollment_id=w.enrollment_id
    JOIN commerce_wallet_provider_bindings b ON b.enrollment_id=w.enrollment_id
    WHERE w.id=NEW.withdrawal_id AND w.commerce_environment=NEW.commerce_environment
      AND NEW.owner_auth_id=w.owner_auth_id AND NEW.owner_auth_id=g.owner_auth_id
      AND NEW.credential_fingerprint=g.credential_fingerprint AND NEW.credential_fingerprint=b.credential_fingerprint
      AND NEW.client_id=g.client_id AND NEW.client_id=b.client_id
      AND NEW.payment_external_id=g.payment_external_id AND NEW.inquiry_digest=r.inquiry_digest
      AND NEW.request_body=replace(replace(json_object('partnerReferenceNo',w.partner_reference,'type','BANK_ACCOUNT','channel',w.channel,
        'amount',json_object('value',CAST(w.amount AS TEXT)||'.00','currency','IDR'),'fromAccount',p.cash_account,
        'beneficiaryBankCode',w.bank_code,'beneficiaryAccountNumber',w.bank_account,
        'referenceNo',r.provider_reference,'beneficiaryAccountName',r.beneficiary_name),char(8232),'\u2028'),char(8233),'\u2029'));
  SELECT RAISE(ABORT,'withdrawal_payment_confirmation') WHERE NOT EXISTS(
    SELECT 1 FROM commerce_withdrawal_confirmations c WHERE c.id=NEW.confirmation_id AND c.withdrawal_id=NEW.withdrawal_id
      AND c.owner_auth_id=NEW.owner_auth_id AND c.inquiry_digest=NEW.inquiry_digest
      AND c.proof_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND c.sequence=(SELECT MAX(x.sequence) FROM commerce_withdrawal_confirmations x WHERE x.withdrawal_id=NEW.withdrawal_id));
  SELECT RAISE(ABORT,'withdrawal_owner_changed') WHERE NOT EXISTS(SELECT 1 FROM commerce_withdrawals w JOIN sellers s ON s.id=w.seller_id
    JOIN seller_memberships m ON m.seller_id=s.id WHERE w.id=NEW.withdrawal_id AND s.status='active' AND m.role='owner' AND m.auth_user_id=NEW.owner_auth_id);
  SELECT RAISE(ABORT,'withdrawal_proof_expired') WHERE NEW.proof_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    OR NEW.proof_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','+630 seconds');
  SELECT RAISE(ABORT,'withdrawal_cancelled') WHERE EXISTS(SELECT 1 FROM commerce_withdrawal_cancellations WHERE withdrawal_id=NEW.withdrawal_id);
  SELECT RAISE(ABORT,'withdrawal_funds_unavailable') WHERE NOT EXISTS(SELECT 1 FROM commerce_withdrawals w JOIN commerce_withdrawal_funds f
    ON f.seller_id=w.seller_id AND f.commerce_environment=w.commerce_environment WHERE w.id=NEW.withdrawal_id
      AND f.eligible_amount>=f.reserved_amount AND f.incomplete_captures=0 AND f.incomplete_journals=0 AND f.source_json=NEW.funds_json);
  SELECT RAISE(ABORT,'withdrawal_payment_source') WHERE NEW.created_at!=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;

-- These guards share the insertion transaction with the payment grant. Whichever
-- commits first wins; a timeout, missing receipt or provider error cannot cancel.
CREATE TRIGGER withdrawal_cancellation_payment_fence BEFORE INSERT ON commerce_withdrawal_cancellations BEGIN
  SELECT RAISE(ABORT,'withdrawal_payment_started') WHERE EXISTS(SELECT 1 FROM commerce_withdrawal_payment_grants WHERE withdrawal_id=NEW.withdrawal_id);
END;
CREATE TRIGGER withdrawal_confirmation_payment_fence BEFORE INSERT ON commerce_withdrawal_confirmations BEGIN
  SELECT RAISE(ABORT,'withdrawal_payment_started') WHERE EXISTS(SELECT 1 FROM commerce_withdrawal_payment_grants WHERE withdrawal_id=NEW.withdrawal_id);
END;

CREATE TRIGGER withdrawal_payment_receipt_source BEFORE INSERT ON commerce_withdrawal_payment_receipts BEGIN
  SELECT RAISE(ABORT,'withdrawal_payment_immutable') WHERE EXISTS(SELECT 1 FROM commerce_withdrawal_payment_receipts WHERE withdrawal_id=NEW.withdrawal_id
    OR (commerce_environment=NEW.commerce_environment AND credential_fingerprint=NEW.credential_fingerprint AND provider_reference=NEW.provider_reference));
  SELECT RAISE(ABORT,'withdrawal_payment_receipt_mismatch') WHERE NOT EXISTS(SELECT 1 FROM commerce_withdrawal_payment_grants g
    WHERE g.withdrawal_id=NEW.withdrawal_id AND g.commerce_environment=NEW.commerce_environment AND g.credential_fingerprint=NEW.credential_fingerprint
      AND (SELECT COUNT(*) FROM json_each(NEW.evidence_json))=8 AND (SELECT COUNT(DISTINCT key) FROM json_each(NEW.evidence_json))=8
      AND NOT EXISTS(SELECT 1 FROM json_each(NEW.evidence_json) WHERE type!='text')
      AND json_extract(NEW.evidence_json,'$.environment')=g.commerce_environment
      AND json_extract(NEW.evidence_json,'$.credentialFingerprint')=g.credential_fingerprint
      AND json_extract(NEW.evidence_json,'$.operation')='transfer-payment'
      AND json_extract(NEW.evidence_json,'$.externalId')=g.payment_external_id
      AND json_extract(NEW.evidence_json,'$.requestBody')=g.request_body
      AND julianday(NEW.requested_at)=julianday(json_extract(NEW.evidence_json,'$.requestedAt'))
      AND julianday(NEW.observed_at)=julianday(json_extract(NEW.evidence_json,'$.observedAt'))
      AND julianday(NEW.requested_at)>=julianday(g.created_at,'-300 seconds')
      AND NEW.observed_at>=NEW.requested_at AND julianday(NEW.observed_at)<=julianday('now','+300 seconds')
      AND NEW.recorded_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  SELECT RAISE(ABORT,'withdrawal_payment_receipt_mismatch') WHERE NOT EXISTS(
    SELECT 1 FROM commerce_withdrawal_payment_grants g
    JOIN commerce_withdrawal_inquiry_receipts i ON i.withdrawal_id=g.withdrawal_id,
    json_each(json_array(json_extract(NEW.evidence_json,'$.responseBody'))) r
    WHERE g.withdrawal_id=NEW.withdrawal_id AND json_valid(r.value)
      AND json_type(r.value,'$.responseCode')='text' AND json_extract(r.value,'$.responseCode') GLOB '200[0-9][0-9][0-9][0-9]'
      AND json_type(r.value,'$.referenceNo')='text' AND json_extract(r.value,'$.referenceNo')=NEW.provider_reference
      AND json_type(r.value,'$.referenceNumber')='text' AND json_extract(r.value,'$.referenceNumber')=NEW.bank_reference
      AND json_type(r.value,'$.beneficiaryAccountName')='text'
      AND json_extract(r.value,'$.beneficiaryAccountName')=json_extract(g.request_body,'$.beneficiaryAccountName')
      AND json_extract(r.value,'$.partnerReferenceNo')=json_extract(g.request_body,'$.partnerReferenceNo')
      AND json_extract(r.value,'$.type')='BANK_ACCOUNT'
      AND json_extract(r.value,'$.channel')=json_extract(g.request_body,'$.channel')
      AND json_type(r.value,'$.fromAccount') IN ('text','integer')
      AND CAST(json_extract(r.value,'$.fromAccount') AS TEXT)=json_extract(g.request_body,'$.fromAccount')
      AND json_extract(r.value,'$.beneficiaryBankCode')=json_extract(g.request_body,'$.beneficiaryBankCode')
      AND json_type(r.value,'$.beneficiaryAccountNumber')='text'
      AND json_extract(r.value,'$.beneficiaryAccountNumber')=json_extract(g.request_body,'$.beneficiaryAccountNumber')
      AND json_type(r.value,'$.amount.value')='text' AND json_extract(r.value,'$.amount.value')=json_extract(g.request_body,'$.amount.value')
      AND json_extract(r.value,'$.amount.currency')='IDR'
      AND json_type(r.value,'$.transactionDate')='text' AND julianday(NEW.processed_at)=julianday(json_extract(r.value,'$.transactionDate'))
      AND julianday(NEW.processed_at)>=julianday(i.requested_at,'-300 seconds')
      AND julianday(NEW.processed_at)<=julianday(NEW.observed_at,'+300 seconds')
      AND (SELECT COUNT(*) FROM json_each(r.value))=(SELECT COUNT(DISTINCT key) FROM json_each(r.value))
      AND (SELECT COUNT(*) FROM json_each(r.value,'$.amount'))=(SELECT COUNT(DISTINCT key) FROM json_each(r.value,'$.amount')));
END;

CREATE TRIGGER withdrawal_payment_diagnostic_source BEFORE INSERT ON commerce_withdrawal_payment_diagnostics BEGIN
  SELECT RAISE(ABORT,'withdrawal_payment_immutable') WHERE EXISTS(SELECT 1 FROM commerce_withdrawal_payment_diagnostics WHERE withdrawal_id=NEW.withdrawal_id);
  SELECT RAISE(ABORT,'withdrawal_payment_diagnostic_invalid') WHERE NEW.recorded_at!=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;
CREATE TRIGGER withdrawal_payment_grants_no_update BEFORE UPDATE ON commerce_withdrawal_payment_grants BEGIN SELECT RAISE(ABORT,'withdrawal_payment_immutable'); END;
CREATE TRIGGER withdrawal_payment_grants_no_delete BEFORE DELETE ON commerce_withdrawal_payment_grants BEGIN SELECT RAISE(ABORT,'withdrawal_payment_immutable'); END;
CREATE TRIGGER withdrawal_payment_receipts_no_update BEFORE UPDATE ON commerce_withdrawal_payment_receipts BEGIN SELECT RAISE(ABORT,'withdrawal_payment_immutable'); END;
CREATE TRIGGER withdrawal_payment_receipts_no_delete BEFORE DELETE ON commerce_withdrawal_payment_receipts BEGIN SELECT RAISE(ABORT,'withdrawal_payment_immutable'); END;
CREATE TRIGGER withdrawal_payment_diagnostics_no_update BEFORE UPDATE ON commerce_withdrawal_payment_diagnostics BEGIN SELECT RAISE(ABORT,'withdrawal_payment_immutable'); END;
CREATE TRIGGER withdrawal_payment_diagnostics_no_delete BEFORE DELETE ON commerce_withdrawal_payment_diagnostics BEGIN SELECT RAISE(ABORT,'withdrawal_payment_immutable'); END;
