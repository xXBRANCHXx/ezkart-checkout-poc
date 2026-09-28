-- Separate from historical Midtrans subscriptions. No provider execution is enabled.
CREATE TABLE commerce_subscriptions (
 id TEXT PRIMARY KEY, seller_id TEXT NOT NULL REFERENCES sellers(id), commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
 auth_user_id TEXT NOT NULL, email TEXT NOT NULL, product_id TEXT NOT NULL, variant_id TEXT NOT NULL,
 terms_json TEXT NOT NULL CHECK(json_valid(terms_json)), terms_hash TEXT NOT NULL,
 consent_statement TEXT NOT NULL, consent_version TEXT NOT NULL, consent_at TEXT NOT NULL,
 request_key TEXT NOT NULL, request_hash TEXT NOT NULL, created_at TEXT NOT NULL,
 cancelled_at TEXT, cancelled_by TEXT,
 UNIQUE(commerce_environment,auth_user_id,request_key)
);
CREATE INDEX commerce_subscription_owner ON commerce_subscriptions(commerce_environment,auth_user_id,id);
CREATE INDEX commerce_subscription_store ON commerce_subscriptions(commerce_environment,seller_id,id);
CREATE TRIGGER subscription_terms_immutable BEFORE UPDATE ON commerce_subscriptions
WHEN NEW.id IS NOT OLD.id OR NEW.seller_id IS NOT OLD.seller_id OR NEW.commerce_environment IS NOT OLD.commerce_environment
 OR NEW.auth_user_id IS NOT OLD.auth_user_id OR NEW.email IS NOT OLD.email OR NEW.product_id IS NOT OLD.product_id OR NEW.variant_id IS NOT OLD.variant_id
 OR NEW.terms_json IS NOT OLD.terms_json OR NEW.terms_hash IS NOT OLD.terms_hash OR NEW.consent_statement IS NOT OLD.consent_statement
 OR NEW.consent_version IS NOT OLD.consent_version OR NEW.consent_at IS NOT OLD.consent_at OR NEW.request_key IS NOT OLD.request_key
 OR NEW.request_hash IS NOT OLD.request_hash OR NEW.created_at IS NOT OLD.created_at
 OR (OLD.cancelled_at IS NOT NULL AND (NEW.cancelled_at IS NOT OLD.cancelled_at OR NEW.cancelled_by IS NOT OLD.cancelled_by))
BEGIN SELECT RAISE(ABORT,'subscription_terms_immutable'); END;
CREATE TRIGGER subscription_no_delete BEFORE DELETE ON commerce_subscriptions BEGIN SELECT RAISE(ABORT,'subscription_history_immutable'); END;
CREATE TABLE commerce_subscription_periods (
 id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL REFERENCES commerce_subscriptions(id), period_number INTEGER NOT NULL CHECK(period_number>=0),
 charge_reference TEXT NOT NULL UNIQUE, amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>=1000), currency TEXT NOT NULL CHECK(currency='IDR'),
 starts_at TEXT, ends_at TEXT, created_at TEXT NOT NULL,
 UNIQUE(subscription_id,period_number), CHECK((starts_at IS NULL AND ends_at IS NULL AND period_number=0) OR starts_at<ends_at)
);
CREATE TRIGGER subscription_period_guard BEFORE INSERT ON commerce_subscription_periods BEGIN
 SELECT RAISE(ABORT,'subscription_period_unavailable') WHERE NOT EXISTS(SELECT 1 FROM commerce_subscriptions s WHERE s.id=NEW.subscription_id AND s.cancelled_at IS NULL AND json_extract(s.terms_json,'$.amount')=NEW.amount);
 SELECT RAISE(ABORT,'subscription_period_sequence') WHERE NEW.period_number>0 AND NOT EXISTS(
 SELECT 1 FROM commerce_subscription_periods p JOIN commerce_subscription_outcomes o ON o.period_id=p.id AND o.result='paid'
 WHERE p.subscription_id=NEW.subscription_id AND p.period_number=NEW.period_number-1 AND o.ends_at=NEW.starts_at);
