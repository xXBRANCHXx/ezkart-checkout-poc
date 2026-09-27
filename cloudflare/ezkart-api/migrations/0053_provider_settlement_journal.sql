-- Recognize only conserved, originally routed provider evidence. Withdrawals and
-- delivery release are separate. Later observations never rewrite old journals.
INSERT INTO commerce_financial_accounts(code,account_class,normal_side) VALUES
  ('provider_cash_seller','asset','debit'),('provider_cash_platform','asset','debit');
CREATE INDEX idx_provider_history_account ON commerce_provider_financial_observations(enrollment_id,json_extract(normalized_json,'$.accountNo'),sequence)
  WHERE operation='transaction-history-list';
CREATE INDEX idx_provider_transaction_reference ON commerce_provider_transaction_observations(provider_reference,observation_sequence);
CREATE INDEX idx_provider_transaction_partner ON commerce_provider_transaction_observations(partner_reference,observation_sequence);

CREATE VIEW commerce_provider_collection_windows AS
SELECT m.collection_sequence,c.enrollment_id,m.account_type,json_extract(o.normalized_json,'$.accountNo') AS account_number,
  MIN(json_extract(o.normalized_json,'$.from')) AS from_at,MAX(json_extract(o.normalized_json,'$.to')) AS to_at,
  MAX(o.sequence) AS last_page_sequence,MAX(json_extract(o.normalized_json,'$.exhausted')) AS exhausted
FROM commerce_provider_collection_observations m JOIN commerce_provider_financial_collections c ON c.sequence=m.collection_sequence
  JOIN commerce_provider_financial_observations o ON o.sequence=m.observation_sequence
WHERE m.role='history_page' GROUP BY m.collection_sequence,m.account_type;

CREATE TABLE commerce_settlement_assessments (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE CHECK(length(id)=45 AND substr(id,1,5)='stlm_' AND substr(id,6) NOT GLOB '*[^a-f0-9]*'),
  version INTEGER NOT NULL CHECK(version=1),
  seller_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  capture_id TEXT NOT NULL REFERENCES commerce_payment_captures(id) ON DELETE RESTRICT,
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  seller_collection_sequence INTEGER NOT NULL REFERENCES commerce_provider_financial_collections(sequence) ON DELETE RESTRICT,
  platform_collection_sequence INTEGER NOT NULL REFERENCES commerce_provider_financial_collections(sequence) ON DELETE RESTRICT,
  previous_id TEXT REFERENCES commerce_settlement_assessments(id) ON DELETE RESTRICT,
  recorded_at TEXT NOT NULL,
  UNIQUE(capture_id,seller_collection_sequence,platform_collection_sequence,version),
  FOREIGN KEY(seller_id,order_id) REFERENCES orders(seller_id,id) ON DELETE RESTRICT
);
CREATE INDEX idx_settlement_assessments_capture ON commerce_settlement_assessments(capture_id,sequence DESC);
CREATE INDEX idx_settlement_assessments_seller ON commerce_settlement_assessments(seller_id,commerce_environment,sequence DESC);

CREATE TABLE commerce_settlement_results (
  assessment_sequence INTEGER PRIMARY KEY REFERENCES commerce_settlement_assessments(sequence) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK(state IN ('settled','voided','unresolved')),
  reason TEXT NOT NULL,
  provider_reference TEXT,
  fee_amount INTEGER NOT NULL CHECK(typeof(fee_amount)='integer' AND fee_amount BETWEEN 0 AND 100000000000),
  seller_cash_amount INTEGER NOT NULL CHECK(typeof(seller_cash_amount)='integer' AND seller_cash_amount BETWEEN 0 AND 100000000000),
  platform_cash_amount INTEGER NOT NULL CHECK(typeof(platform_cash_amount)='integer' AND platform_cash_amount BETWEEN 0 AND 100000000000),
  provider_at TEXT,
  observed_at TEXT NOT NULL,
  source_json TEXT NOT NULL CHECK(json_valid(source_json)),
  CHECK(state='settled' OR (fee_amount=0 AND seller_cash_amount=0 AND platform_cash_amount=0))
);
CREATE TABLE commerce_settlement_group_bindings (
  credential_fingerprint TEXT NOT NULL,
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  provider_reference TEXT NOT NULL,
  capture_id TEXT NOT NULL UNIQUE REFERENCES commerce_payment_captures(id) ON DELETE RESTRICT,
  assessment_sequence INTEGER NOT NULL UNIQUE REFERENCES commerce_settlement_results(assessment_sequence) ON DELETE RESTRICT,
  PRIMARY KEY(credential_fingerprint,commerce_environment,provider_reference)
);

