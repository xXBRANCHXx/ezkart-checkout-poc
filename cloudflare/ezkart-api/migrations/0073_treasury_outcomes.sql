-- Read-only provider observations. These never release a reservation, renew
-- payment authority, or post a final payout journal.
CREATE TABLE commerce_treasury_status_observations (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE CHECK(length(id)=50 AND substr(id,1,10)='trystatus_' AND substr(id,11) NOT GLOB '*[^a-f0-9]*'),
  intent_id TEXT NOT NULL REFERENCES commerce_treasury_intents(id) ON DELETE RESTRICT,
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  credential_fingerprint TEXT NOT NULL,
  client_id TEXT NOT NULL,
  provider_day TEXT NOT NULL,
  external_id TEXT NOT NULL CHECK(length(external_id)=32 AND external_id NOT GLOB '*[^0-9]*'),
  evidence_digest TEXT NOT NULL CHECK(length(evidence_digest)=64 AND evidence_digest NOT GLOB '*[^a-f0-9]*'),
  evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
  transaction_type TEXT NOT NULL CHECK(length(transaction_type) BETWEEN 1 AND 32),
  status_code TEXT NOT NULL CHECK(status_code IN ('00','03','04','05','06')),
  description TEXT NOT NULL CHECK(length(description)<=32),
  refund_count INTEGER NOT NULL CHECK(typeof(refund_count)='integer' AND refund_count BETWEEN 0 AND 1000),
  requested_at TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE(commerce_environment,client_id,provider_day,external_id)
);
CREATE INDEX treasury_status_time ON commerce_treasury_status_observations(intent_id,requested_at,observed_at);

