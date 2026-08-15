import Link from "next/link";
import CheckoutButton from "../../components/billing/CheckoutButton";
import { WHEELDESK_PUBLIC_PLANS } from "../../lib/billing/plans";

type PricingPageProps = {
  searchParams?: Promise<{
    checkout?: string;
    plan?: string;
    access?: string;
    next?: string;
  }>;
};

type MatrixRow = {
  label: string;
  wheel: boolean | string;
  command: boolean | string;
  commandFeature?: boolean;
};

const comparisonRows: MatrixRow[] = [
  { label: "Control Center", wheel: true, command: true },
  { label: "Watchlist Command", wheel: true, command: true },
  { label: "Portfolio risk console", wheel: true, command: true },
  { label: "Wheel workflow & repair tools", wheel: true, command: true },
  { label: "OI surfaces", wheel: true, command: true },
  { label: "Dealer pressure context", wheel: true, command: true },
  { label: "Wall migration & structure history", wheel: true, command: true },
  { label: "Validation receipts", wheel: true, command: true },
  { label: "Multi-chain market context", wheel: true, command: true },
  { label: "SPX 0DTE Command", wheel: false, command: true, commandFeature: true },
  { label: "0DTE candidate engine", wheel: false, command: true, commandFeature: true },
  { label: "Iron Fly intelligence", wheel: false, command: true, commandFeature: true },
  { label: "Credit spread intelligence", wheel: false, command: true, commandFeature: true },
  { label: "Readiness / entry state", wheel: false, command: true, commandFeature: true },
  { label: "Premium crest & exhaustion", wheel: false, command: true, commandFeature: true },
  { label: "Path of least resistance", wheel: false, command: true, commandFeature: true },
  { label: "Execution dock & risk policy", wheel: false, command: true, commandFeature: true },
  { label: "Trade lifecycle intelligence", wheel: false, command: true, commandFeature: true },
  { label: "Shadow validation / MAE-MFE", wheel: false, command: true, commandFeature: true },
];

const faqs = [
  {
    question: "Does Command include WheelDesk?",
    answer: "Yes. WheelDesk Command includes the complete WheelDesk platform plus the SPX 0DTE Command environment.",
  },
  {
    question: "Can I cancel anytime?",
    answer: "Yes. Both plans are billed monthly with no annual commitment required.",
  },
  {
    question: "Does WheelDesk place trades for me?",
    answer: "No. WheelDesk provides market analytics and decision intelligence. You remain in control of order entry and execution.",
  },
  {
    question: "Why is Command marked Early Access?",
    answer: "Command is operational and actively used while its models, execution intelligence, and validation framework continue to evolve.",
  },
];

function MatrixValue({ value }: { value: boolean | string }) {
  if (typeof value === "string") return <span>{value}</span>;
  return value ? <span className="wd-matrix-check" aria-label="Included">✓</span> : <span className="wd-matrix-dash" aria-label="Not included">—</span>;
}

