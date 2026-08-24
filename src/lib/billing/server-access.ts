import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { supabaseServer } from "../supabase-server";
import { getAuthenticatedUserFromRequest } from "./auth-request";
import { hasPlanAccess } from "./subscription-access";
import type { WheelDeskPlanId } from "./plans";
import { normalizeWheelDeskRole, type WheelDeskRole } from "../auth/application-role";

type SubscriptionAccessRow = {
  plan: string | null;
  status: string | null;
  current_period_end: string | null;
};

export type RequestPlanAccess = {
  user: User;
  plan: string;
  status: string;
  billingBypass: boolean;
  role: WheelDeskRole;
};

export type RequestPlanAccessResult =
  | { ok: true; access: RequestPlanAccess }
  | { ok: false; response: NextResponse };

const ACCESS_LOOKUP_CACHE_MS = 30_000;

type TimedValue<T> = { value: T; expiresAt: number };

const globalAccessCache = globalThis as typeof globalThis & {
  __wheelDeskRoleCache?: Map<string, TimedValue<WheelDeskRole>>;
  __wheelDeskSubscriptionCache?: Map<string, TimedValue<SubscriptionAccessRow | null>>;
  __wheelDeskRoleLoads?: Map<string, Promise<WheelDeskRole>>;
  __wheelDeskSubscriptionLoads?: Map<string, Promise<SubscriptionAccessRow | null>>;
};

function roleCache() {
  return (globalAccessCache.__wheelDeskRoleCache ??= new Map());
}

function subscriptionCache() {
  return (globalAccessCache.__wheelDeskSubscriptionCache ??= new Map());
}

function roleLoads() {
  return (globalAccessCache.__wheelDeskRoleLoads ??= new Map());
}

function subscriptionLoads() {
  return (globalAccessCache.__wheelDeskSubscriptionLoads ??= new Map());
}

async function applicationRole(userId: string): Promise<WheelDeskRole> {
  const cached = roleCache().get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const pending = roleLoads().get(userId);
  if (pending) return pending;

  const load = (async () => {
    const { data, error } = await supabaseServer
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();

    // Missing role rows are normal and mean a standard user. During rollout,
    // also fail closed to the normal user role if the role table has not yet
    // been installed rather than breaking authentication for everyone.
    if (error) {
      console.warn("WheelDesk application role check failed", error.message);
      return "user" as WheelDeskRole;
    }

    return normalizeWheelDeskRole(data?.role);
  })();

  roleLoads().set(userId, load);
  try {
    const value = await load;
    roleCache().set(userId, { value, expiresAt: Date.now() + ACCESS_LOOKUP_CACHE_MS });
    return value;
  } finally {
    if (roleLoads().get(userId) === load) roleLoads().delete(userId);
  }
}

async function activeSubscription(userId: string): Promise<SubscriptionAccessRow | null> {
  const cached = subscriptionCache().get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const pending = subscriptionLoads().get(userId);
  if (pending) return pending;

  const load = (async () => {
    const { data, error } = await supabaseServer
      .from("subscriptions")
      .select("plan,status,current_period_end")
      .eq("user_id", userId)
      .in("status", ["active", "trialing"])
      .order("current_period_end", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return (data as SubscriptionAccessRow | null) ?? null;
  })();

  subscriptionLoads().set(userId, load);
  try {
    const value = await load;
    subscriptionCache().set(userId, { value, expiresAt: Date.now() + ACCESS_LOOKUP_CACHE_MS });
    return value;
  } finally {
    if (subscriptionLoads().get(userId) === load) subscriptionLoads().delete(userId);
  }
}

export async function requirePlanAccessFromRequest(
  request: Request,
  requiredPlan: WheelDeskPlanId,
): Promise<RequestPlanAccessResult> {
  let user: User;
  try {
    user = await getAuthenticatedUserFromRequest(request);
  } catch (error) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          code: "authentication_required",
          error: error instanceof Error ? error.message : "Authentication required.",
        },
        { status: 401 },
      ),
    };
  }

  const role = await applicationRole(user.id);

  // Admin is application authority, independent of Stripe. It receives the
  // complete product entitlement even if the account has no paid subscription.
  if (role === "admin") {
    return {
      ok: true,
      access: {
        user,
        plan: "research",
        status: "active",
        billingBypass: true,
        role,
      },
    };
  }

  // Checkout availability and application entitlement are intentionally
  // independent. Non-admin users must always hold an active subscription
  // whose plan satisfies the requested capability.
  let subscription: SubscriptionAccessRow | null;
  try {
    subscription = await activeSubscription(user.id);
  } catch (error) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          code: "access_check_failed",
          error: error instanceof Error ? error.message : "Could not verify subscription access.",
        },
        { status: 503 },
      ),
    };
  }

  if (!subscription?.plan || !subscription.status) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          code: "subscription_required",
          error: "An active WheelDesk subscription is required.",
          requiredPlan,
        },
        { status: 403 },
      ),
    };
  }

  if (!hasPlanAccess(subscription.plan, subscription.status, requiredPlan)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          code: "plan_upgrade_required",
          error:
            requiredPlan === "research"
              ? "WheelDesk Command access is required for this feature."
              : "Your WheelDesk plan does not include this feature.",
          activePlan: subscription.plan,
          requiredPlan,
        },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true,
    access: {
      user,
      plan: subscription.plan,
      status: subscription.status,
      billingBypass: false,
      role,
    },
  };
}
