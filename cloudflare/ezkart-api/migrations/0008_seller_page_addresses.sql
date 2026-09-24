-- Public page addresses are independent of internal account identifiers.
CREATE TABLE IF NOT EXISTS seller_page_addresses (
  seller_id TEXT PRIMARY KEY NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
