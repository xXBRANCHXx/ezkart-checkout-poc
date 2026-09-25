-- Private, immutable TEST migration evidence. These are rehearsal snapshots,
-- not active orders, payment captures, reservations or spendable wallet funds.
-- One batch INSERT and its trigger are one SQLite transaction, including replay
-- and ownership/catalog checks. There is deliberately no browser write route.
CREATE TABLE commerce_legacy_import_batches (
  id TEXT PRIMARY KEY CHECK (id='legacy_'||manifest_hash),
  manifest_hash TEXT NOT NULL UNIQUE CHECK (length(manifest_hash)=64 AND manifest_hash NOT GLOB '*[^a-f0-9]*'),
  manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json) AND length(CAST(manifest_json AS BLOB))<=400000),
  created_at TEXT NOT NULL
);
CREATE TABLE commerce_legacy_sources (
  id TEXT PRIMARY KEY,
  commerce_environment TEXT NOT NULL CHECK (commerce_environment='sandbox'),
  order_id TEXT NOT NULL,
  source_hash TEXT NOT NULL CHECK (length(source_hash)=64 AND source_hash NOT GLOB '*[^a-f0-9]*'),
  filename TEXT NOT NULL,
  source_json TEXT NOT NULL CHECK (json_valid(source_json)),
  created_at TEXT NOT NULL,
  UNIQUE(commerce_environment,order_id,source_hash)
);
CREATE TABLE commerce_legacy_import_entries (
  batch_id TEXT NOT NULL REFERENCES commerce_legacy_import_batches(id) ON DELETE RESTRICT,
  source_id TEXT NOT NULL REFERENCES commerce_legacy_sources(id) ON DELETE RESTRICT,
  seller_id TEXT REFERENCES sellers(id) ON DELETE RESTRICT,
  disposition TEXT NOT NULL CHECK (disposition IN ('seller','demo','unresolved')),
  ownership_basis TEXT NOT NULL CHECK (ownership_basis IN ('stored_seller','historical_shop','sandbox_demo','unresolved')),
  assessment_json TEXT NOT NULL CHECK (json_valid(assessment_json)),
  PRIMARY KEY(batch_id,source_id),
  CHECK ((disposition='seller' AND seller_id IS NOT NULL AND ownership_basis IN ('stored_seller','historical_shop'))
    OR (disposition!='seller' AND seller_id IS NULL AND ownership_basis IN ('sandbox_demo','unresolved')))
);
CREATE INDEX idx_legacy_import_seller ON commerce_legacy_import_entries(seller_id,batch_id);

