-- Ezkart structured application data for Cloudflare D1.
-- Authentication credentials stay in Supabase Auth; file bodies stay in R2.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  auth_user_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  locale TEXT NOT NULL DEFAULT 'en',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sellers (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'standard' CHECK (plan IN ('standard', 'advanced')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  domain TEXT,
  settings_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS seller_memberships (
  seller_id TEXT NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  auth_user_id TEXT NOT NULL REFERENCES app_users(auth_user_id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (seller_id, auth_user_id)
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('physical', 'digital', 'subscription')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 2 AND 160),
  description TEXT NOT NULL DEFAULT '',
  sku TEXT,
  currency TEXT NOT NULL DEFAULT 'IDR' CHECK (length(currency) = 3),
  price_amount INTEGER NOT NULL CHECK (price_amount >= 0),
  stock_quantity INTEGER,
  weight_grams INTEGER,
  billing_interval TEXT,
  billing_interval_count INTEGER,
  digital_filename TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (seller_id, id),
  UNIQUE (seller_id, sku),
  CHECK (
    (type = 'physical' AND weight_grams > 0 AND stock_quantity >= 0 AND billing_interval IS NULL AND billing_interval_count IS NULL)
    OR (type = 'digital' AND weight_grams IS NULL AND stock_quantity IS NULL AND billing_interval IS NULL AND billing_interval_count IS NULL)
    OR (type = 'subscription' AND weight_grams IS NULL AND stock_quantity IS NULL AND billing_interval IN ('day', 'week', 'month') AND billing_interval_count > 0)
  )
);

CREATE TABLE IF NOT EXISTS product_media (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 2097152),
  sort_order INTEGER NOT NULL CHECK (sort_order BETWEEN 1 AND 9),
  alt_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (seller_id, product_id, sort_order),
  FOREIGN KEY (seller_id, product_id) REFERENCES products(seller_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS landing_pages (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  definition_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(definition_json)),
  published_version INTEGER,
  published_r2_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (seller_id, id),
  UNIQUE (seller_id, slug)
);

CREATE TABLE IF NOT EXISTS page_versions (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
  created_by_auth_user_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (seller_id, page_id, version),
  FOREIGN KEY (seller_id, page_id) REFERENCES landing_pages(seller_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  auth_user_id TEXT,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  consent_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(consent_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (seller_id, id),
  UNIQUE (seller_id, email)
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES sellers(id) ON DELETE RESTRICT,
  customer_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'cancelled', 'refunded')),
  currency TEXT NOT NULL DEFAULT 'IDR' CHECK (length(currency) = 3),
  subtotal_amount INTEGER NOT NULL CHECK (subtotal_amount >= 0),
  shipping_amount INTEGER NOT NULL DEFAULT 0 CHECK (shipping_amount >= 0),
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0 AND total_amount = subtotal_amount + shipping_amount),
  customer_snapshot_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(customer_snapshot_json)),
  shipping_address_json TEXT CHECK (shipping_address_json IS NULL OR json_valid(shipping_address_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (seller_id, id),
  FOREIGN KEY (seller_id, customer_id) REFERENCES customers(seller_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  product_id TEXT,
  product_type TEXT NOT NULL CHECK (product_type IN ('physical', 'digital', 'subscription')),
  title TEXT NOT NULL,
  sku TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_amount INTEGER NOT NULL CHECK (unit_price_amount >= 0),
  fulfillment_snapshot_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(fulfillment_snapshot_json)),
  created_at TEXT NOT NULL,
  UNIQUE (seller_id, id),
  FOREIGN KEY (seller_id, order_id) REFERENCES orders(seller_id, id) ON DELETE CASCADE,
  FOREIGN KEY (seller_id, product_id) REFERENCES products(seller_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS payment_transactions (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'midtrans' CHECK (provider = 'midtrans'),
  provider_reference TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'authorized', 'settlement', 'capture', 'deny', 'cancel', 'expire', 'refund', 'partial_refund')),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  signature_verified INTEGER NOT NULL DEFAULT 0 CHECK (signature_verified IN (0, 1)),
  raw_event_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(raw_event_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (provider, provider_reference),
  FOREIGN KEY (seller_id, order_id) REFERENCES orders(seller_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'midtrans' CHECK (provider = 'midtrans'),
  provider_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'paused', 'cancelled', 'expired')),
  interval_unit TEXT NOT NULL CHECK (interval_unit IN ('day', 'week', 'month')),
  interval_count INTEGER NOT NULL CHECK (interval_count > 0),
  next_charge_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (seller_id, id),
  FOREIGN KEY (seller_id, order_id) REFERENCES orders(seller_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (seller_id, product_id) REFERENCES products(seller_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (seller_id, customer_id) REFERENCES customers(seller_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS entitlements (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  order_item_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('download', 'subscription_access')),
  private_r2_key TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  expires_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (seller_id, id),
  FOREIGN KEY (seller_id, order_item_id) REFERENCES order_items(seller_id, id) ON DELETE CASCADE,
  FOREIGN KEY (seller_id, customer_id) REFERENCES customers(seller_id, id) ON DELETE CASCADE,
  FOREIGN KEY (seller_id, product_id) REFERENCES products(seller_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS shipments (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'biteship' CHECK (provider = 'biteship'),
  provider_reference TEXT,
  courier_code TEXT,
  service_code TEXT,
  tracking_number TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  quote_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(quote_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (seller_id, order_id),
  FOREIGN KEY (seller_id, order_id) REFERENCES orders(seller_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS product_reviews (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  order_item_id TEXT,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (seller_id, order_item_id),
  FOREIGN KEY (seller_id, product_id) REFERENCES products(seller_id, id) ON DELETE CASCADE,
  FOREIGN KEY (seller_id, customer_id) REFERENCES customers(seller_id, id) ON DELETE CASCADE,
  FOREIGN KEY (seller_id, order_item_id) REFERENCES order_items(seller_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS seller_events (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  actor_auth_user_id TEXT,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON seller_memberships(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_products_seller_status ON products(seller_id, status);
CREATE INDEX IF NOT EXISTS idx_pages_seller_status ON landing_pages(seller_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_seller_created ON orders(seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(seller_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payment_transactions(seller_id, order_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_due ON subscriptions(status, next_charge_at);
CREATE INDEX IF NOT EXISTS idx_reviews_product_status ON product_reviews(seller_id, product_id, status);
CREATE INDEX IF NOT EXISTS idx_events_seller_created ON seller_events(seller_id, created_at DESC);
