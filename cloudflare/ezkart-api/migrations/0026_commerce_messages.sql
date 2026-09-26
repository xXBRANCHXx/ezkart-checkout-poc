CREATE TABLE commerce_conversations (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  buyer_auth_user_id TEXT NOT NULL,
  buyer_name TEXT NOT NULL CHECK(length(buyer_name) BETWEEN 1 AND 100),
  context_kind TEXT NOT NULL CHECK(context_kind IN ('order','product','store')),
  context_id TEXT NOT NULL,
  creator_kind TEXT NOT NULL CHECK(creator_kind IN ('buyer','merchant')),
  creator_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','resolved','blocked')),
  revision INTEGER NOT NULL DEFAULT 0,
  last_event_id INTEGER NOT NULL DEFAULT 0,
  UNIQUE(seller_id,commerce_environment,buyer_auth_user_id)
);
CREATE TABLE commerce_message_media (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES commerce_conversations(id),
  commerce_environment TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK(actor_kind IN ('buyer','merchant')),
  actor_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp')),
  size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 1048576),
  state TEXT NOT NULL DEFAULT 'uploading' CHECK(state IN ('uploading','ready','deleting')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  cleanup_at TEXT,
  UNIQUE(actor_kind,actor_id,commerce_environment,request_key)
);
CREATE INDEX commerce_message_media_expiry ON commerce_message_media(cleanup_at,expires_at);
CREATE TABLE commerce_message_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES commerce_conversations(id),
  commerce_environment TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK(actor_kind IN ('buyer','merchant')),
  actor_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('message','state')),
  body TEXT NOT NULL CHECK(length(body)<=4000),
  media_json TEXT NOT NULL CHECK(json_valid(media_json) AND json_type(media_json)='array' AND json_array_length(media_json)<=4),
  context_json TEXT NOT NULL CHECK(json_valid(context_json) AND json_type(context_json)='object'),
  state TEXT NOT NULL CHECK(state IN ('open','resolved','blocked')),
  expected_revision INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE(actor_kind,actor_id,commerce_environment,request_key)
);
CREATE INDEX commerce_message_events_thread ON commerce_message_events(conversation_id,id DESC);
CREATE INDEX commerce_message_events_rate ON commerce_message_events(actor_kind,actor_id,created_at);
CREATE TABLE commerce_message_media_links (
  media_id TEXT PRIMARY KEY REFERENCES commerce_message_media(id),
  event_id INTEGER NOT NULL REFERENCES commerce_message_events(id)
);
CREATE TABLE commerce_message_reads (
  conversation_id TEXT NOT NULL REFERENCES commerce_conversations(id),
  actor_kind TEXT NOT NULL CHECK(actor_kind IN ('buyer','merchant')),
  actor_id TEXT NOT NULL,
  event_id INTEGER NOT NULL REFERENCES commerce_message_events(id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(conversation_id,actor_kind,actor_id)
);
CREATE TABLE commerce_saved_replies (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  commerce_environment TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 80),
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),
  state TEXT NOT NULL CHECK(state IN ('active','archived')),
  revision INTEGER NOT NULL CHECK(revision>0),
  updated_at TEXT NOT NULL
);
CREATE TABLE commerce_saved_reply_changes (
  reply_id TEXT NOT NULL,
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  commerce_environment TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 80),
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),
  state TEXT NOT NULL CHECK(state IN ('active','archived')),
  revision INTEGER NOT NULL CHECK(revision>0),
  created_at TEXT NOT NULL,
  PRIMARY KEY(actor_id,commerce_environment,request_key),
  UNIQUE(reply_id,revision)
);

