-- Bounded multi-window collections preserve existing observation and assessment
-- identities. No evidence is rewritten and no payment authority is changed.
DROP TRIGGER provider_collection_source;
CREATE TRIGGER provider_collection_source BEFORE INSERT ON commerce_provider_financial_collections BEGIN
  SELECT RAISE(ABORT,'provider_collection_immutable') WHERE EXISTS(SELECT 1 FROM commerce_provider_financial_collections
    WHERE id=NEW.id OR sequence=NEW.sequence OR proof_hash=NEW.proof_hash);
  SELECT RAISE(ABORT,'provider_collection_scope') WHERE NOT EXISTS(
    SELECT 1 FROM commerce_wallet_enrollments e JOIN commerce_wallet_provider_profiles p ON p.enrollment_id=e.id
      JOIN commerce_wallet_provider_bindings b ON b.enrollment_id=e.id
    WHERE e.id=NEW.enrollment_id AND e.seller_id=NEW.seller_id AND e.commerce_environment=NEW.commerce_environment
      AND b.credential_fingerprint=NEW.credential_fingerprint);
  SELECT RAISE(ABORT,'provider_collection_sources') WHERE
    (SELECT COUNT(DISTINCT value) FROM json_each(NEW.observation_ids_json))!=json_array_length(NEW.observation_ids_json)
    OR (SELECT COUNT(*) FROM json_each(NEW.observation_ids_json) j JOIN commerce_provider_financial_observations o ON o.id=j.value
      WHERE j.type='text' AND o.enrollment_id=NEW.enrollment_id AND o.seller_id=NEW.seller_id
        AND o.commerce_environment=NEW.commerce_environment AND o.credential_fingerprint=NEW.credential_fingerprint)!=json_array_length(NEW.observation_ids_json);
  SELECT RAISE(ABORT,'provider_collection_balances') WHERE EXISTS(
    SELECT 1 FROM json_each(NEW.observation_ids_json) j JOIN commerce_provider_financial_observations o ON o.id=j.value
    WHERE o.operation!=CASE WHEN j.key IN (0,json_array_length(NEW.observation_ids_json)-1) THEN 'balance-inquiries' ELSE 'transaction-history-list' END);
  SELECT RAISE(ABORT,'provider_collection_chronology') WHERE EXISTS(
    SELECT 1 FROM json_each(NEW.observation_ids_json) j JOIN json_each(NEW.observation_ids_json) k ON k.key=j.key+1
      JOIN commerce_provider_financial_observations a ON a.id=j.value JOIN commerce_provider_financial_observations b ON b.id=k.value
    WHERE b.sequence<=a.sequence OR b.requested_at<a.observed_at);
  SELECT RAISE(ABORT,'provider_collection_window') WHERE EXISTS(
    SELECT 1 FROM json_each(NEW.observation_ids_json) j JOIN commerce_provider_financial_observations o ON o.id=j.value
      JOIN commerce_provider_financial_observations h ON h.id=json_extract(NEW.observation_ids_json,'$[1]')
      JOIN commerce_provider_financial_observations b ON b.id=json_extract(NEW.observation_ids_json,'$[0]')
    WHERE o.operation='transaction-history-list' AND (
      json_extract(o.normalized_json,'$.pageSize')!=json_extract(h.normalized_json,'$.pageSize')
      OR json_extract(o.normalized_json,'$.to')>b.requested_at));
  SELECT RAISE(ABORT,'provider_collection_accounts') WHERE
    (SELECT COUNT(DISTINCT json_extract(o.normalized_json,'$.accountNo')) FROM json_each(NEW.observation_ids_json) j
      JOIN commerce_provider_financial_observations o ON o.id=j.value WHERE o.operation='transaction-history-list')!=2;
  SELECT RAISE(ABORT,'provider_collection_pages') WHERE EXISTS(
    SELECT 1 FROM json_each(NEW.observation_ids_json) j JOIN commerce_provider_financial_observations o ON o.id=j.value
    WHERE o.operation='transaction-history-list' GROUP BY json_extract(o.normalized_json,'$.accountNo'),json_extract(o.normalized_json,'$.from'),json_extract(o.normalized_json,'$.to')
    HAVING COUNT(*)>40 OR MIN(json_extract(o.normalized_json,'$.page'))!=0
      OR MAX(json_extract(o.normalized_json,'$.page'))!=COUNT(*)-1
      OR COUNT(DISTINCT json_extract(o.normalized_json,'$.page'))!=COUNT(*));
  SELECT RAISE(ABORT,'provider_collection_page_order') WHERE EXISTS(
    SELECT 1 FROM json_each(NEW.observation_ids_json) j JOIN json_each(NEW.observation_ids_json) k ON j.key<k.key
      JOIN commerce_provider_financial_observations a ON a.id=j.value JOIN commerce_provider_financial_observations b ON b.id=k.value
    WHERE a.operation='transaction-history-list' AND b.operation='transaction-history-list'
      AND json_extract(a.normalized_json,'$.accountNo')=json_extract(b.normalized_json,'$.accountNo')
      AND json_extract(a.normalized_json,'$.from')=json_extract(b.normalized_json,'$.from')
      AND (json_extract(a.normalized_json,'$.page')>=json_extract(b.normalized_json,'$.page')
        OR json_array_length(a.normalized_json,'$.items')<json_extract(a.normalized_json,'$.pageSize')));
  SELECT RAISE(ABORT,'provider_collection_history_order') WHERE EXISTS(
    SELECT 1 FROM json_each(NEW.observation_ids_json) j JOIN json_each(NEW.observation_ids_json) k ON j.key<k.key
      JOIN commerce_provider_financial_observations a ON a.id=j.value JOIN commerce_provider_financial_observations b ON b.id=k.value
    WHERE a.operation='transaction-history-list' AND b.operation='transaction-history-list'
      AND json_extract(a.normalized_json,'$.accountNo')=json_extract(b.normalized_json,'$.accountNo')
      AND json_extract(a.normalized_json,'$.from')=json_extract(b.normalized_json,'$.from')
      AND json_extract(b.normalized_json,'$.page')=json_extract(a.normalized_json,'$.page')+1
      AND json_extract(b.normalized_json,'$.items[0].dateTime')>json_extract(a.normalized_json,'$.items[#-1].dateTime'));
  SELECT RAISE(ABORT,'provider_collection_overlap') WHERE EXISTS(
    SELECT 1 FROM json_each(NEW.observation_ids_json) j JOIN commerce_provider_financial_observations o ON o.id=j.value
      JOIN commerce_provider_transaction_observations t ON t.observation_sequence=o.sequence
    GROUP BY t.account_number,t.row_json,json_extract(o.normalized_json,'$.from') HAVING COUNT(DISTINCT t.observation_sequence)>1);
  -- Twelve contiguous closed windows; both original pockets have the same plan.
  SELECT RAISE(ABORT,'provider_collection_window') WHERE EXISTS(
    WITH history AS (
      SELECT o.sequence,j.key AS position,json_extract(o.normalized_json,'$.accountNo') AS account,
        json_extract(o.normalized_json,'$.from') AS start,json_extract(o.normalized_json,'$.to') AS finish,
        json_extract(o.normalized_json,'$.page') AS page
      FROM json_each(NEW.observation_ids_json) j JOIN commerce_provider_financial_observations o ON o.id=j.value
      WHERE o.operation='transaction-history-list'
    ), windows AS (SELECT account,start,finish,MIN(position) AS position FROM history GROUP BY account,start,finish)
    SELECT 1 FROM windows GROUP BY start,finish HAVING COUNT(*)!=2
    UNION ALL SELECT 1 FROM windows GROUP BY account HAVING COUNT(*)>12
    UNION ALL SELECT 1 FROM history GROUP BY account HAVING COUNT(*)>40
    UNION ALL SELECT 1 FROM (
      SELECT *,LAG(finish) OVER(PARTITION BY account ORDER BY position) AS previous FROM windows
    ) WHERE previous IS NOT NULL AND start!=previous
  );
  SELECT RAISE(ABORT,'provider_collection_page_order') WHERE EXISTS(
    WITH history AS (
      SELECT o.sequence,j.key AS position,json_extract(o.normalized_json,'$.accountNo') AS account,
        json_extract(o.normalized_json,'$.from') AS start,json_extract(o.normalized_json,'$.to') AS finish,
        json_extract(o.normalized_json,'$.page') AS page
      FROM json_each(NEW.observation_ids_json) j JOIN commerce_provider_financial_observations o ON o.id=j.value
      WHERE o.operation='transaction-history-list'
    ), windows AS (SELECT account,start,finish,MIN(position) AS position FROM history GROUP BY account,start,finish)
    SELECT 1 FROM history a JOIN history b ON a.account=b.account AND a.position<b.position
      WHERE a.start>b.start
  );
  -- Endpoint copies must agree including multiplicity. A missing/changed row
  -- is ambiguous evidence, never an inferred zero or an arbitrary deduplication.
  SELECT RAISE(ABORT,'provider_collection_boundary') WHERE EXISTS(
    WITH history AS (
      SELECT o.sequence,j.key AS position,json_extract(o.normalized_json,'$.accountNo') AS account,
        json_extract(o.normalized_json,'$.from') AS start,json_extract(o.normalized_json,'$.to') AS finish,
        json_extract(o.normalized_json,'$.page') AS page
      FROM json_each(NEW.observation_ids_json) j JOIN commerce_provider_financial_observations o ON o.id=j.value
      WHERE o.operation='transaction-history-list'
    ), windows AS (SELECT account,start,finish,MIN(position) AS position FROM history GROUP BY account,start,finish), items AS (
      SELECT h.*,t.row_json,t.occurred_at FROM history h
        JOIN commerce_provider_transaction_observations t ON t.observation_sequence=h.sequence
    )
    SELECT 1 FROM windows a JOIN windows b ON a.account=b.account AND a.finish=b.start
      JOIN items t ON t.account=a.account AND t.occurred_at=a.finish AND t.start IN (a.start,b.start)
    WHERE (SELECT COUNT(*) FROM items x WHERE x.account=a.account AND x.start=a.start AND x.row_json=t.row_json)
       != (SELECT COUNT(*) FROM items x WHERE x.account=b.account AND x.start=b.start AND x.row_json=t.row_json)
  );
