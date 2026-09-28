-- Contract terms are server-owned, immutable merchant configuration. Provider
-- balances/history remain independently authenticated evidence.
CREATE TABLE commerce_transfer_fee_contracts (
 id TEXT PRIMARY KEY CHECK(length(id)=68 AND substr(id,1,4)='tfc_'),
 platform_enrollment_id TEXT NOT NULL REFERENCES commerce_wallet_provider_profiles(enrollment_id),
 contract_json TEXT NOT NULL CHECK(json_valid(contract_json)),created_at TEXT NOT NULL
);
ALTER TABLE commerce_withdrawal_payment_grants ADD COLUMN funding_contract_id TEXT REFERENCES commerce_transfer_fee_contracts(id);
ALTER TABLE commerce_withdrawal_payment_grants ADD COLUMN funding_balance_sequence INTEGER REFERENCES commerce_provider_financial_observations(sequence);
ALTER TABLE commerce_treasury_bank_grants ADD COLUMN funding_contract_id TEXT REFERENCES commerce_transfer_fee_contracts(id);
ALTER TABLE commerce_treasury_bank_grants ADD COLUMN funding_balance_sequence INTEGER REFERENCES commerce_provider_financial_observations(sequence);
CREATE TABLE commerce_transfer_fee_reservations (
 kind TEXT NOT NULL CHECK(kind IN ('withdrawal','treasury')),transfer_id TEXT NOT NULL,
 contract_id TEXT NOT NULL REFERENCES commerce_transfer_fee_contracts(id),platform_enrollment_id TEXT NOT NULL REFERENCES commerce_wallet_provider_profiles(enrollment_id),
 balance_sequence INTEGER NOT NULL REFERENCES commerce_provider_financial_observations(sequence),
 fee_limit INTEGER NOT NULL CHECK(typeof(fee_limit)='integer' AND fee_limit BETWEEN 0 AND 9007199254740991),
 source_json TEXT NOT NULL CHECK(json_valid(source_json)),created_at TEXT NOT NULL,PRIMARY KEY(kind,transfer_id)
);
CREATE TABLE commerce_transfer_fee_releases (
 kind TEXT NOT NULL,transfer_id TEXT NOT NULL,assessment_id TEXT NOT NULL,observation_cap INTEGER NOT NULL,status_cap INTEGER NOT NULL,
 actual_fee INTEGER NOT NULL CHECK(typeof(actual_fee)='integer' AND actual_fee BETWEEN 0 AND 9007199254740991),recorded_at TEXT NOT NULL,
 PRIMARY KEY(kind,transfer_id,assessment_id,observation_cap),FOREIGN KEY(kind,transfer_id) REFERENCES commerce_transfer_fee_reservations(kind,transfer_id)
);
CREATE VIEW commerce_transfer_fee_positions AS
SELECT r.*,CASE WHEN EXISTS(SELECT 1 FROM commerce_transfer_fee_releases x WHERE x.kind=r.kind AND x.transfer_id=r.transfer_id
 AND x.observation_cap=(SELECT COALESCE(MAX(sequence),0) FROM commerce_provider_financial_observations)
 AND x.status_cap=CASE r.kind WHEN 'withdrawal' THEN (SELECT MAX(sequence) FROM commerce_withdrawal_status_observations WHERE withdrawal_id=r.transfer_id)
 ELSE (SELECT MAX(sequence) FROM commerce_treasury_status_observations WHERE intent_id=r.transfer_id) END) THEN 0 ELSE r.fee_limit END AS reserved_fee,
 EXISTS(SELECT 1 FROM commerce_transfer_fee_releases x WHERE x.kind=r.kind AND x.transfer_id=r.transfer_id AND x.actual_fee>r.fee_limit) AS contract_exceeded