CREATE TRIGGER commerce_message_conversation_insert BEFORE INSERT ON commerce_conversations BEGIN
  SELECT RAISE(ABORT,'immutable_conversation') WHERE EXISTS(SELECT 1 FROM commerce_conversations WHERE id=NEW.id);
  SELECT RAISE(ABORT,'message_forbidden') WHERE (NEW.creator_kind='buyer' AND NEW.creator_id!=NEW.buyer_auth_user_id)
    OR (NEW.creator_kind='merchant' AND (NEW.context_kind!='order' OR NOT EXISTS(SELECT 1 FROM seller_memberships m
      WHERE m.seller_id=NEW.seller_id AND m.auth_user_id=NEW.creator_id AND m.role!='viewer')))
    OR NOT EXISTS(SELECT 1 FROM sellers WHERE id=NEW.seller_id AND status='active');
  SELECT RAISE(ABORT,'message_forbidden') WHERE
    (NEW.context_kind='order' AND NOT EXISTS(SELECT 1 FROM orders o LEFT JOIN commerce_order_owners a ON a.order_id=o.id
      WHERE o.id=NEW.context_id AND o.seller_id=NEW.seller_id AND o.commerce_environment=NEW.commerce_environment AND o.commerce_version=1
      AND COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=NEW.buyer_auth_user_id))
    OR (NEW.context_kind='product' AND NOT EXISTS(SELECT 1 FROM products WHERE id=NEW.context_id AND seller_id=NEW.seller_id AND status='active'))
    OR (NEW.context_kind='store' AND (NEW.context_id!=NEW.seller_id OR NOT EXISTS(SELECT 1 FROM sellers WHERE id=NEW.seller_id AND json_extract(settings_json,'$.storefront.enabled')=1)));
  SELECT RAISE(ABORT,'message_rate') WHERE (SELECT COUNT(*) FROM commerce_conversations WHERE buyer_auth_user_id=NEW.buyer_auth_user_id
    AND created_at>strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'-1 hour'))>=30;
END;
CREATE TRIGGER commerce_message_event_guard BEFORE INSERT ON commerce_message_events BEGIN
  SELECT RAISE(ABORT,'immutable_message') WHERE EXISTS(SELECT 1 FROM commerce_message_events WHERE id=NEW.id OR (actor_kind=NEW.actor_kind AND actor_id=NEW.actor_id AND commerce_environment=NEW.commerce_environment AND request_key=NEW.request_key));
  SELECT RAISE(ABORT,'message_forbidden') WHERE NOT EXISTS(SELECT 1 FROM commerce_conversations c JOIN sellers s ON s.id=c.seller_id
    WHERE c.id=NEW.conversation_id AND c.commerce_environment=NEW.commerce_environment AND s.status='active'
      AND ((NEW.actor_kind='buyer' AND c.buyer_auth_user_id=NEW.actor_id)
        OR (NEW.actor_kind='merchant' AND EXISTS(SELECT 1 FROM seller_memberships m WHERE m.seller_id=c.seller_id AND m.auth_user_id=NEW.actor_id AND m.role!='viewer'))));
  SELECT RAISE(ABORT,'message_revision') WHERE NEW.kind='state' AND (NEW.actor_kind!='merchant' OR NEW.expected_revision IS NOT (SELECT revision FROM commerce_conversations WHERE id=NEW.conversation_id));
  SELECT RAISE(ABORT,'message_blocked') WHERE NEW.kind='message' AND (SELECT state FROM commerce_conversations WHERE id=NEW.conversation_id)='blocked';
  SELECT RAISE(ABORT,'message_invalid') WHERE (NEW.kind='message' AND (NEW.state!='open' OR (length(trim(NEW.body))=0 AND json_array_length(NEW.media_json)=0)))
    OR (NEW.kind='state' AND (NEW.body!='' OR NEW.media_json!='[]' OR NEW.context_json!='{}'));
  SELECT RAISE(ABORT,'message_rate') WHERE (SELECT COUNT(*) FROM commerce_message_events WHERE actor_kind=NEW.actor_kind AND actor_id=NEW.actor_id AND created_at>strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'-1 minute'))>=40
    OR (SELECT COUNT(*) FROM commerce_message_events WHERE actor_kind=NEW.actor_kind AND actor_id=NEW.actor_id AND created_at>strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'-1 day'))>=2000;
  SELECT RAISE(ABORT,'message_photo_invalid') WHERE (SELECT COUNT(DISTINCT value) FROM json_each(NEW.media_json))!=json_array_length(NEW.media_json)
    OR EXISTS(SELECT 1 FROM json_each(NEW.media_json) p WHERE p.type!='text' OR NOT EXISTS(
      SELECT 1 FROM commerce_message_media m WHERE m.id=p.value AND m.conversation_id=NEW.conversation_id AND m.commerce_environment=NEW.commerce_environment
        AND m.actor_kind=NEW.actor_kind AND m.actor_id=NEW.actor_id AND m.state='ready' AND m.expires_at>NEW.created_at
        AND NOT EXISTS(SELECT 1 FROM commerce_message_media_links l WHERE l.media_id=m.id)));
