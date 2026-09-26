-- Observed provider facts are evidence, never settlement or spendable funds.
CREATE TABLE commerce_provider_financial_observations (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  enrollment_id TEXT NOT NULL REFERENCES commerce_wallet_provider_profiles(enrollment_id) ON DELETE RESTRICT,
  seller_id TEXT NOT NULL REFERENCES sellers(id) ON DELETE RESTRICT,
  commerce_environment TEXT NOT NULL CHECK (commerce_environment IN ('sandbox','production')),
  credential_fingerprint TEXT NOT NULL CHECK (length(credential_fingerprint)=64),
  operation TEXT NOT NULL CHECK (operation IN ('balance-inquiries','transaction-history-list')),
  external_id TEXT NOT NULL CHECK (length(external_id)=32 AND external_id NOT GLOB '*[^0-9]*'),
  provider_day TEXT NOT NULL,
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  normalized_json TEXT NOT NULL CHECK (json_valid(normalized_json)),
  evidence_hash TEXT NOT NULL CHECK (length(evidence_hash)=64),
  requested_at TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  UNIQUE(credential_fingerprint,provider_day,external_id)
);
CREATE INDEX provider_financial_observations_seller ON commerce_provider_financial_observations(seller_id,commerce_environment,sequence DESC);

CREATE TABLE commerce_provider_balance_observations (
  observation_sequence INTEGER NOT NULL REFERENCES commerce_provider_financial_observations(sequence) ON DELETE RESTRICT,
  account_type TEXT NOT NULL CHECK (account_type IN ('DOKU_MERCHANT_IDR','DOKU_MERCHANT_PENDING_IDR')),
  account_number TEXT NOT NULL,
  available_amount TEXT NOT NULL,
  reserved_amount TEXT NOT NULL,
  PRIMARY KEY(observation_sequence,account_type)
);
CREATE TABLE commerce_provider_transaction_observations (
  observation_sequence INTEGER NOT NULL REFERENCES commerce_provider_financial_observations(sequence) ON DELETE RESTRICT,
  row_index INTEGER NOT NULL CHECK (row_index BETWEEN 0 AND 19),
  account_number TEXT NOT NULL,
  provider_reference TEXT NOT NULL,
  partner_reference TEXT,
  transaction_type TEXT NOT NULL,
  mutation_type TEXT NOT NULL CHECK (mutation_type IN ('CREDIT','DEBIT')),
  amount TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency='IDR'),
  provider_status TEXT NOT NULL CHECK (provider_status IN ('SUCCESS','PENDING','FAILED','VOID')),
  occurred_at TEXT NOT NULL,
  row_json TEXT NOT NULL CHECK (json_valid(row_json)),
  PRIMARY KEY(observation_sequence,row_index)
);

CREATE TRIGGER provider_financial_observation_source BEFORE INSERT ON commerce_provider_financial_observations BEGIN
  SELECT RAISE(ABORT,'provider_observation_scope') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_wallet_enrollments e JOIN commerce_wallet_provider_profiles p ON p.enrollment_id=e.id
      JOIN commerce_wallet_provider_bindings b ON b.enrollment_id=e.id
    WHERE e.id=NEW.enrollment_id AND e.seller_id=NEW.seller_id AND e.commerce_environment=NEW.commerce_environment
      AND b.credential_fingerprint=NEW.credential_fingerprint
      AND json_type(NEW.response_json,'$.responseCode')='text' AND json_extract(NEW.response_json,'$.responseCode') GLOB '200[0-9][0-9][0-9][0-9]'
      AND ((NEW.operation='balance-inquiries' AND json_extract(NEW.request_json,'$.profileId')=p.profile_id
        AND json_extract(NEW.response_json,'$.profileId')=p.profile_id AND json_extract(NEW.normalized_json,'$.profileId')=p.profile_id
        AND json_array_length(NEW.normalized_json,'$.accounts')=2
        AND EXISTS(SELECT 1 FROM json_each(NEW.normalized_json,'$.accounts') a WHERE json_extract(a.value,'$.type')='DOKU_MERCHANT_IDR' AND json_extract(a.value,'$.accountNo')=p.cash_account)
        AND EXISTS(SELECT 1 FROM json_each(NEW.normalized_json,'$.accounts') a WHERE json_extract(a.value,'$.type')='DOKU_MERCHANT_PENDING_IDR' AND json_extract(a.value,'$.accountNo')=p.pending_account))
        OR (NEW.operation='transaction-history-list' AND json_extract(NEW.request_json,'$.accountNo') IN (p.cash_account,p.pending_account)
          AND json_extract(NEW.normalized_json,'$.accountNo')=json_extract(NEW.request_json,'$.accountNo')
          AND json_array_length(NEW.normalized_json,'$.items') BETWEEN 0 AND 20))
  );
  SELECT RAISE(ABORT,'provider_observation_immutable') WHERE EXISTS (
    SELECT 1 FROM commerce_provider_financial_observations WHERE id=NEW.id OR (credential_fingerprint=NEW.credential_fingerprint AND provider_day=NEW.provider_day AND external_id=NEW.external_id)
  );
