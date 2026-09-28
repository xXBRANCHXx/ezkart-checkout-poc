-- No DOKU returned-funds evidence contract is integrated yet. This read-only,
-- empty boundary cannot be populated by service callers or support attestations.
-- A future provider-specific verifier must replace this view with a projection
-- of immutable, authenticated original outcomes, not add an INSERT endpoint.
CREATE VIEW commerce_refund_verified_outcomes AS
SELECT CAST(NULL AS TEXT) AS evidence_id, NULL AS provider_request_id,
  NULL AS provider, NULL AS commerce_environment, NULL AS credential_fingerprint,
  NULL AS brand_id, NULL AS payment_reference, NULL AS capture_id, NULL AS bank_id,
  NULL AS amount, NULL AS currency, NULL AS outcome_reference, NULL AS returned_at,
  NULL AS refund_fee_amount, NULL AS evidence_hash WHERE 0;

-- Credits here acknowledge money returned, while its actual funding account
-- remains unreconciled. Never guess a cash wallet or the refund-fee payer.
INSERT INTO commerce_financial_accounts(code,account_class,normal_side)
VALUES('refund_funding_unreconciled','liability','credit');
CREATE TABLE commerce_refund_finalizations (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  refund_id TEXT NOT NULL UNIQUE REFERENCES commerce_refunds(id),
  provider_request_id TEXT NOT NULL UNIQUE REFERENCES commerce_refund_provider_requests(id),
  evidence_id TEXT NOT NULL UNIQUE,
  capture_id TEXT NOT NULL REFERENCES commerce_payment_captures(id),
  seller_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  credential_fingerprint TEXT NOT NULL,
  outcome_reference TEXT NOT NULL,
  product_amount INTEGER NOT NULL CHECK(typeof(product_amount)='integer' AND product_amount BETWEEN 0 AND 100000000000),
  shipping_amount INTEGER NOT NULL CHECK(typeof(shipping_amount)='integer' AND shipping_amount BETWEEN 0 AND 100000000),
  commission_reversal INTEGER NOT NULL CHECK(typeof(commission_reversal)='integer' AND commission_reversal BETWEEN 0 AND product_amount),
  cumulative_product_amount INTEGER NOT NULL CHECK(typeof(cumulative_product_amount)='integer'),
  refund_fee_amount INTEGER CHECK(refund_fee_amount IS NULL OR (typeof(refund_fee_amount)='integer' AND refund_fee_amount BETWEEN 0 AND 100000000000)),
  evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
  returned_at TEXT NOT NULL,
  posted_at TEXT NOT NULL,
  UNIQUE(commerce_environment,credential_fingerprint,outcome_reference),
  FOREIGN KEY(seller_id,order_id) REFERENCES orders(seller_id,id)
);
CREATE INDEX idx_refund_final_capture ON commerce_refund_finalizations(capture_id,sequence);

