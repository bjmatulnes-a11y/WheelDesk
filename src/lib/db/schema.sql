-- WheelDesk Supabase schema
-- Run this in Supabase SQL editor before using Dashboard Harvest / Control Center / Validation.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS option_surface_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  surface_key TEXT NOT NULL,
  spot NUMERIC,
  selected_expiration DATE,
  selected_dte INTEGER,
  daily_structure JSONB,
  prevailing_levels JSONB,
  implied_path JSONB,
  summary JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT option_surface_snapshots_unique_surface UNIQUE (ticker, snapshot_date, surface_key)
);

CREATE INDEX IF NOT EXISTS idx_option_surface_snapshots_ticker_date
  ON option_surface_snapshots (ticker, snapshot_date DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS option_chain_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES option_surface_snapshots(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  expiration DATE,
  dte INTEGER,
  strike NUMERIC NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('call', 'put')),
  open_interest NUMERIC,
  volume NUMERIC,
  iv NUMERIC,
  delta NUMERIC,
  gamma NUMERIC,
  theta NUMERIC,
  vega NUMERIC,
  bid NUMERIC,
  ask NUMERIC,
  last NUMERIC,
  change NUMERIC,
  percent_change NUMERIC,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_option_chain_rows_snapshot_id
  ON option_chain_rows (snapshot_id, expiration, strike, side);

CREATE INDEX IF NOT EXISTS idx_option_chain_rows_ticker_date
  ON option_chain_rows (ticker, snapshot_date DESC, expiration, strike, side);

CREATE INDEX IF NOT EXISTS idx_option_chain_rows_expiration
  ON option_chain_rows (ticker, expiration, dte);
