-- WheelDesk personal Schwab connection.
-- Run once in the Supabase SQL editor before deploying the Schwab patch.
-- This table is intentionally service-role only; never expose it through the browser.

CREATE TABLE IF NOT EXISTS broker_connections (
  id text PRIMARY KEY,
  provider text NOT NULL,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  token_type text NOT NULL DEFAULT 'Bearer',
  scope text,
  expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE broker_connections ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON broker_connections FROM anon;
REVOKE ALL ON broker_connections FROM authenticated;

CREATE INDEX IF NOT EXISTS idx_broker_connections_provider
  ON broker_connections(provider);
