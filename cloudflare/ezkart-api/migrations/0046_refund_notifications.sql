-- Preserve every existing receipt, recipient and preference while adding refund context.
-- D1 executes this migration in one transaction; foreign-key checks are deferred only for the table replacement.

PRAGMA defer_foreign_keys=ON;

CREATE TABLE commerce_notification_events_0046_backup AS SELECT * FROM commerce_notification_events;

DROP TABLE commerce_notification_events;

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
  refund_id TEXT REFERENCES commerce_refunds(id),
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
  CHECK((category='returns' AND ((return_id IS NOT NULL)+(refund_id IS NOT NULL))=1)
    OR (category!='returns' AND return_id IS NULL AND refund_id IS NULL))
);

INSERT INTO commerce_notification_events(id,job_id,source_lease_token,seller_id,commerce_environment,category,audience,order_id,conversation_id,return_id,title,body,data_json,suppression,occurred_at,created_at) SELECT id,job_id,source_lease_token,seller_id,commerce_environment,category,audience,order_id,conversation_id,return_id,title,body,data_json,suppression,occurred_at,created_at FROM commerce_notification_events_0046_backup;

DROP TABLE commerce_notification_events_0046_backup;

CREATE INDEX commerce_notification_event_store ON commerce_notification_events(seller_id,commerce_environment,created_at,id);

CREATE INDEX idx_refund_notifications ON commerce_notification_events(refund_id,created_at,id);

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
      OR (j.kind='notification.refund_updated' AND NEW.category='returns' AND NEW.audience='both'
        AND NEW.return_id IS NULL AND json_extract(j.payload_json,'$.refundId')=NEW.refund_id
        AND json_extract(NEW.data_json,'$.refundId')=NEW.refund_id
        AND json_extract(NEW.data_json,'$.state')=json_extract(j.payload_json,'$.state')
        AND EXISTS(SELECT 1 FROM commerce_refunds r WHERE r.id=NEW.refund_id AND r.seller_id=NEW.seller_id
          AND r.order_id=NEW.order_id AND r.commerce_environment=NEW.commerce_environment AND (
            (json_extract(j.payload_json,'$.state')='requested' AND json_type(j.payload_json,'$.actionId') IS NULL
              AND r.created_at=j.created_at AND j.job_key='refund_request:'||r.id)
            OR EXISTS(SELECT 1 FROM commerce_refund_actions a WHERE a.id=json_extract(j.payload_json,'$.actionId')
              AND a.refund_id=r.id AND a.created_at=j.created_at AND j.job_key='refund_action:'||a.id
              AND json_extract(j.payload_json,'$.state')=CASE a.kind WHEN 'approve' THEN 'approved' WHEN 'decline' THEN 'declined' ELSE 'withdrawn' END))))
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
    SELECT NEW.id,'buyer',COALESCE(c.buyer_auth_user_id,a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),'')),COALESCE(p.revision,0),COALESCE(json_extract(p.preferences_json,'$.'||NEW.category||'.inApp'),1),COALESCE(json_extract(p.preferences_json,'$.'||NEW.category||'.email'),0),NEW.created_at
    FROM sellers s LEFT JOIN orders o ON o.id=NEW.order_id LEFT JOIN commerce_order_owners a ON a.order_id=o.id LEFT JOIN commerce_conversations c ON c.id=NEW.conversation_id
      LEFT JOIN commerce_buyer_notification_preferences p ON p.auth_user_id=COALESCE(c.buyer_auth_user_id,a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))
    WHERE s.id=NEW.seller_id AND s.status='active' AND NEW.suppression='' AND NEW.audience IN ('buyer','both')
      AND COALESCE(c.buyer_auth_user_id,a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),'')) IS NOT NULL;
END;

CREATE TRIGGER commerce_notification_event_update BEFORE UPDATE ON commerce_notification_events BEGIN SELECT RAISE(ABORT,'notification_immutable'); END;

CREATE TRIGGER commerce_notification_event_delete BEFORE DELETE ON commerce_notification_events BEGIN SELECT RAISE(ABORT,'notification_immutable'); END;

