-- Campaign requests have their own recipient authority. Transactional email
-- keeps its original tables; both purposes share provider identity/suppression.
CREATE TABLE commerce_campaign_email_requests (
  id TEXT PRIMARY KEY CHECK(length(id)=41 AND substr(id,1,9)='campmail_' AND substr(id,10) NOT GLOB '*[^a-f0-9]*'),
  job_id TEXT NOT NULL UNIQUE REFERENCES commerce_jobs(id),
  candidate_id INTEGER NOT NULL UNIQUE REFERENCES commerce_campaign_candidates(id),
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  profile_id TEXT NOT NULL CHECK(length(profile_id) BETWEEN 3 AND 64),
  credential_hash TEXT NOT NULL CHECK(length(credential_hash)=64 AND credential_hash NOT GLOB '*[^a-f0-9]*'),
  source_lease_token TEXT NOT NULL,
  sender_email TEXT NOT NULL CHECK(sender_email=lower(sender_email) AND length(sender_email) BETWEEN 3 AND 254),
  recipient_email TEXT NOT NULL CHECK(recipient_email=lower(trim(recipient_email)) AND length(recipient_email) BETWEEN 3 AND 160),
  email_hash TEXT NOT NULL CHECK(length(email_hash)=64 AND email_hash NOT GLOB '*[^a-f0-9]*'),
  confirmed_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',confirmed_at) IS confirmed_at),
  verified_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',verified_at) IS verified_at),
  unsubscribe_hash TEXT NOT NULL UNIQUE REFERENCES commerce_unsubscribe_tokens(token_hash),
  idempotency_key TEXT NOT NULL UNIQUE,
  request_json TEXT NOT NULL CHECK(json_valid(request_json) AND json_type(request_json)='object' AND length(CAST(request_json AS BLOB))<=65536),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^a-f0-9]*'),
  template_version TEXT NOT NULL CHECK(template_version='campaign-v1'),
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at),
  retry_until TEXT NOT NULL,
  CHECK(confirmed_at<=verified_at AND verified_at<=created_at),
  CHECK(retry_until=strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+23 hours')),
  CHECK(idempotency_key='ezkart_campaign/'||commerce_environment||'/'||id)
);
CREATE INDEX commerce_campaign_email_requests_address ON commerce_campaign_email_requests(commerce_environment,email_hash);
CREATE INDEX commerce_campaign_email_requests_store ON commerce_campaign_email_requests(seller_id,commerce_environment,created_at,id);
CREATE TABLE commerce_campaign_email_starts (
  attempt_id TEXT PRIMARY KEY REFERENCES commerce_job_attempts(id),
  request_id TEXT NOT NULL REFERENCES commerce_campaign_email_requests(id),
  lease_token TEXT NOT NULL,
  verified_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',verified_at) IS verified_at),
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at)
);
CREATE INDEX commerce_campaign_email_starts_request ON commerce_campaign_email_starts(request_id,created_at);
CREATE TABLE commerce_campaign_email_provider_bindings (
  request_id TEXT PRIMARY KEY REFERENCES commerce_campaign_email_requests(id),
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  profile_id TEXT NOT NULL,
  provider_id TEXT NOT NULL CHECK(length(provider_id)=36),
  event_id INTEGER NOT NULL REFERENCES commerce_campaign_email_events(id),
  created_at TEXT NOT NULL,
  UNIQUE(commerce_environment,profile_id,provider_id)
);
CREATE TABLE commerce_campaign_email_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL REFERENCES commerce_campaign_email_requests(id),
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  profile_id TEXT NOT NULL,
  provider_id TEXT NOT NULL CHECK(length(provider_id)=36),
  source TEXT NOT NULL CHECK(source IN ('api','webhook')),
  source_id TEXT NOT NULL CHECK(length(source_id) BETWEEN 8 AND 160),
  attempt_id TEXT REFERENCES commerce_campaign_email_starts(attempt_id),
  kind TEXT NOT NULL CHECK(kind IN ('accepted','sent','delivered','delayed','bounced','complained','failed','suppressed')),
  raw_json TEXT NOT NULL CHECK(json_valid(raw_json) AND json_type(raw_json)='object' AND length(CAST(raw_json AS BLOB))<=65536),
  body_hash TEXT NOT NULL CHECK(length(body_hash)=64 AND body_hash NOT GLOB '*[^a-f0-9]*'),
  occurred_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',occurred_at) IS occurred_at),
  received_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',received_at) IS received_at),
  UNIQUE(commerce_environment,profile_id,source,source_id),
  CHECK((source='api' AND kind='accepted' AND attempt_id IS NOT NULL) OR (source='webhook' AND kind!='accepted' AND attempt_id IS NULL)),
  CHECK(occurred_at<=strftime('%Y-%m-%dT%H:%M:%fZ',received_at,'+5 minutes'))
);
CREATE INDEX commerce_campaign_email_events_request ON commerce_campaign_email_events(request_id,kind,id);
CREATE TABLE commerce_campaign_email_skips (
  job_id TEXT PRIMARY KEY REFERENCES commerce_jobs(id),
  candidate_id INTEGER NOT NULL UNIQUE REFERENCES commerce_campaign_candidates(id),
  request_id TEXT REFERENCES commerce_campaign_email_requests(id),
  reason TEXT NOT NULL CHECK(reason IN ('before_activation','stale','cancelled','store_closed','access_removed','shop_disabled','preference_off','consent_changed','identity_invalid','address_changed','suppressed','test_recipient','provider_changed','retry_window_expired')),
  uncertain INTEGER NOT NULL CHECK(uncertain IN (0,1)),
  source_lease_token TEXT NOT NULL,
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at)
);
CREATE VIEW commerce_all_email_bindings AS
  SELECT request_id,commerce_environment,profile_id,provider_id,created_at FROM commerce_email_verified_bindings
  UNION ALL SELECT request_id,commerce_environment,profile_id,provider_id,created_at FROM commerce_campaign_email_provider_bindings;
