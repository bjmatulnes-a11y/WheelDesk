-- WheelDesk Shadow Lab exit-policy hardening
-- Adds executable short-leg tracking for the deterministic 3x short-premium stop.

BEGIN;

ALTER TABLE zero_dte_shadow_trades
  ADD COLUMN IF NOT EXISTS entry_short_legs jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS current_short_buyback_price numeric,
  ADD COLUMN IF NOT EXISTS current_short_leg_multiple numeric;

ALTER TABLE zero_dte_shadow_trade_samples
  ADD COLUMN IF NOT EXISTS current_short_buyback_price numeric,
  ADD COLUMN IF NOT EXISTS current_short_leg_multiple numeric;

COMMIT;
