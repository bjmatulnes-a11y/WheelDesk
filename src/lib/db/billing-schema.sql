-- WheelDesk billing/account schema patch
-- Run in Supabase SQL Editor after Supabase Auth is enabled.
-- This does not replace the main app schema; it only ensures billing/account tables exist.

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  selected_plan TEXT NOT NULL DEFAULT 'founder',
  stripe_customer_id TEXT,
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.subscriptions (
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

CREATE TABLE IF NOT EXISTS public.billing_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  stripe_created_at TIMESTAMPTZ,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS selected_plan TEXT NOT NULL DEFAULT 'founder';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_profiles_stripe_customer
  ON public.profiles (stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status
  ON public.subscriptions (user_id, status, current_period_end DESC);

CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer
  ON public.subscriptions (stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_billing_events_type_created
  ON public.billing_events (type, created_at DESC);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_select_own'
  ) THEN
    CREATE POLICY profiles_select_own ON public.profiles
      FOR SELECT USING (auth.uid() = id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_update_own'
  ) THEN
    CREATE POLICY profiles_update_own ON public.profiles
      FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'subscriptions' AND policyname = 'subscriptions_select_own'
  ) THEN
    CREATE POLICY subscriptions_select_own ON public.subscriptions
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
