CREATE TABLE commerce_notification_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES commerce_jobs(id),
  source_lease_token TEXT NOT NULL,
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  category TEXT NOT NULL CHECK(category IN ('payment_confirmed','payment_pending','payment_failed','payment_review','shipping','returns','messages','weekly_activity')),
  audience TEXT NOT NULL CHECK(audience IN ('merchant','buyer','both')),
  order_id TEXT,
  conversation_id TEXT REFERENCES commerce_conversations(id),
  return_id TEXT REFERENCES commerce_returns(id),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  body TEXT NOT NULL CHECK(length(body)<=600),
  data_json TEXT NOT NULL CHECK(json_valid(data_json) AND json_type(data_json)='object' AND length(data_json)<=24000),
  suppression TEXT NOT NULL DEFAULT '' CHECK(suppression IN ('','not_actionable','obsolete','store_closed')),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(seller_id,order_id) REFERENCES orders(seller_id,id),
  CHECK((category='messages' AND conversation_id IS NOT NULL AND order_id IS NULL AND return_id IS NULL)
    OR (category='weekly_activity' AND conversation_id IS NULL AND order_id IS NULL AND return_id IS NULL AND audience='merchant')
    OR (category NOT IN ('messages','weekly_activity') AND conversation_id IS NULL AND order_id IS NOT NULL)),
  CHECK((category='returns' AND return_id IS NOT NULL) OR (category!='returns' AND return_id IS NULL))
);
CREATE INDEX commerce_notification_event_store ON commerce_notification_events(seller_id,commerce_environment,created_at,id);
CREATE TABLE commerce_notification_recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES commerce_notification_events(id),
  actor_kind TEXT NOT NULL CHECK(actor_kind IN ('merchant','buyer')),
  actor_id TEXT NOT NULL,
  preference_revision INTEGER NOT NULL CHECK(preference_revision>=0),
  in_app INTEGER NOT NULL CHECK(in_app IN (0,1)),
  email_requested INTEGER NOT NULL CHECK(email_requested IN (0,1)),
  created_at TEXT NOT NULL,
  UNIQUE(event_id,actor_kind,actor_id)
);
CREATE INDEX commerce_notification_recipient_inbox ON commerce_notification_recipients(actor_kind,actor_id,in_app,id DESC);
CREATE TABLE commerce_notification_reads (
  recipient_id INTEGER PRIMARY KEY REFERENCES commerce_notification_recipients(id),
  actor_kind TEXT NOT NULL CHECK(actor_kind IN ('merchant','buyer')),
  actor_id TEXT NOT NULL,
  read_at TEXT NOT NULL
);
CREATE TRIGGER commerce_notification_event_guard BEFORE INSERT ON commerce_notification_events BEGIN
  SELECT RAISE(ABORT,'notification_source_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_jobs j WHERE j.id=NEW.job_id
    AND j.seller_id=NEW.seller_id AND j.commerce_environment=NEW.commerce_environment AND j.order_id IS NEW.order_id
    AND j.lease_token=NEW.source_lease_token AND j.state='running' AND j.lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND j.created_at=NEW.occurred_at AND (
      (j.kind='notification.order_state' AND NEW.category IN ('payment_confirmed','payment_pending','payment_failed'))
      OR (j.kind='notification.payment_pending' AND NEW.category='payment_pending')
      OR (j.kind IN ('notification.payment_review','notification.stock_recovered') AND NEW.category='payment_review' AND NEW.audience='merchant')
      OR (j.kind='notification.shipment_updated' AND NEW.category='shipping')
      OR (j.kind='notification.return_updated' AND NEW.category='returns' AND json_extract(j.payload_json,'$.returnId')=NEW.return_id
        AND EXISTS(SELECT 1 FROM commerce_returns r WHERE r.id=NEW.return_id AND r.order_id=NEW.order_id AND r.seller_id=NEW.seller_id))
      OR (j.kind='notification.weekly_activity' AND NEW.category='weekly_activity')
      OR (j.kind='notification.message_received' AND NEW.category='messages' AND EXISTS(SELECT 1 FROM commerce_message_events m JOIN commerce_conversations c ON c.id=m.conversation_id
        WHERE m.id=json_extract(j.payload_json,'$.eventId') AND m.kind='message' AND c.id=NEW.conversation_id AND c.seller_id=NEW.seller_id
          AND c.commerce_environment=NEW.commerce_environment AND NEW.audience=(CASE m.actor_kind WHEN 'buyer' THEN 'merchant' ELSE 'buyer' END)))
    ));
  SELECT RAISE(ABORT,'notification_immutable') WHERE EXISTS(SELECT 1 FROM commerce_notification_events WHERE id=NEW.id OR job_id=NEW.job_id);