END;
CREATE TRIGGER commerce_message_event_apply AFTER INSERT ON commerce_message_events BEGIN
  UPDATE commerce_conversations SET state=NEW.state,revision=revision+1,last_event_id=NEW.id WHERE id=NEW.conversation_id;
  INSERT INTO commerce_message_media_links(media_id,event_id) SELECT value,NEW.id FROM json_each(NEW.media_json);
END;
CREATE TRIGGER commerce_message_event_update BEFORE UPDATE ON commerce_message_events BEGIN SELECT RAISE(ABORT,'immutable_message'); END;
CREATE TRIGGER commerce_message_event_delete BEFORE DELETE ON commerce_message_events BEGIN SELECT RAISE(ABORT,'immutable_message'); END;
CREATE TRIGGER commerce_message_link_update BEFORE UPDATE ON commerce_message_media_links BEGIN SELECT RAISE(ABORT,'immutable_message_photo'); END;
CREATE TRIGGER commerce_message_link_delete BEFORE DELETE ON commerce_message_media_links BEGIN SELECT RAISE(ABORT,'immutable_message_photo'); END;
CREATE TRIGGER commerce_message_conversation_update BEFORE UPDATE ON commerce_conversations BEGIN
  SELECT RAISE(ABORT,'immutable_conversation') WHERE NEW.id!=OLD.id OR NEW.seller_id!=OLD.seller_id OR NEW.commerce_environment!=OLD.commerce_environment
    OR NEW.buyer_auth_user_id!=OLD.buyer_auth_user_id OR NEW.buyer_name!=OLD.buyer_name OR NEW.created_at!=OLD.created_at
    OR NEW.context_kind!=OLD.context_kind OR NEW.context_id!=OLD.context_id OR NEW.creator_kind!=OLD.creator_kind OR NEW.creator_id!=OLD.creator_id
    OR NEW.revision!=OLD.revision+1 OR NEW.last_event_id<=OLD.last_event_id
    OR NOT EXISTS(SELECT 1 FROM commerce_message_events e WHERE e.id=NEW.last_event_id AND e.conversation_id=OLD.id AND e.state=NEW.state);
END;
CREATE TRIGGER commerce_message_conversation_delete BEFORE DELETE ON commerce_conversations BEGIN SELECT RAISE(ABORT,'immutable_conversation'); END;
CREATE TRIGGER commerce_message_media_guard BEFORE INSERT ON commerce_message_media BEGIN
  SELECT RAISE(ABORT,'immutable_message_photo') WHERE EXISTS(SELECT 1 FROM commerce_message_media WHERE id=NEW.id);
  SELECT RAISE(ABORT,'message_forbidden') WHERE NOT EXISTS(SELECT 1 FROM commerce_conversations c JOIN sellers s ON s.id=c.seller_id
    WHERE c.id=NEW.conversation_id AND c.commerce_environment=NEW.commerce_environment AND c.state!='blocked' AND s.status='active'
    AND ((NEW.actor_kind='buyer' AND c.buyer_auth_user_id=NEW.actor_id) OR (NEW.actor_kind='merchant' AND EXISTS(
      SELECT 1 FROM seller_memberships m WHERE m.seller_id=c.seller_id AND m.auth_user_id=NEW.actor_id AND m.role!='viewer'))));
  SELECT RAISE(ABORT,'message_rate') WHERE (SELECT COUNT(*) FROM commerce_message_media WHERE actor_kind=NEW.actor_kind AND actor_id=NEW.actor_id
    AND created_at>strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'-1 hour'))>=60;