-- Original capture, fee policy, split and account mappings are all immutable.
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
JOIN commerce_snap_payment_bindings sn ON sn.order_id=o.id AND sn.credential_fingerprint=b.credential_fingerprint
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

CREATE VIEW commerce_settlement_observed_rows AS
SELECT s.sequence AS assessment_sequence,s.order_id,t.*,
  CASE WHEN m.collection_sequence=s.seller_collection_sequence THEN
    CASE WHEN t.account_number=s.seller_cash THEN 'seller_cash' ELSE 'seller_pending' END
  ELSE CASE WHEN t.account_number=s.platform_cash THEN 'platform_cash' ELSE 'platform_pending' END END AS pocket
FROM commerce_settlement_scopes s JOIN commerce_provider_collection_observations m
  ON m.collection_sequence IN (s.seller_collection_sequence,s.platform_collection_sequence) AND m.role='history_page'
JOIN commerce_provider_transaction_observations t ON t.observation_sequence=m.observation_sequence;

CREATE VIEW commerce_settlement_group_anchors AS
SELECT assessment_sequence,MIN(provider_reference) AS provider_reference,COUNT(DISTINCT provider_reference) AS groups_found
FROM commerce_settlement_observed_rows
WHERE pocket='seller_pending' AND transaction_type='PAYMENT' AND mutation_type='CREDIT' AND partner_reference=order_id
GROUP BY assessment_sequence;

CREATE VIEW commerce_settlement_group_rows AS
SELECT t.*,
  CASE WHEN t.pocket='seller_pending' AND t.transaction_type='PAYMENT' AND t.mutation_type='CREDIT' THEN 'payment'
    WHEN t.pocket='seller_pending' AND t.transaction_type='SETTLEMENT_FEE' AND t.mutation_type='DEBIT' THEN 'fee'
    WHEN t.pocket='seller_cash' AND t.transaction_type='SPLIT_TRANSACTION' AND t.mutation_type='CREDIT' THEN 'seller_credit'
    WHEN t.pocket='platform_cash' AND t.transaction_type='SPLIT_TRANSACTION' AND t.mutation_type='CREDIT' THEN 'platform_credit'
    WHEN t.pocket='seller_pending' AND t.transaction_type IN ('SETTLEMENT','SPLIT_TRANSACTION') AND t.mutation_type='DEBIT' THEN 'pending_outflow'
    ELSE 'unsupported' END AS leg
FROM commerce_settlement_observed_rows t JOIN commerce_settlement_group_anchors g ON g.assessment_sequence=t.assessment_sequence AND g.provider_reference=t.provider_reference;

-- Counts and MIN/MAX retain duplicate legs without summing unbounded amounts.
CREATE VIEW commerce_settlement_group_totals AS
SELECT s.*,g.provider_reference,COALESCE(g.groups_found,0) AS groups_found,COUNT(t.observation_sequence) AS row_count,
  COALESCE(SUM(t.leg='payment'),0) AS payments,COALESCE(SUM(t.leg='fee'),0) AS fees,
  COALESCE(SUM(t.leg='seller_credit'),0) AS seller_credits,COALESCE(SUM(t.leg='platform_credit'),0) AS platform_credits,
  COALESCE(SUM(t.leg='pending_outflow'),0) AS pending_outflows,COALESCE(SUM(t.leg='unsupported'),0) AS unsupported,
  COALESCE(SUM(t.provider_status='SUCCESS'),0) AS successes,COALESCE(SUM(t.provider_status='VOID'),0) AS voids,
  COALESCE(SUM(t.partner_reference IS NOT NULL AND t.partner_reference!='' AND t.partner_reference!=s.order_id),0) AS foreign_references,
  COALESCE(SUM(CAST(t.amount AS INTEGER)>s.gross_amount),0) AS oversized,
  MAX(CASE WHEN t.leg='payment' THEN CAST(t.amount AS INTEGER) END) AS payment_amount,
  MAX(CASE WHEN t.leg='fee' THEN CAST(t.amount AS INTEGER) END) AS observed_fee,
  MAX(CASE WHEN t.leg='seller_credit' THEN CAST(t.amount AS INTEGER) END) AS observed_seller_credit,
  MAX(CASE WHEN t.leg='platform_credit' THEN CAST(t.amount AS INTEGER) END) AS observed_platform_credit,
  MIN(CASE WHEN t.leg='pending_outflow' THEN CAST(t.amount AS INTEGER) END) AS minimum_outflow,
  MAX(CASE WHEN t.leg='pending_outflow' THEN CAST(t.amount AS INTEGER) END) AS maximum_outflow,
  MAX(CASE WHEN t.leg='payment' THEN t.occurred_at END) AS payment_at,
  MAX(CASE WHEN t.leg IN ('seller_credit','platform_credit') THEN t.occurred_at END) AS provider_at
