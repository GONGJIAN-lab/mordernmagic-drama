-- Migration: switch_to_subscription
-- 1. Add orderId column to MinisSubscription (nullable, records webhook order_id)
-- 2. Order / MinisOrder tables already removed in prior schema versions

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'MinisSubscription' AND column_name = 'orderId'
  ) THEN
    ALTER TABLE "MinisSubscription" ADD COLUMN "orderId" TEXT;
  END IF;
END $$;
