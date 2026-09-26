CREATE TABLE commerce_email_requests (
  id TEXT PRIMARY KEY CHECK(length(id)=38 AND substr(id,1,6)='email_' AND substr(id,7) NOT GLOB '*[^a-f0-9]*'),
  job_id TEXT NOT NULL UNIQUE REFERENCES commerce_jobs(id),
  recipient_id INTEGER NOT NULL UNIQUE REFERENCES commerce_notification_recipients(id),
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  profile_id TEXT NOT NULL CHECK(length(profile_id) BETWEEN 3 AND 64),
  credential_hash TEXT NOT NULL CHECK(length(credential_hash)=64 AND credential_hash NOT GLOB '*[^a-f0-9]*'),
  source_lease_token TEXT NOT NULL,
  sender_email TEXT NOT NULL CHECK(sender_email=lower(sender_email) AND length(sender_email) BETWEEN 3 AND 254),
  recipient_email TEXT NOT NULL CHECK(recipient_email=lower(recipient_email) AND length(recipient_email) BETWEEN 3 AND 254),
  email_hash TEXT NOT NULL CHECK(length(email_hash)=64 AND email_hash NOT GLOB '*[^a-f0-9]*'),
  confirmed_at TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_json TEXT NOT NULL CHECK(json_valid(request_json) AND json_type(request_json)='object' AND length(request_json)<=48000),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^a-f0-9]*'),
  template_version TEXT NOT NULL CHECK(template_version='notification-v1'),
  created_at TEXT NOT NULL,
  retry_until TEXT NOT NULL,
  CHECK(confirmed_at<=verified_at AND verified_at<=created_at AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at
    AND strftime('%Y-%m-%dT%H:%M:%fZ',confirmed_at)=confirmed_at AND strftime('%Y-%m-%dT%H:%M:%fZ',confirmed_at) IS NOT NULL
    AND strftime('%Y-%m-%dT%H:%M:%fZ',verified_at)=verified_at AND strftime('%Y-%m-%dT%H:%M:%fZ',verified_at) IS NOT NULL),
  CHECK(retry_until=strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+23 hours')),
  CHECK(idempotency_key='ezkart_email/'||commerce_environment||'/'||recipient_id)
);
CREATE INDEX commerce_email_requests_address ON commerce_email_requests(commerce_environment,email_hash);
CREATE INDEX commerce_email_requests_store ON commerce_email_requests(seller_id,commerce_environment,created_at,id);
CREATE TABLE commerce_email_starts (
  attempt_id TEXT PRIMARY KEY REFERENCES commerce_job_attempts(id),
  request_id TEXT NOT NULL REFERENCES commerce_email_requests(id),
  lease_token TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX commerce_email_starts_request ON commerce_email_starts(request_id,created_at);
CREATE TABLE commerce_email_provider_bindings (
  request_id TEXT PRIMARY KEY REFERENCES commerce_email_requests(id),
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  profile_id TEXT NOT NULL,
  provider_id TEXT NOT NULL CHECK(length(provider_id)=36),
  event_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(commerce_environment,profile_id,provider_id),
  FOREIGN KEY(event_id) REFERENCES commerce_email_events(id)
);
CREATE TABLE commerce_email_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL REFERENCES commerce_email_requests(id),
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  profile_id TEXT NOT NULL,
  provider_id TEXT NOT NULL CHECK(length(provider_id)=36),
  source TEXT NOT NULL CHECK(source IN ('api','webhook')),
  source_id TEXT NOT NULL CHECK(length(source_id) BETWEEN 8 AND 160),
  attempt_id TEXT REFERENCES commerce_email_starts(attempt_id),
  kind TEXT NOT NULL CHECK(kind IN ('accepted','sent','delivered','delayed','bounced','complained','failed','suppressed')),
  raw_json TEXT NOT NULL CHECK(json_valid(raw_json) AND json_type(raw_json)='object' AND length(raw_json)<=65536),
  body_hash TEXT NOT NULL CHECK(length(body_hash)=64 AND body_hash NOT GLOB '*[^a-f0-9]*'),
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  UNIQUE(commerce_environment,profile_id,source,source_id),
  CHECK((source='api' AND kind='accepted' AND attempt_id IS NOT NULL) OR (source='webhook' AND kind!='accepted' AND attempt_id IS NULL))
);
CREATE INDEX commerce_email_events_request ON commerce_email_events(request_id,kind,id);
CREATE TABLE commerce_email_skips (
  job_id TEXT PRIMARY KEY REFERENCES commerce_jobs(id),
  recipient_id INTEGER NOT NULL UNIQUE REFERENCES commerce_notification_recipients(id),
  request_id TEXT REFERENCES commerce_email_requests(id),
  reason TEXT NOT NULL CHECK(reason IN ('before_activation','stale','store_closed','access_removed','preference_off','already_read','obsolete','identity_invalid','address_changed','suppressed','test_recipient','provider_changed','retry_window_expired','provider_rejected')),
  uncertain INTEGER NOT NULL CHECK(uncertain IN (0,1)),
  source_lease_token TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TRIGGER commerce_notification_email_job AFTER INSERT ON commerce_notification_recipients WHEN NEW.email_requested=1 BEGIN
  INSERT INTO commerce_jobs(id,seller_id,order_id,commerce_environment,job_key,kind,payload_json,available_at,created_at,updated_at)
    SELECT 'job_'||lower(hex(randomblob(16))),e.seller_id,e.order_id,e.commerce_environment,'email_recipient:'||NEW.id,'notification.send',json_object('recipientId',NEW.id),NEW.created_at,NEW.created_at,NEW.created_at
    FROM commerce_notification_events e WHERE e.id=NEW.event_id;
END;
CREATE TRIGGER commerce_email_request_guard BEFORE INSERT ON commerce_email_requests BEGIN
  SELECT RAISE(ABORT,'email_request_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_jobs j JOIN commerce_notification_recipients r ON r.id=NEW.recipient_id
    JOIN commerce_notification_events e ON e.id=r.event_id WHERE j.id=NEW.job_id AND j.kind='notification.send' AND json_extract(j.payload_json,'$.recipientId')=r.id
      AND j.seller_id=NEW.seller_id AND e.seller_id=NEW.seller_id AND e.commerce_environment=NEW.commerce_environment AND j.commerce_environment=NEW.commerce_environment
      AND j.state='running' AND j.lease_token=NEW.source_lease_token AND j.lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND r.email_requested=1 AND e.suppression='');
  SELECT RAISE(ABORT,'email_request_invalid') WHERE json_type(NEW.request_json,'$.from') IS NOT 'text' OR json_extract(NEW.request_json,'$.from')!='Ezkart <'||NEW.sender_email||'>'
    OR json_type(NEW.request_json,'$.to') IS NOT 'array' OR json_array_length(NEW.request_json,'$.to')!=1 OR json_type(NEW.request_json,'$.to[0]') IS NOT 'text' OR json_extract(NEW.request_json,'$.to[0]') IS NOT NEW.recipient_email
    OR json_type(NEW.request_json,'$.subject') IS NOT 'text' OR length(json_extract(NEW.request_json,'$.subject')) NOT BETWEEN 1 AND 200
    OR json_type(NEW.request_json,'$.text') IS NOT 'text' OR length(json_extract(NEW.request_json,'$.text'))<1
    OR json_type(NEW.request_json,'$.html') IS NOT 'text' OR length(json_extract(NEW.request_json,'$.html'))<1 OR (SELECT COUNT(*) FROM json_each(NEW.request_json))!=6
    OR json_type(NEW.request_json,'$.tags') IS NOT 'array' OR json_array_length(NEW.request_json,'$.tags')!=3
    OR NOT EXISTS(SELECT 1 FROM json_each(NEW.request_json,'$.tags') WHERE json_extract(value,'$.name')='ezkart_delivery' AND json_extract(value,'$.value')=NEW.id)
    OR NOT EXISTS(SELECT 1 FROM json_each(NEW.request_json,'$.tags') WHERE json_extract(value,'$.name')='ezkart_environment' AND json_extract(value,'$.value')=NEW.commerce_environment)
    OR NOT EXISTS(SELECT 1 FROM json_each(NEW.request_json,'$.tags') WHERE json_extract(value,'$.name')='ezkart_profile' AND json_extract(value,'$.value')=NEW.profile_id);
  SELECT RAISE(ABORT,'email_immutable') WHERE EXISTS(SELECT 1 FROM commerce_email_requests WHERE id=NEW.id OR recipient_id=NEW.recipient_id OR job_id=NEW.job_id);
END;
CREATE TRIGGER commerce_email_start_guard BEFORE INSERT ON commerce_email_starts BEGIN
  SELECT RAISE(ABORT,'email_start_forbidden') WHERE NOT EXISTS(SELECT 1 FROM commerce_email_requests x JOIN commerce_jobs j ON j.id=x.job_id
    JOIN commerce_job_attempts a ON a.job_id=j.id JOIN commerce_notification_recipients r ON r.id=x.recipient_id JOIN commerce_notification_events e ON e.id=r.event_id
    JOIN sellers s ON s.id=e.seller_id WHERE x.id=NEW.request_id AND a.id=NEW.attempt_id AND a.lease_token=NEW.lease_token AND j.lease_token=NEW.lease_token
      AND j.state='running' AND j.lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now','+20 seconds') AND a.finished_at IS NULL
      AND x.retry_until>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND s.status='active' AND NEW.verified_at<=NEW.created_at
      AND NEW.verified_at>=strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'-60 seconds')
      AND ((r.actor_kind='merchant' AND EXISTS(SELECT 1 FROM seller_memberships m JOIN commerce_notification_preferences p ON p.seller_id=m.seller_id AND p.auth_user_id=m.auth_user_id
        WHERE m.seller_id=e.seller_id AND m.auth_user_id=r.actor_id AND json_extract(p.preferences_json,'$.'||e.category||'.email')=1))
      OR (r.actor_kind='buyer' AND (EXISTS(SELECT 1 FROM commerce_conversations c WHERE c.id=e.conversation_id AND c.buyer_auth_user_id=r.actor_id)
        OR EXISTS(SELECT 1 FROM orders o LEFT JOIN commerce_order_owners owner ON owner.order_id=o.id WHERE o.id=e.order_id
          AND COALESCE(owner.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=r.actor_id))))
      AND (e.category!='payment_pending' OR EXISTS(SELECT 1 FROM orders o WHERE o.id=e.order_id AND o.checkout_state IN ('creating','pending') AND o.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))
      AND NOT EXISTS(SELECT 1 FROM commerce_email_requests prior JOIN commerce_email_events problem ON problem.request_id=prior.id
        WHERE prior.email_hash=x.email_hash AND prior.commerce_environment=x.commerce_environment AND problem.kind IN ('bounced','complained','suppressed'))
      AND (e.category!='messages' OR NOT EXISTS(SELECT 1 FROM commerce_message_reads mr WHERE mr.conversation_id=e.conversation_id AND mr.actor_kind=r.actor_kind AND mr.actor_id=r.actor_id AND mr.event_id>=json_extract(e.data_json,'$.eventId')))
      AND NOT EXISTS(SELECT 1 FROM commerce_email_skips skip WHERE skip.job_id=j.id)
      AND NOT EXISTS(SELECT 1 FROM commerce_email_provider_bindings binding WHERE binding.request_id=x.id));
  SELECT RAISE(ABORT,'email_immutable') WHERE EXISTS(SELECT 1 FROM commerce_email_starts WHERE attempt_id=NEW.attempt_id);
END;
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
  SELECT RAISE(ABORT,'email_provider_conflict') WHERE EXISTS(SELECT 1 FROM commerce_email_provider_bindings b
    WHERE (b.request_id=NEW.request_id AND (b.provider_id!=NEW.provider_id OR b.profile_id!=NEW.profile_id OR b.commerce_environment!=NEW.commerce_environment))
      OR (b.provider_id=NEW.provider_id AND b.profile_id=NEW.profile_id AND b.commerce_environment=NEW.commerce_environment AND b.request_id!=NEW.request_id));
  SELECT RAISE(ABORT,'email_immutable') WHERE EXISTS(SELECT 1 FROM commerce_email_events WHERE id=NEW.id
    OR (commerce_environment=NEW.commerce_environment AND profile_id=NEW.profile_id AND source=NEW.source AND source_id=NEW.source_id));
END;
CREATE TRIGGER commerce_email_event_bind AFTER INSERT ON commerce_email_events BEGIN
  INSERT INTO commerce_email_provider_bindings(request_id,commerce_environment,profile_id,provider_id,event_id,created_at)
    SELECT NEW.request_id,NEW.commerce_environment,NEW.profile_id,NEW.provider_id,NEW.id,NEW.received_at
    WHERE NOT EXISTS(SELECT 1 FROM commerce_email_provider_bindings WHERE request_id=NEW.request_id);
END;
CREATE TRIGGER commerce_email_binding_guard BEFORE INSERT ON commerce_email_provider_bindings BEGIN
  SELECT RAISE(ABORT,'email_binding_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_email_events e WHERE e.id=NEW.event_id AND e.request_id=NEW.request_id
    AND e.commerce_environment=NEW.commerce_environment AND e.profile_id=NEW.profile_id AND e.provider_id=NEW.provider_id AND e.received_at=NEW.created_at);
  SELECT RAISE(ABORT,'email_immutable') WHERE EXISTS(SELECT 1 FROM commerce_email_provider_bindings WHERE request_id=NEW.request_id
    OR (commerce_environment=NEW.commerce_environment AND profile_id=NEW.profile_id AND provider_id=NEW.provider_id));
END;
CREATE TRIGGER commerce_email_skip_guard BEFORE INSERT ON commerce_email_skips BEGIN
  SELECT RAISE(ABORT,'email_skip_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_jobs j WHERE j.id=NEW.job_id AND j.kind='notification.send'
    AND json_extract(j.payload_json,'$.recipientId')=NEW.recipient_id AND j.state='running' AND j.lease_token=NEW.source_lease_token
    AND j.lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  SELECT RAISE(ABORT,'email_skip_invalid') WHERE NEW.request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM commerce_email_requests x WHERE x.id=NEW.request_id AND x.job_id=NEW.job_id AND x.recipient_id=NEW.recipient_id);
  SELECT RAISE(ABORT,'email_skip_invalid') WHERE NEW.uncertain=0 AND EXISTS(SELECT 1 FROM commerce_email_requests x JOIN commerce_email_starts a ON a.request_id=x.id WHERE x.job_id=NEW.job_id);
  SELECT RAISE(ABORT,'email_immutable') WHERE EXISTS(SELECT 1 FROM commerce_email_skips WHERE job_id=NEW.job_id OR recipient_id=NEW.recipient_id);
END;
CREATE TRIGGER commerce_email_job_complete BEFORE UPDATE OF state ON commerce_jobs WHEN NEW.kind='notification.send' AND NEW.state='succeeded' BEGIN
  SELECT RAISE(ABORT,'email_receipt_required') WHERE NOT EXISTS(SELECT 1 FROM commerce_email_requests x JOIN commerce_email_provider_bindings b ON b.request_id=x.id WHERE x.job_id=NEW.id)
    AND NOT EXISTS(SELECT 1 FROM commerce_email_skips s WHERE s.job_id=NEW.id AND s.uncertain=0);
END;
CREATE TRIGGER commerce_email_request_update BEFORE UPDATE ON commerce_email_requests BEGIN SELECT RAISE(ABORT,'email_immutable'); END;
CREATE TRIGGER commerce_email_request_delete BEFORE DELETE ON commerce_email_requests BEGIN SELECT RAISE(ABORT,'email_immutable'); END;
CREATE TRIGGER commerce_email_start_update BEFORE UPDATE ON commerce_email_starts BEGIN SELECT RAISE(ABORT,'email_immutable'); END;
CREATE TRIGGER commerce_email_start_delete BEFORE DELETE ON commerce_email_starts BEGIN SELECT RAISE(ABORT,'email_immutable'); END;
CREATE TRIGGER commerce_email_binding_update BEFORE UPDATE ON commerce_email_provider_bindings BEGIN SELECT RAISE(ABORT,'email_immutable'); END;
CREATE TRIGGER commerce_email_binding_delete BEFORE DELETE ON commerce_email_provider_bindings BEGIN SELECT RAISE(ABORT,'email_immutable'); END;
CREATE TRIGGER commerce_email_event_update BEFORE UPDATE ON commerce_email_events BEGIN SELECT RAISE(ABORT,'email_immutable'); END;
CREATE TRIGGER commerce_email_event_delete BEFORE DELETE ON commerce_email_events BEGIN SELECT RAISE(ABORT,'email_immutable'); END;
CREATE TRIGGER commerce_email_skip_update BEFORE UPDATE ON commerce_email_skips BEGIN SELECT RAISE(ABORT,'email_immutable'); END;
CREATE TRIGGER commerce_email_skip_delete BEFORE DELETE ON commerce_email_skips BEGIN SELECT RAISE(ABORT,'email_immutable'); END;
