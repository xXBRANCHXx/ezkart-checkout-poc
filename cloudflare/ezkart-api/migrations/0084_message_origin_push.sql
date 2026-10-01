-- First verified landing source is retained independently of the visit's expiry.
CREATE TABLE commerce_message_origins (
 conversation_id TEXT PRIMARY KEY REFERENCES commerce_conversations(id),
 origin_json TEXT NOT NULL CHECK(json_valid(origin_json) AND json_type(origin_json)='object'),
 created_at TEXT NOT NULL
);
CREATE TRIGGER message_origin_update BEFORE UPDATE ON commerce_message_origins BEGIN SELECT RAISE(ABORT,'immutable_message_origin'); END;
CREATE TRIGGER message_origin_delete BEFORE DELETE ON commerce_message_origins BEGIN SELECT RAISE(ABORT,'immutable_message_origin'); END;
CREATE TABLE customer_push_subscriptions (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, commerce_environment TEXT NOT NULL,
 generation TEXT NOT NULL, endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX customer_push_actor ON customer_push_subscriptions(actor_id,commerce_environment,active);
CREATE TRIGGER customer_push_limit_insert BEFORE INSERT ON customer_push_subscriptions
WHEN NEW.active=1 AND NOT EXISTS(SELECT 1 FROM customer_push_subscriptions WHERE id=NEW.id AND actor_id=NEW.actor_id AND active=1)
BEGIN
 SELECT RAISE(ABORT,'customer_push_limit') WHERE (SELECT COUNT(*) FROM customer_push_subscriptions WHERE actor_id=NEW.actor_id AND commerce_environment=NEW.commerce_environment AND active=1 AND id!=NEW.id)>=10;
END;
CREATE TRIGGER customer_push_limit_update BEFORE UPDATE ON customer_push_subscriptions WHEN NEW.active=1
BEGIN
 SELECT RAISE(ABORT,'customer_push_limit') WHERE (SELECT COUNT(*) FROM customer_push_subscriptions WHERE actor_id=NEW.actor_id AND commerce_environment=NEW.commerce_environment AND active=1 AND id!=NEW.id)>=10;
END;
CREATE TABLE customer_push_deliveries (
 event_id TEXT NOT NULL REFERENCES commerce_notification_events(id), subscription_id TEXT NOT NULL REFERENCES customer_push_subscriptions(id),
 generation TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','failed','revoked')),
 attempts INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until TEXT, available_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(event_id,subscription_id,generation)
);
CREATE INDEX customer_push_pending ON customer_push_deliveries(state,available_at);
