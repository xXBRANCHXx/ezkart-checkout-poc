-- Keep every seller's catalog within the product allowance even when two
-- create requests arrive concurrently. The Worker performs the same check to
-- return a friendly message; this trigger is the final database safeguard.
CREATE TRIGGER IF NOT EXISTS enforce_seller_product_limit
BEFORE INSERT ON products
WHEN (SELECT COUNT(*) FROM products WHERE seller_id = NEW.seller_id) >= 10
BEGIN
  SELECT RAISE(ABORT, 'seller_product_limit');
END;
