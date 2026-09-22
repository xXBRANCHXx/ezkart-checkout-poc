-- Keep the existing concurrent-create safeguard, using the store's saved plan.
DROP TRIGGER IF EXISTS enforce_seller_product_limit;
CREATE TRIGGER enforce_seller_product_limit
BEFORE INSERT ON products
WHEN NOT EXISTS (SELECT 1 FROM products WHERE id = NEW.id)
  AND (SELECT COUNT(*) FROM products WHERE seller_id = NEW.seller_id) >=
  (SELECT CASE WHEN plan = 'advanced' THEN 50 ELSE 10 END FROM sellers WHERE id = NEW.seller_id)
BEGIN
  SELECT RAISE(ABORT, 'seller_product_limit');
END;