END;
CREATE TRIGGER provider_financial_observation_rows AFTER INSERT ON commerce_provider_financial_observations BEGIN
  INSERT INTO commerce_provider_balance_observations(observation_sequence,account_type,account_number,available_amount,reserved_amount)
    SELECT NEW.sequence,json_extract(a.value,'$.type'),json_extract(a.value,'$.accountNo'),json_extract(a.value,'$.available'),json_extract(a.value,'$.reserved')
    FROM json_each(NEW.normalized_json,'$.accounts') a WHERE NEW.operation='balance-inquiries';
  INSERT INTO commerce_provider_transaction_observations(observation_sequence,row_index,account_number,provider_reference,partner_reference,transaction_type,mutation_type,amount,currency,provider_status,occurred_at,row_json)
    SELECT NEW.sequence,CAST(a.key AS INTEGER),json_extract(NEW.normalized_json,'$.accountNo'),json_extract(a.value,'$.referenceNo'),json_extract(a.value,'$.partnerReferenceNo'),
      json_extract(a.value,'$.transactionType'),json_extract(a.value,'$.mutationType'),json_extract(a.value,'$.amount'),json_extract(a.value,'$.currency'),json_extract(a.value,'$.status'),json_extract(a.value,'$.dateTime'),a.value
    FROM json_each(NEW.normalized_json,'$.items') a WHERE NEW.operation='transaction-history-list';
END;
CREATE TRIGGER provider_balance_observation_source BEFORE INSERT ON commerce_provider_balance_observations BEGIN
  SELECT RAISE(ABORT,'provider_balance_observation_source') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_provider_financial_observations o,json_each(o.normalized_json,'$.accounts') a
    WHERE o.sequence=NEW.observation_sequence AND o.operation='balance-inquiries' AND json_extract(a.value,'$.type')=NEW.account_type
      AND json_extract(a.value,'$.accountNo')=NEW.account_number AND json_extract(a.value,'$.available')=NEW.available_amount AND json_extract(a.value,'$.reserved')=NEW.reserved_amount
  );
  SELECT RAISE(ABORT,'provider_observation_immutable') WHERE EXISTS(SELECT 1 FROM commerce_provider_balance_observations WHERE observation_sequence=NEW.observation_sequence AND account_type=NEW.account_type);
END;
CREATE TRIGGER provider_transaction_observation_source BEFORE INSERT ON commerce_provider_transaction_observations BEGIN
  SELECT RAISE(ABORT,'provider_transaction_observation_source') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_provider_financial_observations o,json_each(o.normalized_json,'$.items') a
    WHERE o.sequence=NEW.observation_sequence AND o.operation='transaction-history-list' AND CAST(a.key AS INTEGER)=NEW.row_index
      AND json_extract(o.normalized_json,'$.accountNo')=NEW.account_number AND a.value=NEW.row_json
      AND json_extract(a.value,'$.referenceNo')=NEW.provider_reference AND json_extract(a.value,'$.partnerReferenceNo') IS NEW.partner_reference
      AND json_extract(a.value,'$.transactionType')=NEW.transaction_type AND json_extract(a.value,'$.mutationType')=NEW.mutation_type
      AND json_extract(a.value,'$.amount')=NEW.amount AND json_extract(a.value,'$.currency')=NEW.currency
      AND json_extract(a.value,'$.status')=NEW.provider_status AND json_extract(a.value,'$.dateTime')=NEW.occurred_at
  );
  SELECT RAISE(ABORT,'provider_observation_immutable') WHERE EXISTS(SELECT 1 FROM commerce_provider_transaction_observations WHERE observation_sequence=NEW.observation_sequence AND row_index=NEW.row_index);
END;
CREATE TRIGGER provider_observations_no_update BEFORE UPDATE ON commerce_provider_financial_observations BEGIN SELECT RAISE(ABORT,'provider_observation_immutable'); END;
CREATE TRIGGER provider_observations_no_delete BEFORE DELETE ON commerce_provider_financial_observations BEGIN SELECT RAISE(ABORT,'provider_observation_immutable'); END;
CREATE TRIGGER provider_balances_no_update BEFORE UPDATE ON commerce_provider_balance_observations BEGIN SELECT RAISE(ABORT,'provider_observation_immutable'); END;
CREATE TRIGGER provider_balances_no_delete BEFORE DELETE ON commerce_provider_balance_observations BEGIN SELECT RAISE(ABORT,'provider_observation_immutable'); END;
CREATE TRIGGER provider_transactions_no_update BEFORE UPDATE ON commerce_provider_transaction_observations BEGIN SELECT RAISE(ABORT,'provider_observation_immutable'); END;
CREATE TRIGGER provider_transactions_no_delete BEFORE DELETE ON commerce_provider_transaction_observations BEGIN SELECT RAISE(ABORT,'provider_observation_immutable'); END;
