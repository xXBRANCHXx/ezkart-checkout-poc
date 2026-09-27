-- Reconcile original transfers from immutable status and complete account reads.
-- Missing fee history is unknown, never zero. FAILED history alone does not prove
-- a debit was removed; only an explicit VOID row has that documented meaning.
INSERT INTO commerce_financial_accounts(code,account_class,normal_side)
  VALUES('platform_withdrawal_fee','expense','debit');

CREATE TABLE commerce_payout_assessments (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE CHECK(length(id)=47 AND substr(id,1,7)='payout_' AND substr(id,8) NOT GLOB '*[^a-f0-9]*'),
  version INTEGER NOT NULL CHECK(version=1),
  withdrawal_id TEXT NOT NULL REFERENCES commerce_withdrawal_payment_grants(withdrawal_id) ON DELETE RESTRICT,
  seller_collection_sequence INTEGER NOT NULL REFERENCES commerce_provider_financial_collections(sequence) ON DELETE RESTRICT,
  platform_collection_sequence INTEGER NOT NULL REFERENCES commerce_provider_financial_collections(sequence) ON DELETE RESTRICT,
  status_sequence INTEGER NOT NULL REFERENCES commerce_withdrawal_status_observations(sequence) ON DELETE RESTRICT,
  previous_id TEXT REFERENCES commerce_payout_assessments(id) ON DELETE RESTRICT,
  recorded_at TEXT NOT NULL,
  UNIQUE(withdrawal_id,seller_collection_sequence,platform_collection_sequence,status_sequence,version)
);
CREATE INDEX idx_payout_assessments_withdrawal ON commerce_payout_assessments(withdrawal_id,sequence DESC);
CREATE TABLE commerce_payout_results (
  assessment_sequence INTEGER PRIMARY KEY REFERENCES commerce_payout_assessments(sequence) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK(state IN ('completed','failed','unresolved')),
  reason TEXT NOT NULL,
  provider_reference TEXT,
  fee_amount INTEGER NOT NULL CHECK(typeof(fee_amount)='integer' AND fee_amount BETWEEN 0 AND 9007199254740991),
  paid_amount INTEGER NOT NULL CHECK(typeof(paid_amount)='integer' AND paid_amount BETWEEN 0 AND 9007199254740991),
  provider_at TEXT,
  observed_at TEXT NOT NULL,
  source_json TEXT NOT NULL CHECK(json_valid(source_json)),
  CHECK(state!='unresolved' OR (fee_amount=0 AND paid_amount=0)),
  CHECK(state!='failed' OR paid_amount=0)
);
CREATE TABLE commerce_payout_reference_bindings (
  credential_fingerprint TEXT NOT NULL,
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  provider_reference TEXT NOT NULL,
  withdrawal_id TEXT NOT NULL REFERENCES commerce_withdrawal_payment_grants(withdrawal_id) ON DELETE RESTRICT,
  assessment_sequence INTEGER NOT NULL REFERENCES commerce_payout_results(assessment_sequence) ON DELETE RESTRICT,
  PRIMARY KEY(credential_fingerprint,commerce_environment,provider_reference)
);

CREATE VIEW commerce_payout_scopes AS
SELECT a.*,w.seller_id,w.commerce_environment,w.amount,w.channel,w.partner_reference,
  g.created_at AS granted_at,g.credential_fingerprint,w.enrollment_id AS seller_enrollment_id,g.platform_enrollment_id,
  sp.cash_account AS seller_cash,sp.pending_account AS seller_pending,
  pp.cash_account AS platform_cash,pp.pending_account AS platform_pending,
  sc.id AS seller_collection_id,pc.id AS platform_collection_id,
  MAX(so.observed_at,po.observed_at) AS collection_observed_at
FROM commerce_payout_assessments a JOIN commerce_withdrawals w ON w.id=a.withdrawal_id
JOIN commerce_withdrawal_payment_grants g ON g.withdrawal_id=w.id
JOIN commerce_wallet_provider_profiles sp ON sp.enrollment_id=w.enrollment_id
JOIN commerce_wallet_provider_profiles pp ON pp.enrollment_id=g.platform_enrollment_id
JOIN commerce_provider_financial_collections sc ON sc.sequence=a.seller_collection_sequence
  AND sc.enrollment_id=w.enrollment_id AND sc.credential_fingerprint=g.credential_fingerprint AND sc.commerce_environment=w.commerce_environment
