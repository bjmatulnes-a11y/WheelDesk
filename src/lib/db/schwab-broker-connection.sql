-- WheelDesk per-user Schwab connections.
-- Service-role only: broker tokens are never readable directly by browser users.

CREATE TABLE IF NOT EXISTS broker_connections (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_broker_connections_user_provider
  ON broker_connections(user_id, provider);

CREATE INDEX IF NOT EXISTS idx_broker_connections_provider
  ON broker_connections(provider);
