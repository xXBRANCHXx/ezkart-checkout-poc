-- Bank setup may be deferred while the owner has verified two-step enrollment.
-- Only trusted server Auth checks populate this short-lived transaction proof.
CREATE TABLE seller_two_step_checks (
 seller_id TEXT NOT NULL REFERENCES sellers(id), owner_auth_id TEXT NOT NULL,
 expires_at TEXT NOT NULL, PRIMARY KEY(seller_id,owner_auth_id)
);
CREATE VIEW seller_onboarding_profile_ready AS
 SELECT p.seller_id,p.owner_auth_id,p.revision FROM seller_onboarding_current p
 JOIN sellers s ON s.id=p.seller_id AND s.status='active'
 JOIN app_users u ON u.auth_user_id=p.owner_auth_id AND lower(u.email)=p.verified_email
 JOIN seller_memberships m ON m.seller_id=p.seller_id AND m.auth_user_id=p.owner_auth_id AND m.role='owner'
 JOIN seller_shipping_settings h ON h.seller_id=p.seller_id AND h.revision=p.confirmed_shipping_revision
 JOIN seller_onboarding_policy policy ON policy.id=1 AND policy.minimum_age IS NOT NULL
 WHERE (CAST(strftime('%Y','now','+7 hours') AS INTEGER)-CAST(substr(p.declared_birth_date,1,4) AS INTEGER)-(strftime('%m-%d','now','+7 hours')<substr(p.declared_birth_date,6,5)))>=policy.minimum_age
 AND EXISTS(SELECT 1 FROM json_each(h.configuration_json,'$.addresses') a WHERE json_extract(a.value,'$.id')=json_extract(h.configuration_json,'$.pickupAddressId') AND json_type(a.value,'$.coordinate.latitude') IN ('real','integer') AND json_type(a.value,'$.coordinate.longitude') IN ('real','integer'))
 AND EXISTS(SELECT 1 FROM json_each(h.configuration_json,'$.addresses') a WHERE json_extract(a.value,'$.id')=json_extract(h.configuration_json,'$.returnAddressId') AND json_type(a.value,'$.coordinate.latitude') IN ('real','integer') AND json_type(a.value,'$.coordinate.longitude') IN ('real','integer'));

CREATE VIEW seller_selling_ready AS
 SELECT p.* FROM seller_onboarding_profile_ready p WHERE
 EXISTS(SELECT 1 FROM seller_onboarding_current_bank b WHERE b.seller_id=p.seller_id AND b.owner_auth_id=p.owner_auth_id)
 OR EXISTS(SELECT 1 FROM seller_two_step_checks c WHERE c.seller_id=p.seller_id AND c.owner_auth_id=p.owner_auth_id AND c.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'));
DROP TRIGGER onboarding_order_gate;
CREATE TRIGGER onboarding_order_gate BEFORE INSERT ON orders WHEN NEW.commerce_environment='production' AND NEW.commerce_version=1 BEGIN
 SELECT RAISE(ABORT,'seller_onboarding_required') WHERE NOT EXISTS(SELECT 1 FROM seller_selling_ready WHERE seller_id=NEW.seller_id);
END;
DROP TRIGGER onboarding_wallet_gate;
CREATE TRIGGER onboarding_wallet_gate BEFORE INSERT ON commerce_wallet_enrollments WHEN NEW.commerce_environment='production' BEGIN
 SELECT RAISE(ABORT,'seller_onboarding_required') WHERE NOT EXISTS(SELECT 1 FROM seller_selling_ready WHERE seller_id=NEW.seller_id AND owner_auth_id=NEW.owner_auth_id);
END;
DROP TRIGGER onboarding_snap_gate;
CREATE TRIGGER onboarding_snap_gate BEFORE INSERT ON commerce_snap_payment_bindings WHEN NEW.commerce_environment='production' BEGIN
 SELECT RAISE(ABORT,'seller_onboarding_required') WHERE NOT EXISTS(SELECT 1 FROM seller_selling_ready WHERE seller_id=NEW.seller_id);
END;
DROP TRIGGER onboarding_hosted_gate;
CREATE TRIGGER onboarding_hosted_gate BEFORE INSERT ON commerce_hosted_payment_bindings WHEN NEW.commerce_environment='production' BEGIN
 SELECT RAISE(ABORT,'seller_onboarding_required') WHERE NOT EXISTS(SELECT 1 FROM seller_selling_ready WHERE seller_id=NEW.seller_id);
END;
DROP TRIGGER onboarding_wallet_binding_gate;
CREATE TRIGGER onboarding_wallet_binding_gate BEFORE INSERT ON commerce_wallet_provider_bindings BEGIN
 SELECT RAISE(ABORT,'seller_onboarding_required') WHERE EXISTS(SELECT 1 FROM commerce_wallet_enrollments e WHERE e.id=NEW.enrollment_id AND e.commerce_environment='production' AND NOT EXISTS(SELECT 1 FROM seller_selling_ready r WHERE r.seller_id=e.seller_id AND r.owner_auth_id=e.owner_auth_id));
END;
-- Withdrawal and payout gates keep using seller_onboarding_ready, including bank.
