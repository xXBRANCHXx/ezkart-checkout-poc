-- Declarations and bank destinations are immutable versioned records.
CREATE TABLE seller_onboarding_profiles (
 seller_id TEXT NOT NULL REFERENCES sellers(id), revision INTEGER NOT NULL CHECK(revision>0),
 request_key TEXT NOT NULL, request_hash TEXT NOT NULL, owner_auth_id TEXT NOT NULL,
 declared_age INTEGER NOT NULL CHECK(declared_age BETWEEN 18 AND 120), age_as_of_date TEXT NOT NULL, legal_name TEXT NOT NULL, declared_birth_date TEXT NOT NULL, verified_email TEXT NOT NULL, phone TEXT NOT NULL,
 confirmed_shipping_revision INTEGER, proof_expires_at TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(seller_id,revision), UNIQUE(seller_id,request_key)
);
CREATE TABLE seller_onboarding_banks (
 seller_id TEXT NOT NULL REFERENCES sellers(id), revision INTEGER NOT NULL CHECK(revision>0),
 request_key TEXT NOT NULL, request_hash TEXT NOT NULL, owner_auth_id TEXT NOT NULL,
 bank_code TEXT NOT NULL, account_number TEXT NOT NULL, channel TEXT NOT NULL CHECK(channel IN ('BI_FAST','ONLINE')),
 proof_expires_at TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(seller_id,revision), UNIQUE(seller_id,request_key)
);
CREATE TABLE seller_onboarding_policy (
 id INTEGER PRIMARY KEY CHECK(id=1), minimum_age INTEGER CHECK(minimum_age BETWEEN 1 AND 100), policy_version TEXT NOT NULL
);
INSERT INTO seller_onboarding_policy VALUES(1,18,'owner-18-plus-2026-09-28');
CREATE VIEW seller_onboarding_current AS
 SELECT p.* FROM seller_onboarding_profiles p WHERE p.revision=(SELECT MAX(x.revision) FROM seller_onboarding_profiles x WHERE x.seller_id=p.seller_id);
CREATE VIEW seller_onboarding_current_bank AS
 SELECT b.* FROM seller_onboarding_banks b WHERE b.revision=(SELECT MAX(x.revision) FROM seller_onboarding_banks x WHERE x.seller_id=b.seller_id);
CREATE VIEW seller_onboarding_ready AS
 SELECT p.seller_id,p.owner_auth_id,p.revision,b.revision AS bank_revision FROM seller_onboarding_current p
 JOIN sellers s ON s.id=p.seller_id AND s.status='active'
 JOIN app_users u ON u.auth_user_id=p.owner_auth_id AND lower(u.email)=p.verified_email
 JOIN seller_memberships m ON m.seller_id=p.seller_id AND m.auth_user_id=p.owner_auth_id AND m.role='owner'
 JOIN seller_onboarding_current_bank b ON b.seller_id=p.seller_id AND b.owner_auth_id=p.owner_auth_id
 JOIN seller_shipping_settings h ON h.seller_id=p.seller_id AND h.revision=p.confirmed_shipping_revision
 JOIN seller_onboarding_policy policy ON policy.id=1 AND policy.minimum_age IS NOT NULL
 WHERE (CAST(strftime('%Y','now','+7 hours') AS INTEGER)-CAST(substr(p.declared_birth_date,1,4) AS INTEGER)-(strftime('%m-%d','now','+7 hours')<substr(p.declared_birth_date,6,5)))>=policy.minimum_age
 AND EXISTS(SELECT 1 FROM json_each(h.configuration_json,'$.addresses') a WHERE json_extract(a.value,'$.id')=json_extract(h.configuration_json,'$.pickupAddressId') AND json_type(a.value,'$.coordinate.latitude') IN ('real','integer') AND json_type(a.value,'$.coordinate.longitude') IN ('real','integer'))
 AND EXISTS(SELECT 1 FROM json_each(h.configuration_json,'$.addresses') a WHERE json_extract(a.value,'$.id')=json_extract(h.configuration_json,'$.returnAddressId') AND json_type(a.value,'$.coordinate.latitude') IN ('real','integer') AND json_type(a.value,'$.coordinate.longitude') IN ('real','integer'));
CREATE TRIGGER onboarding_profile_guard BEFORE INSERT ON seller_onboarding_profiles BEGIN
 SELECT RAISE(ABORT,'onboarding_owner_required') WHERE NOT EXISTS(SELECT 1 FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id WHERE m.seller_id=NEW.seller_id AND m.auth_user_id=NEW.owner_auth_id AND m.role='owner' AND s.status='active');
 SELECT RAISE(ABORT,'onboarding_revision_conflict') WHERE NEW.revision!=COALESCE((SELECT MAX(revision) FROM seller_onboarding_profiles WHERE seller_id=NEW.seller_id),0)+1;
 SELECT RAISE(ABORT,'onboarding_proof_expired') WHERE NEW.proof_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NEW.proof_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','+630 seconds');
 SELECT RAISE(ABORT,'onboarding_declared_age_invalid') WHERE NEW.age_as_of_date!=date('now','+7 hours') OR NEW.declared_age!=(CAST(strftime('%Y','now','+7 hours') AS INTEGER)-CAST(substr(NEW.declared_birth_date,1,4) AS INTEGER)-(strftime('%m-%d','now','+7 hours')<substr(NEW.declared_birth_date,6,5)));
 SELECT RAISE(ABORT,'onboarding_shipping_changed') WHERE NEW.confirmed_shipping_revision IS NOT NULL AND NOT EXISTS(SELECT 1 FROM seller_shipping_settings WHERE seller_id=NEW.seller_id AND revision=NEW.confirmed_shipping_revision);