CREATE VIEW commerce_refund_finalization_sources AS
WITH original AS (
  SELECT r.id AS refund_id,q.id AS provider_request_id,e.evidence_id,r.capture_id,r.seller_id,r.order_id,r.commerce_environment,
    e.credential_fingerprint,e.outcome_reference,r.amount-r.shipping_amount AS product_amount,r.shipping_amount,
    o.subtotal_amount AS subtotal,json_extract(o.snapshot_json,'$.fees.commissionAmount') AS commission,
    COALESCE((SELECT SUM(f.commission_reversal) FROM commerce_refund_finalizations f WHERE f.capture_id=r.capture_id),0) AS reversed,
    r.amount-r.shipping_amount+COALESCE((SELECT SUM(f.product_amount) FROM commerce_refund_finalizations f WHERE f.capture_id=r.capture_id),0) AS cumulative_product_amount,
    e.refund_fee_amount,e.returned_at,
    json_object('version',1,'evidenceId',e.evidence_id,'evidenceHash',e.evidence_hash,'providerRequestId',q.id,
      'provider','doku','outcomeReference',e.outcome_reference,'captureId',r.capture_id,'paymentReference',e.payment_reference,
      'credentialFingerprint',e.credential_fingerprint,'bankId',e.bank_id,'returnedAmount',e.amount,
      'actualRefundFee',e.refund_fee_amount,'refundFeePayer',NULL,'fundingState','unreconciled') AS evidence_json
  FROM commerce_refund_verified_outcomes e JOIN commerce_refund_provider_requests q ON q.id=e.provider_request_id
  JOIN commerce_refunds r ON r.id=q.refund_id JOIN orders o ON o.id=r.order_id AND o.seller_id=r.seller_id
  JOIN commerce_payment_captures c ON c.id=r.capture_id AND c.capture_kind='order_payment'
  JOIN commerce_financial_journals j ON j.capture_id=c.id AND j.kind='capture' AND j.allocation_state='allocated'
  WHERE r.state='approved' AND o.checkout_state IN ('paid','partially_refunded')
    AND e.provider='doku' AND e.commerce_environment=r.commerce_environment
    AND e.credential_fingerprint=json_extract(q.snapshot_json,'$.credentialFingerprint')
    AND e.brand_id=json_extract(q.snapshot_json,'$.brandId')
    AND e.payment_reference=c.provider_reference AND e.payment_reference=json_extract(q.snapshot_json,'$.paymentReference')
    AND e.capture_id=c.id AND e.capture_id=json_extract(q.snapshot_json,'$.captureId')
    AND e.bank_id=q.bank_id AND e.bank_id=json_extract(q.snapshot_json,'$.bankId')
    AND typeof(e.amount)='integer' AND e.amount=r.amount AND e.amount=json_extract(q.snapshot_json,'$.refundAmount') AND e.currency='IDR'
    AND typeof(e.evidence_id)='text' AND length(e.evidence_id) BETWEEN 1 AND 200
    AND typeof(e.outcome_reference)='text' AND length(e.outcome_reference) BETWEEN 1 AND 200
    AND length(e.evidence_hash)=64 AND e.evidence_hash NOT GLOB '*[^a-f0-9]*'
    AND julianday(e.returned_at) IS NOT NULL AND julianday(e.returned_at)>=julianday(q.created_at)
    AND julianday(e.returned_at)<=julianday('now','+30 seconds')
    AND (e.refund_fee_amount IS NULL OR (typeof(e.refund_fee_amount)='integer' AND e.refund_fee_amount BETWEEN 0 AND 100000000000))
    AND (SELECT COUNT(*) FROM commerce_refund_verified_outcomes x WHERE x.provider_request_id=q.id)=1
    AND NOT EXISTS(SELECT 1 FROM commerce_refund_finalizations f WHERE f.refund_id=r.id)
    AND r.shipping_amount+COALESCE((SELECT SUM(f.shipping_amount) FROM commerce_refund_finalizations f WHERE f.capture_id=c.id),0)<=o.shipping_amount
), arithmetic AS (
  -- Whole-rupiah cumulative half-up rounding, using integer decomposition to
  -- avoid SQLite overflowing into floating point at the maximum order amount.
  SELECT *,((cumulative_product_amount/100000)*commission)/subtotal AS high,
    ((cumulative_product_amount/100000)*commission)%subtotal AS remainder
  FROM original WHERE subtotal>0 AND cumulative_product_amount<=subtotal
)
SELECT refund_id,provider_request_id,evidence_id,capture_id,seller_id,order_id,commerce_environment,credential_fingerprint,outcome_reference,
  product_amount,shipping_amount,
  high*100000+(remainder*100000+(cumulative_product_amount%100000)*commission+subtotal/2)/subtotal-reversed AS commission_reversal,
  cumulative_product_amount,refund_fee_amount,evidence_json,returned_at
FROM arithmetic;

CREATE TRIGGER refund_finalization_guard BEFORE INSERT ON commerce_refund_finalizations BEGIN
  SELECT RAISE(ABORT,'refund_finalization_immutable') WHERE EXISTS(SELECT 1 FROM commerce_refund_finalizations
    WHERE sequence=NEW.sequence OR refund_id=NEW.refund_id OR provider_request_id=NEW.provider_request_id OR evidence_id=NEW.evidence_id
      OR (commerce_environment=NEW.commerce_environment AND credential_fingerprint=NEW.credential_fingerprint AND outcome_reference=NEW.outcome_reference));
  SELECT RAISE(ABORT,'refund_finalization_evidence_required') WHERE NOT EXISTS(SELECT 1 FROM commerce_refund_finalization_sources s
    WHERE s.refund_id=NEW.refund_id AND s.provider_request_id=NEW.provider_request_id AND s.evidence_id=NEW.evidence_id
      AND s.capture_id=NEW.capture_id AND s.seller_id=NEW.seller_id AND s.order_id=NEW.order_id AND s.commerce_environment=NEW.commerce_environment
      AND s.credential_fingerprint=NEW.credential_fingerprint AND s.outcome_reference=NEW.outcome_reference
      AND s.product_amount=NEW.product_amount AND s.shipping_amount=NEW.shipping_amount AND s.commission_reversal=NEW.commission_reversal
      AND s.cumulative_product_amount=NEW.cumulative_product_amount AND s.refund_fee_amount IS NEW.refund_fee_amount
      AND s.evidence_json=NEW.evidence_json AND s.returned_at=NEW.returned_at)
    OR NEW.posted_at!=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;
