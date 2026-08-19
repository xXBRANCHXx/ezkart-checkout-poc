-- Subscription plans use customer-facing month/year cadences.
CREATE TABLE product_variants_next (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  options_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(options_json)),
  sku TEXT NOT NULL,
  price_amount INTEGER NOT NULL CHECK (price_amount >= 0),
  stock_quantity INTEGER,
  weight_grams INTEGER,
  billing_interval TEXT CHECK (billing_interval IS NULL OR billing_interval IN ('month', 'year')),
  billing_interval_count INTEGER CHECK (billing_interval_count IS NULL OR billing_interval_count BETWEEN 1 AND 120),
  image_source TEXT NOT NULL DEFAULT 'main',
  image_upload_id TEXT,
  sort_order INTEGER NOT NULL CHECK (sort_order BETWEEN 1 AND 100),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (seller_id, product_id, sku),
  UNIQUE (seller_id, product_id, sort_order),
  FOREIGN KEY (seller_id, product_id) REFERENCES products(seller_id, id) ON DELETE CASCADE,
  FOREIGN KEY (seller_id, image_upload_id) REFERENCES media_uploads(seller_id, id) ON DELETE RESTRICT
);

INSERT INTO product_variants_next (
  id, seller_id, product_id, name, options_json, sku, price_amount,
  stock_quantity, weight_grams, billing_interval, billing_interval_count,
  image_source, image_upload_id, sort_order, created_at, updated_at
)
SELECT
  id, seller_id, product_id, name, options_json, sku, price_amount,
  stock_quantity, weight_grams,
  CASE WHEN billing_interval = 'month' THEN 'month' ELSE NULL END,
  CASE WHEN billing_interval = 'month' THEN billing_interval_count ELSE NULL END,
  image_source, image_upload_id, sort_order, created_at, updated_at
FROM product_variants;

DROP TABLE product_variants;
ALTER TABLE product_variants_next RENAME TO product_variants;
CREATE INDEX idx_product_variants_product ON product_variants(seller_id, product_id, sort_order);
