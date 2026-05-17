-- WheelDesk Supabase schema
-- Run this in Supabase SQL editor before using Dashboard Harvest / Control Center / Validation.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS option_surface_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  surface_key TEXT NOT NULL,
  spot NUMERIC,
  selected_expiration DATE,
  selected_dte INTEGER,
  daily_structure JSONB,
  prevailing_levels JSONB,
  implied_path JSONB,
  summary JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT option_surface_snapshots_unique_surface UNIQUE (ticker, snapshot_date, surface_key)
);

CREATE INDEX IF NOT EXISTS idx_option_surface_snapshots_ticker_date
  ON option_surface_snapshots (ticker, snapshot_date DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS option_chain_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES option_surface_snapshots(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  expiration DATE,
  dte INTEGER,
  strike NUMERIC NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('call', 'put')),
  open_interest NUMERIC,
  volume NUMERIC,
  iv NUMERIC,
  delta NUMERIC,
  gamma NUMERIC,
  theta NUMERIC,
  vega NUMERIC,
  bid NUMERIC,
  ask NUMERIC,
  last NUMERIC,
  change NUMERIC,
  percent_change NUMERIC,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_option_chain_rows_snapshot_id
  ON option_chain_rows (snapshot_id, expiration, strike, side);

CREATE INDEX IF NOT EXISTS idx_option_chain_rows_ticker_date
  ON option_chain_rows (ticker, snapshot_date DESC, expiration, strike, side);

CREATE INDEX IF NOT EXISTS idx_option_chain_rows_expiration
  ON option_chain_rows (ticker, expiration, dte);

-- Auth/account foundation for WheelDesk subscriptions.
-- Run after enabling Supabase Auth. This keeps product/account data in public
-- while the canonical user identities remain in auth.users.
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  selected_plan TEXT NOT NULL DEFAULT 'founder',
  stripe_customer_id TEXT,
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE,
  stripe_price_id TEXT,
  plan TEXT NOT NULL DEFAULT 'founder',
  status TEXT NOT NULL DEFAULT 'trialing',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status
  ON subscriptions (user_id, status, current_period_end DESC);


-- Stripe billing hardening for existing databases created before WheelDesk-8.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;

CREATE INDEX IF NOT EXISTS idx_profiles_stripe_customer
  ON profiles (stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer
  ON subscriptions (stripe_customer_id);

CREATE TABLE IF NOT EXISTS billing_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  stripe_created_at TIMESTAMPTZ,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_events_type_created
  ON billing_events (type, created_at DESC);

ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_select_own'
  ) THEN
    CREATE POLICY profiles_select_own ON profiles
      FOR SELECT USING (auth.uid() = id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_update_own'
  ) THEN
    CREATE POLICY profiles_update_own ON profiles
      FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'subscriptions' AND policyname = 'subscriptions_select_own'
  ) THEN
    CREATE POLICY subscriptions_select_own ON subscriptions
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.handle_new_wheeldesk_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, selected_plan)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'selected_plan', 'founder')
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    selected_plan = COALESCE(EXCLUDED.selected_plan, public.profiles.selected_plan),
    updated_at = NOW();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_wheeldesk_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_wheeldesk_profile
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_wheeldesk_user();
