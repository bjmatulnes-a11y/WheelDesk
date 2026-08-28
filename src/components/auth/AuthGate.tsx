"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSupabaseAuthClient } from "../../lib/auth/supabase-auth-client";
import { runAutomaticSurfaceCapture } from "../../lib/automatic-surface-capture";
import { hasPlanAccess } from "../../lib/billing/subscription-access";
import type { WheelDeskPlanId } from "../../lib/billing/plans";
import { isWheelDeskAdmin } from "../../lib/auth/application-role";

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);
const ACCESS_ALLOWED_PATHS = new Set(["/account"]);

type AuthGateProps = {
  children: ReactNode;
  requiredPlan?: WheelDeskPlanId;
};

type GateState = "checking" | "signed-in" | "signed-out" | "billing-required" | "plan-required";

function safeNext(pathname: string | null): string {
  const next = pathname || "/control-center";
  if (!next.startsWith("/") || next.startsWith("//")) return "/control-center";
  return next;
}

function routeCanBypassBilling(pathname: string | null): boolean {
  if (!pathname) return false;
  return ACCESS_ALLOWED_PATHS.has(pathname);
}

export default function AuthGate({ children, requiredPlan = "core" }: AuthGateProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<GateState>("checking");
  const [message, setMessage] = useState("Checking WheelDesk session…");
  const verifiedUserIdRef = useRef<string | null>(null);

  const next = useMemo(() => safeNext(pathname), [pathname]);

  useEffect(() => {
    let mounted = true;
    const supabase = getSupabaseAuthClient();

    async function verifyAccess(showChecking = true) {
      if (showChecking) {
        setState("checking");
        setMessage("Checking WheelDesk session…");
      }

      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;

      if (error || !data.session) {
        verifiedUserIdRef.current = null;
        setState("signed-out");
        router.replace(`/login?next=${encodeURIComponent(next)}`);
        return;
      }

      // Account remains available to every signed-in user so billing/access can
      // always be inspected even when the subscription itself is inactive.
      if (routeCanBypassBilling(pathname)) {
        verifiedUserIdRef.current = data.session.user.id;
        setState("signed-in");
        return;
      }

      // Application access is always entitlement-controlled. Checkout/billing
      // availability is a separate concern and must never disable plan gates.
      // Admin authority is checked before subscription status.
      setMessage("Checking WheelDesk access…");

      const { data: roleRow } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", data.session.user.id)
        .maybeSingle();

      if (!mounted) return;

      if (isWheelDeskAdmin(roleRow?.role)) {
        verifiedUserIdRef.current = data.session.user.id;
        setState("signed-in");
        return;
      }

      setMessage("Checking WheelDesk subscription…");

      const { data: subscriptions, error: subscriptionError } = await supabase
        .from("subscriptions")
        .select("plan,status,current_period_end")
        .eq("user_id", data.session.user.id)
        .in("status", Array.from(ACTIVE_SUBSCRIPTION_STATUSES))
        .order("current_period_end", { ascending: false, nullsFirst: false })
        .limit(1);

      if (!mounted) return;

      if (subscriptionError) {
        console.warn("WheelDesk subscription access check failed", subscriptionError);
        setMessage("Could not verify billing access. Sending you to pricing.");
        setState("billing-required");
        router.replace(`/pricing?access=required&next=${encodeURIComponent(next)}`);
        return;
      }

      const subscription = subscriptions?.[0] ?? null;
      if (subscription) {
        if (hasPlanAccess(subscription.plan, subscription.status, requiredPlan)) {
          verifiedUserIdRef.current = data.session.user.id;
          setState("signed-in");
          return;
        }

        setMessage(
          requiredPlan === "research"
            ? "WheelDesk Command is required for this area."
            : "Your current plan does not include this area.",
        );
        setState("plan-required");
        router.replace(`/pricing?upgrade=${requiredPlan}&next=${encodeURIComponent(next)}`);
        return;
      }

      setState("billing-required");
      router.replace(`/pricing?access=required&next=${encodeURIComponent(next)}`);
    }

    void verifyAccess();

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;

      if (event === "SIGNED_OUT" || !session) {
        verifiedUserIdRef.current = null;
        setState("signed-out");
        router.replace(`/login?next=${encodeURIComponent(next)}`);
        return;
      }

      // Supabase can emit INITIAL_SESSION, TOKEN_REFRESHED, and even a
      // redundant SIGNED_IN while an already-authenticated browser tab is
      // restored/refocused. Re-running verifyAccess() for those events used to
      // set the gate back to `checking`, which unmounted the entire WheelDesk
      // page and made a simple tab switch look like a full reload.
      if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;

      if (event === "SIGNED_IN") {
        if (verifiedUserIdRef.current === session.user.id) return;

        // Defer any genuinely new sign-in verification until after the auth
        // callback returns. Keep the current page mounted while we verify.
        window.setTimeout(() => {
          if (mounted) void verifyAccess(false);
        }, 0);
        return;
      }

      if (event === "USER_UPDATED") {
        window.setTimeout(() => {
          if (mounted) void verifyAccess(false);
        }, 0);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [pathname, router, next, requiredPlan]);

  useEffect(() => {
    if (state !== "signed-in" || routeCanBypassBilling(pathname)) return;

    let cancelled = false;
    const supabase = getSupabaseAuthClient();

    const keepSurfacesCurrent = async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled || !data.session) return;

      void runAutomaticSurfaceCapture({
        accessToken: data.session.access_token,
        userId: data.session.user.id,
      });
    };

    void keepSurfacesCurrent();
    const interval = window.setInterval(keepSurfacesCurrent, 30 * 60_000);

    // Surface capture is daily background maintenance. A browser tab switch
    // must not trigger it. The initial run plus the ordinary 30-minute timer
    // are sufficient and avoid unnecessary provider/Supabase traffic on focus.
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [state, pathname]);

  if (state === "signed-in") {
    return <>{children}</>;
  }


  if (state === "plan-required") {
    return (
      <main className="wd-auth-shell">
        <section className="wd-auth-card wd-auth-card-small">
          <div className="wd-auth-logo">W</div>
          <h1>{message}</h1>
          <p>Upgrade to WheelDesk Command to unlock SPX 0DTE decision intelligence.</p>
          <Link href={`/pricing?upgrade=${requiredPlan}&next=${encodeURIComponent(next)}`} className="wd-auth-primary">
            View Command
          </Link>
        </section>
      </main>
    );
  }

  if (state === "billing-required") {
    return (
      <main className="wd-auth-shell">
        <section className="wd-auth-card wd-auth-card-small">
          <div className="wd-auth-logo">W</div>
          <h1>Choose a WheelDesk plan.</h1>
          <p>The trading console unlocks after Stripe confirms an active subscription.</p>
          <Link href={`/pricing?access=required&next=${encodeURIComponent(next)}`} className="wd-auth-primary">
            View pricing
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="wd-auth-shell">
      <section className="wd-auth-card wd-auth-card-small">
        <div className="wd-auth-logo">W</div>
        <h1>{message}</h1>
        <p>Loading your secure trading console.</p>
      </section>
    </main>
  );
}
