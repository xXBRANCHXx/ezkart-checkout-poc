-- Private original evidence is append-only and never constitutes a paid refund.
CREATE TABLE commerce_refund_attachments (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  refund_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  actor_kind TEXT NOT NULL CHECK(actor_kind IN ('buyer','merchant')),
  actor_auth_user_id TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL CHECK(length(filename) BETWEEN 1 AND 160),
  mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 5242880),
  caption TEXT NOT NULL CHECK(length(caption)<=500),
  state TEXT NOT NULL DEFAULT 'uploading' CHECK(state IN ('uploading','ready')),
  created_at TEXT NOT NULL,
  ready_at TEXT,
  CHECK((state='uploading' AND ready_at IS NULL) OR (state='ready' AND ready_at IS NOT NULL AND ready_at>=created_at)),
  UNIQUE(commerce_environment,refund_id,actor_kind,actor_auth_user_id,request_hash),
  FOREIGN KEY(seller_id,refund_id) REFERENCES commerce_refunds(seller_id,id) ON DELETE RESTRICT
);
CREATE INDEX idx_refund_attachments_case ON commerce_refund_attachments(refund_id,sequence);
CREATE INDEX idx_refund_attachments_rate ON commerce_refund_attachments(actor_auth_user_id,commerce_environment,created_at);
CREATE TRIGGER commerce_refund_attachment_insert BEFORE INSERT ON commerce_refund_attachments BEGIN
  SELECT RAISE(ABORT,'refund_attachment_immutable') WHERE EXISTS(SELECT 1 FROM commerce_refund_attachments
    WHERE id=NEW.id OR sequence=NEW.sequence OR r2_key=NEW.r2_key
      OR (commerce_environment=NEW.commerce_environment AND refund_id=NEW.refund_id AND actor_kind=NEW.actor_kind AND actor_auth_user_id=NEW.actor_auth_user_id AND request_hash=NEW.request_hash));
  SELECT RAISE(ABORT,'refund_attachment_invalid') WHERE NEW.state!='uploading' OR NEW.ready_at IS NOT NULL
    OR NOT EXISTS(SELECT 1 FROM commerce_refunds WHERE id=NEW.refund_id AND seller_id=NEW.seller_id AND commerce_environment=NEW.commerce_environment);
  SELECT RAISE(ABORT,'refund_actor_forbidden') WHERE NOT (
    (NEW.actor_kind='merchant' AND EXISTS(SELECT 1 FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id
      WHERE m.seller_id=NEW.seller_id AND m.auth_user_id=NEW.actor_auth_user_id AND m.role!='viewer' AND s.status='active'))
    OR (NEW.actor_kind='buyer' AND EXISTS(SELECT 1 FROM commerce_refunds r JOIN orders o ON o.id=r.order_id LEFT JOIN commerce_order_owners a ON a.order_id=o.id
      WHERE r.id=NEW.refund_id AND COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=NEW.actor_auth_user_id)));
  SELECT RAISE(ABORT,'refund_attachment_limit') WHERE (SELECT COUNT(*) FROM commerce_refund_attachments WHERE refund_id=NEW.refund_id AND actor_kind=NEW.actor_kind)>=10;
  SELECT RAISE(ABORT,'refund_attachment_rate') WHERE (SELECT COUNT(*) FROM commerce_refund_attachments
    WHERE actor_auth_user_id=NEW.actor_auth_user_id AND commerce_environment=NEW.commerce_environment
      AND created_at>=strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'-1 hour'))>=20;
END;
CREATE TRIGGER commerce_refund_attachment_update BEFORE UPDATE ON commerce_refund_attachments BEGIN
  SELECT RAISE(ABORT,'refund_attachment_immutable') WHERE NEW.sequence IS NOT OLD.sequence OR NEW.id IS NOT OLD.id
    OR NEW.refund_id IS NOT OLD.refund_id OR NEW.seller_id IS NOT OLD.seller_id OR NEW.commerce_environment IS NOT OLD.commerce_environment
    OR NEW.actor_kind IS NOT OLD.actor_kind OR NEW.actor_auth_user_id IS NOT OLD.actor_auth_user_id OR NEW.request_hash IS NOT OLD.request_hash
    OR NEW.content_hash IS NOT OLD.content_hash OR NEW.r2_key IS NOT OLD.r2_key OR NEW.filename IS NOT OLD.filename
    OR NEW.mime_type IS NOT OLD.mime_type OR NEW.size_bytes IS NOT OLD.size_bytes OR NEW.caption IS NOT OLD.caption OR NEW.created_at IS NOT OLD.created_at
    OR OLD.state!='uploading' OR NEW.state!='ready' OR NEW.ready_at IS NULL;
  SELECT RAISE(ABORT,'refund_actor_forbidden') WHERE NOT (
    (NEW.actor_kind='merchant' AND EXISTS(SELECT 1 FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id
      WHERE m.seller_id=NEW.seller_id AND m.auth_user_id=NEW.actor_auth_user_id AND m.role!='viewer' AND s.status='active'))
    OR (NEW.actor_kind='buyer' AND EXISTS(SELECT 1 FROM commerce_refunds r JOIN orders o ON o.id=r.order_id LEFT JOIN commerce_order_owners a ON a.order_id=o.id
      WHERE r.id=NEW.refund_id AND COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=NEW.actor_auth_user_id)));
END;
CREATE TRIGGER commerce_refund_attachment_delete BEFORE DELETE ON commerce_refund_attachments BEGIN
  SELECT RAISE(ABORT,'refund_attachment_immutable');
END;
ALTER TABLE commerce_refund_actions ADD COLUMN evidence_version INTEGER NOT NULL DEFAULT 0 CHECK(evidence_version>=0);
CREATE TRIGGER commerce_refund_action_evidence BEFORE INSERT ON commerce_refund_actions BEGIN
  SELECT RAISE(ABORT,'refund_evidence_changed') WHERE NEW.evidence_version!=(SELECT COALESCE(SUM(1+(state='ready')),0)
    FROM commerce_refund_attachments WHERE refund_id=NEW.refund_id);
END;