CREATE TRIGGER commerce_legacy_batch_guard BEFORE INSERT ON commerce_legacy_import_batches
BEGIN
  SELECT RAISE(ABORT,'legacy_invalid_manifest') WHERE json_extract(NEW.manifest_json,'$.schema') IS NOT 1
    OR json_extract(NEW.manifest_json,'$.deployment') IS NOT 'test' OR json_extract(NEW.manifest_json,'$.environment') IS NOT 'sandbox'
    OR json_type(NEW.manifest_json,'$.records') IS NOT 'array' OR json_array_length(NEW.manifest_json,'$.records') NOT BETWEEN 1 AND 250
    OR json_extract(NEW.manifest_json,'$.summary.orders') IS NOT json_array_length(NEW.manifest_json,'$.records');
  SELECT RAISE(ABORT,'legacy_manifest_conflict') WHERE EXISTS (
    SELECT 1 FROM commerce_legacy_import_batches b WHERE b.id=NEW.id AND b.manifest_json!=NEW.manifest_json
  );
  SELECT RAISE(ABORT,'legacy_invalid_source') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.manifest_json,'$.records') r
    WHERE json_valid(json_extract(r.value,'$.source')) IS NOT 1
      OR json_extract(json_extract(r.value,'$.source'),'$.commerce_environment') IS NOT 'sandbox'
      OR json_extract(json_extract(r.value,'$.source'),'$.order_id') IS NOT json_extract(r.value,'$.assessment.orderId')
      OR json_extract(json_extract(r.value,'$.source'),'$.total') IS NOT json_extract(r.value,'$.assessment.total')
      OR json_extract(json_extract(r.value,'$.source'),'$.subtotal') IS NOT json_extract(r.value,'$.assessment.subtotal')
      OR json_extract(json_extract(r.value,'$.source'),'$.shipping_price') IS NOT json_extract(r.value,'$.assessment.shipping')
      OR json_extract(json_extract(r.value,'$.source'),'$.status') IS NOT json_extract(r.value,'$.assessment.status')
      OR EXISTS (SELECT 1 FROM commerce_legacy_sources s WHERE s.id=json_extract(r.value,'$.sourceId')
        AND (s.source_json!=json_extract(r.value,'$.source') OR s.source_hash!=json_extract(r.value,'$.sourceHash')
          OR s.filename!=json_extract(r.value,'$.filename') OR s.order_id!=json_extract(r.value,'$.assessment.orderId')))
  );
  SELECT RAISE(ABORT,'legacy_summary_mismatch') WHERE
    json_extract(NEW.manifest_json,'$.summary.total') IS NOT (SELECT SUM(json_extract(value,'$.assessment.total')) FROM json_each(NEW.manifest_json,'$.records'))
    OR json_extract(NEW.manifest_json,'$.summary.subtotal') IS NOT (SELECT SUM(json_extract(value,'$.assessment.subtotal')) FROM json_each(NEW.manifest_json,'$.records'))
    OR json_extract(NEW.manifest_json,'$.summary.shipping') IS NOT (SELECT SUM(json_extract(value,'$.assessment.shipping')) FROM json_each(NEW.manifest_json,'$.records'))
    OR json_extract(NEW.manifest_json,'$.summary.paidTotal') IS NOT (SELECT COALESCE(SUM(json_extract(value,'$.assessment.total')),0) FROM json_each(NEW.manifest_json,'$.records') WHERE json_extract(value,'$.assessment.status')='PAID')
    OR json_extract(NEW.manifest_json,'$.summary.paidOrders') IS NOT (SELECT COUNT(*) FROM json_each(NEW.manifest_json,'$.records') WHERE json_extract(value,'$.assessment.status')='PAID')
    OR json_extract(NEW.manifest_json,'$.summary.sellerOrders') IS NOT (SELECT COUNT(*) FROM json_each(NEW.manifest_json,'$.records') WHERE json_extract(value,'$.assessment.disposition')='seller')
    OR json_extract(NEW.manifest_json,'$.summary.demoOrders') IS NOT (SELECT COUNT(*) FROM json_each(NEW.manifest_json,'$.records') WHERE json_extract(value,'$.assessment.disposition')='demo')
    OR json_extract(NEW.manifest_json,'$.summary.unresolvedOrders') IS NOT (SELECT COUNT(*) FROM json_each(NEW.manifest_json,'$.records') WHERE json_extract(value,'$.assessment.disposition')='unresolved');
  SELECT RAISE(ABORT,'legacy_duplicate_order') WHERE (SELECT COUNT(DISTINCT json_extract(value,'$.assessment.orderId')) FROM json_each(NEW.manifest_json,'$.records')) != json_array_length(NEW.manifest_json,'$.records');
  SELECT RAISE(ABORT,'legacy_provider_reference_conflict') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.manifest_json,'$.records') r,commerce_legacy_sources s,
      json_each('["payment_reference","payment_request_id","midtrans_transaction_id"]') field
    WHERE s.order_id!=json_extract(r.value,'$.assessment.orderId')
      AND json_extract(s.source_json,'$.payment_provider')=json_extract(json_extract(r.value,'$.source'),'$.payment_provider')
      AND COALESCE(json_extract(s.source_json,'$.'||field.value),'')!=''
      AND json_extract(s.source_json,'$.'||field.value)=json_extract(json_extract(r.value,'$.source'),'$.'||field.value)
  );
  -- Replaying an acknowledged immutable batch is independent of later catalog
  -- edits. New assessments must still prove their ownership at commit time.
  SELECT RAISE(ABORT,'legacy_owner_changed') WHERE NOT EXISTS (SELECT 1 FROM commerce_legacy_import_batches WHERE id=NEW.id) AND EXISTS (
    SELECT 1 FROM json_each(NEW.manifest_json,'$.records') r WHERE json_extract(r.value,'$.assessment.disposition')='seller' AND (
      NOT EXISTS (SELECT 1 FROM sellers s WHERE s.id=json_extract(r.value,'$.assessment.sellerId'))
      OR (json_extract(r.value,'$.assessment.basis')='stored_seller' AND json_extract(json_extract(r.value,'$.source'),'$.seller_id') IS NOT json_extract(r.value,'$.assessment.sellerId'))
      OR (json_extract(r.value,'$.assessment.basis')='historical_shop' AND (
        COALESCE(json_extract(json_extract(r.value,'$.source'),'$.seller_id'),'')!=''
        OR json_extract(r.value,'$.assessment.evidence.shop') IS NOT json_extract(json_extract(r.value,'$.source'),'$.shop')
        OR NOT EXISTS (SELECT 1 FROM seller_memberships m WHERE m.seller_id=json_extract(r.value,'$.assessment.sellerId')
          AND m.auth_user_id=json_extract(r.value,'$.assessment.evidence.authUserId') AND m.role='owner'
          AND m.created_at=json_extract(r.value,'$.assessment.evidence.membershipCreatedAt'))
        OR EXISTS (SELECT 1 FROM seller_memberships m WHERE m.seller_id=json_extract(r.value,'$.assessment.sellerId') AND m.role='owner'
          AND (m.created_at<json_extract(r.value,'$.assessment.evidence.membershipCreatedAt')
            OR (m.created_at=json_extract(r.value,'$.assessment.evidence.membershipCreatedAt') AND m.auth_user_id<json_extract(r.value,'$.assessment.evidence.authUserId'))))
        OR NOT EXISTS (SELECT 1 FROM json_each(NEW.manifest_json,'$.records') a
          WHERE json_extract(a.value,'$.sourceHash')=json_extract(r.value,'$.assessment.evidence.anchorSourceHash')
            AND json_extract(json_extract(a.value,'$.source'),'$.seller_id')=json_extract(r.value,'$.assessment.sellerId')
            AND json_extract(json_extract(a.value,'$.source'),'$.shop')=json_extract(r.value,'$.assessment.evidence.shop'))
        OR json_array_length(r.value,'$.assessment.itemLinks') IS NOT (SELECT COUNT(*) FROM json_each(json_extract(r.value,'$.source'),'$.items') i WHERE json_extract(i.value,'$.id')!='EZK-SHIPPING')
        OR EXISTS (SELECT 1 FROM json_each(r.value,'$.assessment.itemLinks') i WHERE COALESCE(json_extract(i.value,'$.productId'),'')='')
      ))
    )
  );
  SELECT RAISE(ABORT,'legacy_product_changed') WHERE NOT EXISTS (SELECT 1 FROM commerce_legacy_import_batches WHERE id=NEW.id) AND EXISTS (
    SELECT 1 FROM json_each(NEW.manifest_json,'$.records') r,json_each(r.value,'$.assessment.itemLinks') i
    WHERE COALESCE(json_extract(i.value,'$.productId'),'')!='' AND NOT EXISTS (
      SELECT 1 FROM products p LEFT JOIN product_variants v ON v.product_id=p.id AND v.seller_id=p.seller_id AND v.id=json_extract(i.value,'$.variantId')
      WHERE p.id=json_extract(i.value,'$.productId') AND p.seller_id=json_extract(r.value,'$.assessment.sellerId')
        AND (json_extract(i.value,'$.variantId')='' OR v.id IS NOT NULL)
        AND (json_extract(i.value,'$.basis')!='unique_sku' OR 1=(
          (SELECT COUNT(*) FROM products x WHERE x.seller_id=p.seller_id AND x.sku=json_extract(i.value,'$.sku') AND NOT EXISTS (SELECT 1 FROM product_variants y WHERE y.product_id=x.id))
          + (SELECT COUNT(*) FROM product_variants x WHERE x.seller_id=p.seller_id AND x.sku=json_extract(i.value,'$.sku'))))
        AND (json_extract(r.value,'$.assessment.basis')!='historical_shop' OR json_extract(i.value,'$.basis')!='unique_sku' OR 1=(
          (SELECT COUNT(*) FROM products x WHERE x.sku=json_extract(i.value,'$.sku') AND NOT EXISTS (SELECT 1 FROM product_variants y WHERE y.product_id=x.id))
          + (SELECT COUNT(*) FROM product_variants x WHERE x.sku=json_extract(i.value,'$.sku'))))
        AND (json_extract(i.value,'$.basis')='stored_identity'
          OR (json_extract(i.value,'$.variantId')='' AND p.sku=json_extract(i.value,'$.sku') AND NOT EXISTS (SELECT 1 FROM product_variants x WHERE x.product_id=p.id))
          OR v.sku=json_extract(i.value,'$.sku'))
    )
  );
