-- WheelDesk Layer 6B: unified execution lifecycle for Iron Fly and credit spreads.
-- Run once in the Supabase SQL editor before deploying the Layer 6B source patch.

BEGIN;

ALTER TABLE zero_dte_execution_positions
  ADD COLUMN IF NOT EXISTS strategy_label TEXT,
  ADD COLUMN IF NOT EXISTS setup_key TEXT,
  ADD COLUMN IF NOT EXISTS legs JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS max_risk_dollars NUMERIC,
  ADD COLUMN IF NOT EXISTS entry_score NUMERIC,
  ADD COLUMN IF NOT EXISTS entry_map_phase TEXT,
  ADD COLUMN IF NOT EXISTS entry_map_center NUMERIC,
  ADD COLUMN IF NOT EXISTS entry_rail_breached TEXT,
  ADD COLUMN IF NOT EXISTS entry_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS exit_score NUMERIC,
  ADD COLUMN IF NOT EXISTS exit_reason TEXT,
  ADD COLUMN IF NOT EXISTS exit_emergency BOOLEAN NOT NULL DEFAULT FALSE;


ALTER TABLE zero_dte_execution_positions
  ALTER COLUMN strategy SET DEFAULT 'iron-fly';

UPDATE zero_dte_execution_positions
SET
  strategy = 'iron-fly',
  strategy_label = COALESCE(strategy_label, 'Iron Fly')
WHERE strategy IN ('iron_fly', 'iron fly', 'IRON_FLY');

ALTER TABLE zero_dte_execution_score_history
  ADD COLUMN IF NOT EXISTS strategy TEXT NOT NULL DEFAULT 'iron-fly',
  ADD COLUMN IF NOT EXISTS setup_key TEXT,
  ADD COLUMN IF NOT EXISTS strategy_credit NUMERIC,
  ADD COLUMN IF NOT EXISTS entry_score NUMERIC,
  ADD COLUMN IF NOT EXISTS exit_score NUMERIC,
  ADD COLUMN IF NOT EXISTS map_phase TEXT,
  ADD COLUMN IF NOT EXISTS map_center NUMERIC,
  ADD COLUMN IF NOT EXISTS rail_breached TEXT,
  ADD COLUMN IF NOT EXISTS lifecycle TEXT,
  ADD COLUMN IF NOT EXISTS premium_expansion_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS premium_from_peak_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS emergency_exit BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_zero_dte_execution_history_setup
  ON zero_dte_execution_score_history(trade_day_id, setup_key, sampled_at);

CREATE INDEX IF NOT EXISTS idx_zero_dte_execution_positions_strategy
  ON zero_dte_execution_positions(trade_day_id, strategy, entry_time DESC);

COMMIT;
