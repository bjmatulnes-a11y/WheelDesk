-- WheelDesk 0DTE — ACTUAL Execution Adaptive Position Ledger V1
-- Adds a compact, event-driven management ledger to real Portfolio Dock positions.
-- Recommendations are persisted only when their state/action signature changes.
-- Confirmed broker leg actions mutate the CURRENT adaptive geometry while the
-- original entry legs remain immutable audit data.

BEGIN;

ALTER TABLE zero_dte_execution_positions
  ADD COLUMN IF NOT EXISTS adaptive_management_state text,
  ADD COLUMN IF NOT EXISTS adaptive_action text,
  ADD COLUMN IF NOT EXISTS adaptive_reason text,
  ADD COLUMN IF NOT EXISTS adaptive_structure_state text,
  ADD COLUMN IF NOT EXISTS adaptive_active_legs jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS adaptive_net_cash_points numeric,
  ADD COLUMN IF NOT EXISTS adaptive_released_short_strike numeric,
  ADD COLUMN IF NOT EXISTS adaptive_reinstated_short_strike numeric,
  ADD COLUMN IF NOT EXISTS adaptive_marked_pnl_dollars numeric,
  ADD COLUMN IF NOT EXISTS adaptive_max_adverse_excursion_dollars numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adaptive_max_favorable_excursion_dollars numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adaptive_last_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS adaptive_last_recommendation_key text,
  ADD COLUMN IF NOT EXISTS adaptive_last_recommended_transition jsonb,
  ADD COLUMN IF NOT EXISTS adaptive_management_history jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Backfill existing open positions so the manager can immediately begin from
-- their actual entry geometry. This does not invent historical repairs.
UPDATE zero_dte_execution_positions
SET adaptive_structure_state = CASE
      WHEN strategy IN ('iron-fly', 'iron_fly') THEN 'IF_CENTER'
      ELSE 'CREDIT_SPREAD'
    END,
    adaptive_active_legs = CASE
      WHEN jsonb_array_length(adaptive_active_legs) = 0 THEN legs
      ELSE adaptive_active_legs
    END,
    adaptive_net_cash_points = COALESCE(adaptive_net_cash_points, entry_credit),
    adaptive_management_history = CASE
      WHEN jsonb_array_length(adaptive_management_history) = 0 THEN
        jsonb_build_array(
          jsonb_build_object(
            'at', COALESCE(entry_time, created_at),
            'kind', 'OPEN',
            'state', CASE WHEN strategy IN ('iron-fly', 'iron_fly') THEN 'IF_CENTER' ELSE 'CREDIT_SPREAD' END,
            'action', 'OPEN',
            'strike', NULL,
            'price', entry_credit,
            'detail', 'Backfilled existing actual position into adaptive ledger.',
            'netCashPoints', entry_credit,
            'markedPnlDollars', 0
          )
        )
      ELSE adaptive_management_history
    END
WHERE state = 'open';

CREATE INDEX IF NOT EXISTS idx_zero_dte_execution_adaptive_open
  ON zero_dte_execution_positions(trade_day_id, adaptive_structure_state, entry_time)
  WHERE state = 'open';

COMMENT ON COLUMN zero_dte_execution_positions.adaptive_active_legs IS
  'Current confirmed actual-position leg geometry after partial adaptive actions. Original legs remain immutable.';
COMMENT ON COLUMN zero_dte_execution_positions.adaptive_net_cash_points IS
  'Cumulative per-contract cash points after confirmed release/re-short/runner actions.';
COMMENT ON COLUMN zero_dte_execution_positions.adaptive_management_history IS
  'Compact event ledger of OPEN, changed adaptive RECOMMENDATION, user-confirmed leg action, and EXIT events.';

COMMIT;
