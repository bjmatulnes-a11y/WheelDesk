import { NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabase-server";
import { getAuthenticatedUserFromRequest } from "../../../../lib/billing/auth-request";
import { getSiteUrl, getStripe, requireBillingEnabled } from "../../../../lib/billing/stripe-server";

export const runtime = "nodejs";

function statusForBillingError(message: string) {
  if (message.includes("disabled")) return 503;
  if (message.includes("Missing STRIPE")) return 500;
  if (message.includes("bearer") || message.includes("Invalid session")) return 401;
  return 400;
}

export async function POST(request: Request) {
  try {
    requireBillingEnabled();

    const user = await getAuthenticatedUserFromRequest(request);
    const stripe = getStripe();
    const siteUrl = getSiteUrl(request);

    const { data: profile, error } = await supabaseServer
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .maybeSingle();

    if (error) throw error;

    const customerId = typeof profile?.stripe_customer_id === "string" ? profile.stripe_customer_id : null;

    if (!customerId) {
      return NextResponse.json(
        { error: "No Stripe customer exists yet. Start a plan from Pricing first." },
        { status: 400 },
      );
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${siteUrl}/account`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create billing portal session.";
    return NextResponse.json({ error: message }, { status: statusForBillingError(message) });
  }
}
