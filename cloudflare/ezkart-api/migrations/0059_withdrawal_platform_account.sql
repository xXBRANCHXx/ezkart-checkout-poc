-- Bind Ezkart's account before any bank transport can be authorized. This is
-- account identity, not proof of fee billing, funding or provider cash movement.
-- Older grants remain null; never retroactively assign an account to them.
ALTER TABLE commerce_withdrawal_payment_grants ADD COLUMN platform_enrollment_id TEXT
  REFERENCES commerce_wallet_provider_profiles(enrollment_id) ON DELETE RESTRICT;

CREATE TRIGGER withdrawal_payment_platform_source BEFORE INSERT ON commerce_withdrawal_payment_grants BEGIN
  SELECT RAISE(ABORT,'withdrawal_payment_platform_required') WHERE NOT EXISTS(
    SELECT 1 FROM commerce_withdrawals w
    JOIN commerce_wallet_provider_profiles sp ON sp.enrollment_id=w.enrollment_id
    JOIN commerce_wallet_provider_bindings sb ON sb.enrollment_id=sp.enrollment_id
    JOIN commerce_wallet_enrollments pe ON pe.id=NEW.platform_enrollment_id AND pe.commerce_environment=w.commerce_environment
    JOIN sellers s ON s.id=pe.seller_id AND s.status='active'
    JOIN commerce_wallet_provider_profiles pp ON pp.enrollment_id=pe.id AND pp.commerce_environment=w.commerce_environment
    JOIN commerce_wallet_provider_bindings pb ON pb.enrollment_id=pe.id
    WHERE w.id=NEW.withdrawal_id AND w.commerce_environment=NEW.commerce_environment AND pe.seller_id!=w.seller_id
      AND sp.cash_account!=pp.cash_account AND sp.profile_id!=pp.profile_id
      AND sb.parent_profile_id=pb.parent_profile_id AND sb.client_id=pb.client_id AND pb.client_id=NEW.client_id
      AND sb.credential_fingerprint=pb.credential_fingerprint AND pb.credential_fingerprint=NEW.credential_fingerprint);
END;
