-- Private, resumable catalog files. Payment entitlements are a separate concern.
-- A filename in the old catalog is never evidence that a file was uploaded.
CREATE TABLE digital_file_uploads (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  actor_auth_user_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  filename TEXT NOT NULL CHECK (length(filename) BETWEEN 1 AND 180),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 524288000),
  manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json) AND json_type(manifest_json)='array'),
  part_count INTEGER NOT NULL CHECK (part_count BETWEEN 1 AND 100),
  r2_key TEXT NOT NULL UNIQUE,
  multipart_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('preparing','uploading','completing','ready','deleting','deleted')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ready_at TEXT,
  retained_at TEXT,
  deleted_at TEXT,
  completed_by_auth_user_id TEXT,
  cancelled_by_auth_user_id TEXT,
  UNIQUE (seller_id,request_key),
  UNIQUE (seller_id,id),
  CHECK (json_array_length(manifest_json)=part_count),
  CHECK (part_count=(size_bytes+5242879)/5242880)
);
CREATE INDEX idx_digital_uploads_seller_created ON digital_file_uploads(seller_id,created_at);
CREATE INDEX idx_digital_uploads_expiry ON digital_file_uploads(state,expires_at,id);
CREATE INDEX idx_digital_uploads_pending ON digital_file_uploads(seller_id,state,expires_at);
CREATE INDEX idx_digital_uploads_unused ON digital_file_uploads(state,ready_at,expires_at,id) WHERE retained_at IS NULL;

CREATE TABLE digital_file_parts (
  upload_id TEXT NOT NULL REFERENCES digital_file_uploads(id),
  part_number INTEGER NOT NULL CHECK (part_number BETWEEN 1 AND 100),
  sha256 TEXT NOT NULL CHECK (length(sha256)=64),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  etag TEXT NOT NULL,
  actor_auth_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (upload_id,part_number)
);

-- Product IDs and version metadata survive catalog deletion. File versions are
-- immutable; a copy may reference the same private upload without duplicating bytes.
CREATE TABLE digital_product_versions (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  product_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version>0),
  upload_id TEXT NOT NULL,
  actor_auth_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (seller_id,product_id,version),
  UNIQUE (seller_id,product_id,id),
  FOREIGN KEY (seller_id,upload_id) REFERENCES digital_file_uploads(seller_id,id)
);
CREATE INDEX idx_digital_versions_upload ON digital_product_versions(upload_id);
CREATE TABLE digital_product_files (
  seller_id TEXT NOT NULL,
  product_id TEXT NOT NULL PRIMARY KEY,
  version_id TEXT NOT NULL,
  FOREIGN KEY (seller_id,product_id) REFERENCES products(seller_id,id) ON DELETE CASCADE,
  FOREIGN KEY (seller_id,product_id,version_id) REFERENCES digital_product_versions(seller_id,product_id,id)
);

CREATE TRIGGER digital_upload_create_guard BEFORE INSERT ON digital_file_uploads
BEGIN
  SELECT RAISE(ABORT,'digital_membership_changed') WHERE NOT EXISTS (
    SELECT 1 FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id
    WHERE m.seller_id=NEW.seller_id AND m.auth_user_id=NEW.actor_auth_user_id
      AND m.role IN ('owner','admin','editor') AND s.status='active'
  );
  SELECT RAISE(ABORT,'digital_upload_limit') WHERE
    (SELECT COUNT(*) FROM digital_file_uploads WHERE seller_id=NEW.seller_id AND created_at>strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'-1 hour'))>=20
    OR (SELECT COUNT(*) FROM digital_file_uploads WHERE seller_id=NEW.seller_id AND created_at>strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'-1 day'))>=100
    OR (SELECT COUNT(*) FROM digital_file_uploads WHERE seller_id=NEW.seller_id AND state IN ('preparing','uploading','completing') AND expires_at>NEW.created_at)>=10;
