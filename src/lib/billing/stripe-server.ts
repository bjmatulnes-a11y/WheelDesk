import Stripe from "stripe";
import { isWheelDeskPlanId, type WheelDeskPlanId } from "./plans";

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }

  if (!stripeClient) {
    stripeClient = new Stripe(secretKey);
  }

  return stripeClient;
}

const PLAN_PRICE_ENV: Record<WheelDeskPlanId, string> = {
  founder: "STRIPE_PRICE_FOUNDER",
  core: "STRIPE_PRICE_CORE",
  research: "STRIPE_PRICE_RESEARCH",
};

export function getStripePriceId(plan: WheelDeskPlanId): string {
  const envName = PLAN_PRICE_ENV[plan];
  const priceId = process.env[envName];

  if (!priceId) {
    throw new Error(`Missing ${envName}`);
  }

  return priceId;
}

export function planFromStripePriceId(priceId: string | null | undefined): WheelDeskPlanId {
  if (!priceId) return "founder";

  const entries = Object.entries(PLAN_PRICE_ENV) as Array<[WheelDeskPlanId, string]>;
  for (const [plan, envName] of entries) {
    if (process.env[envName] === priceId) return plan;
  }

  return "founder";
}

export function sanitizePlanId(value: unknown): WheelDeskPlanId {
  if (typeof value === "string" && isWheelDeskPlanId(value)) return value;
  return "founder";
}

export function getSiteUrl(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL;
  if (configured) return configured.replace(/\/$/, "");

  const origin = request.headers.get("origin");
  if (origin) return origin.replace(/\/$/, "");

  const host = request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  if (host) return `${proto}://${host}`;

  return "http://localhost:3000";
}

export function unixToIso(value: number | null | undefined): string | null {
  if (!value) return null;
  return new Date(value * 1000).toISOString();
}
