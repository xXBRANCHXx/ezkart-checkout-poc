-- Delivery is one prerequisite for earnings release, never settlement or funds.
-- Use applied provider evidence and complete original downloads, not order labels.
CREATE INDEX idx_shipping_delivery_source ON commerce_shipping_inbox(shipment_id,received_sequence) WHERE applied_at IS NOT NULL;
CREATE VIEW commerce_physical_delivery_sources AS
SELECT s.seller_id,s.order_id,s.commerce_environment,s.id AS shipment_id,s.provider_id,s.provider_account_hash,
  n.id AS event_id,n.received_sequence AS event_sequence,
  CASE WHEN h.key=COALESCE(json_array_length(n.payload_json,'$.history'),0) THEN -1 ELSE CAST(h.key AS INTEGER) END AS event_index,
  s.delivered_at,n.applied_at AS confirmed_at
FROM commerce_shipments s INDEXED BY idx_shipments_order
CROSS JOIN commerce_shipping_inbox n INDEXED BY idx_shipping_delivery_source ON n.shipment_id=s.id
  AND n.provider_id=s.provider_id AND n.commerce_environment=s.commerce_environment,
  json_each(json_insert(COALESCE(json_extract(n.payload_json,'$.history'),'[]'),'$[#]',json(n.payload_json))) h
WHERE s.provider_id IS NOT NULL AND s.provider_account_hash IS NOT NULL AND s.delivered_at IS NOT NULL AND n.applied_at IS NOT NULL
  AND json_extract(h.value,'$.kind')='status' AND json_extract(h.value,'$.status')='delivered'
  AND COALESCE(NULLIF(json_extract(h.value,'$.updatedAt'),''),n.received_at)=s.delivered_at
  AND (h.key=COALESCE(json_array_length(n.payload_json,'$.history'),0)
    OR (n.source IN ('create','refresh') AND NULLIF(json_extract(h.value,'$.updatedAt'),'') IS NOT NULL));

CREATE VIEW commerce_order_delivery_items AS
SELECT o.seller_id,o.id AS order_id,o.commerce_environment,c.id AS capture_id,i.id AS order_item_id,i.product_type,i.quantity,
  CASE WHEN i.product_type='physical' AND COALESCE(json_extract(o.snapshot_json,'$.shipping.skipped'),1)=0
    AND COALESCE(json_extract(o.snapshot_json,'$.shipping.kind'),'carrier')!='none'
    AND (EXISTS(SELECT 1 FROM inventory_reservations h WHERE h.order_item_id=i.id AND h.seller_id=i.seller_id
      AND h.order_id=o.id AND h.quantity=i.quantity AND h.state='committed')
      OR EXISTS(SELECT 1 FROM commerce_stock_allocations x WHERE x.order_item_id=i.id AND x.seller_id=i.seller_id AND x.quantity=i.quantity))
    THEN (SELECT json_object('orderItemId',i.id,'type','physical','quantity',i.quantity,'shipmentId',s.shipment_id,
      'providerId',s.provider_id,'providerAccountHash',s.provider_account_hash,'eventId',s.event_id,'eventIndex',s.event_index,
      'deliveredAt',s.delivered_at,'confirmedAt',s.confirmed_at)
      FROM commerce_physical_delivery_sources s WHERE s.order_id=o.id AND s.seller_id=o.seller_id AND s.commerce_environment=o.commerce_environment
      ORDER BY s.event_sequence,s.event_index,s.shipment_id LIMIT 1)
    WHEN i.product_type='digital' AND p.version_id=json_extract(i.fulfillment_snapshot_json,'$.digitalFile.id')
      AND d.evidence_version=1 AND g.auth_user_id=d.auth_user_id AND g.order_item_id=i.id
      AND (SELECT COUNT(*) FROM commerce_digital_part_receipts r WHERE r.grant_id=g.id)=u.part_count
    THEN json_object('orderItemId',i.id,'type','digital','quantity',i.quantity,'versionId',p.version_id,
      'grantId',d.grant_id,'evidenceVersion',d.evidence_version,'parts',u.part_count,'confirmedAt',d.verified_at)
    ELSE NULL END AS evidence_json
