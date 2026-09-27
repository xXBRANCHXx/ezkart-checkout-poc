-- Operational retry metadata never changes published file retention or delivery.
ALTER TABLE digital_file_uploads ADD COLUMN cleanup_attempts INTEGER NOT NULL DEFAULT 0 CHECK (cleanup_attempts>=0);
ALTER TABLE digital_file_uploads ADD COLUMN cleanup_attempted_at TEXT;
ALTER TABLE digital_file_uploads ADD COLUMN cleanup_retry_after TEXT;
ALTER TABLE digital_file_uploads ADD COLUMN cleanup_error_code TEXT CHECK (cleanup_error_code IS NULL OR cleanup_error_code='cleanup_unconfirmed');
CREATE INDEX idx_digital_cleanup_retry ON digital_file_uploads(cleanup_retry_after,expires_at,id) WHERE retained_at IS NULL AND state!='deleted';

-- One bounded heartbeat, not an unbounded log of hourly empty runs. A lease
-- prevents overlapping maintenance from spending the same batch allowance.
CREATE TABLE digital_file_maintenance (
  singleton INTEGER PRIMARY KEY CHECK (singleton=1),
  run_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  lease_until TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('running','completed','partial','failed')),
  selected_count INTEGER NOT NULL DEFAULT 0 CHECK (selected_count BETWEEN 0 AND 5),
  removed_count INTEGER NOT NULL DEFAULT 0 CHECK (removed_count BETWEEN 0 AND 5),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count BETWEEN 0 AND 5),
  error_code TEXT CHECK (error_code IS NULL OR error_code='cleanup_unconfirmed'),
  CHECK (removed_count+failed_count<=selected_count),
  CHECK ((state='running' AND finished_at IS NULL) OR (state!='running' AND finished_at IS NOT NULL))
);
