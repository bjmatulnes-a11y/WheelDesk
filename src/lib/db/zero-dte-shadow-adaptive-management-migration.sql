-- WheelDesk Shadow Lab — Adaptive Management Engine v1
-- Runs the adaptive manager in parallel with the existing static shadow exit.
-- Existing rows remain legacy/static-only because adaptive_state defaults NULL.

BEGIN;

ALTER TABLE zero_dte_shadow_trades
  ADD COLUMN IF NOT EXISTS adaptive_state text,
  ADD COLUMN IF NOT EXISTS adaptive_management_state text,
  ADD COLUMN IF NOT EXISTS adaptive_action text,
  ADD COLUMN IF NOT EXISTS adaptive_target_capture_pct numeric,
  ADD COLUMN IF NOT EXISTS adaptive_target_debit numeric,
  ADD COLUMN IF NOT EXISTS adaptive_target_r numeric,
  ADD COLUMN IF NOT EXISTS adaptive_thesis_score numeric,
  ADD COLUMN IF NOT EXISTS adaptive_favorable_score numeric,
  ADD COLUMN IF NOT EXISTS adaptive_threat_score numeric,
  ADD COLUMN IF NOT EXISTS adaptive_invalidation_score numeric,
  ADD COLUMN IF NOT EXISTS adaptive_reason text,
  ADD COLUMN IF NOT EXISTS adaptive_max_adverse_excursion_dollars numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adaptive_max_favorable_excursion_dollars numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adaptive_profit_giveback_pct numeric,
  ADD COLUMN IF NOT EXISTS adaptive_exit_time timestamptz,
  ADD COLUMN IF NOT EXISTS adaptive_exit_reason text,
  ADD COLUMN IF NOT EXISTS adaptive_exit_buyback_debit numeric,
  ADD COLUMN IF NOT EXISTS adaptive_pnl_dollars numeric,
  ADD COLUMN IF NOT EXISTS adaptive_last_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS adaptive_auction_state text,
  ADD COLUMN IF NOT EXISTS adaptive_auction_pressure_pct numeric,
  ADD COLUMN IF NOT EXISTS adaptive_auction_efficiency_pct numeric,
  ADD COLUMN IF NOT EXISTS adaptive_projected_poc_spx numeric;

ALTER TABLE zero_dte_shadow_trade_samples
  ADD COLUMN IF NOT EXISTS adaptive_management_state text,
  ADD COLUMN IF NOT EXISTS adaptive_action text,
  ADD COLUMN IF NOT EXISTS adaptive_target_capture_pct numeric,
  ADD COLUMN IF NOT EXISTS adaptive_target_debit numeric,
  ADD COLUMN IF NOT EXISTS adaptive_target_r numeric,
  ADD COLUMN IF NOT EXISTS adaptive_thesis_score numeric,
  ADD COLUMN IF NOT EXISTS adaptive_favorable_score numeric,
  ADD COLUMN IF NOT EXISTS adaptive_threat_score numeric,
  ADD COLUMN IF NOT EXISTS adaptive_invalidation_score numeric,
  ADD COLUMN IF NOT EXISTS adaptive_reason text,
  ADD COLUMN IF NOT EXISTS adaptive_auction_state text,
  ADD COLUMN IF NOT EXISTS adaptive_auction_pressure_pct numeric,
  ADD COLUMN IF NOT EXISTS adaptive_auction_efficiency_pct numeric,
  ADD COLUMN IF NOT EXISTS adaptive_projected_poc_spx numeric;

CREATE INDEX IF NOT EXISTS idx_zero_dte_shadow_adaptive_open
  ON zero_dte_shadow_trades(user_id, trade_date, adaptive_state)
  WHERE adaptive_state = 'open';

COMMIT;
