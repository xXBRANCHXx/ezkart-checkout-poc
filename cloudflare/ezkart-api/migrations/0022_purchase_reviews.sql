ALTER TABLE commerce_shipments ADD COLUMN delivered_at TEXT;
UPDATE commerce_shipments SET delivered_at=COALESCE(NULLIF(status_at,''),NULLIF(status_received_at,''),bound_at)
  WHERE state='delivered' AND provider_id IS NOT NULL AND provider_account_hash IS NOT NULL;
CREATE TRIGGER commerce_shipment_delivery_immutable BEFORE UPDATE ON commerce_shipments
WHEN OLD.delivered_at IS NOT NULL AND NEW.delivered_at IS NOT OLD.delivered_at
BEGIN SELECT RAISE(ABORT,'immutable_delivery_evidence'); END;

ALTER TABLE product_reviews ADD COLUMN commerce_environment TEXT NOT NULL DEFAULT 'legacy' CHECK(commerce_environment IN ('legacy','sandbox','production'));
ALTER TABLE product_reviews ADD COLUMN review_source TEXT NOT NULL DEFAULT 'legacy' CHECK(review_source IN ('legacy','purchase'));
ALTER TABLE product_reviews ADD COLUMN owner_auth_user_id TEXT NOT NULL DEFAULT '';
ALTER TABLE product_reviews ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0);
ALTER TABLE product_reviews ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 0 CHECK(content_revision>=0);
ALTER TABLE product_reviews ADD COLUMN public_name TEXT NOT NULL DEFAULT 'Customer';
ALTER TABLE product_reviews ADD COLUMN buyer_state TEXT NOT NULL DEFAULT 'published' CHECK(buyer_state IN ('published','withdrawn'));
ALTER TABLE product_reviews ADD COLUMN moderation_state TEXT NOT NULL DEFAULT 'pending' CHECK(moderation_state IN ('pending','visible','hidden'));
ALTER TABLE product_reviews ADD COLUMN moderation_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE product_reviews ADD COLUMN moderation_note TEXT NOT NULL DEFAULT '';
ALTER TABLE product_reviews ADD COLUMN moderated_at TEXT;
ALTER TABLE product_reviews ADD COLUMN reply_body TEXT NOT NULL DEFAULT '';
ALTER TABLE product_reviews ADD COLUMN reply_content_revision INTEGER NOT NULL DEFAULT 0 CHECK(reply_content_revision>=0);
ALTER TABLE product_reviews ADD COLUMN replied_at TEXT;
ALTER TABLE product_reviews ADD COLUMN media_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(media_json) AND json_type(media_json)='array' AND json_array_length(media_json)<=6);
UPDATE product_reviews SET moderation_state=CASE status WHEN 'published' THEN 'visible' WHEN 'rejected' THEN 'hidden' ELSE 'pending' END;
CREATE INDEX commerce_reviews_merchant ON product_reviews(seller_id,commerce_environment,created_at DESC,id DESC);
CREATE INDEX commerce_reviews_public ON product_reviews(seller_id,product_id,status,commerce_environment,created_at DESC,id DESC);