JOIN commerce_provider_financial_collections pc ON pc.sequence=a.platform_collection_sequence
  AND pc.enrollment_id=g.platform_enrollment_id AND pc.credential_fingerprint=g.credential_fingerprint AND pc.commerce_environment=w.commerce_environment
JOIN commerce_provider_collection_observations sm ON sm.collection_sequence=sc.sequence AND sm.role='balance_after'
JOIN commerce_provider_financial_observations so ON so.sequence=sm.observation_sequence
JOIN commerce_provider_collection_observations pm ON pm.collection_sequence=pc.sequence AND pm.role='balance_after'
JOIN commerce_provider_financial_observations po ON po.sequence=pm.observation_sequence;

-- Freeze the complete observation frontier, including late arrivals. The rules
-- match the protected status summary; new observations invalidate freshness.
CREATE VIEW commerce_payout_status_sources AS
WITH observations AS (
  SELECT a.sequence AS assessment_sequence,o.*,
    ROW_NUMBER() OVER(PARTITION BY a.sequence ORDER BY o.requested_at DESC,o.observed_at DESC,o.sequence DESC) AS rank,
    MAX(o.requested_at) OVER(PARTITION BY a.sequence) AS newest_start,
    MIN(CASE WHEN o.status_code IN ('00','06') THEN o.observed_at END) OVER(PARTITION BY a.sequence) AS first_terminal_end
  FROM commerce_payout_assessments a JOIN commerce_withdrawal_status_observations o
    ON o.withdrawal_id=a.withdrawal_id AND o.sequence<=a.status_sequence
) SELECT assessment_sequence,MAX(CASE WHEN rank=1 THEN status_code END) AS status_code,
  MAX(observed_at) AS checked_at,
  CASE WHEN MAX(transaction_type!='PAYOUT' OR status_code NOT IN ('00','03','06') OR refund_count>0 OR lower(description) IN ('void','voided'))=1 THEN 'unsupported_outcome'
    WHEN COUNT(DISTINCT CASE WHEN status_code IN ('00','06') THEN status_code END)>1 THEN 'conflicting_terminal_results'
    WHEN MAX(status_code='03' AND requested_at>first_terminal_end)=1 THEN 'terminal_regression'
    WHEN COUNT(DISTINCT CASE WHEN observed_at>=newest_start THEN transaction_type||':'||status_code END)>1 THEN 'overlapping_results'
    ELSE NULL END AS status_reason
FROM observations GROUP BY assessment_sequence;

CREATE VIEW commerce_payout_observed_rows AS
SELECT s.sequence AS assessment_sequence,s.partner_reference AS original_reference,t.*,
  CASE WHEN m.collection_sequence=s.seller_collection_sequence THEN
    CASE WHEN t.account_number=s.seller_cash THEN 'seller_cash' ELSE 'seller_pending' END
  ELSE CASE WHEN t.account_number=s.platform_cash THEN 'platform_cash' ELSE 'platform_pending' END END AS pocket
FROM commerce_payout_scopes s JOIN commerce_provider_collection_observations m
  ON m.collection_sequence IN (s.seller_collection_sequence,s.platform_collection_sequence) AND m.role='history_page'
JOIN commerce_provider_transaction_observations t ON t.observation_sequence=m.observation_sequence;
CREATE VIEW commerce_payout_group_anchors AS
SELECT assessment_sequence,MIN(provider_reference) AS provider_reference,COUNT(DISTINCT provider_reference) AS groups_found
FROM commerce_payout_observed_rows
WHERE pocket='seller_cash' AND transaction_type='PAYOUT' AND mutation_type='DEBIT' AND partner_reference=original_reference
GROUP BY assessment_sequence;
CREATE VIEW commerce_payout_group_rows AS
SELECT t.*,CASE WHEN t.pocket='seller_cash' AND t.transaction_type='PAYOUT' AND t.mutation_type='DEBIT' THEN 'payout'
  WHEN t.pocket IN ('seller_cash','platform_cash') AND t.transaction_type='PAYOUT_CHARGE' AND t.mutation_type='DEBIT' THEN 'fee'
  ELSE 'unsupported' END AS leg