DROP TRIGGER commerce_notification_job_complete;

CREATE TRIGGER commerce_notification_job_complete BEFORE UPDATE OF state ON commerce_jobs
WHEN NEW.state='succeeded' AND NEW.kind IN ('notification.order_state','notification.payment_pending','notification.payment_review','notification.stock_recovered','notification.shipment_updated','notification.return_updated','notification.refund_updated','notification.message_received','notification.weekly_activity') BEGIN
  SELECT RAISE(ABORT,'notification_receipt_required') WHERE NOT EXISTS(SELECT 1 FROM commerce_notification_events e WHERE e.job_id=NEW.id AND e.seller_id=NEW.seller_id AND e.commerce_environment=NEW.commerce_environment);
END;

CREATE TRIGGER commerce_refund_requested_notification AFTER INSERT ON commerce_refunds BEGIN
  INSERT INTO commerce_jobs(id,seller_id,order_id,commerce_environment,job_key,kind,payload_json,available_at,created_at,updated_at)
    VALUES('job_'||lower(hex(randomblob(16))),NEW.seller_id,NEW.order_id,NEW.commerce_environment,'refund_request:'||NEW.id,'notification.refund_updated',
      json_object('orderId',NEW.order_id,'refundId',NEW.id,'state','requested'),NEW.created_at,NEW.created_at,NEW.created_at);
END;
CREATE TRIGGER commerce_refund_decision_notification AFTER INSERT ON commerce_refund_actions BEGIN
  INSERT INTO commerce_jobs(id,seller_id,order_id,commerce_environment,job_key,kind,payload_json,available_at,created_at,updated_at)
    SELECT 'job_'||lower(hex(randomblob(16))),r.seller_id,r.order_id,r.commerce_environment,'refund_action:'||NEW.id,'notification.refund_updated',
      json_object('orderId',r.order_id,'refundId',r.id,'actionId',NEW.id,'state',CASE NEW.kind WHEN 'approve' THEN 'approved' WHEN 'decline' THEN 'declined' ELSE 'withdrawn' END),
      NEW.created_at,NEW.created_at,NEW.created_at FROM commerce_refunds r WHERE r.id=NEW.refund_id;
END;

-- Historical requests retain the original source times and the same unique job identities.
INSERT INTO commerce_jobs(id,seller_id,order_id,commerce_environment,job_key,kind,payload_json,available_at,created_at,updated_at)
  SELECT 'job_'||lower(hex(randomblob(16))),r.seller_id,r.order_id,r.commerce_environment,'refund_request:'||r.id,'notification.refund_updated',
    json_object('orderId',r.order_id,'refundId',r.id,'state','requested'),r.created_at,r.created_at,r.created_at FROM commerce_refunds r
  WHERE NOT EXISTS(SELECT 1 FROM commerce_jobs j WHERE j.seller_id=r.seller_id AND j.commerce_environment=r.commerce_environment AND j.job_key='refund_request:'||r.id);
INSERT INTO commerce_jobs(id,seller_id,order_id,commerce_environment,job_key,kind,payload_json,available_at,created_at,updated_at)
  SELECT 'job_'||lower(hex(randomblob(16))),r.seller_id,r.order_id,r.commerce_environment,'refund_action:'||a.id,'notification.refund_updated',
    json_object('orderId',r.order_id,'refundId',r.id,'actionId',a.id,'state',CASE a.kind WHEN 'approve' THEN 'approved' WHEN 'decline' THEN 'declined' ELSE 'withdrawn' END),
    a.created_at,a.created_at,a.created_at FROM commerce_refund_actions a JOIN commerce_refunds r ON r.id=a.refund_id
  WHERE NOT EXISTS(SELECT 1 FROM commerce_jobs j WHERE j.seller_id=r.seller_id AND j.commerce_environment=r.commerce_environment AND j.job_key='refund_action:'||a.id);
PRAGMA defer_foreign_keys=OFF;