CREATE VIEW commerce_email_suppressions AS
  SELECT x.commerce_environment,x.email_hash FROM commerce_email_requests x JOIN commerce_email_delivery_evidence e ON e.request_id=x.id
    WHERE e.kind IN ('bounced','complained','suppressed')
  UNION ALL SELECT x.commerce_environment,x.email_hash FROM commerce_campaign_email_requests x JOIN commerce_campaign_email_events e ON e.request_id=x.id
    WHERE e.kind IN ('bounced','complained','suppressed');
CREATE VIEW commerce_campaign_delivery_sources AS
  SELECT c.id AS candidate_id,c.publication_id,c.auth_user_id,c.email,c.consent_revision,p.seller_id,p.commerce_environment,
    p.store_name,p.shop_enabled,p.data_json,p.created_at AS publication_created_at,p.send_at,p.cancelled,s.status AS store_status,
    COALESCE(json_extract(s.settings_json,'$.storefront.enabled'),0) AS current_shop_enabled,
    EXISTS(SELECT 1 FROM seller_memberships m WHERE m.seller_id=p.seller_id AND m.auth_user_id=p.actor_id AND m.role!='viewer') AS publisher_access,
    EXISTS(SELECT 1 FROM orders o LEFT JOIN commerce_order_owners owner ON owner.order_id=o.id WHERE o.id=c.order_id
      AND o.seller_id=p.seller_id AND o.commerce_environment=p.commerce_environment AND o.customer_id=c.customer_id
      AND COALESCE(owner.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=c.auth_user_id) AS customer_access,
    COALESCE(consent.allowed,0) AS consent_allowed,COALESCE(consent.revision,0) AS current_consent_revision
  FROM commerce_campaign_candidates c JOIN commerce_campaign_publication_state p ON p.id=c.publication_id JOIN sellers s ON s.id=p.seller_id
  LEFT JOIN commerce_customer_consents consent ON consent.seller_id=p.seller_id AND consent.commerce_environment=p.commerce_environment
    AND consent.auth_user_id=c.auth_user_id AND consent.email=c.email;
-- Evidence and queue health are separate: a late delivered callback remains
-- visible even when a previous attempt exhausted its retries or was cancelled.
CREATE VIEW commerce_campaign_delivery_status AS
  SELECT c.id AS candidate_id,c.publication_id,j.id AS job_id,j.state AS job_state,x.id AS request_id,skip.reason AS skip_reason,
    CASE
      WHEN EXISTS(SELECT 1 FROM commerce_campaign_email_events e WHERE e.request_id=x.id AND e.kind='complained') THEN 'complained'
      WHEN EXISTS(SELECT 1 FROM commerce_campaign_email_events e WHERE e.request_id=x.id AND e.kind='bounced') THEN 'bounced'
      WHEN EXISTS(SELECT 1 FROM commerce_campaign_email_events e WHERE e.request_id=x.id AND e.kind='suppressed') THEN 'suppressed'
      WHEN EXISTS(SELECT 1 FROM commerce_campaign_email_events e WHERE e.request_id=x.id AND e.kind='failed') THEN 'failed'
      WHEN EXISTS(SELECT 1 FROM commerce_campaign_email_events e WHERE e.request_id=x.id AND e.kind='delivered') THEN 'delivered'
      WHEN EXISTS(SELECT 1 FROM commerce_campaign_email_events e WHERE e.request_id=x.id AND e.kind='delayed') THEN 'delayed'
      WHEN b.request_id IS NOT NULL THEN 'submitted'
      WHEN skip.uncertain=1 OR j.state='uncertain' THEN 'uncertain'
      WHEN skip.uncertain=0 AND skip.reason='cancelled' THEN 'cancelled'
      WHEN skip.uncertain=0 THEN 'skipped'
      WHEN json_extract(j.result_json,'$.cancelled')=1 AND j.attempts=0 THEN 'cancelled'
      WHEN j.state='dead' THEN 'needs_review'
      WHEN j.state='running' THEN 'sending'
      WHEN j.state='retry' THEN 'retry'
      ELSE 'queued' END AS delivery_state,
    CASE WHEN j.state IN ('uncertain','dead') AND COALESCE(json_extract(j.result_json,'$.cancelled'),0)!=1 OR skip.uncertain=1 THEN 1 ELSE 0 END AS needs_review,
    b.created_at AS submitted_at,
    (SELECT MIN(occurred_at) FROM commerce_campaign_email_events e WHERE e.request_id=x.id AND e.kind='delivered') AS delivered_at
  FROM commerce_campaign_candidates c JOIN commerce_jobs j ON j.id='job_campaign_'||c.id
  LEFT JOIN commerce_campaign_email_requests x ON x.candidate_id=c.id
  LEFT JOIN commerce_campaign_email_provider_bindings b ON b.request_id=x.id
  LEFT JOIN commerce_campaign_email_skips skip ON skip.candidate_id=c.id;

CREATE TRIGGER commerce_campaign_email_request_guard BEFORE INSERT ON commerce_campaign_email_requests BEGIN
  SELECT RAISE(ABORT,'campaign_email_immutable') WHERE EXISTS(SELECT 1 FROM commerce_campaign_email_requests WHERE id=NEW.id OR job_id=NEW.job_id OR candidate_id=NEW.candidate_id OR unsubscribe_hash=NEW.unsubscribe_hash);
  SELECT RAISE(ABORT,'campaign_email_request_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_campaign_delivery_sources c JOIN commerce_jobs j ON j.id='job_campaign_'||c.candidate_id
    JOIN commerce_unsubscribe_tokens t ON t.token_hash=NEW.unsubscribe_hash
    WHERE c.candidate_id=NEW.candidate_id AND j.id=NEW.job_id AND j.kind='campaign.send' AND c.seller_id=NEW.seller_id AND c.commerce_environment=NEW.commerce_environment
      AND j.seller_id=c.seller_id AND j.commerce_environment=c.commerce_environment AND json_extract(j.payload_json,'$.candidateId')=c.candidate_id
      AND json_extract(j.payload_json,'$.publicationId')=c.publication_id AND j.state='running' AND j.lease_token=NEW.source_lease_token
      AND j.lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now','+20 seconds') AND c.cancelled=0 AND c.send_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND c.store_status='active' AND c.publisher_access=1 AND c.customer_access=1 AND c.consent_allowed=1 AND c.consent_revision=c.current_consent_revision
      AND (json_extract(c.data_json,'$.buttonLabel')='' OR c.current_shop_enabled=1) AND c.email=NEW.recipient_email
      AND NEW.verified_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-60 seconds') AND NEW.created_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','+5 seconds')
      AND t.reference=NEW.id AND t.seller_id=c.seller_id AND t.commerce_environment=c.commerce_environment AND t.auth_user_id=c.auth_user_id
      AND t.email=c.email AND t.consent_revision=c.consent_revision);
  SELECT RAISE(ABORT,'campaign_email_request_invalid') WHERE json_type(NEW.request_json,'$.from') IS NOT 'text' OR json_extract(NEW.request_json,'$.from')!='Ezkart <'||NEW.sender_email||'>'
    OR json_type(NEW.request_json,'$.to') IS NOT 'array' OR json_array_length(NEW.request_json,'$.to')!=1 OR json_type(NEW.request_json,'$.to[0]') IS NOT 'text' OR json_extract(NEW.request_json,'$.to[0]') IS NOT NEW.recipient_email
    OR json_type(NEW.request_json,'$.subject') IS NOT 'text' OR length(json_extract(NEW.request_json,'$.subject')) NOT BETWEEN 1 AND 200
    OR json_type(NEW.request_json,'$.text') IS NOT 'text' OR length(json_extract(NEW.request_json,'$.text'))<1
    OR json_type(NEW.request_json,'$.html') IS NOT 'text' OR length(json_extract(NEW.request_json,'$.html'))<1 OR (SELECT COUNT(*) FROM json_each(NEW.request_json))!=7
    OR json_type(NEW.request_json,'$.tags') IS NOT 'array' OR json_array_length(NEW.request_json,'$.tags')!=4
    OR EXISTS(SELECT 1 FROM json_each(NEW.request_json,'$.tags') AS tag WHERE tag.type!='object' OR (SELECT COUNT(*) FROM json_each(tag.value))!=2)
    OR NOT EXISTS(SELECT 1 FROM json_each(NEW.request_json,'$.tags') WHERE json_extract(value,'$.name')='ezkart_delivery' AND json_extract(value,'$.value')=NEW.id)
    OR NOT EXISTS(SELECT 1 FROM json_each(NEW.request_json,'$.tags') WHERE json_extract(value,'$.name')='ezkart_environment' AND json_extract(value,'$.value')=NEW.commerce_environment)
    OR NOT EXISTS(SELECT 1 FROM json_each(NEW.request_json,'$.tags') WHERE json_extract(value,'$.name')='ezkart_profile' AND json_extract(value,'$.value')=NEW.profile_id)
    OR NOT EXISTS(SELECT 1 FROM json_each(NEW.request_json,'$.tags') WHERE json_extract(value,'$.name')='ezkart_purpose' AND json_extract(value,'$.value')='campaign')
    OR json_type(NEW.request_json,'$.headers') IS NOT 'object' OR (SELECT COUNT(*) FROM json_each(NEW.request_json,'$.headers'))!=2
    OR json_extract(NEW.request_json,'$.headers."List-Unsubscribe-Post"') IS NOT 'List-Unsubscribe=One-Click'
    OR json_type(NEW.request_json,'$.headers."List-Unsubscribe"') IS NOT 'text';
  SELECT RAISE(ABORT,'campaign_email_request_invalid') WHERE NOT EXISTS(SELECT 1 FROM (
    SELECT json_extract(NEW.request_json,'$.headers."List-Unsubscribe"') AS link,
      '<https://'||CASE NEW.commerce_environment WHEN 'sandbox' THEN 'test.ezkart.id' ELSE 'ezkart.id' END||'/cart/unsubscribe.php?t=' AS prefix)
    WHERE substr(link,1,length(prefix))=prefix AND length(link)=length(prefix)+65 AND substr(link,-1)='>'
      AND substr(link,length(prefix)+1,64) NOT GLOB '*[^a-f0-9]*'
      AND instr(json_extract(NEW.request_json,'$.text'),substr(link,2,length(link)-2))>0
      AND instr(json_extract(NEW.request_json,'$.html'),substr(link,2,length(link)-2))>0);
