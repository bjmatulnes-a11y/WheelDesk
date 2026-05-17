"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import AuthGate from "../../components/auth/AuthGate";
import ManageBillingButton from "../../components/billing/ManageBillingButton";
import { getSupabaseAuthClient } from "../../lib/auth/supabase-auth-client";
import { friendlyBillingStatus } from "../../lib/billing/subscription-access";
import { planLabel } from "../../lib/billing/plans";

type ProfileRow = {
  selected_plan?: string | null;
  stripe_customer_id?: string | null;
};

type SubscriptionRow = {
  plan?: string | null;
  status?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean | null;
};

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

export default function AccountPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null);
  const [status, setStatus] = useState("Loading account…");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseAuthClient();
    let mounted = true;

    async function loadAccount() {
      const { data, error } = await supabase.auth.getUser();
      if (!mounted) return;

      if (error) {
        setStatus(error.message);
        return;
      }

      const activeUser = data.user ?? null;
      setUser(activeUser);

      if (!activeUser) {
        setStatus("No active user");
        return;
      }

      const [{ data: profileData }, { data: subscriptionData }] = await Promise.all([
        supabase
          .from("profiles")
          .select("selected_plan, stripe_customer_id")
          .eq("id", activeUser.id)
          .maybeSingle(),
        supabase
          .from("subscriptions")
          .select("plan, status, current_period_end, cancel_at_period_end")
          .eq("user_id", activeUser.id)
          .order("current_period_end", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (!mounted) return;

      setProfile(profileData as ProfileRow | null);
      setSubscription(subscriptionData as SubscriptionRow | null);

      if (searchParams.get("checkout") === "success") {
        setStatus("Checkout complete. Stripe webhook sync may take a moment; refresh if the plan still looks pending.");
      } else {
        setStatus("Active session");
      }
    }

    loadAccount();

    return () => {
      mounted = false;
    };
  }, [searchParams]);

  async function signOut() {
    setBusy(true);
    const supabase = getSupabaseAuthClient();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const displayedPlan = subscription?.plan ?? profile?.selected_plan ?? String(user?.user_metadata?.selected_plan ?? "founder");
  const hasStripeCustomer = Boolean(profile?.stripe_customer_id);

  return (
    <AuthGate>
      <main className="wd-account-shell">
        <section className="wd-account-card">
          <Link href="/control-center" className="wd-account-back">← Back to Control Center</Link>
          <div className="wd-auth-logo">W</div>
          <p className="wd-eyebrow">WheelDesk Account</p>
          <h1>Account, billing & access</h1>
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
              <span>Plan</span>
              <strong>{planLabel(displayedPlan)}</strong>
            </div>
            <div>
              <span>Billing Status</span>
              <strong>{friendlyBillingStatus(subscription?.status)}</strong>
            </div>
            <div>
              <span>Renews / Ends</span>
              <strong>{formatDate(subscription?.current_period_end)}</strong>
            </div>
            <div>
              <span>Cancellation</span>
              <strong>{subscription?.cancel_at_period_end ? "Cancels at period end" : "No cancellation scheduled"}</strong>
            </div>
          </div>

          <div className="wd-billing-note">
            <strong>Billing control</strong>
            <span>
              Start a plan from Pricing. After checkout, Stripe webhooks update this page and the Supabase
              subscription record used for tier-based access.
            </span>
          </div>

          <div className="wd-account-actions">
            <Link href="/pricing" className="wd-auth-secondary">View pricing</Link>
            <ManageBillingButton disabled={!hasStripeCustomer} />
            <button type="button" onClick={signOut} disabled={busy} className="wd-auth-primary">
              {busy ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </section>
      </main>
    </AuthGate>
  );
}
