-- WheelDesk Layer 6D: time-aware candidate tracking and multi-spread portfolio support.
-- Run once after the Layer 6B migration.

BEGIN;

ALTER TABLE zero_dte_execution_positions
  ADD COLUMN IF NOT EXISTS entry_time_regime TEXT;

ALTER TABLE zero_dte_execution_score_history
  ADD COLUMN IF NOT EXISTS time_regime TEXT,
  ADD COLUMN IF NOT EXISTS short_distance_points NUMERIC,
  ADD COLUMN IF NOT EXISTS short_distance_expected_move_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS candidate_age_candles INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tracked_since TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS portfolio_contribution_score NUMERIC;

-- Layer 6B allowed one open position per trade day. Layer 6D permits a portfolio.
DROP INDEX IF EXISTS uq_zero_dte_execution_one_open_position;

-- Prevent accidentally opening the exact same strategy/strike set twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_zero_dte_execution_open_setup
  ON zero_dte_execution_positions(trade_day_id, setup_key)
  WHERE state = 'open' AND setup_key IS NOT NULL;

-- The old table-level unique constraint permitted only one strategy sample per timestamp.
ALTER TABLE zero_dte_execution_score_history
  DROP CONSTRAINT IF EXISTS zero_dte_execution_score_history_trade_day_id_sampled_at_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_zero_dte_execution_history_setup_time
  ON zero_dte_execution_score_history(trade_day_id, setup_key, sampled_at);

CREATE INDEX IF NOT EXISTS idx_zero_dte_execution_positions_open_portfolio
  ON zero_dte_execution_positions(trade_day_id, state, entry_time);

COMMIT;