FROM commerce_settlement_scopes s LEFT JOIN commerce_settlement_group_anchors g ON g.assessment_sequence=s.sequence
LEFT JOIN commerce_settlement_group_rows t ON t.assessment_sequence=s.sequence GROUP BY s.sequence;

CREATE VIEW commerce_settlement_classifications_v1 AS
SELECT t.*,CASE
  WHEN groups_found=0 THEN 'payment_not_observed'
  WHEN groups_found!=1 THEN 'payment_group_ambiguous'
  WHEN foreign_references!=0 THEN 'provider_reference_mismatch'
  WHEN unsupported!=0 THEN 'unsupported_provider_rows'
  WHEN payments!=1 OR fees!=1 OR seller_credits!=1 OR platform_credits!=1 THEN 'incomplete_or_duplicate_legs'
  WHEN oversized!=0 OR payment_amount!=gross_amount THEN 'provider_amount_mismatch'
  WHEN gross_amount-observed_fee-platform_amount<0 THEN 'negative_seller_allocation'
  WHEN observed_seller_credit!=gross_amount-observed_fee-platform_amount OR observed_platform_credit!=platform_amount THEN 'allocation_mismatch'
  WHEN pending_outflows>2 OR (pending_outflows=1 AND minimum_outflow!=gross_amount-observed_fee)
    OR (pending_outflows=2 AND (minimum_outflow!=MIN(observed_seller_credit,observed_platform_credit)
      OR maximum_outflow!=MAX(observed_seller_credit,observed_platform_credit))) THEN 'pending_outflow_mismatch'
  WHEN payment_at<strftime('%Y-%m-%dT%H:%M:%f000Z',order_created_at) THEN 'payment_date_mismatch'
  WHEN successes=row_count THEN 'settled'
  WHEN voids=row_count THEN 'voided'
  ELSE 'provider_status_unresolved' END AS classification
FROM commerce_settlement_group_totals t;

CREATE VIEW commerce_settlement_result_sources_v1 AS
SELECT s.sequence AS assessment_sequence,
  CASE WHEN classification IN ('settled','voided') THEN classification ELSE 'unresolved' END AS state,
  classification AS reason,CASE WHEN groups_found=1 THEN provider_reference ELSE NULL END AS provider_reference,
  CASE WHEN classification='settled' THEN observed_fee ELSE 0 END AS fee_amount,
  CASE WHEN classification='settled' THEN observed_seller_credit ELSE 0 END AS seller_cash_amount,
  CASE WHEN classification='settled' THEN observed_platform_credit ELSE 0 END AS platform_cash_amount,
  provider_at,observed_at,
  json_object('version',1,'captureId',capture_id,'orderId',order_id,'sellerCollectionId',seller_collection_id,'platformCollectionId',platform_collection_id,
    'providerReference',CASE WHEN groups_found=1 THEN provider_reference ELSE NULL END,'classification',classification,
    'grossAmount',CAST(gross_amount AS TEXT),'observedFee',CAST(observed_fee AS TEXT),'observedSellerCredit',CAST(observed_seller_credit AS TEXT),'observedPlatformCredit',CAST(observed_platform_credit AS TEXT),
    'legs',json((SELECT json_group_array(json_object('observationSequence',observation_sequence,'rowIndex',row_index,'pocket',pocket,'leg',leg))
      FROM (SELECT * FROM commerce_settlement_group_rows g WHERE g.assessment_sequence=s.sequence ORDER BY observation_sequence,row_index)))) AS source_json
