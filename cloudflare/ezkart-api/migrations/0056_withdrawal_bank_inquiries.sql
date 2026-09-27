-- One original bank inquiry per reserved withdrawal. No payment grant is
-- created here; an inquiry or confirmation is never evidence of bank delivery.
CREATE TABLE commerce_withdrawal_inquiry_grants (
  withdrawal_id TEXT PRIMARY KEY REFERENCES commerce_withdrawals(id) ON DELETE RESTRICT,
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  owner_auth_id TEXT NOT NULL,
  proof_expires_at TEXT NOT NULL,
  credential_fingerprint TEXT NOT NULL CHECK(length(credential_fingerprint)=64 AND credential_fingerprint NOT GLOB '*[^a-f0-9]*'),
  client_id TEXT NOT NULL,
  inquiry_external_id TEXT NOT NULL CHECK(length(inquiry_external_id)=32 AND inquiry_external_id NOT GLOB '*[^0-9]*'),
  payment_external_id TEXT NOT NULL CHECK(length(payment_external_id)=32 AND payment_external_id NOT GLOB '*[^0-9]*' AND payment_external_id!=inquiry_external_id),
  binding_json TEXT NOT NULL CHECK(json_valid(binding_json)),
  request_body TEXT NOT NULL CHECK(json_valid(request_body)),
  created_at TEXT NOT NULL,
  UNIQUE(commerce_environment,client_id,inquiry_external_id),
  UNIQUE(commerce_environment,client_id,payment_external_id)
);

CREATE TABLE commerce_withdrawal_inquiry_receipts (
  withdrawal_id TEXT PRIMARY KEY REFERENCES commerce_withdrawal_inquiry_grants(withdrawal_id) ON DELETE RESTRICT,
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  credential_fingerprint TEXT NOT NULL,
  provider_reference TEXT NOT NULL CHECK(length(provider_reference) BETWEEN 1 AND 64),
  beneficiary_name TEXT NOT NULL CHECK(length(beneficiary_name) BETWEEN 1 AND 256),
  inquiry_digest TEXT NOT NULL CHECK(length(inquiry_digest)=64 AND inquiry_digest NOT GLOB '*[^a-f0-9]*'),
  evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
  requested_at TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE(commerce_environment,credential_fingerprint,provider_reference)
);

CREATE TABLE commerce_withdrawal_inquiry_diagnostics (
  withdrawal_id TEXT PRIMARY KEY REFERENCES commerce_withdrawal_inquiry_grants(withdrawal_id) ON DELETE RESTRICT,
  stage TEXT NOT NULL CHECK(stage IN ('provider_inquiry','persist_receipt','verify_receipt')),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 64 AND reason NOT GLOB '*[^a-z0-9_]*'),
  provider_status INTEGER NOT NULL CHECK(typeof(provider_status)='integer' AND (provider_status=0 OR provider_status BETWEEN 100 AND 599)),
  recorded_at TEXT NOT NULL
);

CREATE TABLE commerce_withdrawal_confirmations (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE CHECK(length(id)=47 AND substr(id,1,7)='wdconf_' AND substr(id,8) NOT GLOB '*[^a-f0-9]*'),
  withdrawal_id TEXT NOT NULL REFERENCES commerce_withdrawal_inquiry_receipts(withdrawal_id) ON DELETE RESTRICT,
  request_key TEXT NOT NULL CHECK(length(request_key)=32 AND request_key NOT GLOB '*[^a-f0-9]*'),
  owner_auth_id TEXT NOT NULL,
  proof_expires_at TEXT NOT NULL,
  inquiry_digest TEXT NOT NULL,
  funds_json TEXT NOT NULL CHECK(json_valid(funds_json)),
  created_at TEXT NOT NULL,
  UNIQUE(withdrawal_id,request_key)
);
CREATE INDEX idx_withdrawal_confirmations ON commerce_withdrawal_confirmations(withdrawal_id,sequence DESC);