END;
CREATE TRIGGER commerce_message_media_update BEFORE UPDATE ON commerce_message_media BEGIN
  SELECT RAISE(ABORT,'immutable_message_photo') WHERE NEW.id!=OLD.id OR NEW.conversation_id!=OLD.conversation_id OR NEW.commerce_environment!=OLD.commerce_environment
    OR NEW.actor_kind!=OLD.actor_kind OR NEW.actor_id!=OLD.actor_id OR NEW.request_key!=OLD.request_key OR NEW.content_hash!=OLD.content_hash OR NEW.r2_key!=OLD.r2_key
    OR NEW.mime_type!=OLD.mime_type OR NEW.size_bytes!=OLD.size_bytes OR NEW.created_at!=OLD.created_at OR NEW.expires_at!=OLD.expires_at
    OR (OLD.state='deleting' AND NEW.state!='deleting') OR (OLD.state='ready' AND NEW.state='uploading')
    OR (NEW.state='deleting' AND EXISTS(SELECT 1 FROM commerce_message_media_links WHERE media_id=OLD.id));
END;
CREATE TRIGGER commerce_message_media_delete BEFORE DELETE ON commerce_message_media WHEN OLD.state!='deleting' BEGIN SELECT RAISE(ABORT,'immutable_message_photo'); END;
CREATE TRIGGER commerce_message_read_insert BEFORE INSERT ON commerce_message_reads BEGIN
  SELECT RAISE(ABORT,'message_read_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_message_events e JOIN commerce_conversations c ON c.id=e.conversation_id
    JOIN sellers s ON s.id=c.seller_id WHERE e.id=NEW.event_id AND c.id=NEW.conversation_id AND (s.status='active' OR NEW.actor_kind='buyer')
    AND ((NEW.actor_kind='buyer' AND c.buyer_auth_user_id=NEW.actor_id) OR (NEW.actor_kind='merchant' AND EXISTS(
      SELECT 1 FROM seller_memberships m WHERE m.seller_id=c.seller_id AND m.auth_user_id=NEW.actor_id))));
END;
CREATE TRIGGER commerce_message_read_update BEFORE UPDATE ON commerce_message_reads BEGIN
  SELECT RAISE(ABORT,'message_read_invalid') WHERE NEW.conversation_id!=OLD.conversation_id OR NEW.actor_kind!=OLD.actor_kind OR NEW.actor_id!=OLD.actor_id
    OR NEW.event_id<OLD.event_id OR NOT EXISTS(SELECT 1 FROM commerce_message_events e WHERE e.id=NEW.event_id AND e.conversation_id=NEW.conversation_id);