CREATE TRIGGER treasury_status_source BEFORE INSERT ON commerce_treasury_status_observations BEGIN
  SELECT RAISE(ABORT,'treasury_status_immutable') WHERE EXISTS(SELECT 1 FROM commerce_treasury_status_observations
    WHERE id=NEW.id OR (commerce_environment=NEW.commerce_environment AND client_id=NEW.client_id AND provider_day=NEW.provider_day AND external_id=NEW.external_id));
  SELECT RAISE(ABORT,'treasury_status_source') WHERE NOT EXISTS(
    SELECT 1 FROM commerce_treasury_bank_grants g JOIN commerce_treasury_bank_grants i ON i.intent_id=g.intent_id AND i.stage='inquiry'
    WHERE g.stage='payment' AND g.intent_id=NEW.intent_id AND g.commerce_environment=NEW.commerce_environment
      AND g.credential_fingerprint=NEW.credential_fingerprint AND g.client_id=NEW.client_id
      AND NEW.external_id!=g.payment_external_id AND NEW.external_id!=i.inquiry_external_id
      AND (SELECT COUNT(*) FROM json_each(NEW.evidence_json))=8 AND (SELECT COUNT(DISTINCT key) FROM json_each(NEW.evidence_json))=8
      AND NOT EXISTS(SELECT 1 FROM json_each(NEW.evidence_json) WHERE type!='text')
      AND json_extract(NEW.evidence_json,'$.environment')=NEW.commerce_environment
      AND json_extract(NEW.evidence_json,'$.credentialFingerprint')=NEW.credential_fingerprint
      AND json_extract(NEW.evidence_json,'$.operation')='transactions-status'
      AND json_extract(NEW.evidence_json,'$.externalId')=NEW.external_id
      AND json_extract(NEW.evidence_json,'$.requestBody')=json_object('partnerReferenceNo',json_extract(g.request_body,'$.partnerReferenceNo'))
      AND julianday(NEW.requested_at)=julianday(json_extract(NEW.evidence_json,'$.requestedAt'))
      AND julianday(NEW.observed_at)=julianday(json_extract(NEW.evidence_json,'$.observedAt'))
      AND NEW.provider_day=substr(NEW.requested_at,1,10)
      AND julianday(NEW.requested_at)>=julianday(g.created_at,'-300 seconds')
      AND NEW.requested_at<=NEW.observed_at AND julianday(NEW.observed_at)<=julianday(NEW.requested_at,'+300 seconds')
      AND julianday(NEW.observed_at)<=julianday('now','+300 seconds')
      AND NEW.recorded_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  SELECT RAISE(ABORT,'treasury_status_source') WHERE NOT EXISTS(
    SELECT 1 FROM commerce_treasury_bank_grants g,
    json_each(json_array(json_extract(NEW.evidence_json,'$.responseBody'))) r
    WHERE g.stage='payment' AND g.intent_id=NEW.intent_id AND json_valid(r.value)
      AND json_type(r.value,'$.responseCode')='text' AND json_extract(r.value,'$.responseCode') GLOB '200[0-9][0-9][0-9][0-9]'
      AND json_extract(r.value,'$.partnerReferenceNo')=json_extract(g.request_body,'$.partnerReferenceNo')
      AND json_type(r.value,'$.amount.value')='text' AND json_extract(r.value,'$.amount.value')=json_extract(g.request_body,'$.amount.value')
      AND json_extract(r.value,'$.amount.currency')='IDR'
      AND json_type(r.value,'$.transactionType')='text' AND json_extract(r.value,'$.transactionType')=NEW.transaction_type
      AND json_type(r.value,'$.latestTransactionStatus')='text' AND json_extract(r.value,'$.latestTransactionStatus')=NEW.status_code
      AND COALESCE(json_extract(r.value,'$.latestTransactionDesc'),'')=NEW.description
      AND (json_type(r.value,'$.latestTransactionDesc') IS NULL OR json_type(r.value,'$.latestTransactionDesc')='text')
      AND (json_type(r.value,'$.refundHistory') IS NULL OR json_type(r.value,'$.refundHistory')='array')
      AND COALESCE(json_array_length(r.value,'$.refundHistory'),0)=NEW.refund_count
      AND json_type(r.value,'$.transactionDate')='text' AND julianday(NEW.processed_at)=julianday(json_extract(r.value,'$.transactionDate'))
      AND julianday(NEW.processed_at)>=julianday(g.created_at,'-300 seconds')
      AND julianday(NEW.processed_at)<=julianday(NEW.observed_at,'+300 seconds')
      AND (SELECT COUNT(*) FROM json_each(r.value))=(SELECT COUNT(DISTINCT key) FROM json_each(r.value))
      AND (SELECT COUNT(*) FROM json_each(r.value,'$.amount'))=(SELECT COUNT(DISTINCT key) FROM json_each(r.value,'$.amount')));
END;
CREATE TRIGGER treasury_status_no_update BEFORE UPDATE ON commerce_treasury_status_observations BEGIN SELECT RAISE(ABORT,'treasury_status_immutable'); END;
CREATE TRIGGER treasury_status_no_delete BEFORE DELETE ON commerce_treasury_status_observations BEGIN SELECT RAISE(ABORT,'treasury_status_immutable'); END;

-- Provider matching is separate from accounting eligibility: neither status nor
-- history contains the contract proving commission custody/release or fee funding.
CREATE TABLE commerce_treasury_outcome_assessments (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE CHECK(length(id)=47 AND substr(id,1,7)='tryout_' AND substr(id,8) NOT GLOB '*[^a-f0-9]*'),intent_id TEXT NOT NULL REFERENCES commerce_treasury_intents(id),
 collection_sequence INTEGER NOT NULL REFERENCES commerce_provider_financial_collections(sequence),
 status_sequence INTEGER NOT NULL REFERENCES commerce_treasury_status_observations(sequence),
 payment_receipt_digest TEXT,previous_id TEXT REFERENCES commerce_treasury_outcome_assessments(id),recorded_at TEXT NOT NULL
);
CREATE TABLE commerce_treasury_outcome_results (
 assessment_sequence INTEGER PRIMARY KEY REFERENCES commerce_treasury_outcome_assessments(sequence),
 state TEXT NOT NULL CHECK(state IN ('matched_success','matched_failure','held')),reason TEXT NOT NULL,
 provider_reference TEXT,observed_fee TEXT CHECK(observed_fee IS NULL OR (observed_fee NOT GLOB '*[^0-9]*' AND length(observed_fee) BETWEEN 1 AND 16)),
 source_json TEXT NOT NULL CHECK(json_valid(source_json) AND length(source_json)<=200000),observed_at TEXT NOT NULL
);
CREATE VIEW commerce_treasury_outcome_scopes AS
SELECT a.*,i.commerce_environment,i.platform_enrollment_id,i.amount,i.partner_reference,g.credential_fingerprint,g.client_id,g.created_at AS granted_at,
 json_extract(g.binding_json,'$.fromAccount') AS cash_account,json_extract(g.binding_json,'$.channel') AS channel,
 c.id AS collection_id,r.provider_reference AS receipt_reference,r.digest AS receipt_digest,
 o.observed_at AS collection_observed_at
FROM commerce_treasury_outcome_assessments a JOIN commerce_treasury_intents i ON i.id=a.intent_id
JOIN commerce_treasury_bank_grants g ON g.intent_id=i.id AND g.stage='payment'
JOIN commerce_provider_financial_collections c ON c.sequence=a.collection_sequence AND c.enrollment_id=i.platform_enrollment_id
 AND c.commerce_environment=i.commerce_environment AND c.credential_fingerprint=g.credential_fingerprint
JOIN commerce_provider_collection_observations m ON m.collection_sequence=c.sequence AND m.role='balance_after'
JOIN commerce_provider_financial_observations o ON o.sequence=m.observation_sequence
LEFT JOIN commerce_treasury_bank_receipts r ON r.intent_id=i.id AND r.stage='payment';
CREATE VIEW commerce_treasury_outcome_status AS
WITH observations AS (
 SELECT a.sequence AS assessment_sequence,o.*,
  ROW_NUMBER() OVER(PARTITION BY a.sequence ORDER BY o.requested_at DESC,o.observed_at DESC,o.sequence DESC) AS rank,
  MAX(o.requested_at) OVER(PARTITION BY a.sequence) AS newest_start,
  MIN(CASE WHEN o.status_code IN ('00','06') THEN o.observed_at END) OVER(PARTITION BY a.sequence) AS first_terminal_end
 FROM commerce_treasury_outcome_assessments a JOIN commerce_treasury_status_observations o ON o.intent_id=a.intent_id AND o.sequence<=a.status_sequence
) SELECT assessment_sequence,MAX(CASE WHEN rank=1 THEN status_code END) AS status_code,MAX(observed_at) AS checked_at,
 CASE WHEN MAX(transaction_type!='PAYOUT' OR status_code NOT IN ('00','03','06') OR refund_count>0 OR lower(description) IN ('void','voided'))=1 THEN 'unsupported_status'
  WHEN COUNT(DISTINCT CASE WHEN status_code IN ('00','06') THEN status_code END)>1 THEN 'contradictory_terminal_status'
  WHEN MAX(status_code='03' AND requested_at>first_terminal_end)=1 THEN 'terminal_regression'
  WHEN COUNT(DISTINCT CASE WHEN observed_at>=newest_start THEN transaction_type||':'||status_code END)>1 THEN 'overlapping_status'
  ELSE NULL END AS status_reason FROM observations GROUP BY assessment_sequence;
CREATE VIEW commerce_treasury_outcome_rows AS
SELECT s.sequence AS assessment_sequence,s.partner_reference AS original_reference,s.cash_account,t.*
FROM commerce_treasury_outcome_scopes s JOIN commerce_provider_collection_observations m ON m.collection_sequence=s.collection_sequence AND m.role='history_page'
JOIN commerce_provider_transaction_observations t ON t.observation_sequence=m.observation_sequence
-- Keep the earlier window's endpoint rows, with all genuine duplicate legs.
WHERE NOT EXISTS (
  SELECT 1 FROM commerce_provider_financial_observations current
    JOIN commerce_provider_collection_observations prior ON prior.collection_sequence=m.collection_sequence AND prior.role='history_page'
    JOIN commerce_provider_financial_observations previous ON previous.sequence=prior.observation_sequence
  WHERE current.sequence=m.observation_sequence
    AND t.occurred_at=json_extract(current.normalized_json,'$.from')
    AND json_extract(previous.normalized_json,'$.accountNo')=t.account_number
    AND json_extract(previous.normalized_json,'$.to')=json_extract(current.normalized_json,'$.from')
);
CREATE VIEW commerce_treasury_outcome_anchors AS
SELECT assessment_sequence,MIN(provider_reference) AS provider_reference,COUNT(DISTINCT provider_reference) AS groups_found
FROM commerce_treasury_outcome_rows WHERE account_number=cash_account AND transaction_type='PAYOUT' AND mutation_type='DEBIT' AND partner_reference=original_reference GROUP BY assessment_sequence;
CREATE VIEW commerce_treasury_outcome_legs AS
SELECT t.*,CASE WHEN t.account_number=t.cash_account AND t.transaction_type='PAYOUT' AND t.mutation_type='DEBIT' THEN 'principal'
 WHEN t.account_number=t.cash_account AND t.transaction_type='PAYOUT_CHARGE' AND t.mutation_type='DEBIT' THEN 'fee' ELSE 'unsupported' END AS leg
FROM commerce_treasury_outcome_rows t LEFT JOIN commerce_treasury_outcome_anchors g ON g.assessment_sequence=t.assessment_sequence
WHERE t.partner_reference=t.original_reference OR t.provider_reference=g.provider_reference;
CREATE VIEW commerce_treasury_outcome_totals AS
SELECT s.*,st.status_code,st.status_reason,st.checked_at,g.provider_reference,COALESCE(g.groups_found,0) AS groups_found,
 COALESCE(SUM(t.leg='principal'),0) AS principals,COALESCE(SUM(t.leg='fee'),0) AS fees,COALESCE(SUM(t.leg='unsupported'),0) AS unsupported,
 COALESCE(SUM(t.partner_reference IS NOT NULL AND t.partner_reference!='' AND t.partner_reference!=s.partner_reference),0) AS foreign_references,
 COALESCE(SUM(t.occurred_at<strftime('%Y-%m-%dT%H:%M:%f000Z',s.granted_at,'-300 seconds')),0) AS early_rows,
 MAX(CASE WHEN t.leg='principal' THEN t.amount END) AS principal_amount,MAX(CASE WHEN t.leg='principal' THEN t.provider_status END) AS principal_status,
 MAX(CASE WHEN t.leg='principal' THEN json_extract(t.row_json,'$.channel') END) AS principal_channel,
 MAX(CASE WHEN t.leg='fee' THEN t.amount END) AS fee_amount,MAX(CASE WHEN t.leg='fee' THEN t.provider_status END) AS fee_status
FROM commerce_treasury_outcome_scopes s JOIN commerce_treasury_outcome_status st ON st.assessment_sequence=s.sequence
LEFT JOIN commerce_treasury_outcome_anchors g ON g.assessment_sequence=s.sequence
LEFT JOIN commerce_treasury_outcome_legs t ON t.assessment_sequence=s.sequence GROUP BY s.sequence;
CREATE VIEW commerce_treasury_outcome_classification AS
SELECT t.*,CASE
 WHEN status_reason IS NOT NULL THEN status_reason
 WHEN status_code='03' THEN 'provider_pending'
 WHEN groups_found!=1 THEN 'principal_missing_or_ambiguous'
 WHEN foreign_references!=0 THEN 'foreign_provider_reference'
 WHEN unsupported!=0 THEN 'unsupported_or_wrong_account_rows'
 WHEN principals!=1 THEN 'principal_duplicate'
 WHEN principal_amount!=CAST(amount AS TEXT) OR principal_channel IS NOT channel THEN 'principal_details_mismatch'
 WHEN early_rows!=0 THEN 'provider_date_mismatch'
 WHEN receipt_reference IS NOT NULL AND receipt_reference!=provider_reference THEN 'receipt_reference_mismatch'
 WHEN EXISTS(SELECT 1 FROM commerce_payout_reference_bindings b WHERE b.credential_fingerprint=t.credential_fingerprint AND b.commerce_environment=t.commerce_environment AND b.provider_reference=t.provider_reference)
   OR EXISTS(SELECT 1 FROM commerce_settlement_group_bindings b WHERE b.credential_fingerprint=t.credential_fingerprint AND b.commerce_environment=t.commerce_environment AND b.provider_reference=t.provider_reference)
   OR EXISTS(SELECT 1 FROM commerce_treasury_bank_receipts b WHERE b.stage='payment' AND b.intent_id!=t.intent_id AND b.credential_fingerprint=t.credential_fingerprint AND b.commerce_environment=t.commerce_environment AND b.provider_reference=t.provider_reference) THEN 'provider_reference_conflict'
 WHEN fees!=1 THEN 'actual_fee_unknown_or_ambiguous'
 WHEN length(fee_amount)>16 OR CAST(fee_amount AS INTEGER)>9007199254740991 THEN 'fee_out_of_range'
 WHEN fee_status NOT IN ('SUCCESS','VOID') THEN 'fee_outcome_unresolved'
 WHEN status_code='00' AND principal_status='SUCCESS' AND receipt_digest IS NULL THEN 'destination_not_confirmed_by_transfer_receipt'
 WHEN status_code='00' AND principal_status='SUCCESS' THEN 'matched_success'
 WHEN status_code='06' AND principal_status='VOID' AND receipt_digest IS NULL THEN 'matched_failure'
 ELSE 'provider_outcome_unresolved' END AS classification
FROM commerce_treasury_outcome_totals t;
CREATE VIEW commerce_treasury_outcome_sources AS
SELECT sequence AS assessment_sequence,CASE WHEN classification IN ('matched_success','matched_failure') THEN classification ELSE 'held' END AS state,
 classification AS reason,CASE WHEN groups_found=1 THEN provider_reference ELSE NULL END AS provider_reference,
 CASE WHEN fees=1 AND fee_status='SUCCESS' AND length(fee_amount)<=16 AND CAST(fee_amount AS INTEGER)<=9007199254740991 THEN fee_amount ELSE NULL END AS observed_fee,
 MAX(collection_observed_at,checked_at) AS observed_at,
 json_object('version',1,'intentId',intent_id,'amount',CAST(amount AS TEXT),'collectionId',collection_id,'statusCap',status_sequence,
  'paymentReceiptDigest',payment_receipt_digest,'classification',classification,'accounting','held_fee_funding_custody_release_unverified',
  'statuses',json((SELECT json_group_array(json_object('sequence',sequence,'digest',evidence_digest)) FROM
   (SELECT sequence,evidence_digest FROM commerce_treasury_status_observations o WHERE o.intent_id=t.intent_id AND o.sequence<=t.status_sequence ORDER BY sequence))),
  'legs',json((SELECT json_group_array(json_object('observationSequence',observation_sequence,'rowIndex',row_index,'leg',leg,'reference',provider_reference)) FROM
   (SELECT * FROM commerce_treasury_outcome_legs l WHERE l.assessment_sequence=t.sequence ORDER BY observation_sequence,row_index)))) AS source_json
FROM commerce_treasury_outcome_classification t;
CREATE VIEW commerce_treasury_outcome_freshness AS
SELECT s.sequence AS assessment_sequence,
 s.status_sequence=(SELECT MAX(sequence) FROM commerce_treasury_status_observations WHERE intent_id=s.intent_id)
 AND s.payment_receipt_digest IS s.receipt_digest
 AND NOT EXISTS(SELECT 1 FROM commerce_provider_collection_windows w JOIN commerce_provider_financial_observations o INDEXED BY idx_provider_history_account
  ON o.enrollment_id=w.enrollment_id AND o.operation='transaction-history-list' AND json_extract(o.normalized_json,'$.accountNo')=w.account_number AND o.sequence>w.last_page_sequence
  WHERE w.collection_sequence=s.collection_sequence AND ((json_extract(o.normalized_json,'$.from')<=w.to_at AND json_extract(o.normalized_json,'$.to')>=w.from_at)
   OR EXISTS(SELECT 1 FROM commerce_provider_transaction_observations t WHERE t.observation_sequence=o.sequence AND (t.partner_reference=s.partner_reference OR t.provider_reference=r.provider_reference)))) AS current
FROM commerce_treasury_outcome_scopes s JOIN commerce_treasury_outcome_results r ON r.assessment_sequence=s.sequence;
CREATE TRIGGER treasury_outcome_source BEFORE INSERT ON commerce_treasury_outcome_assessments BEGIN
 SELECT RAISE(ABORT,'treasury_outcome_record_time') WHERE NEW.recorded_at!=strftime('%Y-%m-%dT%H:%M:%fZ','now');
 SELECT RAISE(ABORT,'treasury_outcome_immutable') WHERE EXISTS(SELECT 1 FROM commerce_treasury_outcome_assessments WHERE id=NEW.id OR sequence=NEW.sequence);
 SELECT RAISE(ABORT,'treasury_outcome_concurrent') WHERE NEW.previous_id IS NOT (SELECT id FROM commerce_treasury_outcome_assessments WHERE intent_id=NEW.intent_id ORDER BY sequence DESC LIMIT 1);
 SELECT RAISE(ABORT,'treasury_outcome_status_stale') WHERE NEW.status_sequence IS NOT (SELECT MAX(sequence) FROM commerce_treasury_status_observations WHERE intent_id=NEW.intent_id);
 SELECT RAISE(ABORT,'treasury_outcome_receipt_changed') WHERE NEW.payment_receipt_digest IS NOT (SELECT digest FROM commerce_treasury_bank_receipts WHERE intent_id=NEW.intent_id AND stage='payment');
END;
CREATE TRIGGER treasury_outcome_record AFTER INSERT ON commerce_treasury_outcome_assessments BEGIN
 SELECT RAISE(ABORT,'treasury_outcome_original_account') WHERE NOT EXISTS(SELECT 1 FROM commerce_treasury_outcome_scopes WHERE sequence=NEW.sequence);
 SELECT RAISE(ABORT,'treasury_outcome_incomplete_window') WHERE
  (SELECT COUNT(*) FROM commerce_provider_collection_windows WHERE collection_sequence=NEW.collection_sequence AND exhausted=1)!=2
  OR (SELECT COUNT(DISTINCT from_at||'/'||to_at) FROM commerce_provider_collection_windows WHERE collection_sequence=NEW.collection_sequence)!=1
  OR EXISTS(SELECT 1 FROM commerce_provider_collection_windows w JOIN commerce_treasury_outcome_scopes s ON s.sequence=NEW.sequence
   JOIN commerce_treasury_outcome_status st ON st.assessment_sequence=s.sequence WHERE w.collection_sequence=NEW.collection_sequence
    AND (w.from_at>strftime('%Y-%m-%dT%H:%M:%f000Z',s.granted_at,'-300 seconds') OR w.to_at<st.checked_at));
 INSERT INTO commerce_treasury_outcome_results SELECT assessment_sequence,state,reason,provider_reference,observed_fee,source_json,observed_at FROM commerce_treasury_outcome_sources WHERE assessment_sequence=NEW.sequence;
 SELECT RAISE(ABORT,'treasury_outcome_history_stale') WHERE NOT EXISTS(SELECT 1 FROM commerce_treasury_outcome_freshness WHERE assessment_sequence=NEW.sequence AND current=1);
END;
CREATE TRIGGER treasury_outcome_result_source BEFORE INSERT ON commerce_treasury_outcome_results BEGIN
 SELECT RAISE(ABORT,'treasury_outcome_immutable') WHERE EXISTS(SELECT 1 FROM commerce_treasury_outcome_results WHERE assessment_sequence=NEW.assessment_sequence);
 SELECT RAISE(ABORT,'treasury_outcome_result_mismatch') WHERE NOT EXISTS(SELECT 1 FROM commerce_treasury_outcome_sources s WHERE s.assessment_sequence=NEW.assessment_sequence
  AND s.state=NEW.state AND s.reason=NEW.reason AND s.provider_reference IS NEW.provider_reference AND s.observed_fee IS NEW.observed_fee AND s.source_json=NEW.source_json AND s.observed_at=NEW.observed_at);
END;
CREATE TRIGGER treasury_outcome_assessments_no_update BEFORE UPDATE ON commerce_treasury_outcome_assessments BEGIN SELECT RAISE(ABORT,'treasury_outcome_immutable'); END;
CREATE TRIGGER treasury_outcome_assessments_no_delete BEFORE DELETE ON commerce_treasury_outcome_assessments BEGIN SELECT RAISE(ABORT,'treasury_outcome_immutable'); END;
CREATE TRIGGER treasury_outcome_results_no_update BEFORE UPDATE ON commerce_treasury_outcome_results BEGIN SELECT RAISE(ABORT,'treasury_outcome_immutable'); END;
CREATE TRIGGER treasury_outcome_results_no_delete BEFORE DELETE ON commerce_treasury_outcome_results BEGIN SELECT RAISE(ABORT,'treasury_outcome_immutable'); END;
