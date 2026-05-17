"use client";

import { type ReactNode, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSupabaseAuthClient } from "../../lib/auth/supabase-auth-client";

type AuthGateProps = {
  children: ReactNode;
};

export default function AuthGate({ children }: AuthGateProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<"checking" | "signed-in" | "signed-out">("checking");

  useEffect(() => {
    let mounted = true;
    const supabase = getSupabaseAuthClient();

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;

      if (data.session) {
        setState("signed-in");
      } else {
        setState("signed-out");
        const next = encodeURIComponent(pathname || "/control-center");
        router.replace(`/login?next=${next}`);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;

      if (session) {
        setState("signed-in");
      } else {
        setState("signed-out");
        const next = encodeURIComponent(pathname || "/control-center");
        router.replace(`/login?next=${next}`);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [pathname, router]);

  if (state === "signed-in") {
    return <>{children}</>;
  }

  return (
    <main className="wd-auth-shell">
      <section className="wd-auth-card wd-auth-card-small">
        <div className="wd-auth-logo">W</div>
        <h1>Checking WheelDesk session…</h1>
        <p>Loading your secure trading console.</p>
      </section>
    </main>
  );
}
