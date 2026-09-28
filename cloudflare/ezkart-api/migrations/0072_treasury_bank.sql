-- No deployment flag can substitute for verified release, fee funding, and
-- outcome-accounting policy. A later reviewed migration must derive eligibility.
CREATE VIEW commerce_treasury_execution_eligibility AS
SELECT id AS intent_id FROM commerce_treasury_intents WHERE 0;
CREATE TABLE commerce_treasury_bank_grants (
 intent_id TEXT NOT NULL REFERENCES commerce_treasury_intents(id),
 stage TEXT NOT NULL CHECK(stage IN ('inquiry','payment')),
 commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
 operator_id TEXT NOT NULL, proof_expires_at INTEGER NOT NULL,
 credential_fingerprint TEXT NOT NULL CHECK(length(credential_fingerprint)=64), client_id TEXT NOT NULL,
 inquiry_external_id TEXT NOT NULL CHECK(length(inquiry_external_id)=32 AND inquiry_external_id NOT GLOB '*[^0-9]*'),
 payment_external_id TEXT NOT NULL CHECK(length(payment_external_id)=32 AND payment_external_id NOT GLOB '*[^0-9]*' AND payment_external_id!=inquiry_external_id),
 binding_json TEXT NOT NULL CHECK(json_valid(binding_json)), request_body TEXT NOT NULL CHECK(json_valid(request_body)),
 source_json TEXT NOT NULL CHECK(json_valid(source_json)), destination_hash TEXT NOT NULL,
 confirmation_id TEXT, created_at TEXT NOT NULL,
 PRIMARY KEY(intent_id,stage), UNIQUE(commerce_environment,client_id,stage,inquiry_external_id), UNIQUE(commerce_environment,client_id,stage,payment_external_id)
);
CREATE TABLE commerce_treasury_bank_receipts (
 intent_id TEXT NOT NULL,stage TEXT NOT NULL,commerce_environment TEXT NOT NULL,credential_fingerprint TEXT NOT NULL,
 provider_reference TEXT NOT NULL,digest TEXT NOT NULL CHECK(length(digest)=64),beneficiary_name TEXT NOT NULL,
 evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),recorded_at TEXT NOT NULL,
 PRIMARY KEY(intent_id,stage),FOREIGN KEY(intent_id,stage) REFERENCES commerce_treasury_bank_grants(intent_id,stage),
 UNIQUE(commerce_environment,credential_fingerprint,stage,provider_reference)
);
CREATE TABLE commerce_treasury_bank_confirmations (
 id TEXT PRIMARY KEY,intent_id TEXT NOT NULL REFERENCES commerce_treasury_intents(id),request_key TEXT NOT NULL,
 inquiry_digest TEXT NOT NULL,operator_id TEXT NOT NULL,proof_expires_at INTEGER NOT NULL,
 source_json TEXT NOT NULL CHECK(json_valid(source_json)),created_at TEXT NOT NULL,UNIQUE(intent_id,request_key)
);
CREATE TRIGGER treasury_bank_grant_source BEFORE INSERT ON commerce_treasury_bank_grants BEGIN
 SELECT RAISE(ABORT,'treasury_bank_immutable') WHERE EXISTS(SELECT 1 FROM commerce_treasury_bank_grants WHERE intent_id=NEW.intent_id AND stage=NEW.stage);
 SELECT RAISE(ABORT,'treasury_bank_authority') WHERE NEW.proof_expires_at<=unixepoch('now') OR NEW.proof_expires_at>unixepoch('now')+630
  OR NOT EXISTS(SELECT 1 FROM commerce_support_staff WHERE auth_user_id=NEW.operator_id AND role='reviewer' AND commerce_environment=NEW.commerce_environment);
 SELECT RAISE(ABORT,'treasury_bank_source') WHERE NOT EXISTS(
  SELECT 1 FROM commerce_treasury_intents i JOIN commerce_treasury_funds f ON f.platform_enrollment_id=i.platform_enrollment_id
   JOIN commerce_wallet_provider_profiles p ON p.enrollment_id=i.platform_enrollment_id
   JOIN commerce_wallet_provider_bindings b ON b.enrollment_id=i.platform_enrollment_id
   JOIN commerce_wallet_enrollments e ON e.id=i.platform_enrollment_id JOIN sellers s ON s.id=e.seller_id
  WHERE i.id=NEW.intent_id AND i.commerce_environment=NEW.commerce_environment AND s.status='active'
   AND NOT EXISTS(SELECT 1 FROM commerce_treasury_cancellations c WHERE c.intent_id=i.id)
   AND f.source_json=NEW.source_json AND f.refund_holds=0 AND f.unattributed_captures=0 AND f.incomplete_journals=0
   AND f.reservation_shortfall=0 AND f.source_capacity_exceeded=0 AND i.destination_hash=NEW.destination_hash
   AND NOT EXISTS(SELECT 1 FROM json_each(i.source_json,'$.captures') old WHERE json_extract(old.value,'$.eligible')=1
    AND NOT EXISTS(SELECT 1 FROM commerce_treasury_commissions c WHERE c.capture_id=json_extract(old.value,'$.captureId')
     AND c.current_eligible=1 AND CAST(c.original_commission AS TEXT)=json_extract(old.value,'$.commission')
     AND CAST(c.reversed_commission AS TEXT)=json_extract(old.value,'$.reversed')))
   AND b.credential_fingerprint=NEW.credential_fingerprint AND b.client_id=NEW.client_id
   AND json_extract(NEW.binding_json,'$.environment')=i.commerce_environment
   AND json_extract(NEW.binding_json,'$.credentialFingerprint')=b.credential_fingerprint
   AND json_extract(NEW.binding_json,'$.partnerReferenceNo')=i.partner_reference
   AND json_extract(NEW.binding_json,'$.fromAccount')=p.cash_account
   AND json_extract(NEW.binding_json,'$.amount')=CAST(i.amount AS TEXT)
   AND json_extract(NEW.binding_json,'$.beneficiaryBankCode')=json_extract(i.destination_json,'$.code')
   AND json_extract(NEW.binding_json,'$.beneficiaryAccountNumber')=json_extract(i.destination_json,'$.accountNumber')
   AND json_extract(NEW.binding_json,'$.channel')=json_extract(i.destination_json,'$.channel')
   AND json_extract(NEW.binding_json,'$.inquiryExternalId')=NEW.inquiry_external_id
   AND json_extract(NEW.binding_json,'$.paymentExternalId')=NEW.payment_external_id
   AND NEW.created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 SELECT RAISE(ABORT,'treasury_payment_held') WHERE NEW.stage='payment' AND NOT EXISTS(SELECT 1 FROM commerce_treasury_execution_eligibility WHERE intent_id=NEW.intent_id);
 SELECT RAISE(ABORT,'treasury_payment_confirmation') WHERE NEW.stage='payment' AND NOT EXISTS(
  SELECT 1 FROM commerce_treasury_bank_confirmations c JOIN commerce_treasury_bank_receipts r ON r.intent_id=c.intent_id AND r.stage='inquiry'
   JOIN commerce_treasury_bank_grants g ON g.intent_id=c.intent_id AND g.stage='inquiry'
  WHERE c.id=NEW.confirmation_id AND c.intent_id=NEW.intent_id AND c.operator_id=NEW.operator_id
   AND c.inquiry_digest=r.digest AND c.proof_expires_at>unixepoch('now') AND c.source_json=NEW.source_json
   AND g.binding_json=NEW.binding_json AND g.client_id=NEW.client_id
   AND NEW.request_body=json_insert(g.request_body,'$.referenceNo',r.provider_reference,'$.beneficiaryAccountName',r.beneficiary_name));
 SELECT RAISE(ABORT,'treasury_inquiry_body') WHERE NEW.stage='inquiry' AND (NEW.confirmation_id IS NOT NULL OR NEW.request_body!=json_object(
  'partnerReferenceNo',json_extract(NEW.binding_json,'$.partnerReferenceNo'),'type','BANK_ACCOUNT','channel',json_extract(NEW.binding_json,'$.channel'),
  'amount',json_object('value',json_extract(NEW.binding_json,'$.amount')||'.00','currency','IDR'),'fromAccount',json_extract(NEW.binding_json,'$.fromAccount'),
  'beneficiaryBankCode',json_extract(NEW.binding_json,'$.beneficiaryBankCode'),'beneficiaryAccountNumber',json_extract(NEW.binding_json,'$.beneficiaryAccountNumber')));
END;
CREATE TRIGGER treasury_bank_confirmation_source BEFORE INSERT ON commerce_treasury_bank_confirmations BEGIN
 SELECT RAISE(ABORT,'treasury_bank_immutable') WHERE EXISTS(SELECT 1 FROM commerce_treasury_bank_confirmations WHERE id=NEW.id OR (intent_id=NEW.intent_id AND request_key=NEW.request_key));
 SELECT RAISE(ABORT,'treasury_bank_authority') WHERE NEW.proof_expires_at<=unixepoch('now') OR NEW.proof_expires_at>unixepoch('now')+630;
 SELECT RAISE(ABORT,'treasury_bank_confirmation') WHERE NOT EXISTS(
  SELECT 1 FROM commerce_treasury_intents i JOIN commerce_treasury_bank_receipts r ON r.intent_id=i.id AND r.stage='inquiry'
   JOIN commerce_treasury_funds f ON f.platform_enrollment_id=i.platform_enrollment_id
   JOIN commerce_support_staff s ON s.commerce_environment=i.commerce_environment AND s.auth_user_id=NEW.operator_id AND s.role='reviewer'
  WHERE i.id=NEW.intent_id AND r.digest=NEW.inquiry_digest AND f.source_json=NEW.source_json
   AND r.beneficiary_name=json_extract(i.destination_json,'$.beneficiaryName')
   AND f.reservation_shortfall=0 AND f.refund_holds=0 AND f.incomplete_journals=0 AND f.unattributed_captures=0 AND f.source_capacity_exceeded=0
   AND NOT EXISTS(SELECT 1 FROM commerce_treasury_cancellations WHERE intent_id=i.id)
   AND NOT EXISTS(SELECT 1 FROM commerce_treasury_bank_grants WHERE intent_id=i.id AND stage='payment')
   AND NEW.created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER treasury_bank_receipt_source BEFORE INSERT ON commerce_treasury_bank_receipts BEGIN
 SELECT RAISE(ABORT,'treasury_bank_immutable') WHERE EXISTS(SELECT 1 FROM commerce_treasury_bank_receipts WHERE intent_id=NEW.intent_id AND stage=NEW.stage);
 SELECT RAISE(ABORT,'treasury_bank_receipt') WHERE NOT EXISTS(SELECT 1 FROM commerce_treasury_bank_grants g
  WHERE g.intent_id=NEW.intent_id AND g.stage=NEW.stage AND g.commerce_environment=NEW.commerce_environment AND g.credential_fingerprint=NEW.credential_fingerprint
   AND json_extract(NEW.evidence_json,'$.requestBody')=g.request_body
   AND json_extract(NEW.evidence_json,'$.externalId')=CASE g.stage WHEN 'inquiry' THEN g.inquiry_external_id ELSE g.payment_external_id END
   AND json_extract(NEW.evidence_json,'$.operation')='transfer-'||g.stage
   AND json_extract(NEW.evidence_json,'$.environment')=g.commerce_environment
   AND json_extract(NEW.evidence_json,'$.credentialFingerprint')=g.credential_fingerprint);
END;
CREATE TRIGGER treasury_cancel_payment_fence BEFORE INSERT ON commerce_treasury_cancellations BEGIN
 SELECT RAISE(ABORT,'treasury_payment_in_flight') WHERE EXISTS(SELECT 1 FROM commerce_treasury_bank_grants WHERE intent_id=NEW.intent_id AND stage='payment');
END;
CREATE TRIGGER treasury_bank_grants_no_update BEFORE UPDATE ON commerce_treasury_bank_grants BEGIN SELECT RAISE(ABORT,'treasury_bank_immutable'); END;
CREATE TRIGGER treasury_bank_grants_no_delete BEFORE DELETE ON commerce_treasury_bank_grants BEGIN SELECT RAISE(ABORT,'treasury_bank_immutable'); END;
CREATE TRIGGER treasury_bank_receipts_no_update BEFORE UPDATE ON commerce_treasury_bank_receipts BEGIN SELECT RAISE(ABORT,'treasury_bank_immutable'); END;
CREATE TRIGGER treasury_bank_receipts_no_delete BEFORE DELETE ON commerce_treasury_bank_receipts BEGIN SELECT RAISE(ABORT,'treasury_bank_immutable'); END;
CREATE TRIGGER treasury_bank_confirmations_no_update BEFORE UPDATE ON commerce_treasury_bank_confirmations BEGIN SELECT RAISE(ABORT,'treasury_bank_immutable'); END;
CREATE TRIGGER treasury_bank_confirmations_no_delete BEFORE DELETE ON commerce_treasury_bank_confirmations BEGIN SELECT RAISE(ABORT,'treasury_bank_immutable'); END;
