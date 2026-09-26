CREATE TABLE commerce_buyer_notification_preferences (
  auth_user_id TEXT PRIMARY KEY CHECK(length(auth_user_id) BETWEEN 3 AND 96),
  revision INTEGER NOT NULL CHECK(revision>0 AND revision<=9007199254740991),
  preferences_json TEXT NOT NULL CHECK(json_valid(preferences_json) AND json_type(preferences_json)='object' AND length(preferences_json)<=2000),
  updated_at TEXT NOT NULL
);
CREATE TABLE commerce_buyer_notification_changes (
  auth_user_id TEXT NOT NULL CHECK(length(auth_user_id) BETWEEN 3 AND 96),
  request_key TEXT NOT NULL CHECK(length(request_key)=32 AND request_key NOT GLOB '*[^a-f0-9]*'),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^a-f0-9]*'),
  expected_revision INTEGER NOT NULL CHECK(expected_revision>=0),
  revision INTEGER NOT NULL CHECK(revision=expected_revision+1 AND revision<=9007199254740991),
  data_json TEXT NOT NULL CHECK(json_valid(data_json) AND json_type(data_json)='object' AND length(data_json)<=2000),
  created_at TEXT NOT NULL,
  PRIMARY KEY(auth_user_id,request_key),
  UNIQUE(auth_user_id,revision)
);
CREATE INDEX commerce_buyer_notification_activity ON commerce_buyer_notification_changes(auth_user_id,created_at);
CREATE TRIGGER commerce_buyer_notification_change_guard BEFORE INSERT ON commerce_buyer_notification_changes BEGIN
  SELECT RAISE(ABORT,'buyer_notification_revision_conflict') WHERE NEW.expected_revision!=COALESCE((SELECT revision FROM commerce_buyer_notification_preferences WHERE auth_user_id=NEW.auth_user_id),0);
  SELECT RAISE(ABORT,'buyer_notification_immutable') WHERE EXISTS(SELECT 1 FROM commerce_buyer_notification_changes WHERE auth_user_id=NEW.auth_user_id AND request_key=NEW.request_key);
  SELECT RAISE(ABORT,'buyer_notification_rate_limited') WHERE (SELECT COUNT(*) FROM commerce_buyer_notification_changes WHERE auth_user_id=NEW.auth_user_id AND created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute'))>=60
    OR (SELECT COUNT(*) FROM commerce_buyer_notification_changes WHERE auth_user_id=NEW.auth_user_id AND created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day'))>=1000;
  SELECT RAISE(ABORT,'buyer_notification_invalid') WHERE (SELECT COUNT(*) FROM json_each(NEW.data_json))!=6 OR (SELECT COUNT(DISTINCT key) FROM json_each(NEW.data_json))!=6
    OR EXISTS(SELECT 1 FROM json_each(NEW.data_json) g WHERE g.key NOT IN ('payment_confirmed','payment_pending','payment_failed','shipping','returns','messages') OR g.type!='object'
      OR (SELECT COUNT(*) FROM json_each(g.value))!=2 OR COALESCE(json_type(g.value,'$.inApp'),'missing') NOT IN ('true','false') OR COALESCE(json_type(g.value,'$.email'),'missing') NOT IN ('true','false'));
END;
CREATE TRIGGER commerce_buyer_notification_change_apply AFTER INSERT ON commerce_buyer_notification_changes BEGIN
  INSERT INTO commerce_buyer_notification_preferences(auth_user_id,revision,preferences_json,updated_at) VALUES(NEW.auth_user_id,NEW.revision,NEW.data_json,NEW.created_at)
    ON CONFLICT(auth_user_id) DO UPDATE SET revision=excluded.revision,preferences_json=excluded.preferences_json,updated_at=excluded.updated_at;
END;
CREATE TRIGGER commerce_buyer_notification_change_update BEFORE UPDATE ON commerce_buyer_notification_changes BEGIN SELECT RAISE(ABORT,'buyer_notification_immutable'); END;
CREATE TRIGGER commerce_buyer_notification_change_delete BEFORE DELETE ON commerce_buyer_notification_changes BEGIN SELECT RAISE(ABORT,'buyer_notification_immutable'); END;
CREATE TRIGGER commerce_buyer_notification_preferences_insert BEFORE INSERT ON commerce_buyer_notification_preferences BEGIN
  SELECT RAISE(ABORT,'buyer_notification_receipt_required') WHERE EXISTS(SELECT 1 FROM commerce_buyer_notification_preferences WHERE auth_user_id=NEW.auth_user_id AND revision>=NEW.revision)
    OR NOT EXISTS(SELECT 1 FROM commerce_buyer_notification_changes c WHERE c.auth_user_id=NEW.auth_user_id AND c.revision=NEW.revision AND c.data_json=NEW.preferences_json AND c.created_at=NEW.updated_at);
END;
CREATE TRIGGER commerce_buyer_notification_preferences_update BEFORE UPDATE ON commerce_buyer_notification_preferences BEGIN
  SELECT RAISE(ABORT,'buyer_notification_receipt_required') WHERE NEW.auth_user_id!=OLD.auth_user_id OR NEW.revision!=OLD.revision+1
    OR NOT EXISTS(SELECT 1 FROM commerce_buyer_notification_changes c WHERE c.auth_user_id=NEW.auth_user_id AND c.revision=NEW.revision AND c.data_json=NEW.preferences_json AND c.created_at=NEW.updated_at);
END;
CREATE TRIGGER commerce_buyer_notification_preferences_delete BEFORE DELETE ON commerce_buyer_notification_preferences BEGIN SELECT RAISE(ABORT,'buyer_notification_receipt_required'); END;

DROP TRIGGER commerce_notification_fanout;
CREATE TRIGGER commerce_notification_fanout AFTER INSERT ON commerce_notification_events BEGIN
  INSERT INTO commerce_notification_recipients(event_id,actor_kind,actor_id,preference_revision,in_app,email_requested,created_at)
    SELECT NEW.id,'merchant',m.auth_user_id,COALESCE(p.revision,0),
      COALESCE(json_extract(p.preferences_json,'$.'||NEW.category||'.inApp'),CASE WHEN NEW.category='weekly_activity' THEN 0 ELSE 1 END),
      COALESCE(json_extract(p.preferences_json,'$.'||NEW.category||'.email'),0),NEW.created_at
    FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id LEFT JOIN commerce_notification_preferences p ON p.seller_id=m.seller_id AND p.auth_user_id=m.auth_user_id
    WHERE m.seller_id=NEW.seller_id AND s.status='active' AND NEW.suppression='' AND NEW.audience IN ('merchant','both');
  INSERT INTO commerce_notification_recipients(event_id,actor_kind,actor_id,preference_revision,in_app,email_requested,created_at)
    SELECT NEW.id,'buyer',COALESCE(c.buyer_auth_user_id,a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),'')),COALESCE(p.revision,0),COALESCE(json_extract(p.preferences_json,'$.'||NEW.category||'.inApp'),1),COALESCE(json_extract(p.preferences_json,'$.'||NEW.category||'.email'),0),NEW.created_at
    FROM sellers s LEFT JOIN orders o ON o.id=NEW.order_id LEFT JOIN commerce_order_owners a ON a.order_id=o.id LEFT JOIN commerce_conversations c ON c.id=NEW.conversation_id
      LEFT JOIN commerce_buyer_notification_preferences p ON p.auth_user_id=COALESCE(c.buyer_auth_user_id,a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))
    WHERE s.id=NEW.seller_id AND s.status='active' AND NEW.suppression='' AND NEW.audience IN ('buyer','both')
      AND COALESCE(c.buyer_auth_user_id,a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),'')) IS NOT NULL;
