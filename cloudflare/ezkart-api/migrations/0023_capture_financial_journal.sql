-- Operational accounting only. A verified payment is not provider settlement,
-- and these entries never create withdrawable funds or provider transfers.
CREATE TABLE commerce_financial_accounts (
  code TEXT PRIMARY KEY CHECK (length(code) BETWEEN 2 AND 64),
  account_class TEXT NOT NULL CHECK (account_class IN ('asset','liability','allocation','expense')),
  normal_side TEXT NOT NULL CHECK (normal_side IN ('debit','credit'))
);
INSERT INTO commerce_financial_accounts(code,account_class,normal_side) VALUES
  ('provider_receivable','asset','debit'),('seller_pending','liability','credit'),
  ('shipping_reserve','liability','credit'),('platform_commission_pending','allocation','credit'),
  ('platform_admin_pending','allocation','credit'),('unallocated_receipts','liability','credit');

CREATE TABLE commerce_financial_journals (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  seller_id TEXT NOT NULL,
  order_id TEXT,
  capture_id TEXT REFERENCES commerce_payment_captures(id) ON DELETE RESTRICT,
  commerce_environment TEXT NOT NULL CHECK (commerce_environment IN ('sandbox','production')),
  currency TEXT NOT NULL CHECK (currency='IDR'),
  kind TEXT NOT NULL,
  allocation_state TEXT NOT NULL CHECK (allocation_state IN ('allocated','unallocated','duplicate')),
  source_json TEXT NOT NULL CHECK (json_valid(source_json)),
  lines_json TEXT NOT NULL CHECK (json_valid(lines_json) AND json_type(lines_json)='array' AND json_array_length(lines_json) BETWEEN 2 AND 12),
  occurred_at TEXT NOT NULL,
  posted_at TEXT NOT NULL,
  FOREIGN KEY (seller_id,order_id) REFERENCES orders(seller_id,id) ON DELETE RESTRICT
);
CREATE INDEX idx_financial_journals_seller ON commerce_financial_journals(seller_id,commerce_environment,sequence);
CREATE UNIQUE INDEX idx_financial_capture_journal ON commerce_financial_journals(capture_id) WHERE kind='capture';

CREATE TABLE commerce_financial_entries (
  journal_sequence INTEGER NOT NULL REFERENCES commerce_financial_journals(sequence) ON DELETE RESTRICT,
  line_number INTEGER NOT NULL CHECK (line_number BETWEEN 0 AND 11),
  account TEXT NOT NULL REFERENCES commerce_financial_accounts(code) ON DELETE RESTRICT,
  -- Debit positive; credit negative. IDR is stored as whole rupiah.
  amount INTEGER NOT NULL CHECK (typeof(amount)='integer' AND amount BETWEEN -9007199254740991 AND 9007199254740991 AND amount!=0),
  PRIMARY KEY (journal_sequence,line_number),
  UNIQUE (journal_sequence,account)
);
CREATE INDEX idx_financial_entries_account ON commerce_financial_entries(account,journal_sequence);

