-- Durable facts are independent of marketing configuration. No historical
-- grants, captures or expiries are enrolled by this migration.
CREATE TABLE commerce_marketing_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  kind TEXT NOT NULL CHECK(kind IN ('permission','payment','expiry')),
  source_key TEXT NOT NULL CHECK(length(source_key) BETWEEN 1 AND 256),
  order_id TEXT REFERENCES orders(id),
  auth_user_id TEXT,
  email TEXT,
  consent_revision INTEGER CHECK(consent_revision IS NULL OR (typeof(consent_revision)='integer' AND consent_revision>=1)),
  occurred_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',occurred_at) IS occurred_at),
  recorded_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',recorded_at) IS recorded_at),
  UNIQUE(kind,source_key)
);
CREATE INDEX commerce_marketing_events_store ON commerce_marketing_events(seller_id,commerce_environment,sequence);
CREATE INDEX commerce_marketing_events_contact ON commerce_marketing_events(seller_id,commerce_environment,auth_user_id,kind,sequence);
CREATE UNIQUE INDEX commerce_marketing_events_order ON commerce_marketing_events(kind,order_id) WHERE order_id IS NOT NULL;
CREATE TRIGGER commerce_marketing_event_guard BEFORE INSERT ON commerce_marketing_events BEGIN
  SELECT RAISE(ABORT,'marketing_event_immutable') WHERE EXISTS(SELECT 1 FROM commerce_marketing_events
    WHERE sequence=NEW.sequence OR (kind=NEW.kind AND source_key=NEW.source_key) OR (NEW.order_id IS NOT NULL AND kind=NEW.kind AND order_id=NEW.order_id));
  SELECT RAISE(ABORT,'marketing_event_source') WHERE NOT (
    (NEW.kind='permission' AND NEW.order_id IS NULL AND EXISTS(SELECT 1 FROM commerce_customer_consent_changes c
      WHERE c.auth_user_id||':'||c.request_key=NEW.source_key AND c.request_key=substr(NEW.source_key,length(NEW.auth_user_id)+2) AND c.seller_id=NEW.seller_id AND c.commerce_environment=NEW.commerce_environment
        AND c.auth_user_id IS NEW.auth_user_id AND c.email IS NEW.email AND c.revision IS NEW.consent_revision AND c.created_at=NEW.occurred_at AND c.allowed=1
        AND (c.expected_revision=0 OR EXISTS(SELECT 1 FROM commerce_customer_consent_history h WHERE h.seller_id=c.seller_id
          AND h.commerce_environment=c.commerce_environment AND h.auth_user_id=c.auth_user_id AND h.email=c.email AND h.revision=c.expected_revision AND h.allowed=0))))
    OR (NEW.kind='payment' AND EXISTS(SELECT 1 FROM commerce_payment_captures c JOIN orders o ON o.id=c.order_id
      LEFT JOIN commerce_order_owners owner ON owner.order_id=o.id WHERE c.id=NEW.source_key AND c.capture_kind='order_payment'
        AND c.seller_id=NEW.seller_id AND c.commerce_environment=NEW.commerce_environment AND c.order_id=NEW.order_id
        AND o.seller_id=c.seller_id AND o.commerce_environment=c.commerce_environment AND o.commerce_version=1 AND c.currency='IDR' AND c.amount=o.total_amount
        AND COALESCE(owner.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),'')) IS NEW.auth_user_id
        AND lower(trim(json_extract(o.customer_snapshot_json,'$.email'))) IS NEW.email AND c.verified_at=NEW.occurred_at
        AND NEW.consent_revision IS (SELECT revision FROM commerce_customer_consents WHERE seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment
          AND auth_user_id=NEW.auth_user_id AND email=NEW.email AND allowed=1)))
    OR (NEW.kind='expiry' AND EXISTS(SELECT 1 FROM commerce_order_events e JOIN orders o ON o.id=e.order_id
      LEFT JOIN commerce_order_owners owner ON owner.order_id=o.id WHERE e.id=NEW.source_key AND e.event_type IN ('payment.expired','payment.created')
        AND o.seller_id=NEW.seller_id AND o.commerce_environment=NEW.commerce_environment AND o.commerce_version=1 AND o.id=NEW.order_id
        AND o.checkout_state='expired' AND o.revision=e.previous_revision+1
        AND COALESCE(owner.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),'')) IS NEW.auth_user_id
        AND lower(trim(json_extract(o.customer_snapshot_json,'$.email'))) IS NEW.email AND e.created_at=NEW.occurred_at
        AND NEW.consent_revision IS (SELECT revision FROM commerce_customer_consents WHERE seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment
          AND auth_user_id=NEW.auth_user_id AND email=NEW.email AND allowed=1))));
END;
CREATE TRIGGER commerce_marketing_event_update BEFORE UPDATE ON commerce_marketing_events BEGIN SELECT RAISE(ABORT,'marketing_event_immutable'); END;
CREATE TRIGGER commerce_marketing_event_delete BEFORE DELETE ON commerce_marketing_events BEGIN SELECT RAISE(ABORT,'marketing_event_immutable'); END;
CREATE TRIGGER commerce_marketing_permission AFTER INSERT ON commerce_customer_consent_changes WHEN NEW.allowed=1 BEGIN
  INSERT INTO commerce_marketing_events(seller_id,commerce_environment,kind,source_key,auth_user_id,email,consent_revision,occurred_at)
    SELECT NEW.seller_id,NEW.commerce_environment,'permission',NEW.auth_user_id||':'||NEW.request_key,NEW.auth_user_id,NEW.email,NEW.revision,NEW.created_at
    WHERE NEW.expected_revision=0 OR EXISTS(SELECT 1 FROM commerce_customer_consent_history h WHERE h.seller_id=NEW.seller_id
      AND h.commerce_environment=NEW.commerce_environment AND h.auth_user_id=NEW.auth_user_id AND h.email=NEW.email AND h.revision=NEW.expected_revision AND h.allowed=0);
END;
CREATE TRIGGER commerce_marketing_payment AFTER INSERT ON commerce_payment_captures WHEN NEW.capture_kind='order_payment' BEGIN
  INSERT INTO commerce_marketing_events(seller_id,commerce_environment,kind,source_key,order_id,auth_user_id,email,consent_revision,occurred_at)
    SELECT NEW.seller_id,NEW.commerce_environment,'payment',NEW.id,o.id,
      COALESCE(owner.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),'')),lower(trim(json_extract(o.customer_snapshot_json,'$.email'))),
      (SELECT revision FROM commerce_customer_consents WHERE seller_id=o.seller_id AND commerce_environment=o.commerce_environment AND allowed=1
        AND auth_user_id=COALESCE(owner.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),'')) AND email=lower(trim(json_extract(o.customer_snapshot_json,'$.email')))),NEW.verified_at
    FROM orders o LEFT JOIN commerce_order_owners owner ON owner.order_id=o.id WHERE o.id=NEW.order_id AND o.seller_id=NEW.seller_id
      AND o.commerce_environment=NEW.commerce_environment AND o.commerce_version=1 AND NEW.currency='IDR' AND NEW.amount=o.total_amount;
END;
CREATE TRIGGER commerce_marketing_expiry AFTER UPDATE OF checkout_state ON orders WHEN NEW.commerce_version=1 AND NEW.checkout_state='expired' AND OLD.checkout_state!='expired' BEGIN
  INSERT INTO commerce_marketing_events(seller_id,commerce_environment,kind,source_key,order_id,auth_user_id,email,consent_revision,occurred_at)
    SELECT o.seller_id,o.commerce_environment,'expiry',e.id,o.id,
      COALESCE(owner.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),'')),lower(trim(json_extract(o.customer_snapshot_json,'$.email'))),
      (SELECT revision FROM commerce_customer_consents WHERE seller_id=o.seller_id AND commerce_environment=o.commerce_environment AND allowed=1
        AND auth_user_id=COALESCE(owner.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),'')) AND email=lower(trim(json_extract(o.customer_snapshot_json,'$.email')))),e.created_at
    FROM orders o JOIN commerce_order_events e ON e.order_id=o.id AND e.previous_revision=OLD.revision AND e.event_type IN ('payment.expired','payment.created')
    LEFT JOIN commerce_order_owners owner ON owner.order_id=o.id WHERE o.id=NEW.id AND NOT EXISTS(SELECT 1 FROM commerce_marketing_events WHERE kind='expiry' AND order_id=o.id);
