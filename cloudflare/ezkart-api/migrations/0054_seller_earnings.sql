-- Reclassify original seller liabilities only. No provider transfer, refund,
-- shipping allocation or platform fee is created by earnings recognition.
INSERT INTO commerce_financial_accounts(code,account_class,normal_side) VALUES
  ('seller_available','liability','credit'),('seller_reserved','liability','credit');

CREATE TABLE commerce_earnings_assessments (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE CHECK(length(id)=45 AND substr(id,1,5)='earn_' AND substr(id,6) NOT GLOB '*[^a-f0-9]*'),
  version INTEGER NOT NULL CHECK(version=1),
  seller_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  capture_id TEXT NOT NULL REFERENCES commerce_payment_captures(id) ON DELETE RESTRICT,
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  previous_id TEXT REFERENCES commerce_earnings_assessments(id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK(state IN ('pending','available','reserved')),
  net_amount INTEGER NOT NULL CHECK(typeof(net_amount)='integer' AND net_amount BETWEEN -100000000000 AND 100000000000),
  available_amount INTEGER NOT NULL CHECK(typeof(available_amount)='integer' AND available_amount BETWEEN 0 AND 100000000000),
  reserved_amount INTEGER NOT NULL CHECK(typeof(reserved_amount)='integer' AND reserved_amount BETWEEN 0 AND 100000000000),
  source_json TEXT NOT NULL CHECK(json_valid(source_json)),
  recorded_at TEXT NOT NULL,
  CHECK(available_amount+reserved_amount<=MAX(net_amount,0)),
  CHECK((state='pending' AND available_amount=0 AND reserved_amount=0)
    OR (state='available' AND available_amount=MAX(net_amount,0) AND reserved_amount=0)
    OR (state='reserved' AND available_amount=0 AND reserved_amount=MAX(net_amount,0))),
  FOREIGN KEY(seller_id,order_id) REFERENCES orders(seller_id,id) ON DELETE RESTRICT
);
CREATE INDEX idx_earnings_capture ON commerce_earnings_assessments(capture_id,sequence DESC);
CREATE INDEX idx_earnings_seller ON commerce_earnings_assessments(seller_id,commerce_environment,sequence DESC);

CREATE VIEW commerce_earnings_inputs AS
SELECT c.capture_id,c.seller_id,c.order_id,c.commerce_environment,
  o.subtotal_amount-json_extract(o.snapshot_json,'$.fees.commissionAmount')-1250 AS original_seller_amount,
  o.checkout_state,o.fulfillment_state,o.payment_review,o.fulfillment_review,
  d.id AS delivery_id,d.confirmed_at AS delivered_at,
  a.id AS settlement_id,r.state AS settlement_state,r.reason AS settlement_reason,f.current AS history_current,
  pr.id AS recognition_id,rr.state AS recognition_state,COALESCE(rr.fee_amount,0) AS actual_fee,
  (SELECT COUNT(*) FROM commerce_payment_captures x WHERE x.order_id=o.id AND x.capture_kind='duplicate_payment') AS additional_captures,
  (SELECT json_group_array(json(value)) FROM (SELECT json_object('id',x.id,'revision',x.revision,'state',x.state,'amount',CAST(x.amount AS TEXT)) AS value
    FROM commerce_refunds x WHERE x.order_id=o.id AND x.state IN ('requested','approved') ORDER BY x.id)) AS refunds_json,
  (SELECT json_group_array(json(value)) FROM (SELECT json_object('id',x.id,'revision',x.revision,'state',x.state) AS value
    FROM commerce_returns x WHERE x.order_id=o.id AND x.state NOT IN ('declined','withdrawn') ORDER BY x.id)) AS returns_json,
  (SELECT json_group_array(json(value)) FROM (SELECT json_object('id',x.id,'kind',x.kind,'state',x.state) AS value
    FROM commerce_jobs x WHERE x.order_id=o.id AND (x.kind LIKE 'shipment.%' OR x.kind='payment.create')
      AND (x.state IN ('uncertain','dead') OR (x.kind='shipment.cancel' AND x.state IN ('queued','running','retry'))) ORDER BY x.id)) AS jobs_json
FROM commerce_capture_accounting c JOIN orders o ON o.id=c.order_id AND o.seller_id=c.seller_id
JOIN commerce_financial_journals j ON j.capture_id=c.capture_id AND j.kind='capture' AND j.allocation_state='allocated'
LEFT JOIN commerce_order_delivery_receipts d ON d.capture_id=c.capture_id
LEFT JOIN commerce_settlement_assessments a ON a.sequence=(SELECT MAX(x.sequence) FROM commerce_settlement_assessments x WHERE x.capture_id=c.capture_id)
LEFT JOIN commerce_settlement_results r ON r.assessment_sequence=a.sequence
LEFT JOIN commerce_settlement_source_freshness f ON f.assessment_sequence=a.sequence
LEFT JOIN commerce_settlement_assessments pr ON pr.sequence=(SELECT x.sequence FROM commerce_settlement_assessments x
  JOIN commerce_settlement_results y ON y.assessment_sequence=x.sequence AND y.state IN ('settled','voided')
  WHERE x.capture_id=c.capture_id ORDER BY x.sequence DESC LIMIT 1)
LEFT JOIN commerce_settlement_results rr ON rr.assessment_sequence=pr.sequence
WHERE c.allocation_state='allocated' AND c.gross_amount BETWEEN 1 AND 100000000000;

CREATE VIEW commerce_earnings_evidence AS
SELECT i.*,original_seller_amount-actual_fee AS net_amount,
  (SELECT json_group_array(value) FROM json_each(json_array(
    CASE WHEN checkout_state!='paid' THEN 'payment_state_requires_review' END,
    CASE WHEN payment_review!=0 OR additional_captures!=0 THEN 'payment_review' END,
    CASE WHEN fulfillment_review!=0 THEN 'fulfillment_review' END,
    CASE WHEN fulfillment_state='stock_review' THEN 'stock_review' END,
    CASE WHEN fulfillment_state IN ('return_in_transit','returned','disposed') THEN 'courier_return' END,
    CASE WHEN json_array_length(jobs_json)>0 THEN 'provider_job_unresolved' END,
    CASE WHEN json_array_length(refunds_json)>0 THEN 'refund_requires_reconciliation' END,
    CASE WHEN json_array_length(returns_json)>0 THEN 'return_requires_reconciliation' END,
    CASE WHEN delivery_id IS NULL THEN 'delivery_unconfirmed' END,
    CASE WHEN settlement_id IS NULL THEN 'settlement_unobserved' WHEN settlement_state!='settled' THEN settlement_reason END,
    CASE WHEN settlement_id IS NOT NULL AND COALESCE(history_current,0)!=1 THEN 'provider_history_changed' END,
    CASE WHEN original_seller_amount-actual_fee<0 THEN 'negative_seller_allocation' END
  )) WHERE value IS NOT NULL) AS holds_json
FROM commerce_earnings_inputs i;

CREATE VIEW commerce_earnings_targets AS
SELECT e.*,CASE WHEN json_array_length(holds_json)=0 THEN 'available'
  WHEN delivery_id IS NOT NULL AND recognition_state='settled' THEN 'reserved' ELSE 'pending' END AS state
FROM commerce_earnings_evidence e;

CREATE VIEW commerce_earnings_current AS
SELECT t.capture_id,t.seller_id,t.order_id,t.commerce_environment,t.state,t.net_amount,t.holds_json,
  CASE WHEN t.state='available' THEN MAX(t.net_amount,0) ELSE 0 END AS available_amount,
  CASE WHEN t.state='reserved' THEN MAX(t.net_amount,0) ELSE 0 END AS reserved_amount,
  json_object('version',1,'captureId',capture_id,'orderId',order_id,'originalSellerAmount',CAST(original_seller_amount AS TEXT),
    'recognizedProcessingFee',CASE WHEN recognition_id IS NOT NULL THEN CAST(actual_fee AS TEXT) ELSE NULL END,
    'recognitionId',recognition_id,'recognitionState',recognition_state,'settlementId',settlement_id,'settlementState',settlement_state,
    'historyCurrent',COALESCE(history_current,0),'deliveryReceiptId',delivery_id,'deliveryConfirmedAt',delivered_at,
    'checkoutState',checkout_state,'fulfillmentState',fulfillment_state,'paymentReview',payment_review,'fulfillmentReview',fulfillment_review,
    'additionalCaptures',additional_captures,'refunds',json(refunds_json),'returns',json(returns_json),'providerJobs',json(jobs_json),'holds',json(holds_json)) AS source_json
FROM commerce_earnings_targets t;

-- This comparison is also required at the point of any future reservation.
-- A saved available balance never overrides newer provider or domain evidence.
CREATE VIEW commerce_earnings_positions AS
SELECT c.*,a.id AS assessment_id,a.sequence AS assessment_sequence,a.recorded_at,
  COALESCE(a.available_amount,0) AS recorded_available,COALESCE(a.reserved_amount,0) AS recorded_reserved,
  c.source_json IS a.source_json AND c.net_amount IS a.net_amount AND c.state IS a.state
    AND c.available_amount IS a.available_amount AND c.reserved_amount IS a.reserved_amount AS reconciled
FROM commerce_earnings_current c LEFT JOIN commerce_earnings_assessments a
  ON a.sequence=(SELECT MAX(x.sequence) FROM commerce_earnings_assessments x WHERE x.capture_id=c.capture_id);

CREATE VIEW commerce_earnings_journal_accounting AS
SELECT a.sequence AS assessment_sequence,'financial_earnings_'||a.id AS id,a.seller_id,a.order_id,a.capture_id,a.commerce_environment,
  'earnings' AS kind,json_object('assessmentId',a.id,'previousAssessmentId',a.previous_id,'evidence',json(a.source_json)) AS source_json,
  (SELECT json_group_array(json(value)) FROM json_each(json_array(
    json_object('account','seller_pending','amount',a.available_amount+a.reserved_amount-COALESCE(p.available_amount+p.reserved_amount,0)),
    json_object('account','seller_available','amount',-a.available_amount+COALESCE(p.available_amount,0)),
    json_object('account','seller_reserved','amount',-a.reserved_amount+COALESCE(p.reserved_amount,0))
  )) WHERE json_extract(value,'$.amount')!=0) AS lines_json,
  a.recorded_at AS occurred_at,a.recorded_at AS posted_at
FROM commerce_earnings_assessments a LEFT JOIN commerce_earnings_assessments p ON p.id=a.previous_id
WHERE a.available_amount!=COALESCE(p.available_amount,0) OR a.reserved_amount!=COALESCE(p.reserved_amount,0);

CREATE TRIGGER earnings_assessment_source BEFORE INSERT ON commerce_earnings_assessments BEGIN
  SELECT RAISE(ABORT,'earnings_immutable') WHERE EXISTS(SELECT 1 FROM commerce_earnings_assessments WHERE id=NEW.id OR sequence=NEW.sequence);
  SELECT RAISE(ABORT,'earnings_source_mismatch') WHERE NOT EXISTS(SELECT 1 FROM commerce_earnings_positions c
    WHERE c.capture_id=NEW.capture_id AND c.seller_id=NEW.seller_id AND c.order_id=NEW.order_id AND c.commerce_environment=NEW.commerce_environment
      AND c.reconciled=0 AND c.assessment_id IS NEW.previous_id AND c.state=NEW.state AND c.net_amount=NEW.net_amount
      AND c.available_amount=NEW.available_amount AND c.reserved_amount=NEW.reserved_amount AND c.source_json=NEW.source_json)
    OR NEW.recorded_at!=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;
CREATE TRIGGER earnings_assessment_post AFTER INSERT ON commerce_earnings_assessments BEGIN
  SELECT RAISE(ABORT,'earnings_sequence_invalid') WHERE NEW.sequence<1 OR EXISTS(SELECT 1 FROM commerce_earnings_assessments WHERE sequence>NEW.sequence);
  INSERT INTO commerce_financial_journals(id,seller_id,order_id,capture_id,commerce_environment,currency,kind,allocation_state,source_json,lines_json,occurred_at,posted_at)
    SELECT id,seller_id,order_id,capture_id,commerce_environment,'IDR',kind,'allocated',source_json,lines_json,occurred_at,posted_at
    FROM commerce_earnings_journal_accounting WHERE assessment_sequence=NEW.sequence;
END;
CREATE TRIGGER earnings_assessments_no_update BEFORE UPDATE ON commerce_earnings_assessments BEGIN SELECT RAISE(ABORT,'earnings_immutable'); END;
CREATE TRIGGER earnings_assessments_no_delete BEFORE DELETE ON commerce_earnings_assessments BEGIN SELECT RAISE(ABORT,'earnings_immutable'); END;

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
        AND s.source_json=NEW.source_json AND s.lines_json=NEW.lines_json AND s.occurred_at=NEW.occurred_at AND s.posted_at=NEW.posted_at)));
  SELECT RAISE(ABORT,'financial_unbalanced_journal') WHERE (SELECT SUM(json_extract(value,'$.amount')) FROM json_each(NEW.lines_json))!=0;
  SELECT RAISE(ABORT,'financial_journal_immutable') WHERE EXISTS(SELECT 1 FROM commerce_financial_journals
    WHERE id=NEW.id OR sequence=NEW.sequence OR (NEW.kind='capture' AND capture_id=NEW.capture_id AND kind='capture'));
