-- Reserve current earnings before any bank operation. This migration cannot
-- dispatch a transfer. Later dispatch must fence cancellation in its transaction.
INSERT INTO commerce_financial_accounts(code,account_class,normal_side)
  VALUES('seller_withdrawal_reserved','liability','credit');

CREATE TABLE commerce_withdrawals (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE CHECK(length(id)=43 AND substr(id,1,3)='wd_' AND substr(id,4) NOT GLOB '*[^a-f0-9]*'),
  seller_id TEXT NOT NULL REFERENCES sellers(id) ON DELETE RESTRICT,
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  request_key TEXT NOT NULL CHECK(length(request_key)=32 AND request_key NOT GLOB '*[^a-f0-9]*'),
  owner_auth_id TEXT NOT NULL,
  proof_expires_at TEXT NOT NULL,
  enrollment_id TEXT NOT NULL REFERENCES commerce_wallet_provider_profiles(enrollment_id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount BETWEEN 250000 AND 9007199254740991),
  bank_code TEXT NOT NULL CHECK(length(bank_code) BETWEEN 4 AND 16 AND bank_code NOT GLOB '*[^A-Z0-9]*'),
  bank_account TEXT NOT NULL CHECK(length(bank_account) BETWEEN 1 AND 22 AND bank_account NOT GLOB '*[^0-9]*'),
  channel TEXT NOT NULL CHECK(channel IN ('BI_FAST','ONLINE')),
  partner_reference TEXT NOT NULL UNIQUE,
  funds_json TEXT NOT NULL CHECK(json_valid(funds_json)),
  created_at TEXT NOT NULL,
  UNIQUE(seller_id,commerce_environment,request_key)
);
CREATE INDEX idx_withdrawals_store ON commerce_withdrawals(seller_id,commerce_environment,sequence DESC);

