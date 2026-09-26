CREATE TABLE commerce_campaign_links (
  publication_id TEXT PRIMARY KEY REFERENCES commerce_campaign_publications(id),
  code TEXT NOT NULL UNIQUE CHECK(length(code)=64 AND code NOT GLOB '*[^a-f0-9]*'),
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at)
);
CREATE TABLE commerce_campaign_link_messages (
  request_id TEXT PRIMARY KEY REFERENCES commerce_campaign_email_requests(id),
  publication_id TEXT NOT NULL REFERENCES commerce_campaign_links(publication_id),
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at)
);
CREATE INDEX commerce_campaign_link_messages_publication ON commerce_campaign_link_messages(publication_id,request_id);
CREATE TABLE commerce_campaign_visit_buckets (
  publication_id TEXT NOT NULL REFERENCES commerce_campaign_links(publication_id),
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  bucket TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:00:00.000Z',bucket) IS bucket),
  recorded INTEGER NOT NULL DEFAULT 0 CHECK(typeof(recorded)='integer' AND recorded BETWEEN 0 AND 9007199254740991),
  limited INTEGER NOT NULL DEFAULT 0 CHECK(typeof(limited)='integer' AND limited BETWEEN 0 AND 9007199254740991),
  updated_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',updated_at) IS updated_at AND updated_at>=bucket AND updated_at<strftime('%Y-%m-%dT%H:%M:%fZ',bucket,'+1 hour')),
  PRIMARY KEY(publication_id,bucket)
);
CREATE INDEX commerce_campaign_visit_rate ON commerce_campaign_visit_buckets(seller_id,commerce_environment,bucket);
CREATE TABLE commerce_campaign_visits (
  token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64 AND token_hash NOT GLOB '*[^a-f0-9]*'),
  publication_id TEXT NOT NULL REFERENCES commerce_campaign_links(publication_id),
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at),
  expires_at TEXT NOT NULL CHECK(expires_at IS strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+7 days'))
);
CREATE INDEX commerce_campaign_visit_expiry ON commerce_campaign_visits(expires_at);
CREATE TABLE commerce_campaign_order_attributions (
  order_id TEXT PRIMARY KEY REFERENCES orders(id),
  publication_id TEXT NOT NULL REFERENCES commerce_campaign_links(publication_id),
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  visit_hash TEXT NOT NULL CHECK(length(visit_hash)=64 AND visit_hash NOT GLOB '*[^a-f0-9]*'),
  visited_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',visited_at) IS visited_at),
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at AND created_at>=visited_at AND created_at<strftime('%Y-%m-%dT%H:%M:%fZ',visited_at,'+7 days'))
);
CREATE INDEX commerce_campaign_attributions_publication ON commerce_campaign_order_attributions(publication_id,order_id);
CREATE INDEX commerce_campaign_attributions_visit ON commerce_campaign_order_attributions(visit_hash,order_id);

-- Existing messages keep their original bytes. These references become public
-- only when a newly rendered message includes the link and its send starts.
INSERT INTO commerce_campaign_links(publication_id,code,created_at)
  SELECT p.id,lower(hex(randomblob(32))),p.created_at FROM commerce_campaign_publications p JOIN commerce_campaign_seals s ON s.publication_id=p.id
  WHERE p.shop_enabled=1 AND json_extract(p.data_json,'$.buttonLabel')!='';
CREATE TRIGGER commerce_campaign_link_seal AFTER INSERT ON commerce_campaign_seals BEGIN
  INSERT INTO commerce_campaign_links(publication_id,code,created_at)
    SELECT p.id,lower(hex(randomblob(32))),p.created_at FROM commerce_campaign_publications p
    WHERE p.id=NEW.publication_id AND p.shop_enabled=1 AND json_extract(p.data_json,'$.buttonLabel')!='';