END;

-- Single-order changes update earnings within their original transaction.
-- Shared-wallet history reads use current-evidence guards immediately and
-- bounded reconciliation, avoiding unbounded fan-out in a provider observation.
CREATE TRIGGER earnings_after_capture AFTER INSERT ON commerce_financial_journals
WHEN NEW.kind='capture' BEGIN
  INSERT INTO commerce_earnings_assessments(id,version,seller_id,order_id,capture_id,commerce_environment,previous_id,state,net_amount,available_amount,reserved_amount,source_json,recorded_at)
    SELECT 'earn_'||lower(hex(randomblob(20))),1,seller_id,order_id,capture_id,commerce_environment,assessment_id,state,net_amount,available_amount,reserved_amount,source_json,strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM commerce_earnings_positions WHERE reconciled=0 AND order_id=NEW.order_id;
END;
CREATE TRIGGER earnings_after_settlement AFTER INSERT ON commerce_settlement_results
BEGIN
  INSERT INTO commerce_earnings_assessments(id,version,seller_id,order_id,capture_id,commerce_environment,previous_id,state,net_amount,available_amount,reserved_amount,source_json,recorded_at)
    SELECT 'earn_'||lower(hex(randomblob(20))),1,seller_id,order_id,capture_id,commerce_environment,assessment_id,state,net_amount,available_amount,reserved_amount,source_json,strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM commerce_earnings_positions WHERE reconciled=0 AND order_id=(SELECT order_id FROM commerce_settlement_assessments WHERE sequence=NEW.assessment_sequence);
