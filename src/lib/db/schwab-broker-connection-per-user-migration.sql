-- WheelDesk migration: platform-wide Schwab token -> one Schwab connection per user.
-- Run once in Supabase SQL Editor BEFORE deploying the accompanying code patch.
--
-- The old row used id='primary' and had no owner. It cannot be safely assigned
-- to an arbitrary subscriber, so this migration removes legacy unowned broker
-- credentials. Existing WheelDesk users will reconnect Schwab once after deploy.
-- No market history, 0DTE history, snapshots, or trading records are deleted.

BEGIN;

ALTER TABLE broker_connections
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- Remove only legacy/unowned credentials. A per-user row is preserved.
DELETE FROM broker_connections
WHERE user_id IS NULL;

ALTER TABLE broker_connections
  ALTER COLUMN user_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_broker_connections_user_provider
  ON broker_connections(user_id, provider);

CREATE INDEX IF NOT EXISTS idx_broker_connections_provider
  ON broker_connections(provider);

ALTER TABLE broker_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON broker_connections FROM anon;
REVOKE ALL ON broker_connections FROM authenticated;

COMMIT;
