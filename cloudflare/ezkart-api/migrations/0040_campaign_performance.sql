-- Both additional-payment totals and integrity checks are bounded by order.
CREATE INDEX idx_commerce_captures_order_kind ON commerce_payment_captures(order_id,capture_kind);

CREATE TABLE commerce_campaign_performance_exports (
  id TEXT PRIMARY KEY CHECK(length(id)=37 AND substr(id,1,5)='cpex_' AND substr(id,6) NOT GLOB '*[^a-f0-9]*'),
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  actor_id TEXT NOT NULL,
  request_key TEXT NOT NULL CHECK(length(request_key)=32 AND request_key NOT GLOB '*[^a-f0-9]*'),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^a-f0-9]*'),
  cohort TEXT NOT NULL CHECK(length(cohort) BETWEEN 1 AND 1600 AND cohort NOT GLOB '*[^A-Za-z0-9_-]*'),
  period_json TEXT NOT NULL CHECK(json_valid(period_json) AND json_type(period_json)='object'),
  publication_cap INTEGER NOT NULL CHECK(typeof(publication_cap)='integer' AND publication_cap>=0 AND publication_cap<9007199254740991),
  publication_cutoff TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',publication_cutoff) IS publication_cutoff),
  start_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',start_at) IS start_at),
  end_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',end_at) IS end_at AND end_at>start_at),
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at AND created_at>=publication_cutoff AND created_at<strftime('%Y-%m-%dT%H:%M:%fZ',publication_cutoff,'+1 day')),
  expires_at TEXT NOT NULL CHECK(expires_at IS strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+1 day')),
  state TEXT NOT NULL DEFAULT 'building' CHECK(state IN ('building','ready')),
  row_count INTEGER NOT NULL DEFAULT 0 CHECK(typeof(row_count)='integer' AND row_count>=0),
  UNIQUE(seller_id,commerce_environment,actor_id,request_key)
);
CREATE INDEX commerce_campaign_performance_expiry ON commerce_campaign_performance_exports(expires_at);
CREATE INDEX commerce_campaign_performance_rate ON commerce_campaign_performance_exports(seller_id,commerce_environment,created_at);
CREATE TABLE commerce_campaign_performance_export_rows (
  export_id TEXT NOT NULL REFERENCES commerce_campaign_performance_exports(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK(typeof(ordinal)='integer' AND ordinal>0),
  publication_id TEXT NOT NULL REFERENCES commerce_campaign_publications(id),
  cells_json TEXT NOT NULL CHECK(json_valid(cells_json) AND json_type(cells_json)='array' AND json_array_length(cells_json)=19),
  PRIMARY KEY(export_id,ordinal),
  UNIQUE(export_id,publication_id)
);
CREATE TRIGGER commerce_campaign_performance_admission BEFORE INSERT ON commerce_campaign_performance_exports BEGIN
  SELECT RAISE(ABORT,'campaign_performance_immutable') WHERE NEW.state!='building' OR NEW.row_count!=0
    OR EXISTS(SELECT 1 FROM commerce_campaign_performance_exports WHERE id=NEW.id
      OR (seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment AND actor_id=NEW.actor_id AND request_key=NEW.request_key));
  SELECT RAISE(ABORT,'campaign_performance_forbidden') WHERE NOT EXISTS(SELECT 1 FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id
    WHERE m.seller_id=NEW.seller_id AND m.auth_user_id=NEW.actor_id AND s.status='active');
  SELECT RAISE(ABORT,'campaign_performance_period') WHERE (SELECT COUNT(*) FROM json_each(NEW.period_json))!=7
    OR json_extract(NEW.period_json,'$.range') NOT IN ('7','30','90','180','all','custom') OR json_type(NEW.period_json,'$.range') IS NOT 'text'
    OR json_extract(NEW.period_json,'$.timeZone') NOT IN ('Asia/Jakarta','Asia/Makassar','Asia/Jayapura') OR json_type(NEW.period_json,'$.timeZone') IS NOT 'text'
    OR json_extract(NEW.period_json,'$.group') NOT IN ('daily','weekly','monthly','yearly') OR json_type(NEW.period_json,'$.group') IS NOT 'text'
    OR json_extract(NEW.period_json,'$.from') IS NOT date(NEW.start_at,CASE json_extract(NEW.period_json,'$.timeZone') WHEN 'Asia/Jakarta' THEN '+7 hours' WHEN 'Asia/Makassar' THEN '+8 hours' ELSE '+9 hours' END)
    OR json_extract(NEW.period_json,'$.to') IS NOT date(NEW.end_at,'-1 day',CASE json_extract(NEW.period_json,'$.timeZone') WHEN 'Asia/Jakarta' THEN '+7 hours' WHEN 'Asia/Makassar' THEN '+8 hours' ELSE '+9 hours' END);
  SELECT RAISE(ABORT,'campaign_performance_rate') WHERE (SELECT COUNT(*) FROM commerce_campaign_performance_exports WHERE seller_id=NEW.seller_id
    AND commerce_environment=NEW.commerce_environment AND created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour'))>=20;
END;
CREATE TRIGGER commerce_campaign_performance_row_admission BEFORE INSERT ON commerce_campaign_performance_export_rows BEGIN
  SELECT RAISE(ABORT,'campaign_performance_immutable') WHERE EXISTS(SELECT 1 FROM commerce_campaign_performance_export_rows
    WHERE export_id=NEW.export_id AND (ordinal=NEW.ordinal OR publication_id=NEW.publication_id));
  SELECT RAISE(ABORT,'campaign_performance_row') WHERE NOT EXISTS(SELECT 1 FROM commerce_campaign_performance_exports e
    JOIN commerce_campaign_publications p ON p.id=NEW.publication_id AND p.seller_id=e.seller_id AND p.commerce_environment=e.commerce_environment
    JOIN commerce_campaign_publication_state s ON s.id=p.id
    WHERE e.id=NEW.export_id AND e.state='building' AND p.rowid<=e.publication_cap AND p.created_at<=e.publication_cutoff
      AND p.created_at>=e.start_at AND p.created_at<e.end_at
      AND json_extract(NEW.cells_json,'$[0]') IS p.id AND json_extract(NEW.cells_json,'$[1]') IS p.campaign_id
      AND json_extract(NEW.cells_json,'$[2]') IS json_extract(p.data_json,'$.name') AND json_extract(NEW.cells_json,'$[3]') IS json_extract(p.data_json,'$.subject')
      AND json_extract(NEW.cells_json,'$[4]') IS p.created_at AND json_extract(NEW.cells_json,'$[5]') IS s.send_at
      AND json_extract(NEW.cells_json,'$[6]') IS CASE s.cancelled WHEN 1 THEN 'Yes' ELSE 'No' END
      AND NOT EXISTS(SELECT 1 FROM json_each(NEW.cells_json) WHERE key BETWEEN 7 AND 13 AND (type!='integer' OR value<0 OR value>9007199254740991))
      AND json_extract(NEW.cells_json,'$[7]')<=1 AND json_extract(NEW.cells_json,'$[8]')<=1
      AND json_extract(NEW.cells_json,'$[12]')<=json_extract(NEW.cells_json,'$[11]')
      AND json_extract(NEW.cells_json,'$[13]')<=json_extract(NEW.cells_json,'$[12]')
      AND json_extract(NEW.cells_json,'$[13]')<=json_extract(NEW.cells_json,'$[9]')
      AND NOT EXISTS(SELECT 1 FROM json_each(NEW.cells_json) WHERE key BETWEEN 14 AND 17 AND
        (type!='text' OR length(value) NOT BETWEEN 1 AND 19 OR value GLOB '*[^0-9]*' OR value IS NOT CAST(CAST(value AS INTEGER) AS TEXT) OR CAST(value AS INTEGER)<0))
      AND CAST(json_extract(NEW.cells_json,'$[14]') AS INTEGER)=CAST(json_extract(NEW.cells_json,'$[15]') AS INTEGER)+CAST(json_extract(NEW.cells_json,'$[16]') AS INTEGER)
      AND json_extract(NEW.cells_json,'$[18]') IS CASE WHEN json_extract(NEW.cells_json,'$[9]')=0 THEN ''
        ELSE printf('%.2f',100.0*json_extract(NEW.cells_json,'$[13]')/json_extract(NEW.cells_json,'$[9]')) END);
END;
CREATE TRIGGER commerce_campaign_performance_finalize BEFORE UPDATE ON commerce_campaign_performance_exports BEGIN
  SELECT RAISE(ABORT,'campaign_performance_forbidden') WHERE NOT EXISTS(SELECT 1 FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id
    WHERE m.seller_id=OLD.seller_id AND m.auth_user_id=OLD.actor_id AND s.status='active');
  SELECT RAISE(ABORT,'campaign_performance_immutable') WHERE OLD.state!='building' OR NEW.state!='ready'
    OR NEW.id IS NOT OLD.id OR NEW.seller_id IS NOT OLD.seller_id OR NEW.commerce_environment IS NOT OLD.commerce_environment
    OR NEW.actor_id IS NOT OLD.actor_id OR NEW.request_key IS NOT OLD.request_key OR NEW.request_hash IS NOT OLD.request_hash
    OR NEW.cohort IS NOT OLD.cohort OR NEW.period_json IS NOT OLD.period_json OR NEW.publication_cap IS NOT OLD.publication_cap
    OR NEW.publication_cutoff IS NOT OLD.publication_cutoff OR NEW.start_at IS NOT OLD.start_at OR NEW.end_at IS NOT OLD.end_at
    OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
    OR NEW.row_count!=(SELECT COUNT(*) FROM commerce_campaign_performance_export_rows WHERE export_id=OLD.id)
    OR NEW.row_count!=COALESCE((SELECT MAX(ordinal) FROM commerce_campaign_performance_export_rows WHERE export_id=OLD.id),0)
    OR NEW.row_count!=(SELECT COUNT(*) FROM commerce_campaign_publications p WHERE p.seller_id=OLD.seller_id
      AND p.commerce_environment=OLD.commerce_environment AND p.rowid<=OLD.publication_cap AND p.created_at<=OLD.publication_cutoff
      AND p.created_at>=OLD.start_at AND p.created_at<OLD.end_at);
END;
CREATE TRIGGER commerce_campaign_performance_row_immutable BEFORE UPDATE ON commerce_campaign_performance_export_rows
BEGIN SELECT RAISE(ABORT,'campaign_performance_immutable'); END;
CREATE TRIGGER commerce_campaign_performance_retention BEFORE DELETE ON commerce_campaign_performance_exports
WHEN OLD.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') BEGIN SELECT RAISE(ABORT,'campaign_performance_retained'); END;
CREATE TRIGGER commerce_campaign_performance_row_retention BEFORE DELETE ON commerce_campaign_performance_export_rows
WHEN EXISTS(SELECT 1 FROM commerce_campaign_performance_exports WHERE id=OLD.export_id AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
BEGIN SELECT RAISE(ABORT,'campaign_performance_retained'); END;
