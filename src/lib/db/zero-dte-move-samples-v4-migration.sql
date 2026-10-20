-- WheelDesk 0DTE empirical move-table v4.
-- One row per trade date / entry-time bucket. Source precedence is enforced
-- inside Postgres so lower-fidelity backfills cannot overwrite newer 1m rows.

CREATE TABLE IF NOT EXISTS zero_dte_move_samples (
  trade_date date NOT NULL,
  time_bucket text NOT NULL,
  day_type text NOT NULL,
  gap_class text NOT NULL,
  vix_bucket text NOT NULL,
  prior_vix_close double precision,
  morning_trend text NOT NULL,
  up_max_pct double precision NOT NULL,
  down_max_pct double precision NOT NULL,
  close_move_pct double precision NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trade_date, time_bucket),
  CONSTRAINT zero_dte_move_samples_time_check CHECK (time_bucket ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  CONSTRAINT zero_dte_move_samples_day_type_check CHECK (day_type IN ('INSIDE_RANGE','OUTSIDE_UP','OUTSIDE_DOWN')),
  CONSTRAINT zero_dte_move_samples_gap_class_check CHECK (gap_class IN ('FLAT','MODERATE','LARGE')),
  CONSTRAINT zero_dte_move_samples_vix_bucket_check CHECK (vix_bucket IN ('<15','15-20','20-25','>25')),
  CONSTRAINT zero_dte_move_samples_morning_check CHECK (morning_trend IN ('DOWN_GT_0_5','FLAT','UP_GT_0_5')),
  CONSTRAINT zero_dte_move_samples_source_check CHECK (source IN ('SCHWAB_1M','SCHWAB_30M'))
);

CREATE INDEX IF NOT EXISTS idx_zero_dte_move_samples_trade_date
  ON zero_dte_move_samples(trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_zero_dte_move_samples_context
  ON zero_dte_move_samples(vix_bucket, time_bucket, day_type, gap_class);

CREATE OR REPLACE FUNCTION upsert_zero_dte_move_samples(payload jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer := 0;
BEGIN
  WITH incoming AS (
    SELECT *
    FROM jsonb_to_recordset(COALESCE(payload, '[]'::jsonb)) AS x(
      trade_date date,
      time_bucket text,
      day_type text,
      gap_class text,
      vix_bucket text,
      prior_vix_close double precision,
      morning_trend text,
      up_max_pct double precision,
      down_max_pct double precision,
      close_move_pct double precision,
      source text
    )
  ), changed AS (
    INSERT INTO zero_dte_move_samples (
      trade_date,time_bucket,day_type,gap_class,vix_bucket,prior_vix_close,
      morning_trend,up_max_pct,down_max_pct,close_move_pct,source,updated_at
    )
    SELECT
      trade_date,time_bucket,day_type,gap_class,vix_bucket,prior_vix_close,
      morning_trend,up_max_pct,down_max_pct,close_move_pct,source,now()
    FROM incoming
    WHERE source IN ('SCHWAB_1M','SCHWAB_30M')
    ON CONFLICT (trade_date,time_bucket) DO UPDATE SET
      day_type = EXCLUDED.day_type,
      gap_class = EXCLUDED.gap_class,
      vix_bucket = EXCLUDED.vix_bucket,
      prior_vix_close = EXCLUDED.prior_vix_close,
      morning_trend = EXCLUDED.morning_trend,
      up_max_pct = EXCLUDED.up_max_pct,
      down_max_pct = EXCLUDED.down_max_pct,
      close_move_pct = EXCLUDED.close_move_pct,
      source = EXCLUDED.source,
      updated_at = now()
    WHERE
      CASE EXCLUDED.source WHEN 'SCHWAB_1M' THEN 2 WHEN 'SCHWAB_30M' THEN 1 ELSE 0 END
      >=
      CASE zero_dte_move_samples.source WHEN 'SCHWAB_1M' THEN 2 WHEN 'SCHWAB_30M' THEN 1 ELSE 0 END
    RETURNING 1
  )
  SELECT count(*) INTO affected FROM changed;

  RETURN affected;
END;
$$;

CREATE TABLE IF NOT EXISTS zero_dte_daily_moves (
  trade_date date PRIMARY KEY,
  prior_vix_close double precision NOT NULL,
  vix_bucket text NOT NULL,
  up_max_pct double precision NOT NULL,
  down_max_pct double precision NOT NULL,
  close_move_pct double precision NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zero_dte_daily_moves_vix_bucket_check CHECK (vix_bucket IN ('<15','15-20','20-25','>25'))
);

CREATE TABLE IF NOT EXISTS zero_dte_move_capture_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  captured_at timestamptz NOT NULL DEFAULT now(),
  trade_date date,
  status text NOT NULL,
  rows_written integer NOT NULL DEFAULT 0,
  detail text,
  CONSTRAINT zero_dte_move_capture_status_check CHECK (status IN ('ok','auth_failed','error'))
);
CREATE INDEX IF NOT EXISTS idx_zero_dte_move_capture_log_at
  ON zero_dte_move_capture_log(captured_at DESC);

CREATE TABLE IF NOT EXISTS zero_dte_move_table_state (
  id text PRIMARY KEY,
  table_json jsonb NOT NULL,
  generated_at timestamptz,
  session_count integer NOT NULL DEFAULT 0,
  bucket_count integer NOT NULL DEFAULT 0,
  observation_count integer NOT NULL DEFAULT 0,
  last_capture_date date,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE zero_dte_move_table_state ADD COLUMN IF NOT EXISTS last_capture_date date;

ALTER TABLE zero_dte_move_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE zero_dte_daily_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE zero_dte_move_capture_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE zero_dte_move_table_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON zero_dte_move_samples FROM anon, authenticated;
REVOKE ALL ON zero_dte_daily_moves FROM anon, authenticated;
REVOKE ALL ON zero_dte_move_capture_log FROM anon, authenticated;
REVOKE ALL ON zero_dte_move_table_state FROM anon, authenticated;
REVOKE ALL ON FUNCTION upsert_zero_dte_move_samples(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_zero_dte_move_samples(jsonb) TO service_role;