-- Keep historical or malformed fee policies in suspense. Never apply today's
-- seller plan to an old payment, and never allocate an additional payment twice.
CREATE VIEW commerce_capture_accounting AS
SELECT c.id AS capture_id,c.seller_id,c.order_id,c.commerce_environment,c.currency,c.verified_at AS occurred_at,
  c.amount AS gross_amount,
  CASE WHEN c.capture_kind='duplicate_payment' THEN 'duplicate' WHEN f.valid=1 THEN 'allocated' ELSE 'unallocated' END AS allocation_state,
  json_object('captureId',c.id,'provider',c.provider,'providerReference',c.provider_reference,
    'captureKind',c.capture_kind,'grossAmount',c.amount,'productSubtotal',o.subtotal_amount,'shippingAmount',o.shipping_amount,
    'fees',json_extract(o.snapshot_json,'$.fees')) AS source_json,
  (SELECT json_group_array(json(value)) FROM json_each(json_array(
    json_object('account','provider_receivable','amount',c.amount),
    json_object('account','unallocated_receipts','amount',CASE WHEN c.capture_kind!='order_payment' OR f.valid!=1 THEN -c.amount ELSE 0 END),
    json_object('account','seller_pending','amount',CASE WHEN c.capture_kind='order_payment' AND f.valid=1 THEN -(o.subtotal_amount-json_extract(o.snapshot_json,'$.fees.commissionAmount')-1250) ELSE 0 END),
    json_object('account','shipping_reserve','amount',CASE WHEN c.capture_kind='order_payment' AND f.valid=1 THEN -o.shipping_amount ELSE 0 END),
    json_object('account','platform_commission_pending','amount',CASE WHEN c.capture_kind='order_payment' AND f.valid=1 THEN -json_extract(o.snapshot_json,'$.fees.commissionAmount') ELSE 0 END),
    json_object('account','platform_admin_pending','amount',CASE WHEN c.capture_kind='order_payment' AND f.valid=1 THEN -1250 ELSE 0 END)
  )) WHERE json_extract(value,'$.amount')!=0) AS lines_json
FROM commerce_payment_captures c JOIN orders o ON o.id=c.order_id AND o.seller_id=c.seller_id
JOIN (
  SELECT id,CASE WHEN commerce_version=1
    AND json_type(snapshot_json,'$.fees.version')='integer' AND json_extract(snapshot_json,'$.fees.version')=1
    AND json_extract(snapshot_json,'$.fees.plan') IN ('standard','advanced')
    AND json_type(snapshot_json,'$.fees.commissionBasisPoints')='integer'
    AND json_extract(snapshot_json,'$.fees.commissionBasisPoints')=CASE json_extract(snapshot_json,'$.fees.plan') WHEN 'advanced' THEN 600 ELSE 500 END
    AND json_type(snapshot_json,'$.fees.commissionAmount')='integer'
    AND json_extract(snapshot_json,'$.fees.commissionAmount')=(subtotal_amount*json_extract(snapshot_json,'$.fees.commissionBasisPoints')+5000)/10000
    AND json_type(snapshot_json,'$.fees.adminAmount')='integer' AND json_extract(snapshot_json,'$.fees.adminAmount')=1250
    AND json_extract(snapshot_json,'$.fees.processingFeePolicy')='actual_provider_fee'
    AND json_type(snapshot_json,'$.fees.withdrawalMinimum')='integer' AND json_extract(snapshot_json,'$.fees.withdrawalMinimum')=250000
    AND json_type(snapshot_json,'$.fees.sellerWithdrawalFee')='integer' AND json_extract(snapshot_json,'$.fees.sellerWithdrawalFee')=0
    THEN 1 ELSE 0 END AS valid FROM orders
) f ON f.id=o.id;

CREATE TRIGGER financial_journal_capture_guard
BEFORE INSERT ON commerce_financial_journals
BEGIN
  SELECT RAISE(ABORT,'financial_source_mismatch') WHERE NEW.kind!='capture' OR NOT EXISTS (
    SELECT 1 FROM commerce_capture_accounting c WHERE c.capture_id=NEW.capture_id
      AND NEW.id='financial_'||c.capture_id AND c.seller_id=NEW.seller_id AND c.order_id=NEW.order_id
      AND c.commerce_environment=NEW.commerce_environment AND c.currency=NEW.currency
      AND c.allocation_state=NEW.allocation_state AND c.source_json=NEW.source_json
      AND c.lines_json=NEW.lines_json AND c.occurred_at=NEW.occurred_at
      AND typeof(c.gross_amount)='integer' AND c.gross_amount BETWEEN 1 AND 9007199254740991
  );
  SELECT RAISE(ABORT,'financial_unbalanced_journal') WHERE
    (SELECT SUM(json_extract(value,'$.amount')) FROM json_each(NEW.lines_json))!=0;
  SELECT RAISE(ABORT,'financial_journal_immutable') WHERE EXISTS (
    SELECT 1 FROM commerce_financial_journals WHERE id=NEW.id OR sequence=NEW.sequence OR (capture_id=NEW.capture_id AND kind='capture')
  );