END;
CREATE TRIGGER commerce_campaign_link_admission BEFORE INSERT ON commerce_campaign_links BEGIN
  SELECT RAISE(ABORT,'campaign_link_immutable') WHERE EXISTS(SELECT 1 FROM commerce_campaign_links WHERE publication_id=NEW.publication_id OR code=NEW.code);
  SELECT RAISE(ABORT,'campaign_link_publication') WHERE NOT EXISTS(SELECT 1 FROM commerce_campaign_publications p JOIN commerce_campaign_seals s ON s.publication_id=p.id
    WHERE p.id=NEW.publication_id AND p.shop_enabled=1 AND json_extract(p.data_json,'$.buttonLabel')!='' AND p.created_at=NEW.created_at);
END;
CREATE TRIGGER commerce_campaign_link_update BEFORE UPDATE ON commerce_campaign_links BEGIN SELECT RAISE(ABORT,'campaign_link_immutable'); END;
CREATE TRIGGER commerce_campaign_link_delete BEFORE DELETE ON commerce_campaign_links BEGIN SELECT RAISE(ABORT,'campaign_link_immutable'); END;
CREATE TRIGGER commerce_campaign_link_request BEFORE INSERT ON commerce_campaign_email_requests
WHEN EXISTS(SELECT 1 FROM commerce_campaign_candidates c JOIN commerce_campaign_publications p ON p.id=c.publication_id
  WHERE c.id=NEW.candidate_id AND json_extract(p.data_json,'$.buttonLabel')!='') BEGIN
  SELECT RAISE(ABORT,'campaign_link_required') WHERE NOT EXISTS(SELECT 1 FROM commerce_campaign_links l JOIN commerce_campaign_candidates c ON c.publication_id=l.publication_id
    WHERE c.id=NEW.candidate_id AND instr(json_extract(NEW.request_json,'$.text'),'https://'||CASE NEW.commerce_environment WHEN 'sandbox' THEN 'test.ezkart.id' ELSE 'ezkart.id' END||'/cart/campaign.php?c='||l.code)>0
      AND instr(json_extract(NEW.request_json,'$.html'),'href="https://'||CASE NEW.commerce_environment WHEN 'sandbox' THEN 'test.ezkart.id' ELSE 'ezkart.id' END||'/cart/campaign.php?c='||l.code||'"')>0);
END;
CREATE TRIGGER commerce_campaign_link_record AFTER INSERT ON commerce_campaign_email_requests BEGIN
  INSERT INTO commerce_campaign_link_messages(request_id,publication_id,created_at)
    SELECT NEW.id,l.publication_id,NEW.created_at FROM commerce_campaign_candidates c JOIN commerce_campaign_links l ON l.publication_id=c.publication_id WHERE c.id=NEW.candidate_id;
END;
CREATE TRIGGER commerce_campaign_link_message_guard BEFORE INSERT ON commerce_campaign_link_messages BEGIN
  SELECT RAISE(ABORT,'campaign_link_message_immutable') WHERE EXISTS(SELECT 1 FROM commerce_campaign_link_messages WHERE request_id=NEW.request_id);
  SELECT RAISE(ABORT,'campaign_link_message_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_campaign_email_requests x JOIN commerce_campaign_candidates c ON c.id=x.candidate_id
    JOIN commerce_campaign_links l ON l.publication_id=c.publication_id WHERE x.id=NEW.request_id AND l.publication_id=NEW.publication_id AND x.created_at=NEW.created_at
      AND instr(json_extract(x.request_json,'$.text'),'https://'||CASE x.commerce_environment WHEN 'sandbox' THEN 'test.ezkart.id' ELSE 'ezkart.id' END||'/cart/campaign.php?c='||l.code)>0
      AND instr(json_extract(x.request_json,'$.html'),'href="https://'||CASE x.commerce_environment WHEN 'sandbox' THEN 'test.ezkart.id' ELSE 'ezkart.id' END||'/cart/campaign.php?c='||l.code||'"')>0);