FROM commerce_payout_observed_rows t LEFT JOIN commerce_payout_group_anchors g ON g.assessment_sequence=t.assessment_sequence
WHERE t.partner_reference=t.original_reference OR t.provider_reference=g.provider_reference;
CREATE VIEW commerce_payout_group_totals AS
SELECT s.*,st.status_code,st.status_reason,st.checked_at,g.provider_reference,COALESCE(g.groups_found,0) AS groups_found,
  COALESCE(SUM(t.leg='payout'),0) AS payouts,COALESCE(SUM(t.leg='fee'),0) AS fees,COALESCE(SUM(t.leg='unsupported'),0) AS unsupported,
  COALESCE(SUM(t.partner_reference IS NOT NULL AND t.partner_reference!='' AND t.partner_reference!=s.partner_reference),0) AS foreign_references,
  COALESCE(SUM(t.occurred_at<strftime('%Y-%m-%dT%H:%M:%f000Z',s.granted_at,'-300 seconds')),0) AS early_rows,
  MAX(CASE WHEN t.leg='payout' THEN CAST(t.amount AS INTEGER) END) AS payout_amount,
  MAX(CASE WHEN t.leg='payout' THEN t.provider_status END) AS payout_status,
  MAX(CASE WHEN t.leg='payout' THEN json_extract(t.row_json,'$.channel') END) AS payout_channel,
  MAX(CASE WHEN t.leg='fee' THEN CAST(t.amount AS INTEGER) END) AS observed_fee,
  MAX(CASE WHEN t.leg='fee' THEN t.provider_status END) AS fee_status,
  MAX(CASE WHEN t.leg='fee' THEN t.pocket END) AS fee_pocket,
  MAX(t.occurred_at) AS provider_at
FROM commerce_payout_scopes s JOIN commerce_payout_status_sources st ON st.assessment_sequence=s.sequence
LEFT JOIN commerce_payout_group_anchors g ON g.assessment_sequence=s.sequence
LEFT JOIN commerce_payout_group_rows t ON t.assessment_sequence=s.sequence GROUP BY s.sequence;
CREATE VIEW commerce_payout_classifications_v1 AS
SELECT t.*,CASE
  WHEN status_reason IS NOT NULL THEN status_reason
  WHEN status_code='03' THEN 'provider_pending'
  WHEN groups_found=0 THEN 'payout_not_observed'
  WHEN groups_found!=1 THEN 'payout_group_ambiguous'
  WHEN foreign_references!=0 THEN 'provider_reference_mismatch'
  WHEN unsupported!=0 THEN 'unsupported_provider_rows'
  WHEN payouts!=1 OR fees!=1 THEN 'incomplete_or_duplicate_legs'
  WHEN payout_amount!=amount OR payout_channel IS NOT channel THEN 'payout_details_mismatch'
  WHEN early_rows!=0 THEN 'provider_date_mismatch'
  WHEN observed_fee>9007199254740991 THEN 'fee_amount_out_of_range'
  WHEN fee_status NOT IN ('SUCCESS','VOID') THEN 'fee_outcome_unresolved'
  WHEN fee_status='SUCCESS' AND fee_pocket='seller_cash' AND observed_fee!=0 THEN 'seller_fee_unfunded'
  WHEN status_code='00' AND payout_status='SUCCESS' THEN 'completed'
  WHEN status_code='06' AND payout_status='VOID' THEN 'failed'
  ELSE 'payout_outcome_unresolved' END AS classification
FROM commerce_payout_group_totals t;
CREATE VIEW commerce_payout_result_sources_v1 AS
SELECT s.sequence AS assessment_sequence,
  CASE WHEN classification IN ('completed','failed') THEN classification ELSE 'unresolved' END AS state,
  classification AS reason,CASE WHEN groups_found=1 THEN provider_reference ELSE NULL END AS provider_reference,
  CASE WHEN classification IN ('completed','failed') AND fee_status='SUCCESS' THEN observed_fee ELSE 0 END AS fee_amount,
  CASE WHEN classification='completed' THEN amount ELSE 0 END AS paid_amount,provider_at,
  MAX(collection_observed_at,checked_at) AS observed_at,
  json_object('version',1,'withdrawalId',withdrawal_id,'amount',CAST(amount AS TEXT),'sellerCollectionId',seller_collection_id,
    'platformCollectionId',platform_collection_id,'statusCap',status_sequence,'classification',classification,
    'providerReference',CASE WHEN groups_found=1 THEN provider_reference ELSE NULL END,
    'observedFee',CAST(observed_fee AS TEXT),'feePocket',fee_pocket,'feeStatus',fee_status,
    'statuses',json((SELECT json_group_array(json_object('sequence',sequence,'digest',evidence_digest)) FROM
      (SELECT sequence,evidence_digest FROM commerce_withdrawal_status_observations o WHERE o.withdrawal_id=s.withdrawal_id AND o.sequence<=s.status_sequence ORDER BY sequence))),
    'legs',json((SELECT json_group_array(json_object('observationSequence',observation_sequence,'rowIndex',row_index,'pocket',pocket,'leg',leg,'reference',provider_reference))
      FROM (SELECT * FROM commerce_payout_group_rows g WHERE g.assessment_sequence=s.sequence ORDER BY observation_sequence,row_index)))) AS source_json