END;

CREATE TRIGGER financial_entry_source_guard
BEFORE INSERT ON commerce_financial_entries
BEGIN
  SELECT RAISE(ABORT,'financial_entry_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_financial_journals j,json_each(j.lines_json) l
    WHERE j.sequence=NEW.journal_sequence AND CAST(l.key AS INTEGER)=NEW.line_number
      AND json_extract(l.value,'$.account')=NEW.account AND json_extract(l.value,'$.amount')=NEW.amount
  );
  SELECT RAISE(ABORT,'financial_entry_immutable') WHERE EXISTS (
    SELECT 1 FROM commerce_financial_entries WHERE journal_sequence=NEW.journal_sequence AND (line_number=NEW.line_number OR account=NEW.account)
  );
END;

CREATE TRIGGER financial_journal_post_entries
AFTER INSERT ON commerce_financial_journals
BEGIN
  SELECT RAISE(ABORT,'financial_sequence_invalid') WHERE NEW.sequence<1;
  INSERT INTO commerce_financial_entries(journal_sequence,line_number,account,amount)
  SELECT NEW.sequence,CAST(key AS INTEGER),json_extract(value,'$.account'),json_extract(value,'$.amount') FROM json_each(NEW.lines_json);
  SELECT RAISE(ABORT,'financial_unbalanced_journal') WHERE
    (SELECT COUNT(*) FROM commerce_financial_entries WHERE journal_sequence=NEW.sequence)!=json_array_length(NEW.lines_json)
    OR (SELECT SUM(amount) FROM commerce_financial_entries WHERE journal_sequence=NEW.sequence)!=0;
END;

CREATE TRIGGER financial_capture_post
AFTER INSERT ON commerce_payment_captures
BEGIN
  INSERT INTO commerce_financial_journals(id,seller_id,order_id,capture_id,commerce_environment,currency,kind,allocation_state,source_json,lines_json,occurred_at,posted_at)
  SELECT 'financial_'||capture_id,seller_id,order_id,capture_id,commerce_environment,currency,'capture',allocation_state,source_json,lines_json,occurred_at,
    strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM commerce_capture_accounting WHERE capture_id=NEW.id;
END;

CREATE TRIGGER financial_journals_no_update BEFORE UPDATE ON commerce_financial_journals BEGIN
  SELECT RAISE(ABORT,'financial_journal_immutable');
END;
CREATE TRIGGER financial_journals_no_delete BEFORE DELETE ON commerce_financial_journals BEGIN
  SELECT RAISE(ABORT,'financial_journal_immutable');
END;
CREATE TRIGGER financial_entries_no_update BEFORE UPDATE ON commerce_financial_entries BEGIN
  SELECT RAISE(ABORT,'financial_entry_immutable');
END;
CREATE TRIGGER financial_entries_no_delete BEFORE DELETE ON commerce_financial_entries BEGIN
  SELECT RAISE(ABORT,'financial_entry_immutable');
END;
CREATE TRIGGER financial_accounts_no_update BEFORE UPDATE ON commerce_financial_accounts BEGIN
  SELECT RAISE(ABORT,'financial_account_immutable');
END;
CREATE TRIGGER financial_accounts_no_replace BEFORE INSERT ON commerce_financial_accounts
WHEN EXISTS (SELECT 1 FROM commerce_financial_accounts WHERE code=NEW.code) BEGIN
  SELECT RAISE(ABORT,'financial_account_immutable');
END;
CREATE TRIGGER financial_accounts_no_delete BEFORE DELETE ON commerce_financial_accounts BEGIN
  SELECT RAISE(ABORT,'financial_account_immutable');
END;
