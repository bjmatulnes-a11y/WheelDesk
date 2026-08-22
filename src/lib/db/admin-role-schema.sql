-- WheelDesk application roles
--
-- Application authority is intentionally separate from billing plans.
-- A user can remain on a legacy/commercial plan while independently holding
-- the Admin role. Absence of a row means the normal "user" role.

CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Authenticated users may see only their own role. There are deliberately no
-- INSERT/UPDATE/DELETE policies: application users cannot promote themselves.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_roles'
      AND policyname = 'user_roles_select_own'
  ) THEN
    CREATE POLICY user_roles_select_own ON public.user_roles
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

GRANT SELECT ON public.user_roles TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM authenticated;
REVOKE ALL ON public.user_roles FROM anon;

-- Bootstrap an administrator from the Supabase SQL editor/service context.
-- Replace the email before running this statement:
--
-- INSERT INTO public.user_roles (user_id, role, updated_at)
-- SELECT id, 'admin', NOW()
-- FROM auth.users
-- WHERE LOWER(email) = LOWER('YOUR_ACCOUNT_EMAIL')
-- ON CONFLICT (user_id) DO UPDATE
-- SET role = EXCLUDED.role, updated_at = NOW();
