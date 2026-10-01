-- Migration: Drop Stripe Order and Beans MinisOrder tables
-- Date: 2026-09-26
-- Backend version: 2.4.0

-- Drop Order table (Stripe legacy)
-- Note: Foreign key constraints are handled automatically by DROP TABLE CASCADE
DROP TABLE IF EXISTS "Order";

-- Drop MinisOrder table (TikTok Beans single-episode payment)
DROP TABLE IF EXISTS "MinisOrder";

-- MinisSubscription table already exists and is the primary payment model
-- UserUnlock table is kept for legacy compatibility