CREATE TABLE commerce_review_media (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  order_item_id TEXT NOT NULL,
  owner_auth_user_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp')),
  size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 1048576),
  state TEXT NOT NULL DEFAULT 'uploading' CHECK(state IN ('uploading','ready','deleting')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  cleanup_at TEXT,
  UNIQUE(owner_auth_user_id,commerce_environment,request_key),
  FOREIGN KEY(seller_id,order_item_id) REFERENCES order_items(seller_id,id) ON DELETE RESTRICT
);
CREATE INDEX commerce_review_media_expiry ON commerce_review_media(expires_at,state);
CREATE INDEX commerce_review_media_cleanup ON commerce_review_media(cleanup_at,expires_at);
CREATE TABLE commerce_review_changes (
  review_id TEXT NOT NULL,
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  commerce_environment TEXT NOT NULL CHECK(commerce_environment IN ('sandbox','production')),
  product_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  order_item_id TEXT,
  owner_auth_user_id TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK(actor_kind IN ('buyer','merchant')),
  actor_auth_user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('publish','withdraw','reply','hide','restore','approve')),
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  expected_revision INTEGER NOT NULL CHECK(expected_revision>=0),
  revision INTEGER NOT NULL CHECK(revision=expected_revision+1 AND revision<=9007199254740991),
  data_json TEXT NOT NULL CHECK(json_valid(data_json) AND json_type(data_json)='object'),
  created_at TEXT NOT NULL,
  PRIMARY KEY(actor_kind,actor_auth_user_id,commerce_environment,request_key),
  UNIQUE(review_id,revision)
);
CREATE INDEX commerce_review_changes_history ON commerce_review_changes(review_id,revision DESC);
CREATE TABLE commerce_review_media_links (
  media_id TEXT PRIMARY KEY REFERENCES commerce_review_media(id) ON DELETE RESTRICT,
  review_id TEXT NOT NULL REFERENCES product_reviews(id) ON DELETE RESTRICT,
  first_revision INTEGER NOT NULL CHECK(first_revision>0)
);
CREATE INDEX commerce_review_media_links_review ON commerce_review_media_links(review_id);