END;
CREATE TRIGGER digital_upload_identity BEFORE UPDATE ON digital_file_uploads
BEGIN
  SELECT RAISE(ABORT,'digital_file_immutable') WHERE NEW.id!=OLD.id OR NEW.seller_id!=OLD.seller_id
    OR NEW.actor_auth_user_id!=OLD.actor_auth_user_id OR NEW.request_key!=OLD.request_key OR NEW.request_hash!=OLD.request_hash
    OR NEW.filename!=OLD.filename OR NEW.size_bytes!=OLD.size_bytes OR NEW.manifest_json!=OLD.manifest_json
    OR NEW.part_count!=OLD.part_count OR NEW.r2_key!=OLD.r2_key OR NEW.created_at!=OLD.created_at OR NEW.expires_at!=OLD.expires_at
    OR (OLD.multipart_id IS NOT NULL AND NEW.multipart_id IS NOT OLD.multipart_id)
    OR (OLD.ready_at IS NOT NULL AND NEW.ready_at IS NOT OLD.ready_at)
    OR (OLD.retained_at IS NOT NULL AND NEW.retained_at IS NOT OLD.retained_at)
    OR (OLD.completed_by_auth_user_id IS NOT NULL AND NEW.completed_by_auth_user_id IS NOT OLD.completed_by_auth_user_id)
    OR (OLD.cancelled_by_auth_user_id IS NOT NULL AND NEW.cancelled_by_auth_user_id IS NOT OLD.cancelled_by_auth_user_id)
    OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NOT OLD.deleted_at);
  SELECT RAISE(ABORT,'digital_file_state') WHERE NEW.state!=OLD.state AND NOT (
    (OLD.state='preparing' AND NEW.state IN ('uploading','deleting'))
    OR (OLD.state='uploading' AND NEW.state IN ('completing','deleting'))
    OR (OLD.state='completing' AND NEW.state IN ('ready','deleting'))
    OR (OLD.state='ready' AND NEW.state='deleting') OR (OLD.state='deleting' AND NEW.state='deleted')
  );
  SELECT RAISE(ABORT,'digital_file_in_use') WHERE NEW.state IN ('deleting','deleted')
    AND EXISTS (SELECT 1 FROM digital_product_versions WHERE upload_id=OLD.id);
  SELECT RAISE(ABORT,'digital_file_incomplete') WHERE NEW.state IN ('completing','ready') AND (
    NEW.multipart_id IS NULL OR (SELECT COUNT(*) FROM digital_file_parts WHERE upload_id=OLD.id)!=OLD.part_count
    OR (SELECT COALESCE(SUM(size_bytes),0) FROM digital_file_parts WHERE upload_id=OLD.id)!=OLD.size_bytes
  );
END;
CREATE TRIGGER digital_upload_no_delete BEFORE DELETE ON digital_file_uploads
BEGIN SELECT RAISE(ABORT,'digital_file_immutable'); END;
CREATE TRIGGER digital_part_guard BEFORE INSERT ON digital_file_parts
BEGIN
  SELECT RAISE(ABORT,'digital_file_part') WHERE NOT EXISTS (
    SELECT 1 FROM digital_file_uploads u JOIN seller_memberships m ON m.seller_id=u.seller_id JOIN sellers s ON s.id=u.seller_id
    WHERE u.id=NEW.upload_id AND u.state='uploading' AND s.status='active'
      AND m.auth_user_id=NEW.actor_auth_user_id AND m.role IN ('owner','admin','editor')
      AND u.expires_at>NEW.created_at AND NEW.part_number<=u.part_count
      AND json_extract(u.manifest_json,'$['||(NEW.part_number-1)||']')=NEW.sha256
      AND NEW.size_bytes=min(5242880,u.size_bytes-(NEW.part_number-1)*5242880)
  );
END;