END;
CREATE TRIGGER commerce_notification_fanout AFTER INSERT ON commerce_notification_events BEGIN
  INSERT INTO commerce_notification_recipients(event_id,actor_kind,actor_id,preference_revision,in_app,email_requested,created_at)
    SELECT NEW.id,'merchant',m.auth_user_id,COALESCE(p.revision,0),
      COALESCE(json_extract(p.preferences_json,'$.'||NEW.category||'.inApp'),CASE WHEN NEW.category='weekly_activity' THEN 0 ELSE 1 END),
      COALESCE(json_extract(p.preferences_json,'$.'||NEW.category||'.email'),0),NEW.created_at
    FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id LEFT JOIN commerce_notification_preferences p ON p.seller_id=m.seller_id AND p.auth_user_id=m.auth_user_id
    WHERE m.seller_id=NEW.seller_id AND s.status='active' AND NEW.suppression='' AND NEW.audience IN ('merchant','both');
  INSERT INTO commerce_notification_recipients(event_id,actor_kind,actor_id,preference_revision,in_app,email_requested,created_at)
    SELECT NEW.id,'buyer',COALESCE(c.buyer_auth_user_id,a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),'')),0,1,0,NEW.created_at
    FROM sellers s LEFT JOIN orders o ON o.id=NEW.order_id LEFT JOIN commerce_order_owners a ON a.order_id=o.id LEFT JOIN commerce_conversations c ON c.id=NEW.conversation_id
    WHERE s.id=NEW.seller_id AND s.status='active' AND NEW.suppression='' AND NEW.audience IN ('buyer','both')
      AND COALESCE(c.buyer_auth_user_id,a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),'')) IS NOT NULL;
END;
CREATE TRIGGER commerce_notification_recipient_guard BEFORE INSERT ON commerce_notification_recipients BEGIN
  SELECT RAISE(ABORT,'notification_recipient_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_notification_events e JOIN sellers s ON s.id=e.seller_id
    WHERE e.id=NEW.event_id AND e.suppression='' AND s.status='active' AND e.created_at=NEW.created_at AND (
      (NEW.actor_kind='merchant' AND e.audience IN ('merchant','both') AND EXISTS(SELECT 1 FROM seller_memberships m
        LEFT JOIN commerce_notification_preferences p ON p.seller_id=m.seller_id AND p.auth_user_id=m.auth_user_id
        WHERE m.seller_id=e.seller_id AND m.auth_user_id=NEW.actor_id AND NEW.preference_revision=COALESCE(p.revision,0)
          AND NEW.in_app=COALESCE(json_extract(p.preferences_json,'$.'||e.category||'.inApp'),CASE WHEN e.category='weekly_activity' THEN 0 ELSE 1 END)
          AND NEW.email_requested=COALESCE(json_extract(p.preferences_json,'$.'||e.category||'.email'),0)))
      OR (NEW.actor_kind='buyer' AND e.audience IN ('buyer','both') AND NEW.preference_revision=0 AND NEW.in_app=1 AND NEW.email_requested=0
        AND (EXISTS(SELECT 1 FROM commerce_conversations c WHERE c.id=e.conversation_id AND c.buyer_auth_user_id=NEW.actor_id)
          OR EXISTS(SELECT 1 FROM orders o LEFT JOIN commerce_order_owners a ON a.order_id=o.id
            WHERE o.id=e.order_id AND COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=NEW.actor_id)))
    ));
  SELECT RAISE(ABORT,'notification_immutable') WHERE EXISTS(SELECT 1 FROM commerce_notification_recipients WHERE id=NEW.id OR (event_id=NEW.event_id AND actor_kind=NEW.actor_kind AND actor_id=NEW.actor_id));
