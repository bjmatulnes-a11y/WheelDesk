"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseAuthClient } from "../../../lib/auth/supabase-auth-client";

function cleanNext(value: string | null): string {
  if (!value || !value.startsWith("/")) return "/control-center";
  if (value.startsWith("//")) return "/control-center";
  return value;
}

function AuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = useMemo(() => cleanNext(searchParams.get("next")), [searchParams]);
  const [status, setStatus] = useState("Completing login…");

  useEffect(() => {
    let cancelled = false;

    async function completeAuth() {
      const supabase = getSupabaseAuthClient();
      const code = searchParams.get("code");

      try {
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        }

        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        if (!data.session) {
          throw new Error("No active WheelDesk session was created. Try logging in again.");
        }

        if (!cancelled) {
          router.replace(next);
        }
      } catch (error) {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : "Could not complete login.");
        }
      }
    }

    void completeAuth();

    return () => {
      cancelled = true;
    };
  }, [next, router, searchParams]);

  return (
    <main className="wd-auth-shell">
      <section className="wd-auth-card wd-auth-card-small">
        <div className="wd-auth-logo">W</div>
        <h1>WheelDesk Auth</h1>
        <p>{status}</p>
      </section>
    </main>
  );
}


export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <main className="wd-auth-shell">
        <section className="wd-auth-card wd-auth-card-small">
          <div className="wd-auth-logo">W</div>
          <h1>WheelDesk Auth</h1>
          <p>Loading auth callback…</p>
        </section>
      </main>
    }>
      <AuthCallbackInner />
    </Suspense>
  );
}
