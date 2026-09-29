-- A saved payout destination can only be replaced by an independent human reviewer.
CREATE TABLE seller_bank_change_requests (
 id TEXT PRIMARY KEY, seller_id TEXT NOT NULL REFERENCES sellers(id), commerce_environment TEXT NOT NULL,
 owner_auth_id TEXT NOT NULL, revision INTEGER NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
 bank_code TEXT NOT NULL, account_number TEXT NOT NULL, channel TEXT NOT NULL CHECK(channel IN ('BI_FAST','ONLINE')),
 reason TEXT NOT NULL, proof_expires_at TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(seller_id,request_key)
);
CREATE TABLE seller_bank_change_decisions (
 request_id TEXT PRIMARY KEY REFERENCES seller_bank_change_requests(id), reviewer_auth_id TEXT NOT NULL,
 outcome TEXT NOT NULL CHECK(outcome IN ('approved','rejected')), notes TEXT NOT NULL,
 verification_reference TEXT NOT NULL, proof_expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER bank_change_request_guard BEFORE INSERT ON seller_bank_change_requests BEGIN
 SELECT RAISE(ABORT,'onboarding_owner_required') WHERE NOT EXISTS(SELECT 1 FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id WHERE m.seller_id=NEW.seller_id AND m.auth_user_id=NEW.owner_auth_id AND m.role='owner' AND s.status='active');
 SELECT RAISE(ABORT,'onboarding_revision_conflict') WHERE NOT EXISTS(SELECT 1 FROM seller_onboarding_current_bank WHERE seller_id=NEW.seller_id AND revision=NEW.revision);
 SELECT RAISE(ABORT,'bank_change_pending') WHERE EXISTS(SELECT 1 FROM seller_bank_change_requests r WHERE r.seller_id=NEW.seller_id AND NOT EXISTS(SELECT 1 FROM seller_bank_change_decisions d WHERE d.request_id=r.id));
 SELECT RAISE(ABORT,'onboarding_proof_expired') WHERE NEW.proof_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NEW.proof_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','+630 seconds');
END;
CREATE TRIGGER bank_change_decision_guard BEFORE INSERT ON seller_bank_change_decisions BEGIN
 SELECT RAISE(ABORT,'bank_change_reviewer_required') WHERE NOT EXISTS(SELECT 1 FROM seller_bank_change_requests r JOIN commerce_support_staff s ON s.commerce_environment=r.commerce_environment AND s.auth_user_id=NEW.reviewer_auth_id AND s.role='reviewer' WHERE r.id=NEW.request_id AND r.owner_auth_id!=NEW.reviewer_auth_id AND NOT EXISTS(SELECT 1 FROM seller_memberships m WHERE m.seller_id=r.seller_id AND m.auth_user_id=NEW.reviewer_auth_id));
 SELECT RAISE(ABORT,'onboarding_proof_expired') WHERE NEW.proof_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NEW.proof_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','+630 seconds');
 SELECT RAISE(ABORT,'bank_change_verification_required') WHERE length(trim(NEW.notes))<20 OR (NEW.outcome='approved' AND length(trim(NEW.verification_reference))<10);
END;
CREATE TRIGGER bank_change_required BEFORE INSERT ON seller_onboarding_banks WHEN NEW.revision>1 BEGIN
 SELECT RAISE(ABORT,'bank_change_review_required') WHERE NOT EXISTS(
 SELECT 1 FROM seller_bank_change_requests r JOIN seller_bank_change_decisions d ON d.request_id=r.id AND d.outcome='approved'
 WHERE r.seller_id=NEW.seller_id AND r.revision=NEW.revision-1 AND r.owner_auth_id=NEW.owner_auth_id
 AND r.request_key=NEW.request_key AND r.request_hash=NEW.request_hash AND r.bank_code=NEW.bank_code AND r.account_number=NEW.account_number AND r.channel=NEW.channel);
END;
CREATE TRIGGER bank_change_apply AFTER INSERT ON seller_bank_change_decisions WHEN NEW.outcome='approved' BEGIN
 INSERT INTO seller_onboarding_banks(seller_id,revision,request_key,request_hash,owner_auth_id,bank_code,account_number,channel,proof_expires_at,created_at)
 SELECT seller_id,revision+1,request_key,request_hash,owner_auth_id,bank_code,account_number,channel,NEW.proof_expires_at,NEW.created_at FROM seller_bank_change_requests WHERE id=NEW.request_id;
END;
CREATE TRIGGER bank_change_requests_no_update BEFORE UPDATE ON seller_bank_change_requests BEGIN SELECT RAISE(ABORT,'onboarding_immutable'); END;
CREATE TRIGGER bank_change_requests_no_delete BEFORE DELETE ON seller_bank_change_requests BEGIN SELECT RAISE(ABORT,'onboarding_immutable'); END;
CREATE TRIGGER bank_change_decisions_no_update BEFORE UPDATE ON seller_bank_change_decisions BEGIN SELECT RAISE(ABORT,'onboarding_immutable'); END;
CREATE TRIGGER bank_change_decisions_no_delete BEFORE DELETE ON seller_bank_change_decisions BEGIN SELECT RAISE(ABORT,'onboarding_immutable'); END;
