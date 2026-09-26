-- Read-only provider investigations preserve their original intent and result.
-- A missing provider record is never evidence that an email was not sent.
CREATE TABLE commerce_email_lookups (
  lookup_key TEXT PRIMARY KEY CHECK(length(lookup_key)=32 AND lookup_key NOT GLOB '*[^a-f0-9]*'),
  request_id TEXT NOT NULL REFERENCES commerce_email_requests(id),
  provider_id TEXT NOT NULL CHECK(length(provider_id)=36),
  credential_hash TEXT NOT NULL CHECK(length(credential_hash)=64 AND credential_hash NOT GLOB '*[^a-f0-9]*'),
  reader_hash TEXT NOT NULL CHECK(length(reader_hash)=64 AND reader_hash NOT GLOB '*[^a-f0-9]*'),
  operator_id TEXT NOT NULL CHECK(length(operator_id) BETWEEN 3 AND 96 AND operator_id NOT GLOB '*[^A-Za-z0-9_-]*'),
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at)
);
CREATE INDEX commerce_email_lookups_request ON commerce_email_lookups(request_id,created_at,lookup_key);
CREATE INDEX commerce_email_lookups_rate ON commerce_email_lookups(created_at);
CREATE TABLE commerce_email_lookup_results (
  lookup_key TEXT PRIMARY KEY REFERENCES commerce_email_lookups(lookup_key),
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
CREATE TABLE commerce_email_lookup_bindings (
  request_id TEXT PRIMARY KEY REFERENCES commerce_email_requests(id),
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  profile_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  lookup_key TEXT NOT NULL UNIQUE REFERENCES commerce_email_lookup_results(lookup_key),
  created_at TEXT NOT NULL,
  UNIQUE(commerce_environment,profile_id,provider_id)
);
CREATE VIEW commerce_email_verified_bindings AS
  SELECT request_id,commerce_environment,profile_id,provider_id,created_at FROM commerce_email_provider_bindings
  UNION ALL
  SELECT request_id,commerce_environment,profile_id,provider_id,created_at FROM commerce_email_lookup_bindings l
  WHERE NOT EXISTS(SELECT 1 FROM commerce_email_provider_bindings b WHERE b.request_id=l.request_id);
CREATE VIEW commerce_email_delivery_evidence AS
  SELECT request_id,kind,occurred_at,received_at AS observed_at,source FROM commerce_email_events
  UNION ALL
  SELECT l.request_id,r.kind,NULL AS occurred_at,r.observed_at,'lookup' AS source
  FROM commerce_email_lookup_results r JOIN commerce_email_lookups l ON l.lookup_key=r.lookup_key WHERE r.outcome='matched';
CREATE TABLE commerce_email_resolutions (
  resolution_key TEXT PRIMARY KEY CHECK(length(resolution_key)=32 AND resolution_key NOT GLOB '*[^a-f0-9]*'),
  request_id TEXT NOT NULL UNIQUE REFERENCES commerce_email_requests(id),
  lookup_key TEXT NOT NULL REFERENCES commerce_email_lookup_results(lookup_key),
  operator_id TEXT NOT NULL CHECK(length(operator_id) BETWEEN 3 AND 96 AND operator_id NOT GLOB '*[^A-Za-z0-9_-]*'),
  previous_state TEXT NOT NULL CHECK(previous_state IN ('dead','uncertain','retry')),
  previous_result TEXT NOT NULL CHECK(json_valid(previous_result)),
  previous_error TEXT NOT NULL,
  previous_updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at)
);
CREATE TRIGGER commerce_email_lookup_guard BEFORE INSERT ON commerce_email_lookups BEGIN
  SELECT RAISE(ABORT,'email_lookup_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_email_requests x WHERE x.id=NEW.request_id
    AND x.credential_hash=NEW.credential_hash AND EXISTS(SELECT 1 FROM commerce_email_starts s WHERE s.request_id=x.id));
  SELECT RAISE(ABORT,'email_lookup_provider_conflict') WHERE EXISTS(SELECT 1 FROM commerce_email_verified_bindings b JOIN commerce_email_requests x ON x.id=NEW.request_id
    WHERE (b.request_id=x.id AND b.provider_id!=NEW.provider_id) OR (b.profile_id=x.profile_id AND b.commerce_environment=x.commerce_environment AND b.provider_id=NEW.provider_id AND b.request_id!=x.id));
  SELECT RAISE(ABORT,'email_lookup_rate') WHERE (SELECT COUNT(*) FROM commerce_email_lookups WHERE created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute'))>=60
    OR (SELECT COUNT(*) FROM commerce_email_lookups WHERE request_id=NEW.request_id AND created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute'))>=3
    OR (SELECT COUNT(*) FROM commerce_email_lookups WHERE request_id=NEW.request_id AND created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day'))>=250;
  SELECT RAISE(ABORT,'email_immutable') WHERE EXISTS(SELECT 1 FROM commerce_email_lookups WHERE lookup_key=NEW.lookup_key);
END;
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
    SELECT 1 FROM commerce_email_lookups l JOIN commerce_email_requests x ON x.id=l.request_id JOIN commerce_email_verified_bindings b
      ON b.request_id=x.id OR (b.profile_id=x.profile_id AND b.commerce_environment=x.commerce_environment AND b.provider_id=l.provider_id)
    WHERE l.lookup_key=NEW.lookup_key AND (b.request_id!=x.id OR b.provider_id!=l.provider_id));
  SELECT RAISE(ABORT,'email_immutable') WHERE EXISTS(SELECT 1 FROM commerce_email_lookup_results WHERE lookup_key=NEW.lookup_key);
END;
CREATE TRIGGER commerce_email_lookup_bind AFTER INSERT ON commerce_email_lookup_results WHEN NEW.outcome='matched' BEGIN
  INSERT INTO commerce_email_lookup_bindings(request_id,commerce_environment,profile_id,provider_id,lookup_key,created_at)
    SELECT x.id,x.commerce_environment,x.profile_id,l.provider_id,l.lookup_key,NEW.observed_at FROM commerce_email_lookups l JOIN commerce_email_requests x ON x.id=l.request_id
    WHERE l.lookup_key=NEW.lookup_key AND NOT EXISTS(SELECT 1 FROM commerce_email_lookup_bindings b WHERE b.request_id=x.id);
END;
CREATE TRIGGER commerce_email_lookup_binding_guard BEFORE INSERT ON commerce_email_lookup_bindings BEGIN
  SELECT RAISE(ABORT,'email_lookup_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_email_lookup_results r JOIN commerce_email_lookups l ON l.lookup_key=r.lookup_key
    JOIN commerce_email_requests x ON x.id=l.request_id WHERE r.lookup_key=NEW.lookup_key AND r.outcome='matched' AND r.observed_at=NEW.created_at
      AND x.id=NEW.request_id AND x.commerce_environment=NEW.commerce_environment AND x.profile_id=NEW.profile_id AND l.provider_id=NEW.provider_id);
  SELECT RAISE(ABORT,'email_lookup_provider_conflict') WHERE EXISTS(SELECT 1 FROM commerce_email_verified_bindings b
    WHERE (b.request_id=NEW.request_id AND b.provider_id!=NEW.provider_id) OR (b.commerce_environment=NEW.commerce_environment AND b.profile_id=NEW.profile_id AND b.provider_id=NEW.provider_id AND b.request_id!=NEW.request_id));
  SELECT RAISE(ABORT,'email_immutable') WHERE EXISTS(SELECT 1 FROM commerce_email_lookup_bindings WHERE request_id=NEW.request_id);
END;
CREATE TRIGGER commerce_email_resolution_guard BEFORE INSERT ON commerce_email_resolutions BEGIN
  SELECT RAISE(ABORT,'email_resolution_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_email_requests x JOIN commerce_jobs j ON j.id=x.job_id
    JOIN commerce_email_lookups l ON l.request_id=x.id JOIN commerce_email_lookup_results r ON r.lookup_key=l.lookup_key
    JOIN commerce_email_verified_bindings b ON b.request_id=x.id AND b.provider_id=l.provider_id
    WHERE x.id=NEW.request_id AND l.lookup_key=NEW.lookup_key AND r.outcome='matched' AND r.observed_at<=NEW.created_at
      AND r.observed_at>=strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'-5 minutes') AND j.state=NEW.previous_state
      AND j.updated_at=NEW.previous_updated_at AND COALESCE(j.result_json,'{}')=NEW.previous_result AND j.last_error=NEW.previous_error
      AND (j.state IN ('uncertain','retry') OR (j.state='dead' AND (json_extract(j.result_json,'$.errorCode') IN ('email_send_uncertain','email_rate_limited','email_identity_unavailable')
        OR EXISTS(SELECT 1 FROM commerce_email_skips s WHERE s.job_id=j.id AND s.uncertain=1)))));
  SELECT RAISE(ABORT,'email_immutable') WHERE EXISTS(SELECT 1 FROM commerce_email_resolutions WHERE request_id=NEW.request_id OR resolution_key=NEW.resolution_key);
END;
CREATE TRIGGER commerce_email_resolution_apply AFTER INSERT ON commerce_email_resolutions BEGIN
  UPDATE commerce_jobs SET state='succeeded',result_json=json_object('deliveryId',NEW.request_id,'submitted',json('true'),'reconciled',json('true'),'resolutionKey',NEW.resolution_key),
    last_error='',completion_hash=NULL,lease_token=NULL,lease_owner=NULL,lease_until=NULL,lease_mode=NULL,updated_at=NEW.created_at
    WHERE id=(SELECT job_id FROM commerce_email_requests WHERE id=NEW.request_id);
END;
CREATE TRIGGER commerce_email_lookup_update BEFORE UPDATE ON commerce_email_lookups BEGIN SELECT RAISE(ABORT,'email_immutable'); END;
CREATE TRIGGER commerce_email_lookup_delete BEFORE DELETE ON commerce_email_lookups BEGIN SELECT RAISE(ABORT,'email_immutable'); END;
CREATE TRIGGER commerce_email_lookup_result_update BEFORE UPDATE ON commerce_email_lookup_results BEGIN SELECT RAISE(ABORT,'email_immutable'); END;
CREATE TRIGGER commerce_email_lookup_result_delete BEFORE DELETE ON commerce_email_lookup_results BEGIN SELECT RAISE(ABORT,'email_immutable'); END;
CREATE TRIGGER commerce_email_lookup_binding_update BEFORE UPDATE ON commerce_email_lookup_bindings BEGIN SELECT RAISE(ABORT,'email_immutable'); END;
CREATE TRIGGER commerce_email_lookup_binding_delete BEFORE DELETE ON commerce_email_lookup_bindings BEGIN SELECT RAISE(ABORT,'email_immutable'); END;
CREATE TRIGGER commerce_email_resolution_update BEFORE UPDATE ON commerce_email_resolutions BEGIN SELECT RAISE(ABORT,'email_immutable'); END;
CREATE TRIGGER commerce_email_resolution_delete BEFORE DELETE ON commerce_email_resolutions BEGIN SELECT RAISE(ABORT,'email_immutable'); END;

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
      AND NOT EXISTS(SELECT 1 FROM commerce_email_requests prior JOIN commerce_email_delivery_evidence problem ON problem.request_id=prior.id
        WHERE prior.email_hash=x.email_hash AND prior.commerce_environment=x.commerce_environment AND problem.kind IN ('bounced','complained','suppressed'))
      AND (e.category!='messages' OR NOT EXISTS(SELECT 1 FROM commerce_message_reads mr WHERE mr.conversation_id=e.conversation_id AND mr.actor_kind=r.actor_kind AND mr.actor_id=r.actor_id AND mr.event_id>=json_extract(e.data_json,'$.eventId')))
      AND NOT EXISTS(SELECT 1 FROM commerce_email_skips skip WHERE skip.job_id=j.id)
      AND NOT EXISTS(SELECT 1 FROM commerce_email_verified_bindings binding WHERE binding.request_id=x.id));
  SELECT RAISE(ABORT,'email_immutable') WHERE EXISTS(SELECT 1 FROM commerce_email_starts WHERE attempt_id=NEW.attempt_id);
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
  SELECT RAISE(ABORT,'email_provider_conflict') WHERE EXISTS(SELECT 1 FROM commerce_email_verified_bindings b
    WHERE (b.request_id=NEW.request_id AND (b.provider_id!=NEW.provider_id OR b.profile_id!=NEW.profile_id OR b.commerce_environment!=NEW.commerce_environment))
      OR (b.provider_id=NEW.provider_id AND b.profile_id=NEW.profile_id AND b.commerce_environment=NEW.commerce_environment AND b.request_id!=NEW.request_id));
  SELECT RAISE(ABORT,'email_immutable') WHERE EXISTS(SELECT 1 FROM commerce_email_events WHERE id=NEW.id
    OR (commerce_environment=NEW.commerce_environment AND profile_id=NEW.profile_id AND source=NEW.source AND source_id=NEW.source_id));
