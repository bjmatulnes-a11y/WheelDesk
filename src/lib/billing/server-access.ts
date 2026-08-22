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

function billingIsEnabled(): boolean {
  return (
    process.env.BILLING_ENABLED === "true" ||
    process.env.NEXT_PUBLIC_BILLING_ENABLED === "true"
  );
}


async function applicationRole(userId: string): Promise<WheelDeskRole> {
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
    return "user";
  }

  return normalizeWheelDeskRole(data?.role);
}

async function activeSubscription(userId: string): Promise<SubscriptionAccessRow | null> {
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

  // Private-beta/dev mode can bypass billing, but never authentication.
  if (!billingIsEnabled()) {
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