END;

CREATE TRIGGER commerce_legacy_batch_apply AFTER INSERT ON commerce_legacy_import_batches
BEGIN
  INSERT INTO commerce_legacy_sources(id,commerce_environment,order_id,source_hash,filename,source_json,created_at)
    SELECT json_extract(value,'$.sourceId'),'sandbox',json_extract(value,'$.assessment.orderId'),json_extract(value,'$.sourceHash'),
      json_extract(value,'$.filename'),json_extract(value,'$.source'),NEW.created_at FROM json_each(NEW.manifest_json,'$.records')
    WHERE true ON CONFLICT(commerce_environment,order_id,source_hash) DO NOTHING;
  INSERT INTO commerce_legacy_import_entries(batch_id,source_id,seller_id,disposition,ownership_basis,assessment_json)
    SELECT NEW.id,json_extract(value,'$.sourceId'),NULLIF(json_extract(value,'$.assessment.sellerId'),''),
      json_extract(value,'$.assessment.disposition'),json_extract(value,'$.assessment.basis'),json_extract(value,'$.assessment')
    FROM json_each(NEW.manifest_json,'$.records');
END;

CREATE TRIGGER commerce_legacy_source_receipt BEFORE INSERT ON commerce_legacy_sources
BEGIN
  SELECT RAISE(ABORT,'legacy_source_without_receipt') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_legacy_import_batches b,json_each(b.manifest_json,'$.records') r
    WHERE json_extract(r.value,'$.sourceId')=NEW.id AND json_extract(r.value,'$.sourceHash')=NEW.source_hash
      AND json_extract(r.value,'$.filename')=NEW.filename AND json_extract(r.value,'$.source')=NEW.source_json
      AND json_extract(r.value,'$.assessment.orderId')=NEW.order_id AND b.created_at=NEW.created_at
  );
