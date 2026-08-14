-- WheelDesk 0DTE execution persistence: remove per-user ownership.
-- Run once in the Supabase SQL editor before deploying the matching route patch.
-- The Next.js server uses the Supabase service-role client for these tables.

BEGIN;

-- Remove policies that depend on user_id before dropping the columns.
DROP POLICY IF EXISTS zero_dte_execution_trade_days_own_all ON zero_dte_execution_trade_days;
DROP POLICY IF EXISTS zero_dte_execution_positions_own_all ON zero_dte_execution_positions;
DROP POLICY IF EXISTS zero_dte_execution_score_history_own_all ON zero_dte_execution_score_history;
DROP POLICY IF EXISTS zero_dte_execution_exits_own_all ON zero_dte_execution_exits;

-- Remove old ownership-dependent indexes/constraints where present.
DROP INDEX IF EXISTS uq_zero_dte_execution_one_open_position;
DROP INDEX IF EXISTS idx_zero_dte_execution_days_user_date;
DROP INDEX IF EXISTS idx_zero_dte_execution_positions_user_time;

ALTER TABLE zero_dte_execution_trade_days DROP COLUMN IF EXISTS user_id CASCADE;
ALTER TABLE zero_dte_execution_positions DROP COLUMN IF EXISTS user_id CASCADE;
ALTER TABLE zero_dte_execution_score_history DROP COLUMN IF EXISTS user_id CASCADE;
ALTER TABLE zero_dte_execution_exits DROP COLUMN IF EXISTS user_id CASCADE;

-- One SPX trade plan per date.
CREATE UNIQUE INDEX IF NOT EXISTS uq_zero_dte_execution_trade_day
  ON zero_dte_execution_trade_days(trade_date, symbol);

-- Current portfolio model permits multiple open positions/lots per trade day.
DROP INDEX IF EXISTS uq_zero_dte_execution_one_open_position;
DROP INDEX IF EXISTS uq_zero_dte_execution_open_setup;
CREATE INDEX IF NOT EXISTS idx_zero_dte_execution_positions_open_setup
  ON zero_dte_execution_positions(trade_day_id, setup_key, entry_time)
  WHERE state = 'open' AND setup_key IS NOT NULL;

-- Current score history is unique per setup and timestamp, not globally per day.
DROP INDEX IF EXISTS uq_zero_dte_execution_score_sample;
CREATE UNIQUE INDEX IF NOT EXISTS uq_zero_dte_execution_history_setup_time
  ON zero_dte_execution_score_history(trade_day_id, setup_key, sampled_at);

CREATE INDEX IF NOT EXISTS idx_zero_dte_execution_days_date
  ON zero_dte_execution_trade_days(trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_zero_dte_execution_positions_time
  ON zero_dte_execution_positions(entry_time DESC);
CREATE INDEX IF NOT EXISTS idx_zero_dte_execution_history_day_time
  ON zero_dte_execution_score_history(trade_day_id, sampled_at);

COMMIT;
