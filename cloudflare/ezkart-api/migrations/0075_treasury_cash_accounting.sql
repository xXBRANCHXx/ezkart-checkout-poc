-- Actual company outflows are distinct from future transfer authorization.
-- Only a complete original successful bank transfer with an explicit actual
-- company-cash fee is recognized. Unknown/void fees are never converted to zero.
INSERT INTO commerce_financial_accounts(code,account_class,normal_side) VALUES
 ('company_bank_transfer_clearing','asset','debit');
CREATE TABLE commerce_treasury_recognitions (
 assessment_sequence INTEGER PRIMARY KEY REFERENCES commerce_treasury_outcome_assessments(sequence),
 intent_id TEXT NOT NULL REFERENCES commerce_treasury_intents(id),
 previous_sequence INTEGER REFERENCES commerce_treasury_recognitions(assessment_sequence),
 paid_amount INTEGER NOT NULL CHECK(typeof(paid_amount)='integer' AND paid_amount BETWEEN 1 AND 9007199254740991),
 fee_amount INTEGER NOT NULL CHECK(typeof(fee_amount)='integer' AND fee_amount BETWEEN 0 AND 9007199254740991),
 recorded_at TEXT NOT NULL
);
CREATE VIEW commerce_treasury_recognition_candidates AS
SELECT a.sequence AS assessment_sequence,a.intent_id,i.amount AS paid_amount,CAST(r.observed_fee AS INTEGER) AS fee_amount,
 (SELECT MAX(x.assessment_sequence) FROM commerce_treasury_recognitions x WHERE x.intent_id=a.intent_id AND x.assessment_sequence<a.sequence) AS previous_sequence
FROM commerce_treasury_outcome_assessments a JOIN commerce_treasury_outcome_results r ON r.assessment_sequence=a.sequence
JOIN commerce_treasury_outcome_freshness f ON f.assessment_sequence=a.sequence
JOIN commerce_treasury_intents i ON i.id=a.intent_id
WHERE r.state='matched_success' AND f.current=1 AND r.observed_fee IS NOT NULL
 AND CAST(r.observed_fee AS INTEGER)<=9007199254740991-i.amount
 AND a.sequence=(SELECT MAX(sequence) FROM commerce_treasury_outcome_assessments WHERE intent_id=a.intent_id);
CREATE VIEW commerce_treasury_journal_accounting AS
SELECT 'financial_treasury_'||a.id AS id,e.seller_id,i.commerce_environment,
 CASE WHEN n.previous_sequence IS NULL THEN 'treasury_payout' ELSE 'treasury_payout_correction' END AS kind,
 json_object('version',1,'intentId',i.id,'assessmentId',a.id,'originalDestinationHash',i.destination_hash,
  'originalPlatformEnrollmentId',i.platform_enrollment_id,'paidAmount',CAST(n.paid_amount AS TEXT),
  'actualFee',CAST(n.fee_amount AS TEXT),'previousAssessmentSequence',n.previous_sequence,'providerEvidence',json(r.source_json)) AS source_json,
 (SELECT json_group_array(json(value)) FROM json_each(json_array(
  json_object('account','company_bank_transfer_clearing','amount',n.paid_amount-COALESCE(old.paid_amount,0)),
  json_object('account','platform_withdrawal_fee','amount',n.fee_amount-COALESCE(old.fee_amount,0)),
  json_object('account','provider_cash_platform','amount',-(n.paid_amount-COALESCE(old.paid_amount,0)+n.fee_amount-COALESCE(old.fee_amount,0)))
 )) WHERE json_extract(value,'$.amount')!=0) AS lines_json,
 r.observed_at AS occurred_at,n.recorded_at AS posted_at