FROM commerce_transfer_fee_reservations r;
CREATE TRIGGER transfer_fee_release_source BEFORE INSERT ON commerce_transfer_fee_releases BEGIN
 SELECT RAISE(ABORT,'transfer_funding_immutable') WHERE EXISTS(SELECT 1 FROM commerce_transfer_fee_releases WHERE kind=NEW.kind AND transfer_id=NEW.transfer_id AND assessment_id=NEW.assessment_id AND observation_cap=NEW.observation_cap);
 SELECT RAISE(ABORT,'transfer_funding_release') WHERE NEW.observation_cap!=(SELECT COALESCE(MAX(sequence),0) FROM commerce_provider_financial_observations)
 OR NOT ((NEW.kind='withdrawal' AND EXISTS(SELECT 1 FROM commerce_payout_positions p JOIN commerce_payout_assessments a ON a.sequence=p.assessment_sequence
  WHERE p.withdrawal_id=NEW.transfer_id AND p.reconciled=1 AND p.assessment_id=NEW.assessment_id AND p.fee_amount=NEW.actual_fee AND a.status_sequence=NEW.status_cap))
 OR (NEW.kind='treasury' AND EXISTS(SELECT 1 FROM commerce_treasury_positions p JOIN commerce_treasury_outcome_assessments a ON a.sequence=p.recognition_sequence
  WHERE p.intent_id=NEW.transfer_id AND p.reconciled=1 AND a.id=NEW.assessment_id AND p.fee_amount=NEW.actual_fee AND a.status_sequence=NEW.status_cap)));
END;
CREATE TRIGGER transfer_fee_release_no_update BEFORE UPDATE ON commerce_transfer_fee_releases BEGIN SELECT RAISE(ABORT,'transfer_funding_immutable'); END;
CREATE TRIGGER transfer_fee_release_no_delete BEFORE DELETE ON commerce_transfer_fee_releases BEGIN SELECT RAISE(ABORT,'transfer_funding_immutable'); END;
CREATE VIEW commerce_treasury_released_commissions AS
SELECT c.* FROM commerce_treasury_commissions c JOIN commerce_order_delivery_receipts d ON d.capture_id=c.capture_id JOIN orders o ON o.id=c.order_id JOIN commerce_settlement_results r ON r.assessment_sequence=c.settlement_sequence
WHERE c.current_eligible=1 AND o.subtotal_amount-c.original_commission-1250-r.fee_amount>=0 AND o.fulfillment_state NOT IN ('stock_review','return_in_transit','returned','disposed')
 AND NOT EXISTS(SELECT 1 FROM commerce_jobs j WHERE j.order_id=o.id AND (j.kind LIKE 'shipment.%' OR j.kind='payment.create')
 AND (j.state IN ('uncertain','dead') OR (j.kind='shipment.cancel' AND j.state IN ('queued','running','retry'))));
CREATE VIEW commerce_treasury_release_eligibility AS
SELECT i.id AS intent_id FROM commerce_treasury_intents i
WHERE NOT EXISTS(SELECT 1 FROM json_each(i.source_json,'$.captures') old WHERE json_extract(old.value,'$.eligible')=1
 AND NOT EXISTS(SELECT 1 FROM commerce_treasury_released_commissions c
  WHERE c.capture_id=json_extract(old.value,'$.captureId') AND c.current_eligible=1
   AND CAST(c.original_commission AS TEXT)=json_extract(old.value,'$.commission') AND CAST(c.reversed_commission AS TEXT)=json_extract(old.value,'$.reversed')));
CREATE VIEW commerce_transfer_funding_balances AS
SELECT c.enrollment_id AS platform_enrollment_id,o.sequence AS balance_sequence,o.observed_at,
 CAST(json_extract(a.value,'$.available') AS INTEGER) AS available,
 CASE WHEN julianday(o.observed_at)>=julianday('now','-5 minutes') AND julianday(o.observed_at)<=julianday('now','+30 seconds')
  AND o.sequence=(SELECT MAX(sequence) FROM commerce_provider_financial_observations WHERE enrollment_id=c.enrollment_id) THEN 1 ELSE 0 END AS current
FROM commerce_provider_financial_collections c
JOIN commerce_provider_collection_observations m ON m.collection_sequence=c.sequence AND m.role='balance_after'
JOIN commerce_provider_financial_observations o ON o.sequence=m.observation_sequence
JOIN commerce_wallet_provider_profiles p ON p.enrollment_id=c.enrollment_id
JOIN json_each(o.normalized_json,'$.accounts') a
WHERE c.sequence=(SELECT MAX(sequence) FROM commerce_provider_financial_collections WHERE enrollment_id=c.enrollment_id)
 AND json_extract(a.value,'$.accountNo')=p.cash_account AND json_extract(a.value,'$.type')='DOKU_MERCHANT_IDR'
 AND json_extract(a.value,'$.available') NOT GLOB '*[^0-9]*' AND length(json_extract(a.value,'$.available')) BETWEEN 1 AND 16
 AND CAST(json_extract(a.value,'$.available') AS INTEGER)<=9007199254740991;
