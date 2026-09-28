-- Jev review evidence is separate from commerce; it cannot erase orders or money.
CREATE TABLE jev_cases(id TEXT PRIMARY KEY,seller_id TEXT NOT NULL REFERENCES sellers(id),page_id TEXT NOT NULL,store_slug TEXT NOT NULL,evaluation_only INTEGER NOT NULL DEFAULT 0 CHECK(evaluation_only IN (0,1)),created_by TEXT NOT NULL,request_key TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,created_at TEXT NOT NULL,deadline_at TEXT NOT NULL);
CREATE TABLE jev_reviews(id TEXT PRIMARY KEY,case_id TEXT NOT NULL REFERENCES jev_cases(id),ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 3),request_key TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,revision TEXT NOT NULL,snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),report_text TEXT NOT NULL,policy_version TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(case_id,ordinal));
CREATE TABLE jev_attempts(id TEXT PRIMARY KEY,review_id TEXT NOT NULL UNIQUE REFERENCES jev_reviews(id),request_key TEXT NOT NULL UNIQUE,model TEXT NOT NULL,request_json TEXT NOT NULL CHECK(json_valid(request_json)),budget_microusd INTEGER NOT NULL CHECK(budget_microusd=10000),created_by TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE jev_results(review_id TEXT PRIMARY KEY REFERENCES jev_reviews(id),attempt_id TEXT NOT NULL UNIQUE REFERENCES jev_attempts(id),state TEXT NOT NULL CHECK(state IN ('completed','failed','uncertain')),outcome_json TEXT CHECK(outcome_json IS NULL OR json_valid(outcome_json)),provider_id TEXT,cost_microusd INTEGER CHECK(cost_microusd IS NULL OR cost_microusd>=0),input_tokens INTEGER,output_tokens INTEGER,failure_code TEXT,created_at TEXT NOT NULL);
CREATE TABLE jev_grades(id TEXT PRIMARY KEY,review_id TEXT NOT NULL REFERENCES jev_reviews(id),request_key TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),agreement TEXT NOT NULL CHECK(agreement IN ('agree','disagree','uncertain')),comment TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE jev_page_actions(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,seller_id TEXT NOT NULL REFERENCES sellers(id),page_id TEXT NOT NULL,review_id TEXT NOT NULL REFERENCES jev_reviews(id),revision TEXT NOT NULL,target_revision TEXT NOT NULL,action TEXT NOT NULL CHECK(action IN ('archive','restore')),actor_kind TEXT NOT NULL CHECK(actor_kind IN ('jev','reviewer')),actor_id TEXT NOT NULL,request_key TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX jev_case_page ON jev_cases(seller_id,page_id,created_at);
CREATE INDEX jev_action_page ON jev_page_actions(seller_id,page_id,sequence DESC);
CREATE VIEW jev_page_holds AS SELECT a.* FROM jev_page_actions a WHERE a.action='archive' AND NOT EXISTS(SELECT 1 FROM jev_page_actions n WHERE n.seller_id=a.seller_id AND n.page_id=a.page_id AND n.sequence>a.sequence);
CREATE TRIGGER jev_review_rescan BEFORE INSERT ON jev_reviews WHEN NEW.ordinal>0 BEGIN
 SELECT RAISE(ABORT,'jev_rescan_limit') WHERE NOT EXISTS(SELECT 1 FROM jev_cases c JOIN jev_reviews r ON r.case_id=c.id AND r.ordinal=NEW.ordinal-1 WHERE c.id=NEW.case_id AND c.deadline_at>NEW.created_at AND EXISTS(SELECT 1 FROM jev_results z WHERE z.review_id=r.id AND z.state='completed'));
END;
CREATE TRIGGER jev_result_source BEFORE INSERT ON jev_results BEGIN
 SELECT RAISE(ABORT,'jev_result_mismatch') WHERE NOT EXISTS(SELECT 1 FROM jev_attempts a WHERE a.id=NEW.attempt_id AND a.review_id=NEW.review_id);
END;
CREATE TRIGGER jev_action_source BEFORE INSERT ON jev_page_actions BEGIN
 SELECT RAISE(ABORT,'jev_action_mismatch') WHERE NOT EXISTS(SELECT 1 FROM jev_reviews r JOIN jev_cases c ON c.id=r.case_id WHERE r.id=NEW.review_id AND c.seller_id=NEW.seller_id AND c.page_id=NEW.page_id AND r.revision=NEW.revision);
 SELECT RAISE(ABORT,'jev_archive_evidence') WHERE NEW.actor_kind='jev' AND (NEW.action!='archive' OR NOT EXISTS(SELECT 1 FROM jev_results z WHERE z.review_id=NEW.review_id AND z.state='completed' AND json_extract(z.outcome_json,'$.verdict')='needs_change' AND json_array_length(z.outcome_json,'$.findings')>0 AND json_array_length(z.outcome_json,'$.uncertainties')=0));
END;
CREATE TRIGGER jev_cases_no_update BEFORE UPDATE ON jev_cases BEGIN SELECT RAISE(ABORT,'jev_immutable'); END;
CREATE TRIGGER jev_cases_no_delete BEFORE DELETE ON jev_cases BEGIN SELECT RAISE(ABORT,'jev_immutable'); END;
CREATE TRIGGER jev_reviews_no_update BEFORE UPDATE ON jev_reviews BEGIN SELECT RAISE(ABORT,'jev_immutable'); END;
CREATE TRIGGER jev_reviews_no_delete BEFORE DELETE ON jev_reviews BEGIN SELECT RAISE(ABORT,'jev_immutable'); END;
CREATE TRIGGER jev_attempts_no_update BEFORE UPDATE ON jev_attempts BEGIN SELECT RAISE(ABORT,'jev_immutable'); END;
CREATE TRIGGER jev_attempts_no_delete BEFORE DELETE ON jev_attempts BEGIN SELECT RAISE(ABORT,'jev_immutable'); END;
CREATE TRIGGER jev_results_no_update BEFORE UPDATE ON jev_results BEGIN SELECT RAISE(ABORT,'jev_immutable'); END;
CREATE TRIGGER jev_results_no_delete BEFORE DELETE ON jev_results BEGIN SELECT RAISE(ABORT,'jev_immutable'); END;
CREATE TRIGGER jev_grades_no_update BEFORE UPDATE ON jev_grades BEGIN SELECT RAISE(ABORT,'jev_immutable'); END;
CREATE TRIGGER jev_grades_no_delete BEFORE DELETE ON jev_grades BEGIN SELECT RAISE(ABORT,'jev_immutable'); END;
CREATE TRIGGER jev_page_actions_no_update BEFORE UPDATE ON jev_page_actions BEGIN SELECT RAISE(ABORT,'jev_immutable'); END;
CREATE TRIGGER jev_page_actions_no_delete BEFORE DELETE ON jev_page_actions BEGIN SELECT RAISE(ABORT,'jev_immutable'); END;
ALTER TABLE jev_results ADD COLUMN rejected_output TEXT CHECK(rejected_output IS NULL OR length(rejected_output)<=16000);
ALTER TABLE jev_page_actions ADD COLUMN supersedes_action_id TEXT;
CREATE TRIGGER jev_restore_hold BEFORE INSERT ON jev_page_actions WHEN NEW.action='restore' BEGIN
 SELECT RAISE(ABORT,'jev_hold_changed') WHERE NOT EXISTS(SELECT 1 FROM jev_page_holds h JOIN jev_reviews hr ON hr.id=h.review_id JOIN jev_reviews rr ON rr.id=NEW.review_id WHERE h.seller_id=NEW.seller_id AND h.page_id=NEW.page_id AND h.id=NEW.supersedes_action_id AND hr.case_id=rr.case_id);
END;
CREATE TRIGGER jev_auto_override BEFORE INSERT ON jev_page_actions WHEN NEW.actor_kind='jev' BEGIN
 SELECT RAISE(ABORT,'jev_human_override') WHERE EXISTS(SELECT 1 FROM jev_page_actions a JOIN jev_attempts t ON t.id=NEW.actor_id WHERE a.seller_id=NEW.seller_id AND a.page_id=NEW.page_id AND a.actor_kind='reviewer' AND a.created_at>=t.created_at);
END;

-- Ordinary page saves and moderation actions share a serialized revision fence.
-- R2 receipts carry the write token; uncertain writes never expire into permission.
CREATE TABLE jev_page_revisions(
 seller_id TEXT NOT NULL REFERENCES sellers(id),page_id TEXT NOT NULL,current_revision TEXT NOT NULL,
 write_token TEXT UNIQUE,write_base_revision TEXT,write_started_at TEXT,
 PRIMARY KEY(seller_id,page_id),
 CHECK((write_token IS NULL AND write_base_revision IS NULL AND write_started_at IS NULL) OR
       (write_token IS NOT NULL AND write_base_revision IS NOT NULL AND write_started_at IS NOT NULL))
);
CREATE TRIGGER jev_action_current_revision BEFORE INSERT ON jev_page_actions BEGIN
 SELECT RAISE(ABORT,'jev_page_revision_changed') WHERE NOT EXISTS(
  SELECT 1 FROM jev_page_revisions p WHERE p.seller_id=NEW.seller_id AND p.page_id=NEW.page_id
   AND p.current_revision=NEW.target_revision AND p.write_token IS NULL
 );
END;
CREATE TRIGGER jev_review_current_revision BEFORE INSERT ON jev_reviews
 WHEN EXISTS(SELECT 1 FROM jev_cases c WHERE c.id=NEW.case_id AND c.evaluation_only=0) BEGIN
 SELECT RAISE(ABORT,'jev_page_revision_changed') WHERE NOT EXISTS(
  SELECT 1 FROM jev_page_revisions p JOIN jev_cases c ON c.seller_id=p.seller_id AND c.page_id=p.page_id
   WHERE c.id=NEW.case_id AND p.current_revision=NEW.revision AND p.write_token IS NULL
 );
END;