-- Fence an identified merchant whose access changes after catalog preflight.
CREATE TRIGGER digital_catalog_access BEFORE INSERT ON seller_events
WHEN NEW.actor_auth_user_id IS NOT NULL AND NEW.event_type IN ('product.created','product.updated','product.duplicated','product.deleted','product.archived','product.restored')
BEGIN
  SELECT RAISE(ABORT,'digital_membership_changed') WHERE NOT EXISTS (
    SELECT 1 FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id
    WHERE m.seller_id=NEW.seller_id AND m.auth_user_id=NEW.actor_auth_user_id
      AND m.role IN ('owner','admin','editor') AND s.status='active'
  );
END;
CREATE TRIGGER digital_part_no_update BEFORE UPDATE ON digital_file_parts
BEGIN SELECT RAISE(ABORT,'digital_file_immutable'); END;
CREATE TRIGGER digital_part_no_delete BEFORE DELETE ON digital_file_parts
BEGIN SELECT RAISE(ABORT,'digital_file_immutable'); END;
CREATE TRIGGER digital_version_guard BEFORE INSERT ON digital_product_versions
BEGIN
  SELECT RAISE(ABORT,'digital_file_unavailable') WHERE NOT EXISTS (
    SELECT 1 FROM products p JOIN digital_file_uploads u ON u.seller_id=p.seller_id
    JOIN seller_memberships m ON m.seller_id=p.seller_id JOIN sellers s ON s.id=p.seller_id
    WHERE p.id=NEW.product_id AND p.seller_id=NEW.seller_id AND p.type='digital'
      AND u.id=NEW.upload_id AND u.state='ready' AND s.status='active'
      AND (strftime('%Y-%m-%dT%H:%M:%fZ',u.ready_at,'+7 days')>NEW.created_at OR EXISTS (SELECT 1 FROM digital_product_versions v WHERE v.upload_id=u.id))
      AND m.auth_user_id=NEW.actor_auth_user_id AND m.role IN ('owner','admin','editor')
  );
END;
CREATE TRIGGER digital_version_no_update BEFORE UPDATE ON digital_product_versions
BEGIN SELECT RAISE(ABORT,'digital_file_immutable'); END;
CREATE TRIGGER digital_version_retain AFTER INSERT ON digital_product_versions
BEGIN UPDATE digital_file_uploads SET retained_at=NEW.created_at WHERE id=NEW.upload_id AND retained_at IS NULL; END;
CREATE TRIGGER digital_version_no_delete BEFORE DELETE ON digital_product_versions
BEGIN SELECT RAISE(ABORT,'digital_file_immutable'); END;
CREATE TRIGGER digital_link_insert_guard BEFORE INSERT ON digital_product_files
BEGIN
  SELECT RAISE(ABORT,'digital_file_unavailable') WHERE NOT EXISTS (
    SELECT 1 FROM products p JOIN digital_product_versions v ON v.seller_id=p.seller_id AND v.product_id=p.id
    JOIN digital_file_uploads u ON u.id=v.upload_id WHERE p.id=NEW.product_id AND p.seller_id=NEW.seller_id
      AND p.type='digital' AND v.id=NEW.version_id AND u.state='ready' AND p.digital_filename=u.filename
  );
END;
CREATE TRIGGER digital_link_update_guard BEFORE UPDATE ON digital_product_files
BEGIN
  SELECT RAISE(ABORT,'digital_file_unavailable') WHERE NEW.seller_id!=OLD.seller_id OR NEW.product_id!=OLD.product_id OR NOT EXISTS (
    SELECT 1 FROM products p JOIN digital_product_versions v ON v.seller_id=p.seller_id AND v.product_id=p.id
    JOIN digital_file_uploads u ON u.id=v.upload_id WHERE p.id=NEW.product_id AND p.seller_id=NEW.seller_id
      AND p.type='digital' AND v.id=NEW.version_id AND u.state='ready' AND p.digital_filename=u.filename
  );
END;