FROM commerce_payout_classifications_v1 s;

CREATE VIEW commerce_payout_source_freshness AS
SELECT s.sequence AS assessment_sequence,
  s.status_sequence=(SELECT MAX(sequence) FROM commerce_withdrawal_status_observations WHERE withdrawal_id=s.withdrawal_id)
  AND NOT EXISTS(SELECT 1 FROM commerce_withdrawal_payment_receipts p WHERE p.withdrawal_id=s.withdrawal_id AND r.provider_reference IS NOT NULL AND p.provider_reference!=r.provider_reference)
  AND NOT EXISTS(
    SELECT 1 FROM commerce_provider_collection_windows w JOIN commerce_provider_financial_observations o INDEXED BY idx_provider_history_account
      ON o.enrollment_id=w.enrollment_id AND o.operation='transaction-history-list'
        AND json_extract(o.normalized_json,'$.accountNo')=w.account_number AND o.sequence>w.last_page_sequence
    WHERE w.collection_sequence IN (s.seller_collection_sequence,s.platform_collection_sequence)
      AND ((json_extract(o.normalized_json,'$.from')<=w.to_at AND json_extract(o.normalized_json,'$.to')>=w.from_at)
        OR EXISTS(SELECT 1 FROM commerce_provider_transaction_observations t WHERE t.observation_sequence=o.sequence
          AND (t.partner_reference=s.partner_reference OR t.provider_reference=r.provider_reference
            OR t.provider_reference IN (SELECT provider_reference FROM commerce_payout_group_rows WHERE assessment_sequence=s.sequence))))) AS current
FROM commerce_payout_scopes s JOIN commerce_payout_results r ON r.assessment_sequence=s.sequence;

CREATE VIEW commerce_payout_journal_accounting AS
SELECT a.sequence AS assessment_sequence,'financial_payout_'||a.id AS id,w.seller_id,w.commerce_environment,
  CASE WHEN old.assessment_sequence IS NOT NULL THEN 'payout_correction' WHEN r.state='completed' THEN 'payout' ELSE 'payout_release' END AS kind,
  json_object('assessmentId',a.id,'previousRecognitionId',previous.id,'evidence',json(r.source_json),
    'timeBasis',CASE WHEN old.assessment_sequence IS NULL AND r.state='completed' THEN 'provider_debit' ELSE 'provider_observation' END) AS source_json,
  (SELECT json_group_array(json(value)) FROM json_each(json_array(
    json_object('account','seller_withdrawal_reserved','amount',CASE WHEN old.assessment_sequence IS NULL THEN w.amount ELSE 0 END),
    json_object('account','seller_available','amount',CASE WHEN old.state='failed' THEN w.amount ELSE 0 END-CASE WHEN r.state='failed' THEN w.amount ELSE 0 END),
    json_object('account','provider_cash_seller','amount',COALESCE(old.paid_amount,0)-r.paid_amount),
    json_object('account','platform_withdrawal_fee','amount',r.fee_amount-COALESCE(old.fee_amount,0)),
    json_object('account','provider_cash_platform','amount',COALESCE(old.fee_amount,0)-r.fee_amount)
  )) WHERE json_extract(value,'$.amount')!=0) AS lines_json,
  CASE WHEN old.assessment_sequence IS NULL AND r.state='completed' THEN r.provider_at ELSE r.observed_at END AS occurred_at,a.recorded_at AS posted_at