END;
CREATE TRIGGER commerce_notification_read_guard BEFORE INSERT ON commerce_notification_reads BEGIN
  SELECT RAISE(ABORT,'notification_read_immutable') WHERE EXISTS(SELECT 1 FROM commerce_notification_reads WHERE recipient_id=NEW.recipient_id);
  SELECT RAISE(ABORT,'notification_read_forbidden') WHERE NOT EXISTS(SELECT 1 FROM commerce_notification_recipients r JOIN commerce_notification_events e ON e.id=r.event_id
    JOIN sellers s ON s.id=e.seller_id WHERE r.id=NEW.recipient_id AND r.actor_kind=NEW.actor_kind AND r.actor_id=NEW.actor_id AND r.in_app=1 AND (
      (NEW.actor_kind='merchant' AND s.status='active' AND EXISTS(SELECT 1 FROM seller_memberships m WHERE m.seller_id=e.seller_id AND m.auth_user_id=NEW.actor_id))
      OR (NEW.actor_kind='buyer' AND (EXISTS(SELECT 1 FROM commerce_conversations c WHERE c.id=e.conversation_id AND c.buyer_auth_user_id=NEW.actor_id)
        OR EXISTS(SELECT 1 FROM orders o LEFT JOIN commerce_order_owners a ON a.order_id=o.id WHERE o.id=e.order_id
          AND COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=NEW.actor_id)))
    ));
END;
CREATE TRIGGER commerce_notification_event_update BEFORE UPDATE ON commerce_notification_events BEGIN SELECT RAISE(ABORT,'notification_immutable'); END;
CREATE TRIGGER commerce_notification_event_delete BEFORE DELETE ON commerce_notification_events BEGIN SELECT RAISE(ABORT,'notification_immutable'); END;
CREATE TRIGGER commerce_notification_recipient_update BEFORE UPDATE ON commerce_notification_recipients BEGIN SELECT RAISE(ABORT,'notification_immutable'); END;
CREATE TRIGGER commerce_notification_recipient_delete BEFORE DELETE ON commerce_notification_recipients BEGIN SELECT RAISE(ABORT,'notification_immutable'); END;
CREATE TRIGGER commerce_notification_read_update BEFORE UPDATE ON commerce_notification_reads BEGIN SELECT RAISE(ABORT,'notification_read_immutable'); END;
CREATE TRIGGER commerce_notification_read_delete BEFORE DELETE ON commerce_notification_reads BEGIN SELECT RAISE(ABORT,'notification_read_immutable'); END;
CREATE TRIGGER commerce_notification_job_complete BEFORE UPDATE OF state ON commerce_jobs
WHEN NEW.state='succeeded' AND NEW.kind IN ('notification.order_state','notification.payment_pending','notification.payment_review','notification.stock_recovered','notification.shipment_updated','notification.return_updated','notification.message_received','notification.weekly_activity') BEGIN
  SELECT RAISE(ABORT,'notification_receipt_required') WHERE NOT EXISTS(SELECT 1 FROM commerce_notification_events e WHERE e.job_id=NEW.id AND e.seller_id=NEW.seller_id AND e.commerce_environment=NEW.commerce_environment);
END;
CREATE TRIGGER commerce_message_notification AFTER INSERT ON commerce_message_events WHEN NEW.kind='message' BEGIN
  INSERT INTO commerce_jobs(id,seller_id,commerce_environment,job_key,kind,payload_json,available_at,created_at,updated_at)
    SELECT 'job_'||lower(hex(randomblob(16))),c.seller_id,NEW.commerce_environment,'message_event:'||NEW.id,'notification.message_received',
      json_object('eventId',NEW.id),NEW.created_at,NEW.created_at,NEW.created_at FROM commerce_conversations c WHERE c.id=NEW.conversation_id;
END;
