-- Digital reviews require the original payment entitlement and complete-download evidence.
-- All ownership, revision, moderation, photo and physical-delivery guards remain intact.
DROP TRIGGER commerce_review_change_guard;
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
      AND i.seller_id=NEW.seller_id AND i.product_id IS NOT NULL AND o.checkout_state IN ('paid','partially_refunded','refunded')
  AND EXISTS(SELECT 1 FROM commerce_payment_captures c WHERE c.order_id=o.id AND c.capture_kind='order_payment' AND c.amount=o.total_amount)
  AND ((i.product_type='physical'
    AND (EXISTS(SELECT 1 FROM inventory_reservations h WHERE h.order_item_id=i.id AND h.state='committed')
      OR EXISTS(SELECT 1 FROM commerce_stock_allocations x WHERE x.order_item_id=i.id))
    AND EXISTS(SELECT 1 FROM commerce_shipments s WHERE s.order_id=o.id AND s.commerce_environment=o.commerce_environment
      AND s.provider_id IS NOT NULL AND s.provider_account_hash IS NOT NULL AND s.delivered_at IS NOT NULL))
  OR (i.product_type='digital' AND EXISTS(SELECT 1 FROM commerce_digital_deliveries d
    JOIN commerce_digital_entitlements e ON e.order_item_id=d.order_item_id
    JOIN commerce_payment_captures c ON c.id=e.capture_id AND c.order_id=o.id AND c.capture_kind='order_payment' AND c.amount=o.total_amount
    WHERE d.order_item_id=i.id AND d.evidence_version=1)))
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
