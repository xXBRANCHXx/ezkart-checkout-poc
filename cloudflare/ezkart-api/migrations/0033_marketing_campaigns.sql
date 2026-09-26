CREATE TABLE commerce_campaigns (
  id TEXT PRIMARY KEY CHECK(length(id)=36 AND substr(id,1,4)='cmp_' AND substr(id,5) NOT GLOB '*[^a-f0-9]*'),
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
  data_json TEXT NOT NULL CHECK(json_valid(data_json) AND json_type(data_json)='object' AND length(data_json)<=32000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX commerce_campaigns_store ON commerce_campaigns(seller_id,commerce_environment,updated_at,id);
CREATE TABLE commerce_campaign_changes (
  actor_id TEXT NOT NULL,
  request_key TEXT NOT NULL CHECK(length(request_key)=32 AND request_key NOT GLOB '*[^a-f0-9]*'),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^a-f0-9]*'),
  campaign_id TEXT NOT NULL,
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  expected_revision INTEGER NOT NULL CHECK(typeof(expected_revision)='integer' AND expected_revision>=0),
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision=expected_revision+1 AND revision<=9007199254740991),
  data_json TEXT NOT NULL CHECK(json_valid(data_json) AND json_type(data_json)='object' AND length(data_json)<=32000),
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at),
  PRIMARY KEY(actor_id,request_key),
  UNIQUE(campaign_id,revision)
);
CREATE INDEX commerce_campaign_changes_store ON commerce_campaign_changes(seller_id,commerce_environment,created_at);
CREATE TRIGGER commerce_campaign_change_guard BEFORE INSERT ON commerce_campaign_changes BEGIN
  SELECT RAISE(ABORT,'campaign_forbidden') WHERE NOT EXISTS(SELECT 1 FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id
    WHERE m.seller_id=NEW.seller_id AND m.auth_user_id=NEW.actor_id AND m.role!='viewer' AND s.status='active');
  SELECT RAISE(ABORT,'campaign_revision_conflict') WHERE NEW.expected_revision!=COALESCE((SELECT revision FROM commerce_campaigns
    WHERE id=NEW.campaign_id AND seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment),0)
    OR EXISTS(SELECT 1 FROM commerce_campaigns WHERE id=NEW.campaign_id AND (seller_id!=NEW.seller_id OR commerce_environment!=NEW.commerce_environment));
  SELECT RAISE(ABORT,'campaign_values_invalid') WHERE (SELECT COUNT(*) FROM json_each(NEW.data_json))!=9
    OR json_type(NEW.data_json,'$.name') IS NOT 'text' OR length(trim(json_extract(NEW.data_json,'$.name'))) NOT BETWEEN 1 AND 120
    OR json_type(NEW.data_json,'$.subject') IS NOT 'text' OR length(json_extract(NEW.data_json,'$.subject'))>160
    OR json_type(NEW.data_json,'$.preheader') IS NOT 'text' OR length(json_extract(NEW.data_json,'$.preheader'))>200
    OR json_type(NEW.data_json,'$.heading') IS NOT 'text' OR length(json_extract(NEW.data_json,'$.heading'))>160
    OR json_type(NEW.data_json,'$.body') IS NOT 'text' OR length(json_extract(NEW.data_json,'$.body'))>6000
    OR json_type(NEW.data_json,'$.buttonLabel') IS NOT 'text' OR length(json_extract(NEW.data_json,'$.buttonLabel'))>60
    OR json_type(NEW.data_json,'$.archived') NOT IN ('true','false') OR json_type(NEW.data_json,'$.archived') IS NULL
    OR (json_type(NEW.data_json,'$.plannedAt') IS NOT 'null' AND (json_type(NEW.data_json,'$.plannedAt') IS NOT 'text'
      OR strftime('%Y-%m-%dT%H:%M:%fZ',json_extract(NEW.data_json,'$.plannedAt')) IS NOT json_extract(NEW.data_json,'$.plannedAt')))
    OR json_type(NEW.data_json,'$.audience') IS NOT 'object' OR (SELECT COUNT(*) FROM json_each(NEW.data_json,'$.audience'))!=9
    OR (SELECT COUNT(DISTINCT key) FROM json_each(NEW.data_json,'$.audience') WHERE key IN ('q','activity','minSpend','minOrders','maxOrders','lastFrom','lastTo','location','tag') AND type='text')!=9
    OR json_extract(NEW.data_json,'$.audience.activity') NOT IN ('all','high_value','one_order','repeat','no_paid');
  SELECT RAISE(ABORT,'campaign_rate_limited') WHERE (SELECT COUNT(*) FROM commerce_campaign_changes WHERE seller_id=NEW.seller_id
    AND commerce_environment=NEW.commerce_environment AND created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute'))>=30
    OR (SELECT COUNT(*) FROM commerce_campaign_changes WHERE seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment
      AND created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day'))>=200;
  SELECT RAISE(ABORT,'campaign_immutable') WHERE EXISTS(SELECT 1 FROM commerce_campaign_changes WHERE actor_id=NEW.actor_id AND request_key=NEW.request_key);
END;
CREATE TRIGGER commerce_campaign_change_apply AFTER INSERT ON commerce_campaign_changes BEGIN
  UPDATE commerce_campaigns SET revision=NEW.revision,data_json=NEW.data_json,updated_at=NEW.created_at WHERE id=NEW.campaign_id;
  INSERT INTO commerce_campaigns(id,seller_id,commerce_environment,revision,data_json,created_at,updated_at)
    SELECT NEW.campaign_id,NEW.seller_id,NEW.commerce_environment,NEW.revision,NEW.data_json,NEW.created_at,NEW.created_at
    WHERE NOT EXISTS(SELECT 1 FROM commerce_campaigns WHERE id=NEW.campaign_id);
END;
CREATE TRIGGER commerce_campaign_insert BEFORE INSERT ON commerce_campaigns BEGIN
  SELECT RAISE(ABORT,'campaign_receipt_required') WHERE EXISTS(SELECT 1 FROM commerce_campaigns WHERE id=NEW.id)
    OR NEW.revision!=1 OR NEW.created_at!=NEW.updated_at OR NOT EXISTS(SELECT 1 FROM commerce_campaign_changes c WHERE c.campaign_id=NEW.id
    AND c.seller_id=NEW.seller_id AND c.commerce_environment=NEW.commerce_environment AND c.revision=NEW.revision AND c.data_json=NEW.data_json
    AND c.created_at=NEW.updated_at);
END;
CREATE TRIGGER commerce_campaign_update BEFORE UPDATE ON commerce_campaigns BEGIN
  SELECT RAISE(ABORT,'campaign_receipt_required') WHERE NEW.id!=OLD.id OR NEW.seller_id!=OLD.seller_id OR NEW.commerce_environment!=OLD.commerce_environment
    OR NEW.created_at!=OLD.created_at OR NEW.revision!=OLD.revision+1 OR NOT EXISTS(SELECT 1 FROM commerce_campaign_changes c WHERE c.campaign_id=NEW.id
      AND c.seller_id=NEW.seller_id AND c.commerce_environment=NEW.commerce_environment AND c.expected_revision=OLD.revision AND c.revision=NEW.revision
      AND c.data_json=NEW.data_json AND c.created_at=NEW.updated_at);
END;
CREATE TRIGGER commerce_campaign_delete BEFORE DELETE ON commerce_campaigns BEGIN SELECT RAISE(ABORT,'campaign_receipt_required'); END;
CREATE TRIGGER commerce_campaign_change_update BEFORE UPDATE ON commerce_campaign_changes BEGIN SELECT RAISE(ABORT,'campaign_immutable'); END;
CREATE TRIGGER commerce_campaign_change_delete BEFORE DELETE ON commerce_campaign_changes BEGIN SELECT RAISE(ABORT,'campaign_immutable'); END;
