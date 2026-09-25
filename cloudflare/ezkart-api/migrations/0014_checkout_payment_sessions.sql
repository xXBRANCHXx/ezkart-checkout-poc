-- A browser's random checkout key identifies one intent across stores. It is
-- never reused to create another provider request after an uncertain response.
CREATE UNIQUE INDEX idx_checkout_global_key ON orders(commerce_environment,checkout_key) WHERE checkout_key IS NOT NULL;

CREATE TABLE commerce_payment_accounts (
  order_id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  provider_request_id TEXT NOT NULL,
  account_number TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(seller_id,order_id) REFERENCES orders(seller_id,id) ON DELETE RESTRICT
);
CREATE TABLE commerce_payment_sessions (
  order_id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  commerce_environment TEXT NOT NULL CHECK (commerce_environment IN ('sandbox','production')),
  provider_request_id TEXT NOT NULL,
  details_json TEXT NOT NULL CHECK (json_valid(details_json)),
  created_at TEXT NOT NULL,
  UNIQUE(commerce_environment,provider_request_id),
  FOREIGN KEY(seller_id,order_id) REFERENCES orders(seller_id,id) ON DELETE RESTRICT
);
CREATE TRIGGER commerce_payment_account_guard BEFORE INSERT ON commerce_payment_accounts
BEGIN
  SELECT RAISE(ABORT,'commerce_payment_binding_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM orders o JOIN commerce_jobs j ON j.order_id=o.id AND j.seller_id=o.seller_id
    WHERE o.id=NEW.order_id AND o.seller_id=NEW.seller_id AND o.commerce_version=1
      AND json_extract(o.snapshot_json,'$.checkout.paymentFlow')='direct_bca' AND o.commerce_environment='sandbox'
      AND j.kind='payment.create' AND json_extract(j.payload_json,'$.providerRequestId')=NEW.provider_request_id
  ) OR EXISTS (SELECT 1 FROM commerce_payment_accounts a WHERE a.order_id=NEW.order_id
      AND (a.account_number!=NEW.account_number OR a.provider_request_id!=NEW.provider_request_id));
END;
CREATE TRIGGER commerce_payment_session_guard BEFORE INSERT ON commerce_payment_sessions
BEGIN
  SELECT RAISE(ABORT,'commerce_payment_binding_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM orders o JOIN commerce_jobs j ON j.order_id=o.id AND j.seller_id=o.seller_id
    WHERE o.id=NEW.order_id AND o.seller_id=NEW.seller_id AND o.commerce_version=1 AND o.commerce_environment=NEW.commerce_environment
      AND j.kind='payment.create' AND json_extract(j.payload_json,'$.providerRequestId')=NEW.provider_request_id
      AND json_extract(NEW.details_json,'$.providerRequestId')=NEW.provider_request_id
      AND json_extract(NEW.details_json,'$.flow')=json_extract(o.snapshot_json,'$.checkout.paymentFlow')
      AND (json_extract(NEW.details_json,'$.flow')='hosted' OR EXISTS (
        SELECT 1 FROM commerce_payment_accounts a WHERE a.order_id=o.id AND a.account_number=json_extract(NEW.details_json,'$.accountNumber')))
  ) OR EXISTS (SELECT 1 FROM commerce_payment_sessions s WHERE s.order_id=NEW.order_id AND s.details_json!=NEW.details_json);
END;
CREATE TRIGGER commerce_direct_capture_account_guard BEFORE INSERT ON commerce_payment_captures
WHEN EXISTS (SELECT 1 FROM orders o WHERE o.id=NEW.order_id AND json_extract(o.snapshot_json,'$.checkout.paymentFlow')='direct_bca')
BEGIN
  SELECT RAISE(ABORT,'commerce_payment_binding_mismatch') WHERE NOT EXISTS (SELECT 1 FROM commerce_payment_accounts a WHERE a.order_id=NEW.order_id AND a.seller_id=NEW.seller_id);
END;
CREATE TRIGGER commerce_payment_accounts_no_update BEFORE UPDATE ON commerce_payment_accounts BEGIN SELECT RAISE(ABORT,'commerce_immutable_payment'); END;
CREATE TRIGGER commerce_payment_accounts_no_delete BEFORE DELETE ON commerce_payment_accounts BEGIN SELECT RAISE(ABORT,'commerce_immutable_payment'); END;
CREATE TRIGGER commerce_payment_sessions_no_update BEFORE UPDATE ON commerce_payment_sessions BEGIN SELECT RAISE(ABORT,'commerce_immutable_payment'); END;
CREATE TRIGGER commerce_payment_sessions_no_delete BEFORE DELETE ON commerce_payment_sessions BEGIN SELECT RAISE(ABORT,'commerce_immutable_payment'); END;
