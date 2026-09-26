-- Read-only provider investigations preserve their original intent and result.
-- A missing provider record is never evidence that an email was not sent.
CREATE TABLE commerce_campaign_email_lookups (
  lookup_key TEXT PRIMARY KEY CHECK(length(lookup_key)=32 AND lookup_key NOT GLOB '*[^a-f0-9]*'),
  request_id TEXT NOT NULL REFERENCES commerce_campaign_email_requests(id),
  provider_id TEXT NOT NULL CHECK(length(provider_id)=36),
  credential_hash TEXT NOT NULL CHECK(length(credential_hash)=64 AND credential_hash NOT GLOB '*[^a-f0-9]*'),
  reader_hash TEXT NOT NULL CHECK(length(reader_hash)=64 AND reader_hash NOT GLOB '*[^a-f0-9]*'),
  operator_id TEXT NOT NULL CHECK(length(operator_id) BETWEEN 3 AND 96 AND operator_id NOT GLOB '*[^A-Za-z0-9_-]*'),
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at)
);
CREATE INDEX commerce_campaign_email_lookups_request ON commerce_campaign_email_lookups(request_id,created_at,lookup_key);
CREATE INDEX commerce_campaign_email_lookups_rate ON commerce_campaign_email_lookups(created_at);
CREATE TABLE commerce_campaign_email_lookup_results (
  lookup_key TEXT PRIMARY KEY REFERENCES commerce_campaign_email_lookups(lookup_key),
  outcome TEXT NOT NULL CHECK(outcome IN ('matched','not_found','unavailable','rejected','invalid','mismatch','conflict')),
  http_status INTEGER NOT NULL CHECK(http_status BETWEEN 0 AND 599),
  raw_body TEXT CHECK(raw_body IS NULL OR length(raw_body)<=98304),
  body_hash TEXT CHECK(body_hash IS NULL OR (length(body_hash)=64 AND body_hash NOT GLOB '*[^a-f0-9]*')),
  kind TEXT CHECK(kind IS NULL OR kind IN ('accepted','sent','delivered','delayed','bounced','complained','failed','suppressed')),
  provider_created_at TEXT,
  observed_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',observed_at) IS observed_at),
  CHECK((raw_body IS NULL)=(body_hash IS NULL)),
  CHECK((outcome='matched' AND http_status=200 AND raw_body IS NOT NULL AND json_valid(raw_body) AND json_type(raw_body)='object'
    AND kind IS NOT NULL AND provider_created_at IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',provider_created_at) IS provider_created_at)
    OR (outcome!='matched' AND kind IS NULL AND provider_created_at IS NULL))
);
CREATE TABLE commerce_campaign_email_lookup_bindings (
  request_id TEXT PRIMARY KEY REFERENCES commerce_campaign_email_requests(id),
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  profile_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  lookup_key TEXT NOT NULL UNIQUE REFERENCES commerce_campaign_email_lookup_results(lookup_key),
  created_at TEXT NOT NULL,
  UNIQUE(commerce_environment,profile_id,provider_id)
);
CREATE VIEW commerce_campaign_email_verified_bindings AS
  SELECT request_id,commerce_environment,profile_id,provider_id,created_at FROM commerce_campaign_email_provider_bindings
  UNION ALL
  SELECT request_id,commerce_environment,profile_id,provider_id,created_at FROM commerce_campaign_email_lookup_bindings l
  WHERE NOT EXISTS(SELECT 1 FROM commerce_campaign_email_provider_bindings b WHERE b.request_id=l.request_id);
CREATE VIEW commerce_campaign_email_delivery_evidence AS
  SELECT request_id,kind,occurred_at,received_at AS observed_at,source FROM commerce_campaign_email_events
  UNION ALL
  SELECT l.request_id,r.kind,NULL AS occurred_at,r.observed_at,'lookup' AS source
  FROM commerce_campaign_email_lookup_results r JOIN commerce_campaign_email_lookups l ON l.lookup_key=r.lookup_key WHERE r.outcome='matched';
CREATE TABLE commerce_campaign_email_resolutions (
  resolution_key TEXT PRIMARY KEY CHECK(length(resolution_key)=32 AND resolution_key NOT GLOB '*[^a-f0-9]*'),
  request_id TEXT NOT NULL UNIQUE REFERENCES commerce_campaign_email_requests(id),
  lookup_key TEXT NOT NULL REFERENCES commerce_campaign_email_lookup_results(lookup_key),
  operator_id TEXT NOT NULL CHECK(length(operator_id) BETWEEN 3 AND 96 AND operator_id NOT GLOB '*[^A-Za-z0-9_-]*'),
  previous_state TEXT NOT NULL CHECK(previous_state IN ('dead','uncertain','retry')),
  previous_result TEXT NOT NULL CHECK(json_valid(previous_result)),
  previous_error TEXT NOT NULL,
  previous_updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at)
);
CREATE TRIGGER commerce_campaign_email_lookup_guard BEFORE INSERT ON commerce_campaign_email_lookups BEGIN
  SELECT RAISE(ABORT,'email_lookup_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_campaign_email_requests x WHERE x.id=NEW.request_id
    AND x.credential_hash=NEW.credential_hash AND EXISTS(SELECT 1 FROM commerce_campaign_email_starts s WHERE s.request_id=x.id));
  SELECT RAISE(ABORT,'email_lookup_provider_conflict') WHERE EXISTS(SELECT 1 FROM commerce_all_email_bindings b JOIN commerce_campaign_email_requests x ON x.id=NEW.request_id
    WHERE (b.request_id=x.id AND b.provider_id!=NEW.provider_id) OR (b.profile_id=x.profile_id AND b.commerce_environment=x.commerce_environment AND b.provider_id=NEW.provider_id AND b.request_id!=x.id));
  SELECT RAISE(ABORT,'email_lookup_rate') WHERE ((SELECT COUNT(*) FROM commerce_email_lookups WHERE created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute'))+(SELECT COUNT(*) FROM commerce_campaign_email_lookups WHERE created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute')))>=60
    OR (SELECT COUNT(*) FROM commerce_campaign_email_lookups WHERE request_id=NEW.request_id AND created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute'))>=3
    OR (SELECT COUNT(*) FROM commerce_campaign_email_lookups WHERE request_id=NEW.request_id AND created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day'))>=250;
  SELECT RAISE(ABORT,'email_immutable') WHERE EXISTS(SELECT 1 FROM commerce_campaign_email_lookups WHERE lookup_key=NEW.lookup_key);
END;
CREATE TRIGGER commerce_campaign_email_lookup_result_guard BEFORE INSERT ON commerce_campaign_email_lookup_results BEGIN
  SELECT RAISE(ABORT,'email_lookup_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_campaign_email_lookups WHERE lookup_key=NEW.lookup_key AND created_at<=NEW.observed_at);
  SELECT RAISE(ABORT,'email_lookup_invalid') WHERE NEW.outcome='matched' AND NOT EXISTS(
    SELECT 1 FROM commerce_campaign_email_lookups l JOIN commerce_campaign_email_requests x ON x.id=l.request_id WHERE l.lookup_key=NEW.lookup_key
      AND json_extract(NEW.raw_body,'$.object')='email' AND json_extract(NEW.raw_body,'$.id')=l.provider_id
      AND json_extract(NEW.raw_body,'$.from')=json_extract(x.request_json,'$.from')
      AND json_extract(NEW.raw_body,'$.subject')=json_extract(x.request_json,'$.subject')
      AND json_type(NEW.raw_body,'$.to')='array' AND json_array_length(NEW.raw_body,'$.to')=1 AND json_extract(NEW.raw_body,'$.to[0]')=x.recipient_email
      AND (json_type(NEW.raw_body,'$.cc') IS NULL OR json_type(NEW.raw_body,'$.cc')='null' OR (json_type(NEW.raw_body,'$.cc')='array' AND json_array_length(NEW.raw_body,'$.cc')=0))
      AND (json_type(NEW.raw_body,'$.bcc') IS NULL OR json_type(NEW.raw_body,'$.bcc')='null' OR (json_type(NEW.raw_body,'$.bcc')='array' AND json_array_length(NEW.raw_body,'$.bcc')=0))
      AND (json_type(NEW.raw_body,'$.reply_to') IS NULL OR json_type(NEW.raw_body,'$.reply_to')='null' OR (json_type(NEW.raw_body,'$.reply_to')='array' AND json_array_length(NEW.raw_body,'$.reply_to')=0))
      AND json_extract(NEW.raw_body,'$.scheduled_at') IS NULL
      AND json_type(NEW.raw_body,'$.tags')='array' AND json_array_length(NEW.raw_body,'$.tags')=4
      AND EXISTS(SELECT 1 FROM json_each(NEW.raw_body,'$.tags') WHERE json_extract(value,'$.name')='ezkart_delivery' AND json_extract(value,'$.value')=x.id)
      AND EXISTS(SELECT 1 FROM json_each(NEW.raw_body,'$.tags') WHERE json_extract(value,'$.name')='ezkart_environment' AND json_extract(value,'$.value')=x.commerce_environment)
      AND EXISTS(SELECT 1 FROM json_each(NEW.raw_body,'$.tags') WHERE json_extract(value,'$.name')='ezkart_profile' AND json_extract(value,'$.value')=x.profile_id)
      AND EXISTS(SELECT 1 FROM json_each(NEW.raw_body,'$.tags') WHERE json_extract(value,'$.name')='ezkart_purpose' AND json_extract(value,'$.value')='campaign')
      AND NEW.kind=CASE json_extract(NEW.raw_body,'$.last_event') WHEN 'sent' THEN 'sent' WHEN 'delivered' THEN 'delivered' WHEN 'delivery_delayed' THEN 'delayed'
        WHEN 'bounced' THEN 'bounced' WHEN 'complained' THEN 'complained' WHEN 'failed' THEN 'failed' WHEN 'suppressed' THEN 'suppressed' WHEN 'opened' THEN 'accepted' WHEN 'clicked' THEN 'accepted' END
      AND abs(julianday(NEW.provider_created_at)-julianday(CASE WHEN substr(json_extract(NEW.raw_body,'$.created_at'),-3)='+00'
        THEN json_extract(NEW.raw_body,'$.created_at')||':00' ELSE json_extract(NEW.raw_body,'$.created_at') END))<0.000000012
      AND NEW.provider_created_at>=(SELECT strftime('%Y-%m-%dT%H:%M:%fZ',MIN(created_at),'-5 minutes') FROM commerce_campaign_email_starts WHERE request_id=x.id)
      AND NEW.provider_created_at<=(SELECT strftime('%Y-%m-%dT%H:%M:%fZ',MAX(created_at),'+5 minutes') FROM commerce_campaign_email_starts WHERE request_id=x.id)
      AND NEW.provider_created_at<=strftime('%Y-%m-%dT%H:%M:%fZ',NEW.observed_at,'+5 minutes'));
  SELECT RAISE(ABORT,'email_lookup_provider_conflict') WHERE NEW.outcome='matched' AND EXISTS(
    SELECT 1 FROM commerce_campaign_email_lookups l JOIN commerce_campaign_email_requests x ON x.id=l.request_id JOIN commerce_all_email_bindings b
      ON b.request_id=x.id OR (b.profile_id=x.profile_id AND b.commerce_environment=x.commerce_environment AND b.provider_id=l.provider_id)
    WHERE l.lookup_key=NEW.lookup_key AND (b.request_id!=x.id OR b.provider_id!=l.provider_id));
  SELECT RAISE(ABORT,'email_immutable') WHERE EXISTS(SELECT 1 FROM commerce_campaign_email_lookup_results WHERE lookup_key=NEW.lookup_key);
END;
CREATE TRIGGER commerce_campaign_email_lookup_bind AFTER INSERT ON commerce_campaign_email_lookup_results WHEN NEW.outcome='matched' BEGIN
  INSERT INTO commerce_campaign_email_lookup_bindings(request_id,commerce_environment,profile_id,provider_id,lookup_key,created_at)
    SELECT x.id,x.commerce_environment,x.profile_id,l.provider_id,l.lookup_key,NEW.observed_at FROM commerce_campaign_email_lookups l JOIN commerce_campaign_email_requests x ON x.id=l.request_id
    WHERE l.lookup_key=NEW.lookup_key AND NOT EXISTS(SELECT 1 FROM commerce_campaign_email_lookup_bindings b WHERE b.request_id=x.id);
END;
CREATE TRIGGER commerce_campaign_email_lookup_binding_guard BEFORE INSERT ON commerce_campaign_email_lookup_bindings BEGIN
  SELECT RAISE(ABORT,'email_lookup_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_campaign_email_lookup_results r JOIN commerce_campaign_email_lookups l ON l.lookup_key=r.lookup_key
    JOIN commerce_campaign_email_requests x ON x.id=l.request_id WHERE r.lookup_key=NEW.lookup_key AND r.outcome='matched' AND r.observed_at=NEW.created_at
      AND x.id=NEW.request_id AND x.commerce_environment=NEW.commerce_environment AND x.profile_id=NEW.profile_id AND l.provider_id=NEW.provider_id);
  SELECT RAISE(ABORT,'email_lookup_provider_conflict') WHERE EXISTS(SELECT 1 FROM commerce_all_email_bindings b
    WHERE (b.request_id=NEW.request_id AND b.provider_id!=NEW.provider_id) OR (b.commerce_environment=NEW.commerce_environment AND b.profile_id=NEW.profile_id AND b.provider_id=NEW.provider_id AND b.request_id!=NEW.request_id));
  SELECT RAISE(ABORT,'email_immutable') WHERE EXISTS(SELECT 1 FROM commerce_campaign_email_lookup_bindings WHERE request_id=NEW.request_id);
END;
CREATE TRIGGER commerce_campaign_email_resolution_guard BEFORE INSERT ON commerce_campaign_email_resolutions BEGIN
  SELECT RAISE(ABORT,'email_resolution_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_campaign_email_requests x JOIN commerce_jobs j ON j.id=x.job_id
    JOIN commerce_campaign_email_lookups l ON l.request_id=x.id JOIN commerce_campaign_email_lookup_results r ON r.lookup_key=l.lookup_key
    JOIN commerce_campaign_email_verified_bindings b ON b.request_id=x.id AND b.provider_id=l.provider_id
    WHERE x.id=NEW.request_id AND l.lookup_key=NEW.lookup_key AND r.outcome='matched' AND r.observed_at<=NEW.created_at
      AND r.observed_at>=strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'-5 minutes') AND j.state=NEW.previous_state
      AND j.updated_at=NEW.previous_updated_at AND COALESCE(j.result_json,'{}')=NEW.previous_result AND j.last_error=NEW.previous_error
      AND (j.state IN ('uncertain','retry') OR (j.state='dead' AND (json_extract(j.result_json,'$.errorCode') IN ('email_send_uncertain','email_rate_limited','email_identity_unavailable')
        OR EXISTS(SELECT 1 FROM commerce_campaign_email_skips s WHERE s.job_id=j.id AND s.uncertain=1)))));
  SELECT RAISE(ABORT,'email_immutable') WHERE EXISTS(SELECT 1 FROM commerce_campaign_email_resolutions WHERE request_id=NEW.request_id OR resolution_key=NEW.resolution_key);
END;
CREATE TRIGGER commerce_campaign_email_resolution_apply AFTER INSERT ON commerce_campaign_email_resolutions BEGIN
  UPDATE commerce_jobs SET state='succeeded',result_json=json_object('deliveryId',NEW.request_id,'submitted',json('true'),'reconciled',json('true'),'resolutionKey',NEW.resolution_key),
    last_error='',completion_hash=NULL,lease_token=NULL,lease_owner=NULL,lease_until=NULL,lease_mode=NULL,updated_at=NEW.created_at
    WHERE id=(SELECT job_id FROM commerce_campaign_email_requests WHERE id=NEW.request_id);
END;
CREATE TRIGGER commerce_campaign_email_lookup_update BEFORE UPDATE ON commerce_campaign_email_lookups BEGIN SELECT RAISE(ABORT,'email_immutable'); END;
CREATE TRIGGER commerce_campaign_email_lookup_delete BEFORE DELETE ON commerce_campaign_email_lookups BEGIN SELECT RAISE(ABORT,'email_immutable'); END;
CREATE TRIGGER commerce_campaign_email_lookup_result_update BEFORE UPDATE ON commerce_campaign_email_lookup_results BEGIN SELECT RAISE(ABORT,'email_immutable'); END;
CREATE TRIGGER commerce_campaign_email_lookup_result_delete BEFORE DELETE ON commerce_campaign_email_lookup_results BEGIN SELECT RAISE(ABORT,'email_immutable'); END;
CREATE TRIGGER commerce_campaign_email_lookup_binding_update BEFORE UPDATE ON commerce_campaign_email_lookup_bindings BEGIN SELECT RAISE(ABORT,'email_immutable'); END;
CREATE TRIGGER commerce_campaign_email_lookup_binding_delete BEFORE DELETE ON commerce_campaign_email_lookup_bindings BEGIN SELECT RAISE(ABORT,'email_immutable'); END;
CREATE TRIGGER commerce_campaign_email_resolution_update BEFORE UPDATE ON commerce_campaign_email_resolutions BEGIN SELECT RAISE(ABORT,'email_immutable'); END;
CREATE TRIGGER commerce_campaign_email_resolution_delete BEFORE DELETE ON commerce_campaign_email_resolutions BEGIN SELECT RAISE(ABORT,'email_immutable'); END;



-- Both purposes share provider identity and suppression evidence.

DROP VIEW commerce_all_email_bindings;
CREATE VIEW commerce_all_email_bindings AS
  SELECT request_id,commerce_environment,profile_id,provider_id,created_at FROM commerce_email_verified_bindings
  UNION ALL SELECT request_id,commerce_environment,profile_id,provider_id,created_at FROM commerce_campaign_email_verified_bindings;

DROP VIEW commerce_email_suppressions;
CREATE VIEW commerce_email_suppressions AS
  SELECT x.commerce_environment,x.email_hash FROM commerce_email_requests x JOIN commerce_email_delivery_evidence e ON e.request_id=x.id
    WHERE e.kind IN ('bounced','complained','suppressed')
  UNION ALL SELECT x.commerce_environment,x.email_hash FROM commerce_campaign_email_requests x JOIN commerce_campaign_email_delivery_evidence e ON e.request_id=x.id
    WHERE e.kind IN ('bounced','complained','suppressed');

DROP VIEW commerce_campaign_delivery_status;
CREATE VIEW commerce_campaign_delivery_status AS
  SELECT c.id AS candidate_id,c.publication_id,j.id AS job_id,j.state AS job_state,x.id AS request_id,skip.reason AS skip_reason,
    CASE
      WHEN EXISTS(SELECT 1 FROM commerce_campaign_email_delivery_evidence e WHERE e.request_id=x.id AND e.kind='complained') THEN 'complained'
      WHEN EXISTS(SELECT 1 FROM commerce_campaign_email_delivery_evidence e WHERE e.request_id=x.id AND e.kind='bounced') THEN 'bounced'
      WHEN EXISTS(SELECT 1 FROM commerce_campaign_email_delivery_evidence e WHERE e.request_id=x.id AND e.kind='suppressed') THEN 'suppressed'
      WHEN EXISTS(SELECT 1 FROM commerce_campaign_email_delivery_evidence e WHERE e.request_id=x.id AND e.kind='failed') THEN 'failed'
      WHEN EXISTS(SELECT 1 FROM commerce_campaign_email_delivery_evidence e WHERE e.request_id=x.id AND e.kind='delivered') THEN 'delivered'
      WHEN EXISTS(SELECT 1 FROM commerce_campaign_email_delivery_evidence e WHERE e.request_id=x.id AND e.kind='delayed') THEN 'delayed'
      WHEN b.request_id IS NOT NULL THEN 'submitted'
      WHEN skip.uncertain=1 OR j.state='uncertain' THEN 'uncertain'
      WHEN skip.uncertain=0 AND skip.reason='cancelled' THEN 'cancelled'
      WHEN skip.uncertain=0 THEN 'skipped'
      WHEN json_extract(j.result_json,'$.cancelled')=1 AND j.attempts=0 THEN 'cancelled'
      WHEN j.state='dead' THEN 'needs_review'
      WHEN j.state='running' THEN 'sending'
      WHEN j.state='retry' THEN 'retry'
      ELSE 'queued' END AS delivery_state,
    CASE WHEN j.state IN ('uncertain','dead') AND COALESCE(json_extract(j.result_json,'$.cancelled'),0)!=1 OR (skip.uncertain=1 AND resolution.request_id IS NULL) THEN 1 ELSE 0 END AS needs_review,
    b.created_at AS submitted_at,
    (SELECT MIN(occurred_at) FROM commerce_campaign_email_delivery_evidence e WHERE e.request_id=x.id AND e.kind='delivered') AS delivered_at,
    EXISTS(SELECT 1 FROM commerce_campaign_email_delivery_evidence e WHERE e.request_id=x.id AND e.kind='delivered') AS delivered_confirmed,
    (SELECT MAX(r.observed_at) FROM commerce_campaign_email_lookup_results r JOIN commerce_campaign_email_lookups l ON l.lookup_key=r.lookup_key WHERE l.request_id=x.id) AS checked_at,
    resolution.created_at AS resolved_at
  FROM commerce_campaign_candidates c JOIN commerce_jobs j ON j.id='job_campaign_'||c.id
  LEFT JOIN commerce_campaign_email_requests x ON x.candidate_id=c.id
  LEFT JOIN commerce_campaign_email_verified_bindings b ON b.request_id=x.id
  LEFT JOIN commerce_campaign_email_skips skip ON skip.candidate_id=c.id
  LEFT JOIN commerce_campaign_email_resolutions resolution ON resolution.request_id=x.id;

DROP TRIGGER commerce_campaign_email_start_guard;
CREATE TRIGGER commerce_campaign_email_start_guard BEFORE INSERT ON commerce_campaign_email_starts BEGIN
  SELECT RAISE(ABORT,'campaign_email_immutable') WHERE EXISTS(SELECT 1 FROM commerce_campaign_email_starts WHERE attempt_id=NEW.attempt_id);
  SELECT RAISE(ABORT,'campaign_email_start_forbidden') WHERE NOT EXISTS(SELECT 1 FROM commerce_campaign_email_requests x JOIN commerce_jobs j ON j.id=x.job_id
    JOIN commerce_job_attempts a ON a.job_id=j.id JOIN commerce_campaign_delivery_sources c ON c.candidate_id=x.candidate_id
    WHERE x.id=NEW.request_id AND a.id=NEW.attempt_id AND a.lease_token=NEW.lease_token AND j.lease_token=NEW.lease_token
      AND j.state='running' AND j.lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now','+20 seconds') AND a.finished_at IS NULL
      AND x.retry_until>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND c.cancelled=0 AND c.send_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND c.send_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day') AND c.store_status='active' AND c.publisher_access=1 AND c.customer_access=1
      AND c.consent_allowed=1 AND c.current_consent_revision=c.consent_revision AND c.email=x.recipient_email
      AND (json_extract(c.data_json,'$.buttonLabel')='' OR c.current_shop_enabled=1)
      AND NEW.verified_at<=NEW.created_at AND NEW.verified_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-60 seconds')
      AND NEW.created_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','+5 seconds')
      AND NOT EXISTS(SELECT 1 FROM commerce_email_suppressions b WHERE b.commerce_environment=x.commerce_environment AND b.email_hash=x.email_hash)
      AND NOT EXISTS(SELECT 1 FROM commerce_campaign_email_skips skip WHERE skip.job_id=j.id)
      AND NOT EXISTS(SELECT 1 FROM commerce_campaign_email_verified_bindings b WHERE b.request_id=x.id));
END;

DROP TRIGGER commerce_campaign_email_skip_guard;
CREATE TRIGGER commerce_campaign_email_skip_guard BEFORE INSERT ON commerce_campaign_email_skips BEGIN
  SELECT RAISE(ABORT,'campaign_email_immutable') WHERE EXISTS(SELECT 1 FROM commerce_campaign_email_skips WHERE job_id=NEW.job_id OR candidate_id=NEW.candidate_id);
  SELECT RAISE(ABORT,'campaign_email_skip_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_jobs j WHERE j.id=NEW.job_id AND j.kind='campaign.send'
    AND j.id='job_campaign_'||NEW.candidate_id AND json_extract(j.payload_json,'$.candidateId')=NEW.candidate_id AND j.state='running' AND j.lease_token=NEW.source_lease_token
    AND j.lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  SELECT RAISE(ABORT,'campaign_email_skip_invalid') WHERE NEW.request_id IS NOT (SELECT id FROM commerce_campaign_email_requests WHERE job_id=NEW.job_id AND candidate_id=NEW.candidate_id)
    OR NEW.uncertain!=EXISTS(SELECT 1 FROM commerce_campaign_email_requests x JOIN commerce_campaign_email_starts a ON a.request_id=x.id WHERE x.job_id=NEW.job_id)
    OR EXISTS(SELECT 1 FROM commerce_campaign_email_requests x JOIN commerce_campaign_email_verified_bindings b ON b.request_id=x.id WHERE x.job_id=NEW.job_id);
END;

DROP TRIGGER commerce_campaign_job_complete;
CREATE TRIGGER commerce_campaign_job_complete BEFORE UPDATE OF state ON commerce_jobs WHEN NEW.kind='campaign.send' AND NEW.state='succeeded' BEGIN
  SELECT RAISE(ABORT,'campaign_delivery_receipt_required') WHERE NOT EXISTS(SELECT 1 FROM commerce_campaign_email_requests x JOIN commerce_campaign_email_verified_bindings b ON b.request_id=x.id WHERE x.job_id=NEW.id)
    AND NOT EXISTS(SELECT 1 FROM commerce_campaign_email_skips s WHERE s.job_id=NEW.id AND s.uncertain=0);
END;

DROP TRIGGER commerce_email_lookup_guard;
CREATE TRIGGER commerce_email_lookup_guard BEFORE INSERT ON commerce_email_lookups BEGIN
  SELECT RAISE(ABORT,'email_lookup_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_email_requests x WHERE x.id=NEW.request_id
    AND x.credential_hash=NEW.credential_hash AND EXISTS(SELECT 1 FROM commerce_email_starts s WHERE s.request_id=x.id));
  SELECT RAISE(ABORT,'email_lookup_provider_conflict') WHERE EXISTS(SELECT 1 FROM commerce_all_email_bindings b JOIN commerce_email_requests x ON x.id=NEW.request_id
    WHERE (b.request_id=x.id AND b.provider_id!=NEW.provider_id) OR (b.profile_id=x.profile_id AND b.commerce_environment=x.commerce_environment AND b.provider_id=NEW.provider_id AND b.request_id!=x.id));
  SELECT RAISE(ABORT,'email_lookup_rate') WHERE ((SELECT COUNT(*) FROM commerce_email_lookups WHERE created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute'))+(SELECT COUNT(*) FROM commerce_campaign_email_lookups WHERE created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute')))>=60
    OR (SELECT COUNT(*) FROM commerce_email_lookups WHERE request_id=NEW.request_id AND created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute'))>=3
    OR (SELECT COUNT(*) FROM commerce_email_lookups WHERE request_id=NEW.request_id AND created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day'))>=250;
  SELECT RAISE(ABORT,'email_immutable') WHERE EXISTS(SELECT 1 FROM commerce_email_lookups WHERE lookup_key=NEW.lookup_key);
END;
