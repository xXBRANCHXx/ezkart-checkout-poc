CREATE TABLE commerce_unsubscribe_tokens (
  token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64 AND token_hash NOT GLOB '*[^a-f0-9]*'),
  seller_id TEXT NOT NULL,
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  auth_user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  reference TEXT NOT NULL CHECK(length(reference) BETWEEN 3 AND 160),
  consent_revision INTEGER NOT NULL CHECK(typeof(consent_revision)='integer' AND consent_revision BETWEEN 1 AND 9007199254740991),
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at),
  FOREIGN KEY(seller_id,commerce_environment,auth_user_id,email) REFERENCES commerce_customer_consents(seller_id,commerce_environment,auth_user_id,email),
  UNIQUE(seller_id,commerce_environment,reference)
);
CREATE INDEX commerce_unsubscribe_tokens_recipient ON commerce_unsubscribe_tokens(seller_id,commerce_environment,auth_user_id,email);
CREATE TRIGGER commerce_unsubscribe_token_guard BEFORE INSERT ON commerce_unsubscribe_tokens BEGIN
  SELECT RAISE(ABORT,'unsubscribe_token_immutable') WHERE EXISTS(SELECT 1 FROM commerce_unsubscribe_tokens
    WHERE token_hash=NEW.token_hash OR (seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment AND reference=NEW.reference));
  SELECT RAISE(ABORT,'unsubscribe_permission_required') WHERE NOT EXISTS(SELECT 1 FROM commerce_customer_consents c JOIN sellers s ON s.id=c.seller_id
    WHERE c.seller_id=NEW.seller_id AND c.commerce_environment=NEW.commerce_environment AND c.auth_user_id=NEW.auth_user_id AND c.email=NEW.email
      AND c.allowed=1 AND c.revision=NEW.consent_revision AND s.status='active');
END;
CREATE TRIGGER commerce_unsubscribe_token_update BEFORE UPDATE ON commerce_unsubscribe_tokens BEGIN SELECT RAISE(ABORT,'unsubscribe_token_immutable'); END;
CREATE TRIGGER commerce_unsubscribe_token_delete BEFORE DELETE ON commerce_unsubscribe_tokens BEGIN SELECT RAISE(ABORT,'unsubscribe_token_immutable'); END;

CREATE TABLE commerce_unsubscribe_changes (
  id TEXT PRIMARY KEY CHECK(length(id)=36 AND substr(id,1,4)='cuw_' AND substr(id,5) NOT GLOB '*[^a-f0-9]*'),
  token_hash TEXT NOT NULL REFERENCES commerce_unsubscribe_tokens(token_hash),
  seller_id TEXT NOT NULL,
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  auth_user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  expected_revision INTEGER NOT NULL CHECK(typeof(expected_revision)='integer' AND expected_revision BETWEEN 1 AND 9007199254740990),
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision=expected_revision+1),
  policy_version TEXT NOT NULL DEFAULT 'email-promotions-v1' CHECK(policy_version='email-promotions-v1'),
  statement TEXT NOT NULL CHECK(length(statement) BETWEEN 1 AND 1000),
  source TEXT NOT NULL DEFAULT 'email_unsubscribe' CHECK(source='email_unsubscribe'),
  created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at),
  FOREIGN KEY(seller_id,commerce_environment,auth_user_id,email) REFERENCES commerce_customer_consents(seller_id,commerce_environment,auth_user_id,email),
  UNIQUE(seller_id,commerce_environment,auth_user_id,email,revision)
);
CREATE TRIGGER commerce_unsubscribe_change_guard BEFORE INSERT ON commerce_unsubscribe_changes BEGIN
  SELECT RAISE(ABORT,'unsubscribe_change_immutable') WHERE EXISTS(SELECT 1 FROM commerce_unsubscribe_changes WHERE id=NEW.id);
  SELECT RAISE(ABORT,'unsubscribe_token_required') WHERE NOT EXISTS(SELECT 1 FROM commerce_unsubscribe_tokens t
    WHERE t.token_hash=NEW.token_hash AND t.seller_id=NEW.seller_id AND t.commerce_environment=NEW.commerce_environment
      AND t.auth_user_id=NEW.auth_user_id AND t.email=NEW.email);
  SELECT RAISE(ABORT,'consent_unsubscribe_conflict') WHERE NOT EXISTS(SELECT 1 FROM commerce_customer_consents c
    WHERE c.seller_id=NEW.seller_id AND c.commerce_environment=NEW.commerce_environment AND c.auth_user_id=NEW.auth_user_id AND c.email=NEW.email
      AND c.allowed=1 AND c.revision=NEW.expected_revision);
  SELECT RAISE(ABORT,'unsubscribe_statement_invalid') WHERE NEW.statement IS NOT
    (SELECT 'I withdraw permission for promotional emails from '||name||' at '||NEW.email||'. Order and delivery updates are unaffected.' FROM sellers WHERE id=NEW.seller_id);
END;
CREATE TRIGGER commerce_unsubscribe_change_apply AFTER INSERT ON commerce_unsubscribe_changes BEGIN
  UPDATE commerce_customer_consents SET revision=NEW.revision,allowed=0,policy_version=NEW.policy_version,statement=NEW.statement,updated_at=NEW.created_at
    WHERE seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment AND auth_user_id=NEW.auth_user_id AND email=NEW.email;
