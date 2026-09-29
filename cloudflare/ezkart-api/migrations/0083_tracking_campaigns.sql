CREATE TABLE tracking_campaigns (
 id TEXT PRIMARY KEY, seller_id TEXT NOT NULL REFERENCES sellers(id), commerce_environment TEXT NOT NULL,
 name TEXT NOT NULL, request_hash TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT,
 CHECK(length(name) BETWEEN 1 AND 120), CHECK(ended_at IS NULL OR ended_at>=started_at)
);
CREATE INDEX tracking_campaign_seller ON tracking_campaigns(seller_id,commerce_environment,started_at,id);
CREATE TABLE tracking_pages (
 campaign_id TEXT NOT NULL REFERENCES tracking_campaigns(id), page_id TEXT NOT NULL, name TEXT NOT NULL, public_path TEXT NOT NULL,
 PRIMARY KEY(campaign_id,page_id)
);
CREATE TABLE tracking_sources (
 id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, page_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(campaign_id,page_id) REFERENCES tracking_pages(campaign_id,page_id),
 UNIQUE(campaign_id,page_id,name), CHECK(length(name) BETWEEN 1 AND 120)
);
CREATE INDEX tracking_sources_page ON tracking_sources(campaign_id,page_id);
CREATE TRIGGER tracking_source_limit BEFORE INSERT ON tracking_sources WHEN NOT EXISTS(SELECT 1 FROM tracking_sources WHERE id=NEW.id)
BEGIN
 SELECT RAISE(ABORT,'tracking_source_limit') WHERE (SELECT COUNT(*) FROM tracking_sources WHERE campaign_id=NEW.campaign_id AND page_id=NEW.page_id)>=40;
 SELECT RAISE(ABORT,'tracking_campaign_ended') WHERE (SELECT ended_at FROM tracking_campaigns WHERE id=NEW.campaign_id) IS NOT NULL;
END;
CREATE TABLE tracking_visits (
 token_hash TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES tracking_sources(id), visitor_hash TEXT NOT NULL,
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL, dimensions_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX tracking_visits_source ON tracking_visits(source_id,created_at);
CREATE TRIGGER tracking_visit_active BEFORE INSERT ON tracking_visits
BEGIN
 SELECT RAISE(ABORT,'tracking_campaign_ended') WHERE EXISTS(SELECT 1 FROM tracking_sources s JOIN tracking_campaigns c ON c.id=s.campaign_id WHERE s.id=NEW.source_id AND c.ended_at IS NOT NULL);
 SELECT RAISE(ABORT,'tracking_visit_limit') WHERE (SELECT COUNT(*) FROM tracking_visits WHERE source_id=NEW.source_id AND created_at>=substr(NEW.created_at,1,13))>=10000;
END;
CREATE TABLE tracking_events (
 id TEXT PRIMARY KEY, visit_hash TEXT NOT NULL REFERENCES tracking_visits(token_hash), kind TEXT NOT NULL,
 document_id TEXT NOT NULL, elapsed_ms INTEGER NOT NULL DEFAULT 0, occurred_at TEXT NOT NULL, properties_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX tracking_events_visit ON tracking_events(visit_hash,occurred_at);
CREATE TRIGGER tracking_event_limit BEFORE INSERT ON tracking_events WHEN NOT EXISTS(SELECT 1 FROM tracking_events WHERE id=NEW.id)
BEGIN
 SELECT RAISE(ABORT,'tracking_event_limit') WHERE (SELECT COUNT(*) FROM tracking_events WHERE visit_hash=NEW.visit_hash)>=2000;
END;
CREATE TABLE tracking_orders (
 order_id TEXT PRIMARY KEY REFERENCES orders(id), visit_hash TEXT NOT NULL REFERENCES tracking_visits(token_hash)
);
CREATE INDEX tracking_orders_visit ON tracking_orders(visit_hash);
CREATE TRIGGER tracking_order_attribution AFTER INSERT ON orders
WHEN json_extract(NEW.snapshot_json,'$.checkout.trackingVisitHash') IS NOT NULL
BEGIN
 INSERT INTO tracking_orders(order_id,visit_hash)
 SELECT NEW.id,v.token_hash FROM tracking_visits v JOIN tracking_sources s ON s.id=v.source_id JOIN tracking_campaigns c ON c.id=s.campaign_id
 WHERE v.token_hash=json_extract(NEW.snapshot_json,'$.checkout.trackingVisitHash') AND c.seller_id=NEW.seller_id
 AND c.commerce_environment=NEW.commerce_environment AND c.ended_at IS NULL AND NEW.created_at>=v.created_at AND NEW.created_at<v.expires_at;
END;
