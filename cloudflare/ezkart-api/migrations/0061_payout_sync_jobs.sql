-- Read-only provider synchronization. These jobs cannot authorize a payment.
CREATE TABLE commerce_payout_sync_jobs (
  id TEXT PRIMARY KEY CHECK(length(id)=32 AND id NOT GLOB '*[^a-f0-9]*'),
  withdrawal_id TEXT NOT NULL REFERENCES commerce_withdrawal_payment_grants(withdrawal_id),
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  credential_fingerprint TEXT NOT NULL,
  platform_enrollment_id TEXT NOT NULL REFERENCES commerce_wallet_enrollments(id),
  state TEXT NOT NULL CHECK(state IN ('queued','running','retry','completed','review')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
  failures INTEGER NOT NULL DEFAULT 0 CHECK(failures BETWEEN 0 AND 8),
  max_pages INTEGER NOT NULL DEFAULT 40 CHECK(max_pages BETWEEN 1 AND 40),
  storage_id TEXT,
  lease_owner TEXT,
  lease_token TEXT,
  lease_until TEXT,
  completion_hash TEXT,
  available_at TEXT NOT NULL,
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((lease_owner IS NULL)=(lease_token IS NULL) AND (lease_token IS NULL)=(lease_until IS NULL))
);
CREATE UNIQUE INDEX idx_payout_sync_active ON commerce_payout_sync_jobs(commerce_environment,credential_fingerprint,platform_enrollment_id)
  WHERE state IN ('queued','running','retry');
CREATE INDEX idx_payout_sync_due ON commerce_payout_sync_jobs(commerce_environment,state,available_at);
CREATE INDEX idx_payout_sync_withdrawal ON commerce_payout_sync_jobs(withdrawal_id,created_at DESC,id);

CREATE TABLE commerce_payout_sync_attempts (
  job_id TEXT NOT NULL REFERENCES commerce_payout_sync_jobs(id),
  attempt INTEGER NOT NULL CHECK(attempt>0),
  lease_token TEXT NOT NULL UNIQUE,
  worker_id TEXT NOT NULL,
  storage_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  outcome TEXT CHECK(outcome IS NULL OR outcome IN ('continue','completed','review','error','expired')),
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  PRIMARY KEY(job_id,attempt),
  CHECK((finished_at IS NULL)=(outcome IS NULL))
);
CREATE TRIGGER payout_sync_original_insert BEFORE INSERT ON commerce_payout_sync_jobs BEGIN
  SELECT RAISE(ABORT,'payout_sync_original_required') WHERE NOT EXISTS(
    SELECT 1 FROM commerce_withdrawal_payment_grants g WHERE g.withdrawal_id=NEW.withdrawal_id
      AND g.commerce_environment=NEW.commerce_environment AND g.credential_fingerprint=NEW.credential_fingerprint
      AND g.platform_enrollment_id=NEW.platform_enrollment_id);
  SELECT RAISE(ABORT,'payout_sync_initial_state') WHERE NEW.state!='queued' OR NEW.attempts!=0 OR NEW.failures!=0
    OR NEW.storage_id IS NOT NULL OR NEW.lease_token IS NOT NULL OR NEW.completion_hash IS NOT NULL OR NEW.result_json IS NOT NULL;
END;
CREATE TRIGGER payout_sync_original_immutable BEFORE UPDATE ON commerce_payout_sync_jobs BEGIN
  SELECT RAISE(ABORT,'payout_sync_original_immutable') WHERE NEW.id!=OLD.id OR NEW.withdrawal_id!=OLD.withdrawal_id
    OR NEW.commerce_environment!=OLD.commerce_environment OR NEW.credential_fingerprint!=OLD.credential_fingerprint
    OR NEW.platform_enrollment_id!=OLD.platform_enrollment_id OR NEW.created_at!=OLD.created_at OR NEW.max_pages!=OLD.max_pages
    OR (OLD.storage_id IS NOT NULL AND NEW.storage_id IS NOT OLD.storage_id);
END;
CREATE TRIGGER payout_sync_jobs_keep BEFORE DELETE ON commerce_payout_sync_jobs BEGIN SELECT RAISE(ABORT,'payout_sync_keep_history'); END;
-- Recheck completion at the write boundary, not only in the request handler.
CREATE TRIGGER payout_sync_completion_guard BEFORE UPDATE ON commerce_payout_sync_jobs WHEN NEW.state='completed' AND OLD.state!='completed' BEGIN
  SELECT RAISE(ABORT,'payout_sync_completion_changed') WHERE
    NOT EXISTS(SELECT 1 FROM json_each(NEW.result_json,'$.coveredWithdrawals') WHERE value=NEW.withdrawal_id)
    OR EXISTS(SELECT 1 FROM json_each(NEW.result_json,'$.coveredWithdrawals') x
      LEFT JOIN commerce_withdrawal_payment_grants g ON g.withdrawal_id=x.value AND g.commerce_environment=NEW.commerce_environment
        AND g.credential_fingerprint=NEW.credential_fingerprint AND g.platform_enrollment_id=NEW.platform_enrollment_id
      LEFT JOIN commerce_payout_positions p ON p.withdrawal_id=g.withdrawal_id WHERE COALESCE(p.reconciled,0)!=1)
    OR EXISTS(SELECT 1 FROM json_each(NEW.result_json,'$.coveredOrders') x
      LEFT JOIN commerce_payment_route_bindings b ON b.order_id=x.value AND b.commerce_environment=NEW.commerce_environment
        AND b.credential_fingerprint=NEW.credential_fingerprint AND b.platform_enrollment_id=NEW.platform_enrollment_id
      LEFT JOIN commerce_payment_captures c ON c.order_id=b.order_id AND c.capture_kind='order_payment'
      LEFT JOIN commerce_earnings_positions e ON e.capture_id=c.id
      WHERE COALESCE(e.reconciled,0)!=1 OR NOT EXISTS(SELECT 1 FROM commerce_settlement_assessments a
        JOIN commerce_settlement_results r ON r.assessment_sequence=a.sequence AND r.state='settled'
        JOIN commerce_settlement_source_freshness f ON f.assessment_sequence=a.sequence AND f.current=1
        WHERE a.capture_id=c.id AND NOT EXISTS(SELECT 1 FROM commerce_settlement_assessments later WHERE later.capture_id=c.id AND later.sequence>a.sequence)))
    OR EXISTS(SELECT 1 FROM commerce_payout_scopes s JOIN commerce_payout_source_freshness f ON f.assessment_sequence=s.sequence AND f.current=0
      WHERE s.commerce_environment=NEW.commerce_environment AND (
        s.platform_enrollment_id IN (NEW.platform_enrollment_id,(SELECT enrollment_id FROM commerce_withdrawals WHERE id=NEW.withdrawal_id))
        OR s.seller_enrollment_id IN (NEW.platform_enrollment_id,(SELECT enrollment_id FROM commerce_withdrawals WHERE id=NEW.withdrawal_id)))
      AND NOT EXISTS(SELECT 1 FROM commerce_payout_assessments later WHERE later.withdrawal_id=s.withdrawal_id AND later.sequence>s.sequence))
    OR EXISTS(SELECT 1 FROM commerce_settlement_scopes s JOIN commerce_settlement_source_freshness f ON f.assessment_sequence=s.sequence AND f.current=0
      WHERE s.commerce_environment=NEW.commerce_environment AND (
        s.platform_enrollment_id IN (NEW.platform_enrollment_id,(SELECT enrollment_id FROM commerce_withdrawals WHERE id=NEW.withdrawal_id))
        OR s.seller_enrollment_id IN (NEW.platform_enrollment_id,(SELECT enrollment_id FROM commerce_withdrawals WHERE id=NEW.withdrawal_id)))
      AND NOT EXISTS(SELECT 1 FROM commerce_settlement_assessments later WHERE later.capture_id=s.capture_id AND later.sequence>s.sequence));
END;
CREATE TRIGGER payout_sync_attempt_source BEFORE INSERT ON commerce_payout_sync_attempts BEGIN
  SELECT RAISE(ABORT,'payout_sync_attempt_source') WHERE NEW.finished_at IS NOT NULL OR NEW.outcome IS NOT NULL OR NEW.result_json IS NOT NULL
    OR NOT EXISTS(SELECT 1 FROM commerce_payout_sync_jobs j WHERE j.id=NEW.job_id AND j.state='running' AND j.attempts=NEW.attempt
      AND j.lease_token=NEW.lease_token AND j.lease_owner=NEW.worker_id AND j.storage_id=NEW.storage_id);
END;
CREATE TRIGGER payout_sync_attempt_immutable BEFORE UPDATE ON commerce_payout_sync_attempts BEGIN
  SELECT RAISE(ABORT,'payout_sync_attempt_immutable') WHERE OLD.finished_at IS NOT NULL OR NEW.job_id!=OLD.job_id
    OR NEW.attempt!=OLD.attempt OR NEW.lease_token!=OLD.lease_token OR NEW.worker_id!=OLD.worker_id
    OR NEW.storage_id!=OLD.storage_id OR NEW.started_at!=OLD.started_at;
END;
CREATE TRIGGER payout_sync_attempts_keep BEFORE DELETE ON commerce_payout_sync_attempts BEGIN SELECT RAISE(ABORT,'payout_sync_keep_history'); END;
