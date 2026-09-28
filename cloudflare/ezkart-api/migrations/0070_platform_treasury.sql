-- Commission reservations are a separate treasury subledger, never seller earnings
-- or proof of a bank transfer. No dispatch grant or provider outcome writer exists.
CREATE TABLE commerce_treasury_intents (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE CHECK(length(id)=44 AND substr(id,1,4)='try_' AND substr(id,5) NOT GLOB '*[^a-f0-9]*'),
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  request_key TEXT NOT NULL CHECK(length(request_key)=32 AND request_key NOT GLOB '*[^a-f0-9]*'),
  operator_id TEXT NOT NULL,
  proof_expires_at INTEGER NOT NULL,
  platform_enrollment_id TEXT NOT NULL REFERENCES commerce_wallet_provider_profiles(enrollment_id),
  amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount BETWEEN 1 AND 9007199254740991),
  destination_hash TEXT NOT NULL CHECK(length(destination_hash)=64 AND destination_hash NOT GLOB '*[^a-f0-9]*'),
  destination_json TEXT NOT NULL CHECK(json_valid(destination_json)),
  source_json TEXT NOT NULL CHECK(json_valid(source_json)),
  partner_reference TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  UNIQUE(commerce_environment,request_key)
);
CREATE TABLE commerce_treasury_cancellations (
  intent_id TEXT PRIMARY KEY REFERENCES commerce_treasury_intents(id),
  request_key TEXT NOT NULL CHECK(length(request_key)=32 AND request_key NOT GLOB '*[^a-f0-9]*'),
  operator_id TEXT NOT NULL,
  proof_expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE commerce_treasury_entries (
  intent_id TEXT NOT NULL REFERENCES commerce_treasury_intents(id),
  kind TEXT NOT NULL CHECK(kind IN ('reserve','cancel')),
  account TEXT NOT NULL CHECK(account IN ('commission_unreserved','commission_reserved')),
  amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount!=0 AND amount BETWEEN -9007199254740991 AND 9007199254740991),
  PRIMARY KEY(intent_id,kind,account)
);

-- Never use the mixed platform cash credit as commission. All money comes from
-- original capture allocation; confirmed reversals retain their exact provenance.
CREATE VIEW commerce_treasury_commissions AS
SELECT c.capture_id,c.order_id,c.seller_id,c.commerce_environment,b.platform_enrollment_id,
  json_extract(o.snapshot_json,'$.fees.commissionAmount') AS original_commission,
  COALESCE((SELECT SUM(r.commission_reversal) FROM commerce_refund_finalizations r WHERE r.capture_id=c.capture_id),0) AS reversed_commission,
  json_extract(o.snapshot_json,'$.fees.commissionAmount')-COALESCE((SELECT SUM(r.commission_reversal) FROM commerce_refund_finalizations r WHERE r.capture_id=c.capture_id),0) AS net_commission,
  a.id AS settlement_id,a.sequence AS settlement_sequence,COALESCE(f.current,0) AS history_current,
  r.state AS settlement_state,
  CASE WHEN b.platform_enrollment_id IS NOT NULL AND j.sequence IS NOT NULL AND r.state='settled' AND f.current=1
    AND o.checkout_state='paid' AND o.payment_review=0 AND o.fulfillment_review=0
    AND NOT EXISTS(SELECT 1 FROM commerce_payment_captures x WHERE x.order_id=c.order_id AND x.capture_kind='duplicate_payment')
    AND NOT EXISTS(SELECT 1 FROM commerce_refunds x WHERE x.order_id=c.order_id AND x.state IN ('requested','approved'))
    AND NOT EXISTS(SELECT 1 FROM commerce_refund_disputes d JOIN commerce_refunds x ON x.id=d.refund_id
      WHERE x.order_id=c.order_id AND d.state IN ('open','awaiting_buyer','awaiting_store'))
    AND NOT EXISTS(SELECT 1 FROM commerce_returns x WHERE x.order_id=c.order_id AND x.state NOT IN ('declined','withdrawn'))
    AND NOT EXISTS(SELECT 1 FROM commerce_refund_finalizations x WHERE x.capture_id=c.capture_id)
    THEN 1 ELSE 0 END AS current_eligible,
  (SELECT COUNT(*) FROM commerce_refund_finalizations x WHERE x.capture_id=c.capture_id) AS funding_unreconciled,
  (SELECT COUNT(*) FROM commerce_refunds x WHERE x.order_id=c.order_id AND (x.state IN ('requested','approved')
    OR EXISTS(SELECT 1 FROM commerce_refund_disputes d WHERE d.refund_id=x.id AND d.state IN ('open','awaiting_buyer','awaiting_store')))) AS open_refunds