CREATE TRIGGER commerce_review_change_guard BEFORE INSERT ON commerce_review_changes BEGIN
  SELECT RAISE(ABORT,'review_actor_forbidden') WHERE
    (NEW.actor_kind='buyer' AND (NEW.kind NOT IN ('publish','withdraw') OR NEW.actor_auth_user_id!=NEW.owner_auth_user_id))
    OR (NEW.actor_kind='merchant' AND (NEW.kind NOT IN ('reply','hide','restore','approve') OR NOT EXISTS(
      SELECT 1 FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id WHERE m.seller_id=NEW.seller_id
        AND m.auth_user_id=NEW.actor_auth_user_id AND m.role!='viewer' AND s.status='active')));
  SELECT RAISE(ABORT,'review_revision_conflict') WHERE NEW.expected_revision!=COALESCE((SELECT revision FROM product_reviews WHERE id=NEW.review_id),0);
  SELECT RAISE(ABORT,'review_identity_changed') WHERE EXISTS(SELECT 1 FROM product_reviews r WHERE r.id=NEW.review_id
    AND (r.seller_id!=NEW.seller_id OR r.product_id!=NEW.product_id OR r.customer_id!=NEW.customer_id OR r.order_item_id IS NOT NEW.order_item_id
      OR r.owner_auth_user_id!=NEW.owner_auth_user_id OR r.commerce_environment NOT IN ('legacy',NEW.commerce_environment)));
  SELECT RAISE(ABORT,'review_missing') WHERE NEW.kind!='publish' AND NOT EXISTS(SELECT 1 FROM product_reviews WHERE id=NEW.review_id);
  SELECT RAISE(ABORT,'review_owner_required') WHERE NEW.actor_kind='buyer' AND NOT EXISTS(
    SELECT 1 FROM order_items i JOIN orders o ON o.id=i.order_id AND o.seller_id=i.seller_id LEFT JOIN commerce_order_owners a ON a.order_id=o.id
    WHERE i.id=NEW.order_item_id AND i.seller_id=NEW.seller_id AND i.product_id=NEW.product_id AND o.customer_id=NEW.customer_id
      AND o.commerce_environment=NEW.commerce_environment AND o.commerce_version=1
      AND COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=NEW.actor_auth_user_id
  );
  SELECT RAISE(ABORT,'review_purchase_required') WHERE NEW.kind='publish' AND NOT EXISTS(
    SELECT 1 FROM order_items i JOIN orders o ON o.id=i.order_id AND o.seller_id=i.seller_id WHERE i.id=NEW.order_item_id
      AND i.seller_id=NEW.seller_id AND i.product_type='physical' AND o.checkout_state IN ('paid','partially_refunded','refunded')
      AND EXISTS(SELECT 1 FROM commerce_payment_captures c WHERE c.order_id=o.id AND c.capture_kind='order_payment' AND c.amount=o.total_amount)
      AND (EXISTS(SELECT 1 FROM inventory_reservations h WHERE h.order_item_id=i.id AND h.state='committed')
        OR EXISTS(SELECT 1 FROM commerce_stock_allocations x WHERE x.order_item_id=i.id))
      AND EXISTS(SELECT 1 FROM commerce_shipments s WHERE s.order_id=o.id AND s.commerce_environment=o.commerce_environment
        AND s.provider_id IS NOT NULL AND s.provider_account_hash IS NOT NULL AND s.delivered_at IS NOT NULL)
  );
  SELECT RAISE(ABORT,'review_content_invalid') WHERE json_type(NEW.data_json,'$.rating') IS NOT 'integer'
    OR json_extract(NEW.data_json,'$.rating') NOT BETWEEN 1 AND 5 OR json_type(NEW.data_json,'$.title') IS NOT 'text'
    OR (NEW.kind='publish' AND length(json_extract(NEW.data_json,'$.title'))>120) OR json_type(NEW.data_json,'$.body') IS NOT 'text'
    OR (NEW.kind='publish' AND length(json_extract(NEW.data_json,'$.body'))>3000)
    OR json_type(NEW.data_json,'$.publicName') IS NOT 'text' OR (NEW.kind='publish' AND length(json_extract(NEW.data_json,'$.publicName')) NOT BETWEEN 1 AND 50)
    OR json_type(NEW.data_json,'$.contentRevision') IS NOT 'integer' OR json_extract(NEW.data_json,'$.contentRevision')<0
    OR json_type(NEW.data_json,'$.media') IS NOT 'array' OR json_array_length(NEW.data_json,'$.media')>6
    OR json_type(NEW.data_json,'$.buyerState') IS NOT 'text' OR json_extract(NEW.data_json,'$.buyerState') NOT IN ('published','withdrawn')
    OR json_type(NEW.data_json,'$.moderationState') IS NOT 'text' OR json_extract(NEW.data_json,'$.moderationState') NOT IN ('pending','visible','hidden')
    OR json_type(NEW.data_json,'$.moderationReason') IS NOT 'text' OR json_type(NEW.data_json,'$.moderationNote') IS NOT 'text'
    OR json_type(NEW.data_json,'$.replyContentRevision') IS NOT 'integer' OR json_extract(NEW.data_json,'$.replyContentRevision')<0
    OR json_type(NEW.data_json,'$.reply') IS NOT 'text' OR length(json_extract(NEW.data_json,'$.reply'))>2000;
  SELECT RAISE(ABORT,'review_content_changed') WHERE NEW.kind!='publish' AND EXISTS(SELECT 1 FROM product_reviews r WHERE r.id=NEW.review_id AND (
    r.rating IS NOT json_extract(NEW.data_json,'$.rating') OR r.title IS NOT json_extract(NEW.data_json,'$.title')
    OR r.body IS NOT json_extract(NEW.data_json,'$.body') OR r.public_name IS NOT json_extract(NEW.data_json,'$.publicName')
    OR r.media_json IS NOT json_extract(NEW.data_json,'$.media') OR r.content_revision IS NOT json_extract(NEW.data_json,'$.contentRevision')));
  SELECT RAISE(ABORT,'review_content_revision') WHERE NEW.kind='publish' AND json_extract(NEW.data_json,'$.contentRevision')!=1+COALESCE((SELECT content_revision FROM product_reviews WHERE id=NEW.review_id),0);
  SELECT RAISE(ABORT,'review_buyer_state') WHERE
    (NEW.kind='publish' AND json_extract(NEW.data_json,'$.buyerState')!='published') OR (NEW.kind='withdraw' AND json_extract(NEW.data_json,'$.buyerState')!='withdrawn')
    OR (NEW.actor_kind='merchant' AND json_extract(NEW.data_json,'$.buyerState') IS NOT (SELECT buyer_state FROM product_reviews WHERE id=NEW.review_id));
  SELECT RAISE(ABORT,'review_moderation_changed') WHERE NEW.actor_kind='buyer' AND (
    json_extract(NEW.data_json,'$.moderationState') IS NOT COALESCE((SELECT moderation_state FROM product_reviews WHERE id=NEW.review_id),'visible')
    OR json_extract(NEW.data_json,'$.moderationReason') IS NOT COALESCE((SELECT moderation_reason FROM product_reviews WHERE id=NEW.review_id),'')
    OR json_extract(NEW.data_json,'$.moderationNote') IS NOT COALESCE((SELECT moderation_note FROM product_reviews WHERE id=NEW.review_id),'')
    OR json_extract(NEW.data_json,'$.moderatedAt') IS NOT (SELECT moderated_at FROM product_reviews WHERE id=NEW.review_id));
  SELECT RAISE(ABORT,'review_reply_changed') WHERE NEW.kind!='reply' AND (
    json_extract(NEW.data_json,'$.reply') IS NOT COALESCE((SELECT reply_body FROM product_reviews WHERE id=NEW.review_id),'')
    OR json_extract(NEW.data_json,'$.replyContentRevision') IS NOT COALESCE((SELECT reply_content_revision FROM product_reviews WHERE id=NEW.review_id),0)
    OR json_extract(NEW.data_json,'$.repliedAt') IS NOT (SELECT replied_at FROM product_reviews WHERE id=NEW.review_id));
  SELECT RAISE(ABORT,'review_moderation_invalid') WHERE NEW.kind='hide' AND (
    json_extract(NEW.data_json,'$.moderationState')!='hidden' OR json_extract(NEW.data_json,'$.moderationReason') NOT IN ('personal_information','abuse','spam','unrelated','duplicate')
    OR length(json_extract(NEW.data_json,'$.moderationNote')) NOT BETWEEN 10 AND 1000);
  SELECT RAISE(ABORT,'review_moderation_invalid') WHERE NEW.kind IN ('restore','approve') AND (
    json_extract(NEW.data_json,'$.moderationState')!='visible'
    OR (NEW.kind='approve' AND (SELECT moderation_state FROM product_reviews WHERE id=NEW.review_id)!='pending')
    OR (NEW.kind='restore' AND (SELECT moderation_state FROM product_reviews WHERE id=NEW.review_id)!='hidden'));
  SELECT RAISE(ABORT,'review_moderation_changed') WHERE NEW.kind='reply' AND (
    json_extract(NEW.data_json,'$.moderationState') IS NOT (SELECT moderation_state FROM product_reviews WHERE id=NEW.review_id)
    OR json_extract(NEW.data_json,'$.moderationReason') IS NOT (SELECT moderation_reason FROM product_reviews WHERE id=NEW.review_id)
    OR json_extract(NEW.data_json,'$.moderationNote') IS NOT (SELECT moderation_note FROM product_reviews WHERE id=NEW.review_id)
    OR json_extract(NEW.data_json,'$.moderatedAt') IS NOT (SELECT moderated_at FROM product_reviews WHERE id=NEW.review_id));
  SELECT RAISE(ABORT,'review_reply_version') WHERE NEW.kind='reply'
    AND json_extract(NEW.data_json,'$.replyContentRevision') IS NOT (SELECT content_revision FROM product_reviews WHERE id=NEW.review_id);
  SELECT RAISE(ABORT,'review_photo_invalid') WHERE NEW.kind='publish' AND (
    (SELECT COUNT(DISTINCT value) FROM json_each(NEW.data_json,'$.media'))!=json_array_length(NEW.data_json,'$.media') OR EXISTS(
      SELECT 1 FROM json_each(NEW.data_json,'$.media') p WHERE p.type!='text' OR NOT EXISTS(
        SELECT 1 FROM commerce_review_media m WHERE m.id=p.value AND m.seller_id=NEW.seller_id AND m.commerce_environment=NEW.commerce_environment
          AND m.order_item_id=NEW.order_item_id AND m.owner_auth_user_id=NEW.actor_auth_user_id AND m.state='ready'
          AND (m.expires_at>NEW.created_at OR EXISTS(SELECT 1 FROM commerce_review_media_links l
            WHERE l.review_id=NEW.review_id AND l.media_id=m.id)))));
