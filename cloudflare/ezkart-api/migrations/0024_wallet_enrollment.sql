-- One durable, owner-authorized enrollment per seller/environment. Registering
-- a provider profile neither settles an order nor creates withdrawable funds.
CREATE TABLE commerce_wallet_enrollments (
  id TEXT PRIMARY KEY CHECK (length(id)=47 AND substr(id,1,7)='wallet_' AND substr(id,8) NOT GLOB '*[^a-f0-9]*'),
  seller_id TEXT NOT NULL REFERENCES sellers(id) ON DELETE RESTRICT,
  commerce_environment TEXT NOT NULL CHECK (commerce_environment IN ('sandbox','production')),
  request_key TEXT NOT NULL CHECK (length(request_key)=32 AND request_key NOT GLOB '*[^a-f0-9]*'),
  owner_auth_id TEXT NOT NULL,
  owner_email TEXT NOT NULL CHECK (length(owner_email) BETWEEN 3 AND 25 AND owner_email=lower(owner_email) AND instr(owner_email,'@')>1),
  account_name TEXT NOT NULL CHECK (length(account_name) BETWEEN 1 AND 128),
  partner_reference TEXT NOT NULL UNIQUE CHECK (length(partner_reference) BETWEEN 10 AND 64),
  job_id TEXT NOT NULL UNIQUE REFERENCES commerce_jobs(id) ON DELETE RESTRICT,
  proof_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(seller_id,commerce_environment)
);