FROM commerce_capture_accounting c JOIN orders o ON o.id=c.order_id
LEFT JOIN commerce_payment_route_bindings b ON b.order_id=c.order_id AND b.commerce_environment=c.commerce_environment
LEFT JOIN commerce_financial_journals j ON j.capture_id=c.capture_id AND j.kind='capture' AND j.allocation_state='allocated'
LEFT JOIN commerce_settlement_assessments a ON a.sequence=(SELECT MAX(x.sequence) FROM commerce_settlement_assessments x WHERE x.capture_id=c.capture_id)
LEFT JOIN commerce_settlement_results r ON r.assessment_sequence=a.sequence
LEFT JOIN commerce_settlement_source_freshness f ON f.assessment_sequence=a.sequence
WHERE c.allocation_state='allocated';

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
    AND NOT EXISTS(SELECT 1 FROM commerce_treasury_cancellations x WHERE x.intent_id=i.id)),0) AS reserved_commission,
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
  SELECT f.*,json_object('version',1,'platformEnrollmentId',platform_enrollment_id,'captures',json(captures_json),
    'eligibleCommission',CAST(eligible_commission AS TEXT),'reservedCommission',CAST(reserved_commission AS TEXT),
    'refundHolds',refund_holds,'unattributedCaptures',unattributed_captures,'incompleteJournals',incomplete_journals) AS source_json
  FROM commerce_treasury_fund_inputs f
)
SELECT f.*,CASE WHEN unattributed_captures=0 AND incomplete_journals=0 AND refund_holds=0 AND length(source_json)<=200000
  THEN MAX(eligible_commission-reserved_commission,0) ELSE 0 END AS reservable_commission,
  MAX(reserved_commission-MAX(eligible_commission,0),0) AS reservation_shortfall,
  CASE WHEN length(source_json)>200000 THEN 1 ELSE 0 END AS source_capacity_exceeded
FROM snapshots f;

CREATE TRIGGER treasury_intent_source BEFORE INSERT ON commerce_treasury_intents BEGIN
  SELECT RAISE(ABORT,'treasury_immutable') WHERE EXISTS(SELECT 1 FROM commerce_treasury_intents WHERE id=NEW.id OR sequence=NEW.sequence
    OR (commerce_environment=NEW.commerce_environment AND request_key=NEW.request_key));
  SELECT RAISE(ABORT,'treasury_operator_changed') WHERE NOT EXISTS(SELECT 1 FROM commerce_support_staff s
    WHERE s.auth_user_id=NEW.operator_id AND s.commerce_environment=NEW.commerce_environment AND s.role='reviewer');
  SELECT RAISE(ABORT,'treasury_proof_expired') WHERE NEW.proof_expires_at<=unixepoch('now') OR NEW.proof_expires_at>unixepoch('now')+630;
  SELECT RAISE(ABORT,'treasury_reference_invalid') WHERE NEW.created_at!=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    OR NEW.partner_reference!='EZK-TREASURY-'||CASE NEW.commerce_environment WHEN 'sandbox' THEN 'S' ELSE 'P' END||'-'||substr(NEW.id,5);
  SELECT RAISE(ABORT,'treasury_platform_inactive') WHERE NOT EXISTS(SELECT 1 FROM commerce_wallet_enrollments e JOIN sellers s ON s.id=e.seller_id
    WHERE e.id=NEW.platform_enrollment_id AND s.status='active');
  SELECT RAISE(ABORT,'treasury_funds_unavailable') WHERE NOT EXISTS(SELECT 1 FROM commerce_treasury_funds f
    WHERE f.platform_enrollment_id=NEW.platform_enrollment_id AND f.commerce_environment=NEW.commerce_environment
      AND f.reservable_commission>=NEW.amount AND f.source_json=NEW.source_json AND length(f.source_json)<=200000);