CREATE TRIGGER refund_finalization_no_update BEFORE UPDATE ON commerce_refund_finalizations BEGIN SELECT RAISE(ABORT,'refund_finalization_immutable'); END;
CREATE TRIGGER refund_finalization_no_delete BEFORE DELETE ON commerce_refund_finalizations BEGIN SELECT RAISE(ABORT,'refund_finalization_immutable'); END;

CREATE VIEW commerce_refund_journal_accounting AS
SELECT 'financial_refund_'||f.refund_id AS id,f.seller_id,f.order_id,f.capture_id,f.commerce_environment,
  json_object('version',1,'refundId',f.refund_id,'evidence',json(f.evidence_json),'productRefund',f.product_amount,
    'shippingRefund',f.shipping_amount,'commissionReversal',f.commission_reversal,'cumulativeProductRefund',f.cumulative_product_amount,
    'retainedAdminFee',1250,'originalPaymentFeePolicy','retained','refundFeeState',CASE WHEN f.refund_fee_amount IS NULL THEN 'unknown' ELSE 'custody_unresolved' END) AS source_json,
  (SELECT json_group_array(json(value)) FROM json_each(json_array(
    json_object('account','seller_pending','amount',f.product_amount-f.commission_reversal),
    json_object('account','platform_commission_pending','amount',f.commission_reversal),
    json_object('account','shipping_reserve','amount',f.shipping_amount),
    json_object('account','refund_funding_unreconciled','amount',-f.product_amount-f.shipping_amount)
  )) WHERE json_extract(value,'$.amount')!=0) AS lines_json,
  f.returned_at AS occurred_at,f.posted_at
FROM commerce_refund_finalizations f;

-- Entitlements and delivery history remain immutable. Only positively allocated
-- digital lines on a confirmed refund lose access; shipping never selects a file.
CREATE VIEW commerce_digital_refund_revocations AS
SELECT DISTINCT i.order_item_id,f.capture_id FROM commerce_refund_finalizations f
JOIN commerce_refund_items i ON i.refund_id=f.refund_id
JOIN commerce_digital_entitlements e ON e.order_item_id=i.order_item_id AND e.capture_id=f.capture_id;
CREATE VIEW commerce_refund_order_totals AS
SELECT order_id,SUM(product_amount+shipping_amount) AS refunded_amount FROM commerce_refund_finalizations GROUP BY order_id;
CREATE TRIGGER refund_finalization_post AFTER INSERT ON commerce_refund_finalizations BEGIN
  SELECT RAISE(ABORT,'refund_finalization_sequence') WHERE NEW.sequence<1 OR EXISTS(SELECT 1 FROM commerce_refund_finalizations WHERE sequence>NEW.sequence);
  INSERT INTO commerce_financial_journals(id,seller_id,order_id,capture_id,commerce_environment,currency,kind,allocation_state,source_json,lines_json,occurred_at,posted_at)
  SELECT id,seller_id,order_id,capture_id,commerce_environment,'IDR','refund','allocated',source_json,lines_json,occurred_at,posted_at
  FROM commerce_refund_journal_accounting WHERE id='financial_refund_'||NEW.refund_id;
  UPDATE orders SET checkout_state=CASE WHEN (SELECT refunded_amount FROM commerce_refund_order_totals WHERE order_id=NEW.order_id)=total_amount THEN 'refunded' ELSE 'partially_refunded' END,
    status=CASE WHEN (SELECT refunded_amount FROM commerce_refund_order_totals WHERE order_id=NEW.order_id)=total_amount THEN 'refunded' ELSE 'paid' END,
    revision=revision+1,updated_at=NEW.posted_at WHERE id=NEW.order_id;
END;