FROM commerce_payout_assessments a JOIN commerce_withdrawals w ON w.id=a.withdrawal_id
JOIN commerce_payout_results r ON r.assessment_sequence=a.sequence AND r.state IN ('completed','failed')
LEFT JOIN commerce_payout_results old ON old.assessment_sequence=(SELECT p.sequence FROM commerce_payout_assessments p
  JOIN commerce_payout_results pr ON pr.assessment_sequence=p.sequence AND pr.state IN ('completed','failed')
  WHERE p.withdrawal_id=a.withdrawal_id AND p.sequence<a.sequence ORDER BY p.sequence DESC LIMIT 1)
LEFT JOIN commerce_payout_assessments previous ON previous.sequence=old.assessment_sequence
WHERE old.assessment_sequence IS NULL OR r.fee_amount!=old.fee_amount OR r.paid_amount!=old.paid_amount;

CREATE TRIGGER payout_assessment_source BEFORE INSERT ON commerce_payout_assessments BEGIN
  SELECT RAISE(ABORT,'payout_immutable') WHERE EXISTS(SELECT 1 FROM commerce_payout_assessments WHERE id=NEW.id OR sequence=NEW.sequence
    OR (withdrawal_id=NEW.withdrawal_id AND seller_collection_sequence=NEW.seller_collection_sequence AND platform_collection_sequence=NEW.platform_collection_sequence AND status_sequence=NEW.status_sequence AND version=NEW.version));
  SELECT RAISE(ABORT,'payout_concurrent_assessment') WHERE NEW.previous_id IS NOT
    (SELECT id FROM commerce_payout_assessments WHERE withdrawal_id=NEW.withdrawal_id ORDER BY sequence DESC LIMIT 1);
  SELECT RAISE(ABORT,'payout_status_superseded') WHERE NEW.status_sequence IS NOT
    (SELECT MAX(sequence) FROM commerce_withdrawal_status_observations WHERE withdrawal_id=NEW.withdrawal_id);
END;
CREATE TRIGGER payout_assessment_record AFTER INSERT ON commerce_payout_assessments BEGIN
  SELECT RAISE(ABORT,'payout_sequence_invalid') WHERE NEW.sequence<1 OR EXISTS(SELECT 1 FROM commerce_payout_assessments WHERE sequence>NEW.sequence);
  SELECT RAISE(ABORT,'payout_original_accounts_required') WHERE NOT EXISTS(SELECT 1 FROM commerce_payout_scopes WHERE sequence=NEW.sequence);
  SELECT RAISE(ABORT,'payout_complete_window_required') WHERE
    (SELECT COUNT(*) FROM commerce_provider_collection_windows WHERE collection_sequence IN (NEW.seller_collection_sequence,NEW.platform_collection_sequence) AND exhausted=1)!=4
    OR (SELECT COUNT(DISTINCT from_at||'/'||to_at) FROM commerce_provider_collection_windows WHERE collection_sequence IN (NEW.seller_collection_sequence,NEW.platform_collection_sequence))!=1
    OR EXISTS(SELECT 1 FROM commerce_provider_collection_windows w JOIN commerce_payout_scopes s ON s.sequence=NEW.sequence
      JOIN commerce_payout_status_sources st ON st.assessment_sequence=s.sequence
      WHERE w.collection_sequence IN (NEW.seller_collection_sequence,NEW.platform_collection_sequence)
        AND (w.from_at>strftime('%Y-%m-%dT%H:%M:%f000Z',s.granted_at,'-300 seconds') OR w.to_at<st.checked_at));
  INSERT INTO commerce_payout_results(assessment_sequence,state,reason,provider_reference,fee_amount,paid_amount,provider_at,observed_at,source_json)
    SELECT assessment_sequence,state,reason,provider_reference,fee_amount,paid_amount,provider_at,observed_at,source_json
    FROM commerce_payout_result_sources_v1 WHERE assessment_sequence=NEW.sequence;
  SELECT RAISE(ABORT,'payout_history_superseded') WHERE NOT EXISTS(SELECT 1 FROM commerce_payout_source_freshness WHERE assessment_sequence=NEW.sequence AND current=1);
