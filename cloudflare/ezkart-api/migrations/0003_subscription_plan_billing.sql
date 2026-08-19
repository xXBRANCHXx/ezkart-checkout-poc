-- Subscription products can offer multiple plans, each with its own cadence.
ALTER TABLE product_variants ADD COLUMN billing_interval TEXT
  CHECK (billing_interval IS NULL OR billing_interval IN ('day', 'week', 'month'));

ALTER TABLE product_variants ADD COLUMN billing_interval_count INTEGER
  CHECK (billing_interval_count IS NULL OR billing_interval_count BETWEEN 1 AND 12);