END;

CREATE TABLE commerce_automations (
  id TEXT PRIMARY KEY CHECK(length(id)=37 AND substr(id,1,5)='auto_' AND substr(id,6) NOT GLOB '*[^a-f0-9]*'),
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
  state TEXT NOT NULL CHECK(state IN ('paused','active','archived')),
  data_json TEXT NOT NULL CHECK(json_valid(data_json) AND json_type(data_json)='object'),
  actor_id TEXT NOT NULL,
  event_after INTEGER NOT NULL CHECK(typeof(event_after)='integer' AND event_after>=0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX commerce_automations_store ON commerce_automations(seller_id,commerce_environment,state,id);
CREATE TABLE commerce_automation_changes (
  automation_id TEXT NOT NULL,
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  actor_id TEXT NOT NULL,
  request_key TEXT NOT NULL CHECK(length(request_key)=32 AND request_key NOT GLOB '*[^a-f0-9]*'),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^a-f0-9]*'),
  expected_revision INTEGER NOT NULL CHECK(typeof(expected_revision)='integer' AND expected_revision>=0),
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision=expected_revision+1 AND revision<=9007199254740991),
  kind TEXT NOT NULL CHECK(kind IN ('save','activate','pause','archive','restore')),
  state TEXT NOT NULL CHECK(state IN ('paused','active','archived')),
  data_json TEXT NOT NULL CHECK(json_valid(data_json) AND json_type(data_json)='object' AND length(data_json)<=32000),
  event_after INTEGER NOT NULL CHECK(typeof(event_after)='integer' AND event_after>=0),
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at),
  PRIMARY KEY(actor_id,request_key),
  UNIQUE(automation_id,revision)
);
CREATE INDEX commerce_automation_changes_store ON commerce_automation_changes(seller_id,commerce_environment,created_at);
CREATE TRIGGER commerce_automation_change_guard BEFORE INSERT ON commerce_automation_changes BEGIN
  SELECT RAISE(ABORT,'automation_immutable') WHERE EXISTS(SELECT 1 FROM commerce_automation_changes WHERE actor_id=NEW.actor_id AND request_key=NEW.request_key);
  SELECT RAISE(ABORT,'automation_forbidden') WHERE NOT EXISTS(SELECT 1 FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id
    WHERE m.seller_id=NEW.seller_id AND m.auth_user_id=NEW.actor_id AND m.role!='viewer' AND s.status='active');
  SELECT RAISE(ABORT,'automation_revision_conflict') WHERE NEW.expected_revision!=COALESCE((SELECT revision FROM commerce_automations
    WHERE id=NEW.automation_id AND seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment),0)
    OR EXISTS(SELECT 1 FROM commerce_automations WHERE id=NEW.automation_id AND (seller_id!=NEW.seller_id OR commerce_environment!=NEW.commerce_environment));
  SELECT RAISE(ABORT,'automation_transition') WHERE NOT (
    (NEW.kind='save' AND NEW.state='paused' AND (NEW.expected_revision=0 OR EXISTS(SELECT 1 FROM commerce_automations WHERE id=NEW.automation_id AND state='paused')))
    OR (NEW.kind!='save' AND EXISTS(SELECT 1 FROM commerce_automations a WHERE a.id=NEW.automation_id AND a.data_json=NEW.data_json
      AND ((NEW.kind='activate' AND a.state='paused' AND NEW.state='active') OR (NEW.kind='pause' AND a.state IN ('active','paused') AND NEW.state='paused')
        OR (NEW.kind='archive' AND a.state='paused' AND NEW.state='archived') OR (NEW.kind='restore' AND a.state='archived' AND NEW.state='paused')))));
  SELECT RAISE(ABORT,'automation_values_invalid') WHERE (SELECT COUNT(*) FROM json_each(NEW.data_json))!=10
    OR json_type(NEW.data_json,'$.name') IS NOT 'text' OR length(trim(json_extract(NEW.data_json,'$.name'))) NOT BETWEEN 1 AND 120
    OR json_type(NEW.data_json,'$.trigger') IS NOT 'text' OR json_extract(NEW.data_json,'$.trigger') NOT IN ('welcome','paid','expired','winback')
    OR json_type(NEW.data_json,'$.delayMinutes') IS NOT 'integer' OR json_extract(NEW.data_json,'$.delayMinutes') NOT BETWEEN 0 AND 525600
    OR (json_extract(NEW.data_json,'$.trigger')='winback' AND json_extract(NEW.data_json,'$.delayMinutes')<1440)
    OR (json_extract(NEW.data_json,'$.trigger')!='winback' AND json_extract(NEW.data_json,'$.delayMinutes')>43200)
    OR json_type(NEW.data_json,'$.cooldownDays') IS NOT 'integer' OR json_extract(NEW.data_json,'$.cooldownDays') NOT BETWEEN 1 AND 90
    OR json_type(NEW.data_json,'$.subject') IS NOT 'text' OR length(json_extract(NEW.data_json,'$.subject'))>160
    OR json_type(NEW.data_json,'$.preheader') IS NOT 'text' OR length(json_extract(NEW.data_json,'$.preheader'))>200
    OR json_type(NEW.data_json,'$.heading') IS NOT 'text' OR length(json_extract(NEW.data_json,'$.heading'))>160
    OR json_type(NEW.data_json,'$.body') IS NOT 'text' OR length(json_extract(NEW.data_json,'$.body'))>6000
    OR json_type(NEW.data_json,'$.buttonLabel') IS NOT 'text' OR length(json_extract(NEW.data_json,'$.buttonLabel'))>60
    OR json_type(NEW.data_json,'$.audience') IS NOT 'object' OR (SELECT COUNT(*) FROM json_each(NEW.data_json,'$.audience'))!=9
    OR (SELECT COUNT(DISTINCT key) FROM json_each(NEW.data_json,'$.audience') WHERE key IN ('q','activity','minSpend','minOrders','maxOrders','lastFrom','lastTo','location','tag') AND type='text')!=9
    OR json_extract(NEW.data_json,'$.audience.activity') NOT IN ('all','high_value','one_order','repeat','no_paid');
  SELECT RAISE(ABORT,'automation_activation') WHERE NEW.kind='activate' AND (length(trim(json_extract(NEW.data_json,'$.subject')))=0
    OR length(trim(json_extract(NEW.data_json,'$.heading')))=0 OR length(trim(json_extract(NEW.data_json,'$.body')))=0
    OR (json_extract(NEW.data_json,'$.buttonLabel')!='' AND NOT EXISTS(SELECT 1 FROM sellers WHERE id=NEW.seller_id AND json_extract(settings_json,'$.storefront.enabled')=1)));
  SELECT RAISE(ABORT,'automation_boundary') WHERE (NEW.kind='activate' AND NEW.event_after!=(SELECT COALESCE(MAX(sequence),0)
    FROM commerce_marketing_events WHERE seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment))
    OR (NEW.kind!='activate' AND NEW.event_after!=COALESCE((SELECT event_after FROM commerce_automations WHERE id=NEW.automation_id),0));
  SELECT RAISE(ABORT,'automation_limit') WHERE (NEW.expected_revision=0 AND (SELECT COUNT(*) FROM commerce_automations WHERE seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment)>=100)
    OR (NEW.kind='activate' AND (SELECT COUNT(*) FROM commerce_automations WHERE seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment AND state='active')>=20);
  SELECT RAISE(ABORT,'automation_rate') WHERE (NEW.kind!='pause' OR EXISTS(SELECT 1 FROM commerce_automations WHERE id=NEW.automation_id AND state='paused')) AND ((SELECT COUNT(*) FROM commerce_automation_changes WHERE seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment
    AND created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute'))>=30
    OR (SELECT COUNT(*) FROM commerce_automation_changes WHERE seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment AND created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day'))>=200);
END;
CREATE TRIGGER commerce_automation_change_apply AFTER INSERT ON commerce_automation_changes BEGIN
  UPDATE commerce_automations SET revision=NEW.revision,state=NEW.state,data_json=NEW.data_json,actor_id=NEW.actor_id,event_after=NEW.event_after,updated_at=NEW.created_at WHERE id=NEW.automation_id;
  INSERT INTO commerce_automations(id,seller_id,commerce_environment,revision,state,data_json,actor_id,event_after,created_at,updated_at)
    SELECT NEW.automation_id,NEW.seller_id,NEW.commerce_environment,NEW.revision,NEW.state,NEW.data_json,NEW.actor_id,NEW.event_after,NEW.created_at,NEW.created_at
    WHERE NOT EXISTS(SELECT 1 FROM commerce_automations WHERE id=NEW.automation_id);
END;
CREATE TRIGGER commerce_automation_insert BEFORE INSERT ON commerce_automations BEGIN
  SELECT RAISE(ABORT,'automation_receipt_required') WHERE EXISTS(SELECT 1 FROM commerce_automations WHERE id=NEW.id) OR NEW.revision!=1 OR NEW.state!='paused'
    OR NEW.created_at!=NEW.updated_at OR NOT EXISTS(SELECT 1 FROM commerce_automation_changes c WHERE c.automation_id=NEW.id AND c.revision=NEW.revision
      AND c.seller_id=NEW.seller_id AND c.commerce_environment=NEW.commerce_environment AND c.state=NEW.state AND c.data_json=NEW.data_json
      AND c.actor_id=NEW.actor_id AND c.event_after=NEW.event_after AND c.created_at=NEW.updated_at);
END;
CREATE TRIGGER commerce_automation_update BEFORE UPDATE ON commerce_automations BEGIN
  SELECT RAISE(ABORT,'automation_receipt_required') WHERE NEW.id!=OLD.id OR NEW.seller_id!=OLD.seller_id OR NEW.commerce_environment!=OLD.commerce_environment
    OR NEW.created_at!=OLD.created_at OR NEW.revision!=OLD.revision+1 OR NOT EXISTS(SELECT 1 FROM commerce_automation_changes c WHERE c.automation_id=NEW.id
      AND c.expected_revision=OLD.revision AND c.revision=NEW.revision AND c.seller_id=NEW.seller_id AND c.commerce_environment=NEW.commerce_environment
      AND c.state=NEW.state AND c.data_json=NEW.data_json AND c.actor_id=NEW.actor_id AND c.event_after=NEW.event_after AND c.created_at=NEW.updated_at);
END;
CREATE TRIGGER commerce_automation_delete BEFORE DELETE ON commerce_automations BEGIN SELECT RAISE(ABORT,'automation_receipt_required'); END;
CREATE TRIGGER commerce_automation_change_update BEFORE UPDATE ON commerce_automation_changes BEGIN SELECT RAISE(ABORT,'automation_immutable'); END;
CREATE TRIGGER commerce_automation_change_delete BEFORE DELETE ON commerce_automation_changes BEGIN SELECT RAISE(ABORT,'automation_immutable'); END;

CREATE TABLE commerce_automation_scans (
  id TEXT PRIMARY KEY CHECK(length(id)=38 AND substr(id,1,6)='ascan_' AND substr(id,7) NOT GLOB '*[^a-f0-9]*'),
  automation_id TEXT NOT NULL REFERENCES commerce_automations(id),
  rule_revision INTEGER NOT NULL,
  from_sequence INTEGER NOT NULL CHECK(typeof(from_sequence)='integer' AND from_sequence>=0),
  to_sequence INTEGER NOT NULL CHECK(typeof(to_sequence)='integer' AND to_sequence>from_sequence),
  order_cap INTEGER NOT NULL CHECK(typeof(order_cap)='integer' AND order_cap>=0),
  event_count INTEGER NOT NULL CHECK(typeof(event_count)='integer' AND event_count BETWEEN 1 AND 50),
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at),
  UNIQUE(automation_id,rule_revision,from_sequence),
  FOREIGN KEY(automation_id,rule_revision) REFERENCES commerce_automation_changes(automation_id,revision)
);
CREATE VIEW commerce_automation_scan_state AS SELECT a.*,
  COALESCE((SELECT MAX(to_sequence) FROM commerce_automation_scans s WHERE s.automation_id=a.id AND s.rule_revision=a.revision),a.event_after) AS scanned_through,
  COALESCE((SELECT MAX(created_at) FROM commerce_automation_scans s WHERE s.automation_id=a.id AND s.rule_revision=a.revision),a.updated_at) AS scanned_at
  FROM commerce_automations a;
CREATE TRIGGER commerce_automation_scan_guard BEFORE INSERT ON commerce_automation_scans BEGIN
  SELECT RAISE(ABORT,'automation_scan_immutable') WHERE EXISTS(SELECT 1 FROM commerce_automation_scans WHERE id=NEW.id
    OR (automation_id=NEW.automation_id AND rule_revision=NEW.rule_revision AND from_sequence=NEW.from_sequence));
  SELECT RAISE(ABORT,'automation_scan_changed') WHERE NOT EXISTS(SELECT 1 FROM commerce_automation_scan_state a JOIN sellers store ON store.id=a.seller_id
    JOIN seller_memberships m ON m.seller_id=a.seller_id AND m.auth_user_id=a.actor_id AND m.role!='viewer'
    WHERE a.id=NEW.automation_id AND a.revision=NEW.rule_revision AND a.state='active' AND store.status='active'
      AND a.scanned_through=NEW.from_sequence AND NEW.created_at>=a.updated_at
      AND NEW.order_cap=(SELECT COALESCE(MAX(rowid),0) FROM orders WHERE seller_id=a.seller_id AND commerce_environment=a.commerce_environment AND commerce_version=1)
      AND NEW.to_sequence=(SELECT MAX(sequence) FROM (SELECT sequence FROM commerce_marketing_events WHERE seller_id=a.seller_id
        AND commerce_environment=a.commerce_environment AND sequence>NEW.from_sequence ORDER BY sequence LIMIT 50))
      AND NEW.event_count=(SELECT COUNT(*) FROM commerce_marketing_events WHERE seller_id=a.seller_id AND commerce_environment=a.commerce_environment
        AND sequence>NEW.from_sequence AND sequence<=NEW.to_sequence));
  SELECT RAISE(ABORT,'automation_source_invalid') WHERE EXISTS(SELECT 1 FROM commerce_marketing_events e JOIN commerce_automations a ON a.id=NEW.automation_id
    WHERE e.seller_id=a.seller_id AND e.commerce_environment=a.commerce_environment AND e.sequence>NEW.from_sequence AND e.sequence<=NEW.to_sequence AND (
      (e.kind='payment' AND NOT EXISTS(SELECT 1 FROM commerce_payment_captures c JOIN orders o ON o.id=c.order_id WHERE c.id=e.source_key AND c.order_id=e.order_id
        AND c.seller_id=e.seller_id AND c.commerce_environment=e.commerce_environment AND c.capture_kind='order_payment' AND c.currency='IDR' AND c.amount=o.total_amount
        AND o.seller_id=c.seller_id AND o.commerce_environment=c.commerce_environment AND o.commerce_version=1 AND c.verified_at=e.occurred_at))
      OR (e.kind='permission' AND NOT EXISTS(SELECT 1 FROM commerce_customer_consent_changes c WHERE c.auth_user_id=e.auth_user_id
        AND c.commerce_environment=e.commerce_environment AND c.request_key=substr(e.source_key,length(e.auth_user_id)+2) AND c.seller_id=e.seller_id
        AND c.auth_user_id||':'||c.request_key=e.source_key AND c.email=e.email AND c.revision=e.consent_revision AND c.allowed=1 AND c.created_at=e.occurred_at))
      OR (e.kind='expiry' AND NOT EXISTS(SELECT 1 FROM commerce_order_events o WHERE o.id=e.source_key AND o.seller_id=e.seller_id AND o.order_id=e.order_id
        AND o.event_type IN ('payment.expired','payment.created') AND o.created_at=e.occurred_at))));
END;
CREATE TRIGGER commerce_automation_scan_update BEFORE UPDATE ON commerce_automation_scans BEGIN SELECT RAISE(ABORT,'automation_scan_immutable'); END;
CREATE TRIGGER commerce_automation_scan_delete BEFORE DELETE ON commerce_automation_scans BEGIN SELECT RAISE(ABORT,'automation_scan_immutable'); END;

CREATE TABLE commerce_automation_enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id TEXT NOT NULL REFERENCES commerce_automation_scans(id),
  automation_id TEXT NOT NULL REFERENCES commerce_automations(id),
  rule_revision INTEGER NOT NULL,
  event_sequence INTEGER NOT NULL REFERENCES commerce_marketing_events(sequence),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  order_id TEXT NOT NULL REFERENCES orders(id),
  auth_user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  consent_revision INTEGER NOT NULL CHECK(typeof(consent_revision)='integer' AND consent_revision>=1),
  due_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',due_at) IS due_at),
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at),
  UNIQUE(automation_id,event_sequence),
  FOREIGN KEY(automation_id,rule_revision) REFERENCES commerce_automation_changes(automation_id,revision)
);
CREATE INDEX commerce_automation_enrollments_due ON commerce_automation_enrollments(due_at,id);
CREATE INDEX commerce_automation_enrollments_contact ON commerce_automation_enrollments(automation_id,auth_user_id,email,id);
CREATE TRIGGER commerce_automation_enrollment_guard BEFORE INSERT ON commerce_automation_enrollments BEGIN
  SELECT RAISE(ABORT,'automation_enrollment_immutable') WHERE EXISTS(SELECT 1 FROM commerce_automation_enrollments WHERE id=NEW.id
    OR (automation_id=NEW.automation_id AND event_sequence=NEW.event_sequence));
  SELECT RAISE(ABORT,'automation_enrollment_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_automation_scans scan
    JOIN commerce_automations a ON a.id=scan.automation_id AND a.revision=scan.rule_revision AND a.state='active'
    JOIN commerce_marketing_events e ON e.seller_id=a.seller_id AND e.commerce_environment=a.commerce_environment
    JOIN sellers store ON store.id=a.seller_id AND store.status='active'
    JOIN seller_memberships member ON member.seller_id=a.seller_id AND member.auth_user_id=a.actor_id AND member.role!='viewer'
    JOIN orders o ON o.id=NEW.order_id AND o.seller_id=a.seller_id AND o.commerce_environment=a.commerce_environment AND o.commerce_version=1 AND o.rowid<=scan.order_cap
    LEFT JOIN commerce_order_owners owner ON owner.order_id=o.id
    JOIN commerce_customer_consents c ON c.seller_id=a.seller_id AND c.commerce_environment=a.commerce_environment AND c.auth_user_id=e.auth_user_id AND c.email=e.email
    WHERE scan.id=NEW.scan_id AND a.id=NEW.automation_id AND a.revision=NEW.rule_revision AND e.sequence=NEW.event_sequence
      AND e.sequence>scan.from_sequence AND e.sequence<=scan.to_sequence AND NEW.created_at=scan.created_at
      AND NEW.due_at=strftime('%Y-%m-%dT%H:%M:%fZ',e.occurred_at,'+'||json_extract(a.data_json,'$.delayMinutes')||' minutes')
      AND NEW.customer_id=o.customer_id AND NEW.auth_user_id=e.auth_user_id AND NEW.email=e.email AND NEW.consent_revision=e.consent_revision
      AND c.allowed=1 AND c.revision=e.consent_revision AND lower(trim(json_extract(o.customer_snapshot_json,'$.email')))=e.email
      AND COALESCE(owner.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=e.auth_user_id
      AND NEW.name=COALESCE(json_extract(o.customer_snapshot_json,'$.name'),'')
      AND ((json_extract(a.data_json,'$.trigger')='welcome' AND e.kind='permission')
        OR (json_extract(a.data_json,'$.trigger') IN ('paid','winback') AND e.kind='payment' AND e.order_id=o.id)
        OR (json_extract(a.data_json,'$.trigger')='expired' AND e.kind='expiry' AND e.order_id=o.id)));
END;
CREATE TRIGGER commerce_automation_enrollment_update BEFORE UPDATE ON commerce_automation_enrollments BEGIN SELECT RAISE(ABORT,'automation_enrollment_immutable'); END;
CREATE TRIGGER commerce_automation_enrollment_delete BEFORE DELETE ON commerce_automation_enrollments BEGIN SELECT RAISE(ABORT,'automation_enrollment_immutable'); END;

CREATE TABLE commerce_automation_runs (
  id TEXT PRIMARY KEY CHECK(length(id)=37 AND substr(id,1,5)='arun_' AND substr(id,6) NOT GLOB '*[^a-f0-9]*'),
  automation_id TEXT NOT NULL REFERENCES commerce_automations(id),
  rule_revision INTEGER NOT NULL,
  campaign_id TEXT NOT NULL UNIQUE REFERENCES commerce_campaigns(id),
  publication_id TEXT NOT NULL UNIQUE REFERENCES commerce_campaign_publications(id),
  enrollment_ids_json TEXT NOT NULL CHECK(json_valid(enrollment_ids_json) AND json_type(enrollment_ids_json)='array' AND json_array_length(enrollment_ids_json) BETWEEN 1 AND 25),
  state TEXT NOT NULL DEFAULT 'building' CHECK(state IN ('building','ready')),
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at),
  FOREIGN KEY(automation_id,rule_revision) REFERENCES commerce_automation_changes(automation_id,revision)
);
CREATE INDEX commerce_automation_runs_rule ON commerce_automation_runs(automation_id,rule_revision,created_at);
CREATE TABLE commerce_automation_outcomes (
  enrollment_id INTEGER PRIMARY KEY REFERENCES commerce_automation_enrollments(id),
  state TEXT NOT NULL CHECK(state IN ('published','skipped')),
  reason TEXT NOT NULL,
  run_id TEXT REFERENCES commerce_automation_runs(id),
  candidate_id INTEGER UNIQUE REFERENCES commerce_campaign_candidates(id),
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at),
  CHECK((state='published' AND reason='' AND run_id IS NOT NULL AND candidate_id IS NOT NULL)
    OR (state='skipped' AND reason IN ('paused','store_closed','access_removed','preference_off','consent_changed','shop_disabled','order_changed','superseded','audience_changed','frequency','stale') AND run_id IS NULL AND candidate_id IS NULL))
);
CREATE INDEX commerce_automation_outcomes_run ON commerce_automation_outcomes(run_id,enrollment_id);
CREATE TABLE commerce_automation_stops (
  enrollment_id INTEGER PRIMARY KEY REFERENCES commerce_automation_enrollments(id),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 40),
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at)
);