END;
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
      AND NOT EXISTS(SELECT 1 FROM commerce_campaign_email_provider_bindings b WHERE b.request_id=x.id));
END;
CREATE TRIGGER commerce_campaign_email_event_guard BEFORE INSERT ON commerce_campaign_email_events BEGIN
  SELECT RAISE(ABORT,'campaign_email_immutable') WHERE EXISTS(SELECT 1 FROM commerce_campaign_email_events WHERE id=NEW.id
    OR (commerce_environment=NEW.commerce_environment AND profile_id=NEW.profile_id AND source=NEW.source AND source_id=NEW.source_id));
  SELECT RAISE(ABORT,'campaign_email_event_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_campaign_email_requests x WHERE x.id=NEW.request_id
    AND x.commerce_environment=NEW.commerce_environment AND x.profile_id=NEW.profile_id
    AND EXISTS(SELECT 1 FROM commerce_campaign_email_starts a WHERE a.request_id=x.id)
    AND NEW.occurred_at>=strftime('%Y-%m-%dT%H:%M:%fZ',x.created_at,'-5 minutes')
    AND ((NEW.source='api' AND json_extract(NEW.raw_json,'$.id')=NEW.provider_id
      AND EXISTS(SELECT 1 FROM commerce_campaign_email_starts a WHERE a.attempt_id=NEW.attempt_id AND a.request_id=x.id))
    OR (NEW.source='webhook' AND json_extract(NEW.raw_json,'$.data.email_id')=NEW.provider_id
      AND json_extract(NEW.raw_json,'$.type')='email.'||(CASE NEW.kind WHEN 'delayed' THEN 'delivery_delayed' ELSE NEW.kind END)
      AND abs(julianday(json_extract(NEW.raw_json,'$.created_at'))-julianday(NEW.occurred_at))<0.000000012
      AND json_extract(NEW.raw_json,'$.data.from')=json_extract(x.request_json,'$.from')
      AND json_extract(NEW.raw_json,'$.data.subject')=json_extract(x.request_json,'$.subject')
      AND json_type(NEW.raw_json,'$.data.to')='array' AND json_array_length(NEW.raw_json,'$.data.to')=1 AND json_extract(NEW.raw_json,'$.data.to[0]')=x.recipient_email
      AND json_extract(NEW.raw_json,'$.data.tags.ezkart_delivery')=x.id AND json_extract(NEW.raw_json,'$.data.tags.ezkart_environment')=x.commerce_environment
      AND json_extract(NEW.raw_json,'$.data.tags.ezkart_profile')=x.profile_id AND json_extract(NEW.raw_json,'$.data.tags.ezkart_purpose')='campaign')));
  SELECT RAISE(ABORT,'email_provider_conflict') WHERE EXISTS(SELECT 1 FROM commerce_all_email_bindings b
    WHERE (b.request_id=NEW.request_id AND (b.provider_id!=NEW.provider_id OR b.profile_id!=NEW.profile_id OR b.commerce_environment!=NEW.commerce_environment))
      OR (b.provider_id=NEW.provider_id AND b.profile_id=NEW.profile_id AND b.commerce_environment=NEW.commerce_environment AND b.request_id!=NEW.request_id));