DROP TRIGGER financial_journal_capture_guard;
CREATE TRIGGER financial_journal_capture_guard BEFORE INSERT ON commerce_financial_journals BEGIN
  SELECT RAISE(ABORT,'financial_source_mismatch') WHERE NOT (
    (NEW.kind='capture' AND EXISTS(SELECT 1 FROM commerce_capture_accounting c WHERE c.capture_id=NEW.capture_id
      AND NEW.id='financial_'||c.capture_id AND c.seller_id=NEW.seller_id AND c.order_id=NEW.order_id
      AND c.commerce_environment=NEW.commerce_environment AND c.currency=NEW.currency AND c.allocation_state=NEW.allocation_state
      AND c.source_json=NEW.source_json AND c.lines_json=NEW.lines_json AND c.occurred_at=NEW.occurred_at
      AND typeof(c.gross_amount)='integer' AND c.gross_amount BETWEEN 1 AND 9007199254740991))
    OR (NEW.kind IN ('settlement','settlement_correction','settlement_reversal') AND NEW.currency='IDR' AND NEW.allocation_state='allocated'
      AND EXISTS(SELECT 1 FROM commerce_settlement_journal_accounting s WHERE s.id=NEW.id AND s.capture_id=NEW.capture_id AND s.order_id=NEW.order_id
        AND s.seller_id=NEW.seller_id AND s.commerce_environment=NEW.commerce_environment AND s.kind=NEW.kind
        AND s.source_json=NEW.source_json AND s.lines_json=NEW.lines_json AND s.occurred_at=NEW.occurred_at AND s.posted_at=NEW.posted_at))
    OR (NEW.kind='earnings' AND NEW.currency='IDR' AND NEW.allocation_state='allocated'
      AND EXISTS(SELECT 1 FROM commerce_earnings_journal_accounting s WHERE s.id=NEW.id AND s.capture_id=NEW.capture_id AND s.order_id=NEW.order_id
        AND s.seller_id=NEW.seller_id AND s.commerce_environment=NEW.commerce_environment
        AND s.source_json=NEW.source_json AND s.lines_json=NEW.lines_json AND s.occurred_at=NEW.occurred_at AND s.posted_at=NEW.posted_at))
    OR (NEW.kind IN ('withdrawal_reserve','withdrawal_cancel') AND NEW.currency='IDR' AND NEW.allocation_state='allocated'
      AND NEW.order_id IS NULL AND NEW.capture_id IS NULL
      AND EXISTS(SELECT 1 FROM commerce_withdrawal_journal_accounting s WHERE s.id=NEW.id
        AND s.seller_id=NEW.seller_id AND s.commerce_environment=NEW.commerce_environment AND s.kind=NEW.kind
        AND s.source_json=NEW.source_json AND s.lines_json=NEW.lines_json AND s.occurred_at=NEW.occurred_at AND s.posted_at=NEW.posted_at))
    OR (NEW.kind IN ('payout','payout_release','payout_correction') AND NEW.currency='IDR' AND NEW.allocation_state='allocated'
      AND NEW.order_id IS NULL AND NEW.capture_id IS NULL
      AND EXISTS(SELECT 1 FROM commerce_payout_journal_accounting s WHERE s.id=NEW.id
        AND s.seller_id=NEW.seller_id AND s.commerce_environment=NEW.commerce_environment AND s.kind=NEW.kind
        AND s.source_json=NEW.source_json AND s.lines_json=NEW.lines_json AND s.occurred_at=NEW.occurred_at AND s.posted_at=NEW.posted_at))
    OR (NEW.kind='refund' AND NEW.currency='IDR' AND NEW.allocation_state='allocated'
      AND EXISTS(SELECT 1 FROM commerce_refund_journal_accounting s WHERE s.id=NEW.id AND s.capture_id=NEW.capture_id AND s.order_id=NEW.order_id
        AND s.seller_id=NEW.seller_id AND s.commerce_environment=NEW.commerce_environment
        AND s.source_json=NEW.source_json AND s.lines_json=NEW.lines_json AND s.occurred_at=NEW.occurred_at AND s.posted_at=NEW.posted_at)));
  SELECT RAISE(ABORT,'financial_unbalanced_journal') WHERE (SELECT SUM(json_extract(value,'$.amount')) FROM json_each(NEW.lines_json))!=0;
  SELECT RAISE(ABORT,'financial_journal_immutable') WHERE EXISTS(SELECT 1 FROM commerce_financial_journals
    WHERE id=NEW.id OR sequence=NEW.sequence OR (NEW.kind='capture' AND capture_id=NEW.capture_id AND kind='capture'));
END;

DROP VIEW commerce_earnings_evidence;
CREATE VIEW commerce_earnings_evidence AS
SELECT i.*,original_seller_amount-actual_fee-COALESCE((SELECT SUM(f.product_amount-f.commission_reversal) FROM commerce_refund_finalizations f WHERE f.capture_id=i.capture_id),0) AS net_amount,
  (SELECT json_group_array(value) FROM json_each(json_array(
    CASE WHEN EXISTS(SELECT 1 FROM commerce_refund_finalizations f WHERE f.capture_id=i.capture_id) THEN 'refund_funding_unreconciled' END,
    CASE WHEN EXISTS(SELECT 1 FROM commerce_refund_finalizations f WHERE f.capture_id=i.capture_id AND (f.refund_fee_amount IS NULL OR f.refund_fee_amount>0)) THEN 'refund_fee_unsettled' END,
    CASE WHEN checkout_state!='paid' THEN 'payment_state_requires_review' END,
    CASE WHEN payment_review!=0 OR additional_captures!=0 THEN 'payment_review' END,
    CASE WHEN fulfillment_review!=0 THEN 'fulfillment_review' END,
    CASE WHEN fulfillment_state='stock_review' THEN 'stock_review' END,
    CASE WHEN fulfillment_state IN ('return_in_transit','returned','disposed') THEN 'courier_return' END,
    CASE WHEN json_array_length(jobs_json)>0 THEN 'provider_job_unresolved' END,
    CASE WHEN json_array_length(refunds_json)>0 THEN 'refund_requires_reconciliation' END,
    CASE WHEN json_array_length(returns_json)>0 THEN 'return_requires_reconciliation' END,
    CASE WHEN delivery_id IS NULL THEN 'delivery_unconfirmed' END,
    CASE WHEN settlement_id IS NULL THEN 'settlement_unobserved' WHEN settlement_state!='settled' THEN settlement_reason END,
    CASE WHEN settlement_id IS NOT NULL AND COALESCE(history_current,0)!=1 THEN 'provider_history_changed' END,
    CASE WHEN original_seller_amount-actual_fee-COALESCE((SELECT SUM(f.product_amount-f.commission_reversal) FROM commerce_refund_finalizations f WHERE f.capture_id=i.capture_id),0)<0 THEN 'negative_seller_allocation' END
  )) WHERE value IS NOT NULL) AS holds_json
