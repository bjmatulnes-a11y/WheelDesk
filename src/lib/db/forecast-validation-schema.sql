-- WheelDesk forecast receipt schema for OI Field Engine v2.
-- Run later when you are ready to persist daily forecast receipts for validation/backtesting.

create table if not exists public.oi_forecast_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  ticker text not null,
  snapshot_date date not null,
  surface_key text,
  expiration date,
  expiration_dte integer,
  engine_version text not null default 'oi-field-v2',
  current_price numeric,
  base_bias text,
  regime text,
  confidence_score numeric,
  short_term_score numeric,
  swing_score numeric,
  wheel_score numeric,
  forecast_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ticker, snapshot_date, expiration, engine_version)
);

create table if not exists public.oi_forecast_outcomes (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.oi_forecast_receipts(id) on delete cascade,
  horizon_key text not null,
  horizon_sessions integer not null,
  outcome_date date,
  close_price numeric,
  high_price numeric,
  low_price numeric,
  touched_upper_wall boolean,
  broke_lower_wall boolean,
  pinned_near_magnet boolean,
  remained_above_support boolean,
  realized_drift_pct numeric,
  outcome_json jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (receipt_id, horizon_key)
);

alter table public.oi_forecast_receipts enable row level security;
alter table public.oi_forecast_outcomes enable row level security;

drop policy if exists "Users can read own forecast receipts" on public.oi_forecast_receipts;

create policy "Users can read own forecast receipts"
on public.oi_forecast_receipts
for select
to authenticated
using (user_id is null or user_id = auth.uid());

drop policy if exists "Users can read own forecast outcomes" on public.oi_forecast_outcomes;

create policy "Users can read own forecast outcomes"
on public.oi_forecast_outcomes
for select
to authenticated
using (
  exists (
    select 1
    from public.oi_forecast_receipts r
    where r.id = oi_forecast_outcomes.receipt_id
      and (r.user_id is null or r.user_id = auth.uid())
  )
);

create index if not exists idx_oi_forecast_receipts_ticker_date
on public.oi_forecast_receipts (ticker, snapshot_date desc);

create index if not exists idx_oi_forecast_outcomes_receipt
on public.oi_forecast_outcomes (receipt_id, horizon_sessions);