END;
CREATE TRIGGER treasury_intent_post AFTER INSERT ON commerce_treasury_intents BEGIN
  INSERT INTO commerce_treasury_entries VALUES(NEW.id,'reserve','commission_unreserved',-NEW.amount);
  INSERT INTO commerce_treasury_entries VALUES(NEW.id,'reserve','commission_reserved',NEW.amount);
END;
CREATE TRIGGER treasury_cancel_source BEFORE INSERT ON commerce_treasury_cancellations BEGIN
  SELECT RAISE(ABORT,'treasury_immutable') WHERE EXISTS(SELECT 1 FROM commerce_treasury_cancellations WHERE intent_id=NEW.intent_id);
  SELECT RAISE(ABORT,'treasury_operator_changed') WHERE NOT EXISTS(SELECT 1 FROM commerce_treasury_intents i JOIN commerce_support_staff s
    ON s.commerce_environment=i.commerce_environment WHERE i.id=NEW.intent_id AND s.auth_user_id=NEW.operator_id AND s.role='reviewer');
  SELECT RAISE(ABORT,'treasury_proof_expired') WHERE NEW.proof_expires_at<=unixepoch('now') OR NEW.proof_expires_at>unixepoch('now')+630;
  SELECT RAISE(ABORT,'treasury_reference_invalid') WHERE NEW.created_at!=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;
CREATE TRIGGER treasury_cancel_post AFTER INSERT ON commerce_treasury_cancellations BEGIN
  INSERT INTO commerce_treasury_entries SELECT id,'cancel','commission_reserved',-amount FROM commerce_treasury_intents WHERE id=NEW.intent_id;
  INSERT INTO commerce_treasury_entries SELECT id,'cancel','commission_unreserved',amount FROM commerce_treasury_intents WHERE id=NEW.intent_id;
END;
CREATE TRIGGER treasury_entry_source BEFORE INSERT ON commerce_treasury_entries BEGIN
  SELECT RAISE(ABORT,'treasury_entry_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_treasury_intents i WHERE i.id=NEW.intent_id
    AND NEW.amount=CASE WHEN (NEW.kind='reserve' AND NEW.account='commission_reserved') OR (NEW.kind='cancel' AND NEW.account='commission_unreserved') THEN i.amount ELSE -i.amount END
    AND (NEW.kind='reserve' OR EXISTS(SELECT 1 FROM commerce_treasury_cancellations c WHERE c.intent_id=i.id)));
END;
CREATE TRIGGER treasury_intents_no_update BEFORE UPDATE ON commerce_treasury_intents BEGIN SELECT RAISE(ABORT,'treasury_immutable'); END;
CREATE TRIGGER treasury_intents_no_delete BEFORE DELETE ON commerce_treasury_intents BEGIN SELECT RAISE(ABORT,'treasury_immutable'); END;
CREATE TRIGGER treasury_cancel_no_update BEFORE UPDATE ON commerce_treasury_cancellations BEGIN SELECT RAISE(ABORT,'treasury_immutable'); END;
CREATE TRIGGER treasury_cancel_no_delete BEFORE DELETE ON commerce_treasury_cancellations BEGIN SELECT RAISE(ABORT,'treasury_immutable'); END;
CREATE TRIGGER treasury_entries_no_update BEFORE UPDATE ON commerce_treasury_entries BEGIN SELECT RAISE(ABORT,'treasury_immutable'); END;
CREATE TRIGGER treasury_entries_no_delete BEFORE DELETE ON commerce_treasury_entries BEGIN SELECT RAISE(ABORT,'treasury_immutable'); END;