-- The correlated customer history is restricted to this enrollment's customer
-- before aggregation. Its definitions match the customer workspace filters.
CREATE INDEX idx_commerce_orders_customer_history ON orders(seller_id,commerce_environment,commerce_version,customer_id,created_at DESC,id DESC);
CREATE VIEW commerce_automation_audience AS SELECT e.id AS enrollment_id,EXISTS(
  WITH history AS (SELECT o.id,o.created_at,o.customer_snapshot_json,o.shipping_address_json,
    COALESCE((SELECT SUM(c.amount) FROM commerce_payment_captures c WHERE c.order_id=o.id AND c.seller_id=o.seller_id AND c.capture_kind='order_payment'),0) AS paid
    FROM orders o WHERE o.seller_id=a.seller_id AND o.commerce_environment=a.commerce_environment AND o.commerce_version=1 AND o.customer_id=e.customer_id),
  totals AS (SELECT COUNT(*) AS orders,COALESCE(SUM(paid>0),0) AS paid_orders,COALESCE(SUM(paid),0) AS gross,MAX(created_at) AS last_at FROM history),
  current_customer AS (SELECT t.*,COALESCE(json_extract(h.customer_snapshot_json,'$.name'),'') AS name,COALESCE(json_extract(h.customer_snapshot_json,'$.email'),'') AS email,
    COALESCE(json_extract(h.customer_snapshot_json,'$.phone'),'') AS phone,COALESCE(json_extract(h.shipping_address_json,'$.location'),'') AS location
    FROM totals t JOIN history h ON h.id=(SELECT id FROM history ORDER BY created_at DESC,id DESC LIMIT 1))
  SELECT 1 FROM current_customer p WHERE
    (json_extract(a.data_json,'$.audience.q')='' OR instr(lower(e.customer_id||' '||p.name||' '||p.email||' '||p.phone),lower(json_extract(a.data_json,'$.audience.q')))>0)
    AND (json_extract(a.data_json,'$.audience.activity')='all'
      OR (json_extract(a.data_json,'$.audience.activity')='high_value' AND p.gross>=150000)
      OR (json_extract(a.data_json,'$.audience.activity')='one_order' AND p.orders=1)
      OR (json_extract(a.data_json,'$.audience.activity')='repeat' AND p.paid_orders>=2)
      OR (json_extract(a.data_json,'$.audience.activity')='no_paid' AND p.paid_orders=0))
    AND (json_extract(a.data_json,'$.audience.minSpend')='' OR p.gross>=CAST(json_extract(a.data_json,'$.audience.minSpend') AS INTEGER))
    AND (json_extract(a.data_json,'$.audience.minOrders')='' OR p.orders>=CAST(json_extract(a.data_json,'$.audience.minOrders') AS INTEGER))
    AND (json_extract(a.data_json,'$.audience.maxOrders')='' OR p.orders<=CAST(json_extract(a.data_json,'$.audience.maxOrders') AS INTEGER))
    AND (json_extract(a.data_json,'$.audience.lastFrom')='' OR p.last_at>=strftime('%Y-%m-%dT%H:%M:%fZ',json_extract(a.data_json,'$.audience.lastFrom'),'-7 hours'))
    AND (json_extract(a.data_json,'$.audience.lastTo')='' OR p.last_at<strftime('%Y-%m-%dT%H:%M:%fZ',json_extract(a.data_json,'$.audience.lastTo'),'+1 day','-7 hours'))
    AND (json_extract(a.data_json,'$.audience.location')='' OR instr(lower(p.location),lower(json_extract(a.data_json,'$.audience.location')))>0)
    AND (json_extract(a.data_json,'$.audience.tag')='' OR EXISTS(SELECT 1 FROM commerce_customer_profiles profile,json_each(profile.data_json,'$.tags') tag
      WHERE profile.seller_id=a.seller_id AND profile.commerce_environment=a.commerce_environment AND profile.customer_id=e.customer_id AND tag.value=json_extract(a.data_json,'$.audience.tag')))
) AS matches FROM commerce_automation_enrollments e JOIN commerce_automation_changes a ON a.automation_id=e.automation_id AND a.revision=e.rule_revision;

