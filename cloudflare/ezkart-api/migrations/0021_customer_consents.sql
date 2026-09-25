CREATE TABLE commerce_customer_consents (
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  auth_user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  allowed INTEGER NOT NULL CHECK(allowed IN (0,1)),
  policy_version TEXT NOT NULL,
  statement TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(seller_id,commerce_environment,auth_user_id,email)
);
CREATE INDEX commerce_customer_consent_buyer ON commerce_customer_consents(auth_user_id,commerce_environment,seller_id,email);
CREATE TABLE commerce_customer_consent_changes (
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  auth_user_id TEXT NOT NULL,
  email TEXT NOT NULL CHECK(length(email) BETWEEN 3 AND 160 AND email=lower(trim(email))),
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  expected_revision INTEGER NOT NULL CHECK(expected_revision>=0),
  revision INTEGER NOT NULL CHECK(revision=expected_revision+1 AND revision<=9007199254740991),
  allowed INTEGER NOT NULL CHECK(allowed IN (0,1)),
  policy_version TEXT NOT NULL CHECK(policy_version='email-promotions-v1'),
  statement TEXT NOT NULL CHECK(length(statement) BETWEEN 1 AND 1000),
  source TEXT NOT NULL CHECK(source='buyer_preferences'),
  created_at TEXT NOT NULL,
  PRIMARY KEY(auth_user_id,commerce_environment,request_key),
  UNIQUE(seller_id,commerce_environment,auth_user_id,email,revision)
);
CREATE TRIGGER commerce_customer_consent_change_guard BEFORE INSERT ON commerce_customer_consent_changes BEGIN
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
CREATE TRIGGER commerce_customer_consent_change_apply AFTER INSERT ON commerce_customer_consent_changes BEGIN
  INSERT INTO commerce_customer_consents(seller_id,commerce_environment,auth_user_id,email,revision,allowed,policy_version,statement,updated_at)
    VALUES(NEW.seller_id,NEW.commerce_environment,NEW.auth_user_id,NEW.email,NEW.revision,NEW.allowed,NEW.policy_version,NEW.statement,NEW.created_at)
    ON CONFLICT(seller_id,commerce_environment,auth_user_id,email) DO UPDATE SET revision=excluded.revision,allowed=excluded.allowed,
      policy_version=excluded.policy_version,statement=excluded.statement,updated_at=excluded.updated_at;
END;
CREATE TRIGGER commerce_customer_consent_insert BEFORE INSERT ON commerce_customer_consents BEGIN
  SELECT RAISE(ABORT,'consent_receipt_required') WHERE NOT EXISTS(SELECT 1 FROM commerce_customer_consent_changes
    WHERE seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment AND auth_user_id=NEW.auth_user_id AND email=NEW.email
      AND revision=NEW.revision AND allowed=NEW.allowed AND policy_version=NEW.policy_version AND statement=NEW.statement AND created_at=NEW.updated_at);
END;
CREATE TRIGGER commerce_customer_consent_update BEFORE UPDATE ON commerce_customer_consents BEGIN
  SELECT RAISE(ABORT,'consent_receipt_required') WHERE NEW.seller_id!=OLD.seller_id OR NEW.commerce_environment!=OLD.commerce_environment
    OR NEW.auth_user_id!=OLD.auth_user_id OR NEW.email!=OLD.email OR NEW.revision!=OLD.revision+1 OR NOT EXISTS(SELECT 1 FROM commerce_customer_consent_changes
      WHERE seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment AND auth_user_id=NEW.auth_user_id AND email=NEW.email
        AND revision=NEW.revision AND allowed=NEW.allowed AND policy_version=NEW.policy_version AND statement=NEW.statement AND created_at=NEW.updated_at);
END;
CREATE TRIGGER commerce_customer_consent_delete BEFORE DELETE ON commerce_customer_consents BEGIN SELECT RAISE(ABORT,'consent_receipt_required'); END;
CREATE TRIGGER commerce_customer_consent_change_update BEFORE UPDATE ON commerce_customer_consent_changes BEGIN SELECT RAISE(ABORT,'consent_history_immutable'); END;
CREATE TRIGGER commerce_customer_consent_change_delete BEFORE DELETE ON commerce_customer_consent_changes BEGIN SELECT RAISE(ABORT,'consent_history_immutable'); END;