CREATE TRIGGER withdrawal_inquiry_grant_source BEFORE INSERT ON commerce_withdrawal_inquiry_grants BEGIN
  SELECT RAISE(ABORT,'withdrawal_inquiry_immutable') WHERE EXISTS(SELECT 1 FROM commerce_withdrawal_inquiry_grants g WHERE g.withdrawal_id=NEW.withdrawal_id
    OR (g.commerce_environment=NEW.commerce_environment AND g.client_id=NEW.client_id
      AND (NEW.inquiry_external_id IN (g.inquiry_external_id,g.payment_external_id) OR NEW.payment_external_id IN (g.inquiry_external_id,g.payment_external_id))));
  SELECT RAISE(ABORT,'withdrawal_inquiry_source_mismatch') WHERE NOT EXISTS(
    SELECT 1 FROM commerce_withdrawals w JOIN commerce_wallet_provider_profiles p ON p.enrollment_id=w.enrollment_id
    JOIN commerce_wallet_provider_bindings b ON b.enrollment_id=w.enrollment_id
    WHERE w.id=NEW.withdrawal_id AND w.commerce_environment=NEW.commerce_environment
      AND NEW.owner_auth_id=w.owner_auth_id AND NEW.credential_fingerprint=b.credential_fingerprint AND NEW.client_id=b.client_id
      AND (SELECT COUNT(*) FROM json_each(NEW.binding_json))=10
      AND (SELECT COUNT(DISTINCT key) FROM json_each(NEW.binding_json))=10
      AND NOT EXISTS(SELECT 1 FROM json_each(NEW.binding_json) WHERE type!='text')
      AND json_extract(NEW.binding_json,'$.environment')=w.commerce_environment
      AND json_extract(NEW.binding_json,'$.credentialFingerprint')=b.credential_fingerprint
      AND json_extract(NEW.binding_json,'$.partnerReferenceNo')=w.partner_reference
      AND json_extract(NEW.binding_json,'$.fromAccount')=p.cash_account
      AND json_extract(NEW.binding_json,'$.beneficiaryBankCode')=w.bank_code
      AND json_extract(NEW.binding_json,'$.beneficiaryAccountNumber')=w.bank_account
      AND json_extract(NEW.binding_json,'$.amount')=CAST(w.amount AS TEXT)
      AND json_extract(NEW.binding_json,'$.channel')=w.channel
      AND json_extract(NEW.binding_json,'$.inquiryExternalId')=NEW.inquiry_external_id
      AND json_extract(NEW.binding_json,'$.paymentExternalId')=NEW.payment_external_id
      AND NEW.request_body=json_object('partnerReferenceNo',w.partner_reference,'type','BANK_ACCOUNT','channel',w.channel,
        'amount',json_object('value',CAST(w.amount AS TEXT)||'.00','currency','IDR'),'fromAccount',p.cash_account,
        'beneficiaryBankCode',w.bank_code,'beneficiaryAccountNumber',w.bank_account));
  SELECT RAISE(ABORT,'withdrawal_owner_changed') WHERE NOT EXISTS(SELECT 1 FROM commerce_withdrawals w JOIN sellers s ON s.id=w.seller_id
    JOIN seller_memberships m ON m.seller_id=s.id WHERE w.id=NEW.withdrawal_id AND s.status='active' AND m.role='owner' AND m.auth_user_id=NEW.owner_auth_id);
  SELECT RAISE(ABORT,'withdrawal_proof_expired') WHERE NEW.proof_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    OR NEW.proof_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','+630 seconds');
  SELECT RAISE(ABORT,'withdrawal_cancelled') WHERE EXISTS(SELECT 1 FROM commerce_withdrawal_cancellations WHERE withdrawal_id=NEW.withdrawal_id);
  SELECT RAISE(ABORT,'withdrawal_funds_unavailable') WHERE NOT EXISTS(SELECT 1 FROM commerce_withdrawals w JOIN commerce_withdrawal_funds f
    ON f.seller_id=w.seller_id AND f.commerce_environment=w.commerce_environment WHERE w.id=NEW.withdrawal_id
      AND f.eligible_amount>=f.reserved_amount AND f.incomplete_captures=0 AND f.incomplete_journals=0);
  SELECT RAISE(ABORT,'withdrawal_inquiry_source_mismatch') WHERE NEW.created_at!=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;