END;
CREATE TRIGGER onboarding_bank_guard BEFORE INSERT ON seller_onboarding_banks BEGIN
 SELECT RAISE(ABORT,'onboarding_owner_required') WHERE NOT EXISTS(SELECT 1 FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id WHERE m.seller_id=NEW.seller_id AND m.auth_user_id=NEW.owner_auth_id AND m.role='owner' AND s.status='active');
 SELECT RAISE(ABORT,'onboarding_revision_conflict') WHERE NEW.revision!=COALESCE((SELECT MAX(revision) FROM seller_onboarding_banks WHERE seller_id=NEW.seller_id),0)+1;
 SELECT RAISE(ABORT,'onboarding_proof_expired') WHERE NEW.proof_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NEW.proof_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','+630 seconds');
END;
CREATE TRIGGER onboarding_profiles_no_update BEFORE UPDATE ON seller_onboarding_profiles BEGIN SELECT RAISE(ABORT,'onboarding_immutable'); END;
CREATE TRIGGER onboarding_profiles_no_delete BEFORE DELETE ON seller_onboarding_profiles BEGIN SELECT RAISE(ABORT,'onboarding_immutable'); END;
CREATE TRIGGER onboarding_banks_no_update BEFORE UPDATE ON seller_onboarding_banks BEGIN SELECT RAISE(ABORT,'onboarding_immutable'); END;
CREATE TRIGGER onboarding_banks_no_delete BEFORE DELETE ON seller_onboarding_banks BEGIN SELECT RAISE(ABORT,'onboarding_immutable'); END;
ALTER TABLE commerce_withdrawals ADD COLUMN bank_revision INTEGER;
CREATE TRIGGER onboarding_order_gate BEFORE INSERT ON orders WHEN NEW.commerce_version=1 AND NEW.commerce_environment='production' BEGIN
 SELECT RAISE(ABORT,'seller_onboarding_required') WHERE NOT EXISTS(SELECT 1 FROM seller_onboarding_ready WHERE seller_id=NEW.seller_id);
END;
CREATE TRIGGER onboarding_wallet_gate BEFORE INSERT ON commerce_wallet_enrollments WHEN NEW.commerce_environment='production' BEGIN
 SELECT RAISE(ABORT,'seller_onboarding_required') WHERE NOT EXISTS(SELECT 1 FROM seller_onboarding_ready WHERE seller_id=NEW.seller_id AND owner_auth_id=NEW.owner_auth_id);
END;
CREATE TRIGGER onboarding_withdrawal_gate BEFORE INSERT ON commerce_withdrawals WHEN NEW.commerce_environment='production' BEGIN
 SELECT RAISE(ABORT,'seller_onboarding_required') WHERE NOT EXISTS(SELECT 1 FROM seller_onboarding_ready WHERE seller_id=NEW.seller_id AND owner_auth_id=NEW.owner_auth_id);
 SELECT RAISE(ABORT,'onboarding_bank_changed') WHERE NOT EXISTS(SELECT 1 FROM seller_onboarding_current_bank WHERE seller_id=NEW.seller_id AND revision=NEW.bank_revision AND bank_code=NEW.bank_code AND account_number=NEW.bank_account AND channel=NEW.channel AND owner_auth_id=NEW.owner_auth_id);
END;
CREATE TRIGGER onboarding_payment_gate BEFORE INSERT ON commerce_withdrawal_payment_grants WHEN NEW.commerce_environment='production' BEGIN
 SELECT RAISE(ABORT,'seller_onboarding_required') WHERE NOT EXISTS(SELECT 1 FROM commerce_withdrawals w JOIN seller_onboarding_ready r ON r.seller_id=w.seller_id AND r.owner_auth_id=w.owner_auth_id WHERE w.id=NEW.withdrawal_id);
 SELECT RAISE(ABORT,'onboarding_bank_changed') WHERE NOT EXISTS(SELECT 1 FROM commerce_withdrawals w JOIN seller_onboarding_current_bank b ON b.seller_id=w.seller_id AND b.revision=w.bank_revision WHERE w.id=NEW.withdrawal_id);
END;

CREATE TRIGGER onboarding_wallet_binding_gate BEFORE INSERT ON commerce_wallet_provider_bindings BEGIN
 SELECT RAISE(ABORT,'seller_onboarding_required') WHERE EXISTS(SELECT 1 FROM commerce_wallet_enrollments e WHERE e.id=NEW.enrollment_id AND e.commerce_environment='production' AND NOT EXISTS(SELECT 1 FROM seller_onboarding_ready r WHERE r.seller_id=e.seller_id AND r.owner_auth_id=e.owner_auth_id));
END;
CREATE TRIGGER onboarding_snap_gate BEFORE INSERT ON commerce_snap_payment_bindings WHEN NEW.commerce_environment='production' BEGIN
 SELECT RAISE(ABORT,'seller_onboarding_required') WHERE NOT EXISTS(SELECT 1 FROM seller_onboarding_ready WHERE seller_id=NEW.seller_id);
END;