END;
CREATE TRIGGER commerce_unsubscribe_change_update BEFORE UPDATE ON commerce_unsubscribe_changes BEGIN SELECT RAISE(ABORT,'unsubscribe_change_immutable'); END;
CREATE TRIGGER commerce_unsubscribe_change_delete BEFORE DELETE ON commerce_unsubscribe_changes BEGIN SELECT RAISE(ABORT,'unsubscribe_change_immutable'); END;

CREATE VIEW commerce_customer_consent_history AS
  SELECT seller_id,commerce_environment,auth_user_id,email,expected_revision,revision,allowed,policy_version,statement,source,created_at
    FROM commerce_customer_consent_changes
  UNION ALL
  SELECT seller_id,commerce_environment,auth_user_id,email,expected_revision,revision,0 AS allowed,policy_version,statement,source,created_at
    FROM commerce_unsubscribe_changes;

DROP TRIGGER commerce_customer_consent_change_guard;
CREATE TRIGGER commerce_customer_consent_change_guard BEFORE INSERT ON commerce_customer_consent_changes BEGIN
  SELECT RAISE(ABORT,'consent_history_immutable') WHERE EXISTS(SELECT 1 FROM commerce_customer_consent_changes
    WHERE auth_user_id=NEW.auth_user_id AND commerce_environment=NEW.commerce_environment AND request_key=NEW.request_key);
  SELECT RAISE(ABORT,'consent_owner_required') WHERE NOT EXISTS (
    SELECT 1 FROM orders o LEFT JOIN commerce_order_owners a ON a.order_id=o.id
    WHERE o.seller_id=NEW.seller_id AND o.commerce_environment=NEW.commerce_environment AND o.commerce_version=1
      AND COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=NEW.auth_user_id
  ) AND (NEW.allowed=1 OR NOT EXISTS(SELECT 1 FROM commerce_customer_consents WHERE seller_id=NEW.seller_id
    AND commerce_environment=NEW.commerce_environment AND auth_user_id=NEW.auth_user_id AND email=NEW.email));
  SELECT RAISE(ABORT,'consent_store_inactive') WHERE NEW.allowed=1 AND NOT EXISTS(SELECT 1 FROM sellers WHERE id=NEW.seller_id AND status='active');
  SELECT RAISE(ABORT,'consent_revision_conflict') WHERE NEW.expected_revision!=COALESCE((SELECT revision FROM commerce_customer_consents
    WHERE seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment AND auth_user_id=NEW.auth_user_id AND email=NEW.email),0);
END;
DROP TRIGGER commerce_customer_consent_insert;
CREATE TRIGGER commerce_customer_consent_insert BEFORE INSERT ON commerce_customer_consents BEGIN
  SELECT RAISE(ABORT,'consent_receipt_required') WHERE NEW.revision!=1 OR EXISTS(SELECT 1 FROM commerce_customer_consents
    WHERE seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment AND auth_user_id=NEW.auth_user_id AND email=NEW.email)
    OR NOT EXISTS(SELECT 1 FROM commerce_customer_consent_history c
      WHERE c.seller_id=NEW.seller_id AND c.commerce_environment=NEW.commerce_environment AND c.auth_user_id=NEW.auth_user_id AND c.email=NEW.email
        AND c.revision=NEW.revision AND c.allowed=NEW.allowed AND c.policy_version=NEW.policy_version AND c.statement=NEW.statement AND c.created_at=NEW.updated_at);
END;
DROP TRIGGER commerce_customer_consent_update;
CREATE TRIGGER commerce_customer_consent_update BEFORE UPDATE ON commerce_customer_consents BEGIN
  SELECT RAISE(ABORT,'consent_receipt_required') WHERE NEW.seller_id!=OLD.seller_id OR NEW.commerce_environment!=OLD.commerce_environment
    OR NEW.auth_user_id!=OLD.auth_user_id OR NEW.email!=OLD.email OR NEW.revision!=OLD.revision+1 OR NOT EXISTS(SELECT 1 FROM commerce_customer_consent_history c
      WHERE c.seller_id=NEW.seller_id AND c.commerce_environment=NEW.commerce_environment AND c.auth_user_id=NEW.auth_user_id AND c.email=NEW.email
        AND c.expected_revision=OLD.revision AND c.revision=NEW.revision AND c.allowed=NEW.allowed AND c.policy_version=NEW.policy_version AND c.statement=NEW.statement AND c.created_at=NEW.updated_at);
END;
DROP TRIGGER commerce_customer_consent_change_apply;
CREATE TRIGGER commerce_customer_consent_change_apply AFTER INSERT ON commerce_customer_consent_changes BEGIN
  UPDATE commerce_customer_consents SET revision=NEW.revision,allowed=NEW.allowed,policy_version=NEW.policy_version,statement=NEW.statement,updated_at=NEW.created_at
    WHERE seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment AND auth_user_id=NEW.auth_user_id AND email=NEW.email;
  INSERT INTO commerce_customer_consents(seller_id,commerce_environment,auth_user_id,email,revision,allowed,policy_version,statement,updated_at)
    SELECT NEW.seller_id,NEW.commerce_environment,NEW.auth_user_id,NEW.email,NEW.revision,NEW.allowed,NEW.policy_version,NEW.statement,NEW.created_at
    WHERE NOT EXISTS(SELECT 1 FROM commerce_customer_consents WHERE seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment AND auth_user_id=NEW.auth_user_id AND email=NEW.email);
END;