FROM orders o JOIN commerce_payment_captures c ON c.order_id=o.id AND c.seller_id=o.seller_id
  AND c.commerce_environment=o.commerce_environment AND c.capture_kind='order_payment' AND c.amount=o.total_amount AND c.currency=o.currency
JOIN order_items i ON i.order_id=o.id AND i.seller_id=o.seller_id
LEFT JOIN commerce_digital_purchases p ON p.order_item_id=i.id AND p.order_id=o.id AND p.seller_id=o.seller_id
LEFT JOIN commerce_digital_entitlements a ON a.order_item_id=p.order_item_id AND a.capture_id=c.id
LEFT JOIN commerce_digital_deliveries d ON d.order_item_id=a.order_item_id
LEFT JOIN commerce_digital_download_grants g ON g.id=d.grant_id
LEFT JOIN digital_product_versions v ON v.id=p.version_id AND v.seller_id=p.seller_id AND v.product_id=p.product_id
LEFT JOIN digital_file_uploads u ON u.id=v.upload_id
WHERE o.commerce_version=1;

CREATE VIEW commerce_order_delivery_accounting AS
SELECT x.seller_id,x.order_id,x.commerce_environment,x.capture_id,COUNT(*) AS item_count,
  MAX(json_extract(x.evidence_json,'$.confirmedAt')) AS confirmed_at,
  json_object('version',1,'captureId',x.capture_id,'orderId',x.order_id,
    'items',json((SELECT json_group_array(json(evidence_json)) FROM (
      SELECT z.evidence_json FROM commerce_order_delivery_items z WHERE z.capture_id=x.capture_id ORDER BY z.order_item_id)))) AS source_json
FROM commerce_order_delivery_items x GROUP BY x.seller_id,x.order_id,x.commerce_environment,x.capture_id
HAVING COUNT(*) BETWEEN 1 AND 50 AND COUNT(x.evidence_json)=COUNT(*);

CREATE TABLE commerce_order_delivery_receipts (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  seller_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  commerce_environment TEXT NOT NULL CHECK (commerce_environment IN ('sandbox','production')),
  capture_id TEXT NOT NULL UNIQUE REFERENCES commerce_payment_captures(id) ON DELETE RESTRICT,
  item_count INTEGER NOT NULL CHECK (item_count BETWEEN 1 AND 50),
  source_json TEXT NOT NULL CHECK (json_valid(source_json)),
  confirmed_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  FOREIGN KEY(seller_id,order_id) REFERENCES orders(seller_id,id) ON DELETE RESTRICT
);
CREATE INDEX idx_order_delivery_receipts_seller ON commerce_order_delivery_receipts(seller_id,commerce_environment,sequence);
CREATE TRIGGER commerce_delivery_receipt_source BEFORE INSERT ON commerce_order_delivery_receipts BEGIN
  SELECT RAISE(ABORT,'commerce_delivery_immutable') WHERE EXISTS(SELECT 1 FROM commerce_order_delivery_receipts
    WHERE id=NEW.id OR sequence=NEW.sequence OR capture_id=NEW.capture_id);
  SELECT RAISE(ABORT,'commerce_delivery_source_mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_order_delivery_accounting a WHERE NEW.id='delivery_'||a.capture_id AND a.capture_id=NEW.capture_id
      AND a.order_id=NEW.order_id AND a.seller_id=NEW.seller_id AND a.commerce_environment=NEW.commerce_environment
      AND a.item_count=NEW.item_count AND a.confirmed_at=NEW.confirmed_at AND a.source_json=NEW.source_json);
END;
CREATE TRIGGER commerce_delivery_receipt_no_update BEFORE UPDATE ON commerce_order_delivery_receipts BEGIN SELECT RAISE(ABORT,'commerce_delivery_immutable'); END;
CREATE TRIGGER commerce_delivery_receipt_no_delete BEFORE DELETE ON commerce_order_delivery_receipts BEGIN SELECT RAISE(ABORT,'commerce_delivery_immutable'); END;