END;

CREATE TRIGGER commerce_review_change_apply AFTER INSERT ON commerce_review_changes BEGIN
  INSERT INTO product_reviews(id,seller_id,product_id,customer_id,order_item_id,rating,title,body,status,created_at,updated_at,
    commerce_environment,review_source,owner_auth_user_id,revision,content_revision,public_name,buyer_state,moderation_state,moderation_reason,moderation_note,moderated_at,
    reply_body,reply_content_revision,replied_at,media_json)
  VALUES(NEW.review_id,NEW.seller_id,NEW.product_id,NEW.customer_id,NEW.order_item_id,json_extract(NEW.data_json,'$.rating'),json_extract(NEW.data_json,'$.title'),
    json_extract(NEW.data_json,'$.body'),CASE WHEN json_extract(NEW.data_json,'$.buyerState')='published' AND json_extract(NEW.data_json,'$.moderationState')='visible' THEN 'published'
      WHEN json_extract(NEW.data_json,'$.moderationState')='pending' AND json_extract(NEW.data_json,'$.buyerState')='published' THEN 'pending' ELSE 'rejected' END,
    NEW.created_at,NEW.created_at,NEW.commerce_environment,'purchase',NEW.owner_auth_user_id,NEW.revision,json_extract(NEW.data_json,'$.contentRevision'),
    json_extract(NEW.data_json,'$.publicName'),json_extract(NEW.data_json,'$.buyerState'),json_extract(NEW.data_json,'$.moderationState'),
    json_extract(NEW.data_json,'$.moderationReason'),json_extract(NEW.data_json,'$.moderationNote'),json_extract(NEW.data_json,'$.moderatedAt'),
    json_extract(NEW.data_json,'$.reply'),json_extract(NEW.data_json,'$.replyContentRevision'),json_extract(NEW.data_json,'$.repliedAt'),json_extract(NEW.data_json,'$.media'))
  ON CONFLICT(id) DO UPDATE SET rating=excluded.rating,title=excluded.title,body=excluded.body,status=excluded.status,updated_at=excluded.updated_at,
    commerce_environment=excluded.commerce_environment,revision=excluded.revision,content_revision=excluded.content_revision,public_name=excluded.public_name,
    buyer_state=excluded.buyer_state,moderation_state=excluded.moderation_state,moderation_reason=excluded.moderation_reason,moderation_note=excluded.moderation_note,
    moderated_at=excluded.moderated_at,reply_body=excluded.reply_body,reply_content_revision=excluded.reply_content_revision,replied_at=excluded.replied_at,media_json=excluded.media_json;
  INSERT INTO commerce_review_media_links(media_id,review_id,first_revision)
    SELECT value,NEW.review_id,NEW.revision FROM json_each(NEW.data_json,'$.media') WHERE NEW.kind='publish'
    ON CONFLICT(media_id) DO NOTHING;
