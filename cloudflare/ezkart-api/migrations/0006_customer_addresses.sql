-- Customer-owned address books, independent of seller membership.
CREATE TABLE IF NOT EXISTS customer_address_books (
    auth_user_id TEXT PRIMARY KEY NOT NULL,
    addresses_json TEXT NOT NULL DEFAULT '[]'
      CHECK (json_valid(addresses_json) AND json_type(addresses_json) = 'array' AND json_array_length(addresses_json) <= 3),
    default_address_id TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
    updated_at TEXT NOT NULL
);