-- Completion and its receipt share the existing courier/download transaction.
CREATE TRIGGER commerce_delivery_after_download AFTER INSERT ON commerce_digital_deliveries BEGIN
  INSERT INTO commerce_order_delivery_receipts(id,seller_id,order_id,commerce_environment,capture_id,item_count,source_json,confirmed_at,recorded_at)
  SELECT 'delivery_'||a.capture_id,a.seller_id,a.order_id,a.commerce_environment,a.capture_id,a.item_count,a.source_json,a.confirmed_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM commerce_order_delivery_accounting a WHERE a.order_id=(SELECT order_id FROM commerce_digital_purchases WHERE order_item_id=NEW.order_item_id)
    AND NOT EXISTS(SELECT 1 FROM commerce_order_delivery_receipts r WHERE r.capture_id=a.capture_id);
END;
CREATE TRIGGER commerce_delivery_after_courier AFTER UPDATE OF applied_at ON commerce_shipping_inbox
WHEN NEW.applied_at IS NOT NULL AND OLD.applied_at IS NULL BEGIN
  INSERT INTO commerce_order_delivery_receipts(id,seller_id,order_id,commerce_environment,capture_id,item_count,source_json,confirmed_at,recorded_at)
  SELECT 'delivery_'||a.capture_id,a.seller_id,a.order_id,a.commerce_environment,a.capture_id,a.item_count,a.source_json,a.confirmed_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM commerce_order_delivery_accounting a WHERE a.order_id=(SELECT order_id FROM commerce_shipments WHERE id=NEW.shipment_id)
    AND NOT EXISTS(SELECT 1 FROM commerce_order_delivery_receipts r WHERE r.capture_id=a.capture_id);
END;

-- SQLite REPLACE can otherwise evade a delete trigger. Retain original proof.
CREATE TRIGGER commerce_shipping_inbox_no_replace BEFORE INSERT ON commerce_shipping_inbox
WHEN EXISTS(SELECT 1 FROM commerce_shipping_inbox WHERE id=NEW.id OR received_sequence=NEW.received_sequence)
BEGIN SELECT RAISE(ABORT,'commerce_immutable_shipping_event'); END;
CREATE TRIGGER commerce_digital_purchase_no_replace BEFORE INSERT ON commerce_digital_purchases
WHEN EXISTS(SELECT 1 FROM commerce_digital_purchases WHERE order_item_id=NEW.order_item_id)
BEGIN SELECT RAISE(ABORT,'commerce_immutable_digital_purchase'); END;
CREATE TRIGGER commerce_digital_entitlement_no_replace BEFORE INSERT ON commerce_digital_entitlements
WHEN EXISTS(SELECT 1 FROM commerce_digital_entitlements WHERE order_item_id=NEW.order_item_id)
BEGIN SELECT RAISE(ABORT,'commerce_immutable_digital_entitlement'); END;
CREATE TRIGGER commerce_digital_grant_no_replace BEFORE INSERT ON commerce_digital_download_grants
WHEN EXISTS(SELECT 1 FROM commerce_digital_download_grants WHERE id=NEW.id OR (auth_user_id=NEW.auth_user_id AND request_key=NEW.request_key))
BEGIN SELECT RAISE(ABORT,'commerce_immutable_download_grant'); END;
CREATE TRIGGER commerce_digital_challenge_no_replace BEFORE INSERT ON commerce_digital_part_challenges
WHEN EXISTS(SELECT 1 FROM commerce_digital_part_challenges WHERE grant_id=NEW.grant_id AND part_number=NEW.part_number)
BEGIN SELECT RAISE(ABORT,'commerce_immutable_download_challenge'); END;
CREATE TRIGGER commerce_digital_receipt_no_replace BEFORE INSERT ON commerce_digital_part_receipts
WHEN EXISTS(SELECT 1 FROM commerce_digital_part_receipts WHERE grant_id=NEW.grant_id AND part_number=NEW.part_number)
BEGIN SELECT RAISE(ABORT,'commerce_immutable_download_receipt'); END;
CREATE TRIGGER commerce_digital_delivery_no_replace BEFORE INSERT ON commerce_digital_deliveries
WHEN EXISTS(SELECT 1 FROM commerce_digital_deliveries WHERE order_item_id=NEW.order_item_id)
BEGIN SELECT RAISE(ABORT,'commerce_immutable_digital_delivery'); END;
