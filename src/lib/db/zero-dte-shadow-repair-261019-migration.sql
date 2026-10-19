-- WheelDesk 0DTE Shadow Lab — cumulative repair migration (2026-10-19)
-- Safe to run on an existing install. It consolidates every column the current
-- Shadow API writes so a missed earlier migration cannot break paper trading.

BEGIN;

ALTER TABLE zero_dte_shadow_trades
  ADD COLUMN IF NOT EXISTS entry_short_legs jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS current_short_buyback_price numeric,
  ADD COLUMN IF NOT EXISTS current_short_leg_multiple numeric,
  ADD COLUMN IF NOT EXISTS directional_side text,
  ADD COLUMN IF NOT EXISTS directional_score numeric,
  ADD COLUMN IF NOT EXISTS directional_structure_score numeric,
  ADD COLUMN IF NOT EXISTS directional_market_score numeric,
  ADD COLUMN IF NOT EXISTS directional_agrees_with_trade boolean,
  ADD COLUMN IF NOT EXISTS structure_trend_external text,
  ADD COLUMN IF NOT EXISTS last_break_kind text,
  ADD COLUMN IF NOT EXISTS last_break_age_bars numeric,
  ADD COLUMN IF NOT EXISTS recent_sweep text,
  ADD COLUMN IF NOT EXISTS opening_day_type text,
  ADD COLUMN IF NOT EXISTS gap_vs_expected_move numeric,
  ADD COLUMN IF NOT EXISTS regained_prior_range boolean,
  ADD COLUMN IF NOT EXISTS nearest_prior_level_id text,
  ADD COLUMN IF NOT EXISTS nearest_prior_level_distance numeric,
  ADD COLUMN IF NOT EXISTS short_strike_beyond_prior_level boolean,
  ADD COLUMN IF NOT EXISTS daily_trend text,
  ADD COLUMN IF NOT EXISTS daily_flip_in_play boolean,
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
  ADD COLUMN IF NOT EXISTS call_release_reserve_dollars numeric,
  ADD COLUMN IF NOT EXISTS put_release_reserve_dollars numeric,
  ADD COLUMN IF NOT EXISTS reserve_dominant_side text,
  ADD COLUMN IF NOT EXISTS portfolio_repair_deficit_dollars numeric,
  ADD COLUMN IF NOT EXISTS candidate_offset_credit_dollars numeric,
  ADD COLUMN IF NOT EXISTS portfolio_decision_reason text,
  ADD COLUMN IF NOT EXISTS entry_leg_snapshots jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS current_leg_snapshots jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS entry_greeks jsonb,
  ADD COLUMN IF NOT EXISTS current_greeks jsonb,
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
  ADD COLUMN IF NOT EXISTS adaptive_projected_poc_spx numeric,
  ADD COLUMN IF NOT EXISTS adaptive_structure_state text,
  ADD COLUMN IF NOT EXISTS adaptive_active_legs jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS adaptive_net_cash_points numeric,
  ADD COLUMN IF NOT EXISTS adaptive_marked_pnl_dollars numeric,
  ADD COLUMN IF NOT EXISTS adaptive_released_short_strike numeric,
  ADD COLUMN IF NOT EXISTS adaptive_reinstated_short_strike numeric,
  ADD COLUMN IF NOT EXISTS adaptive_structure_history jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE zero_dte_shadow_trade_samples
  ADD COLUMN IF NOT EXISTS current_short_buyback_price numeric,
  ADD COLUMN IF NOT EXISTS current_short_leg_multiple numeric,
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
  ADD COLUMN IF NOT EXISTS adaptive_projected_poc_spx numeric,
  ADD COLUMN IF NOT EXISTS current_leg_snapshots jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS current_greeks jsonb,
  ADD COLUMN IF NOT EXISTS adaptive_structure_state text,
  ADD COLUMN IF NOT EXISTS adaptive_marked_pnl_dollars numeric;

CREATE INDEX IF NOT EXISTS idx_zero_dte_shadow_adaptive_open
  ON zero_dte_shadow_trades(user_id, trade_date, adaptive_state)
  WHERE adaptive_state = 'open';
CREATE INDEX IF NOT EXISTS idx_zero_dte_shadow_portfolio_decision
  ON zero_dte_shadow_trades(user_id, trade_date, portfolio_decision, signal_time);
CREATE INDEX IF NOT EXISTS idx_zero_dte_shadow_structure_state
  ON zero_dte_shadow_trades(user_id, trade_date, adaptive_structure_state)
  WHERE adaptive_state = 'open';

-- Repair legacy adaptive rows without touching realized results.
UPDATE zero_dte_shadow_trades
SET portfolio_decision = CASE
      WHEN portfolio_decision IS NULL AND (state = 'open' OR state = 'closed') THEN 'TAKE'
      ELSE portfolio_decision
    END,
    adaptive_structure_state = CASE
      WHEN adaptive_state IS NOT NULL AND adaptive_structure_state IS NULL AND strategy = 'iron-fly' THEN 'IF_CENTER'
      WHEN adaptive_state IS NOT NULL AND adaptive_structure_state IS NULL THEN 'CREDIT_SPREAD'
      ELSE adaptive_structure_state
    END,
    adaptive_active_legs = CASE
      WHEN adaptive_state = 'open' AND jsonb_array_length(adaptive_active_legs) = 0 THEN legs
      ELSE adaptive_active_legs
    END,
    adaptive_net_cash_points = CASE
      WHEN adaptive_state = 'open' AND adaptive_net_cash_points IS NULL THEN entry_sellable_credit
      ELSE adaptive_net_cash_points
    END;

COMMIT;
