import { NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabase-server";
import { getAuthenticatedUserFromRequest } from "../../../../lib/billing/auth-request";
import { getSiteUrl, getStripe, getStripePriceId, sanitizePlanId } from "../../../../lib/billing/stripe-server";

export const runtime = "nodejs";

type CheckoutRequestBody = {
  plan?: string;
};

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUserFromRequest(request);
    const body = (await request.json().catch(() => ({}))) as CheckoutRequestBody;
    const plan = sanitizePlanId(body.plan);
    const priceId = getStripePriceId(plan);
    const siteUrl = getSiteUrl(request);
    const stripe = getStripe();

    const { data: profile } = await supabaseServer
      .from("profiles")
      .select("stripe_customer_id, selected_plan")
      .eq("id", user.id)
      .maybeSingle();

    let customerId = typeof profile?.stripe_customer_id === "string" ? profile.stripe_customer_id : null;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: {
          user_id: user.id,
          product: "WheelDesk",
        },
      });

      customerId = customer.id;

      await supabaseServer.from("profiles").upsert(
        {
          id: user.id,
          email: user.email,
          selected_plan: plan,
          stripe_customer_id: customerId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );
    } else {
      await supabaseServer
        .from("profiles")
        .update({ selected_plan: plan, updated_at: new Date().toISOString() })
        .eq("id", user.id);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      client_reference_id: user.id,
      success_url: `${siteUrl}/account?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/pricing?checkout=cancelled&plan=${encodeURIComponent(plan)}`,
      metadata: {
        user_id: user.id,
        plan,
        product: "WheelDesk",
      },
      subscription_data: {
        metadata: {
          user_id: user.id,
          plan,
          product: "WheelDesk",
        },
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create checkout session.";
    return NextResponse.json({ error: message }, { status: message.includes("Missing") ? 500 : 401 });
  }
}