END;
CREATE TRIGGER earnings_after_delivery AFTER INSERT ON commerce_order_delivery_receipts
BEGIN
  INSERT INTO commerce_earnings_assessments(id,version,seller_id,order_id,capture_id,commerce_environment,previous_id,state,net_amount,available_amount,reserved_amount,source_json,recorded_at)
    SELECT 'earn_'||lower(hex(randomblob(20))),1,seller_id,order_id,capture_id,commerce_environment,assessment_id,state,net_amount,available_amount,reserved_amount,source_json,strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM commerce_earnings_positions WHERE reconciled=0 AND order_id=NEW.order_id;
END;
CREATE TRIGGER earnings_after_order AFTER UPDATE OF checkout_state,fulfillment_state,payment_review,fulfillment_review ON orders
WHEN NEW.commerce_version=1 BEGIN
  INSERT INTO commerce_earnings_assessments(id,version,seller_id,order_id,capture_id,commerce_environment,previous_id,state,net_amount,available_amount,reserved_amount,source_json,recorded_at)
    SELECT 'earn_'||lower(hex(randomblob(20))),1,seller_id,order_id,capture_id,commerce_environment,assessment_id,state,net_amount,available_amount,reserved_amount,source_json,strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM commerce_earnings_positions WHERE reconciled=0 AND order_id=NEW.id;
