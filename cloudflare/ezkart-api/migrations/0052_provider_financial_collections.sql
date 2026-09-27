-- An exhausted offset-page window is durable coverage, never an atomic provider
-- snapshot or evidence that money is settled. Keep every original response.
CREATE TABLE commerce_provider_financial_collections (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE CHECK (length(id)=45 AND substr(id,1,5)='fcol_' AND substr(id,6) NOT GLOB '*[^a-f0-9]*'),
  enrollment_id TEXT NOT NULL REFERENCES commerce_wallet_provider_profiles(enrollment_id) ON DELETE RESTRICT,
  seller_id TEXT NOT NULL REFERENCES sellers(id) ON DELETE RESTRICT,
  commerce_environment TEXT NOT NULL CHECK (commerce_environment IN ('sandbox','production')),
  credential_fingerprint TEXT NOT NULL CHECK (length(credential_fingerprint)=64),
  observation_ids_json TEXT NOT NULL CHECK (json_valid(observation_ids_json) AND json_type(observation_ids_json)='array' AND json_array_length(observation_ids_json) BETWEEN 4 AND 82),
  proof_hash TEXT NOT NULL UNIQUE CHECK (length(proof_hash)=64 AND proof_hash NOT GLOB '*[^a-f0-9]*'),
  recorded_at TEXT NOT NULL
);
CREATE INDEX idx_provider_collections_seller ON commerce_provider_financial_collections(seller_id,commerce_environment,sequence DESC);
CREATE TABLE commerce_provider_collection_observations (
  collection_sequence INTEGER NOT NULL REFERENCES commerce_provider_financial_collections(sequence) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 81),
  observation_sequence INTEGER NOT NULL REFERENCES commerce_provider_financial_observations(sequence) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('balance_before','history_page','balance_after')),
  account_type TEXT CHECK (account_type IN ('DOKU_MERCHANT_IDR','DOKU_MERCHANT_PENDING_IDR')),
  CHECK ((role='history_page')=(account_type IS NOT NULL)),
  PRIMARY KEY(collection_sequence,position),
  UNIQUE(collection_sequence,observation_sequence)
);
CREATE INDEX idx_provider_collection_source ON commerce_provider_collection_observations(observation_sequence,collection_sequence);
CREATE INDEX idx_provider_collection_coverage ON commerce_provider_collection_observations(collection_sequence,role,account_type);

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
      json_extract(o.normalized_json,'$.from')!=json_extract(h.normalized_json,'$.from')
      OR json_extract(o.normalized_json,'$.to')!=json_extract(h.normalized_json,'$.to')
      OR json_extract(o.normalized_json,'$.pageSize')!=json_extract(h.normalized_json,'$.pageSize')
      OR json_extract(o.normalized_json,'$.to')>b.requested_at));
  SELECT RAISE(ABORT,'provider_collection_accounts') WHERE
    (SELECT COUNT(DISTINCT json_extract(o.normalized_json,'$.accountNo')) FROM json_each(NEW.observation_ids_json) j
      JOIN commerce_provider_financial_observations o ON o.id=j.value WHERE o.operation='transaction-history-list')!=2;
  SELECT RAISE(ABORT,'provider_collection_pages') WHERE EXISTS(
    SELECT 1 FROM json_each(NEW.observation_ids_json) j JOIN commerce_provider_financial_observations o ON o.id=j.value
    WHERE o.operation='transaction-history-list' GROUP BY json_extract(o.normalized_json,'$.accountNo')
    HAVING COUNT(*)>40 OR MIN(json_extract(o.normalized_json,'$.page'))!=0
      OR MAX(json_extract(o.normalized_json,'$.page'))!=COUNT(*)-1
      OR COUNT(DISTINCT json_extract(o.normalized_json,'$.page'))!=COUNT(*));
  SELECT RAISE(ABORT,'provider_collection_page_order') WHERE EXISTS(
    SELECT 1 FROM json_each(NEW.observation_ids_json) j JOIN json_each(NEW.observation_ids_json) k ON j.key<k.key
      JOIN commerce_provider_financial_observations a ON a.id=j.value JOIN commerce_provider_financial_observations b ON b.id=k.value
    WHERE a.operation='transaction-history-list' AND b.operation='transaction-history-list'
      AND json_extract(a.normalized_json,'$.accountNo')=json_extract(b.normalized_json,'$.accountNo')
      AND (json_extract(a.normalized_json,'$.page')>=json_extract(b.normalized_json,'$.page')
        OR json_array_length(a.normalized_json,'$.items')<json_extract(a.normalized_json,'$.pageSize')));
  SELECT RAISE(ABORT,'provider_collection_history_order') WHERE EXISTS(
    SELECT 1 FROM json_each(NEW.observation_ids_json) j JOIN json_each(NEW.observation_ids_json) k ON j.key<k.key
      JOIN commerce_provider_financial_observations a ON a.id=j.value JOIN commerce_provider_financial_observations b ON b.id=k.value
    WHERE a.operation='transaction-history-list' AND b.operation='transaction-history-list'
      AND json_extract(a.normalized_json,'$.accountNo')=json_extract(b.normalized_json,'$.accountNo')
      AND json_extract(b.normalized_json,'$.page')=json_extract(a.normalized_json,'$.page')+1
      AND json_extract(b.normalized_json,'$.items[0].dateTime')>json_extract(a.normalized_json,'$.items[#-1].dateTime'));
  SELECT RAISE(ABORT,'provider_collection_overlap') WHERE EXISTS(
    SELECT 1 FROM json_each(NEW.observation_ids_json) j JOIN commerce_provider_financial_observations o ON o.id=j.value
      JOIN commerce_provider_transaction_observations t ON t.observation_sequence=o.sequence
    GROUP BY t.account_number,t.row_json HAVING COUNT(DISTINCT t.observation_sequence)>1);