END;
CREATE TRIGGER commerce_campaign_link_message_update BEFORE UPDATE ON commerce_campaign_link_messages BEGIN SELECT RAISE(ABORT,'campaign_link_message_immutable'); END;
CREATE TRIGGER commerce_campaign_link_message_delete BEFORE DELETE ON commerce_campaign_link_messages BEGIN SELECT RAISE(ABORT,'campaign_link_message_immutable'); END;

CREATE VIEW commerce_campaign_visit_sources AS
  SELECT l.publication_id,l.code,p.seller_id,p.commerce_environment FROM commerce_campaign_links l JOIN commerce_campaign_publications p ON p.id=l.publication_id
    JOIN sellers s ON s.id=p.seller_id WHERE s.status='active' AND json_extract(s.settings_json,'$.storefront.enabled')=1
    AND EXISTS(SELECT 1 FROM commerce_campaign_link_messages m JOIN commerce_campaign_email_starts x ON x.request_id=m.request_id WHERE m.publication_id=p.id);

CREATE TRIGGER commerce_campaign_visit_guard BEFORE INSERT ON commerce_campaign_visits BEGIN
  SELECT RAISE(ABORT,'campaign_visit_immutable') WHERE EXISTS(SELECT 1 FROM commerce_campaign_visits WHERE token_hash=NEW.token_hash);
  SELECT RAISE(ABORT,'campaign_visit_unavailable') WHERE NOT EXISTS(SELECT 1 FROM commerce_campaign_visit_sources WHERE publication_id=NEW.publication_id
    AND seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment);
  SELECT RAISE(ABORT,'campaign_visit_rate') WHERE COALESCE((SELECT recorded FROM commerce_campaign_visit_buckets WHERE publication_id=NEW.publication_id
    AND bucket=strftime('%Y-%m-%dT%H:00:00.000Z',NEW.created_at)),0)>=10000
    OR COALESCE((SELECT SUM(recorded) FROM commerce_campaign_visit_buckets WHERE seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment
      AND bucket>=strftime('%Y-%m-%dT00:00:00.000Z',NEW.created_at) AND bucket<strftime('%Y-%m-%dT00:00:00.000Z',NEW.created_at,'+1 day')),0)>=100000;
END;
CREATE TRIGGER commerce_campaign_visit_record AFTER INSERT ON commerce_campaign_visits BEGIN
  UPDATE commerce_campaign_visit_buckets SET recorded=recorded+1,updated_at=MAX(updated_at,NEW.created_at)
    WHERE publication_id=NEW.publication_id AND bucket=strftime('%Y-%m-%dT%H:00:00.000Z',NEW.created_at);
  INSERT INTO commerce_campaign_visit_buckets(publication_id,seller_id,commerce_environment,bucket,recorded,limited,updated_at)
    SELECT NEW.publication_id,NEW.seller_id,NEW.commerce_environment,strftime('%Y-%m-%dT%H:00:00.000Z',NEW.created_at),1,0,NEW.created_at
    WHERE NOT EXISTS(SELECT 1 FROM commerce_campaign_visit_buckets WHERE publication_id=NEW.publication_id AND bucket=strftime('%Y-%m-%dT%H:00:00.000Z',NEW.created_at));
END;
CREATE TRIGGER commerce_campaign_visit_update BEFORE UPDATE ON commerce_campaign_visits BEGIN SELECT RAISE(ABORT,'campaign_visit_immutable'); END;
CREATE TRIGGER commerce_campaign_visit_delete BEFORE DELETE ON commerce_campaign_visits
WHEN OLD.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') BEGIN SELECT RAISE(ABORT,'campaign_visit_retained'); END;
CREATE TRIGGER commerce_campaign_visit_bucket_insert BEFORE INSERT ON commerce_campaign_visit_buckets BEGIN
  SELECT RAISE(ABORT,'campaign_visit_bucket_immutable') WHERE EXISTS(SELECT 1 FROM commerce_campaign_visit_buckets WHERE publication_id=NEW.publication_id AND bucket=NEW.bucket);
  SELECT RAISE(ABORT,'campaign_visit_bucket_invalid') WHERE NEW.recorded+NEW.limited!=1 OR NOT EXISTS(SELECT 1 FROM commerce_campaign_visit_sources
    WHERE publication_id=NEW.publication_id AND seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment);