END;
CREATE TRIGGER commerce_review_insert BEFORE INSERT ON product_reviews WHEN NEW.review_source='purchase' BEGIN
  SELECT RAISE(ABORT,'review_receipt_required') WHERE NOT EXISTS(SELECT 1 FROM commerce_review_changes c WHERE c.review_id=NEW.id
    AND (c.kind='publish' OR EXISTS(SELECT 1 FROM product_reviews WHERE id=NEW.id))
    AND c.seller_id=NEW.seller_id AND c.product_id=NEW.product_id AND c.customer_id=NEW.customer_id AND c.order_item_id IS NEW.order_item_id
    AND c.owner_auth_user_id=NEW.owner_auth_user_id AND c.commerce_environment=NEW.commerce_environment AND c.revision=NEW.revision AND c.created_at=NEW.created_at
    AND json_extract(c.data_json,'$.rating')=NEW.rating AND json_extract(c.data_json,'$.title')=NEW.title AND json_extract(c.data_json,'$.body')=NEW.body
    AND json_extract(c.data_json,'$.publicName')=NEW.public_name AND json_extract(c.data_json,'$.contentRevision')=NEW.content_revision
    AND json_extract(c.data_json,'$.buyerState')=NEW.buyer_state AND json_extract(c.data_json,'$.moderationState')=NEW.moderation_state
    AND json_extract(c.data_json,'$.moderationReason')=NEW.moderation_reason AND json_extract(c.data_json,'$.moderationNote')=NEW.moderation_note
    AND json_extract(c.data_json,'$.moderatedAt') IS NEW.moderated_at AND json_extract(c.data_json,'$.reply')=NEW.reply_body
    AND json_extract(c.data_json,'$.replyContentRevision')=NEW.reply_content_revision AND json_extract(c.data_json,'$.repliedAt') IS NEW.replied_at
    AND json_extract(c.data_json,'$.media')=NEW.media_json)
    OR (NEW.buyer_state='published' AND NEW.moderation_state='visible' AND NEW.status!='published')
    OR (NEW.buyer_state='published' AND NEW.moderation_state='pending' AND NEW.status!='pending')
    OR ((NEW.buyer_state='withdrawn' OR NEW.moderation_state='hidden') AND NEW.status!='rejected');
