-- Live DOKU returns account numbers as JSON integers as well as digit strings.
-- Preserve original evidence and compare exact digits. JSON real/exponential
-- tokens are not account IDs, even when SQLite would coerce them to an integer.
DROP TRIGGER wallet_profile_source;
CREATE TRIGGER wallet_profile_source BEFORE INSERT ON commerce_wallet_provider_profiles BEGIN
  SELECT RAISE(ABORT,'wallet_profile_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_wallet_enrollments e JOIN commerce_wallet_provider_bindings b ON b.enrollment_id=e.id
    WHERE e.id=NEW.enrollment_id AND e.commerce_environment=NEW.commerce_environment
      AND json_extract(NEW.registration_json,'$.profileId')=NEW.profile_id
      AND json_extract(NEW.registration_json,'$.parentProfileId')=b.parent_profile_id
      AND NEW.profile_id!=b.parent_profile_id
      AND json_extract(NEW.confirmation_json,'$.profileId')=NEW.profile_id
      AND json_type(NEW.registration_json,'$.responseCode')='text' AND json_type(NEW.confirmation_json,'$.responseCode')='text'
      AND json_extract(NEW.registration_json,'$.responseCode') GLOB '200[0-9][0-9][0-9][0-9]'
      AND json_extract(NEW.confirmation_json,'$.responseCode') GLOB '200[0-9][0-9][0-9][0-9]'
  );
  SELECT RAISE(ABORT,'wallet_receipt_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_wallet_registration_receipts r WHERE r.enrollment_id=NEW.enrollment_id AND r.registration_json=NEW.registration_json
  );
  SELECT RAISE(ABORT,'wallet_accounts_mismatch') WHERE EXISTS (
    SELECT 1 FROM json_each(json_array(NEW.registration_json,NEW.confirmation_json)) document
    WHERE (SELECT COUNT(*) FROM json_each(document.value,'$.accounts') a
      WHERE json_extract(a.value,'$.type') IN ('DOKU_MERCHANT_IDR','DOKU_MERCHANT_PENDING_IDR'))!=2
      OR NOT EXISTS (SELECT 1 FROM json_each(document.value,'$.accounts') a WHERE json_extract(a.value,'$.type')='DOKU_MERCHANT_IDR'
        AND json_extract(a.value,'$.currency')='IDR' AND json_type(a.value,'$.accountNo') IN ('text','integer')
        AND CAST(json_extract(a.value,'$.accountNo') AS TEXT)=NEW.cash_account)
      OR NOT EXISTS (SELECT 1 FROM json_each(document.value,'$.accounts') a WHERE json_extract(a.value,'$.type')='DOKU_MERCHANT_PENDING_IDR'
        AND json_extract(a.value,'$.currency')='IDR' AND json_type(a.value,'$.accountNo') IN ('text','integer')
        AND CAST(json_extract(a.value,'$.accountNo') AS TEXT)=NEW.pending_account)
  );
  SELECT RAISE(ABORT,'wallet_profile_immutable') WHERE EXISTS (
    SELECT 1 FROM commerce_wallet_provider_profiles WHERE enrollment_id=NEW.enrollment_id
      OR (commerce_environment=NEW.commerce_environment AND profile_id=NEW.profile_id)
  );
END;
