CREATE TABLE commerce_store_settings (
  seller_id TEXT PRIMARY KEY REFERENCES sellers(id),
  revision INTEGER NOT NULL CHECK(revision>0),
  profile_json TEXT NOT NULL CHECK(json_valid(profile_json) AND json_type(profile_json)='object'),
  updated_at TEXT NOT NULL
);
CREATE TABLE commerce_notification_preferences (
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  auth_user_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  preferences_json TEXT NOT NULL CHECK(json_valid(preferences_json) AND json_type(preferences_json)='object'),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(seller_id,auth_user_id)
);
CREATE TABLE commerce_settings_changes (
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  kind TEXT NOT NULL CHECK(kind IN ('profile','notifications')),
  subject TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  request_key TEXT NOT NULL CHECK(length(request_key)=32 AND request_key NOT GLOB '*[^a-f0-9]*'),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^a-f0-9]*'),
  expected_revision INTEGER NOT NULL CHECK(expected_revision>=0),
  revision INTEGER NOT NULL CHECK(revision=expected_revision+1 AND revision<=9007199254740991),
  data_json TEXT NOT NULL CHECK(json_valid(data_json) AND json_type(data_json)='object'),
  created_at TEXT NOT NULL,
  PRIMARY KEY(actor_id,request_key),
  UNIQUE(seller_id,kind,subject,revision)
);
CREATE INDEX commerce_settings_history ON commerce_settings_changes(seller_id,kind,subject,revision DESC);
CREATE INDEX commerce_settings_actor_activity ON commerce_settings_changes(actor_id,created_at);
CREATE TRIGGER commerce_settings_change_guard BEFORE INSERT ON commerce_settings_changes BEGIN
  SELECT RAISE(ABORT,'settings_forbidden') WHERE NOT EXISTS(SELECT 1 FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id
    WHERE m.seller_id=NEW.seller_id AND m.auth_user_id=NEW.actor_id AND s.status='active' AND (NEW.kind='notifications' OR m.role!='viewer'))
    OR (NEW.kind='profile' AND NEW.subject!='store') OR (NEW.kind='notifications' AND NEW.subject!=NEW.actor_id);
  SELECT RAISE(ABORT,'settings_revision_conflict') WHERE NEW.expected_revision!=(CASE NEW.kind
    WHEN 'profile' THEN COALESCE((SELECT revision FROM commerce_store_settings WHERE seller_id=NEW.seller_id),0)
    ELSE COALESCE((SELECT revision FROM commerce_notification_preferences WHERE seller_id=NEW.seller_id AND auth_user_id=NEW.actor_id),0) END);
  SELECT RAISE(ABORT,'settings_receipt_immutable') WHERE EXISTS(SELECT 1 FROM commerce_settings_changes WHERE actor_id=NEW.actor_id AND request_key=NEW.request_key);
  SELECT RAISE(ABORT,'settings_rate_limited') WHERE (SELECT COUNT(*) FROM commerce_settings_changes WHERE actor_id=NEW.actor_id AND created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute'))>=60
    OR (SELECT COUNT(*) FROM commerce_settings_changes WHERE actor_id=NEW.actor_id AND created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day'))>=1000;
  SELECT RAISE(ABORT,'settings_invalid') WHERE NEW.kind='profile' AND (
    json_type(NEW.data_json,'$.name') IS NOT 'text' OR length(trim(json_extract(NEW.data_json,'$.name'))) NOT BETWEEN 1 AND 120
    OR json_type(NEW.data_json,'$.businessType') IS NOT 'text' OR json_extract(NEW.data_json,'$.businessType') NOT IN ('online_merchant','retailer','manufacturer','service_provider')
    OR json_type(NEW.data_json,'$.supportEmail') IS NOT 'text' OR length(json_extract(NEW.data_json,'$.supportEmail'))>160
    OR json_type(NEW.data_json,'$.supportPhone') IS NOT 'text' OR length(json_extract(NEW.data_json,'$.supportPhone'))>16
    OR json_type(NEW.data_json,'$.description') IS NOT 'text' OR length(json_extract(NEW.data_json,'$.description'))>1000
    OR json_type(NEW.data_json,'$.timezone') IS NOT 'text' OR json_extract(NEW.data_json,'$.timezone') NOT IN ('Asia/Jakarta','Asia/Makassar','Asia/Jayapura')
    OR json_type(NEW.data_json,'$.dateFormat') IS NOT 'text' OR json_extract(NEW.data_json,'$.dateFormat') NOT IN ('long','numeric','iso')
    OR (SELECT COUNT(*) FROM json_each(NEW.data_json))!=7);
  SELECT RAISE(ABORT,'settings_invalid') WHERE NEW.kind='notifications' AND (
    (SELECT COUNT(*) FROM json_each(NEW.data_json))!=8 OR (SELECT COUNT(DISTINCT key) FROM json_each(NEW.data_json))!=8 OR EXISTS(SELECT 1 FROM json_each(NEW.data_json) g
      WHERE g.key NOT IN ('payment_confirmed','payment_pending','payment_failed','payment_review','shipping','returns','messages','weekly_activity')
        OR g.type!='object' OR (SELECT COUNT(*) FROM json_each(g.value))!=2
        OR COALESCE(json_type(g.value,'$.inApp'),'missing') NOT IN ('true','false') OR COALESCE(json_type(g.value,'$.email'),'missing') NOT IN ('true','false')));
END;
CREATE TRIGGER commerce_settings_change_apply AFTER INSERT ON commerce_settings_changes BEGIN
  INSERT INTO commerce_store_settings(seller_id,revision,profile_json,updated_at)
    SELECT NEW.seller_id,NEW.revision,NEW.data_json,NEW.created_at WHERE NEW.kind='profile'
    ON CONFLICT(seller_id) DO UPDATE SET revision=excluded.revision,profile_json=excluded.profile_json,updated_at=excluded.updated_at;
  UPDATE sellers SET name=json_extract(NEW.data_json,'$.name'),settings_json=json_set(settings_json,'$.businessProfile',json(NEW.data_json)),updated_at=NEW.created_at
    WHERE id=NEW.seller_id AND NEW.kind='profile';
  INSERT INTO commerce_notification_preferences(seller_id,auth_user_id,revision,preferences_json,updated_at)
    SELECT NEW.seller_id,NEW.actor_id,NEW.revision,NEW.data_json,NEW.created_at WHERE NEW.kind='notifications'
    ON CONFLICT(seller_id,auth_user_id) DO UPDATE SET revision=excluded.revision,preferences_json=excluded.preferences_json,updated_at=excluded.updated_at;
END;
CREATE TRIGGER commerce_settings_change_update BEFORE UPDATE ON commerce_settings_changes BEGIN SELECT RAISE(ABORT,'settings_receipt_immutable'); END;
CREATE TRIGGER commerce_settings_change_delete BEFORE DELETE ON commerce_settings_changes BEGIN SELECT RAISE(ABORT,'settings_receipt_immutable'); END;
CREATE TRIGGER commerce_store_settings_insert BEFORE INSERT ON commerce_store_settings BEGIN
  SELECT RAISE(ABORT,'settings_receipt_required') WHERE EXISTS(SELECT 1 FROM commerce_store_settings WHERE seller_id=NEW.seller_id AND revision>=NEW.revision)
    OR NOT EXISTS(SELECT 1 FROM commerce_settings_changes c WHERE c.seller_id=NEW.seller_id AND c.kind='profile' AND c.revision=NEW.revision AND c.data_json=NEW.profile_json AND c.created_at=NEW.updated_at);
END;
CREATE TRIGGER commerce_store_settings_update BEFORE UPDATE ON commerce_store_settings BEGIN
  SELECT RAISE(ABORT,'settings_receipt_required') WHERE NEW.seller_id!=OLD.seller_id OR NEW.revision!=OLD.revision+1
    OR NOT EXISTS(SELECT 1 FROM commerce_settings_changes c WHERE c.seller_id=NEW.seller_id AND c.kind='profile' AND c.revision=NEW.revision AND c.data_json=NEW.profile_json AND c.created_at=NEW.updated_at);
END;
CREATE TRIGGER commerce_store_settings_delete BEFORE DELETE ON commerce_store_settings BEGIN SELECT RAISE(ABORT,'settings_receipt_required'); END;
CREATE TRIGGER commerce_notification_preferences_insert BEFORE INSERT ON commerce_notification_preferences BEGIN
  SELECT RAISE(ABORT,'settings_receipt_required') WHERE EXISTS(SELECT 1 FROM commerce_notification_preferences WHERE seller_id=NEW.seller_id AND auth_user_id=NEW.auth_user_id AND revision>=NEW.revision)
    OR NOT EXISTS(SELECT 1 FROM commerce_settings_changes c WHERE c.seller_id=NEW.seller_id AND c.kind='notifications' AND c.subject=NEW.auth_user_id
      AND c.revision=NEW.revision AND c.data_json=NEW.preferences_json AND c.created_at=NEW.updated_at);
END;
CREATE TRIGGER commerce_notification_preferences_update BEFORE UPDATE ON commerce_notification_preferences BEGIN
  SELECT RAISE(ABORT,'settings_receipt_required') WHERE NEW.seller_id!=OLD.seller_id OR NEW.auth_user_id!=OLD.auth_user_id OR NEW.revision!=OLD.revision+1
    OR NOT EXISTS(SELECT 1 FROM commerce_settings_changes c WHERE c.seller_id=NEW.seller_id AND c.kind='notifications' AND c.subject=NEW.auth_user_id
      AND c.revision=NEW.revision AND c.data_json=NEW.preferences_json AND c.created_at=NEW.updated_at);
END;
CREATE TRIGGER commerce_notification_preferences_delete BEFORE DELETE ON commerce_notification_preferences BEGIN SELECT RAISE(ABORT,'settings_receipt_required'); END;
CREATE TRIGGER commerce_store_profile_projection BEFORE UPDATE OF name,settings_json ON sellers
WHEN EXISTS(SELECT 1 FROM commerce_store_settings p WHERE p.seller_id=OLD.id) BEGIN
  SELECT RAISE(ABORT,'settings_receipt_required') WHERE NOT EXISTS(SELECT 1 FROM commerce_store_settings p WHERE p.seller_id=OLD.id
    AND json_extract(p.profile_json,'$.name')=NEW.name AND json_extract(NEW.settings_json,'$.businessProfile')=p.profile_json);
END;
