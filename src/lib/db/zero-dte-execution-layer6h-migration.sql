-- WheelDesk Layer 6H: execution-integrity and calibration instrumentation.
-- Run once in the Supabase SQL editor before deploying the Layer 6H TypeScript patch.

BEGIN;

-- Preserve whether a recorded trade came from the engine-selected setup or
-- manual legs, and whether the engine had actually reached SELL_READY.
ALTER TABLE zero_dte_execution_positions
  ADD COLUMN IF NOT EXISTS setup_source TEXT NOT NULL DEFAULT 'engine',
  ADD COLUMN IF NOT EXISTS engine_cleared_at_entry BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS override_reason TEXT,
  ADD COLUMN IF NOT EXISTS signal_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS signal_credit NUMERIC,
  ADD COLUMN IF NOT EXISTS entry_mark_credit NUMERIC,
  ADD COLUMN IF NOT EXISTS entry_sellable_credit NUMERIC,
  ADD COLUMN IF NOT EXISTS entry_short_delta_abs NUMERIC,
  ADD COLUMN IF NOT EXISTS entry_touch_risk_proxy_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS entry_range_consumption_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS entry_event_risk TEXT;

-- Add clean calibration inputs to the 30-second execution history. These are
-- diagnostics/context only; they do not alter the existing entry-score model.
ALTER TABLE zero_dte_execution_score_history
  ADD COLUMN IF NOT EXISTS sellable_credit NUMERIC,
  ADD COLUMN IF NOT EXISTS buyback_debit NUMERIC,
  ADD COLUMN IF NOT EXISTS short_delta_abs NUMERIC,
  ADD COLUMN IF NOT EXISTS touch_risk_proxy_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS range_consumption_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS minimum_entry_score NUMERIC,
  ADD COLUMN IF NOT EXISTS event_risk TEXT;

COMMIT;

-- Verification
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'zero_dte_execution_positions'
  AND column_name IN (
    'setup_source',
    'engine_cleared_at_entry',
    'override_reason',
    'signal_time',
    'signal_credit',
    'entry_mark_credit',
    'entry_sellable_credit',
    'entry_short_delta_abs',
    'entry_touch_risk_proxy_pct',
    'entry_range_consumption_pct',
    'entry_event_risk'
  )
ORDER BY column_name;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'zero_dte_execution_score_history'
  AND column_name IN (
    'sellable_credit',
    'buyback_debit',
    'short_delta_abs',
    'touch_risk_proxy_pct',
    'range_consumption_pct',
    'minimum_entry_score',
    'event_risk'
  )
ORDER BY column_name;