FROM commerce_settlement_classifications_v1 s;

CREATE VIEW commerce_settlement_source_freshness AS
SELECT s.sequence AS assessment_sequence,NOT EXISTS(
  SELECT 1 FROM commerce_provider_collection_windows w JOIN commerce_provider_financial_observations o INDEXED BY idx_provider_history_account
    ON o.enrollment_id=w.enrollment_id AND o.operation='transaction-history-list'
      AND json_extract(o.normalized_json,'$.accountNo')=w.account_number AND o.sequence>w.last_page_sequence
  WHERE w.collection_sequence IN (s.seller_collection_sequence,s.platform_collection_sequence)
    AND ((json_extract(o.normalized_json,'$.from')<=w.to_at AND json_extract(o.normalized_json,'$.to')>=w.from_at)
      OR EXISTS(SELECT 1 FROM commerce_provider_transaction_observations t WHERE t.observation_sequence=o.sequence
        AND (t.partner_reference=s.order_id OR t.provider_reference=r.provider_reference)))) AS current
FROM commerce_settlement_scopes s JOIN commerce_settlement_results r ON r.assessment_sequence=s.sequence;

CREATE VIEW commerce_settlement_journal_accounting AS
SELECT a.sequence AS assessment_sequence,'financial_settlement_'||a.id AS id,a.seller_id,a.order_id,a.capture_id,a.commerce_environment,
  CASE WHEN r.state='voided' THEN 'settlement_reversal' WHEN old.assessment_sequence IS NULL THEN 'settlement' ELSE 'settlement_correction' END AS kind,
  json_object('assessmentId',a.id,'previousRecognitionId',previous.id,'evidence',json(r.source_json),
    'timeBasis',CASE WHEN old.assessment_sequence IS NULL AND r.state='settled' THEN 'provider_credit' ELSE 'provider_observation' END) AS source_json,
  (SELECT json_group_array(json(value)) FROM json_each(json_array(
    json_object('account','provider_receivable','amount',-(r.fee_amount+r.seller_cash_amount+r.platform_cash_amount)+COALESCE(old.fee_amount+old.seller_cash_amount+old.platform_cash_amount,0)),
    json_object('account','provider_cash_seller','amount',r.seller_cash_amount-COALESCE(old.seller_cash_amount,0)),
    json_object('account','provider_cash_platform','amount',r.platform_cash_amount-COALESCE(old.platform_cash_amount,0)),
    json_object('account','seller_pending','amount',r.fee_amount-COALESCE(old.fee_amount,0))
  )) WHERE json_extract(value,'$.amount')!=0) AS lines_json,
  CASE WHEN old.assessment_sequence IS NULL AND r.state='settled' THEN r.provider_at ELSE r.observed_at END AS occurred_at,a.recorded_at AS posted_at
FROM commerce_settlement_assessments a JOIN commerce_settlement_results r ON r.assessment_sequence=a.sequence AND r.state IN ('settled','voided')
LEFT JOIN commerce_settlement_results old ON old.assessment_sequence=(SELECT p.sequence FROM commerce_settlement_assessments p
  JOIN commerce_settlement_results pr ON pr.assessment_sequence=p.sequence AND pr.state IN ('settled','voided')
  WHERE p.capture_id=a.capture_id AND p.sequence<a.sequence ORDER BY p.sequence DESC LIMIT 1)
LEFT JOIN commerce_settlement_assessments previous ON previous.sequence=old.assessment_sequence
WHERE r.fee_amount!=COALESCE(old.fee_amount,0) OR r.seller_cash_amount!=COALESCE(old.seller_cash_amount,0) OR r.platform_cash_amount!=COALESCE(old.platform_cash_amount,0);