END;
CREATE TRIGGER provider_collection_members AFTER INSERT ON commerce_provider_financial_collections BEGIN
  INSERT INTO commerce_provider_collection_observations(collection_sequence,position,observation_sequence,role,account_type)
  SELECT NEW.sequence,CAST(j.key AS INTEGER),o.sequence,
    CASE WHEN j.key=0 THEN 'balance_before' WHEN j.key=json_array_length(NEW.observation_ids_json)-1 THEN 'balance_after' ELSE 'history_page' END,
    CASE WHEN o.operation='balance-inquiries' THEN NULL WHEN json_extract(o.normalized_json,'$.accountNo')=p.cash_account THEN 'DOKU_MERCHANT_IDR' ELSE 'DOKU_MERCHANT_PENDING_IDR' END
  FROM json_each(NEW.observation_ids_json) j JOIN commerce_provider_financial_observations o ON o.id=j.value
    JOIN commerce_wallet_provider_profiles p ON p.enrollment_id=NEW.enrollment_id;
END;
CREATE TRIGGER provider_collection_member_source BEFORE INSERT ON commerce_provider_collection_observations BEGIN
  SELECT RAISE(ABORT,'provider_collection_immutable') WHERE EXISTS(SELECT 1 FROM commerce_provider_collection_observations
    WHERE collection_sequence=NEW.collection_sequence AND (position=NEW.position OR observation_sequence=NEW.observation_sequence));
  SELECT RAISE(ABORT,'provider_collection_member_source') WHERE NOT EXISTS(
    SELECT 1 FROM commerce_provider_financial_collections c,json_each(c.observation_ids_json) j
      JOIN commerce_provider_financial_observations o ON o.id=j.value
      JOIN commerce_wallet_provider_profiles p ON p.enrollment_id=c.enrollment_id
    WHERE c.sequence=NEW.collection_sequence AND j.key=NEW.position AND o.sequence=NEW.observation_sequence
      AND NEW.role=CASE WHEN j.key=0 THEN 'balance_before' WHEN j.key=json_array_length(c.observation_ids_json)-1 THEN 'balance_after' ELSE 'history_page' END
      AND NEW.account_type IS CASE WHEN o.operation='balance-inquiries' THEN NULL WHEN json_extract(o.normalized_json,'$.accountNo')=p.cash_account THEN 'DOKU_MERCHANT_IDR' ELSE 'DOKU_MERCHANT_PENDING_IDR' END);
END;
CREATE TRIGGER provider_collection_no_update BEFORE UPDATE ON commerce_provider_financial_collections BEGIN SELECT RAISE(ABORT,'provider_collection_immutable'); END;
CREATE TRIGGER provider_collection_no_delete BEFORE DELETE ON commerce_provider_financial_collections BEGIN SELECT RAISE(ABORT,'provider_collection_immutable'); END;
CREATE TRIGGER provider_collection_member_no_update BEFORE UPDATE ON commerce_provider_collection_observations BEGIN SELECT RAISE(ABORT,'provider_collection_immutable'); END;
CREATE TRIGGER provider_collection_member_no_delete BEFORE DELETE ON commerce_provider_collection_observations BEGIN SELECT RAISE(ABORT,'provider_collection_immutable'); END;
