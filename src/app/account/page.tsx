"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import AuthGate from "../../components/auth/AuthGate";
import { getSupabaseAuthClient } from "../../lib/auth/supabase-auth-client";

export default function AccountPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState("Loading account…");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseAuthClient();
    let mounted = true;

    supabase.auth.getUser().then(({ data, error }) => {
      if (!mounted) return;
      if (error) {
        setStatus(error.message);
        return;
      }
      setUser(data.user ?? null);
      setStatus(data.user ? "Active session" : "No active user");
    });

    return () => {
      mounted = false;
    };
  }, []);

  async function signOut() {
    setBusy(true);
    const supabase = getSupabaseAuthClient();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <AuthGate>
      <main className="wd-account-shell">
        <section className="wd-account-card">
          <Link href="/control-center" className="wd-account-back">← Back to Control Center</Link>
          <div className="wd-auth-logo">W</div>
          <p className="wd-eyebrow">WheelDesk Account</p>
          <h1>Account & access</h1>
          <p className="wd-account-muted">{status}</p>

          <div className="wd-account-grid">
            <div>
              <span>Email</span>
              <strong>{user?.email ?? "—"}</strong>
            </div>
            <div>
              <span>User ID</span>
              <strong>{user?.id ? `${user.id.slice(0, 8)}…` : "—"}</strong>
            </div>
            <div>
              <span>Selected Plan</span>
              <strong>{String(user?.user_metadata?.selected_plan ?? "founder")}</strong>
            </div>
            <div>
              <span>Billing</span>
              <strong>Stripe next</strong>
            </div>
          </div>

          <div className="wd-account-actions">
            <Link href="/pricing" className="wd-auth-secondary">View pricing</Link>
            <button type="button" onClick={signOut} disabled={busy} className="wd-auth-primary">
              {busy ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </section>
      </main>
    </AuthGate>
  );
}
