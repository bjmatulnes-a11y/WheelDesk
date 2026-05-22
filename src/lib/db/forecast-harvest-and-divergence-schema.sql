-- WheelDesk 27: Forecast harvest + divergence-ready captures
-- Run after ticker-universe-forecast-schema.sql and nn-ready-forecast-capture-schema.sql.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.oi_field_forecasts
  ADD COLUMN IF NOT EXISTS capture_session TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS capture_kind TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS capture_run_id UUID,
  ADD COLUMN IF NOT EXISTS forecast_anchor_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS divergence_summary JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.forecast_capture_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  capture_session TEXT NOT NULL DEFAULT 'manual', -- premarket, midday, close, manual
  run_status TEXT NOT NULL DEFAULT 'running', -- running, complete, partial, failed
  requested_count INTEGER NOT NULL DEFAULT 0,
  captured_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  notes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.forecast_capture_run_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES public.forecast_capture_runs(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- captured, missing_forecast, failed
  forecast_id UUID REFERENCES public.oi_field_forecasts(id) ON DELETE SET NULL,
  message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_forecast_capture_runs_created
  ON public.forecast_capture_runs (created_at DESC, capture_session, run_status);

CREATE INDEX IF NOT EXISTS idx_forecast_capture_run_items_run
  ON public.forecast_capture_run_items (run_id, symbol, status);

CREATE INDEX IF NOT EXISTS idx_oi_field_forecasts_capture_session
  ON public.oi_field_forecasts (capture_session, source, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_oi_field_forecasts_capture_run
  ON public.oi_field_forecasts (capture_run_id)
  WHERE capture_run_id IS NOT NULL;

ALTER TABLE public.forecast_capture_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forecast_capture_run_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own forecast capture runs" ON public.forecast_capture_runs;
CREATE POLICY "Users can read own forecast capture runs"
ON public.forecast_capture_runs
FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can insert own forecast capture runs" ON public.forecast_capture_runs;
CREATE POLICY "Users can insert own forecast capture runs"
ON public.forecast_capture_runs
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can update own forecast capture runs" ON public.forecast_capture_runs;
CREATE POLICY "Users can update own forecast capture runs"
ON public.forecast_capture_runs
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id OR user_id IS NULL)
WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can read forecast capture run items" ON public.forecast_capture_run_items;
CREATE POLICY "Users can read forecast capture run items"
ON public.forecast_capture_run_items
FOR SELECT
TO authenticated
USING (TRUE);

DROP POLICY IF EXISTS "Users can insert forecast capture run items" ON public.forecast_capture_run_items;
CREATE POLICY "Users can insert forecast capture run items"
ON public.forecast_capture_run_items
FOR INSERT
TO authenticated
WITH CHECK (TRUE);

NOTIFY pgrst, 'reload schema';
