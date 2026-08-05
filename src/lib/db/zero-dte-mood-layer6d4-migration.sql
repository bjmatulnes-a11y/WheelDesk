create table if not exists public.zero_dte_leadership_weight_snapshots (
  id uuid primary key default gen_random_uuid(),
  trade_date date not null unique,
  as_of_date date,
  source text not null,
  source_url text,
  fetched_at timestamptz not null default now(),
  cumulative_weight_pct numeric not null default 0,
  target_weight_pct numeric not null default 40,
  constituents jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists zero_dte_leadership_weight_snapshots_trade_date_idx
  on public.zero_dte_leadership_weight_snapshots (trade_date desc);

create table if not exists public.zero_dte_mood_samples (
  id uuid primary key default gen_random_uuid(),
  trade_date date not null,
  minute_key bigint not null,
  sampled_at timestamptz not null,
  calculation_mode text not null,
  raw_mood_percent numeric,
  mood_percent numeric,
  input_json jsonb not null default '{}'::jsonb,
  read_json jsonb not null default '{}'::jsonb,
  leadership_json jsonb not null default '{}'::jsonb,
  breadth_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trade_date, minute_key)
);

create index if not exists zero_dte_mood_samples_trade_date_minute_idx
  on public.zero_dte_mood_samples (trade_date, minute_key desc);

comment on table public.zero_dte_leadership_weight_snapshots is
  'Daily session-frozen SPY/S&P 500 leadership weights for the Layer 6D.4 SPX Mood engine.';

comment on table public.zero_dte_mood_samples is
  'Completed-minute calculated SPX Mood samples. Manual fallback/force values are applied at read time and are not persisted as calculated history.';
