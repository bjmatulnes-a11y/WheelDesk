-- WheelDesk 0DTE database-backed execution intelligence (ownerless/server-managed).
-- Run once in the Supabase SQL editor for a fresh installation.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS zero_dte_execution_trade_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_date DATE NOT NULL,
  symbol TEXT NOT NULL DEFAULT 'SPX',
  expiration_date DATE,
  opening_if_center NUMERIC NOT NULL,
  opening_if_width NUMERIC NOT NULL DEFAULT 50,
  lower_wing NUMERIC NOT NULL,
  upper_wing NUMERIC NOT NULL,
  opening_put_wall NUMERIC,
  opening_call_wall NUMERIC,
  opening_gravity NUMERIC,
  locked_put_short NUMERIC,
  locked_put_long NUMERIC,
  locked_call_short NUMERIC,
  locked_call_long NUMERIC,
  opening_if_credit NUMERIC,
  opening_dealer_pressure NUMERIC,
  opening_pin_score NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(trade_date, symbol)
);

CREATE TABLE IF NOT EXISTS zero_dte_execution_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_day_id UUID NOT NULL REFERENCES zero_dte_execution_trade_days(id) ON DELETE CASCADE,
  strategy TEXT NOT NULL DEFAULT 'iron_fly',
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','closed','cancelled')),
  entry_time TIMESTAMPTZ NOT NULL,
  exit_time TIMESTAMPTZ,
  entry_credit NUMERIC NOT NULL,
  exit_debit NUMERIC,
  contracts INTEGER NOT NULL DEFAULT 1,
  setup_side TEXT NOT NULL DEFAULT 'center' CHECK (setup_side IN ('upper','lower','center')),
  entry_sell_score NUMERIC,
  entry_spring_probability NUMERIC,
  entry_opportunity_score NUMERIC,
  exit_buyback_score NUMERIC,
  realized_pnl NUMERIC,
  duration_minutes NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_zero_dte_execution_one_open_position
  ON zero_dte_execution_positions(trade_day_id)
  WHERE state = 'open';

CREATE TABLE IF NOT EXISTS zero_dte_execution_score_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_day_id UUID NOT NULL REFERENCES zero_dte_execution_trade_days(id) ON DELETE CASCADE,
  position_id UUID REFERENCES zero_dte_execution_positions(id) ON DELETE SET NULL,
  sampled_at TIMESTAMPTZ NOT NULL,
  spx_price NUMERIC NOT NULL,
  if_credit NUMERIC,
  sell_score NUMERIC NOT NULL,
  buyback_score NUMERIC NOT NULL DEFAULT 0,
  spring_probability NUMERIC NOT NULL,
  opportunity_score NUMERIC NOT NULL,
  dealer_pressure NUMERIC,
  strike_flow_state TEXT,
  premium_efficiency NUMERIC,
  peak_credit NUMERIC,
  credit_velocity NUMERIC,
  edge TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(trade_day_id, sampled_at)
);

CREATE TABLE IF NOT EXISTS zero_dte_execution_exits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id UUID NOT NULL UNIQUE REFERENCES zero_dte_execution_positions(id) ON DELETE CASCADE,
  exit_time TIMESTAMPTZ NOT NULL,
  exit_debit NUMERIC NOT NULL,
  realized_pnl NUMERIC NOT NULL,
  buyback_score NUMERIC,
  hold_minutes NUMERIC,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zero_dte_execution_days_date
  ON zero_dte_execution_trade_days(trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_zero_dte_execution_positions_time
  ON zero_dte_execution_positions(entry_time DESC);
CREATE INDEX IF NOT EXISTS idx_zero_dte_execution_history_day_time
  ON zero_dte_execution_score_history(trade_day_id, sampled_at);

-- These tables remain server-managed. RLS can stay enabled because the
-- service-role client bypasses RLS; no browser policies are required.
ALTER TABLE zero_dte_execution_trade_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE zero_dte_execution_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE zero_dte_execution_score_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE zero_dte_execution_exits ENABLE ROW LEVEL SECURITY;