END;
CREATE TRIGGER commerce_review_update BEFORE UPDATE ON product_reviews BEGIN
  SELECT RAISE(ABORT,'review_receipt_required') WHERE NEW.id!=OLD.id OR NEW.seller_id!=OLD.seller_id OR NEW.product_id!=OLD.product_id OR NEW.customer_id!=OLD.customer_id
    OR NEW.order_item_id IS NOT OLD.order_item_id OR NEW.owner_auth_user_id!=OLD.owner_auth_user_id OR NEW.review_source!=OLD.review_source OR NEW.created_at!=OLD.created_at
    OR NEW.revision!=OLD.revision+1 OR NOT EXISTS(SELECT 1 FROM commerce_review_changes c WHERE c.review_id=NEW.id AND c.revision=NEW.revision
      AND c.commerce_environment=NEW.commerce_environment AND c.created_at=NEW.updated_at
      AND json_extract(c.data_json,'$.rating')=NEW.rating AND json_extract(c.data_json,'$.title')=NEW.title AND json_extract(c.data_json,'$.body')=NEW.body
      AND json_extract(c.data_json,'$.publicName')=NEW.public_name AND json_extract(c.data_json,'$.contentRevision')=NEW.content_revision
      AND json_extract(c.data_json,'$.buyerState')=NEW.buyer_state AND json_extract(c.data_json,'$.moderationState')=NEW.moderation_state
      AND json_extract(c.data_json,'$.moderationReason')=NEW.moderation_reason AND json_extract(c.data_json,'$.moderationNote')=NEW.moderation_note
      AND json_extract(c.data_json,'$.moderatedAt') IS NEW.moderated_at AND json_extract(c.data_json,'$.reply')=NEW.reply_body
      AND json_extract(c.data_json,'$.replyContentRevision')=NEW.reply_content_revision AND json_extract(c.data_json,'$.repliedAt') IS NEW.replied_at
      AND json_extract(c.data_json,'$.media')=NEW.media_json)
    OR (NEW.buyer_state='published' AND NEW.moderation_state='visible' AND NEW.status!='published')
    OR (NEW.buyer_state='published' AND NEW.moderation_state='pending' AND NEW.status!='pending')
    OR ((NEW.buyer_state='withdrawn' OR NEW.moderation_state='hidden') AND NEW.status!='rejected');
