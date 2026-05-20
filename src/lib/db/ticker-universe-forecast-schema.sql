-- WheelDesk 19: Central ticker universe + OI forecast receipt foundation
-- Run this in Supabase SQL Editor after billing/account schema has been applied.
-- This patch centralizes tracked symbols and stores OI Field forecasts once per ticker/snapshot.

CREATE TABLE IF NOT EXISTS public.ticker_universe (
  symbol TEXT PRIMARY KEY,
  name TEXT,
  asset_type TEXT NOT NULL DEFAULT 'stock', -- stock, etf, index
  supports_options BOOLEAN NOT NULL DEFAULT TRUE,
  supports_equity_candles BOOLEAN NOT NULL DEFAULT TRUE,
  supports_index_context BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  data_priority INTEGER NOT NULL DEFAULT 100,
  provider_hint TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_watchlist_tickers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL REFERENCES public.ticker_universe(symbol) ON DELETE RESTRICT,
  slot_index INTEGER,
  source TEXT NOT NULL DEFAULT 'user', -- user, system, founder_seed
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, symbol)
);

CREATE TABLE IF NOT EXISTS public.watchlist_replacement_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  removed_symbol TEXT,
  added_symbol TEXT,
  event_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.plan_entitlements (
  plan TEXT PRIMARY KEY,
  max_tickers INTEGER NOT NULL,
  max_replacements_per_day INTEGER NOT NULL,
  max_validation_history_days INTEGER NOT NULL,
  max_forecast_horizons INTEGER NOT NULL DEFAULT 7,
  can_request_tickers BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.oi_field_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL REFERENCES public.ticker_universe(symbol) ON DELETE RESTRICT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  surface_snapshot_id UUID,
  source TEXT NOT NULL DEFAULT 'control_center',
  provider TEXT,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expiration DATE,
  dte INTEGER,
  spot NUMERIC NOT NULL,
  bias TEXT,
  confidence NUMERIC,
  structure_band_lower NUMERIC,
  structure_band_upper NUMERIC,
  expected_move_lower NUMERIC,
  expected_move_upper NUMERIC,
  expected_move NUMERIC,
  expected_move_source TEXT, -- atm_iv, straddle, user_input, unavailable
  base_1d NUMERIC,
  base_3d NUMERIC,
  base_5d NUMERIC,
  base_10d NUMERIC,
  base_14d NUMERIC,
  base_30d NUMERIC,
  base_exp NUMERIC,
  upper_1d NUMERIC,
  upper_3d NUMERIC,
  upper_5d NUMERIC,
  upper_10d NUMERIC,
  upper_14d NUMERIC,
  upper_30d NUMERIC,
  upper_exp NUMERIC,
  lower_1d NUMERIC,
  lower_3d NUMERIC,
  lower_5d NUMERIC,
  lower_10d NUMERIC,
  lower_14d NUMERIC,
  lower_30d NUMERIC,
  lower_exp NUMERIC,
  pin_probability NUMERIC,
  upper_touch_probability NUMERIC,
  lower_break_probability NUMERIC,
  trap_probability NUMERIC,
  wheel_support_hold_probability NUMERIC,
  posture TEXT,
  inputs JSONB,
  forecast JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (symbol, snapshot_date, expiration, source)
);

CREATE TABLE IF NOT EXISTS public.oi_field_forecast_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_id UUID NOT NULL REFERENCES public.oi_field_forecasts(id) ON DELETE CASCADE,
  horizon TEXT NOT NULL, -- 1D, 3D, 5D, 10D, 14D, 30D, EXP
  horizon_date DATE,
  actual_close NUMERIC,
  actual_high NUMERIC,
  actual_low NUMERIC,
  touched_upper BOOLEAN,
  broke_lower BOOLEAN,
  pinned_near_base BOOLEAN,
  support_held BOOLEAN,
  bias_correct BOOLEAN,
  absolute_error NUMERIC,
  percent_error NUMERIC,
  outcome JSONB,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (forecast_id, horizon)
);

CREATE INDEX IF NOT EXISTS idx_ticker_universe_active_priority
  ON public.ticker_universe (is_active, data_priority, symbol);

