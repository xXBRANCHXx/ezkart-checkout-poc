-- Read-only provider observations. These never release a reservation, renew
-- payment authority, or post a final payout journal.
CREATE TABLE commerce_withdrawal_status_observations (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE CHECK(length(id)=49 AND substr(id,1,9)='wdstatus_' AND substr(id,10) NOT GLOB '*[^a-f0-9]*'),
  withdrawal_id TEXT NOT NULL REFERENCES commerce_withdrawal_payment_grants(withdrawal_id) ON DELETE RESTRICT,
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
CREATE INDEX withdrawal_status_time ON commerce_withdrawal_status_observations(withdrawal_id,requested_at,observed_at);

CREATE TRIGGER withdrawal_status_source BEFORE INSERT ON commerce_withdrawal_status_observations BEGIN
  SELECT RAISE(ABORT,'withdrawal_status_immutable') WHERE EXISTS(SELECT 1 FROM commerce_withdrawal_status_observations
    WHERE id=NEW.id OR (commerce_environment=NEW.commerce_environment AND client_id=NEW.client_id AND provider_day=NEW.provider_day AND external_id=NEW.external_id));
  SELECT RAISE(ABORT,'withdrawal_status_source') WHERE NOT EXISTS(
    SELECT 1 FROM commerce_withdrawal_payment_grants g JOIN commerce_withdrawal_inquiry_grants i ON i.withdrawal_id=g.withdrawal_id
    WHERE g.withdrawal_id=NEW.withdrawal_id AND g.commerce_environment=NEW.commerce_environment
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
  SELECT RAISE(ABORT,'withdrawal_status_source') WHERE NOT EXISTS(
    SELECT 1 FROM commerce_withdrawal_payment_grants g,
    json_each(json_array(json_extract(NEW.evidence_json,'$.responseBody'))) r
    WHERE g.withdrawal_id=NEW.withdrawal_id AND json_valid(r.value)
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
CREATE TRIGGER withdrawal_status_no_update BEFORE UPDATE ON commerce_withdrawal_status_observations BEGIN SELECT RAISE(ABORT,'withdrawal_status_immutable'); END;
CREATE TRIGGER withdrawal_status_no_delete BEFORE DELETE ON commerce_withdrawal_status_observations BEGIN SELECT RAISE(ABORT,'withdrawal_status_immutable'); END;