CREATE TABLE commerce_withdrawal_cancellations (
  withdrawal_id TEXT PRIMARY KEY REFERENCES commerce_withdrawals(id) ON DELETE RESTRICT,
  request_key TEXT NOT NULL CHECK(length(request_key)=32 AND request_key NOT GLOB '*[^a-f0-9]*'),
  owner_auth_id TEXT NOT NULL,
  proof_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Eligibility comes from current source comparisons, never a cached Wallet read.
-- Amounts here are lifetime earnings less outstanding reservations. Completed
-- payouts and confirmed refunds must be integrated before dispatch is enabled.
CREATE VIEW commerce_withdrawal_fund_inputs AS
SELECT w.seller_id,w.commerce_environment,
  COALESCE((SELECT SUM(CASE WHEN p.reconciled=1 THEN p.available_amount ELSE 0 END-MAX(-p.net_amount,0))
    FROM commerce_earnings_positions p WHERE p.seller_id=w.seller_id AND p.commerce_environment=w.commerce_environment),0) AS eligible_amount,
  COALESCE((SELECT SUM(d.amount) FROM commerce_withdrawals d WHERE d.seller_id=w.seller_id AND d.commerce_environment=w.commerce_environment
    AND NOT EXISTS(SELECT 1 FROM commerce_withdrawal_cancellations c WHERE c.withdrawal_id=d.id)),0) AS reserved_amount,
  (SELECT COUNT(*) FROM commerce_payment_captures c WHERE c.seller_id=w.seller_id AND c.commerce_environment=w.commerce_environment
    AND c.capture_kind='order_payment' AND NOT EXISTS(SELECT 1 FROM commerce_earnings_positions p WHERE p.capture_id=c.id)) AS incomplete_captures,
  (SELECT COUNT(*) FROM commerce_financial_journals j WHERE j.seller_id=w.seller_id AND j.commerce_environment=w.commerce_environment
    AND ((SELECT COUNT(*) FROM commerce_financial_entries e WHERE e.journal_sequence=j.sequence)!=json_array_length(j.lines_json)
      OR COALESCE((SELECT SUM(e.amount) FROM commerce_financial_entries e WHERE e.journal_sequence=j.sequence),1)!=0))
  + (SELECT COUNT(*) FROM commerce_withdrawals d WHERE d.seller_id=w.seller_id AND d.commerce_environment=w.commerce_environment
    AND (NOT EXISTS(SELECT 1 FROM commerce_financial_journals j WHERE j.id='financial_withdrawal_reserve_'||d.id)
      OR (EXISTS(SELECT 1 FROM commerce_withdrawal_cancellations c WHERE c.withdrawal_id=d.id)
        AND NOT EXISTS(SELECT 1 FROM commerce_financial_journals j WHERE j.id='financial_withdrawal_cancel_'||d.id)))) AS incomplete_journals,
  COALESCE((SELECT MAX(a.sequence) FROM commerce_earnings_assessments a WHERE a.seller_id=w.seller_id AND a.commerce_environment=w.commerce_environment),0) AS earnings_sequence,
  COALESCE((SELECT MAX(j.sequence) FROM commerce_financial_journals j WHERE j.seller_id=w.seller_id AND j.commerce_environment=w.commerce_environment),0) AS journal_sequence
FROM commerce_wallet_enrollments w;

CREATE VIEW commerce_withdrawal_funds AS
SELECT f.*,
  CASE WHEN incomplete_captures=0 AND incomplete_journals=0 THEN MAX(eligible_amount-reserved_amount,0) ELSE 0 END AS reservable_amount,
  MAX(reserved_amount-MAX(eligible_amount,0),0) AS reservation_shortfall,
  json_object('eligibleAmount',CAST(eligible_amount AS TEXT),'reservedAmount',CAST(reserved_amount AS TEXT),
    'earningsSequence',earnings_sequence,'journalSequence',journal_sequence) AS source_json
FROM commerce_withdrawal_fund_inputs f;

CREATE VIEW commerce_withdrawal_journal_accounting AS
SELECT 'financial_withdrawal_reserve_'||w.id AS id,w.seller_id,w.commerce_environment,'withdrawal_reserve' AS kind,
  json_object('version',1,'withdrawalId',w.id,'amount',CAST(w.amount AS TEXT),'funds',json(w.funds_json)) AS source_json,
  json_array(json_object('account','seller_available','amount',w.amount),
    json_object('account','seller_withdrawal_reserved','amount',-w.amount)) AS lines_json,
  w.created_at AS occurred_at,w.created_at AS posted_at
FROM commerce_withdrawals w
UNION ALL
SELECT 'financial_withdrawal_cancel_'||w.id,w.seller_id,w.commerce_environment,'withdrawal_cancel',
  json_object('version',1,'withdrawalId',w.id,'amount',CAST(w.amount AS TEXT),'cancellationRequestKey',c.request_key),
  json_array(json_object('account','seller_withdrawal_reserved','amount',w.amount),
    json_object('account','seller_available','amount',-w.amount)),c.created_at,c.created_at
FROM commerce_withdrawal_cancellations c JOIN commerce_withdrawals w ON w.id=c.withdrawal_id;

CREATE TRIGGER withdrawal_source BEFORE INSERT ON commerce_withdrawals BEGIN
  SELECT RAISE(ABORT,'withdrawal_immutable') WHERE EXISTS(SELECT 1 FROM commerce_withdrawals WHERE id=NEW.id OR sequence=NEW.sequence
    OR partner_reference=NEW.partner_reference OR (seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment AND request_key=NEW.request_key));
  SELECT RAISE(ABORT,'withdrawal_owner_changed') WHERE NOT EXISTS(SELECT 1 FROM sellers s JOIN seller_memberships m ON m.seller_id=s.id
    WHERE s.id=NEW.seller_id AND s.status='active' AND m.auth_user_id=NEW.owner_auth_id AND m.role='owner');
  SELECT RAISE(ABORT,'withdrawal_proof_expired') WHERE NEW.proof_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    OR NEW.proof_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','+630 seconds');
  SELECT RAISE(ABORT,'withdrawal_wallet_mismatch') WHERE NOT EXISTS(SELECT 1 FROM commerce_wallet_enrollments e
    JOIN commerce_wallet_provider_profiles p ON p.enrollment_id=e.id
    WHERE e.id=NEW.enrollment_id AND e.seller_id=NEW.seller_id AND e.commerce_environment=NEW.commerce_environment AND p.commerce_environment=e.commerce_environment);
  SELECT RAISE(ABORT,'withdrawal_reference_mismatch') WHERE NEW.partner_reference!='EZK-PAYOUT-'
    ||CASE NEW.commerce_environment WHEN 'sandbox' THEN 'S' ELSE 'P' END||'-'||substr(NEW.id,4)
    OR NEW.created_at!=strftime('%Y-%m-%dT%H:%M:%fZ','now');
  SELECT RAISE(ABORT,'withdrawal_funds_unavailable') WHERE NOT EXISTS(SELECT 1 FROM commerce_withdrawal_funds f
    WHERE f.seller_id=NEW.seller_id AND f.commerce_environment=NEW.commerce_environment
      AND f.reservable_amount>=NEW.amount AND f.source_json=NEW.funds_json);
END;
CREATE TRIGGER withdrawal_post AFTER INSERT ON commerce_withdrawals BEGIN
  SELECT RAISE(ABORT,'withdrawal_sequence_invalid') WHERE NEW.sequence<1 OR EXISTS(SELECT 1 FROM commerce_withdrawals WHERE sequence>NEW.sequence);
  INSERT INTO commerce_financial_journals(id,seller_id,commerce_environment,currency,kind,allocation_state,source_json,lines_json,occurred_at,posted_at)
    SELECT id,seller_id,commerce_environment,'IDR',kind,'allocated',source_json,lines_json,occurred_at,posted_at
    FROM commerce_withdrawal_journal_accounting WHERE id='financial_withdrawal_reserve_'||NEW.id;
END;

CREATE TRIGGER withdrawal_cancellation_source BEFORE INSERT ON commerce_withdrawal_cancellations BEGIN
  SELECT RAISE(ABORT,'withdrawal_cancellation_immutable') WHERE EXISTS(SELECT 1 FROM commerce_withdrawal_cancellations WHERE withdrawal_id=NEW.withdrawal_id);
  SELECT RAISE(ABORT,'withdrawal_owner_changed') WHERE NOT EXISTS(SELECT 1 FROM commerce_withdrawals w
    JOIN sellers s ON s.id=w.seller_id JOIN seller_memberships m ON m.seller_id=s.id
    WHERE w.id=NEW.withdrawal_id AND s.status='active' AND m.auth_user_id=NEW.owner_auth_id AND m.role='owner');
  SELECT RAISE(ABORT,'withdrawal_proof_expired') WHERE NEW.proof_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    OR NEW.proof_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','+630 seconds');
  SELECT RAISE(ABORT,'withdrawal_cancellation_invalid') WHERE NEW.created_at!=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    OR NOT EXISTS(SELECT 1 FROM commerce_financial_journals WHERE id='financial_withdrawal_reserve_'||NEW.withdrawal_id);
END;
CREATE TRIGGER withdrawal_cancellation_post AFTER INSERT ON commerce_withdrawal_cancellations BEGIN
  INSERT INTO commerce_financial_journals(id,seller_id,commerce_environment,currency,kind,allocation_state,source_json,lines_json,occurred_at,posted_at)
    SELECT id,seller_id,commerce_environment,'IDR',kind,'allocated',source_json,lines_json,occurred_at,posted_at
    FROM commerce_withdrawal_journal_accounting WHERE id='financial_withdrawal_cancel_'||NEW.withdrawal_id;
END;
CREATE TRIGGER withdrawals_no_update BEFORE UPDATE ON commerce_withdrawals BEGIN SELECT RAISE(ABORT,'withdrawal_immutable'); END;
CREATE TRIGGER withdrawals_no_delete BEFORE DELETE ON commerce_withdrawals BEGIN SELECT RAISE(ABORT,'withdrawal_immutable'); END;
CREATE TRIGGER withdrawal_cancellations_no_update BEFORE UPDATE ON commerce_withdrawal_cancellations BEGIN SELECT RAISE(ABORT,'withdrawal_cancellation_immutable'); END;
CREATE TRIGGER withdrawal_cancellations_no_delete BEFORE DELETE ON commerce_withdrawal_cancellations BEGIN SELECT RAISE(ABORT,'withdrawal_cancellation_immutable'); END;

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
        AND s.source_json=NEW.source_json AND s.lines_json=NEW.lines_json AND s.occurred_at=NEW.occurred_at AND s.posted_at=NEW.posted_at)));
  SELECT RAISE(ABORT,'financial_unbalanced_journal') WHERE (SELECT SUM(json_extract(value,'$.amount')) FROM json_each(NEW.lines_json))!=0;
  SELECT RAISE(ABORT,'financial_journal_immutable') WHERE EXISTS(SELECT 1 FROM commerce_financial_journals
    WHERE id=NEW.id OR sequence=NEW.sequence OR (NEW.kind='capture' AND capture_id=NEW.capture_id AND kind='capture'));
END;
