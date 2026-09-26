CREATE TABLE commerce_campaign_publications (
  id TEXT PRIMARY KEY CHECK(length(id)=37 AND substr(id,1,5)='cpub_' AND substr(id,6) NOT GLOB '*[^a-f0-9]*'),
  campaign_id TEXT NOT NULL UNIQUE REFERENCES commerce_campaigns(id),
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  actor_id TEXT NOT NULL,
  request_key TEXT NOT NULL CHECK(length(request_key)=32 AND request_key NOT GLOB '*[^a-f0-9]*'),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^a-f0-9]*'),
  campaign_revision INTEGER NOT NULL CHECK(typeof(campaign_revision)='integer' AND campaign_revision>=1),
  data_json TEXT NOT NULL CHECK(json_valid(data_json) AND json_type(data_json)='object'),
  store_name TEXT NOT NULL CHECK(length(store_name) BETWEEN 1 AND 160),
  shop_enabled INTEGER NOT NULL CHECK(shop_enabled IN (0,1)),
  order_cap INTEGER NOT NULL CHECK(typeof(order_cap)='integer' AND order_cap>=0),
  scheduled_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',scheduled_at) IS scheduled_at),
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at),
  CHECK(scheduled_at>=created_at AND scheduled_at<=strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+366 days')),
  UNIQUE(actor_id,request_key)
);
CREATE INDEX commerce_campaign_publications_store ON commerce_campaign_publications(seller_id,commerce_environment,created_at,id);
CREATE TABLE commerce_campaign_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT CHECK(id>0),
  publication_id TEXT NOT NULL REFERENCES commerce_campaign_publications(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  auth_user_id TEXT NOT NULL,
  email TEXT NOT NULL CHECK(length(email) BETWEEN 3 AND 160 AND email=lower(trim(email))),
  name TEXT NOT NULL,
  consent_revision INTEGER NOT NULL CHECK(typeof(consent_revision)='integer' AND consent_revision>=1),
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at),
  UNIQUE(publication_id,auth_user_id,email),
  UNIQUE(publication_id,customer_id)
);
CREATE TABLE commerce_campaign_seals (
  publication_id TEXT PRIMARY KEY REFERENCES commerce_campaign_publications(id),
  candidate_count INTEGER NOT NULL CHECK(typeof(candidate_count)='integer' AND candidate_count>=1),
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at)
);
CREATE TABLE commerce_campaign_publication_actions (
  publication_id TEXT NOT NULL REFERENCES commerce_campaign_publications(id),
  actor_id TEXT NOT NULL,
  request_key TEXT NOT NULL CHECK(length(request_key)=32 AND request_key NOT GLOB '*[^a-f0-9]*'),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^a-f0-9]*'),
  expected_revision INTEGER NOT NULL CHECK(typeof(expected_revision)='integer' AND expected_revision>=0 AND expected_revision<9007199254740991),
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision=expected_revision+1),
  kind TEXT NOT NULL CHECK(kind IN ('reschedule','cancel')),
  scheduled_at TEXT CHECK(scheduled_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ',scheduled_at) IS scheduled_at),
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at),
  CHECK((kind='cancel' AND scheduled_at IS NULL) OR (kind='reschedule' AND scheduled_at IS NOT NULL AND scheduled_at>created_at AND scheduled_at<=strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+366 days'))),
  PRIMARY KEY(actor_id,request_key),
  UNIQUE(publication_id,revision)
);
CREATE VIEW commerce_campaign_publication_state AS
  SELECT p.*,seal.candidate_count,COALESCE(a.revision,0) AS action_revision,
    COALESCE((SELECT scheduled_at FROM commerce_campaign_publication_actions WHERE publication_id=p.id AND kind='reschedule' ORDER BY revision DESC LIMIT 1),p.scheduled_at) AS send_at,
    CASE WHEN a.kind='cancel' THEN 1 ELSE 0 END AS cancelled,
    COALESCE(a.created_at,p.created_at) AS updated_at
  FROM commerce_campaign_publications p JOIN commerce_campaign_seals seal ON seal.publication_id=p.id
  LEFT JOIN commerce_campaign_publication_actions a ON a.publication_id=p.id AND a.revision=(SELECT MAX(revision) FROM commerce_campaign_publication_actions WHERE publication_id=p.id);

CREATE TRIGGER commerce_campaign_publication_guard BEFORE INSERT ON commerce_campaign_publications BEGIN
  SELECT RAISE(ABORT,'campaign_publication_immutable') WHERE EXISTS(SELECT 1 FROM commerce_campaign_publications
    WHERE id=NEW.id OR campaign_id=NEW.campaign_id OR (actor_id=NEW.actor_id AND request_key=NEW.request_key));
  SELECT RAISE(ABORT,'campaign_publication_forbidden') WHERE NOT EXISTS(SELECT 1 FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id
    WHERE m.seller_id=NEW.seller_id AND m.auth_user_id=NEW.actor_id AND m.role!='viewer' AND s.status='active'
      AND s.name=NEW.store_name AND COALESCE(json_extract(s.settings_json,'$.storefront.enabled'),0)=NEW.shop_enabled);
  SELECT RAISE(ABORT,'campaign_publication_revision') WHERE NOT EXISTS(SELECT 1 FROM commerce_campaigns c WHERE c.id=NEW.campaign_id
    AND c.seller_id=NEW.seller_id AND c.commerce_environment=NEW.commerce_environment AND c.revision=NEW.campaign_revision AND c.data_json=NEW.data_json
    AND json_extract(c.data_json,'$.archived')=0 AND length(trim(json_extract(c.data_json,'$.subject')))>0
    AND length(trim(json_extract(c.data_json,'$.heading')))>0 AND length(trim(json_extract(c.data_json,'$.body')))>0
    AND (json_extract(c.data_json,'$.buttonLabel')='' OR NEW.shop_enabled=1));
  SELECT RAISE(ABORT,'campaign_publication_boundary') WHERE NEW.order_cap!=(SELECT COALESCE(MAX(rowid),0) FROM orders
    WHERE seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment AND commerce_version=1);
  SELECT RAISE(ABORT,'campaign_publication_rate') WHERE (SELECT COUNT(*) FROM commerce_campaign_publications WHERE seller_id=NEW.seller_id
    AND commerce_environment=NEW.commerce_environment AND created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour'))>=10
    OR (SELECT COUNT(*) FROM commerce_campaign_publications WHERE seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment
      AND created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day'))>=100;
END;
CREATE TRIGGER commerce_campaign_candidate_guard BEFORE INSERT ON commerce_campaign_candidates BEGIN
  SELECT RAISE(ABORT,'campaign_candidate_immutable') WHERE EXISTS(SELECT 1 FROM commerce_campaign_candidates WHERE id=NEW.id
    OR (publication_id=NEW.publication_id AND (customer_id=NEW.customer_id OR (auth_user_id=NEW.auth_user_id AND email=NEW.email))));
  SELECT RAISE(ABORT,'campaign_audience_sealed') WHERE EXISTS(SELECT 1 FROM commerce_campaign_seals WHERE publication_id=NEW.publication_id);
  SELECT RAISE(ABORT,'campaign_candidate_ineligible') WHERE NOT EXISTS(SELECT 1 FROM commerce_campaign_publications p
    JOIN sellers s ON s.id=p.seller_id JOIN seller_memberships m ON m.seller_id=p.seller_id AND m.auth_user_id=p.actor_id
    JOIN orders o ON o.id=NEW.order_id AND o.seller_id=p.seller_id AND o.commerce_environment=p.commerce_environment
    LEFT JOIN commerce_order_owners owner ON owner.order_id=o.id
    JOIN commerce_customer_consents consent ON consent.seller_id=p.seller_id AND consent.commerce_environment=p.commerce_environment
      AND consent.auth_user_id=NEW.auth_user_id AND consent.email=NEW.email
    WHERE p.id=NEW.publication_id AND s.status='active' AND m.role!='viewer' AND o.commerce_version=1 AND o.rowid<=p.order_cap
      AND o.customer_id=NEW.customer_id AND COALESCE(owner.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=NEW.auth_user_id
      AND lower(trim(json_extract(o.customer_snapshot_json,'$.email')))=NEW.email
      AND COALESCE(json_extract(o.customer_snapshot_json,'$.name'),'')=NEW.name AND consent.allowed=1 AND consent.revision=NEW.consent_revision
      AND NEW.created_at=p.created_at);
END;
CREATE TRIGGER commerce_campaign_seal_guard BEFORE INSERT ON commerce_campaign_seals BEGIN
  SELECT RAISE(ABORT,'campaign_seal_immutable') WHERE EXISTS(SELECT 1 FROM commerce_campaign_seals WHERE publication_id=NEW.publication_id);
  SELECT RAISE(ABORT,'campaign_seal_invalid') WHERE NEW.candidate_count!=(SELECT COUNT(*) FROM commerce_campaign_candidates WHERE publication_id=NEW.publication_id)
    OR NOT EXISTS(SELECT 1 FROM commerce_campaign_publications p JOIN sellers s ON s.id=p.seller_id
      JOIN seller_memberships m ON m.seller_id=p.seller_id AND m.auth_user_id=p.actor_id
      WHERE p.id=NEW.publication_id AND s.status='active' AND m.role!='viewer' AND NEW.created_at=p.created_at);
END;
CREATE TRIGGER commerce_campaign_seal_jobs AFTER INSERT ON commerce_campaign_seals BEGIN
  INSERT INTO commerce_jobs(id,seller_id,commerce_environment,job_key,kind,payload_json,available_at,created_at,updated_at)
    SELECT 'job_campaign_'||c.id,p.seller_id,p.commerce_environment,'campaign_candidate:'||c.id,'campaign.send',
      json_object('publicationId',p.id,'candidateId',c.id),p.scheduled_at,p.created_at,p.created_at
    FROM commerce_campaign_candidates c JOIN commerce_campaign_publications p ON p.id=c.publication_id WHERE c.publication_id=NEW.publication_id;
END;
CREATE TRIGGER commerce_campaign_job_guard BEFORE INSERT ON commerce_jobs WHEN NEW.kind='campaign.send' BEGIN
  SELECT RAISE(ABORT,'campaign_job_invalid') WHERE EXISTS(SELECT 1 FROM commerce_jobs WHERE id=NEW.id OR (seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment AND job_key=NEW.job_key))
    OR NEW.order_id IS NOT NULL OR NEW.state!='queued' OR NEW.attempts!=0 OR (SELECT COUNT(*) FROM json_each(NEW.payload_json))!=2
    OR NOT EXISTS(SELECT 1 FROM commerce_campaign_candidates c JOIN commerce_campaign_publications p ON p.id=c.publication_id
      JOIN commerce_campaign_seals seal ON seal.publication_id=p.id
      WHERE p.id=json_extract(NEW.payload_json,'$.publicationId') AND c.id=json_extract(NEW.payload_json,'$.candidateId')
        AND NEW.id='job_campaign_'||c.id AND NEW.job_key='campaign_candidate:'||c.id AND NEW.seller_id=p.seller_id
        AND NEW.commerce_environment=p.commerce_environment AND NEW.available_at=p.scheduled_at AND NEW.created_at=p.created_at);
END;
-- Replaced by evidence-based completion when campaign dispatch is installed.
-- Generic job completion cannot currently claim that a campaign was delivered.
CREATE TRIGGER commerce_campaign_job_complete BEFORE UPDATE OF state ON commerce_jobs WHEN NEW.kind='campaign.send' AND NEW.state='succeeded' BEGIN
  SELECT RAISE(ABORT,'campaign_delivery_receipt_required');
END;
CREATE TRIGGER commerce_campaign_job_delete BEFORE DELETE ON commerce_jobs WHEN OLD.kind='campaign.send' BEGIN
  SELECT RAISE(ABORT,'campaign_job_immutable');
END;
CREATE TRIGGER commerce_campaign_publication_action_guard BEFORE INSERT ON commerce_campaign_publication_actions BEGIN
  SELECT RAISE(ABORT,'campaign_publication_action_immutable') WHERE EXISTS(SELECT 1 FROM commerce_campaign_publication_actions WHERE actor_id=NEW.actor_id AND request_key=NEW.request_key);
  SELECT RAISE(ABORT,'campaign_publication_forbidden') WHERE NOT EXISTS(SELECT 1 FROM commerce_campaign_publication_state p
    JOIN sellers s ON s.id=p.seller_id JOIN seller_memberships m ON m.seller_id=p.seller_id AND m.auth_user_id=NEW.actor_id
    WHERE p.id=NEW.publication_id AND s.status='active' AND m.role!='viewer');
  SELECT RAISE(ABORT,'campaign_publication_action_revision') WHERE NOT EXISTS(SELECT 1 FROM commerce_campaign_publication_state
    WHERE id=NEW.publication_id AND action_revision=NEW.expected_revision AND cancelled=0);
  SELECT RAISE(ABORT,'campaign_processing_started') WHERE NEW.kind='reschedule' AND EXISTS(SELECT 1 FROM commerce_campaign_candidates c
    JOIN commerce_jobs j ON j.id='job_campaign_'||c.id WHERE c.publication_id=NEW.publication_id AND (j.attempts!=0 OR j.state!='queued'));
  SELECT RAISE(ABORT,'campaign_publication_action_rate') WHERE (SELECT COUNT(*) FROM commerce_campaign_publication_actions
    WHERE publication_id=NEW.publication_id AND created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute'))>=20;
END;
CREATE TRIGGER commerce_campaign_publication_action_apply AFTER INSERT ON commerce_campaign_publication_actions BEGIN
  UPDATE commerce_jobs SET available_at=NEW.scheduled_at,updated_at=NEW.created_at WHERE NEW.kind='reschedule' AND state='queued' AND attempts=0
    AND id IN (SELECT 'job_campaign_'||id FROM commerce_campaign_candidates WHERE publication_id=NEW.publication_id);
  UPDATE commerce_jobs SET state='dead',result_json='{"cancelled":true,"noEffectConfirmed":true}',last_error='Campaign cancelled before processing',updated_at=NEW.created_at
    WHERE NEW.kind='cancel' AND state='queued' AND attempts=0
      AND id IN (SELECT 'job_campaign_'||id FROM commerce_campaign_candidates WHERE publication_id=NEW.publication_id);
END;
CREATE TRIGGER commerce_campaign_publication_update BEFORE UPDATE ON commerce_campaign_publications BEGIN SELECT RAISE(ABORT,'campaign_publication_immutable'); END;
CREATE TRIGGER commerce_campaign_publication_delete BEFORE DELETE ON commerce_campaign_publications BEGIN SELECT RAISE(ABORT,'campaign_publication_immutable'); END;
CREATE TRIGGER commerce_campaign_candidate_update BEFORE UPDATE ON commerce_campaign_candidates BEGIN SELECT RAISE(ABORT,'campaign_candidate_immutable'); END;
CREATE TRIGGER commerce_campaign_candidate_delete BEFORE DELETE ON commerce_campaign_candidates BEGIN SELECT RAISE(ABORT,'campaign_candidate_immutable'); END;
CREATE TRIGGER commerce_campaign_seal_update BEFORE UPDATE ON commerce_campaign_seals BEGIN SELECT RAISE(ABORT,'campaign_seal_immutable'); END;
CREATE TRIGGER commerce_campaign_seal_delete BEFORE DELETE ON commerce_campaign_seals BEGIN SELECT RAISE(ABORT,'campaign_seal_immutable'); END;
CREATE TRIGGER commerce_campaign_publication_action_update BEFORE UPDATE ON commerce_campaign_publication_actions BEGIN SELECT RAISE(ABORT,'campaign_publication_action_immutable'); END;
CREATE TRIGGER commerce_campaign_publication_action_delete BEFORE DELETE ON commerce_campaign_publication_actions BEGIN SELECT RAISE(ABORT,'campaign_publication_action_immutable'); END;
