-- Bounded operational heartbeat; no provider or financial authority.
CREATE TABLE commerce_payout_sync_runner (
  commerce_environment TEXT PRIMARY KEY CHECK(commerce_environment IN ('sandbox','production')),
  storage_id TEXT NOT NULL,
  run_id TEXT NOT NULL CHECK(length(run_id)=32 AND run_id NOT GLOB '*[^a-f0-9]*'),
  state TEXT NOT NULL CHECK(state IN ('running','held','idle','completed','retry','review','failed')),
  started_at TEXT NOT NULL,
  seen_at TEXT NOT NULL,
  lease_until TEXT NOT NULL,
  finished_at TEXT,
  result_hash TEXT,
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  runs INTEGER NOT NULL DEFAULT 1 CHECK(runs>0),
  failed_runs INTEGER NOT NULL DEFAULT 0 CHECK(failed_runs>=0),
  interrupted_runs INTEGER NOT NULL DEFAULT 0 CHECK(interrupted_runs>=0),
  last_failure_at TEXT,
  CHECK((finished_at IS NULL)=(state='running')),
  CHECK((result_hash IS NULL)=(result_json IS NULL))
);
CREATE TRIGGER payout_sync_runner_storage BEFORE UPDATE ON commerce_payout_sync_runner BEGIN
  SELECT RAISE(ABORT,'payout_sync_runner_storage_immutable') WHERE
    NEW.commerce_environment!=OLD.commerce_environment OR NEW.storage_id!=OLD.storage_id;
END;
CREATE TRIGGER payout_sync_runner_keep BEFORE DELETE ON commerce_payout_sync_runner BEGIN
  SELECT RAISE(ABORT,'payout_sync_runner_keep_history');
END;