FROM commerce_earnings_inputs i;

DROP TRIGGER commerce_refund_create_guard;
CREATE TRIGGER commerce_refund_create_guard BEFORE INSERT ON commerce_refunds BEGIN
  SELECT RAISE(ABORT,'refund_immutable') WHERE EXISTS(SELECT 1 FROM commerce_refunds r
    WHERE r.sequence=NEW.sequence OR r.id=NEW.id OR (r.actor_auth_user_id=NEW.actor_auth_user_id AND r.request_key=NEW.request_key));
  SELECT RAISE(ABORT,'refund_order_changed') WHERE NEW.state!='requested' OR NEW.revision!=1 OR NEW.last_action_id IS NOT NULL
    OR NEW.updated_at!=NEW.created_at OR NOT EXISTS(SELECT 1 FROM orders o JOIN commerce_payment_captures c ON c.order_id=o.id
      WHERE o.id=NEW.order_id AND o.seller_id=NEW.seller_id AND o.commerce_environment=NEW.commerce_environment
        AND o.commerce_version=1 AND o.revision=NEW.order_revision AND (o.checkout_state='paid' OR (o.checkout_state='partially_refunded' AND EXISTS(SELECT 1 FROM commerce_refund_order_totals t WHERE t.order_id=o.id AND t.refunded_amount<o.total_amount))) AND o.payment_review=0
        AND c.id=NEW.capture_id AND c.capture_kind='order_payment' AND c.amount=o.total_amount AND c.currency='IDR');
  SELECT RAISE(ABORT,'refund_actor_forbidden') WHERE NOT (
    (NEW.actor_kind='merchant' AND EXISTS(SELECT 1 FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id
      WHERE m.seller_id=NEW.seller_id AND m.auth_user_id=NEW.actor_auth_user_id AND m.role!='viewer' AND s.status='active'))
    OR (NEW.actor_kind='buyer' AND EXISTS(SELECT 1 FROM orders o LEFT JOIN commerce_order_owners a ON a.order_id=o.id
      WHERE o.id=NEW.order_id AND COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=NEW.actor_auth_user_id)));
  SELECT RAISE(ABORT,'refund_content_invalid') WHERE json_type(NEW.data_json) IS NOT 'object'
    OR json_type(NEW.data_json,'$.reason') IS NOT 'text' OR json_extract(NEW.data_json,'$.reason') NOT IN ('not_received','damaged','wrong_item','not_as_described','file_problem','changed_mind','other')
    OR json_type(NEW.data_json,'$.note') IS NOT 'text' OR length(trim(json_extract(NEW.data_json,'$.note'))) NOT BETWEEN 3 AND 2000
    OR json_type(NEW.data_json,'$.items') IS NOT 'array' OR json_array_length(NEW.data_json,'$.items')>50
    OR json_type(NEW.data_json,'$.shippingAmount') IS NOT 'integer' OR json_extract(NEW.data_json,'$.shippingAmount')!=NEW.shipping_amount
    OR NEW.amount!=NEW.shipping_amount+COALESCE((SELECT SUM(json_extract(value,'$.amount')) FROM json_each(NEW.data_json,'$.items')),0)
    OR (SELECT COUNT(DISTINCT json_extract(value,'$.orderItemId')) FROM json_each(NEW.data_json,'$.items'))!=json_array_length(NEW.data_json,'$.items');
  SELECT RAISE(ABORT,'refund_allocation_exceeded') WHERE EXISTS(SELECT 1 FROM json_each(NEW.data_json,'$.items') line
    WHERE json_type(line.value) IS NOT 'object' OR json_type(line.value,'$.orderItemId') IS NOT 'text'
      OR json_type(line.value,'$.amount') IS NOT 'integer' OR json_extract(line.value,'$.amount')<1
      OR NOT EXISTS(SELECT 1 FROM order_items i WHERE i.id=json_extract(line.value,'$.orderItemId') AND i.order_id=NEW.order_id AND i.seller_id=NEW.seller_id
        AND i.product_type IN ('physical','digital') AND i.quantity*i.unit_price_amount>=json_extract(line.value,'$.amount')+COALESCE((
          SELECT SUM(ri.amount) FROM commerce_refund_items ri JOIN commerce_refunds r ON r.id=ri.refund_id
          WHERE ri.order_item_id=i.id AND (r.state IN ('requested','approved') OR EXISTS(SELECT 1 FROM commerce_refund_disputes d WHERE d.refund_id=r.id AND d.state IN ('open','awaiting_buyer','awaiting_store')))),0)));
  SELECT RAISE(ABORT,'refund_allocation_exceeded') WHERE NEW.shipping_amount+COALESCE((SELECT SUM(r.shipping_amount)
    FROM commerce_refunds r WHERE r.order_id=NEW.order_id AND (r.state IN ('requested','approved') OR EXISTS(SELECT 1 FROM commerce_refund_disputes d WHERE d.refund_id=r.id AND d.state IN ('open','awaiting_buyer','awaiting_store')))),0)>(SELECT shipping_amount FROM orders WHERE id=NEW.order_id);
  SELECT RAISE(ABORT,'refund_request_limit') WHERE (SELECT COUNT(*) FROM commerce_refunds r
    WHERE r.order_id=NEW.order_id AND r.created_at>=strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'-1 hour'))>=20;
