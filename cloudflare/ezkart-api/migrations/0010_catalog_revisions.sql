-- A product revision covers its fields and variants, including stock consumed by
-- payment. The first statement of an editor save checks it inside the same D1
-- transaction as all subsequent changes; a preflight read alone is not a lock.
ALTER TABLE products ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0);

CREATE TRIGGER catalog_revision_guard
BEFORE INSERT ON seller_events
WHEN NEW.event_type = 'product.updated'
BEGIN
  SELECT RAISE(ABORT, 'catalog_revision_conflict') WHERE NOT EXISTS (
    SELECT 1 FROM products WHERE id = NEW.entity_id AND seller_id = NEW.seller_id
      AND revision = json_extract(NEW.payload_json, '$.expectedRevision')
      AND json_type(NEW.payload_json, '$.expectedRevision') = 'integer'
  );
END;

CREATE TRIGGER catalog_product_revision
AFTER UPDATE ON products
WHEN NEW.revision = OLD.revision
BEGIN
  UPDATE products SET revision = revision + 1 WHERE id = NEW.id;
END;

CREATE TRIGGER catalog_revision_monotonic
BEFORE UPDATE OF revision ON products
WHEN NEW.revision != OLD.revision + 1
BEGIN
  SELECT RAISE(ABORT, 'catalog_revision_conflict');
END;

CREATE TRIGGER catalog_variant_insert_revision
AFTER INSERT ON product_variants
BEGIN
  UPDATE products SET revision = revision + 1, updated_at = NEW.updated_at WHERE id = NEW.product_id;
END;

CREATE TRIGGER catalog_variant_update_revision
AFTER UPDATE ON product_variants
BEGIN
  UPDATE products SET revision = revision + 1, updated_at = NEW.updated_at WHERE id = NEW.product_id;
END;

CREATE TRIGGER catalog_variant_delete_revision
AFTER DELETE ON product_variants
BEGIN
  UPDATE products SET revision = revision + 1 WHERE id = OLD.product_id;
END;

CREATE TRIGGER catalog_variant_identity
BEFORE UPDATE OF id, seller_id, product_id ON product_variants
WHEN NEW.id != OLD.id OR NEW.seller_id != OLD.seller_id OR NEW.product_id != OLD.product_id
BEGIN
  SELECT RAISE(ABORT, 'catalog_variant_identity');
END;

-- An order's product identity is retained for fulfillment, reporting and returns.
-- Archiving removes a product from sale without deleting this history.
CREATE TRIGGER catalog_ordered_product_delete
BEFORE DELETE ON products
WHEN EXISTS (SELECT 1 FROM order_items WHERE product_id = OLD.id AND seller_id = OLD.seller_id)
BEGIN
  SELECT RAISE(ABORT, 'catalog_ordered_product');
END;