END;
CREATE TRIGGER payout_result_source BEFORE INSERT ON commerce_payout_results BEGIN
  SELECT RAISE(ABORT,'payout_immutable') WHERE EXISTS(SELECT 1 FROM commerce_payout_results WHERE assessment_sequence=NEW.assessment_sequence);
  SELECT RAISE(ABORT,'payout_result_mismatch') WHERE NOT EXISTS(SELECT 1 FROM commerce_payout_result_sources_v1 s
    WHERE s.assessment_sequence=NEW.assessment_sequence AND s.state=NEW.state AND s.reason=NEW.reason AND s.provider_reference IS NEW.provider_reference
      AND s.fee_amount=NEW.fee_amount AND s.paid_amount=NEW.paid_amount AND s.provider_at IS NEW.provider_at AND s.observed_at=NEW.observed_at AND s.source_json=NEW.source_json);
  SELECT RAISE(ABORT,'payout_reference_conflict') WHERE NEW.state IN ('completed','failed') AND EXISTS(
    SELECT 1 FROM commerce_payout_scopes s JOIN commerce_payout_group_rows t ON t.assessment_sequence=s.sequence
    WHERE s.sequence=NEW.assessment_sequence AND (
      EXISTS(SELECT 1 FROM commerce_payout_reference_bindings b WHERE b.credential_fingerprint=s.credential_fingerprint
        AND b.commerce_environment=s.commerce_environment AND b.provider_reference=t.provider_reference AND b.withdrawal_id!=s.withdrawal_id)
      OR EXISTS(SELECT 1 FROM commerce_settlement_group_bindings b WHERE b.credential_fingerprint=s.credential_fingerprint
        AND b.commerce_environment=s.commerce_environment AND b.provider_reference=t.provider_reference)));
  SELECT RAISE(ABORT,'payout_reference_conflict') WHERE NEW.state IN ('completed','failed') AND EXISTS(
    SELECT 1 FROM commerce_payout_assessments a JOIN commerce_payout_results r ON r.assessment_sequence=a.sequence AND r.state IN ('completed','failed')
    WHERE a.withdrawal_id=(SELECT withdrawal_id FROM commerce_payout_assessments WHERE sequence=NEW.assessment_sequence) AND r.provider_reference!=NEW.provider_reference);
END;
CREATE TRIGGER payout_result_post AFTER INSERT ON commerce_payout_results BEGIN
  INSERT INTO commerce_payout_reference_bindings(credential_fingerprint,commerce_environment,provider_reference,withdrawal_id,assessment_sequence)
    SELECT DISTINCT s.credential_fingerprint,s.commerce_environment,t.provider_reference,s.withdrawal_id,NEW.assessment_sequence
    FROM commerce_payout_scopes s JOIN commerce_payout_group_rows t ON t.assessment_sequence=s.sequence
    WHERE s.sequence=NEW.assessment_sequence AND NEW.state IN ('completed','failed') AND NOT EXISTS(
      SELECT 1 FROM commerce_payout_reference_bindings b WHERE b.credential_fingerprint=s.credential_fingerprint
        AND b.commerce_environment=s.commerce_environment AND b.provider_reference=t.provider_reference);
  INSERT INTO commerce_financial_journals(id,seller_id,commerce_environment,currency,kind,allocation_state,source_json,lines_json,occurred_at,posted_at)
    SELECT id,seller_id,commerce_environment,'IDR',kind,'allocated',source_json,lines_json,occurred_at,posted_at
    FROM commerce_payout_journal_accounting WHERE assessment_sequence=NEW.assessment_sequence;
END;
CREATE TRIGGER payout_reference_source BEFORE INSERT ON commerce_payout_reference_bindings BEGIN
  SELECT RAISE(ABORT,'payout_immutable') WHERE EXISTS(SELECT 1 FROM commerce_payout_reference_bindings
    WHERE credential_fingerprint=NEW.credential_fingerprint AND commerce_environment=NEW.commerce_environment AND provider_reference=NEW.provider_reference);
  SELECT RAISE(ABORT,'payout_reference_source') WHERE NOT EXISTS(SELECT 1 FROM commerce_payout_scopes s
    JOIN commerce_payout_results r ON r.assessment_sequence=s.sequence AND r.state IN ('completed','failed')
    JOIN commerce_payout_group_rows t ON t.assessment_sequence=s.sequence
    WHERE s.sequence=NEW.assessment_sequence AND s.withdrawal_id=NEW.withdrawal_id AND s.credential_fingerprint=NEW.credential_fingerprint
      AND s.commerce_environment=NEW.commerce_environment AND t.provider_reference=NEW.provider_reference);
