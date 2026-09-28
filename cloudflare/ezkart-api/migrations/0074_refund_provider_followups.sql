-- Operator observations track one original manual DOKU case. They are never
-- authenticated provider evidence and cannot populate verified_outcomes.
CREATE TABLE commerce_refund_provider_followups (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  provider_request_id TEXT NOT NULL REFERENCES commerce_refund_provider_requests(id),
  previous_id TEXT REFERENCES commerce_refund_provider_followups(id),
  actor_auth_user_id TEXT NOT NULL,
  proof_expires_at INTEGER NOT NULL,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('started','uncertain','processing','needs_information','declined','returned_reported')),
  reference TEXT NOT NULL CHECK(length(reference) BETWEEN 3 AND 200),
  observed_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE(actor_auth_user_id,request_key)
);
CREATE INDEX idx_refund_followup_latest ON commerce_refund_provider_followups(provider_request_id,sequence DESC);
CREATE VIEW commerce_refund_current_followup AS SELECT f.* FROM commerce_refund_provider_followups f
 WHERE f.sequence=(SELECT MAX(x.sequence) FROM commerce_refund_provider_followups x WHERE x.provider_request_id=f.provider_request_id);
CREATE TRIGGER refund_followup_insert BEFORE INSERT ON commerce_refund_provider_followups BEGIN
  SELECT RAISE(ABORT,'refund_handoff_immutable') WHERE EXISTS(SELECT 1 FROM commerce_refund_provider_followups WHERE sequence=NEW.sequence OR id=NEW.id
    OR (actor_auth_user_id=NEW.actor_auth_user_id AND request_key=NEW.request_key));
  SELECT RAISE(ABORT,'refund_handoff_actor_forbidden') WHERE NOT EXISTS(SELECT 1 FROM commerce_refund_provider_requests q JOIN commerce_refunds r ON r.id=q.refund_id
    JOIN commerce_support_staff p ON p.commerce_environment=r.commerce_environment WHERE q.id=NEW.provider_request_id AND p.auth_user_id=NEW.actor_auth_user_id AND p.role='reviewer');
  SELECT RAISE(ABORT,'refund_handoff_proof_expired') WHERE NEW.proof_expires_at<=unixepoch('now') OR NEW.proof_expires_at>unixepoch('now')+630;
  SELECT RAISE(ABORT,'refund_handoff_followup_changed') WHERE NEW.previous_id IS NOT (SELECT id FROM commerce_refund_current_followup WHERE provider_request_id=NEW.provider_request_id)
    OR EXISTS(SELECT 1 FROM commerce_refund_finalizations WHERE provider_request_id=NEW.provider_request_id);
  SELECT RAISE(ABORT,'refund_handoff_start_changed') WHERE NEW.state='started' AND (NEW.previous_id IS NOT NULL
    OR EXISTS(SELECT 1 FROM commerce_refund_provider_submissions WHERE provider_request_id=NEW.provider_request_id)
    OR NOT EXISTS(SELECT 1 FROM commerce_refund_provider_requests q JOIN commerce_refund_handoff_sources s ON s.refund_id=q.refund_id
      WHERE q.id=NEW.provider_request_id AND s.snapshot_json=q.snapshot_json));
  SELECT RAISE(ABORT,'refund_handoff_original_required') WHERE NEW.state!='started' AND NEW.previous_id IS NULL
    AND NOT EXISTS(SELECT 1 FROM commerce_refund_provider_submissions WHERE provider_request_id=NEW.provider_request_id);
  SELECT RAISE(ABORT,'refund_handoff_date_invalid') WHERE julianday(NEW.observed_at) IS NULL
    OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.observed_at) IS NOT NEW.observed_at
    OR julianday(NEW.observed_at)>julianday('now','+30 seconds')
    OR julianday(NEW.observed_at)<julianday((SELECT created_at FROM commerce_refund_provider_requests WHERE id=NEW.provider_request_id))
    OR julianday(NEW.observed_at)<julianday((SELECT submitted_at FROM commerce_refund_provider_submissions WHERE provider_request_id=NEW.provider_request_id))
    OR julianday(NEW.observed_at)<julianday((SELECT observed_at FROM commerce_refund_current_followup WHERE provider_request_id=NEW.provider_request_id));
END;
CREATE TRIGGER refund_followup_no_update BEFORE UPDATE ON commerce_refund_provider_followups BEGIN SELECT RAISE(ABORT,'refund_handoff_immutable'); END;
CREATE TRIGGER refund_followup_no_delete BEFORE DELETE ON commerce_refund_provider_followups BEGIN SELECT RAISE(ABORT,'refund_handoff_immutable'); END;
