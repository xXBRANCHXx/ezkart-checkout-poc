-- Each hostname has one live enrollment and an immutable seller/page binding.
CREATE TABLE custom_domains (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  hostname TEXT NOT NULL,
  page_id TEXT NOT NULL,
  public_path TEXT NOT NULL,
  cname_target TEXT NOT NULL,
  zone_id TEXT NOT NULL,
  challenge TEXT NOT NULL,
  challenge_expires_at TEXT NOT NULL,
  ownership_verified_at TEXT,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','active','suspended','disconnecting','disconnected')),
  provider_id TEXT,
  provider_state TEXT NOT NULL DEFAULT 'none',
  provider_status TEXT,
  tls_status TEXT,
  validation_json TEXT NOT NULL DEFAULT '[]',
  checked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX custom_domains_hostname ON custom_domains(hostname) WHERE state != 'disconnected';
CREATE INDEX custom_domains_seller ON custom_domains(seller_id, created_at);
CREATE TRIGGER custom_domains_binding_immutable BEFORE UPDATE OF seller_id, hostname, page_id, public_path, cname_target, zone_id ON custom_domains
BEGIN SELECT RAISE(ABORT, 'custom_domain_binding_immutable'); END;
CREATE TRIGGER custom_domains_downgrade AFTER UPDATE OF plan, status ON sellers
WHEN NEW.plan != 'advanced' OR NEW.status != 'active'
BEGIN
 UPDATE custom_domains SET state='suspended', ownership_verified_at=NULL, challenge_expires_at='1970-01-01T00:00:00.000Z', updated_at=NEW.updated_at
 WHERE seller_id=NEW.id AND state IN ('pending','active');
END;