CREATE TABLE commerce_wallet_provider_bindings (
  enrollment_id TEXT PRIMARY KEY REFERENCES commerce_wallet_enrollments(id) ON DELETE RESTRICT,
  credential_fingerprint TEXT NOT NULL CHECK (length(credential_fingerprint)=64 AND credential_fingerprint NOT GLOB '*[^a-f0-9]*'),
  client_id TEXT NOT NULL CHECK (length(client_id) BETWEEN 3 AND 128),
  parent_profile_id TEXT NOT NULL CHECK (length(parent_profile_id) BETWEEN 2 AND 22),
  attempt_id TEXT NOT NULL REFERENCES commerce_job_attempts(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);

CREATE TABLE commerce_wallet_provider_profiles (
  enrollment_id TEXT PRIMARY KEY REFERENCES commerce_wallet_provider_bindings(enrollment_id) ON DELETE RESTRICT,
  commerce_environment TEXT NOT NULL CHECK (commerce_environment IN ('sandbox','production')),
  profile_id TEXT NOT NULL CHECK (length(profile_id) BETWEEN 2 AND 22),
  cash_account TEXT NOT NULL CHECK (length(cash_account) BETWEEN 1 AND 10 AND cash_account NOT GLOB '*[^0-9]*'),
  pending_account TEXT NOT NULL CHECK (length(pending_account) BETWEEN 1 AND 10 AND pending_account NOT GLOB '*[^0-9]*' AND pending_account!=cash_account),
  registration_json TEXT NOT NULL CHECK (json_valid(registration_json)),
  confirmation_json TEXT NOT NULL CHECK (json_valid(confirmation_json)),
  recorded_at TEXT NOT NULL,
  UNIQUE(commerce_environment,profile_id)
);

CREATE TABLE commerce_wallet_registration_receipts (
  enrollment_id TEXT PRIMARY KEY REFERENCES commerce_wallet_provider_bindings(enrollment_id) ON DELETE RESTRICT,
  registration_json TEXT NOT NULL CHECK (json_valid(registration_json)),
  received_at TEXT NOT NULL
);

CREATE TABLE commerce_wallet_provider_accounts (
  enrollment_id TEXT NOT NULL REFERENCES commerce_wallet_provider_profiles(enrollment_id) ON DELETE RESTRICT,
  commerce_environment TEXT NOT NULL CHECK (commerce_environment IN ('sandbox','production')),
  account_type TEXT NOT NULL CHECK (account_type IN ('DOKU_MERCHANT_IDR','DOKU_MERCHANT_PENDING_IDR')),
  account_number TEXT NOT NULL,
  PRIMARY KEY(enrollment_id,account_type),
  UNIQUE(commerce_environment,account_number)
);

CREATE TRIGGER wallet_enrollment_source BEFORE INSERT ON commerce_wallet_enrollments BEGIN
  SELECT RAISE(ABORT,'wallet_reference_mismatch') WHERE NEW.job_id!='job_'||substr(NEW.id,8,32)
    OR NEW.partner_reference!='EZK-W-'||CASE NEW.commerce_environment WHEN 'sandbox' THEN 'S' ELSE 'P' END||'-'||substr(NEW.id,8);
  SELECT RAISE(ABORT,'wallet_owner_changed') WHERE NOT EXISTS (
    SELECT 1 FROM sellers s JOIN seller_memberships m ON m.seller_id=s.id
    WHERE s.id=NEW.seller_id AND s.status='active' AND m.auth_user_id=NEW.owner_auth_id AND m.role='owner' AND s.name=NEW.account_name
  );
  SELECT RAISE(ABORT,'wallet_proof_expired') WHERE NEW.proof_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    OR NEW.proof_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','+630 seconds');
  SELECT RAISE(ABORT,'wallet_job_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_jobs j WHERE j.id=NEW.job_id AND j.seller_id=NEW.seller_id AND j.commerce_environment=NEW.commerce_environment
      AND j.kind='wallet.register' AND j.order_id IS NULL AND j.state='queued' AND j.attempts=0
      AND j.job_key='wallet.register' AND json_extract(j.payload_json,'$.enrollmentId')=NEW.id
      AND json_extract(j.payload_json,'$.partnerReferenceNo')=NEW.partner_reference
  );
  SELECT RAISE(ABORT,'wallet_enrollment_immutable') WHERE EXISTS (
    SELECT 1 FROM commerce_wallet_enrollments WHERE id=NEW.id OR job_id=NEW.job_id OR partner_reference=NEW.partner_reference
      OR (seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment)
  );
END;

CREATE TRIGGER wallet_binding_source BEFORE INSERT ON commerce_wallet_provider_bindings BEGIN
  SELECT RAISE(ABORT,'wallet_binding_lease_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_wallet_enrollments e JOIN commerce_jobs j ON j.id=e.job_id
      JOIN commerce_job_attempts a ON a.job_id=j.id AND a.lease_token=j.lease_token AND a.worker_id=j.lease_owner
      JOIN seller_memberships m ON m.seller_id=e.seller_id AND m.auth_user_id=e.owner_auth_id
      JOIN sellers s ON s.id=e.seller_id
    WHERE e.id=NEW.enrollment_id AND a.id=NEW.attempt_id AND a.mode='execute' AND a.finished_at IS NULL
      AND j.state='running' AND j.lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND m.role='owner' AND s.status='active'
  );
  SELECT RAISE(ABORT,'wallet_binding_immutable') WHERE EXISTS (SELECT 1 FROM commerce_wallet_provider_bindings WHERE enrollment_id=NEW.enrollment_id);
END;

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
        AND json_extract(a.value,'$.currency')='IDR' AND json_type(a.value,'$.accountNo')='text' AND json_extract(a.value,'$.accountNo')=NEW.cash_account)
      OR NOT EXISTS (SELECT 1 FROM json_each(document.value,'$.accounts') a WHERE json_extract(a.value,'$.type')='DOKU_MERCHANT_PENDING_IDR'
        AND json_extract(a.value,'$.currency')='IDR' AND json_type(a.value,'$.accountNo')='text' AND json_extract(a.value,'$.accountNo')=NEW.pending_account)
  );
  SELECT RAISE(ABORT,'wallet_profile_immutable') WHERE EXISTS (
    SELECT 1 FROM commerce_wallet_provider_profiles WHERE enrollment_id=NEW.enrollment_id
      OR (commerce_environment=NEW.commerce_environment AND profile_id=NEW.profile_id)
  );
END;