END;

DROP TRIGGER commerce_refund_action_guard;
CREATE TRIGGER commerce_refund_action_guard BEFORE INSERT ON commerce_refund_actions BEGIN
  SELECT RAISE(ABORT,'refund_immutable') WHERE EXISTS(SELECT 1 FROM commerce_refund_actions a
    WHERE a.sequence=NEW.sequence OR a.id=NEW.id OR (a.actor_auth_user_id=NEW.actor_auth_user_id AND a.request_key=NEW.request_key));
  SELECT RAISE(ABORT,'refund_revision_conflict') WHERE NOT EXISTS(SELECT 1 FROM commerce_refunds r JOIN orders o ON o.id=r.order_id
    WHERE r.id=NEW.refund_id AND r.seller_id=NEW.seller_id AND r.state='requested' AND r.revision=NEW.previous_revision
      AND o.revision=NEW.order_revision AND (NEW.kind!='approve' OR ((o.checkout_state='paid' OR (o.checkout_state='partially_refunded' AND EXISTS(SELECT 1 FROM commerce_refund_order_totals t WHERE t.order_id=o.id AND t.refunded_amount<o.total_amount))) AND o.payment_review=0)));
  SELECT RAISE(ABORT,'refund_actor_forbidden') WHERE NOT (
    (NEW.actor_kind='merchant' AND EXISTS(SELECT 1 FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id
      WHERE m.seller_id=NEW.seller_id AND m.auth_user_id=NEW.actor_auth_user_id AND m.role!='viewer' AND s.status='active')
      AND (NEW.kind IN ('approve','decline') OR (NEW.kind='withdraw' AND EXISTS(SELECT 1 FROM commerce_refunds r
        WHERE r.id=NEW.refund_id AND r.actor_kind='merchant' AND r.actor_auth_user_id=NEW.actor_auth_user_id))))
    OR (NEW.actor_kind='buyer' AND NEW.kind='withdraw' AND EXISTS(SELECT 1 FROM commerce_refunds r JOIN orders o ON o.id=r.order_id
      LEFT JOIN commerce_order_owners a ON a.order_id=o.id WHERE r.id=NEW.refund_id
        AND COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=NEW.actor_auth_user_id)));
END;

DROP VIEW commerce_refund_handoff_sources;
CREATE VIEW commerce_refund_handoff_sources AS
SELECT r.id AS refund_id,b.id AS bank_id,a.id AS settlement_id,r.revision AS refund_revision,o.revision AS order_revision,
  (SELECT COALESCE(SUM(1+(state='ready')),0) FROM commerce_refund_attachments WHERE refund_id=r.id) AS evidence_version,
  json_object('version',1,'provider','doku','method','bca_virtual_account','environment',r.commerce_environment,
    'brandId',sn.client_id,'invoiceNumber',o.id,'transactionDate',json_extract(p.body_json,'$.trxDateTime'),
    'transactionAmount',c.amount,'currency','IDR','refundAmount',r.amount,'shippingRefundAmount',r.shipping_amount,
    'captureId',c.id,'paymentReference',c.provider_reference,'credentialFingerprint',sn.credential_fingerprint,
    'settlementId',a.id,'settlementReference',sr.provider_reference,'bankId',b.id,
    'items',json((SELECT json_group_array(json_object('orderItemId',i.order_item_id,'amount',i.amount))
      FROM (SELECT order_item_id,amount FROM commerce_refund_items WHERE refund_id=r.id ORDER BY order_item_id) i))) AS snapshot_json
