-- WheelDesk 26: NN-ready OI Field forecast capture migration
-- Run this after ticker-universe-forecast-schema.sql.
-- It upgrades public.oi_field_forecasts so captured forecasts can become a neural training set.

ALTER TABLE public.oi_field_forecasts
  ADD COLUMN IF NOT EXISTS engine_version TEXT DEFAULT 'oi-field-v2',
  ADD COLUMN IF NOT EXISTS model_status TEXT NOT NULL DEFAULT 'collecting',
  ADD COLUMN IF NOT EXISTS nn_model_version TEXT,
  ADD COLUMN IF NOT EXISTS baseline_forecast JSONB,
  ADD COLUMN IF NOT EXISTS feature_vector JSONB,
  ADD COLUMN IF NOT EXISTS nn_adjustment JSONB,
  ADD COLUMN IF NOT EXISTS final_forecast JSONB,
  ADD COLUMN IF NOT EXISTS training_eligible BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS outcome_status TEXT NOT NULL DEFAULT 'waiting';

UPDATE public.oi_field_forecasts
SET
  engine_version = COALESCE(engine_version, 'oi-field-v2'),
  model_status = COALESCE(model_status, 'collecting'),
  baseline_forecast = COALESCE(baseline_forecast, forecast),
  feature_vector = COALESCE(feature_vector, inputs),
  final_forecast = COALESCE(final_forecast, forecast),
  training_eligible = COALESCE(training_eligible, TRUE),
  outcome_status = COALESCE(outcome_status, 'waiting');

CREATE INDEX IF NOT EXISTS idx_oi_field_forecasts_model_status
  ON public.oi_field_forecasts (model_status, outcome_status, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_oi_field_forecasts_training
  ON public.oi_field_forecasts (training_eligible, outcome_status, symbol);

CREATE OR REPLACE VIEW public.oi_field_nn_training_candidates AS
SELECT
  id,
  symbol,
  snapshot_date,
  expiration,
  dte,
  generated_at,
  spot,
  bias,
  confidence,
  engine_version,
  model_status,
  nn_model_version,
  training_eligible,
  outcome_status,
  baseline_forecast,
  feature_vector,
  nn_adjustment,
  final_forecast,
  forecast,
  inputs
FROM public.oi_field_forecasts
WHERE training_eligible = TRUE;

GRANT SELECT ON public.oi_field_nn_training_candidates TO authenticated;

NOTIFY pgrst, 'reload schema';
