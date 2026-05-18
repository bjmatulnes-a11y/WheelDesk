import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseServer } from "../../../../lib/supabase-server";
import { getStripe, planFromStripePriceId, sanitizePlanId, unixToIso } from "../../../../lib/billing/stripe-server";

export const runtime = "nodejs";

type StripeSubscriptionLike = Stripe.Subscription & {
  current_period_start?: number;
  current_period_end?: number;
};

async function recordBillingEvent(event: Stripe.Event) {
  await supabaseServer.from("billing_events").upsert(
    {
      id: event.id,
      type: event.type,
      stripe_created_at: unixToIso(event.created),
      payload: event as unknown as Record<string, unknown>,
    },
    { onConflict: "id" },
  );
}

async function findUserIdForSubscription(subscription: StripeSubscriptionLike, fallbackUserId?: string | null) {
  if (fallbackUserId) return fallbackUserId;

  const metadataUserId = typeof subscription.metadata?.user_id === "string" ? subscription.metadata.user_id : null;
  if (metadataUserId) return metadataUserId;

  const { data: existing } = await supabaseServer
    .from("subscriptions")
    .select("user_id")
    .eq("stripe_subscription_id", subscription.id)
    .maybeSingle();

  if (typeof existing?.user_id === "string") return existing.user_id;

  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
  if (!customerId) return null;

  const { data: profile } = await supabaseServer
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  return typeof profile?.id === "string" ? profile.id : null;
}

async function upsertSubscriptionFromStripe(
  subscription: StripeSubscriptionLike,
  fallbackUserId?: string | null,
  fallbackPlan?: string | null,
) {
  const userId = await findUserIdForSubscription(subscription, fallbackUserId);
  if (!userId) return;

  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id ?? null;
  const firstItem = subscription.items?.data?.[0];
  const priceId = typeof firstItem?.price?.id === "string" ? firstItem.price.id : null;
  const plan = sanitizePlanId(subscription.metadata?.plan ?? fallbackPlan ?? planFromStripePriceId(priceId));

  await supabaseServer.from("subscriptions").upsert(
    {
      user_id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      stripe_price_id: priceId,
      plan,
      status: subscription.status,
      current_period_start: unixToIso(subscription.current_period_start),
      current_period_end: unixToIso(subscription.current_period_end),
      cancel_at_period_end: subscription.cancel_at_period_end ?? false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_subscription_id" },
  );

  await supabaseServer.from("profiles").upsert(
    {
      id: userId,
      selected_plan: plan,
      stripe_customer_id: customerId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
}

async function syncSubscriptionById(subscriptionId: string, fallbackUserId?: string | null, fallbackPlan?: string | null) {
  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  await upsertSubscriptionFromStripe(subscription as StripeSubscriptionLike, fallbackUserId, fallbackPlan);
}

function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const parentSubscription =
    invoice.parent?.type === "subscription_details"
      ? invoice.parent.subscription_details?.subscription
      : null;

  if (typeof parentSubscription === "string") return parentSubscription;

  const legacyInvoice = invoice as Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null;
  };

  if (typeof legacyInvoice.subscription === "string") return legacyInvoice.subscription;
  if (legacyInvoice.subscription && typeof legacyInvoice.subscription === "object") return legacyInvoice.subscription.id;

  return null;
}

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return NextResponse.json({ error: "Missing STRIPE_WEBHOOK_SECRET" }, { status: 500 });
  }

  const stripe = getStripe();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    const rawBody = await request.text();
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook signature verification failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    await recordBillingEvent(event);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
        const userId = typeof session.metadata?.user_id === "string" ? session.metadata.user_id : session.client_reference_id;
        const plan = typeof session.metadata?.plan === "string" ? session.metadata.plan : null;
        const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;

        if (userId && customerId) {
          await supabaseServer.from("profiles").upsert(
            {
              id: userId,
              stripe_customer_id: customerId,
              selected_plan: sanitizePlanId(plan),
              updated_at: new Date().toISOString(),
            },
            { onConflict: "id" },
          );
        }

        if (subscriptionId) await syncSubscriptionById(subscriptionId, userId, plan);
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as StripeSubscriptionLike;
        await upsertSubscriptionFromStripe(subscription);
        break;
      }

      case "invoice.payment_succeeded":
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = getInvoiceSubscriptionId(invoice);
        if (subscriptionId) await syncSubscriptionById(subscriptionId);
        break;
      }

      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook processing failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
