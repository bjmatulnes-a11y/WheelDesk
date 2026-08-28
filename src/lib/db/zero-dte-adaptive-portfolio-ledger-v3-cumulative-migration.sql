-- WheelDesk 0DTE — Adaptive Portfolio + Lot/Leg Ledger V3 CUMULATIVE
-- Existing install path: Adaptive Management V1 -> V3.
-- User has NOT installed Ledger V2, so run ONLY THIS migration once.
-- It includes the V2 ledger columns plus the V3 dynamic capital/repair diagnostics.
-- All ADD COLUMN / indexes are idempotent to make a cautious re-run non-destructive.

BEGIN;

ALTER TABLE zero_dte_shadow_trades
  ADD COLUMN IF NOT EXISTS portfolio_decision text,
  ADD COLUMN IF NOT EXISTS portfolio_role text,
  ADD COLUMN IF NOT EXISTS portfolio_conviction text,
  ADD COLUMN IF NOT EXISTS portfolio_conviction_score numeric,
  ADD COLUMN IF NOT EXISTS premium_quality_score numeric,
  ADD COLUMN IF NOT EXISTS premium_quality_label text,
  ADD COLUMN IF NOT EXISTS effective_risk_before_dollars numeric,
  ADD COLUMN IF NOT EXISTS effective_risk_after_dollars numeric,
  ADD COLUMN IF NOT EXISTS incremental_effective_risk_dollars numeric,
  ADD COLUMN IF NOT EXISTS available_capacity_after_dollars numeric,
  ADD COLUMN IF NOT EXISTS adaptive_reserve_need_dollars numeric,
  ADD COLUMN IF NOT EXISTS reserve_coverage_x numeric,
  ADD COLUMN IF NOT EXISTS portfolio_decision_reason text,
  ADD COLUMN IF NOT EXISTS entry_leg_snapshots jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS current_leg_snapshots jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS entry_greeks jsonb,
  ADD COLUMN IF NOT EXISTS current_greeks jsonb,
  ADD COLUMN IF NOT EXISTS adaptive_structure_state text,
  ADD COLUMN IF NOT EXISTS adaptive_active_legs jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS adaptive_net_cash_points numeric,
  ADD COLUMN IF NOT EXISTS adaptive_marked_pnl_dollars numeric,
  ADD COLUMN IF NOT EXISTS adaptive_released_short_strike numeric,
  ADD COLUMN IF NOT EXISTS adaptive_reinstated_short_strike numeric,
  ADD COLUMN IF NOT EXISTS adaptive_structure_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS call_release_reserve_dollars numeric,
  ADD COLUMN IF NOT EXISTS put_release_reserve_dollars numeric,
  ADD COLUMN IF NOT EXISTS reserve_dominant_side text,
  ADD COLUMN IF NOT EXISTS portfolio_repair_deficit_dollars numeric,
  ADD COLUMN IF NOT EXISTS candidate_offset_credit_dollars numeric;

ALTER TABLE zero_dte_shadow_trade_samples
  ADD COLUMN IF NOT EXISTS current_leg_snapshots jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS current_greeks jsonb,
  ADD COLUMN IF NOT EXISTS adaptive_structure_state text,
  ADD COLUMN IF NOT EXISTS adaptive_marked_pnl_dollars numeric;

CREATE INDEX IF NOT EXISTS idx_zero_dte_shadow_portfolio_decision
  ON zero_dte_shadow_trades(user_id, trade_date, portfolio_decision, signal_time);

CREATE INDEX IF NOT EXISTS idx_zero_dte_shadow_structure_state
  ON zero_dte_shadow_trades(user_id, trade_date, adaptive_structure_state)
  WHERE adaptive_state = 'open';

-- Mark pre-ledger Adaptive V1 rows as legacy accepted positions without
-- changing their realized/static/adaptive results.
UPDATE zero_dte_shadow_trades
SET portfolio_decision = CASE
      WHEN state = 'open' OR state = 'closed' THEN 'TAKE'
      ELSE portfolio_decision
    END,
    adaptive_structure_state = CASE
      WHEN adaptive_state IS NOT NULL AND strategy = 'iron-fly' THEN COALESCE(adaptive_structure_state, 'IF_CENTER')
      WHEN adaptive_state IS NOT NULL THEN COALESCE(adaptive_structure_state, 'CREDIT_SPREAD')
      ELSE adaptive_structure_state
    END,
    adaptive_active_legs = CASE
      WHEN adaptive_state = 'open' AND jsonb_array_length(adaptive_active_legs) = 0 THEN legs
      ELSE adaptive_active_legs
    END,
    adaptive_net_cash_points = CASE
      WHEN adaptive_state = 'open' AND adaptive_net_cash_points IS NULL THEN entry_sellable_credit
      ELSE adaptive_net_cash_points
    END
WHERE portfolio_decision IS NULL OR adaptive_structure_state IS NULL;

COMMENT ON COLUMN zero_dte_shadow_trades.call_release_reserve_dollars IS
  'Modeled aggregate cash reserve to release the currently active call short book; dynamic by active lots/short entry prices.';
COMMENT ON COLUMN zero_dte_shadow_trades.put_release_reserve_dollars IS
  'Modeled aggregate cash reserve to release the currently active put short book; dynamic by active lots/short entry prices.';
COMMENT ON COLUMN zero_dte_shadow_trades.reserve_dominant_side IS
  'CALL, PUT, BALANCED, or NONE for the larger current vertical short-release reserve side.';
COMMENT ON COLUMN zero_dte_shadow_trades.portfolio_repair_deficit_dollars IS
  'Marked negative P/L across active released/repaired vertical episodes at opportunity admission time.';
COMMENT ON COLUMN zero_dte_shadow_trades.candidate_offset_credit_dollars IS
  'One-lot entry credit available from the independently qualified candidate; informational repair-offset contribution.';

COMMIT;
