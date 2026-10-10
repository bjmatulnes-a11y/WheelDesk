-- WheelDesk 0DTE directional-decision context for shadow validation.
-- Nullable by design so existing shadow rows remain valid.

BEGIN;

ALTER TABLE zero_dte_shadow_trades
  ADD COLUMN IF NOT EXISTS directional_side text,
  ADD COLUMN IF NOT EXISTS directional_score numeric,
  ADD COLUMN IF NOT EXISTS directional_structure_score numeric,
  ADD COLUMN IF NOT EXISTS directional_market_score numeric,
  ADD COLUMN IF NOT EXISTS directional_agrees_with_trade boolean,
  ADD COLUMN IF NOT EXISTS structure_trend_external text,
  ADD COLUMN IF NOT EXISTS last_break_kind text,
  ADD COLUMN IF NOT EXISTS last_break_age_bars numeric,
  ADD COLUMN IF NOT EXISTS recent_sweep text;

CREATE OR REPLACE VIEW zero_dte_shadow_trade_outcomes AS
SELECT
  t.id,
  t.user_id,
  t.trade_date,
  t.strategy,
  t.setup_key,
  t.signal_time,
  t.entry_score,
  t.minimum_entry_score,
  t.time_regime,
  t.short_delta_abs,
  t.short_distance_points,
  t.entry_mark_credit,
  t.entry_sellable_credit,
  t.signal_peak_credit,
  t.premium_expansion_pct,
  t.premium_rollover_pct,
  t.premium_crest_status,
  t.price_rejection_score,
  t.remaining_move_points,
  t.entry_range_consumption_pct,
  t.path_direction,
  t.path_confidence,
  t.path_flow_source,
  t.max_adverse_excursion_dollars,
  t.max_favorable_excursion_dollars,
  t.hit_short_strike,
  t.hit_one_point_five_x,
  t.hit_two_x,
  t.ran_to_max_loss,
  s5.pnl_conservative_dollars AS pnl_5m_dollars,
  s15.pnl_conservative_dollars AS pnl_15m_dollars,
  s30.pnl_conservative_dollars AS pnl_30m_dollars,
  t.pnl_conservative_dollars AS pnl_exit_dollars,
  CASE
    WHEN GREATEST(COALESCE(t.signal_peak_credit, 0), COALESCE(t.max_mark_credit, 0)) > 0
    THEN t.entry_mark_credit / GREATEST(COALESCE(t.signal_peak_credit, 0), COALESCE(t.max_mark_credit, 0)) * 100
    ELSE NULL
  END AS peak_capture_efficiency_pct,
  t.exit_reason,
  t.exit_time,
  t.directional_side,
  t.directional_score,
  t.directional_structure_score,
  t.directional_market_score,
  t.directional_agrees_with_trade,
  t.structure_trend_external,
  t.last_break_kind,
  t.last_break_age_bars,
  t.recent_sweep
FROM zero_dte_shadow_trades t
LEFT JOIN LATERAL (
  SELECT s.pnl_conservative_dollars
  FROM zero_dte_shadow_trade_samples s
  WHERE s.shadow_trade_id = t.id
    AND s.sampled_at >= t.signal_time + interval '5 minutes'
  ORDER BY s.sampled_at
  LIMIT 1
) s5 ON TRUE
LEFT JOIN LATERAL (
  SELECT s.pnl_conservative_dollars
  FROM zero_dte_shadow_trade_samples s
  WHERE s.shadow_trade_id = t.id
    AND s.sampled_at >= t.signal_time + interval '15 minutes'
  ORDER BY s.sampled_at
  LIMIT 1
) s15 ON TRUE
LEFT JOIN LATERAL (
  SELECT s.pnl_conservative_dollars
  FROM zero_dte_shadow_trade_samples s
  WHERE s.shadow_trade_id = t.id
    AND s.sampled_at >= t.signal_time + interval '30 minutes'
  ORDER BY s.sampled_at
  LIMIT 1
) s30 ON TRUE;

COMMIT;
