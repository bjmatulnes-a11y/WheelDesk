import { NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabase-server";
import { getAuthenticatedUserFromRequest } from "../../../../lib/billing/auth-request";
import { getSiteUrl, getStripe } from "../../../../lib/billing/stripe-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
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
    return NextResponse.json({ error: message }, { status: message.includes("Missing") ? 500 : 401 });
  }
}