CREATE VIEW commerce_transfer_funding_budget AS
WITH pools AS MATERIALIZED (SELECT f.*,b.balance_sequence,b.available AS cash_available,b.current AS balance_current,
 COALESCE((SELECT SUM(c.net_commission) FROM commerce_treasury_released_commissions c
  WHERE c.platform_enrollment_id=f.platform_enrollment_id AND c.current_eligible=1),0) AS released_commission,
 COALESCE((SELECT SUM(r.reserved_fee) FROM commerce_transfer_fee_positions r WHERE r.platform_enrollment_id=f.platform_enrollment_id),0) AS reserved_fees,
 (SELECT COUNT(*) FROM commerce_transfer_fee_positions r WHERE r.platform_enrollment_id=f.platform_enrollment_id AND r.contract_exceeded=1) AS contract_exceeded
 FROM commerce_treasury_funds f LEFT JOIN commerce_transfer_funding_balances b ON b.platform_enrollment_id=f.platform_enrollment_id)
SELECT p.*,CASE WHEN balance_current=1 AND incomplete_journals=0 AND accounting_holds=0 AND refund_holds=0 AND unattributed_captures=0
 AND source_capacity_exceeded=0 AND contract_exceeded=0 AND reservation_shortfall=0
 AND cash_available>=reserved_commission+reserved_fees
 AND released_commission>=reserved_commission+paid_commission+paid_transfer_fees+reserved_fees
 AND NOT EXISTS(SELECT 1 FROM commerce_withdrawal_payment_grants g WHERE g.platform_enrollment_id=p.platform_enrollment_id AND g.funding_contract_id IS NULL)
 AND NOT EXISTS(SELECT 1 FROM commerce_treasury_bank_grants g JOIN commerce_treasury_intents i ON i.id=g.intent_id
  WHERE i.platform_enrollment_id=p.platform_enrollment_id AND g.stage='payment' AND g.funding_contract_id IS NULL) THEN 1 ELSE 0 END AS current,
 CAST(MAX(MIN(released_commission-reserved_commission-paid_commission-paid_transfer_fees-reserved_fees,cash_available-reserved_commission-reserved_fees),0) AS TEXT) AS fee_available