END;
CREATE TRIGGER subscription_period_no_update BEFORE UPDATE ON commerce_subscription_periods BEGIN SELECT RAISE(ABORT,'subscription_period_immutable'); END;
CREATE TRIGGER subscription_period_no_delete BEFORE DELETE ON commerce_subscription_periods BEGIN SELECT RAISE(ABORT,'subscription_history_immutable'); END;
-- A future authenticated provider adapter must replace this source. No API caller,
-- bearer token, signed Ezkart service request or browser return can write payment proof.
CREATE VIEW commerce_subscription_payment_sources AS SELECT
 CAST(NULL AS TEXT) AS evidence_id, CAST(NULL AS TEXT) AS period_id, CAST(NULL AS TEXT) AS charge_reference,
 CAST(NULL AS TEXT) AS seller_id, CAST(NULL AS TEXT) AS commerce_environment,
 CAST(NULL AS INTEGER) AS amount, CAST(NULL AS TEXT) AS currency, CAST(NULL AS TEXT) AS result,
 CAST(NULL AS TEXT) AS paid_at, CAST(NULL AS TEXT) AS dispatched_at WHERE 0;
CREATE TABLE commerce_subscription_outcomes (
 evidence_id TEXT PRIMARY KEY, period_id TEXT NOT NULL REFERENCES commerce_subscription_periods(id),
 result TEXT NOT NULL CHECK(result IN ('paid','failed')), paid_at TEXT, starts_at TEXT, ends_at TEXT, recorded_at TEXT NOT NULL,
 CHECK((result='failed' AND paid_at IS NULL AND starts_at IS NULL AND ends_at IS NULL) OR (result='paid' AND paid_at IS NOT NULL AND starts_at<ends_at))
);
CREATE UNIQUE INDEX subscription_period_paid_once ON commerce_subscription_outcomes(period_id) WHERE result='paid';
CREATE TRIGGER subscription_outcome_guard BEFORE INSERT ON commerce_subscription_outcomes BEGIN
 SELECT RAISE(ABORT,'subscription_authenticated_payment_required') WHERE NOT EXISTS(
 SELECT 1 FROM commerce_subscription_payment_sources e JOIN commerce_subscription_periods p ON p.id=e.period_id
 JOIN commerce_subscriptions s ON s.id=p.subscription_id
 WHERE e.evidence_id=NEW.evidence_id AND e.period_id=NEW.period_id AND e.result=NEW.result AND e.paid_at IS NEW.paid_at
 AND e.amount=p.amount AND e.currency=p.currency AND e.charge_reference=p.charge_reference AND e.seller_id=s.seller_id AND e.commerce_environment=s.commerce_environment
 AND e.dispatched_at>=p.created_at AND e.dispatched_at<=NEW.recorded_at
 AND (NEW.result='failed' OR (e.paid_at>=e.dispatched_at AND e.paid_at<=NEW.recorded_at AND (p.period_number>0 OR NEW.starts_at=e.paid_at))) AND (s.cancelled_at IS NULL OR e.dispatched_at<s.cancelled_at));
 SELECT RAISE(ABORT,'subscription_period_window_mismatch') WHERE NEW.result='paid' AND EXISTS(
 SELECT 1 FROM commerce_subscription_periods p WHERE p.id=NEW.period_id AND p.period_number>0 AND (p.starts_at!=NEW.starts_at OR p.ends_at!=NEW.ends_at));
END;
CREATE TRIGGER subscription_outcome_no_update BEFORE UPDATE ON commerce_subscription_outcomes BEGIN SELECT RAISE(ABORT,'subscription_history_immutable'); END;
CREATE TRIGGER subscription_outcome_no_delete BEFORE DELETE ON commerce_subscription_outcomes BEGIN SELECT RAISE(ABORT,'subscription_history_immutable'); END;