FROM commerce_treasury_recognitions n JOIN commerce_treasury_outcome_assessments a ON a.sequence=n.assessment_sequence
JOIN commerce_treasury_outcome_results r ON r.assessment_sequence=a.sequence
JOIN commerce_treasury_intents i ON i.id=n.intent_id JOIN commerce_wallet_enrollments e ON e.id=i.platform_enrollment_id
LEFT JOIN commerce_treasury_recognitions old ON old.assessment_sequence=n.previous_sequence;
CREATE TRIGGER treasury_recognition_source BEFORE INSERT ON commerce_treasury_recognitions BEGIN
 SELECT RAISE(ABORT,'treasury_recognition_immutable') WHERE EXISTS(SELECT 1 FROM commerce_treasury_recognitions WHERE assessment_sequence=NEW.assessment_sequence);
 SELECT RAISE(ABORT,'treasury_recognition_source') WHERE NOT EXISTS(SELECT 1 FROM commerce_treasury_recognition_candidates c
  WHERE c.assessment_sequence=NEW.assessment_sequence AND c.intent_id=NEW.intent_id AND c.previous_sequence IS NEW.previous_sequence
   AND c.paid_amount=NEW.paid_amount AND c.fee_amount=NEW.fee_amount AND NEW.recorded_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER treasury_recognition_post AFTER INSERT ON commerce_treasury_recognitions BEGIN
 INSERT INTO commerce_financial_journals(id,seller_id,commerce_environment,currency,kind,allocation_state,source_json,lines_json,occurred_at,posted_at)
 SELECT id,seller_id,commerce_environment,'IDR',kind,'allocated',source_json,lines_json,occurred_at,posted_at
 FROM commerce_treasury_journal_accounting WHERE id='financial_treasury_'||(SELECT id FROM commerce_treasury_outcome_assessments WHERE sequence=NEW.assessment_sequence)
  AND json_array_length(lines_json)>0;
END;
CREATE TRIGGER treasury_recognition_no_update BEFORE UPDATE ON commerce_treasury_recognitions BEGIN SELECT RAISE(ABORT,'treasury_recognition_immutable'); END;
CREATE TRIGGER treasury_recognition_no_delete BEFORE DELETE ON commerce_treasury_recognitions BEGIN SELECT RAISE(ABORT,'treasury_recognition_immutable'); END;
CREATE VIEW commerce_treasury_positions AS
SELECT i.id AS intent_id,i.platform_enrollment_id,i.commerce_environment,n.assessment_sequence AS recognition_sequence,
 COALESCE(n.paid_amount,0) AS paid_amount,COALESCE(n.fee_amount,0) AS fee_amount,
 CASE WHEN n.assessment_sequence IS NOT NULL AND a.sequence=n.assessment_sequence AND f.current=1 AND r.state='matched_success' THEN 1 ELSE 0 END AS reconciled,
 CASE WHEN n.assessment_sequence IS NOT NULL AND (a.sequence!=n.assessment_sequence OR f.current!=1 OR r.state!='matched_success') THEN 1 ELSE 0 END AS needs_review
FROM commerce_treasury_intents i
LEFT JOIN commerce_treasury_recognitions n ON n.assessment_sequence=(SELECT MAX(assessment_sequence) FROM commerce_treasury_recognitions WHERE intent_id=i.id)
LEFT JOIN commerce_treasury_outcome_assessments a ON a.sequence=(SELECT MAX(sequence) FROM commerce_treasury_outcome_assessments WHERE intent_id=i.id)
LEFT JOIN commerce_treasury_outcome_results r ON r.assessment_sequence=a.sequence
LEFT JOIN commerce_treasury_outcome_freshness f ON f.assessment_sequence=a.sequence;

DROP TRIGGER financial_journal_capture_guard;
CREATE TRIGGER financial_journal_capture_guard BEFORE INSERT ON commerce_financial_journals BEGIN
  SELECT RAISE(ABORT,'financial_source_mismatch') WHERE NOT (
    (NEW.kind='capture' AND EXISTS(SELECT 1 FROM commerce_capture_accounting c WHERE c.capture_id=NEW.capture_id
      AND NEW.id='financial_'||c.capture_id AND c.seller_id=NEW.seller_id AND c.order_id=NEW.order_id
      AND c.commerce_environment=NEW.commerce_environment AND c.currency=NEW.currency AND c.allocation_state=NEW.allocation_state
      AND c.source_json=NEW.source_json AND c.lines_json=NEW.lines_json AND c.occurred_at=NEW.occurred_at
      AND typeof(c.gross_amount)='integer' AND c.gross_amount BETWEEN 1 AND 9007199254740991))
    OR (NEW.kind IN ('settlement','settlement_correction','settlement_reversal') AND NEW.currency='IDR' AND NEW.allocation_state='allocated'
      AND EXISTS(SELECT 1 FROM commerce_settlement_journal_accounting s WHERE s.id=NEW.id AND s.capture_id=NEW.capture_id AND s.order_id=NEW.order_id
        AND s.seller_id=NEW.seller_id AND s.commerce_environment=NEW.commerce_environment AND s.kind=NEW.kind
        AND s.source_json=NEW.source_json AND s.lines_json=NEW.lines_json AND s.occurred_at=NEW.occurred_at AND s.posted_at=NEW.posted_at))
    OR (NEW.kind='earnings' AND NEW.currency='IDR' AND NEW.allocation_state='allocated'
      AND EXISTS(SELECT 1 FROM commerce_earnings_journal_accounting s WHERE s.id=NEW.id AND s.capture_id=NEW.capture_id AND s.order_id=NEW.order_id
        AND s.seller_id=NEW.seller_id AND s.commerce_environment=NEW.commerce_environment
        AND s.source_json=NEW.source_json AND s.lines_json=NEW.lines_json AND s.occurred_at=NEW.occurred_at AND s.posted_at=NEW.posted_at))
    OR (NEW.kind IN ('withdrawal_reserve','withdrawal_cancel') AND NEW.currency='IDR' AND NEW.allocation_state='allocated'
      AND NEW.order_id IS NULL AND NEW.capture_id IS NULL
      AND EXISTS(SELECT 1 FROM commerce_withdrawal_journal_accounting s WHERE s.id=NEW.id
        AND s.seller_id=NEW.seller_id AND s.commerce_environment=NEW.commerce_environment AND s.kind=NEW.kind
        AND s.source_json=NEW.source_json AND s.lines_json=NEW.lines_json AND s.occurred_at=NEW.occurred_at AND s.posted_at=NEW.posted_at))
    OR (NEW.kind IN ('payout','payout_release','payout_correction') AND NEW.currency='IDR' AND NEW.allocation_state='allocated'
      AND NEW.order_id IS NULL AND NEW.capture_id IS NULL
      AND EXISTS(SELECT 1 FROM commerce_payout_journal_accounting s WHERE s.id=NEW.id
        AND s.seller_id=NEW.seller_id AND s.commerce_environment=NEW.commerce_environment AND s.kind=NEW.kind
        AND s.source_json=NEW.source_json AND s.lines_json=NEW.lines_json AND s.occurred_at=NEW.occurred_at AND s.posted_at=NEW.posted_at))
    OR (NEW.kind='refund' AND NEW.currency='IDR' AND NEW.allocation_state='allocated'
      AND EXISTS(SELECT 1 FROM commerce_refund_journal_accounting s WHERE s.id=NEW.id AND s.capture_id=NEW.capture_id AND s.order_id=NEW.order_id
        AND s.seller_id=NEW.seller_id AND s.commerce_environment=NEW.commerce_environment
        AND s.source_json=NEW.source_json AND s.lines_json=NEW.lines_json AND s.occurred_at=NEW.occurred_at AND s.posted_at=NEW.posted_at))
    OR (NEW.kind IN ('treasury_payout','treasury_payout_correction') AND NEW.currency='IDR' AND NEW.allocation_state='allocated'
      AND NEW.order_id IS NULL AND NEW.capture_id IS NULL
      AND EXISTS(SELECT 1 FROM commerce_treasury_journal_accounting s WHERE s.id=NEW.id
        AND s.seller_id=NEW.seller_id AND s.commerce_environment=NEW.commerce_environment AND s.kind=NEW.kind
        AND s.source_json=NEW.source_json AND s.lines_json=NEW.lines_json AND s.occurred_at=NEW.occurred_at AND s.posted_at=NEW.posted_at)));
  SELECT RAISE(ABORT,'financial_unbalanced_journal') WHERE (SELECT SUM(json_extract(value,'$.amount')) FROM json_each(NEW.lines_json))!=0;
  SELECT RAISE(ABORT,'financial_journal_immutable') WHERE EXISTS(SELECT 1 FROM commerce_financial_journals
    WHERE id=NEW.id OR sequence=NEW.sequence OR (NEW.kind='capture' AND capture_id=NEW.capture_id AND kind='capture'));
END;

DROP VIEW commerce_treasury_funds;
DROP VIEW commerce_treasury_fund_inputs;
CREATE VIEW commerce_treasury_fund_inputs AS
SELECT e.id AS platform_enrollment_id,e.commerce_environment,
  COALESCE((SELECT SUM(c.net_commission) FROM commerce_treasury_commissions c WHERE c.platform_enrollment_id=e.id),0) AS net_commission,
  COALESCE((SELECT SUM(c.net_commission) FROM commerce_treasury_commissions c WHERE c.platform_enrollment_id=e.id AND c.current_eligible=1),0) AS eligible_commission,
  COALESCE((SELECT SUM(c.reversed_commission) FROM commerce_treasury_commissions c WHERE c.platform_enrollment_id=e.id),0) AS reversed_commission,
  (SELECT COUNT(*) FROM commerce_treasury_commissions c WHERE c.platform_enrollment_id=e.id AND c.current_eligible=0) AS held_captures,
  (SELECT COUNT(*) FROM commerce_payment_captures c WHERE c.commerce_environment=e.commerce_environment AND c.capture_kind='order_payment'
    AND NOT EXISTS(SELECT 1 FROM commerce_treasury_commissions p WHERE p.capture_id=c.id AND p.platform_enrollment_id IS NOT NULL)) AS unattributed_captures,
  COALESCE((SELECT SUM(c.open_refunds+c.funding_unreconciled) FROM commerce_treasury_commissions c WHERE c.platform_enrollment_id=e.id),0) AS refund_holds,
  COALESCE((SELECT SUM(i.amount) FROM commerce_treasury_intents i WHERE i.platform_enrollment_id=e.id
    AND NOT EXISTS(SELECT 1 FROM commerce_treasury_cancellations x WHERE x.intent_id=i.id)
    AND NOT EXISTS(SELECT 1 FROM commerce_treasury_recognitions x WHERE x.intent_id=i.id)),0) AS reserved_commission,
  COALESCE((SELECT SUM(p.paid_amount) FROM commerce_treasury_positions p WHERE p.platform_enrollment_id=e.id),0) AS paid_commission,
  COALESCE((SELECT SUM(p.fee_amount) FROM commerce_treasury_positions p WHERE p.platform_enrollment_id=e.id),0)
   +COALESCE((SELECT SUM(p.fee_amount) FROM commerce_payout_positions p JOIN commerce_withdrawal_payment_grants g ON g.withdrawal_id=p.withdrawal_id WHERE g.platform_enrollment_id=e.id),0) AS paid_transfer_fees,
  (SELECT COUNT(*) FROM commerce_treasury_positions p WHERE p.platform_enrollment_id=e.id AND p.needs_review=1) AS accounting_holds,
  (SELECT COUNT(*) FROM commerce_financial_journals j WHERE j.commerce_environment=e.commerce_environment
    AND ((SELECT COUNT(*) FROM commerce_financial_entries x WHERE x.journal_sequence=j.sequence)!=json_array_length(j.lines_json)
      OR COALESCE((SELECT SUM(x.amount) FROM commerce_financial_entries x WHERE x.journal_sequence=j.sequence),1)!=0
      OR EXISTS(SELECT 1 FROM json_each(j.lines_json) l LEFT JOIN commerce_financial_entries x
        ON x.journal_sequence=j.sequence AND x.line_number=CAST(l.key AS INTEGER)
        WHERE x.journal_sequence IS NULL OR x.account!=json_extract(l.value,'$.account') OR x.amount!=json_extract(l.value,'$.amount')))) AS incomplete_journals,
  (SELECT json_group_array(json(value)) FROM (SELECT json_object('captureId',c.capture_id,'sellerId',c.seller_id,'orderId',c.order_id,
    'commission',CAST(c.original_commission AS TEXT),'reversed',CAST(c.reversed_commission AS TEXT),
    'settlementId',c.settlement_id,'current',c.history_current,'eligible',c.current_eligible,'refundHolds',c.open_refunds+c.funding_unreconciled) AS value
    FROM commerce_treasury_commissions c WHERE c.platform_enrollment_id=e.id ORDER BY c.capture_id)) AS captures_json
FROM commerce_wallet_enrollments e JOIN commerce_wallet_provider_profiles p ON p.enrollment_id=e.id;

CREATE VIEW commerce_treasury_funds AS
WITH snapshots AS (
  SELECT f.*,json_object('version',2,'platformEnrollmentId',platform_enrollment_id,'captures',json(captures_json),
    'eligibleCommission',CAST(eligible_commission AS TEXT),'reservedCommission',CAST(reserved_commission AS TEXT),'paidCommission',CAST(paid_commission AS TEXT),'paidTransferFees',CAST(paid_transfer_fees AS TEXT),'accountingHolds',accounting_holds,
    'refundHolds',refund_holds,'unattributedCaptures',unattributed_captures,'incompleteJournals',incomplete_journals) AS source_json
  FROM commerce_treasury_fund_inputs f
)
SELECT f.*,CASE WHEN unattributed_captures=0 AND incomplete_journals=0 AND refund_holds=0 AND accounting_holds=0 AND length(source_json)<=200000
  THEN MAX(eligible_commission-reserved_commission-paid_commission-paid_transfer_fees,0) ELSE 0 END AS reservable_commission,
  MAX(reserved_commission+paid_commission+paid_transfer_fees-MAX(eligible_commission,0),0) AS reservation_shortfall,
  CASE WHEN length(source_json)>200000 THEN 1 ELSE 0 END AS source_capacity_exceeded
FROM snapshots f;

CREATE TRIGGER treasury_bank_accounting_fence BEFORE INSERT ON commerce_treasury_bank_grants BEGIN
 SELECT RAISE(ABORT,'treasury_bank_source') WHERE EXISTS(SELECT 1 FROM commerce_treasury_intents i JOIN commerce_treasury_funds f ON f.platform_enrollment_id=i.platform_enrollment_id WHERE i.id=NEW.intent_id AND f.accounting_holds!=0);
END;

-- A later seller payout or settlement cannot reuse already recognized company cash.
CREATE TRIGGER treasury_cash_payout_reference_fence BEFORE INSERT ON commerce_payout_reference_bindings BEGIN
 SELECT RAISE(ABORT,'treasury_cash_reference_conflict') WHERE EXISTS(
  SELECT 1 FROM commerce_treasury_recognitions n JOIN commerce_treasury_outcome_results r ON r.assessment_sequence=n.assessment_sequence
  JOIN commerce_treasury_bank_grants g ON g.intent_id=n.intent_id AND g.stage='payment'
  WHERE g.credential_fingerprint=NEW.credential_fingerprint AND g.commerce_environment=NEW.commerce_environment AND r.provider_reference=NEW.provider_reference);
END;
CREATE TRIGGER treasury_cash_settlement_reference_fence BEFORE INSERT ON commerce_settlement_group_bindings BEGIN
 SELECT RAISE(ABORT,'treasury_cash_reference_conflict') WHERE EXISTS(
  SELECT 1 FROM commerce_treasury_recognitions n JOIN commerce_treasury_outcome_results r ON r.assessment_sequence=n.assessment_sequence
  JOIN commerce_treasury_bank_grants g ON g.intent_id=n.intent_id AND g.stage='payment'
  WHERE g.credential_fingerprint=NEW.credential_fingerprint AND g.commerce_environment=NEW.commerce_environment AND r.provider_reference=NEW.provider_reference);
END;