CREATE TRIGGER withdrawal_inquiry_receipt_source BEFORE INSERT ON commerce_withdrawal_inquiry_receipts BEGIN
  SELECT RAISE(ABORT,'withdrawal_inquiry_immutable') WHERE EXISTS(SELECT 1 FROM commerce_withdrawal_inquiry_receipts WHERE withdrawal_id=NEW.withdrawal_id
    OR (commerce_environment=NEW.commerce_environment AND credential_fingerprint=NEW.credential_fingerprint AND provider_reference=NEW.provider_reference));
  SELECT RAISE(ABORT,'withdrawal_inquiry_receipt_mismatch') WHERE NOT EXISTS(SELECT 1 FROM commerce_withdrawal_inquiry_grants g
    WHERE g.withdrawal_id=NEW.withdrawal_id AND g.commerce_environment=NEW.commerce_environment AND g.credential_fingerprint=NEW.credential_fingerprint
      AND (SELECT COUNT(*) FROM json_each(NEW.evidence_json))=8
      AND (SELECT COUNT(DISTINCT key) FROM json_each(NEW.evidence_json))=8
      AND NOT EXISTS(SELECT 1 FROM json_each(NEW.evidence_json) WHERE type!='text')
      AND json_extract(NEW.evidence_json,'$.environment')=g.commerce_environment
      AND json_extract(NEW.evidence_json,'$.credentialFingerprint')=g.credential_fingerprint
      AND json_extract(NEW.evidence_json,'$.operation')='transfer-inquiry'
      AND json_extract(NEW.evidence_json,'$.externalId')=g.inquiry_external_id
      AND json_extract(NEW.evidence_json,'$.requestBody')=g.request_body
      AND julianday(NEW.requested_at)=julianday(json_extract(NEW.evidence_json,'$.requestedAt'))
      AND julianday(NEW.observed_at)=julianday(json_extract(NEW.evidence_json,'$.observedAt'))
      AND julianday(NEW.requested_at)>=julianday(g.created_at,'-300 seconds')
      AND NEW.observed_at>=NEW.requested_at AND julianday(NEW.observed_at)<=julianday('now','+300 seconds')
      AND NEW.recorded_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  SELECT RAISE(ABORT,'withdrawal_inquiry_receipt_mismatch') WHERE NOT EXISTS(
    SELECT 1 FROM commerce_withdrawal_inquiry_grants g,json_each(json_array(json_extract(NEW.evidence_json,'$.responseBody'))) r
    WHERE g.withdrawal_id=NEW.withdrawal_id AND json_valid(r.value)
      AND json_type(r.value,'$.responseCode')='text' AND json_type(r.value,'$.referenceNo')='text'
      AND json_type(r.value,'$.beneficiaryAccountName')='text' AND json_type(r.value,'$.beneficiaryAccountNumber')='text'
      AND json_type(r.value,'$.amount.value')='text'
      AND json_extract(r.value,'$.responseCode') GLOB '200[0-9][0-9][0-9][0-9]'
      AND json_extract(r.value,'$.partnerReferenceNo')=json_extract(g.binding_json,'$.partnerReferenceNo')
      AND json_extract(r.value,'$.type')='BANK_ACCOUNT'
      AND json_extract(r.value,'$.channel')=json_extract(g.binding_json,'$.channel')
      AND json_type(r.value,'$.fromAccount') IN ('text','integer')
      AND CAST(json_extract(r.value,'$.fromAccount') AS TEXT)=json_extract(g.binding_json,'$.fromAccount')
      AND json_extract(r.value,'$.beneficiaryBankCode')=json_extract(g.binding_json,'$.beneficiaryBankCode')
      AND json_extract(r.value,'$.beneficiaryAccountNumber')=json_extract(g.binding_json,'$.beneficiaryAccountNumber')
      AND json_extract(r.value,'$.amount.value')=json_extract(g.binding_json,'$.amount')||'.00'
      AND json_extract(r.value,'$.amount.currency')='IDR'
      AND json_extract(r.value,'$.beneficiaryAccountName')=NEW.beneficiary_name
      AND json_extract(r.value,'$.referenceNo')=NEW.provider_reference
      AND (SELECT COUNT(*) FROM json_each(r.value))=(SELECT COUNT(DISTINCT key) FROM json_each(r.value))
      AND (SELECT COUNT(*) FROM json_each(r.value,'$.amount'))=(SELECT COUNT(DISTINCT key) FROM json_each(r.value,'$.amount')));
END;

CREATE TRIGGER withdrawal_inquiry_diagnostic_source BEFORE INSERT ON commerce_withdrawal_inquiry_diagnostics BEGIN
  SELECT RAISE(ABORT,'withdrawal_inquiry_immutable') WHERE EXISTS(SELECT 1 FROM commerce_withdrawal_inquiry_diagnostics WHERE withdrawal_id=NEW.withdrawal_id);
  SELECT RAISE(ABORT,'withdrawal_inquiry_diagnostic_invalid') WHERE NEW.recorded_at!=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;

CREATE TRIGGER withdrawal_confirmation_source BEFORE INSERT ON commerce_withdrawal_confirmations BEGIN
  SELECT RAISE(ABORT,'withdrawal_confirmation_immutable') WHERE EXISTS(SELECT 1 FROM commerce_withdrawal_confirmations WHERE id=NEW.id OR sequence=NEW.sequence
    OR (withdrawal_id=NEW.withdrawal_id AND request_key=NEW.request_key));
  SELECT RAISE(ABORT,'withdrawal_confirmation_mismatch') WHERE NOT EXISTS(SELECT 1 FROM commerce_withdrawal_inquiry_receipts r
    JOIN commerce_withdrawals w ON w.id=r.withdrawal_id WHERE r.withdrawal_id=NEW.withdrawal_id AND r.inquiry_digest=NEW.inquiry_digest AND w.owner_auth_id=NEW.owner_auth_id);
  SELECT RAISE(ABORT,'withdrawal_owner_changed') WHERE NOT EXISTS(SELECT 1 FROM commerce_withdrawals w JOIN sellers s ON s.id=w.seller_id
    JOIN seller_memberships m ON m.seller_id=s.id WHERE w.id=NEW.withdrawal_id AND s.status='active' AND m.role='owner' AND m.auth_user_id=NEW.owner_auth_id);
  SELECT RAISE(ABORT,'withdrawal_proof_expired') WHERE NEW.proof_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    OR NEW.proof_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','+630 seconds');
  SELECT RAISE(ABORT,'withdrawal_cancelled') WHERE EXISTS(SELECT 1 FROM commerce_withdrawal_cancellations WHERE withdrawal_id=NEW.withdrawal_id);
  SELECT RAISE(ABORT,'withdrawal_funds_unavailable') WHERE NOT EXISTS(SELECT 1 FROM commerce_withdrawals w JOIN commerce_withdrawal_funds f
    ON f.seller_id=w.seller_id AND f.commerce_environment=w.commerce_environment WHERE w.id=NEW.withdrawal_id
      AND f.eligible_amount>=f.reserved_amount AND f.incomplete_captures=0 AND f.incomplete_journals=0 AND f.source_json=NEW.funds_json);
  SELECT RAISE(ABORT,'withdrawal_confirmation_mismatch') WHERE NEW.created_at!=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;
CREATE TRIGGER withdrawal_confirmation_sequence AFTER INSERT ON commerce_withdrawal_confirmations BEGIN
  SELECT RAISE(ABORT,'withdrawal_confirmation_sequence') WHERE NEW.sequence<1 OR EXISTS(SELECT 1 FROM commerce_withdrawal_confirmations WHERE sequence>NEW.sequence);
END;

CREATE TRIGGER withdrawal_inquiry_grants_no_update BEFORE UPDATE ON commerce_withdrawal_inquiry_grants BEGIN SELECT RAISE(ABORT,'withdrawal_inquiry_immutable'); END;
CREATE TRIGGER withdrawal_inquiry_grants_no_delete BEFORE DELETE ON commerce_withdrawal_inquiry_grants BEGIN SELECT RAISE(ABORT,'withdrawal_inquiry_immutable'); END;
CREATE TRIGGER withdrawal_inquiry_receipts_no_update BEFORE UPDATE ON commerce_withdrawal_inquiry_receipts BEGIN SELECT RAISE(ABORT,'withdrawal_inquiry_immutable'); END;
CREATE TRIGGER withdrawal_inquiry_receipts_no_delete BEFORE DELETE ON commerce_withdrawal_inquiry_receipts BEGIN SELECT RAISE(ABORT,'withdrawal_inquiry_immutable'); END;
CREATE TRIGGER withdrawal_inquiry_diagnostics_no_update BEFORE UPDATE ON commerce_withdrawal_inquiry_diagnostics BEGIN SELECT RAISE(ABORT,'withdrawal_inquiry_immutable'); END;
CREATE TRIGGER withdrawal_inquiry_diagnostics_no_delete BEFORE DELETE ON commerce_withdrawal_inquiry_diagnostics BEGIN SELECT RAISE(ABORT,'withdrawal_inquiry_immutable'); END;
CREATE TRIGGER withdrawal_confirmations_no_update BEFORE UPDATE ON commerce_withdrawal_confirmations BEGIN SELECT RAISE(ABORT,'withdrawal_confirmation_immutable'); END;
CREATE TRIGGER withdrawal_confirmations_no_delete BEFORE DELETE ON commerce_withdrawal_confirmations BEGIN SELECT RAISE(ABORT,'withdrawal_confirmation_immutable'); END;
