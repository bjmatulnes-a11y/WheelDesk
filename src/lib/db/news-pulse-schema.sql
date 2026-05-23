-- WheelDesk News Pulse foundation
-- Run in Supabase SQL Editor. All tables live in public schema.

create table if not exists public.news_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  headline text not null,
  summary text,
  source_name text,
  url text,
  image_url text,
  published_at timestamptz not null,
  sentiment_score numeric,
  materiality_score numeric,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create table if not exists public.news_ticker_links (
  id uuid primary key default gen_random_uuid(),
  news_event_id uuid not null references public.news_events(id) on delete cascade,
  symbol text not null,
  relevance_score numeric not null default 1,
  created_at timestamptz not null default now(),
  unique (news_event_id, symbol)
);

create table if not exists public.news_harvest_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  symbols text[] not null default array[]::text[],
  status text not null default 'running',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  total_requested integer not null default 0,
  total_inserted integer not null default 0,
  total_failed integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.news_events enable row level security;
alter table public.news_ticker_links enable row level security;
alter table public.news_harvest_runs enable row level security;

-- Read access is safe for authenticated users. Writes should happen through server routes/service role.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'news_events' and policyname = 'Authenticated users can read news events'
  ) then
    create policy "Authenticated users can read news events"
    on public.news_events
    for select
    to authenticated
    using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'news_ticker_links' and policyname = 'Authenticated users can read news ticker links'
  ) then
    create policy "Authenticated users can read news ticker links"
    on public.news_ticker_links
    for select
    to authenticated
    using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'news_harvest_runs' and policyname = 'Authenticated users can read news harvest runs'
  ) then
    create policy "Authenticated users can read news harvest runs"
    on public.news_harvest_runs
    for select
    to authenticated
    using (true);
  end if;
end $$;

create index if not exists idx_news_events_published_at on public.news_events (published_at desc);
create index if not exists idx_news_events_provider_event on public.news_events (provider, provider_event_id);
create index if not exists idx_news_links_symbol on public.news_ticker_links (symbol);
create index if not exists idx_news_links_event on public.news_ticker_links (news_event_id);
create index if not exists idx_news_runs_started_at on public.news_harvest_runs (started_at desc);

-- Helpful freshness reload after schema changes.
notify pgrst, 'reload schema';
