-- Scoped keyset pagination and bounded per-order reconciliation reads.
CREATE INDEX idx_commerce_orders_read ON orders(seller_id,commerce_environment,commerce_version,created_at DESC,id DESC);
CREATE INDEX idx_commerce_orders_state_read ON orders(seller_id,commerce_environment,commerce_version,checkout_state,created_at DESC,id DESC);
CREATE INDEX idx_commerce_items_read ON order_items(seller_id,order_id,id);
CREATE INDEX idx_commerce_captures_read ON commerce_payment_captures(seller_id,order_id,verified_at DESC,id DESC);
CREATE INDEX idx_commerce_jobs_order_read ON commerce_jobs(seller_id,order_id,state,kind);
CREATE INDEX idx_commerce_events_read ON commerce_order_events(seller_id,order_id,created_at DESC,id DESC);