CREATE TRIGGER settlement_assessment_source BEFORE INSERT ON commerce_settlement_assessments BEGIN
  SELECT RAISE(ABORT,'settlement_immutable') WHERE EXISTS(SELECT 1 FROM commerce_settlement_assessments WHERE id=NEW.id OR sequence=NEW.sequence
    OR (capture_id=NEW.capture_id AND seller_collection_sequence=NEW.seller_collection_sequence AND platform_collection_sequence=NEW.platform_collection_sequence AND version=NEW.version));
  SELECT RAISE(ABORT,'settlement_concurrent_assessment') WHERE NEW.previous_id IS NOT
    (SELECT id FROM commerce_settlement_assessments WHERE capture_id=NEW.capture_id ORDER BY sequence DESC LIMIT 1);
END;
CREATE TRIGGER settlement_assessment_record AFTER INSERT ON commerce_settlement_assessments BEGIN
  SELECT RAISE(ABORT,'settlement_sequence_invalid') WHERE NEW.sequence<1 OR EXISTS(SELECT 1 FROM commerce_settlement_assessments WHERE sequence>NEW.sequence);
  SELECT RAISE(ABORT,'settlement_original_routing_required') WHERE NOT EXISTS(SELECT 1 FROM commerce_settlement_scopes WHERE sequence=NEW.sequence);
  SELECT RAISE(ABORT,'settlement_additional_payment_review') WHERE EXISTS(SELECT 1 FROM commerce_payment_captures WHERE order_id=NEW.order_id AND capture_kind='duplicate_payment');
  SELECT RAISE(ABORT,'settlement_complete_window_required') WHERE
    (SELECT COUNT(*) FROM commerce_provider_collection_windows WHERE collection_sequence IN (NEW.seller_collection_sequence,NEW.platform_collection_sequence) AND exhausted=1)!=4
    OR (SELECT COUNT(DISTINCT from_at||'/'||to_at) FROM commerce_provider_collection_windows WHERE collection_sequence IN (NEW.seller_collection_sequence,NEW.platform_collection_sequence))!=1
    OR EXISTS(SELECT 1 FROM commerce_provider_collection_windows w JOIN commerce_settlement_scopes s ON s.sequence=NEW.sequence
      WHERE w.collection_sequence IN (NEW.seller_collection_sequence,NEW.platform_collection_sequence)
        AND (w.from_at>strftime('%Y-%m-%dT%H:%M:%f000Z',s.order_created_at) OR w.to_at<strftime('%Y-%m-%dT%H:%M:%f000Z',s.verified_at)));
  INSERT INTO commerce_settlement_results(assessment_sequence,state,reason,provider_reference,fee_amount,seller_cash_amount,platform_cash_amount,provider_at,observed_at,source_json)
    SELECT assessment_sequence,state,reason,provider_reference,fee_amount,seller_cash_amount,platform_cash_amount,provider_at,observed_at,source_json
    FROM commerce_settlement_result_sources_v1 WHERE assessment_sequence=NEW.sequence;
  SELECT RAISE(ABORT,'settlement_history_superseded') WHERE NOT EXISTS(SELECT 1 FROM commerce_settlement_source_freshness WHERE assessment_sequence=NEW.sequence AND current=1);
END;
CREATE TRIGGER settlement_result_source BEFORE INSERT ON commerce_settlement_results BEGIN
  SELECT RAISE(ABORT,'settlement_immutable') WHERE EXISTS(SELECT 1 FROM commerce_settlement_results WHERE assessment_sequence=NEW.assessment_sequence);
  SELECT RAISE(ABORT,'settlement_result_mismatch') WHERE NOT EXISTS(SELECT 1 FROM commerce_settlement_result_sources_v1 s
    WHERE s.assessment_sequence=NEW.assessment_sequence AND s.state=NEW.state AND s.reason=NEW.reason AND s.provider_reference IS NEW.provider_reference
      AND s.fee_amount=NEW.fee_amount AND s.seller_cash_amount=NEW.seller_cash_amount AND s.platform_cash_amount=NEW.platform_cash_amount
      AND s.provider_at IS NEW.provider_at AND s.observed_at=NEW.observed_at AND s.source_json=NEW.source_json);
  SELECT RAISE(ABORT,'settlement_group_identity_conflict') WHERE NEW.state IN ('settled','voided') AND EXISTS(
    SELECT 1 FROM commerce_settlement_scopes s JOIN commerce_settlement_group_bindings g
      ON (g.credential_fingerprint=s.credential_fingerprint AND g.commerce_environment=s.commerce_environment AND g.provider_reference=NEW.provider_reference) OR g.capture_id=s.capture_id
    WHERE s.sequence=NEW.assessment_sequence AND (g.capture_id!=s.capture_id OR g.provider_reference!=NEW.provider_reference));
