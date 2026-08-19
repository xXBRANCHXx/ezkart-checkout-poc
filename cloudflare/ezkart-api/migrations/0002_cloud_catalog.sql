-- Cloud-backed product editing. Files remain in R2; D1 stores only metadata and
-- seller-scoped references to those objects.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS media_uploads (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 2097152),
  created_by_auth_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (seller_id, id)
);

CREATE TABLE IF NOT EXISTS product_variants (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  options_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(options_json)),
  sku TEXT NOT NULL,
  price_amount INTEGER NOT NULL CHECK (price_amount >= 0),
  stock_quantity INTEGER,
  weight_grams INTEGER,
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

CREATE TABLE IF NOT EXISTS product_drafts (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  product_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  snapshot_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(snapshot_json)),
  created_by_auth_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (seller_id, id),
  FOREIGN KEY (seller_id, product_id) REFERENCES products(seller_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_media_uploads_seller_created ON media_uploads(seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants(seller_id, product_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_product_drafts_seller_updated ON product_drafts(seller_id, updated_at DESC);