END;
CREATE TRIGGER commerce_campaign_visit_bucket_update BEFORE UPDATE ON commerce_campaign_visit_buckets BEGIN
  SELECT RAISE(ABORT,'campaign_visit_bucket_immutable') WHERE NEW.publication_id!=OLD.publication_id OR NEW.seller_id!=OLD.seller_id OR NEW.commerce_environment!=OLD.commerce_environment
    OR NEW.bucket!=OLD.bucket OR NEW.updated_at<OLD.updated_at OR NOT ((NEW.recorded=OLD.recorded+1 AND NEW.limited=OLD.limited) OR (NEW.recorded=OLD.recorded AND NEW.limited=OLD.limited+1));
  SELECT RAISE(ABORT,'campaign_visit_unavailable') WHERE NOT EXISTS(SELECT 1 FROM commerce_campaign_visit_sources
    WHERE publication_id=NEW.publication_id AND seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment);
END;
CREATE TRIGGER commerce_campaign_visit_bucket_delete BEFORE DELETE ON commerce_campaign_visit_buckets BEGIN SELECT RAISE(ABORT,'campaign_visit_bucket_immutable'); END;

-- Attribution is made with the initial order insertion. Later reads, draft
-- changes, token expiry, cancellations or payment retries cannot retag an order.
CREATE TRIGGER commerce_campaign_order_source AFTER INSERT ON orders
WHEN NEW.commerce_version=1 AND json_type(NEW.snapshot_json,'$.checkout.campaignVisitHash')='text' BEGIN
  INSERT INTO commerce_campaign_order_attributions(order_id,publication_id,seller_id,commerce_environment,visit_hash,visited_at,created_at)
    SELECT NEW.id,v.publication_id,v.seller_id,v.commerce_environment,v.token_hash,v.created_at,NEW.created_at FROM commerce_campaign_visits v
    WHERE v.token_hash=json_extract(NEW.snapshot_json,'$.checkout.campaignVisitHash') AND v.seller_id=NEW.seller_id AND v.commerce_environment=NEW.commerce_environment
      AND v.created_at<=NEW.created_at AND v.expires_at>NEW.created_at;
END;
CREATE TRIGGER commerce_campaign_attribution_guard BEFORE INSERT ON commerce_campaign_order_attributions BEGIN
  SELECT RAISE(ABORT,'campaign_attribution_immutable') WHERE EXISTS(SELECT 1 FROM commerce_campaign_order_attributions WHERE order_id=NEW.order_id);
  SELECT RAISE(ABORT,'campaign_attribution_invalid') WHERE NOT EXISTS(SELECT 1 FROM orders o JOIN commerce_campaign_visits v ON v.token_hash=NEW.visit_hash
    WHERE o.id=NEW.order_id AND o.commerce_version=1 AND o.revision=0 AND o.checkout_state='creating' AND o.created_at=NEW.created_at
      AND json_extract(o.snapshot_json,'$.checkout.campaignVisitHash')=v.token_hash AND v.seller_id=NEW.seller_id AND o.seller_id=NEW.seller_id
      AND v.commerce_environment=NEW.commerce_environment AND o.commerce_environment=NEW.commerce_environment AND v.publication_id=NEW.publication_id
      AND v.created_at=NEW.visited_at AND v.created_at<=o.created_at AND v.expires_at>o.created_at);
END;
CREATE TRIGGER commerce_campaign_attribution_update BEFORE UPDATE ON commerce_campaign_order_attributions BEGIN SELECT RAISE(ABORT,'campaign_attribution_immutable'); END;
CREATE TRIGGER commerce_campaign_attribution_delete BEFORE DELETE ON commerce_campaign_order_attributions BEGIN SELECT RAISE(ABORT,'campaign_attribution_immutable'); END;
