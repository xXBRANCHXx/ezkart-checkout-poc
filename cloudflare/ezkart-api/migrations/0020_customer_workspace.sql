CREATE TABLE commerce_customer_profiles (
  seller_id TEXT NOT NULL,
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  customer_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  data_json TEXT NOT NULL CHECK(json_valid(data_json)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(seller_id,commerce_environment,customer_id),
  FOREIGN KEY(seller_id,customer_id) REFERENCES customers(seller_id,id)
);
CREATE TABLE commerce_customer_segments (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  revision INTEGER NOT NULL CHECK(revision>0),
  data_json TEXT NOT NULL CHECK(json_valid(data_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX commerce_customer_segments_scope ON commerce_customer_segments(seller_id,commerce_environment,updated_at);
CREATE TABLE commerce_customer_changes (
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK(target_kind IN ('profile','segment')),
  target_id TEXT NOT NULL,
  expected_revision INTEGER NOT NULL CHECK(expected_revision>=0),
  revision INTEGER NOT NULL CHECK(revision=expected_revision+1),
  actor_auth_user_id TEXT NOT NULL,
  data_json TEXT NOT NULL CHECK(json_valid(data_json) AND json_type(data_json)='object'),
  created_at TEXT NOT NULL,
  PRIMARY KEY(seller_id,commerce_environment,request_key),
  UNIQUE(seller_id,commerce_environment,target_kind,target_id,revision)
);
CREATE TRIGGER commerce_customer_change_guard BEFORE INSERT ON commerce_customer_changes BEGIN
  SELECT RAISE(ABORT,'customer_actor_forbidden') WHERE NOT EXISTS (
    SELECT 1 FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id WHERE m.seller_id=NEW.seller_id
      AND m.auth_user_id=NEW.actor_auth_user_id AND m.role!='viewer' AND s.status='active');
  SELECT RAISE(ABORT,'customer_profile_missing') WHERE NEW.target_kind='profile' AND NOT EXISTS (
    SELECT 1 FROM orders WHERE seller_id=NEW.seller_id AND customer_id=NEW.target_id AND commerce_version=1 AND commerce_environment=NEW.commerce_environment);
  SELECT RAISE(ABORT,'customer_revision_conflict') WHERE
    (NEW.target_kind='profile' AND NEW.expected_revision!=COALESCE((SELECT revision FROM commerce_customer_profiles WHERE seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment AND customer_id=NEW.target_id),0))
    OR (NEW.target_kind='segment' AND NEW.expected_revision!=COALESCE((SELECT revision FROM commerce_customer_segments WHERE id=NEW.target_id AND seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment),0));
  SELECT RAISE(ABORT,'customer_profile_invalid') WHERE NEW.target_kind='profile' AND (
    json_type(NEW.data_json,'$.note') IS NOT 'text' OR length(json_extract(NEW.data_json,'$.note'))>2000
    OR json_type(NEW.data_json,'$.tags') IS NOT 'array' OR json_array_length(NEW.data_json,'$.tags')>10);
  SELECT RAISE(ABORT,'customer_segment_invalid') WHERE NEW.target_kind='segment' AND (
    json_type(NEW.data_json,'$.name') IS NOT 'text' OR length(json_extract(NEW.data_json,'$.name')) NOT BETWEEN 1 AND 80
    OR json_type(NEW.data_json,'$.filters') IS NOT 'object' OR (json_type(NEW.data_json,'$.archived') IS NOT 'true' AND json_type(NEW.data_json,'$.archived') IS NOT 'false'));
  SELECT RAISE(ABORT,'customer_segment_limit') WHERE NEW.target_kind='segment' AND json_extract(NEW.data_json,'$.archived')=0
    AND NOT EXISTS(SELECT 1 FROM commerce_customer_segments WHERE id=NEW.target_id AND seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment AND json_extract(data_json,'$.archived')=0)
    AND (SELECT COUNT(*) FROM commerce_customer_segments WHERE seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment AND json_extract(data_json,'$.archived')=0)>=50;
END;
CREATE TRIGGER commerce_customer_change_apply AFTER INSERT ON commerce_customer_changes BEGIN
  INSERT INTO commerce_customer_profiles(seller_id,commerce_environment,customer_id,revision,data_json,updated_at)
    SELECT NEW.seller_id,NEW.commerce_environment,NEW.target_id,NEW.revision,NEW.data_json,NEW.created_at WHERE NEW.target_kind='profile'
    ON CONFLICT(seller_id,commerce_environment,customer_id) DO UPDATE SET revision=excluded.revision,data_json=excluded.data_json,updated_at=excluded.updated_at;
  INSERT INTO commerce_customer_segments(id,seller_id,commerce_environment,revision,data_json,created_at,updated_at)
    SELECT NEW.target_id,NEW.seller_id,NEW.commerce_environment,NEW.revision,NEW.data_json,NEW.created_at,NEW.created_at WHERE NEW.target_kind='segment'
    ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data_json=excluded.data_json,updated_at=excluded.updated_at;
END;
CREATE TRIGGER commerce_customer_profile_insert BEFORE INSERT ON commerce_customer_profiles BEGIN
  SELECT RAISE(ABORT,'customer_receipt_required') WHERE NOT EXISTS(SELECT 1 FROM commerce_customer_changes WHERE seller_id=NEW.seller_id
    AND commerce_environment=NEW.commerce_environment AND target_kind='profile' AND target_id=NEW.customer_id AND revision=NEW.revision
    AND data_json=NEW.data_json AND created_at=NEW.updated_at);
END;
CREATE TRIGGER commerce_customer_profile_update BEFORE UPDATE ON commerce_customer_profiles BEGIN
  SELECT RAISE(ABORT,'customer_receipt_required') WHERE NEW.seller_id!=OLD.seller_id OR NEW.commerce_environment!=OLD.commerce_environment
    OR NEW.customer_id!=OLD.customer_id OR NEW.revision!=OLD.revision+1 OR NOT EXISTS(SELECT 1 FROM commerce_customer_changes WHERE seller_id=NEW.seller_id
      AND commerce_environment=NEW.commerce_environment AND target_kind='profile' AND target_id=NEW.customer_id AND revision=NEW.revision
      AND data_json=NEW.data_json AND created_at=NEW.updated_at);
END;
CREATE TRIGGER commerce_customer_segment_insert BEFORE INSERT ON commerce_customer_segments BEGIN
  SELECT RAISE(ABORT,'customer_receipt_required') WHERE NOT EXISTS(SELECT 1 FROM commerce_customer_changes WHERE seller_id=NEW.seller_id
    AND commerce_environment=NEW.commerce_environment AND target_kind='segment' AND target_id=NEW.id AND revision=NEW.revision
    AND data_json=NEW.data_json AND created_at=NEW.updated_at AND created_at=NEW.created_at);
END;
CREATE TRIGGER commerce_customer_segment_update BEFORE UPDATE ON commerce_customer_segments BEGIN
  SELECT RAISE(ABORT,'customer_receipt_required') WHERE NEW.id!=OLD.id OR NEW.seller_id!=OLD.seller_id OR NEW.commerce_environment!=OLD.commerce_environment
    OR NEW.created_at!=OLD.created_at OR NEW.revision!=OLD.revision+1 OR NOT EXISTS(SELECT 1 FROM commerce_customer_changes WHERE seller_id=NEW.seller_id
      AND commerce_environment=NEW.commerce_environment AND target_kind='segment' AND target_id=NEW.id AND revision=NEW.revision
      AND data_json=NEW.data_json AND created_at=NEW.updated_at);
END;
CREATE TRIGGER commerce_customer_profile_delete BEFORE DELETE ON commerce_customer_profiles BEGIN SELECT RAISE(ABORT,'customer_receipt_required'); END;
CREATE TRIGGER commerce_customer_segment_delete BEFORE DELETE ON commerce_customer_segments BEGIN SELECT RAISE(ABORT,'customer_receipt_required'); END;
CREATE TRIGGER commerce_customer_change_update BEFORE UPDATE ON commerce_customer_changes BEGIN SELECT RAISE(ABORT,'customer_change_immutable'); END;
CREATE TRIGGER commerce_customer_change_delete BEFORE DELETE ON commerce_customer_changes BEGIN SELECT RAISE(ABORT,'customer_change_immutable'); END;

CREATE TABLE commerce_customer_exports (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  filters_json TEXT NOT NULL CHECK(json_valid(filters_json)),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'building' CHECK(state IN ('building','ready')),
  row_count INTEGER NOT NULL DEFAULT 0 CHECK(row_count>=0),
  UNIQUE(seller_id,commerce_environment,request_key)
);
CREATE INDEX commerce_customer_export_expiry ON commerce_customer_exports(expires_at);
CREATE INDEX commerce_customer_export_rate ON commerce_customer_exports(seller_id,commerce_environment,created_at);
CREATE TABLE commerce_customer_export_rows (
  export_id TEXT NOT NULL REFERENCES commerce_customer_exports(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK(ordinal>0),
  cells_json TEXT NOT NULL CHECK(json_valid(cells_json) AND json_type(cells_json)='array'),
  PRIMARY KEY(export_id,ordinal)
);
CREATE TRIGGER commerce_customer_export_admission BEFORE INSERT ON commerce_customer_exports BEGIN
  SELECT RAISE(ABORT,'customer_export_state') WHERE NEW.state!='building' OR NEW.row_count!=0;
  SELECT RAISE(ABORT,'customer_export_rate') WHERE (SELECT COUNT(*) FROM commerce_customer_exports WHERE seller_id=NEW.seller_id
    AND commerce_environment=NEW.commerce_environment AND created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour'))>=10;
END;
CREATE TRIGGER commerce_customer_export_finalize BEFORE UPDATE ON commerce_customer_exports BEGIN
  SELECT RAISE(ABORT,'customer_export_immutable') WHERE OLD.state!='building' OR NEW.state!='ready'
    OR NEW.id IS NOT OLD.id OR NEW.seller_id IS NOT OLD.seller_id OR NEW.commerce_environment IS NOT OLD.commerce_environment
    OR NEW.request_key IS NOT OLD.request_key OR NEW.request_hash IS NOT OLD.request_hash OR NEW.filters_json IS NOT OLD.filters_json
    OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
    OR NEW.row_count!=(SELECT COUNT(*) FROM commerce_customer_export_rows WHERE export_id=OLD.id);
END;
CREATE TRIGGER commerce_customer_export_row_admission BEFORE INSERT ON commerce_customer_export_rows BEGIN
  SELECT RAISE(ABORT,'customer_export_immutable') WHERE NOT EXISTS(SELECT 1 FROM commerce_customer_exports WHERE id=NEW.export_id AND state='building');
END;
CREATE TRIGGER commerce_customer_export_row_immutable BEFORE UPDATE ON commerce_customer_export_rows BEGIN SELECT RAISE(ABORT,'customer_export_immutable'); END;
CREATE TRIGGER commerce_customer_export_retention BEFORE DELETE ON commerce_customer_exports
WHEN OLD.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') BEGIN SELECT RAISE(ABORT,'customer_export_retained'); END;
CREATE TRIGGER commerce_customer_export_row_retention BEFORE DELETE ON commerce_customer_export_rows
WHEN EXISTS(SELECT 1 FROM commerce_customer_exports WHERE id=OLD.export_id AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
BEGIN SELECT RAISE(ABORT,'customer_export_retained'); END;