END;
CREATE TRIGGER settlement_payout_reference_guard BEFORE INSERT ON commerce_settlement_group_bindings BEGIN
  SELECT RAISE(ABORT,'settlement_group_identity_conflict') WHERE EXISTS(SELECT 1 FROM commerce_payout_reference_bindings b
    WHERE b.credential_fingerprint=NEW.credential_fingerprint AND b.commerce_environment=NEW.commerce_environment AND b.provider_reference=NEW.provider_reference);
END;
CREATE TRIGGER payout_assessments_no_update BEFORE UPDATE ON commerce_payout_assessments BEGIN SELECT RAISE(ABORT,'payout_immutable'); END;
CREATE TRIGGER payout_assessments_no_delete BEFORE DELETE ON commerce_payout_assessments BEGIN SELECT RAISE(ABORT,'payout_immutable'); END;
CREATE TRIGGER payout_results_no_update BEFORE UPDATE ON commerce_payout_results BEGIN SELECT RAISE(ABORT,'payout_immutable'); END;
CREATE TRIGGER payout_results_no_delete BEFORE DELETE ON commerce_payout_results BEGIN SELECT RAISE(ABORT,'payout_immutable'); END;
CREATE TRIGGER payout_references_no_update BEFORE UPDATE ON commerce_payout_reference_bindings BEGIN SELECT RAISE(ABORT,'payout_immutable'); END;
CREATE TRIGGER payout_references_no_delete BEFORE DELETE ON commerce_payout_reference_bindings BEGIN SELECT RAISE(ABORT,'payout_immutable'); END;

-- A newer unresolved source never restores money already paid. Its last posted
-- outcome stays in the ledger and further availability waits for reconciliation.
CREATE VIEW commerce_payout_positions AS
SELECT w.id AS withdrawal_id,w.seller_id,w.commerce_environment,w.amount,a.id AS assessment_id,a.sequence AS assessment_sequence,
  r.state,r.reason,f.current AS source_current,a.recorded_at,recognized.id AS recognition_id,old.state AS recognized_state,
  COALESCE(old.paid_amount,0) AS paid_amount,COALESCE(old.fee_amount,0) AS fee_amount,
  CASE WHEN r.state IN ('completed','failed') AND f.current=1 THEN 1 ELSE 0 END AS reconciled,
  CASE WHEN a.id IS NOT NULL AND (r.state='unresolved' OR f.current=0) THEN 1 ELSE 0 END AS needs_review
FROM commerce_withdrawals w
LEFT JOIN commerce_payout_assessments a ON a.sequence=(SELECT MAX(sequence) FROM commerce_payout_assessments WHERE withdrawal_id=w.id)
LEFT JOIN commerce_payout_results r ON r.assessment_sequence=a.sequence
LEFT JOIN commerce_payout_source_freshness f ON f.assessment_sequence=a.sequence
LEFT JOIN commerce_payout_assessments recognized ON recognized.sequence=(SELECT p.sequence FROM commerce_payout_assessments p
  JOIN commerce_payout_results pr ON pr.assessment_sequence=p.sequence AND pr.state IN ('completed','failed') WHERE p.withdrawal_id=w.id ORDER BY p.sequence DESC LIMIT 1)
LEFT JOIN commerce_payout_results old ON old.assessment_sequence=recognized.sequence;