CREATE INDEX IF NOT EXISTS idx_user_watchlist_user_created
  ON public.user_watchlist_tickers (user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_replacement_events_user_date
  ON public.watchlist_replacement_events (user_id, event_date);

CREATE INDEX IF NOT EXISTS idx_oi_field_forecasts_symbol_generated
  ON public.oi_field_forecasts (symbol, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_oi_field_forecasts_snapshot
  ON public.oi_field_forecasts (snapshot_date DESC, symbol, expiration);

CREATE INDEX IF NOT EXISTS idx_oi_field_outcomes_forecast
  ON public.oi_field_forecast_outcomes (forecast_id, horizon);

ALTER TABLE public.ticker_universe ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_watchlist_tickers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watchlist_replacement_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oi_field_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oi_field_forecast_outcomes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone authenticated can read active ticker universe" ON public.ticker_universe;
CREATE POLICY "Anyone authenticated can read active ticker universe"
ON public.ticker_universe
FOR SELECT
TO authenticated
USING (is_active = TRUE);

DROP POLICY IF EXISTS "Users can read own watchlist" ON public.user_watchlist_tickers;
CREATE POLICY "Users can read own watchlist"
ON public.user_watchlist_tickers
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own watchlist" ON public.user_watchlist_tickers;
CREATE POLICY "Users can insert own watchlist"
ON public.user_watchlist_tickers
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own watchlist" ON public.user_watchlist_tickers;
CREATE POLICY "Users can delete own watchlist"
ON public.user_watchlist_tickers
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read own replacement events" ON public.watchlist_replacement_events;
CREATE POLICY "Users can read own replacement events"
ON public.watchlist_replacement_events
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own replacement events" ON public.watchlist_replacement_events;
CREATE POLICY "Users can insert own replacement events"
ON public.watchlist_replacement_events
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Anyone authenticated can read plan entitlements" ON public.plan_entitlements;
CREATE POLICY "Anyone authenticated can read plan entitlements"
ON public.plan_entitlements
FOR SELECT
TO authenticated
USING (TRUE);

DROP POLICY IF EXISTS "Authenticated users can read forecasts" ON public.oi_field_forecasts;
CREATE POLICY "Authenticated users can read forecasts"
ON public.oi_field_forecasts
FOR SELECT
TO authenticated
USING (TRUE);

DROP POLICY IF EXISTS "Authenticated users can insert forecasts" ON public.oi_field_forecasts;
CREATE POLICY "Authenticated users can insert forecasts"
ON public.oi_field_forecasts
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Authenticated users can read forecast outcomes" ON public.oi_field_forecast_outcomes;
CREATE POLICY "Authenticated users can read forecast outcomes"
ON public.oi_field_forecast_outcomes
FOR SELECT
TO authenticated
USING (TRUE);

INSERT INTO public.plan_entitlements
  (plan, max_tickers, max_replacements_per_day, max_validation_history_days, max_forecast_horizons)
VALUES
  ('founder', 10, 3, 90, 7),
  ('core', 15, 3, 180, 7),
  ('research', 30, 6, 730, 7)
ON CONFLICT (plan) DO UPDATE SET
  max_tickers = EXCLUDED.max_tickers,
  max_replacements_per_day = EXCLUDED.max_replacements_per_day,
  max_validation_history_days = EXCLUDED.max_validation_history_days,
  max_forecast_horizons = EXCLUDED.max_forecast_horizons,
  updated_at = NOW();

INSERT INTO public.ticker_universe
  (symbol, name, asset_type, supports_options, supports_equity_candles, supports_index_context, data_priority, notes)
VALUES
  ('SPY', 'SPDR S&P 500 ETF Trust', 'etf', TRUE, TRUE, TRUE, 1, 'Core market ETF'),
  ('QQQ', 'Invesco QQQ Trust', 'etf', TRUE, TRUE, TRUE, 2, 'Core tech/growth ETF'),
  ('IWM', 'iShares Russell 2000 ETF', 'etf', TRUE, TRUE, TRUE, 3, 'Small-cap ETF'),
  ('DIA', 'SPDR Dow Jones Industrial Average ETF Trust', 'etf', TRUE, TRUE, TRUE, 4, 'Dow ETF'),
  ('NVDA', 'NVIDIA Corporation', 'stock', TRUE, TRUE, FALSE, 10, 'High-liquidity options name'),
  ('AMD', 'Advanced Micro Devices, Inc.', 'stock', TRUE, TRUE, FALSE, 11, 'High-liquidity options name'),
  ('AAPL', 'Apple Inc.', 'stock', TRUE, TRUE, FALSE, 12, 'Mega-cap options name'),
  ('MSFT', 'Microsoft Corporation', 'stock', TRUE, TRUE, FALSE, 13, 'Mega-cap options name'),
  ('AMZN', 'Amazon.com, Inc.', 'stock', TRUE, TRUE, FALSE, 14, 'Mega-cap options name'),
  ('META', 'Meta Platforms, Inc.', 'stock', TRUE, TRUE, FALSE, 15, 'Mega-cap options name'),
  ('GOOGL', 'Alphabet Inc.', 'stock', TRUE, TRUE, FALSE, 16, 'Mega-cap options name'),
  ('TSLA', 'Tesla, Inc.', 'stock', TRUE, TRUE, FALSE, 17, 'High-beta options name'),
  ('NFLX', 'Netflix, Inc.', 'stock', TRUE, TRUE, FALSE, 18, 'High-beta options name'),
  ('PLTR', 'Palantir Technologies Inc.', 'stock', TRUE, TRUE, FALSE, 19, 'Retail-active options name'),
  ('SOFI', 'SoFi Technologies, Inc.', 'stock', TRUE, TRUE, FALSE, 20, 'WheelDesk founder watchlist name'),
  ('IONQ', 'IonQ, Inc.', 'stock', TRUE, TRUE, FALSE, 21, 'Quantum/retail-active options name'),
  ('RGTI', 'Rigetti Computing, Inc.', 'stock', TRUE, TRUE, FALSE, 22, 'Quantum/retail-active options name'),
  ('COIN', 'Coinbase Global, Inc.', 'stock', TRUE, TRUE, FALSE, 23, 'High-beta options name'),
  ('MSTR', 'MicroStrategy Incorporated', 'stock', TRUE, TRUE, FALSE, 24, 'High-beta options name'),
  ('SMCI', 'Super Micro Computer, Inc.', 'stock', TRUE, TRUE, FALSE, 25, 'High-beta options name')
ON CONFLICT (symbol) DO UPDATE SET
  name = EXCLUDED.name,
  asset_type = EXCLUDED.asset_type,
  supports_options = EXCLUDED.supports_options,
  supports_equity_candles = EXCLUDED.supports_equity_candles,
  supports_index_context = EXCLUDED.supports_index_context,
  data_priority = EXCLUDED.data_priority,
  notes = EXCLUDED.notes,
  is_active = TRUE,
  updated_at = NOW();