END;

DROP TRIGGER commerce_email_binding_guard;
CREATE TRIGGER commerce_email_binding_guard BEFORE INSERT ON commerce_email_provider_bindings BEGIN
  SELECT RAISE(ABORT,'email_binding_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_email_events e WHERE e.id=NEW.event_id AND e.request_id=NEW.request_id
    AND e.commerce_environment=NEW.commerce_environment AND e.profile_id=NEW.profile_id AND e.provider_id=NEW.provider_id AND e.received_at=NEW.created_at);
  SELECT RAISE(ABORT,'email_provider_conflict') WHERE EXISTS(SELECT 1 FROM commerce_email_lookup_bindings b WHERE (b.request_id=NEW.request_id AND b.provider_id!=NEW.provider_id) OR (b.commerce_environment=NEW.commerce_environment AND b.profile_id=NEW.profile_id AND b.provider_id=NEW.provider_id AND b.request_id!=NEW.request_id));
  SELECT RAISE(ABORT,'email_immutable') WHERE EXISTS(SELECT 1 FROM commerce_email_provider_bindings WHERE request_id=NEW.request_id
    OR (commerce_environment=NEW.commerce_environment AND profile_id=NEW.profile_id AND provider_id=NEW.provider_id));
END;

DROP TRIGGER commerce_email_job_complete;
CREATE TRIGGER commerce_email_job_complete BEFORE UPDATE OF state ON commerce_jobs WHEN NEW.kind='notification.send' AND NEW.state='succeeded' BEGIN
  SELECT RAISE(ABORT,'email_receipt_required') WHERE NOT EXISTS(SELECT 1 FROM commerce_email_requests x JOIN commerce_email_verified_bindings b ON b.request_id=x.id WHERE x.job_id=NEW.id)
    AND NOT EXISTS(SELECT 1 FROM commerce_email_skips s WHERE s.job_id=NEW.id AND s.uncertain=0);
END;