END;
CREATE TRIGGER settlement_result_post AFTER INSERT ON commerce_settlement_results BEGIN
  INSERT INTO commerce_settlement_group_bindings(credential_fingerprint,commerce_environment,provider_reference,capture_id,assessment_sequence)
    SELECT s.credential_fingerprint,s.commerce_environment,NEW.provider_reference,s.capture_id,NEW.assessment_sequence
    FROM commerce_settlement_scopes s WHERE s.sequence=NEW.assessment_sequence AND NEW.state IN ('settled','voided')
      AND NOT EXISTS(SELECT 1 FROM commerce_settlement_group_bindings g WHERE g.capture_id=s.capture_id);
  INSERT INTO commerce_financial_journals(id,seller_id,order_id,capture_id,commerce_environment,currency,kind,allocation_state,source_json,lines_json,occurred_at,posted_at)
    SELECT id,seller_id,order_id,capture_id,commerce_environment,'IDR',kind,'allocated',source_json,lines_json,occurred_at,posted_at
    FROM commerce_settlement_journal_accounting WHERE assessment_sequence=NEW.assessment_sequence;
END;
CREATE TRIGGER settlement_group_source BEFORE INSERT ON commerce_settlement_group_bindings BEGIN
  SELECT RAISE(ABORT,'settlement_immutable') WHERE EXISTS(SELECT 1 FROM commerce_settlement_group_bindings
    WHERE capture_id=NEW.capture_id OR assessment_sequence=NEW.assessment_sequence
      OR (credential_fingerprint=NEW.credential_fingerprint AND commerce_environment=NEW.commerce_environment AND provider_reference=NEW.provider_reference));
  SELECT RAISE(ABORT,'settlement_group_source') WHERE NOT EXISTS(SELECT 1 FROM commerce_settlement_scopes s
    JOIN commerce_settlement_results r ON r.assessment_sequence=s.sequence AND r.state IN ('settled','voided')
    WHERE s.sequence=NEW.assessment_sequence AND s.capture_id=NEW.capture_id AND s.credential_fingerprint=NEW.credential_fingerprint
      AND s.commerce_environment=NEW.commerce_environment AND r.provider_reference=NEW.provider_reference);
END;

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
        AND s.source_json=NEW.source_json AND s.lines_json=NEW.lines_json AND s.occurred_at=NEW.occurred_at AND s.posted_at=NEW.posted_at)));
  SELECT RAISE(ABORT,'financial_unbalanced_journal') WHERE (SELECT SUM(json_extract(value,'$.amount')) FROM json_each(NEW.lines_json))!=0;
  SELECT RAISE(ABORT,'financial_journal_immutable') WHERE EXISTS(SELECT 1 FROM commerce_financial_journals
    WHERE id=NEW.id OR sequence=NEW.sequence OR (NEW.kind='capture' AND capture_id=NEW.capture_id AND kind='capture'));
END;

CREATE TRIGGER settlement_assessments_no_update BEFORE UPDATE ON commerce_settlement_assessments BEGIN SELECT RAISE(ABORT,'settlement_immutable'); END;
CREATE TRIGGER settlement_assessments_no_delete BEFORE DELETE ON commerce_settlement_assessments BEGIN SELECT RAISE(ABORT,'settlement_immutable'); END;
CREATE TRIGGER settlement_results_no_update BEFORE UPDATE ON commerce_settlement_results BEGIN SELECT RAISE(ABORT,'settlement_immutable'); END;
CREATE TRIGGER settlement_results_no_delete BEFORE DELETE ON commerce_settlement_results BEGIN SELECT RAISE(ABORT,'settlement_immutable'); END;
CREATE TRIGGER settlement_groups_no_update BEFORE UPDATE ON commerce_settlement_group_bindings BEGIN SELECT RAISE(ABORT,'settlement_immutable'); END;
CREATE TRIGGER settlement_groups_no_delete BEFORE DELETE ON commerce_settlement_group_bindings BEGIN SELECT RAISE(ABORT,'settlement_immutable'); END;