END;
CREATE TRIGGER commerce_saved_reply_guard BEFORE INSERT ON commerce_saved_reply_changes BEGIN
  SELECT RAISE(ABORT,'immutable_saved_reply_change') WHERE EXISTS(SELECT 1 FROM commerce_saved_reply_changes WHERE reply_id=NEW.reply_id AND revision=NEW.revision);
  SELECT RAISE(ABORT,'message_forbidden') WHERE NOT EXISTS(SELECT 1 FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id
    WHERE m.seller_id=NEW.seller_id AND m.auth_user_id=NEW.actor_id AND m.role!='viewer' AND s.status='active');
  SELECT RAISE(ABORT,'message_revision') WHERE NEW.revision!=1+COALESCE((SELECT revision FROM commerce_saved_replies WHERE id=NEW.reply_id),0)
    OR EXISTS(SELECT 1 FROM commerce_saved_replies r WHERE r.id=NEW.reply_id AND (r.seller_id!=NEW.seller_id OR r.commerce_environment!=NEW.commerce_environment));
  SELECT RAISE(ABORT,'message_reply_limit') WHERE NEW.state='active' AND NOT EXISTS(SELECT 1 FROM commerce_saved_replies WHERE id=NEW.reply_id AND state='active')
    AND (SELECT COUNT(*) FROM commerce_saved_replies WHERE seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment AND state='active')>=100;
END;
CREATE TRIGGER commerce_saved_reply_apply AFTER INSERT ON commerce_saved_reply_changes BEGIN
  INSERT INTO commerce_saved_replies(id,seller_id,commerce_environment,title,body,state,revision,updated_at)
    VALUES(NEW.reply_id,NEW.seller_id,NEW.commerce_environment,NEW.title,NEW.body,NEW.state,NEW.revision,NEW.created_at)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,state=excluded.state,revision=excluded.revision,updated_at=excluded.updated_at;
END;
CREATE TRIGGER commerce_saved_reply_change_update BEFORE UPDATE ON commerce_saved_reply_changes BEGIN SELECT RAISE(ABORT,'immutable_saved_reply_change'); END;
CREATE TRIGGER commerce_saved_reply_change_delete BEFORE DELETE ON commerce_saved_reply_changes BEGIN SELECT RAISE(ABORT,'immutable_saved_reply_change'); END;

CREATE TRIGGER commerce_message_link_insert BEFORE INSERT ON commerce_message_media_links BEGIN
  SELECT RAISE(ABORT,'immutable_message_photo') WHERE EXISTS(SELECT 1 FROM commerce_message_media_links WHERE media_id=NEW.media_id)
    OR NOT EXISTS(SELECT 1 FROM commerce_message_events e JOIN json_each(e.media_json) p WHERE e.id=NEW.event_id AND p.value=NEW.media_id);
END;
CREATE TRIGGER commerce_saved_reply_insert BEFORE INSERT ON commerce_saved_replies BEGIN
  SELECT RAISE(ABORT,'message_revision') WHERE EXISTS(SELECT 1 FROM commerce_saved_replies WHERE id=NEW.id AND revision>=NEW.revision)
    OR NOT EXISTS(SELECT 1 FROM commerce_saved_reply_changes c WHERE c.reply_id=NEW.id AND c.revision=NEW.revision AND c.seller_id=NEW.seller_id
      AND c.commerce_environment=NEW.commerce_environment AND c.title=NEW.title AND c.body=NEW.body AND c.state=NEW.state AND c.created_at=NEW.updated_at);
END;
CREATE TRIGGER commerce_saved_reply_update BEFORE UPDATE ON commerce_saved_replies BEGIN
  SELECT RAISE(ABORT,'message_revision') WHERE NEW.id!=OLD.id OR NEW.seller_id!=OLD.seller_id OR NEW.commerce_environment!=OLD.commerce_environment
    OR NEW.revision!=OLD.revision+1 OR NOT EXISTS(SELECT 1 FROM commerce_saved_reply_changes c WHERE c.reply_id=NEW.id AND c.revision=NEW.revision
      AND c.seller_id=NEW.seller_id AND c.commerce_environment=NEW.commerce_environment AND c.title=NEW.title AND c.body=NEW.body AND c.state=NEW.state AND c.created_at=NEW.updated_at);
END;
CREATE TRIGGER commerce_saved_reply_delete BEFORE DELETE ON commerce_saved_replies BEGIN SELECT RAISE(ABORT,'immutable_saved_reply'); END;