export default async function PricingPage({ searchParams }: PricingPageProps) {
  const params = await searchParams;
  const checkoutStatus = params?.checkout;
  const accessStatus = params?.access;
  const billingEnabled = process.env.NEXT_PUBLIC_BILLING_ENABLED === "true";

  return (
    <main className="wd-landing wd-pricing-page wd-pricing-page-v2">
      <div className="wd-landing-glow wd-landing-glow-one" />
      <div className="wd-landing-glow wd-landing-glow-two" />

      <header className="wd-landing-nav">
        <Link href="/" className="wd-landing-brand" aria-label="WheelDesk home">
          <span className="wd-landing-logo">W</span>
          <span>
            <span className="wd-landing-brand-name">WheelDesk</span>
            <span className="wd-landing-brand-sub">PRICING</span>
          </span>
        </Link>
        <nav className="wd-landing-links" aria-label="Pricing navigation">
          <Link href="/">Home</Link>
          <Link href="/about">About</Link>
          <Link href="/login">Log in</Link>
          <Link href="/signup" className="wd-nav-cta">Get started</Link>
        </nav>
      </header>

      <section className="wd-pricing-hero wd-pricing-hero-v2">
        <div className="wd-eyebrow">Two products · one platform</div>
        <h1>Choose how close WheelDesk sits to the trade.</h1>
        <p>
          Use WheelDesk for market structure and premium management. Bring in Command when you want the full
          SPX 0DTE decision engine beside you during the session.
        </p>

        {accessStatus === "required" ? (
          <p className="wd-auth-status">Choose a plan to unlock WheelDesk.</p>
        ) : null}
        {!billingEnabled ? (
          <p className="wd-auth-status">Billing is currently in preview. Pricing is visible, but checkout is not open yet.</p>
        ) : null}
        {checkoutStatus === "cancelled" ? (
          <p className="wd-auth-status">Checkout was cancelled. Choose a plan whenever you are ready.</p>
        ) : null}
      </section>

      <section className="wd-pricing-grid wd-pricing-grid-page wd-pricing-grid-two" aria-label="WheelDesk plans">
        {WHEELDESK_PUBLIC_PLANS.map((plan) => (
          <article key={plan.id} className={plan.highlight ? "wd-price-card wd-price-card-highlight wd-price-card-command" : "wd-price-card"}>
            <div className="wd-price-card-head">
              <div>
                <div className="wd-price-title-row">
                  <h2>{plan.name}</h2>
                  {plan.badge ? <span className="wd-price-badge">{plan.badge}</span> : null}
                </div>
                <p>{plan.description}</p>
              </div>
              <div className="wd-price"><strong>{plan.priceLabel}</strong><span>{plan.note}</span></div>
            </div>

            <ul className="wd-price-feature-list">
              {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
            </ul>

            <CheckoutButton planId={plan.id} label={plan.id === "research" ? "Access Command" : "Get WheelDesk"} />
          </article>
        ))}
      </section>

      <section className="wd-pricing-compare" aria-labelledby="compare-plans-title">
        <div className="wd-pricing-section-heading">
          <div className="wd-eyebrow">Compare plans</div>
          <h2 id="compare-plans-title">The difference is the trading session.</h2>
          <p>
            Command includes WheelDesk, then adds the live 0DTE machinery for structure selection, readiness,
            premium behavior, risk, and trade lifecycle decisions.
          </p>
        </div>

        <div className="wd-pricing-matrix-wrap">
          <table className="wd-pricing-matrix">
            <thead>
              <tr>
                <th scope="col">Capability</th>
                <th scope="col">
                  <span>WheelDesk</span>
                  <strong>$99</strong>
                </th>
                <th scope="col" className="wd-matrix-command-head">
                  <span>Command</span>
                  <strong>$499</strong>
                </th>
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((row) => (
                <tr key={row.label} className={row.commandFeature ? "wd-matrix-command-row" : undefined}>
                  <th scope="row">{row.label}</th>
                  <td><MatrixValue value={row.wheel} /></td>
                  <td><MatrixValue value={row.command} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="wd-pricing-faq" aria-labelledby="pricing-faq-title">
        <div className="wd-pricing-section-heading">
          <div className="wd-eyebrow">Questions</div>
          <h2 id="pricing-faq-title">Keep the terms as simple as the pricing.</h2>
        </div>

        <div className="wd-pricing-faq-grid">
          {faqs.map((faq) => (
            <article key={faq.question}>
              <h3>{faq.question}</h3>
              <p>{faq.answer}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="wd-pricing-close">
        <div>
          <div className="wd-eyebrow">WheelDesk Command</div>
          <h2>Built for traders who already know how to trade.</h2>
          <p>Structure. Placement. Readiness. Exhaustion. Risk.</p>
        </div>
        <Link href="/signup?plan=research" className="wd-primary-cta">Access Command</Link>
      </section>

      <div className="wd-pricing-disclaimer">
        WheelDesk is analytical software, not a broker, investment adviser, or trade-execution service. Options involve risk and are not suitable for every investor.
      </div>

      <footer className="wd-landing-footer">
        <span>WheelDesk · thewheeldesk.com</span>
        <span className="wd-footer-links">
          <Link href="/pricing">Pricing</Link>
          <Link href="/faq">FAQ</Link>
          <Link href="/about">About</Link>
          <Link href="/contact">Contact</Link>
        </span>
      </footer>
    </main>
  );
}
