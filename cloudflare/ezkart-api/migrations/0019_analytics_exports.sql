CREATE TABLE commerce_analytics_exports (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  report TEXT NOT NULL CHECK(report IN ('overview','revenue','orders','payments','products')),
  period_json TEXT NOT NULL CHECK(json_valid(period_json)),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'building' CHECK(state IN ('building','ready')),
  row_count INTEGER NOT NULL DEFAULT 0 CHECK(row_count>=0),
  UNIQUE(seller_id,commerce_environment,request_key)
);
CREATE INDEX commerce_analytics_export_expiry ON commerce_analytics_exports(expires_at);
CREATE INDEX commerce_analytics_export_rate ON commerce_analytics_exports(seller_id,commerce_environment,created_at);
CREATE TABLE commerce_analytics_export_rows (
  export_id TEXT NOT NULL REFERENCES commerce_analytics_exports(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK(ordinal>0),
  cells_json TEXT NOT NULL CHECK(json_valid(cells_json) AND json_type(cells_json)='array'),
  PRIMARY KEY(export_id,ordinal)
);
CREATE TRIGGER commerce_analytics_export_admission BEFORE INSERT ON commerce_analytics_exports BEGIN
  SELECT RAISE(ABORT,'analytics_export_state') WHERE NEW.state!='building' OR NEW.row_count!=0;
  SELECT RAISE(ABORT,'analytics_export_rate') WHERE (SELECT COUNT(*) FROM commerce_analytics_exports WHERE seller_id=NEW.seller_id
    AND commerce_environment=NEW.commerce_environment AND created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour'))>=20;
END;
CREATE TRIGGER commerce_analytics_export_finalize BEFORE UPDATE ON commerce_analytics_exports BEGIN
  SELECT RAISE(ABORT,'analytics_export_immutable') WHERE OLD.state!='building' OR NEW.state!='ready'
    OR NEW.id IS NOT OLD.id OR NEW.seller_id IS NOT OLD.seller_id OR NEW.commerce_environment IS NOT OLD.commerce_environment
    OR NEW.request_key IS NOT OLD.request_key OR NEW.request_hash IS NOT OLD.request_hash OR NEW.report IS NOT OLD.report
    OR NEW.period_json IS NOT OLD.period_json OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
    OR NEW.row_count!=(SELECT COUNT(*) FROM commerce_analytics_export_rows WHERE export_id=OLD.id);
END;
CREATE TRIGGER commerce_analytics_export_row_admission BEFORE INSERT ON commerce_analytics_export_rows BEGIN
  SELECT RAISE(ABORT,'analytics_export_immutable') WHERE NOT EXISTS(SELECT 1 FROM commerce_analytics_exports WHERE id=NEW.export_id AND state='building');
END;
CREATE TRIGGER commerce_analytics_export_row_immutable BEFORE UPDATE ON commerce_analytics_export_rows BEGIN
  SELECT RAISE(ABORT,'analytics_export_immutable');
END;
CREATE TRIGGER commerce_analytics_export_retention BEFORE DELETE ON commerce_analytics_exports
WHEN OLD.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') BEGIN SELECT RAISE(ABORT,'analytics_export_retained'); END;
CREATE TRIGGER commerce_analytics_export_row_retention BEFORE DELETE ON commerce_analytics_export_rows
WHEN EXISTS(SELECT 1 FROM commerce_analytics_exports WHERE id=OLD.export_id AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
BEGIN SELECT RAISE(ABORT,'analytics_export_retained'); END;
