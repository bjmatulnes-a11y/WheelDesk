import Link from "next/link";

const plans = [
  {
    id: "founder",
    name: "Founder",
    price: "$49",
    note: "early access",
    description: "For the first cohort validating the WheelDesk edge.",
    features: ["Control Center", "Validation", "Portfolio risk console", "Scanner", "Mobile install"],
  },
  {
    id: "core",
    name: "Core",
    price: "$79",
    note: "per month",
    description: "The main WheelDesk subscription for active premium sellers.",
    features: ["OI surfaces", "Wheel repair tools", "Saved tickers", "Market Structure", "Basic validation"],
    highlight: true,
  },
  {
    id: "research",
    name: "Research",
    price: "$129",
    note: "per month",
    description: "The deeper edge stack for validation and structure research.",
    features: ["Dealer pressure", "Wall migration", "Multi-chain confluence", "Validation history", "Research exports"],
  },
];

export default function PricingPage() {
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
        <div className="wd-eyebrow">Login now, billing next</div>
        <h1>Start with account access. Wire Stripe after the gates are stable.</h1>
        <p>
          These tiers are now represented in signup metadata so the billing layer can map Stripe prices
          directly to WheelDesk entitlements in the next package.
        </p>
      </section>

      <section className="wd-pricing-grid wd-pricing-grid-page">
        {plans.map((plan) => (
          <article key={plan.id} className={plan.highlight ? "wd-price-card wd-price-card-highlight" : "wd-price-card"}>
            <div>
              <h2>{plan.name}</h2>
              <p>{plan.description}</p>
            </div>
            <div className="wd-price"><strong>{plan.price}</strong><span>{plan.note}</span></div>
            <ul>
              {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
            </ul>
            <Link href={`/signup?plan=${plan.id}`}>Start {plan.name}</Link>
          </article>
        ))}
      </section>
    </main>
  );
}