END;

CREATE VIEW commerce_provider_collection_spans AS
SELECT m.collection_sequence,c.enrollment_id,m.account_type,json_extract(o.normalized_json,'$.accountNo') AS account_number,
  json_extract(o.normalized_json,'$.from') AS from_at,json_extract(o.normalized_json,'$.to') AS to_at,
  MAX(o.sequence) AS last_page_sequence,MAX(json_extract(o.normalized_json,'$.exhausted')) AS exhausted
FROM commerce_provider_collection_observations m JOIN commerce_provider_financial_collections c ON c.sequence=m.collection_sequence
  JOIN commerce_provider_financial_observations o ON o.sequence=m.observation_sequence
WHERE m.role='history_page' GROUP BY m.collection_sequence,m.account_type,from_at,to_at;

DROP VIEW commerce_provider_collection_windows;
CREATE VIEW commerce_provider_collection_windows AS
SELECT collection_sequence,enrollment_id,account_type,account_number,MIN(from_at) AS from_at,MAX(to_at) AS to_at,
  MAX(last_page_sequence) AS last_page_sequence,MIN(exhausted) AS exhausted
FROM commerce_provider_collection_spans GROUP BY collection_sequence,account_type;

DROP VIEW commerce_payout_observed_rows;
CREATE VIEW commerce_payout_observed_rows AS
SELECT s.sequence AS assessment_sequence,s.partner_reference AS original_reference,t.*,
  CASE WHEN m.collection_sequence=s.seller_collection_sequence THEN
    CASE WHEN t.account_number=s.seller_cash THEN 'seller_cash' ELSE 'seller_pending' END
  ELSE CASE WHEN t.account_number=s.platform_cash THEN 'platform_cash' ELSE 'platform_pending' END END AS pocket