CREATE VIEW commerce_automation_eligibility AS SELECT e.*,a.seller_id,a.commerce_environment,a.actor_id,a.data_json,
  CASE
    WHEN source.sequence IS NULL OR o.id IS NULL OR o.seller_id!=a.seller_id OR o.commerce_environment!=a.commerce_environment OR o.commerce_version!=1
      OR source.seller_id!=a.seller_id OR source.commerce_environment!=a.commerce_environment OR source.auth_user_id IS NOT e.auth_user_id OR source.email IS NOT e.email
      OR source.consent_revision IS NOT e.consent_revision
      OR e.due_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ',source.occurred_at,'+'||json_extract(a.data_json,'$.delayMinutes')||' minutes')
      OR (json_extract(a.data_json,'$.trigger')='welcome' AND (source.kind!='permission' OR source.order_id IS NOT NULL))
      OR (json_extract(a.data_json,'$.trigger') IN ('paid','winback') AND (source.kind!='payment' OR source.order_id IS NOT e.order_id))
      OR (json_extract(a.data_json,'$.trigger')='expired' AND (source.kind!='expiry' OR source.order_id IS NOT e.order_id)) THEN 'invalid'
    WHEN source.kind='permission' AND NOT EXISTS(SELECT 1 FROM commerce_customer_consent_changes c
      WHERE c.auth_user_id=e.auth_user_id AND c.request_key=substr(source.source_key,length(e.auth_user_id)+2)
        AND c.auth_user_id||':'||c.request_key=source.source_key AND c.seller_id=a.seller_id AND c.commerce_environment=a.commerce_environment
        AND c.email=e.email AND c.revision=e.consent_revision AND c.allowed=1 AND c.created_at=source.occurred_at) THEN 'invalid'
    WHEN source.kind='expiry' AND NOT EXISTS(SELECT 1 FROM commerce_order_events receipt WHERE receipt.id=source.source_key
      AND receipt.seller_id=a.seller_id AND receipt.order_id=e.order_id AND receipt.event_type IN ('payment.expired','payment.created')
      AND receipt.created_at=source.occurred_at) THEN 'invalid'
    WHEN source.kind='payment' AND NOT EXISTS(SELECT 1 FROM commerce_payment_captures c WHERE c.id=source.source_key AND c.order_id=o.id
      AND c.seller_id=a.seller_id AND c.commerce_environment=a.commerce_environment AND c.capture_kind='order_payment' AND c.amount=o.total_amount
      AND c.currency='IDR' AND c.verified_at=source.occurred_at) THEN 'invalid'
    WHEN current.state!='active' OR current.revision!=e.rule_revision THEN 'paused'
    WHEN store.status!='active' THEN 'store_closed'
    WHEN NOT EXISTS(SELECT 1 FROM seller_memberships m WHERE m.seller_id=a.seller_id AND m.auth_user_id=a.actor_id AND m.role!='viewer')
      OR COALESCE(owner.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),'')) IS NOT e.auth_user_id
      OR o.customer_id IS NOT e.customer_id OR lower(trim(json_extract(o.customer_snapshot_json,'$.email'))) IS NOT e.email THEN 'access_removed'
    WHEN COALESCE(consent.allowed,0)!=1 THEN 'preference_off'
    WHEN consent.revision!=e.consent_revision THEN 'consent_changed'
    WHEN json_extract(a.data_json,'$.buttonLabel')!='' AND COALESCE(json_extract(store.settings_json,'$.storefront.enabled'),0)!=1 THEN 'shop_disabled'
    WHEN json_extract(a.data_json,'$.trigger')='expired' AND (o.checkout_state!='expired' OR EXISTS(SELECT 1 FROM commerce_payment_captures c WHERE c.order_id=o.id AND c.capture_kind='order_payment')) THEN 'order_changed'
    WHEN json_extract(a.data_json,'$.trigger') IN ('paid','winback') AND o.checkout_state!='paid' THEN 'order_changed'
    WHEN json_extract(a.data_json,'$.trigger')='winback' AND EXISTS(SELECT 1 FROM commerce_marketing_events newer WHERE newer.seller_id=a.seller_id
      AND newer.commerce_environment=a.commerce_environment AND newer.auth_user_id=e.auth_user_id AND newer.kind='payment' AND newer.sequence>e.event_sequence) THEN 'superseded'
    WHEN e.due_at<strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day') THEN 'stale'
    WHEN EXISTS(SELECT 1 FROM commerce_automation_enrollments prior JOIN commerce_automation_outcomes sent ON sent.enrollment_id=prior.id AND sent.state='published'
      WHERE prior.automation_id=e.automation_id AND prior.auth_user_id=e.auth_user_id AND prior.email=e.email AND prior.id!=e.id
        AND (json_extract(a.data_json,'$.trigger')='welcome' OR sent.created_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-'||json_extract(a.data_json,'$.cooldownDays')||' days'))) THEN 'frequency'
    WHEN NOT EXISTS(SELECT 1 FROM commerce_automation_audience audience WHERE audience.enrollment_id=e.id AND audience.matches=1) THEN 'audience_changed'
    ELSE '' END AS reason
  FROM commerce_automation_enrollments e JOIN commerce_automation_changes a ON a.automation_id=e.automation_id AND a.revision=e.rule_revision
  JOIN commerce_automations current ON current.id=e.automation_id JOIN sellers store ON store.id=a.seller_id
  LEFT JOIN commerce_marketing_events source ON source.sequence=e.event_sequence LEFT JOIN orders o ON o.id=e.order_id
  LEFT JOIN commerce_order_owners owner ON owner.order_id=o.id LEFT JOIN commerce_customer_consents consent ON consent.seller_id=a.seller_id
    AND consent.commerce_environment=a.commerce_environment AND consent.auth_user_id=e.auth_user_id AND consent.email=e.email;

CREATE TRIGGER commerce_automation_run_guard BEFORE INSERT ON commerce_automation_runs BEGIN
  SELECT RAISE(ABORT,'automation_run_immutable') WHERE NEW.state!='building' OR EXISTS(SELECT 1 FROM commerce_automation_runs
    WHERE id=NEW.id OR campaign_id=NEW.campaign_id OR publication_id=NEW.publication_id);
  SELECT RAISE(ABORT,'automation_run_invalid') WHERE EXISTS(SELECT 1 FROM json_each(NEW.enrollment_ids_json) WHERE type!='integer' OR value<1)
    OR (SELECT COUNT(DISTINCT value) FROM json_each(NEW.enrollment_ids_json))!=json_array_length(NEW.enrollment_ids_json)
    OR EXISTS(SELECT 1 FROM commerce_automation_outcomes WHERE enrollment_id IN (SELECT value FROM json_each(NEW.enrollment_ids_json)))
    OR EXISTS(SELECT 1 FROM commerce_automation_enrollments WHERE id IN (SELECT value FROM json_each(NEW.enrollment_ids_json)) GROUP BY auth_user_id,email HAVING COUNT(*)>1)
    OR (SELECT COUNT(*) FROM commerce_automation_eligibility e WHERE e.id IN (SELECT value FROM json_each(NEW.enrollment_ids_json))
      AND e.automation_id=NEW.automation_id AND e.rule_revision=NEW.rule_revision AND e.reason='' AND e.due_at<=NEW.created_at)!=json_array_length(NEW.enrollment_ids_json);
  SELECT RAISE(ABORT,'automation_run_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_automations a
    JOIN commerce_campaign_publications p ON p.id=NEW.publication_id AND p.campaign_id=NEW.campaign_id
    WHERE a.id=NEW.automation_id AND a.revision=NEW.rule_revision AND a.state='active'
      AND p.seller_id=a.seller_id AND p.commerce_environment=a.commerce_environment AND p.actor_id=a.actor_id AND p.campaign_revision=1
      AND p.created_at=NEW.created_at AND p.scheduled_at=NEW.created_at
      AND json(p.data_json)=json_object('name',json_extract(a.data_json,'$.name'),'subject',json_extract(a.data_json,'$.subject'),
        'preheader',json_extract(a.data_json,'$.preheader'),'heading',json_extract(a.data_json,'$.heading'),'body',json_extract(a.data_json,'$.body'),
        'buttonLabel',json_extract(a.data_json,'$.buttonLabel'),'audience',json_extract(a.data_json,'$.audience'),'plannedAt',NULL,'archived',json('false')));
END;
CREATE TRIGGER commerce_automation_candidate_guard BEFORE INSERT ON commerce_campaign_candidates
WHEN EXISTS(SELECT 1 FROM commerce_automation_runs WHERE publication_id=NEW.publication_id) BEGIN
  SELECT RAISE(ABORT,'automation_run_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_automation_runs run JOIN commerce_automation_eligibility e
    ON e.id IN (SELECT value FROM json_each(run.enrollment_ids_json)) AND e.automation_id=run.automation_id AND e.rule_revision=run.rule_revision
    WHERE run.publication_id=NEW.publication_id AND run.state='building' AND e.reason='' AND e.due_at<=NEW.created_at
      AND e.customer_id=NEW.customer_id AND e.order_id=NEW.order_id AND e.auth_user_id=NEW.auth_user_id AND e.email=NEW.email
      AND e.name=NEW.name AND e.consent_revision=NEW.consent_revision AND NEW.created_at=run.created_at);
END;
CREATE TRIGGER commerce_automation_outcome_guard BEFORE INSERT ON commerce_automation_outcomes BEGIN
  SELECT RAISE(ABORT,'automation_outcome_immutable') WHERE EXISTS(SELECT 1 FROM commerce_automation_outcomes
    WHERE enrollment_id=NEW.enrollment_id OR (NEW.candidate_id IS NOT NULL AND candidate_id=NEW.candidate_id));
  SELECT RAISE(ABORT,'automation_outcome_invalid') WHERE NEW.state='skipped' AND NOT EXISTS(SELECT 1 FROM commerce_automation_eligibility e
    WHERE e.id=NEW.enrollment_id AND e.reason=NEW.reason AND e.created_at<=NEW.created_at);
  SELECT RAISE(ABORT,'automation_outcome_invalid') WHERE NEW.state='published' AND NOT EXISTS(SELECT 1 FROM commerce_automation_runs run
    JOIN commerce_automation_eligibility e ON e.automation_id=run.automation_id AND e.rule_revision=run.rule_revision
    JOIN commerce_campaign_candidates c ON c.id=NEW.candidate_id AND c.publication_id=run.publication_id
    JOIN commerce_campaign_seals seal ON seal.publication_id=c.publication_id
    WHERE run.id=NEW.run_id AND run.state='building' AND e.id=NEW.enrollment_id AND e.id IN (SELECT value FROM json_each(run.enrollment_ids_json))
      AND e.reason='' AND e.due_at<=NEW.created_at AND NEW.created_at=run.created_at AND c.customer_id=e.customer_id AND c.order_id=e.order_id
      AND c.auth_user_id=e.auth_user_id AND c.email=e.email AND c.name=e.name AND c.consent_revision=e.consent_revision);
END;
CREATE TRIGGER commerce_automation_run_finalize BEFORE UPDATE ON commerce_automation_runs BEGIN
  SELECT RAISE(ABORT,'automation_run_immutable') WHERE OLD.state!='building' OR NEW.state!='ready' OR NEW.id!=OLD.id OR NEW.automation_id!=OLD.automation_id
    OR NEW.rule_revision!=OLD.rule_revision OR NEW.campaign_id!=OLD.campaign_id OR NEW.publication_id!=OLD.publication_id
    OR NEW.enrollment_ids_json!=OLD.enrollment_ids_json OR NEW.created_at!=OLD.created_at;
  SELECT RAISE(ABORT,'automation_run_incomplete') WHERE NOT EXISTS(SELECT 1 FROM commerce_campaign_seals WHERE publication_id=NEW.publication_id
    AND candidate_count=json_array_length(NEW.enrollment_ids_json))
    OR (SELECT COUNT(*) FROM commerce_campaign_candidates c JOIN commerce_jobs j ON j.id='job_campaign_'||c.id
      WHERE c.publication_id=NEW.publication_id AND j.kind='campaign.send')!=json_array_length(NEW.enrollment_ids_json)
    OR (SELECT COUNT(*) FROM commerce_automation_outcomes WHERE run_id=NEW.id AND state='published')!=json_array_length(NEW.enrollment_ids_json)
    OR EXISTS(SELECT 1 FROM json_each(NEW.enrollment_ids_json) selection WHERE NOT EXISTS(SELECT 1 FROM commerce_automation_outcomes
      WHERE enrollment_id=selection.value AND run_id=NEW.id AND state='published'));
END;
CREATE TRIGGER commerce_automation_run_delete BEFORE DELETE ON commerce_automation_runs BEGIN SELECT RAISE(ABORT,'automation_run_immutable'); END;
CREATE TRIGGER commerce_automation_outcome_update BEFORE UPDATE ON commerce_automation_outcomes BEGIN SELECT RAISE(ABORT,'automation_outcome_immutable'); END;
CREATE TRIGGER commerce_automation_outcome_delete BEFORE DELETE ON commerce_automation_outcomes BEGIN SELECT RAISE(ABORT,'automation_outcome_immutable'); END;
CREATE TRIGGER commerce_automation_campaign_guard BEFORE INSERT ON commerce_campaign_changes
WHEN EXISTS(SELECT 1 FROM commerce_automation_runs WHERE campaign_id=NEW.campaign_id) BEGIN SELECT RAISE(ABORT,'automation_generated_campaign'); END;
CREATE TRIGGER commerce_automation_schedule_guard BEFORE INSERT ON commerce_campaign_publication_actions
WHEN NEW.kind!='cancel' AND EXISTS(SELECT 1 FROM commerce_automation_runs WHERE publication_id=NEW.publication_id) BEGIN SELECT RAISE(ABORT,'automation_generated_campaign'); END;

-- Keep the manual campaign columns and receipt contracts intact. Automated
-- candidates add their current rule/source eligibility to the same sender.
DROP VIEW commerce_campaign_delivery_sources;
CREATE VIEW commerce_campaign_delivery_sources AS
  SELECT c.id AS candidate_id,c.publication_id,c.auth_user_id,c.email,c.consent_revision,p.seller_id,p.commerce_environment,
    p.store_name,p.shop_enabled,p.data_json,p.created_at AS publication_created_at,p.send_at,p.cancelled,s.status AS store_status,
    COALESCE(json_extract(s.settings_json,'$.storefront.enabled'),0) AS current_shop_enabled,
    EXISTS(SELECT 1 FROM seller_memberships m WHERE m.seller_id=p.seller_id AND m.auth_user_id=p.actor_id AND m.role!='viewer') AS publisher_access,
    EXISTS(SELECT 1 FROM orders o LEFT JOIN commerce_order_owners owner ON owner.order_id=o.id WHERE o.id=c.order_id
      AND o.seller_id=p.seller_id AND o.commerce_environment=p.commerce_environment AND o.customer_id=c.customer_id
      AND COALESCE(owner.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=c.auth_user_id) AS customer_access,
    COALESCE(consent.allowed,0) AS consent_allowed,COALESCE(consent.revision,0) AS current_consent_revision,
    run.automation_id,done.enrollment_id
  FROM commerce_campaign_candidates c JOIN commerce_campaign_publication_state p ON p.id=c.publication_id JOIN sellers s ON s.id=p.seller_id
  LEFT JOIN commerce_customer_consents consent ON consent.seller_id=p.seller_id AND consent.commerce_environment=p.commerce_environment
    AND consent.auth_user_id=c.auth_user_id AND consent.email=c.email
  LEFT JOIN commerce_automation_runs run ON run.publication_id=p.id
  LEFT JOIN commerce_automation_outcomes done ON done.candidate_id=c.id;

-- This point lookup is separate from the manual permission view so its nested
-- predicates stay below D1's expression-depth limit inside request/start guards.
CREATE VIEW commerce_automation_delivery_sources AS
  SELECT c.id AS candidate_id,c.publication_id,run.automation_id,done.enrollment_id,
    CASE WHEN run.state!='ready' OR done.run_id IS NOT run.id OR e.id IS NULL
      OR e.automation_id IS NOT run.automation_id OR e.rule_revision IS NOT run.rule_revision OR done.state!='published'
      OR c.order_id IS NOT e.order_id OR c.customer_id IS NOT e.customer_id OR c.auth_user_id IS NOT e.auth_user_id
      OR c.email IS NOT e.email OR c.consent_revision IS NOT e.consent_revision THEN 'invalid'
      ELSE COALESCE((SELECT eligibility.reason FROM commerce_automation_eligibility eligibility WHERE eligibility.id=e.id),'invalid') END AS automation_reason
  FROM commerce_campaign_candidates c JOIN commerce_automation_runs run ON run.publication_id=c.publication_id
  LEFT JOIN commerce_automation_outcomes done ON done.candidate_id=c.id LEFT JOIN commerce_automation_enrollments e ON e.id=done.enrollment_id;

CREATE TRIGGER commerce_automation_email_request_guard BEFORE INSERT ON commerce_campaign_email_requests BEGIN
  SELECT RAISE(ABORT,'campaign_email_request_invalid') WHERE EXISTS(SELECT 1 FROM commerce_automation_delivery_sources
    WHERE candidate_id=NEW.candidate_id AND automation_reason!='');
END;
CREATE TRIGGER commerce_automation_email_start_guard BEFORE INSERT ON commerce_campaign_email_starts BEGIN
  SELECT RAISE(ABORT,'campaign_email_start_forbidden') WHERE EXISTS(SELECT 1 FROM commerce_campaign_email_requests x
    JOIN commerce_automation_delivery_sources c ON c.candidate_id=x.candidate_id WHERE x.id=NEW.request_id AND c.automation_reason!='');
END;
CREATE TRIGGER commerce_automation_email_skip AFTER INSERT ON commerce_campaign_email_skips BEGIN
  INSERT INTO commerce_automation_stops(enrollment_id,reason,created_at)
    SELECT c.enrollment_id,COALESCE(NULLIF(c.automation_reason,''),NEW.reason),NEW.created_at FROM commerce_automation_delivery_sources c
    WHERE c.candidate_id=NEW.candidate_id AND c.automation_id IS NOT NULL;
END;
CREATE TRIGGER commerce_automation_stop_guard BEFORE INSERT ON commerce_automation_stops BEGIN
  SELECT RAISE(ABORT,'automation_stop_immutable') WHERE EXISTS(SELECT 1 FROM commerce_automation_stops WHERE enrollment_id=NEW.enrollment_id);
  SELECT RAISE(ABORT,'automation_stop_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_automation_outcomes done
    JOIN commerce_campaign_email_skips skip ON skip.candidate_id=done.candidate_id
    JOIN commerce_automation_delivery_sources c ON c.candidate_id=done.candidate_id
    WHERE done.enrollment_id=NEW.enrollment_id AND done.state='published' AND c.automation_id IS NOT NULL
      AND NEW.reason=COALESCE(NULLIF(c.automation_reason,''),skip.reason) AND NEW.created_at=skip.created_at);
END;
CREATE TRIGGER commerce_automation_stop_update BEFORE UPDATE ON commerce_automation_stops BEGIN SELECT RAISE(ABORT,'automation_stop_immutable'); END;
CREATE TRIGGER commerce_automation_stop_delete BEFORE DELETE ON commerce_automation_stops BEGIN SELECT RAISE(ABORT,'automation_stop_immutable'); END;

-- A failing rule keeps its cursor and outcomes untouched. A short, recorded
-- retry delay lets other rules and stores proceed instead of starving behind it.
CREATE TABLE commerce_automation_processing_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  automation_id TEXT NOT NULL,
  rule_revision INTEGER NOT NULL,
  stage TEXT NOT NULL CHECK(stage IN ('scan','publish')),
  code TEXT NOT NULL CHECK(code IN ('source_invalid','publication_invalid','rate_limited')),
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at),
  retry_after TEXT NOT NULL CHECK(retry_after=strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+5 minutes')),
  CHECK((stage='scan' AND code='source_invalid') OR (stage='publish' AND code IN ('publication_invalid','rate_limited'))),
  FOREIGN KEY(automation_id,rule_revision) REFERENCES commerce_automation_changes(automation_id,revision)
);
CREATE INDEX commerce_automation_processing_issues_rule ON commerce_automation_processing_issues(automation_id,rule_revision,stage,id);
CREATE VIEW commerce_automation_processing_status AS
  SELECT issue.* FROM commerce_automation_processing_issues issue
  WHERE issue.id=(SELECT MAX(latest.id) FROM commerce_automation_processing_issues latest
    WHERE latest.automation_id=issue.automation_id AND latest.rule_revision=issue.rule_revision AND latest.stage=issue.stage)
    AND NOT EXISTS(SELECT 1 FROM commerce_automation_scans s WHERE issue.stage='scan' AND s.automation_id=issue.automation_id
      AND s.rule_revision=issue.rule_revision AND s.created_at>=issue.created_at)
    AND NOT EXISTS(SELECT 1 FROM commerce_automation_runs run WHERE issue.stage='publish' AND run.automation_id=issue.automation_id
      AND run.rule_revision=issue.rule_revision AND run.state='ready' AND run.created_at>=issue.created_at);
CREATE TRIGGER commerce_automation_processing_issue_guard BEFORE INSERT ON commerce_automation_processing_issues BEGIN
  SELECT RAISE(ABORT,'automation_processing_issue_immutable') WHERE EXISTS(SELECT 1 FROM commerce_automation_processing_issues WHERE id=NEW.id);
  SELECT RAISE(ABORT,'automation_processing_issue_invalid') WHERE NOT EXISTS(SELECT 1 FROM commerce_automations a
    WHERE a.id=NEW.automation_id AND a.revision=NEW.rule_revision AND a.state='active' AND NEW.created_at>=a.updated_at
      AND NEW.created_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','+5 seconds'));
END;
CREATE TRIGGER commerce_automation_processing_issue_update BEFORE UPDATE ON commerce_automation_processing_issues BEGIN SELECT RAISE(ABORT,'automation_processing_issue_immutable'); END;
CREATE TRIGGER commerce_automation_processing_issue_delete BEFORE DELETE ON commerce_automation_processing_issues BEGIN SELECT RAISE(ABORT,'automation_processing_issue_immutable'); END;

-- Correlate each evidence lookup to its request. Joining the UNION evidence
-- views here made SQLite materialize unrelated stores' delivery histories.
DROP VIEW commerce_campaign_delivery_status;
CREATE VIEW commerce_campaign_delivery_status AS
  SELECT c.id AS candidate_id,c.publication_id,j.id AS job_id,j.state AS job_state,x.id AS request_id,skip.reason AS skip_reason,
    CASE
      WHEN EXISTS(SELECT 1 FROM commerce_campaign_email_events e WHERE e.request_id=x.id AND e.kind='complained')
        OR EXISTS(SELECT 1 FROM commerce_campaign_email_lookups l JOIN commerce_campaign_email_lookup_results r ON r.lookup_key=l.lookup_key WHERE l.request_id=x.id AND r.outcome='matched' AND r.kind='complained') THEN 'complained'
      WHEN EXISTS(SELECT 1 FROM commerce_campaign_email_events e WHERE e.request_id=x.id AND e.kind='bounced')
        OR EXISTS(SELECT 1 FROM commerce_campaign_email_lookups l JOIN commerce_campaign_email_lookup_results r ON r.lookup_key=l.lookup_key WHERE l.request_id=x.id AND r.outcome='matched' AND r.kind='bounced') THEN 'bounced'
      WHEN EXISTS(SELECT 1 FROM commerce_campaign_email_events e WHERE e.request_id=x.id AND e.kind='suppressed')
        OR EXISTS(SELECT 1 FROM commerce_campaign_email_lookups l JOIN commerce_campaign_email_lookup_results r ON r.lookup_key=l.lookup_key WHERE l.request_id=x.id AND r.outcome='matched' AND r.kind='suppressed') THEN 'suppressed'
      WHEN EXISTS(SELECT 1 FROM commerce_campaign_email_events e WHERE e.request_id=x.id AND e.kind='failed')
        OR EXISTS(SELECT 1 FROM commerce_campaign_email_lookups l JOIN commerce_campaign_email_lookup_results r ON r.lookup_key=l.lookup_key WHERE l.request_id=x.id AND r.outcome='matched' AND r.kind='failed') THEN 'failed'
      WHEN EXISTS(SELECT 1 FROM commerce_campaign_email_events e WHERE e.request_id=x.id AND e.kind='delivered')
        OR EXISTS(SELECT 1 FROM commerce_campaign_email_lookups l JOIN commerce_campaign_email_lookup_results r ON r.lookup_key=l.lookup_key WHERE l.request_id=x.id AND r.outcome='matched' AND r.kind='delivered') THEN 'delivered'
      WHEN EXISTS(SELECT 1 FROM commerce_campaign_email_events e WHERE e.request_id=x.id AND e.kind='delayed')
        OR EXISTS(SELECT 1 FROM commerce_campaign_email_lookups l JOIN commerce_campaign_email_lookup_results r ON r.lookup_key=l.lookup_key WHERE l.request_id=x.id AND r.outcome='matched' AND r.kind='delayed') THEN 'delayed'
      WHEN COALESCE(b.request_id,looked_up.request_id) IS NOT NULL THEN 'submitted'
      WHEN skip.uncertain=1 OR j.state='uncertain' THEN 'uncertain'
      WHEN skip.uncertain=0 AND skip.reason='cancelled' THEN 'cancelled'
      WHEN skip.uncertain=0 THEN 'skipped'
      WHEN json_extract(j.result_json,'$.cancelled')=1 AND j.attempts=0 THEN 'cancelled'
      WHEN j.state='dead' THEN 'needs_review' WHEN j.state='running' THEN 'sending' WHEN j.state='retry' THEN 'retry'
      ELSE 'queued' END AS delivery_state,
    CASE WHEN j.state IN ('uncertain','dead') AND COALESCE(json_extract(j.result_json,'$.cancelled'),0)!=1 OR (skip.uncertain=1 AND resolution.request_id IS NULL) THEN 1 ELSE 0 END AS needs_review,
    COALESCE(b.created_at,looked_up.created_at) AS submitted_at,
    (SELECT MIN(occurred_at) FROM commerce_campaign_email_events e WHERE e.request_id=x.id AND e.kind='delivered') AS delivered_at,
    (EXISTS(SELECT 1 FROM commerce_campaign_email_events e WHERE e.request_id=x.id AND e.kind='delivered')
      OR EXISTS(SELECT 1 FROM commerce_campaign_email_lookups l JOIN commerce_campaign_email_lookup_results r ON r.lookup_key=l.lookup_key WHERE l.request_id=x.id AND r.outcome='matched' AND r.kind='delivered')) AS delivered_confirmed,
    (SELECT MAX(r.observed_at) FROM commerce_campaign_email_lookups l JOIN commerce_campaign_email_lookup_results r ON r.lookup_key=l.lookup_key WHERE l.request_id=x.id) AS checked_at,
    resolution.created_at AS resolved_at
  FROM commerce_campaign_candidates c JOIN commerce_jobs j ON j.id='job_campaign_'||c.id
  LEFT JOIN commerce_campaign_email_requests x ON x.candidate_id=c.id
  LEFT JOIN commerce_campaign_email_provider_bindings b ON b.request_id=x.id
  LEFT JOIN commerce_campaign_email_lookup_bindings looked_up ON looked_up.request_id=x.id
  LEFT JOIN commerce_campaign_email_skips skip ON skip.candidate_id=c.id
  LEFT JOIN commerce_campaign_email_resolutions resolution ON resolution.request_id=x.id;

CREATE VIEW commerce_automation_activity AS
  SELECT e.id,e.automation_id,e.rule_revision,e.customer_id,e.order_id,e.name,e.email,e.consent_revision,e.due_at,e.created_at,
    json_extract(e.data_json,'$.trigger') AS trigger_kind,source.occurred_at AS event_at,done.state AS outcome,run.campaign_id,run.publication_id,
    COALESCE(stop.reason,NULLIF(done.reason,''),NULLIF(json_extract(d.value,'$.skip_reason'),''),CASE WHEN json_extract(d.value,'$.submitted_at') IS NULL THEN NULLIF(e.reason,'') END,'') AS reason,
    CASE WHEN done.state='skipped' THEN 'skipped'
      WHEN done.state='published' THEN CASE WHEN json_extract(d.value,'$.candidate_id') IS NULL OR run.state!='ready' THEN 'needs_review'
        WHEN json_extract(d.value,'$.delivery_state') IN ('queued','retry') AND e.reason!='' THEN CASE WHEN e.reason='invalid' THEN 'needs_review' ELSE 'stopping' END
        ELSE json_extract(d.value,'$.delivery_state') END
      WHEN e.reason='invalid' THEN 'needs_review' WHEN e.reason!='' THEN 'stopping'
      WHEN e.due_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 'waiting' ELSE 'due' END AS state,
    CASE WHEN json_extract(d.value,'$.needs_review')=1 OR (done.state='published' AND (json_extract(d.value,'$.candidate_id') IS NULL OR run.state!='ready'))
      OR (e.reason='invalid' AND json_extract(d.value,'$.submitted_at') IS NULL AND done.state IS NOT 'skipped') THEN 1 ELSE 0 END AS needs_review,
    json_extract(d.value,'$.submitted_at') AS submitted_at,json_extract(d.value,'$.delivered_at') AS delivered_at,COALESCE(json_extract(d.value,'$.delivered_confirmed'),0) AS delivered_confirmed,
    COALESCE(json_extract(d.value,'$.checked_at'),done.created_at,e.created_at) AS observed_at
  FROM commerce_automation_eligibility e LEFT JOIN commerce_marketing_events source ON source.sequence=e.event_sequence
  LEFT JOIN commerce_automation_outcomes done ON done.enrollment_id=e.id
  LEFT JOIN commerce_automation_runs run ON run.id=done.run_id
  LEFT JOIN json_each((SELECT json_array(json_object('candidate_id',delivery.candidate_id,'delivery_state',delivery.delivery_state,'skip_reason',delivery.skip_reason,
    'needs_review',delivery.needs_review,'submitted_at',delivery.submitted_at,'delivered_at',delivery.delivered_at,'delivered_confirmed',delivery.delivered_confirmed,'checked_at',delivery.checked_at))
    FROM commerce_campaign_delivery_status delivery WHERE delivery.candidate_id=done.candidate_id)) d ON 1
  LEFT JOIN commerce_automation_stops stop ON stop.enrollment_id=e.id;