FROM pools p;
CREATE TRIGGER transfer_contract_source BEFORE INSERT ON commerce_transfer_fee_contracts BEGIN
 SELECT RAISE(ABORT,'transfer_funding_immutable') WHERE EXISTS(SELECT 1 FROM commerce_transfer_fee_contracts WHERE id=NEW.id);
 SELECT RAISE(ABORT,'transfer_funding_contract') WHERE NOT EXISTS(SELECT 1 FROM commerce_wallet_enrollments e JOIN sellers s ON s.id=e.seller_id AND s.status='active'
  JOIN commerce_wallet_provider_profiles p ON p.enrollment_id=e.id JOIN commerce_wallet_provider_bindings b ON b.enrollment_id=e.id
  WHERE e.id=NEW.platform_enrollment_id AND json_extract(NEW.contract_json,'$.environment')=e.commerce_environment
   AND json_extract(NEW.contract_json,'$.platformSeller')=e.seller_id AND json_extract(NEW.contract_json,'$.chargedCashAccount')=p.cash_account
   AND json_extract(NEW.contract_json,'$.credentialFingerprint')=b.credential_fingerprint AND json_extract(NEW.contract_json,'$.clientId')=b.client_id
   AND json_extract(NEW.contract_json,'$.sellerFeeBilling')='company_cash_direct'
   AND json_extract(NEW.contract_json,'$.validFrom')<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND json_extract(NEW.contract_json,'$.validUntil')>strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE VIEW commerce_transfer_grant_funding AS
SELECT 'withdrawal' AS kind,g.withdrawal_id AS transfer_id,g.platform_enrollment_id,g.funding_contract_id AS contract_id,g.funding_balance_sequence AS balance_sequence,
 w.channel,g.credential_fingerprint,g.client_id,g.commerce_environment,g.created_at FROM commerce_withdrawal_payment_grants g JOIN commerce_withdrawals w ON w.id=g.withdrawal_id
UNION ALL SELECT 'treasury',g.intent_id,i.platform_enrollment_id,g.funding_contract_id,g.funding_balance_sequence,json_extract(g.binding_json,'$.channel'),g.credential_fingerprint,g.client_id,g.commerce_environment,g.created_at
FROM commerce_treasury_bank_grants g JOIN commerce_treasury_intents i ON i.id=g.intent_id WHERE g.stage='payment';
CREATE TRIGGER transfer_fee_reservation_source BEFORE INSERT ON commerce_transfer_fee_reservations BEGIN
 SELECT RAISE(ABORT,'transfer_funding_immutable') WHERE EXISTS(SELECT 1 FROM commerce_transfer_fee_reservations WHERE kind=NEW.kind AND transfer_id=NEW.transfer_id);
 SELECT RAISE(ABORT,'transfer_funding_unavailable') WHERE NOT EXISTS(SELECT 1 FROM commerce_transfer_grant_funding g
 JOIN commerce_transfer_fee_contracts c ON c.id=g.contract_id AND c.platform_enrollment_id=g.platform_enrollment_id
 JOIN commerce_transfer_funding_budget b ON b.platform_enrollment_id=g.platform_enrollment_id
 WHERE g.kind=NEW.kind AND g.transfer_id=NEW.transfer_id AND g.contract_id=NEW.contract_id AND g.platform_enrollment_id=NEW.platform_enrollment_id
  AND b.current=1 AND b.balance_sequence=NEW.balance_sequence AND g.balance_sequence=NEW.balance_sequence
  AND json_extract(c.contract_json,'$.credentialFingerprint')=g.credential_fingerprint AND json_extract(c.contract_json,'$.clientId')=g.client_id
  AND json_extract(c.contract_json,'$.environment')=g.commerce_environment
  AND json_extract(c.contract_json,'$.validFrom')<=g.created_at AND json_extract(c.contract_json,'$.validUntil')>g.created_at
  AND json_type(c.contract_json,'$.channels.'||g.channel)='text'
  AND NEW.fee_limit=CAST(json_extract(c.contract_json,'$.channels.'||g.channel) AS INTEGER) AND CAST(b.fee_available AS INTEGER)>=NEW.fee_limit
  AND NEW.source_json=b.source_json AND NEW.created_at=g.created_at
  AND (NEW.kind='withdrawal' OR EXISTS(SELECT 1 FROM commerce_treasury_release_eligibility WHERE intent_id=NEW.transfer_id)));
END;
CREATE TRIGGER withdrawal_payment_fee_funding AFTER INSERT ON commerce_withdrawal_payment_grants BEGIN
 SELECT RAISE(ABORT,'transfer_funding_required') WHERE NEW.funding_contract_id IS NULL OR NEW.funding_balance_sequence IS NULL;
 INSERT INTO commerce_transfer_fee_reservations
 SELECT 'withdrawal',NEW.withdrawal_id,c.id,NEW.platform_enrollment_id,NEW.funding_balance_sequence,
 CAST(json_extract(c.contract_json,'$.channels.'||w.channel) AS INTEGER),f.source_json,NEW.created_at
 FROM commerce_transfer_fee_contracts c JOIN commerce_withdrawals w ON w.id=NEW.withdrawal_id
 JOIN commerce_treasury_funds f ON f.platform_enrollment_id=NEW.platform_enrollment_id WHERE c.id=NEW.funding_contract_id;
 SELECT RAISE(ABORT,'transfer_funding_required') WHERE NOT EXISTS(SELECT 1 FROM commerce_transfer_fee_reservations WHERE kind='withdrawal' AND transfer_id=NEW.withdrawal_id);
END;
CREATE TRIGGER treasury_payment_fee_funding AFTER INSERT ON commerce_treasury_bank_grants WHEN NEW.stage='payment' BEGIN
 SELECT RAISE(ABORT,'transfer_funding_required') WHERE NEW.funding_contract_id IS NULL OR NEW.funding_balance_sequence IS NULL;
 INSERT INTO commerce_transfer_fee_reservations
 SELECT 'treasury',NEW.intent_id,c.id,i.platform_enrollment_id,NEW.funding_balance_sequence,
 CAST(json_extract(c.contract_json,'$.channels.'||json_extract(NEW.binding_json,'$.channel')) AS INTEGER),f.source_json,NEW.created_at
 FROM commerce_transfer_fee_contracts c JOIN commerce_treasury_intents i ON i.id=NEW.intent_id
 JOIN commerce_treasury_funds f ON f.platform_enrollment_id=i.platform_enrollment_id WHERE c.id=NEW.funding_contract_id;
 SELECT RAISE(ABORT,'transfer_funding_required') WHERE NOT EXISTS(SELECT 1 FROM commerce_transfer_fee_reservations WHERE kind='treasury' AND transfer_id=NEW.intent_id);
END;
DROP VIEW commerce_treasury_execution_eligibility;
CREATE VIEW commerce_treasury_execution_eligibility AS SELECT intent_id FROM commerce_treasury_release_eligibility;
CREATE TRIGGER transfer_contract_no_update BEFORE UPDATE ON commerce_transfer_fee_contracts BEGIN SELECT RAISE(ABORT,'transfer_funding_immutable'); END;
CREATE TRIGGER transfer_contract_no_delete BEFORE DELETE ON commerce_transfer_fee_contracts BEGIN SELECT RAISE(ABORT,'transfer_funding_immutable'); END;
CREATE TRIGGER transfer_fee_no_update BEFORE UPDATE ON commerce_transfer_fee_reservations BEGIN SELECT RAISE(ABORT,'transfer_funding_immutable'); END;
CREATE TRIGGER transfer_fee_no_delete BEFORE DELETE ON commerce_transfer_fee_reservations BEGIN SELECT RAISE(ABORT,'transfer_funding_immutable'); END;

DROP VIEW commerce_treasury_funds;
CREATE VIEW commerce_treasury_funds AS
WITH snapshots AS MATERIALIZED (
 SELECT f.*,COALESCE((SELECT SUM(r.reserved_fee) FROM commerce_transfer_fee_positions r WHERE r.platform_enrollment_id=f.platform_enrollment_id),0) AS reserved_transfer_fees,
 (SELECT COUNT(*) FROM commerce_transfer_fee_positions r WHERE r.platform_enrollment_id=f.platform_enrollment_id AND r.contract_exceeded=1) AS fee_contract_holds,
 json_object('version',3,'platformEnrollmentId',platform_enrollment_id,'captures',json(captures_json),
 'eligibleCommission',CAST(eligible_commission AS TEXT),'reservedCommission',CAST(reserved_commission AS TEXT),
 'paidCommission',CAST(paid_commission AS TEXT),'paidTransferFees',CAST(paid_transfer_fees AS TEXT),'accountingHolds',accounting_holds,
 'reservedTransferFees',CAST(COALESCE((SELECT SUM(r.reserved_fee) FROM commerce_transfer_fee_positions r WHERE r.platform_enrollment_id=f.platform_enrollment_id),0) AS TEXT),
 'refundHolds',refund_holds,'unattributedCaptures',unattributed_captures,'incompleteJournals',incomplete_journals) AS source_json
 FROM commerce_treasury_fund_inputs f)
SELECT f.*,CASE WHEN unattributed_captures=0 AND incomplete_journals=0 AND refund_holds=0 AND accounting_holds=0 AND fee_contract_holds=0 AND length(source_json)<=200000
 THEN MAX(eligible_commission-reserved_commission-paid_commission-paid_transfer_fees-reserved_transfer_fees,0) ELSE 0 END AS reservable_commission,
 MAX(reserved_commission+paid_commission+paid_transfer_fees+reserved_transfer_fees-MAX(eligible_commission,0),0) AS reservation_shortfall,
 CASE WHEN length(source_json)>200000 THEN 1 ELSE 0 END AS source_capacity_exceeded FROM snapshots f;
