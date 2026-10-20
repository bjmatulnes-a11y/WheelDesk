-- Separate legacy Execution Paint shadow trades from Credit Spread Edge PLAN trades.
ALTER TABLE zero_dte_shadow_trades
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'EXECUTION';

UPDATE zero_dte_shadow_trades
SET source = 'EXECUTION'
WHERE source IS NULL OR source NOT IN ('EXECUTION','PLAN');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'zero_dte_shadow_trades_source_check'
  ) THEN
    ALTER TABLE zero_dte_shadow_trades
      ADD CONSTRAINT zero_dte_shadow_trades_source_check
      CHECK (source IN ('EXECUTION','PLAN'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_zero_dte_shadow_trades_plan_lookup
  ON zero_dte_shadow_trades(user_id, source, trade_date, strategy, setup_key, signal_time DESC);