FROM commerce_payout_scopes s JOIN commerce_provider_collection_observations m
  ON m.collection_sequence IN (s.seller_collection_sequence,s.platform_collection_sequence) AND m.role='history_page'
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

DROP VIEW commerce_settlement_observed_rows;
CREATE VIEW commerce_settlement_observed_rows AS
SELECT s.sequence AS assessment_sequence,s.order_id,t.*,
  CASE WHEN m.collection_sequence=s.seller_collection_sequence THEN
    CASE WHEN t.account_number=s.seller_cash THEN 'seller_cash' ELSE 'seller_pending' END
  ELSE CASE WHEN t.account_number=s.platform_cash THEN 'platform_cash' ELSE 'platform_pending' END END AS pocket
FROM commerce_settlement_scopes s JOIN commerce_provider_collection_observations m
  ON m.collection_sequence IN (s.seller_collection_sequence,s.platform_collection_sequence) AND m.role='history_page'
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

-- Compare each original window to later independent evidence, including reads
-- arriving between two windows during a recovered collection.
DROP VIEW commerce_payout_source_freshness;
CREATE VIEW commerce_payout_source_freshness AS
SELECT s.sequence AS assessment_sequence,
  s.status_sequence=(SELECT MAX(sequence) FROM commerce_withdrawal_status_observations WHERE withdrawal_id=s.withdrawal_id)
  AND NOT EXISTS(SELECT 1 FROM commerce_withdrawal_payment_receipts p WHERE p.withdrawal_id=s.withdrawal_id AND r.provider_reference IS NOT NULL AND p.provider_reference!=r.provider_reference)
  AND NOT EXISTS(
    SELECT 1 FROM commerce_provider_collection_spans w JOIN commerce_provider_financial_observations o INDEXED BY idx_provider_history_account
      ON o.enrollment_id=w.enrollment_id AND o.operation='transaction-history-list'
        AND json_extract(o.normalized_json,'$.accountNo')=w.account_number AND o.sequence>w.last_page_sequence
    WHERE w.collection_sequence IN (s.seller_collection_sequence,s.platform_collection_sequence)
    AND NOT EXISTS(SELECT 1 FROM commerce_provider_collection_observations own
      WHERE own.collection_sequence=w.collection_sequence AND own.observation_sequence=o.sequence)
      AND ((json_extract(o.normalized_json,'$.from')<=w.to_at AND json_extract(o.normalized_json,'$.to')>=w.from_at)
        OR EXISTS(SELECT 1 FROM commerce_provider_transaction_observations t WHERE t.observation_sequence=o.sequence
          AND (t.partner_reference=s.partner_reference OR t.provider_reference=r.provider_reference
            OR t.provider_reference IN (SELECT provider_reference FROM commerce_payout_group_rows WHERE assessment_sequence=s.sequence))))) AS current
