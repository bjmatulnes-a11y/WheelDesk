import Link from "next/link";
import CheckoutButton from "../../components/billing/CheckoutButton";
import { WHEELDESK_PLANS } from "../../lib/billing/plans";

type PricingPageProps = {
  searchParams?: Promise<{
    checkout?: string;
    plan?: string;
    access?: string;
    next?: string;
  }>;
};

export default async function PricingPage({ searchParams }: PricingPageProps) {
  const params = await searchParams;
  const checkoutStatus = params?.checkout;
  const accessStatus = params?.access;
  const billingEnabled = process.env.NEXT_PUBLIC_BILLING_ENABLED === "true";

  return (
    <main className="wd-landing wd-pricing-page">
      <header className="wd-landing-nav">
        <Link href="/" className="wd-landing-brand" aria-label="WheelDesk home">
          <span className="wd-landing-logo">W</span>
          <span>
            <span className="wd-landing-brand-name">WheelDesk</span>
            <span className="wd-landing-brand-sub">PRICING</span>
          </span>
        </Link>
        <nav className="wd-landing-links" aria-label="Pricing navigation">
          <Link href="/login">Login</Link>
          <Link href="/signup">Sign up</Link>
          <Link href="/control-center">App</Link>
        </nav>
      </header>

      <section className="wd-pricing-hero">
        <div className="wd-eyebrow">Stripe billing layer</div>
        <h1>Choose the WheelDesk tier and launch secure checkout.</h1>
        <p>
          Create an account, choose a plan, and Stripe becomes the source of truth for access.
          The trading console unlocks only after Supabase receives an active or trialing subscription from Stripe.
        </p>
        {accessStatus === "required" ? (
          <p className="wd-auth-status">Choose a plan to unlock Watchlist Command, Control Center, Wheel, Validation, and Portfolio.</p>
        ) : null}
        {!billingEnabled ? (
          <p className="wd-auth-status">Billing is in preview. Pricing is visible, but checkout stays disabled until the launch switch is turned on.</p>
        ) : null}
        {checkoutStatus === "cancelled" ? (
          <p className="wd-auth-status">Checkout was cancelled. Pick a plan when you are ready.</p>
        ) : null}
      </section>

      <section className="wd-pricing-grid wd-pricing-grid-page">
        {WHEELDESK_PLANS.map((plan) => (
          <article key={plan.id} className={plan.highlight ? "wd-price-card wd-price-card-highlight" : "wd-price-card"}>
            <div>
              <h2>{plan.name}</h2>
              <p>{plan.description}</p>
            </div>
            <div className="wd-price"><strong>{plan.priceLabel}</strong><span>{plan.note}</span></div>
            <ul>
              {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
            </ul>
            <CheckoutButton planId={plan.id} label={`Start ${plan.name}`} />
          </article>
        ))}
      </section>
    </main>
  );
}