END;
CREATE TRIGGER earnings_after_refund_open AFTER INSERT ON commerce_refunds
BEGIN
  INSERT INTO commerce_earnings_assessments(id,version,seller_id,order_id,capture_id,commerce_environment,previous_id,state,net_amount,available_amount,reserved_amount,source_json,recorded_at)
    SELECT 'earn_'||lower(hex(randomblob(20))),1,seller_id,order_id,capture_id,commerce_environment,assessment_id,state,net_amount,available_amount,reserved_amount,source_json,strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM commerce_earnings_positions WHERE reconciled=0 AND order_id=NEW.order_id;
END;
CREATE TRIGGER earnings_after_refund_change AFTER UPDATE OF state ON commerce_refunds
BEGIN
  INSERT INTO commerce_earnings_assessments(id,version,seller_id,order_id,capture_id,commerce_environment,previous_id,state,net_amount,available_amount,reserved_amount,source_json,recorded_at)
    SELECT 'earn_'||lower(hex(randomblob(20))),1,seller_id,order_id,capture_id,commerce_environment,assessment_id,state,net_amount,available_amount,reserved_amount,source_json,strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM commerce_earnings_positions WHERE reconciled=0 AND order_id=NEW.order_id;
END;
CREATE TRIGGER earnings_after_return_open AFTER INSERT ON commerce_returns
BEGIN
  INSERT INTO commerce_earnings_assessments(id,version,seller_id,order_id,capture_id,commerce_environment,previous_id,state,net_amount,available_amount,reserved_amount,source_json,recorded_at)
    SELECT 'earn_'||lower(hex(randomblob(20))),1,seller_id,order_id,capture_id,commerce_environment,assessment_id,state,net_amount,available_amount,reserved_amount,source_json,strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM commerce_earnings_positions WHERE reconciled=0 AND order_id=NEW.order_id;