FROM commerce_refunds r JOIN orders o ON o.id=r.order_id AND o.seller_id=r.seller_id AND o.commerce_environment=r.commerce_environment
JOIN commerce_refund_current_bank b ON b.refund_id=r.id
JOIN commerce_payment_captures c ON c.id=r.capture_id AND c.order_id=o.id AND c.provider='doku'
  AND c.capture_kind='order_payment' AND c.amount=o.total_amount AND c.currency='IDR'
JOIN commerce_snap_payment_bindings sn ON sn.order_id=o.id
JOIN commerce_snap_payment_receipts p ON p.id=(SELECT x.id FROM commerce_snap_payment_receipts x
  WHERE x.order_id=o.id AND x.operation='bca-notification' AND x.payment_reference=c.provider_reference ORDER BY x.received_at,x.id LIMIT 1)
JOIN commerce_settlement_assessments a ON a.sequence=(SELECT MAX(x.sequence) FROM commerce_settlement_assessments x WHERE x.capture_id=c.id)
JOIN commerce_settlement_results sr ON sr.assessment_sequence=a.sequence AND sr.state='settled'
JOIN commerce_settlement_source_freshness sf ON sf.assessment_sequence=a.sequence AND sf.current=1
WHERE r.state='approved' AND (o.checkout_state='paid' OR (o.checkout_state='partially_refunded' AND EXISTS(SELECT 1 FROM commerce_refund_order_totals t WHERE t.order_id=o.id AND t.refunded_amount<o.total_amount))) AND o.payment_review=0
  AND json_extract(o.snapshot_json,'$.checkout.paymentFlow')='snap_bca'
  AND json_extract(p.body_json,'$.trxId')=o.id AND julianday(json_extract(p.body_json,'$.trxDateTime')) IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM commerce_payment_captures x WHERE x.order_id=o.id AND x.capture_kind='duplicate_payment')
  AND NOT EXISTS(SELECT 1 FROM commerce_refund_disputes d WHERE d.refund_id=r.id AND d.state IN ('open','awaiting_buyer','awaiting_store'));

DROP TRIGGER commerce_digital_grant_guard;
CREATE TRIGGER commerce_digital_grant_guard BEFORE INSERT ON commerce_digital_download_grants
BEGIN
  SELECT RAISE(ABORT,'commerce_digital_access_changed') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_digital_purchases p JOIN commerce_digital_entitlements e ON e.order_item_id=p.order_item_id
    JOIN orders o ON o.id=p.order_id LEFT JOIN commerce_order_owners a ON a.order_id=o.id
    WHERE p.order_item_id=NEW.order_item_id AND (o.checkout_state='paid' OR (o.checkout_state='partially_refunded' AND EXISTS(SELECT 1 FROM commerce_refund_order_totals t WHERE t.order_id=o.id AND t.refunded_amount<o.total_amount))) AND NOT EXISTS(SELECT 1 FROM commerce_digital_refund_revocations r WHERE r.order_item_id=p.order_item_id) AND o.payment_review=0
      AND COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=NEW.auth_user_id
      AND NEW.expires_at=strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'+1 day')
  );
  SELECT RAISE(ABORT,'commerce_digital_download_limit') WHERE (SELECT COUNT(*) FROM commerce_digital_download_grants
    WHERE order_item_id=NEW.order_item_id AND auth_user_id=NEW.auth_user_id
      AND created_at>strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'-1 hour'))>=20;
END;

DROP TRIGGER commerce_digital_download_guard;
CREATE TRIGGER commerce_digital_download_guard BEFORE INSERT ON commerce_digital_download_requests
BEGIN
  SELECT RAISE(ABORT,'commerce_digital_access_changed') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_digital_download_grants g JOIN commerce_digital_purchases p ON p.order_item_id=g.order_item_id
    JOIN orders o ON o.id=p.order_id LEFT JOIN commerce_order_owners a ON a.order_id=o.id
    WHERE g.id=NEW.grant_id AND g.expires_at>NEW.authorized_at AND (o.checkout_state='paid' OR (o.checkout_state='partially_refunded' AND EXISTS(SELECT 1 FROM commerce_refund_order_totals t WHERE t.order_id=o.id AND t.refunded_amount<o.total_amount))) AND NOT EXISTS(SELECT 1 FROM commerce_digital_refund_revocations r WHERE r.order_item_id=p.order_item_id) AND o.payment_review=0
      AND COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=g.auth_user_id
  );
  SELECT RAISE(ABORT,'commerce_digital_download_limit') WHERE (SELECT COUNT(*) FROM commerce_digital_download_requests
    WHERE grant_id=NEW.grant_id AND authorized_at>strftime('%Y-%m-%dT%H:%M:%fZ',NEW.authorized_at,'-1 hour'))>=300;
