-- WheelDesk Layer 6I: manual-position bootstrap, actual short-leg risk memory,
-- and authoritative multi-lot portfolio reconciliation.
-- Run once after the historical execution migrations.

BEGIN;

-- A manual actual position may be recorded before the Opening Map exists.
-- The first normal engine sample later fills these structural fields.
ALTER TABLE zero_dte_execution_trade_days
  ALTER COLUMN opening_if_center DROP NOT NULL,
  ALTER COLUMN lower_wing DROP NOT NULL,
  ALTER COLUMN upper_wing DROP NOT NULL;

ALTER TABLE zero_dte_execution_trade_days
  ADD COLUMN IF NOT EXISTS initialization_source TEXT NOT NULL DEFAULT 'engine';

ALTER TABLE zero_dte_execution_positions
  ADD COLUMN IF NOT EXISTS entry_short_legs JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Historical migrations recreated one-position and one-setup uniqueness rules.
-- The current Portfolio Dock supports separate fills/lots, including repeated
-- strike geometry entered at different prices/times.
DROP INDEX IF EXISTS uq_zero_dte_execution_one_open_position;
DROP INDEX IF EXISTS uq_zero_dte_execution_open_setup;
DROP INDEX IF EXISTS uq_zero_dte_execution_score_sample;

ALTER TABLE zero_dte_execution_score_history
  DROP CONSTRAINT IF EXISTS zero_dte_execution_score_history_trade_day_id_sampled_at_key;

CREATE INDEX IF NOT EXISTS idx_zero_dte_execution_positions_open_setup
  ON zero_dte_execution_positions(trade_day_id, setup_key, entry_time)
  WHERE state = 'open' AND setup_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_zero_dte_execution_history_setup_time
  ON zero_dte_execution_score_history(trade_day_id, setup_key, sampled_at);

CREATE INDEX IF NOT EXISTS idx_zero_dte_execution_positions_open_portfolio
  ON zero_dte_execution_positions(trade_day_id, state, entry_time);

COMMIT;
