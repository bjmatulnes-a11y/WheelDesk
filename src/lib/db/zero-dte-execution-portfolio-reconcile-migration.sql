-- WheelDesk 0DTE execution persistence reconciliation.
-- Safe to run after the historical Layer 6D and remove-owner migrations.
-- The current Portfolio Dock supports multiple simultaneous open positions,
-- while preventing duplicate open copies of the exact same setup.

BEGIN;

-- Historical remove-owner migration recreated these global uniqueness rules,
-- which conflict with the current multi-position portfolio model.
DROP INDEX IF EXISTS uq_zero_dte_execution_one_open_position;
DROP INDEX IF EXISTS uq_zero_dte_execution_score_sample;

-- Some older schemas used a table-level one-sample-per-timestamp constraint.
ALTER TABLE zero_dte_execution_score_history
  DROP CONSTRAINT IF EXISTS zero_dte_execution_score_history_trade_day_id_sampled_at_key;

-- Permit multiple positions per day, but never duplicate the same live setup.
CREATE UNIQUE INDEX IF NOT EXISTS uq_zero_dte_execution_open_setup
  ON zero_dte_execution_positions(trade_day_id, setup_key)
  WHERE state = 'open' AND setup_key IS NOT NULL;

-- Permit each tracked setup to write its own sample at the same timestamp.
CREATE UNIQUE INDEX IF NOT EXISTS uq_zero_dte_execution_history_setup_time
  ON zero_dte_execution_score_history(trade_day_id, setup_key, sampled_at);

CREATE INDEX IF NOT EXISTS idx_zero_dte_execution_positions_open_portfolio
  ON zero_dte_execution_positions(trade_day_id, state, entry_time);

COMMIT;
