-- Bryan 0DTE Lab schema
-- Run in Supabase SQL editor before using /dashboard/zero-dte.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS zero_dte_lab_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_date DATE NOT NULL,
  expiration_date DATE NOT NULL,
  is_zero_dte BOOLEAN NOT NULL DEFAULT FALSE,
  as_of_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider TEXT NOT NULL DEFAULT 'Yahoo Finance delayed options',
  spx_provider_symbol TEXT,
  spy_provider_symbol TEXT,
  spx_price NUMERIC,
  spy_price NUMERIC,
  expected_move NUMERIC,
  suggested_center NUMERIC,
  suggested_wing_width NUMERIC,
  lower_wing NUMERIC,
  upper_wing NUMERIC,
  alignment_score NUMERIC,
  confidence_score NUMERIC,
  dealer_pressure NUMERIC,
  spx_oi JSONB,
  spy_oi JSONB,
  composite_oi JSONB,
  recommendation JSONB,
  notes JSONB,
  warnings JSONB,
  row_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zero_dte_lab_snapshots_user_asof
  ON zero_dte_lab_snapshots (user_id, as_of_at DESC);

CREATE INDEX IF NOT EXISTS idx_zero_dte_lab_snapshots_user_date
  ON zero_dte_lab_snapshots (user_id, trade_date DESC, as_of_at DESC);

CREATE TABLE IF NOT EXISTS zero_dte_lab_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES zero_dte_lab_snapshots(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_date DATE NOT NULL,
  expiration_date DATE NOT NULL,
  source_symbol TEXT NOT NULL CHECK (source_symbol IN ('SPX', 'SPY', 'SPY_EQUIV')),
  provider_symbol TEXT NOT NULL,
  contract_symbol TEXT,
  strike NUMERIC NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('call', 'put')),
  open_interest NUMERIC,
  volume NUMERIC,
  iv NUMERIC,
  delta NUMERIC,
  gamma NUMERIC,
  bid NUMERIC,
  ask NUMERIC,
  last NUMERIC,
  mid NUMERIC,
  underlying_price NUMERIC,
  notional_weight NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zero_dte_lab_rows_snapshot
  ON zero_dte_lab_rows (snapshot_id, strike, side);

CREATE INDEX IF NOT EXISTS idx_zero_dte_lab_rows_user_date
  ON zero_dte_lab_rows (user_id, trade_date DESC, source_symbol, strike, side);

CREATE TABLE IF NOT EXISTS zero_dte_lab_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot_id UUID REFERENCES zero_dte_lab_snapshots(id) ON DELETE SET NULL,
  trade_date DATE NOT NULL,
  expiration_date DATE NOT NULL,
  strategy TEXT NOT NULL DEFAULT 'iron_fly',
  status TEXT NOT NULL DEFAULT 'planned',
  entry_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  exit_time TIMESTAMPTZ,
  suggested_center NUMERIC,
  actual_center NUMERIC,
  wing_width NUMERIC,
  lower_wing NUMERIC,
  upper_wing NUMERIC,
  credit_received NUMERIC,
  debit_to_close NUMERIC,
  realized_pnl NUMERIC,
  close_spx NUMERIC,
  max_drawdown NUMERIC,
  notes TEXT,
  outcome_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zero_dte_lab_trades_user_entry
  ON zero_dte_lab_trades (user_id, entry_time DESC);

ALTER TABLE zero_dte_lab_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE zero_dte_lab_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE zero_dte_lab_trades ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'zero_dte_lab_snapshots' AND policyname = 'zero_dte_lab_snapshots_select_own'
  ) THEN
    CREATE POLICY zero_dte_lab_snapshots_select_own ON zero_dte_lab_snapshots
      FOR SELECT USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'zero_dte_lab_rows' AND policyname = 'zero_dte_lab_rows_select_own'
  ) THEN
    CREATE POLICY zero_dte_lab_rows_select_own ON zero_dte_lab_rows
      FOR SELECT USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'zero_dte_lab_trades' AND policyname = 'zero_dte_lab_trades_select_own'
  ) THEN
    CREATE POLICY zero_dte_lab_trades_select_own ON zero_dte_lab_trades
      FOR SELECT USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'zero_dte_lab_trades' AND policyname = 'zero_dte_lab_trades_insert_own'
  ) THEN
    CREATE POLICY zero_dte_lab_trades_insert_own ON zero_dte_lab_trades
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'zero_dte_lab_trades' AND policyname = 'zero_dte_lab_trades_update_own'
  ) THEN
    CREATE POLICY zero_dte_lab_trades_update_own ON zero_dte_lab_trades
      FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