END;
CREATE TRIGGER commerce_review_delete BEFORE DELETE ON product_reviews BEGIN SELECT RAISE(ABORT,'review_history_retained'); END;
CREATE TRIGGER commerce_review_change_update BEFORE UPDATE ON commerce_review_changes BEGIN SELECT RAISE(ABORT,'review_history_immutable'); END;
CREATE TRIGGER commerce_review_change_delete BEFORE DELETE ON commerce_review_changes BEGIN SELECT RAISE(ABORT,'review_history_immutable'); END;

CREATE TRIGGER commerce_review_media_insert BEFORE INSERT ON commerce_review_media BEGIN
  SELECT RAISE(ABORT,'review_photo_owner') WHERE NEW.state!='uploading' OR NEW.cleanup_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM order_items i JOIN orders o ON o.id=i.order_id
    LEFT JOIN commerce_order_owners a ON a.order_id=o.id WHERE i.id=NEW.order_item_id AND i.seller_id=NEW.seller_id AND o.commerce_version=1
      AND o.commerce_environment=NEW.commerce_environment AND COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=NEW.owner_auth_user_id);
  SELECT RAISE(ABORT,'review_photo_rate') WHERE (SELECT COUNT(*) FROM commerce_review_media WHERE owner_auth_user_id=NEW.owner_auth_user_id
    AND commerce_environment=NEW.commerce_environment AND created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour'))>=30;
END;
CREATE TRIGGER commerce_review_media_update BEFORE UPDATE ON commerce_review_media BEGIN
  SELECT RAISE(ABORT,'review_photo_immutable') WHERE NEW.id!=OLD.id OR NEW.seller_id!=OLD.seller_id OR NEW.commerce_environment!=OLD.commerce_environment
    OR NEW.order_item_id!=OLD.order_item_id OR NEW.owner_auth_user_id!=OLD.owner_auth_user_id OR NEW.request_key!=OLD.request_key OR NEW.content_hash!=OLD.content_hash
    OR NEW.r2_key!=OLD.r2_key OR NEW.mime_type!=OLD.mime_type OR NEW.size_bytes!=OLD.size_bytes OR NEW.created_at!=OLD.created_at OR NEW.expires_at!=OLD.expires_at
    OR (NEW.state!='deleting' AND NEW.cleanup_at IS NOT OLD.cleanup_at)
    OR NOT ((OLD.state='uploading' AND NEW.state='ready') OR (NEW.state='deleting' AND OLD.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND NOT EXISTS(SELECT 1 FROM commerce_review_media_links l WHERE l.media_id=OLD.id)));
END;
CREATE TRIGGER commerce_review_media_delete BEFORE DELETE ON commerce_review_media
WHEN OLD.state!='deleting' OR EXISTS(SELECT 1 FROM commerce_review_media_links l WHERE l.media_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'review_photo_retained'); END;
CREATE TRIGGER commerce_review_media_link_insert BEFORE INSERT ON commerce_review_media_links BEGIN
  SELECT RAISE(ABORT,'review_photo_receipt_required') WHERE NOT EXISTS(SELECT 1 FROM commerce_review_changes c,json_each(c.data_json,'$.media') p
    WHERE c.review_id=NEW.review_id AND c.revision=NEW.first_revision AND c.kind='publish' AND p.value=NEW.media_id);
END;
CREATE TRIGGER commerce_review_media_link_update BEFORE UPDATE ON commerce_review_media_links BEGIN SELECT RAISE(ABORT,'review_photo_link_immutable'); END;
CREATE TRIGGER commerce_review_media_link_delete BEFORE DELETE ON commerce_review_media_links BEGIN SELECT RAISE(ABORT,'review_photo_link_immutable'); END;