END;
CREATE TRIGGER commerce_campaign_email_event_bind AFTER INSERT ON commerce_campaign_email_events BEGIN
  INSERT INTO commerce_campaign_email_provider_bindings(request_id,commerce_environment,profile_id,provider_id,event_id,created_at)
    SELECT NEW.request_id,NEW.commerce_environment,NEW.profile_id,NEW.provider_id,NEW.id,NEW.received_at
    WHERE NOT EXISTS(SELECT 1 FROM commerce_campaign_email_provider_bindings WHERE request_id=NEW.request_id);
END;
CREATE TRIGGER commerce_campaign_email_binding_guard BEFORE INSERT ON commerce_campaign_email_provider_bindings BEGIN
  SELECT RAISE(ABORT,'campaign_email_immutable') WHERE EXISTS(SELECT 1 FROM commerce_campaign_email_provider_bindings WHERE request_id=NEW.request_id);
  SELECT RAISE(ABORT,'campaign_email_binding_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_campaign_email_events e WHERE e.id=NEW.event_id AND e.request_id=NEW.request_id
    AND e.commerce_environment=NEW.commerce_environment AND e.profile_id=NEW.profile_id AND e.provider_id=NEW.provider_id AND e.received_at=NEW.created_at);
  SELECT RAISE(ABORT,'email_provider_conflict') WHERE EXISTS(SELECT 1 FROM commerce_all_email_bindings b
    WHERE (b.request_id=NEW.request_id AND b.provider_id!=NEW.provider_id) OR (b.commerce_environment=NEW.commerce_environment AND b.profile_id=NEW.profile_id AND b.provider_id=NEW.provider_id AND b.request_id!=NEW.request_id));