DROP VIEW commerce_withdrawal_funds;
DROP VIEW commerce_withdrawal_fund_inputs;
CREATE VIEW commerce_withdrawal_fund_inputs AS
SELECT w.seller_id,w.commerce_environment,
  COALESCE((SELECT SUM(CASE WHEN p.reconciled=1 THEN p.available_amount ELSE 0 END-MAX(-p.net_amount,0))
    FROM commerce_earnings_positions p WHERE p.seller_id=w.seller_id AND p.commerce_environment=w.commerce_environment),0) - COALESCE((SELECT SUM(p.paid_amount) FROM commerce_payout_positions p WHERE p.seller_id=w.seller_id AND p.commerce_environment=w.commerce_environment),0) AS eligible_amount,
  COALESCE((SELECT SUM(d.amount) FROM commerce_withdrawals d WHERE d.seller_id=w.seller_id AND d.commerce_environment=w.commerce_environment
    AND NOT EXISTS(SELECT 1 FROM commerce_withdrawal_cancellations c WHERE c.withdrawal_id=d.id)
    AND NOT EXISTS(SELECT 1 FROM commerce_payout_positions p WHERE p.withdrawal_id=d.id AND p.recognition_id IS NOT NULL)),0) AS reserved_amount,
  (SELECT COUNT(*) FROM commerce_payment_captures c WHERE c.seller_id=w.seller_id AND c.commerce_environment=w.commerce_environment
    AND c.capture_kind='order_payment' AND NOT EXISTS(SELECT 1 FROM commerce_earnings_positions p WHERE p.capture_id=c.id)) AS incomplete_captures,
  (SELECT COUNT(*) FROM commerce_financial_journals j WHERE j.seller_id=w.seller_id AND j.commerce_environment=w.commerce_environment
    AND ((SELECT COUNT(*) FROM commerce_financial_entries e WHERE e.journal_sequence=j.sequence)!=json_array_length(j.lines_json)
      OR COALESCE((SELECT SUM(e.amount) FROM commerce_financial_entries e WHERE e.journal_sequence=j.sequence),1)!=0))
  + (SELECT COUNT(*) FROM commerce_withdrawals d WHERE d.seller_id=w.seller_id AND d.commerce_environment=w.commerce_environment
    AND (NOT EXISTS(SELECT 1 FROM commerce_financial_journals j WHERE j.id='financial_withdrawal_reserve_'||d.id)
      OR (EXISTS(SELECT 1 FROM commerce_withdrawal_cancellations c WHERE c.withdrawal_id=d.id)
        AND NOT EXISTS(SELECT 1 FROM commerce_financial_journals j WHERE j.id='financial_withdrawal_cancel_'||d.id))))
  + (SELECT COUNT(*) FROM commerce_payout_positions p WHERE p.seller_id=w.seller_id AND p.commerce_environment=w.commerce_environment AND p.needs_review=1)
  + (SELECT COUNT(*) FROM commerce_payout_journal_accounting p WHERE p.seller_id=w.seller_id AND p.commerce_environment=w.commerce_environment
      AND NOT EXISTS(SELECT 1 FROM commerce_financial_journals j WHERE j.id=p.id)) AS incomplete_journals,
  COALESCE((SELECT MAX(a.sequence) FROM commerce_earnings_assessments a WHERE a.seller_id=w.seller_id AND a.commerce_environment=w.commerce_environment),0) AS earnings_sequence,
  COALESCE((SELECT MAX(j.sequence) FROM commerce_financial_journals j WHERE j.seller_id=w.seller_id AND j.commerce_environment=w.commerce_environment),0) AS journal_sequence,
  COALESCE((SELECT MAX(a.sequence) FROM commerce_payout_assessments a JOIN commerce_withdrawals d ON d.id=a.withdrawal_id WHERE d.seller_id=w.seller_id AND d.commerce_environment=w.commerce_environment),0) AS payout_sequence
FROM commerce_wallet_enrollments w;

CREATE VIEW commerce_withdrawal_funds AS
SELECT f.*,
  CASE WHEN incomplete_captures=0 AND incomplete_journals=0 THEN MAX(eligible_amount-reserved_amount,0) ELSE 0 END AS reservable_amount,
  MAX(reserved_amount-MAX(eligible_amount,0),0) AS reservation_shortfall,
  json_object('eligibleAmount',CAST(eligible_amount AS TEXT),'reservedAmount',CAST(reserved_amount AS TEXT),
    'earningsSequence',earnings_sequence,'journalSequence',journal_sequence,'payoutSequence',payout_sequence) AS source_json
FROM commerce_withdrawal_fund_inputs f;

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
        AND s.source_json=NEW.source_json AND s.lines_json=NEW.lines_json AND s.occurred_at=NEW.occurred_at AND s.posted_at=NEW.posted_at)));
  SELECT RAISE(ABORT,'financial_unbalanced_journal') WHERE (SELECT SUM(json_extract(value,'$.amount')) FROM json_each(NEW.lines_json))!=0;
  SELECT RAISE(ABORT,'financial_journal_immutable') WHERE EXISTS(SELECT 1 FROM commerce_financial_journals
    WHERE id=NEW.id OR sequence=NEW.sequence OR (NEW.kind='capture' AND capture_id=NEW.capture_id AND kind='capture'));
END;