FROM commerce_payout_scopes s JOIN commerce_payout_results r ON r.assessment_sequence=s.sequence;

-- Compare each original window to later independent evidence, including reads
-- arriving between two windows during a recovered collection.
DROP VIEW commerce_settlement_source_freshness;
CREATE VIEW commerce_settlement_source_freshness AS
SELECT s.sequence AS assessment_sequence,NOT EXISTS(
  SELECT 1 FROM commerce_provider_collection_spans w JOIN commerce_provider_financial_observations o INDEXED BY idx_provider_history_account
    ON o.enrollment_id=w.enrollment_id AND o.operation='transaction-history-list'
      AND json_extract(o.normalized_json,'$.accountNo')=w.account_number AND o.sequence>w.last_page_sequence
  WHERE w.collection_sequence IN (s.seller_collection_sequence,s.platform_collection_sequence)
    AND NOT EXISTS(SELECT 1 FROM commerce_provider_collection_observations own
      WHERE own.collection_sequence=w.collection_sequence AND own.observation_sequence=o.sequence)
    AND ((json_extract(o.normalized_json,'$.from')<=w.to_at AND json_extract(o.normalized_json,'$.to')>=w.from_at)
      OR EXISTS(SELECT 1 FROM commerce_provider_transaction_observations t WHERE t.observation_sequence=o.sequence
        AND (t.partner_reference=s.order_id OR t.provider_reference=r.provider_reference)))) AS current
FROM commerce_settlement_scopes s JOIN commerce_settlement_results r ON r.assessment_sequence=s.sequence;