END;

DROP TRIGGER commerce_digital_challenge_guard;
CREATE TRIGGER commerce_digital_challenge_guard BEFORE INSERT ON commerce_digital_part_challenges
BEGIN
  SELECT RAISE(ABORT,'commerce_digital_access_changed') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_digital_download_grants g JOIN commerce_digital_purchases p ON p.order_item_id=g.order_item_id
    JOIN orders o ON o.id=p.order_id LEFT JOIN commerce_order_owners a ON a.order_id=o.id
    JOIN digital_product_versions v ON v.id=p.version_id JOIN digital_file_uploads u ON u.id=v.upload_id
    WHERE g.id=NEW.grant_id AND g.expires_at>NEW.created_at AND (o.checkout_state='paid' OR (o.checkout_state='partially_refunded' AND EXISTS(SELECT 1 FROM commerce_refund_order_totals t WHERE t.order_id=o.id AND t.refunded_amount<o.total_amount))) AND NOT EXISTS(SELECT 1 FROM commerce_digital_refund_revocations r WHERE r.order_item_id=p.order_item_id) AND o.payment_review=0
      AND u.state='ready' AND NEW.part_number<=u.part_count
      AND COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=g.auth_user_id
  );
END;

DROP TRIGGER commerce_digital_receipt_guard;
CREATE TRIGGER commerce_digital_receipt_guard BEFORE INSERT ON commerce_digital_part_receipts
BEGIN
  SELECT RAISE(ABORT,'commerce_digital_proof_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_digital_part_challenges c JOIN commerce_digital_download_grants g ON g.id=c.grant_id
    JOIN commerce_digital_purchases p ON p.order_item_id=g.order_item_id JOIN orders o ON o.id=p.order_id
    LEFT JOIN commerce_order_owners a ON a.order_id=o.id
    WHERE c.grant_id=NEW.grant_id AND c.part_number=NEW.part_number AND c.proof_hash=NEW.proof_hash
      AND g.expires_at>NEW.verified_at AND (o.checkout_state='paid' OR (o.checkout_state='partially_refunded' AND EXISTS(SELECT 1 FROM commerce_refund_order_totals t WHERE t.order_id=o.id AND t.refunded_amount<o.total_amount))) AND NOT EXISTS(SELECT 1 FROM commerce_digital_refund_revocations r WHERE r.order_item_id=p.order_item_id) AND o.payment_review=0
      AND COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=g.auth_user_id
  );
END;

DROP TRIGGER commerce_digital_delivery_guard;
CREATE TRIGGER commerce_digital_delivery_guard BEFORE INSERT ON commerce_digital_deliveries
BEGIN
  SELECT RAISE(ABORT,'commerce_digital_proof_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_digital_download_grants g JOIN commerce_digital_purchases p ON p.order_item_id=g.order_item_id
    JOIN digital_product_versions v ON v.id=p.version_id JOIN digital_file_uploads u ON u.id=v.upload_id
    JOIN orders o ON o.id=p.order_id LEFT JOIN commerce_order_owners a ON a.order_id=o.id
    WHERE g.id=NEW.grant_id AND p.order_item_id=NEW.order_item_id AND g.auth_user_id=NEW.auth_user_id
      AND g.expires_at>NEW.verified_at AND (o.checkout_state='paid' OR (o.checkout_state='partially_refunded' AND EXISTS(SELECT 1 FROM commerce_refund_order_totals t WHERE t.order_id=o.id AND t.refunded_amount<o.total_amount))) AND NOT EXISTS(SELECT 1 FROM commerce_digital_refund_revocations r WHERE r.order_item_id=p.order_item_id) AND o.payment_review=0
      AND COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=g.auth_user_id
      AND (SELECT COUNT(*) FROM commerce_digital_part_receipts r WHERE r.grant_id=g.id)=u.part_count
  );
END;

-- Once native refund evidence exists, order state cannot drift from its totals.
CREATE TRIGGER refund_order_projection_guard BEFORE UPDATE OF checkout_state,status ON orders
WHEN EXISTS(SELECT 1 FROM commerce_refund_order_totals WHERE order_id=OLD.id)
BEGIN
  SELECT RAISE(ABORT,'refund_order_projection_mismatch') WHERE
    NEW.checkout_state IS NOT (SELECT CASE WHEN refunded_amount=NEW.total_amount THEN 'refunded' ELSE 'partially_refunded' END FROM commerce_refund_order_totals WHERE order_id=NEW.id)
    OR NEW.status IS NOT (SELECT CASE WHEN refunded_amount=NEW.total_amount THEN 'refunded' ELSE 'paid' END FROM commerce_refund_order_totals WHERE order_id=NEW.id);
END;