END;
CREATE TRIGGER commerce_campaign_email_skip_guard BEFORE INSERT ON commerce_campaign_email_skips BEGIN
  SELECT RAISE(ABORT,'campaign_email_immutable') WHERE EXISTS(SELECT 1 FROM commerce_campaign_email_skips WHERE job_id=NEW.job_id OR candidate_id=NEW.candidate_id);
  SELECT RAISE(ABORT,'campaign_email_skip_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_jobs j WHERE j.id=NEW.job_id AND j.kind='campaign.send'
    AND j.id='job_campaign_'||NEW.candidate_id AND json_extract(j.payload_json,'$.candidateId')=NEW.candidate_id AND j.state='running' AND j.lease_token=NEW.source_lease_token
    AND j.lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  SELECT RAISE(ABORT,'campaign_email_skip_invalid') WHERE NEW.request_id IS NOT (SELECT id FROM commerce_campaign_email_requests WHERE job_id=NEW.job_id AND candidate_id=NEW.candidate_id)
    OR NEW.uncertain!=EXISTS(SELECT 1 FROM commerce_campaign_email_requests x JOIN commerce_campaign_email_starts a ON a.request_id=x.id WHERE x.job_id=NEW.job_id)
    OR EXISTS(SELECT 1 FROM commerce_campaign_email_requests x JOIN commerce_campaign_email_provider_bindings b ON b.request_id=x.id WHERE x.job_id=NEW.job_id);
END;
DROP TRIGGER commerce_campaign_job_complete;
CREATE TRIGGER commerce_campaign_job_complete BEFORE UPDATE OF state ON commerce_jobs WHEN NEW.kind='campaign.send' AND NEW.state='succeeded' BEGIN
  SELECT RAISE(ABORT,'campaign_delivery_receipt_required') WHERE NOT EXISTS(SELECT 1 FROM commerce_campaign_email_requests x JOIN commerce_campaign_email_provider_bindings b ON b.request_id=x.id WHERE x.job_id=NEW.id)
    AND NOT EXISTS(SELECT 1 FROM commerce_campaign_email_skips s WHERE s.job_id=NEW.id AND s.uncertain=0);
END;
CREATE TRIGGER commerce_campaign_email_request_update BEFORE UPDATE ON commerce_campaign_email_requests BEGIN SELECT RAISE(ABORT,'campaign_email_immutable'); END;
CREATE TRIGGER commerce_campaign_email_request_delete BEFORE DELETE ON commerce_campaign_email_requests BEGIN SELECT RAISE(ABORT,'campaign_email_immutable'); END;
CREATE TRIGGER commerce_campaign_email_start_update BEFORE UPDATE ON commerce_campaign_email_starts BEGIN SELECT RAISE(ABORT,'campaign_email_immutable'); END;
CREATE TRIGGER commerce_campaign_email_start_delete BEFORE DELETE ON commerce_campaign_email_starts BEGIN SELECT RAISE(ABORT,'campaign_email_immutable'); END;
CREATE TRIGGER commerce_campaign_email_binding_update BEFORE UPDATE ON commerce_campaign_email_provider_bindings BEGIN SELECT RAISE(ABORT,'campaign_email_immutable'); END;
CREATE TRIGGER commerce_campaign_email_binding_delete BEFORE DELETE ON commerce_campaign_email_provider_bindings BEGIN SELECT RAISE(ABORT,'campaign_email_immutable'); END;
CREATE TRIGGER commerce_campaign_email_event_update BEFORE UPDATE ON commerce_campaign_email_events BEGIN SELECT RAISE(ABORT,'campaign_email_immutable'); END;
CREATE TRIGGER commerce_campaign_email_event_delete BEFORE DELETE ON commerce_campaign_email_events BEGIN SELECT RAISE(ABORT,'campaign_email_immutable'); END;
CREATE TRIGGER commerce_campaign_email_skip_update BEFORE UPDATE ON commerce_campaign_email_skips BEGIN SELECT RAISE(ABORT,'campaign_email_immutable'); END;
CREATE TRIGGER commerce_campaign_email_skip_delete BEFORE DELETE ON commerce_campaign_email_skips BEGIN SELECT RAISE(ABORT,'campaign_email_immutable'); END;

-- Enforce the same provider identity and address suppression across purposes.
DROP TRIGGER commerce_email_lookup_guard;
CREATE TRIGGER commerce_email_lookup_guard BEFORE INSERT ON commerce_email_lookups BEGIN
  SELECT RAISE(ABORT,'email_lookup_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_email_requests x WHERE x.id=NEW.request_id
    AND x.credential_hash=NEW.credential_hash AND EXISTS(SELECT 1 FROM commerce_email_starts s WHERE s.request_id=x.id));
  SELECT RAISE(ABORT,'email_lookup_provider_conflict') WHERE EXISTS(SELECT 1 FROM commerce_all_email_bindings b JOIN commerce_email_requests x ON x.id=NEW.request_id
    WHERE (b.request_id=x.id AND b.provider_id!=NEW.provider_id) OR (b.profile_id=x.profile_id AND b.commerce_environment=x.commerce_environment AND b.provider_id=NEW.provider_id AND b.request_id!=x.id));
  SELECT RAISE(ABORT,'email_lookup_rate') WHERE (SELECT COUNT(*) FROM commerce_email_lookups WHERE created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute'))>=60
    OR (SELECT COUNT(*) FROM commerce_email_lookups WHERE request_id=NEW.request_id AND created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute'))>=3
    OR (SELECT COUNT(*) FROM commerce_email_lookups WHERE request_id=NEW.request_id AND created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day'))>=250;
  SELECT RAISE(ABORT,'email_immutable') WHERE EXISTS(SELECT 1 FROM commerce_email_lookups WHERE lookup_key=NEW.lookup_key);
END;
DROP TRIGGER commerce_email_lookup_result_guard;
CREATE TRIGGER commerce_email_lookup_result_guard BEFORE INSERT ON commerce_email_lookup_results BEGIN
  SELECT RAISE(ABORT,'email_lookup_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_email_lookups WHERE lookup_key=NEW.lookup_key AND created_at<=NEW.observed_at);
  SELECT RAISE(ABORT,'email_lookup_invalid') WHERE NEW.outcome='matched' AND NOT EXISTS(
    SELECT 1 FROM commerce_email_lookups l JOIN commerce_email_requests x ON x.id=l.request_id WHERE l.lookup_key=NEW.lookup_key
      AND json_extract(NEW.raw_body,'$.object')='email' AND json_extract(NEW.raw_body,'$.id')=l.provider_id
      AND json_extract(NEW.raw_body,'$.from')=json_extract(x.request_json,'$.from')
      AND json_extract(NEW.raw_body,'$.subject')=json_extract(x.request_json,'$.subject')
      AND json_type(NEW.raw_body,'$.to')='array' AND json_array_length(NEW.raw_body,'$.to')=1 AND json_extract(NEW.raw_body,'$.to[0]')=x.recipient_email
      AND (json_type(NEW.raw_body,'$.cc') IS NULL OR json_type(NEW.raw_body,'$.cc')='null' OR (json_type(NEW.raw_body,'$.cc')='array' AND json_array_length(NEW.raw_body,'$.cc')=0))
      AND (json_type(NEW.raw_body,'$.bcc') IS NULL OR json_type(NEW.raw_body,'$.bcc')='null' OR (json_type(NEW.raw_body,'$.bcc')='array' AND json_array_length(NEW.raw_body,'$.bcc')=0))
      AND (json_type(NEW.raw_body,'$.reply_to') IS NULL OR json_type(NEW.raw_body,'$.reply_to')='null' OR (json_type(NEW.raw_body,'$.reply_to')='array' AND json_array_length(NEW.raw_body,'$.reply_to')=0))
      AND json_extract(NEW.raw_body,'$.scheduled_at') IS NULL
      AND json_type(NEW.raw_body,'$.tags')='array' AND json_array_length(NEW.raw_body,'$.tags')=3
      AND EXISTS(SELECT 1 FROM json_each(NEW.raw_body,'$.tags') WHERE json_extract(value,'$.name')='ezkart_delivery' AND json_extract(value,'$.value')=x.id)
      AND EXISTS(SELECT 1 FROM json_each(NEW.raw_body,'$.tags') WHERE json_extract(value,'$.name')='ezkart_environment' AND json_extract(value,'$.value')=x.commerce_environment)
      AND EXISTS(SELECT 1 FROM json_each(NEW.raw_body,'$.tags') WHERE json_extract(value,'$.name')='ezkart_profile' AND json_extract(value,'$.value')=x.profile_id)
      AND NEW.kind=CASE json_extract(NEW.raw_body,'$.last_event') WHEN 'sent' THEN 'sent' WHEN 'delivered' THEN 'delivered' WHEN 'delivery_delayed' THEN 'delayed'
        WHEN 'bounced' THEN 'bounced' WHEN 'complained' THEN 'complained' WHEN 'failed' THEN 'failed' WHEN 'suppressed' THEN 'suppressed' WHEN 'opened' THEN 'accepted' WHEN 'clicked' THEN 'accepted' END
      AND abs(julianday(NEW.provider_created_at)-julianday(CASE WHEN substr(json_extract(NEW.raw_body,'$.created_at'),-3)='+00'
        THEN json_extract(NEW.raw_body,'$.created_at')||':00' ELSE json_extract(NEW.raw_body,'$.created_at') END))<0.000000012
      AND NEW.provider_created_at>=(SELECT strftime('%Y-%m-%dT%H:%M:%fZ',MIN(created_at),'-5 minutes') FROM commerce_email_starts WHERE request_id=x.id)
      AND NEW.provider_created_at<=(SELECT strftime('%Y-%m-%dT%H:%M:%fZ',MAX(created_at),'+5 minutes') FROM commerce_email_starts WHERE request_id=x.id)
      AND NEW.provider_created_at<=strftime('%Y-%m-%dT%H:%M:%fZ',NEW.observed_at,'+5 minutes'));
  SELECT RAISE(ABORT,'email_lookup_provider_conflict') WHERE NEW.outcome='matched' AND EXISTS(
    SELECT 1 FROM commerce_email_lookups l JOIN commerce_email_requests x ON x.id=l.request_id JOIN commerce_all_email_bindings b
      ON b.request_id=x.id OR (b.profile_id=x.profile_id AND b.commerce_environment=x.commerce_environment AND b.provider_id=l.provider_id)
    WHERE l.lookup_key=NEW.lookup_key AND (b.request_id!=x.id OR b.provider_id!=l.provider_id));
  SELECT RAISE(ABORT,'email_immutable') WHERE EXISTS(SELECT 1 FROM commerce_email_lookup_results WHERE lookup_key=NEW.lookup_key);
END;
DROP TRIGGER commerce_email_lookup_binding_guard;
CREATE TRIGGER commerce_email_lookup_binding_guard BEFORE INSERT ON commerce_email_lookup_bindings BEGIN
  SELECT RAISE(ABORT,'email_lookup_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_email_lookup_results r JOIN commerce_email_lookups l ON l.lookup_key=r.lookup_key
    JOIN commerce_email_requests x ON x.id=l.request_id WHERE r.lookup_key=NEW.lookup_key AND r.outcome='matched' AND r.observed_at=NEW.created_at
      AND x.id=NEW.request_id AND x.commerce_environment=NEW.commerce_environment AND x.profile_id=NEW.profile_id AND l.provider_id=NEW.provider_id);
  SELECT RAISE(ABORT,'email_lookup_provider_conflict') WHERE EXISTS(SELECT 1 FROM commerce_all_email_bindings b
    WHERE (b.request_id=NEW.request_id AND b.provider_id!=NEW.provider_id) OR (b.commerce_environment=NEW.commerce_environment AND b.profile_id=NEW.profile_id AND b.provider_id=NEW.provider_id AND b.request_id!=NEW.request_id));
  SELECT RAISE(ABORT,'email_immutable') WHERE EXISTS(SELECT 1 FROM commerce_email_lookup_bindings WHERE request_id=NEW.request_id);
END;
DROP TRIGGER commerce_email_event_guard;
CREATE TRIGGER commerce_email_event_guard BEFORE INSERT ON commerce_email_events BEGIN
  SELECT RAISE(ABORT,'email_event_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_email_requests x WHERE x.id=NEW.request_id
    AND x.commerce_environment=NEW.commerce_environment AND x.profile_id=NEW.profile_id
    AND EXISTS(SELECT 1 FROM commerce_email_starts a WHERE a.request_id=x.id)
    AND ((NEW.source='api' AND json_extract(NEW.raw_json,'$.id')=NEW.provider_id
      AND EXISTS(SELECT 1 FROM commerce_email_starts a WHERE a.attempt_id=NEW.attempt_id AND a.request_id=x.id))
    OR (NEW.source='webhook' AND json_extract(NEW.raw_json,'$.data.email_id')=NEW.provider_id
      AND json_extract(NEW.raw_json,'$.type')='email.'||(CASE NEW.kind WHEN 'delayed' THEN 'delivery_delayed' ELSE NEW.kind END)
      AND json_extract(NEW.raw_json,'$.data.from')=json_extract(x.request_json,'$.from')
      AND json_extract(NEW.raw_json,'$.data.subject')=json_extract(x.request_json,'$.subject')
      AND json_array_length(NEW.raw_json,'$.data.to')=1 AND json_extract(NEW.raw_json,'$.data.to[0]')=x.recipient_email
      AND json_extract(NEW.raw_json,'$.data.tags.ezkart_delivery')=x.id AND json_extract(NEW.raw_json,'$.data.tags.ezkart_environment')=x.commerce_environment
      AND json_extract(NEW.raw_json,'$.data.tags.ezkart_profile')=x.profile_id)));
  SELECT RAISE(ABORT,'email_provider_conflict') WHERE EXISTS(SELECT 1 FROM commerce_all_email_bindings b
    WHERE (b.request_id=NEW.request_id AND (b.provider_id!=NEW.provider_id OR b.profile_id!=NEW.profile_id OR b.commerce_environment!=NEW.commerce_environment))
      OR (b.provider_id=NEW.provider_id AND b.profile_id=NEW.profile_id AND b.commerce_environment=NEW.commerce_environment AND b.request_id!=NEW.request_id));
  SELECT RAISE(ABORT,'email_immutable') WHERE EXISTS(SELECT 1 FROM commerce_email_events WHERE id=NEW.id
    OR (commerce_environment=NEW.commerce_environment AND profile_id=NEW.profile_id AND source=NEW.source AND source_id=NEW.source_id));
END;
DROP TRIGGER commerce_email_binding_guard;
CREATE TRIGGER commerce_email_binding_guard BEFORE INSERT ON commerce_email_provider_bindings BEGIN
  SELECT RAISE(ABORT,'email_binding_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_email_events e WHERE e.id=NEW.event_id AND e.request_id=NEW.request_id
    AND e.commerce_environment=NEW.commerce_environment AND e.profile_id=NEW.profile_id AND e.provider_id=NEW.provider_id AND e.received_at=NEW.created_at);
  SELECT RAISE(ABORT,'email_provider_conflict') WHERE EXISTS(SELECT 1 FROM commerce_all_email_bindings b WHERE (b.request_id=NEW.request_id AND b.provider_id!=NEW.provider_id) OR (b.commerce_environment=NEW.commerce_environment AND b.profile_id=NEW.profile_id AND b.provider_id=NEW.provider_id AND b.request_id!=NEW.request_id));
  SELECT RAISE(ABORT,'email_immutable') WHERE EXISTS(SELECT 1 FROM commerce_email_provider_bindings WHERE request_id=NEW.request_id
    OR (commerce_environment=NEW.commerce_environment AND profile_id=NEW.profile_id AND provider_id=NEW.provider_id));
END;
DROP TRIGGER commerce_email_start_guard;
CREATE TRIGGER commerce_email_start_guard BEFORE INSERT ON commerce_email_starts BEGIN
  SELECT RAISE(ABORT,'email_start_forbidden') WHERE NOT EXISTS(SELECT 1 FROM commerce_email_requests x JOIN commerce_jobs j ON j.id=x.job_id
    JOIN commerce_job_attempts a ON a.job_id=j.id JOIN commerce_notification_recipients r ON r.id=x.recipient_id JOIN commerce_notification_events e ON e.id=r.event_id
    JOIN sellers s ON s.id=e.seller_id WHERE x.id=NEW.request_id AND a.id=NEW.attempt_id AND a.lease_token=NEW.lease_token AND j.lease_token=NEW.lease_token
      AND j.state='running' AND j.lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now','+20 seconds') AND a.finished_at IS NULL
      AND x.retry_until>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND s.status='active' AND NEW.verified_at<=NEW.created_at
      AND NEW.verified_at>=strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'-60 seconds')
      AND ((r.actor_kind='merchant' AND EXISTS(SELECT 1 FROM seller_memberships m JOIN commerce_notification_preferences p ON p.seller_id=m.seller_id AND p.auth_user_id=m.auth_user_id
        WHERE m.seller_id=e.seller_id AND m.auth_user_id=r.actor_id AND json_extract(p.preferences_json,'$.'||e.category||'.email')=1))
      OR (r.actor_kind='buyer' AND EXISTS(SELECT 1 FROM commerce_buyer_notification_preferences p WHERE p.auth_user_id=r.actor_id AND json_extract(p.preferences_json,'$.'||e.category||'.email')=1) AND (EXISTS(SELECT 1 FROM commerce_conversations c WHERE c.id=e.conversation_id AND c.buyer_auth_user_id=r.actor_id)
        OR EXISTS(SELECT 1 FROM orders o LEFT JOIN commerce_order_owners owner ON owner.order_id=o.id WHERE o.id=e.order_id
          AND COALESCE(owner.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=r.actor_id))))
      AND (e.category!='payment_pending' OR EXISTS(SELECT 1 FROM orders o WHERE o.id=e.order_id AND o.checkout_state IN ('creating','pending') AND o.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))
      AND NOT EXISTS(SELECT 1 FROM commerce_email_suppressions problem WHERE problem.email_hash=x.email_hash AND problem.commerce_environment=x.commerce_environment)
      AND (e.category!='messages' OR NOT EXISTS(SELECT 1 FROM commerce_message_reads mr WHERE mr.conversation_id=e.conversation_id AND mr.actor_kind=r.actor_kind AND mr.actor_id=r.actor_id AND mr.event_id>=json_extract(e.data_json,'$.eventId')))
      AND NOT EXISTS(SELECT 1 FROM commerce_email_skips skip WHERE skip.job_id=j.id)
      AND NOT EXISTS(SELECT 1 FROM commerce_all_email_bindings binding WHERE binding.request_id=x.id));
  SELECT RAISE(ABORT,'email_immutable') WHERE EXISTS(SELECT 1 FROM commerce_email_starts WHERE attempt_id=NEW.attempt_id);
END;