END;

DROP TRIGGER commerce_notification_recipient_guard;
CREATE TRIGGER commerce_notification_recipient_guard BEFORE INSERT ON commerce_notification_recipients BEGIN
  SELECT RAISE(ABORT,'notification_recipient_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_notification_events e JOIN sellers s ON s.id=e.seller_id
    WHERE e.id=NEW.event_id AND e.suppression='' AND s.status='active' AND e.created_at=NEW.created_at AND (
      (NEW.actor_kind='merchant' AND e.audience IN ('merchant','both') AND EXISTS(SELECT 1 FROM seller_memberships m
        LEFT JOIN commerce_notification_preferences p ON p.seller_id=m.seller_id AND p.auth_user_id=m.auth_user_id
        WHERE m.seller_id=e.seller_id AND m.auth_user_id=NEW.actor_id AND NEW.preference_revision=COALESCE(p.revision,0)
          AND NEW.in_app=COALESCE(json_extract(p.preferences_json,'$.'||e.category||'.inApp'),CASE WHEN e.category='weekly_activity' THEN 0 ELSE 1 END)
          AND NEW.email_requested=COALESCE(json_extract(p.preferences_json,'$.'||e.category||'.email'),0)))
      OR (NEW.actor_kind='buyer' AND e.audience IN ('buyer','both') AND NEW.preference_revision=COALESCE((SELECT p.revision FROM commerce_buyer_notification_preferences p WHERE p.auth_user_id=NEW.actor_id),0)
        AND NEW.in_app=COALESCE(json_extract((SELECT p.preferences_json FROM commerce_buyer_notification_preferences p WHERE p.auth_user_id=NEW.actor_id),'$.'||e.category||'.inApp'),1)
        AND NEW.email_requested=COALESCE(json_extract((SELECT p.preferences_json FROM commerce_buyer_notification_preferences p WHERE p.auth_user_id=NEW.actor_id),'$.'||e.category||'.email'),0)
        AND (EXISTS(SELECT 1 FROM commerce_conversations c WHERE c.id=e.conversation_id AND c.buyer_auth_user_id=NEW.actor_id)
          OR EXISTS(SELECT 1 FROM orders o LEFT JOIN commerce_order_owners a ON a.order_id=o.id
            WHERE o.id=e.order_id AND COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=NEW.actor_id)))
    ));
  SELECT RAISE(ABORT,'notification_immutable') WHERE EXISTS(SELECT 1 FROM commerce_notification_recipients WHERE id=NEW.id OR (event_id=NEW.event_id AND actor_kind=NEW.actor_kind AND actor_id=NEW.actor_id));
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
      AND NOT EXISTS(SELECT 1 FROM commerce_email_requests prior JOIN commerce_email_events problem ON problem.request_id=prior.id
        WHERE prior.email_hash=x.email_hash AND prior.commerce_environment=x.commerce_environment AND problem.kind IN ('bounced','complained','suppressed'))
      AND (e.category!='messages' OR NOT EXISTS(SELECT 1 FROM commerce_message_reads mr WHERE mr.conversation_id=e.conversation_id AND mr.actor_kind=r.actor_kind AND mr.actor_id=r.actor_id AND mr.event_id>=json_extract(e.data_json,'$.eventId')))
      AND NOT EXISTS(SELECT 1 FROM commerce_email_skips skip WHERE skip.job_id=j.id)
      AND NOT EXISTS(SELECT 1 FROM commerce_email_provider_bindings binding WHERE binding.request_id=x.id));
  SELECT RAISE(ABORT,'email_immutable') WHERE EXISTS(SELECT 1 FROM commerce_email_starts WHERE attempt_id=NEW.attempt_id);
END;