CREATE TRIGGER wallet_receipt_source BEFORE INSERT ON commerce_wallet_registration_receipts BEGIN
  SELECT RAISE(ABORT,'wallet_receipt_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_wallet_provider_bindings b WHERE b.enrollment_id=NEW.enrollment_id
      AND json_type(NEW.registration_json,'$.profileId')='text' AND length(json_extract(NEW.registration_json,'$.profileId')) BETWEEN 2 AND 22
      AND json_extract(NEW.registration_json,'$.profileId')!=b.parent_profile_id
      AND json_extract(NEW.registration_json,'$.parentProfileId')=b.parent_profile_id
      AND json_type(NEW.registration_json,'$.responseCode')='text'
      AND json_extract(NEW.registration_json,'$.responseCode') GLOB '200[0-9][0-9][0-9][0-9]'
      AND json_type(NEW.registration_json,'$.accounts')='array'
  );
  SELECT RAISE(ABORT,'wallet_receipt_immutable') WHERE EXISTS (SELECT 1 FROM commerce_wallet_registration_receipts WHERE enrollment_id=NEW.enrollment_id);
END;

CREATE TRIGGER wallet_profile_accounts AFTER INSERT ON commerce_wallet_provider_profiles BEGIN
  INSERT INTO commerce_wallet_provider_accounts(enrollment_id,commerce_environment,account_type,account_number) VALUES
    (NEW.enrollment_id,NEW.commerce_environment,'DOKU_MERCHANT_IDR',NEW.cash_account),
    (NEW.enrollment_id,NEW.commerce_environment,'DOKU_MERCHANT_PENDING_IDR',NEW.pending_account);
END;
CREATE TRIGGER wallet_account_source BEFORE INSERT ON commerce_wallet_provider_accounts BEGIN
  SELECT RAISE(ABORT,'wallet_account_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_wallet_provider_profiles p WHERE p.enrollment_id=NEW.enrollment_id AND p.commerce_environment=NEW.commerce_environment
      AND NEW.account_number=CASE NEW.account_type WHEN 'DOKU_MERCHANT_IDR' THEN p.cash_account ELSE p.pending_account END
  );
  SELECT RAISE(ABORT,'wallet_account_immutable') WHERE EXISTS (
    SELECT 1 FROM commerce_wallet_provider_accounts WHERE (enrollment_id=NEW.enrollment_id AND account_type=NEW.account_type)
      OR (commerce_environment=NEW.commerce_environment AND account_number=NEW.account_number)
  );
END;

CREATE TRIGGER wallet_enrollments_no_update BEFORE UPDATE ON commerce_wallet_enrollments BEGIN SELECT RAISE(ABORT,'wallet_enrollment_immutable'); END;
CREATE TRIGGER wallet_enrollments_no_delete BEFORE DELETE ON commerce_wallet_enrollments BEGIN SELECT RAISE(ABORT,'wallet_enrollment_immutable'); END;
CREATE TRIGGER wallet_bindings_no_update BEFORE UPDATE ON commerce_wallet_provider_bindings BEGIN SELECT RAISE(ABORT,'wallet_binding_immutable'); END;
CREATE TRIGGER wallet_bindings_no_delete BEFORE DELETE ON commerce_wallet_provider_bindings BEGIN SELECT RAISE(ABORT,'wallet_binding_immutable'); END;
CREATE TRIGGER wallet_profiles_no_update BEFORE UPDATE ON commerce_wallet_provider_profiles BEGIN SELECT RAISE(ABORT,'wallet_profile_immutable'); END;
CREATE TRIGGER wallet_profiles_no_delete BEFORE DELETE ON commerce_wallet_provider_profiles BEGIN SELECT RAISE(ABORT,'wallet_profile_immutable'); END;
CREATE TRIGGER wallet_accounts_no_update BEFORE UPDATE ON commerce_wallet_provider_accounts BEGIN SELECT RAISE(ABORT,'wallet_account_immutable'); END;
CREATE TRIGGER wallet_accounts_no_delete BEFORE DELETE ON commerce_wallet_provider_accounts BEGIN SELECT RAISE(ABORT,'wallet_account_immutable'); END;
CREATE TRIGGER wallet_receipts_no_update BEFORE UPDATE ON commerce_wallet_registration_receipts BEGIN SELECT RAISE(ABORT,'wallet_receipt_immutable'); END;
CREATE TRIGGER wallet_receipts_no_delete BEFORE DELETE ON commerce_wallet_registration_receipts BEGIN SELECT RAISE(ABORT,'wallet_receipt_immutable'); END;