END;
CREATE TRIGGER commerce_legacy_entry_receipt BEFORE INSERT ON commerce_legacy_import_entries
BEGIN
  SELECT RAISE(ABORT,'legacy_assessment_without_receipt') WHERE NOT EXISTS (
    SELECT 1 FROM commerce_legacy_import_batches b,json_each(b.manifest_json,'$.records') r
    WHERE b.id=NEW.batch_id AND json_extract(r.value,'$.sourceId')=NEW.source_id
      AND NULLIF(json_extract(r.value,'$.assessment.sellerId'),'') IS NEW.seller_id
      AND json_extract(r.value,'$.assessment.disposition')=NEW.disposition AND json_extract(r.value,'$.assessment.basis')=NEW.ownership_basis
      AND json_extract(r.value,'$.assessment')=NEW.assessment_json
  );
END;
CREATE TRIGGER commerce_legacy_batches_no_update BEFORE UPDATE ON commerce_legacy_import_batches BEGIN SELECT RAISE(ABORT,'legacy_immutable_import'); END;
CREATE TRIGGER commerce_legacy_batches_no_delete BEFORE DELETE ON commerce_legacy_import_batches BEGIN SELECT RAISE(ABORT,'legacy_immutable_import'); END;
CREATE TRIGGER commerce_legacy_sources_no_update BEFORE UPDATE ON commerce_legacy_sources BEGIN SELECT RAISE(ABORT,'legacy_immutable_source'); END;
CREATE TRIGGER commerce_legacy_sources_no_delete BEFORE DELETE ON commerce_legacy_sources BEGIN SELECT RAISE(ABORT,'legacy_immutable_source'); END;
CREATE TRIGGER commerce_legacy_entries_no_update BEFORE UPDATE ON commerce_legacy_import_entries BEGIN SELECT RAISE(ABORT,'legacy_immutable_assessment'); END;
CREATE TRIGGER commerce_legacy_entries_no_delete BEFORE DELETE ON commerce_legacy_import_entries BEGIN SELECT RAISE(ABORT,'legacy_immutable_assessment'); END;
