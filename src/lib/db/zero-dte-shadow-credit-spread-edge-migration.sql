-- WD261019v3 Credit Spread Edge Engine shadow context.
-- Safe to run more than once.

ALTER TABLE zero_dte_shadow_trades
  ADD COLUMN IF NOT EXISTS edge_pts double precision,
  ADD COLUMN IF NOT EXISTS ev_per_lot_dollars double precision,
  ADD COLUMN IF NOT EXISTS hist_prob_touch double precision,
  ADD COLUMN IF NOT EXISTS hist_prob_itm_at_close double precision,
  ADD COLUMN IF NOT EXISTS move_table_key_used text,
  ADD COLUMN IF NOT EXISTS move_table_n integer,
  ADD COLUMN IF NOT EXISTS plan_status text,
  ADD COLUMN IF NOT EXISTS entry_trigger text,
  ADD COLUMN IF NOT EXISTS entry_time_bucket text,
  ADD COLUMN IF NOT EXISTS gamma_regime text,
  ADD COLUMN IF NOT EXISTS directional_tilt text,
  ADD COLUMN IF NOT EXISTS exit_rule text,
  ADD COLUMN IF NOT EXISTS plan_guard_kind text,
  ADD COLUMN IF NOT EXISTS plan_guard_label text,
  ADD COLUMN IF NOT EXISTS plan_guard_price double precision,
  ADD COLUMN IF NOT EXISTS plan_distance_em double precision,
  ADD COLUMN IF NOT EXISTS plan_take_profit_pct double precision,
  ADD COLUMN IF NOT EXISTS plan_stop_credit_multiple double precision;

CREATE INDEX IF NOT EXISTS zero_dte_shadow_edge_setup_idx
  ON zero_dte_shadow_trades(user_id, state, strategy, opening_day_type, entry_time_bucket, entry_trigger, signal_time DESC);

COMMENT ON COLUMN zero_dte_shadow_trades.ev_per_lot_dollars IS
  'Hold-to-expiry empirical EV per 1-lot spread at entry, from the SPX move table.';
COMMENT ON COLUMN zero_dte_shadow_trades.move_table_key_used IS
  'Conditioning/fallback key used by the empirical SPX move table at entry.';
COMMENT ON COLUMN zero_dte_shadow_trades.plan_guard_price IS
  'Frozen defense level used for the structure-stop rule at entry.';