END;
CREATE TRIGGER earnings_after_return_change AFTER UPDATE OF state,revision ON commerce_returns
BEGIN
  INSERT INTO commerce_earnings_assessments(id,version,seller_id,order_id,capture_id,commerce_environment,previous_id,state,net_amount,available_amount,reserved_amount,source_json,recorded_at)
    SELECT 'earn_'||lower(hex(randomblob(20))),1,seller_id,order_id,capture_id,commerce_environment,assessment_id,state,net_amount,available_amount,reserved_amount,source_json,strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM commerce_earnings_positions WHERE reconciled=0 AND order_id=NEW.order_id;
END;
CREATE TRIGGER earnings_after_job_open AFTER INSERT ON commerce_jobs
WHEN NEW.order_id IS NOT NULL AND (NEW.kind='payment.create' OR NEW.kind LIKE 'shipment.%') BEGIN
  INSERT INTO commerce_earnings_assessments(id,version,seller_id,order_id,capture_id,commerce_environment,previous_id,state,net_amount,available_amount,reserved_amount,source_json,recorded_at)
    SELECT 'earn_'||lower(hex(randomblob(20))),1,seller_id,order_id,capture_id,commerce_environment,assessment_id,state,net_amount,available_amount,reserved_amount,source_json,strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM commerce_earnings_positions WHERE reconciled=0 AND order_id=NEW.order_id;
END;
CREATE TRIGGER earnings_after_job_change AFTER UPDATE OF state ON commerce_jobs
WHEN NEW.order_id IS NOT NULL AND (NEW.kind='payment.create' OR NEW.kind LIKE 'shipment.%') BEGIN
  INSERT INTO commerce_earnings_assessments(id,version,seller_id,order_id,capture_id,commerce_environment,previous_id,state,net_amount,available_amount,reserved_amount,source_json,recorded_at)
    SELECT 'earn_'||lower(hex(randomblob(20))),1,seller_id,order_id,capture_id,commerce_environment,assessment_id,state,net_amount,available_amount,reserved_amount,source_json,strftime('%Y-%m-%dT%H:%M:%fZ','now')
    FROM commerce_earnings_positions WHERE reconciled=0 AND order_id=NEW.order_id;
END;
