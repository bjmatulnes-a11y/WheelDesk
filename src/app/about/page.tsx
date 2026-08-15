import Link from "next/link";

export const metadata = {
  title: "About WheelDesk",
  description:
    "WheelDesk is an options market structure and portfolio risk control center for active premium sellers and wheel-strategy traders.",
};

const principles = [
  {
    title: "Structure before signal noise",
    body:
      "WheelDesk is built to organize open-interest walls, implied-volatility context, dealer pressure, and portfolio exposure into a daily operating picture instead of another pile of chart indicators.",
  },
  {
    title: "Validation receipts matter",
    body:
      "A trading tool should not only say what may happen. It should track whether prior levels, paths, and pressure reads actually held up against realized price action.",
  },
  {
    title: "Designed for premium sellers",
    body:
      "The product is especially shaped around wheel traders, covered-call managers, cash-secured puts, repair decisions, and position risk rather than one-off hype trades.",
  },
];

const loop = [
  "Open the Control Center for the current read.",
  "Check what changed across walls, IV bands, dealer pressure, and path structure.",
  "Review Validation to see whether the edge has been earning trust.",
  "Use Portfolio and Wheel views to decide whether to sell, roll, repair, wait, or stand down.",
];

export default function AboutPage() {
  return (
    <main className="wd-landing wd-info-page">
      <div className="wd-landing-glow wd-landing-glow-one" />
      <div className="wd-landing-glow wd-landing-glow-two" />

      <header className="wd-landing-nav">
        <Link href="/" className="wd-landing-brand" aria-label="WheelDesk home">
          <span className="wd-landing-logo">W</span>
          <span>
            <span className="wd-landing-brand-name">WheelDesk</span>
            <span className="wd-landing-brand-sub">OPTIONS CONTROL SYSTEM</span>
          </span>
        </Link>

        <nav className="wd-landing-links" aria-label="About page navigation">
          <Link href="/faq">FAQ</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/login">Login</Link>
          <Link href="/signup">Create Account</Link>
        </nav>
      </header>

      <section className="wd-section wd-info-hero">
        <div>
          <div className="wd-eyebrow">About WheelDesk</div>
          <h1>Options market structure intelligence with validation receipts.</h1>
          <p>
            WheelDesk was built for active traders who want more than chart noise. It brings open-interest structure,
            dealer pressure, implied-volatility context, validation history, and portfolio risk into a single control center.
          </p>
          <div className="wd-hero-actions">
            <Link href="/signup" className="wd-primary-cta">Create Account</Link>
            <Link href="/faq" className="wd-secondary-cta">Read FAQ</Link>
          </div>
        </div>

        <aside className="wd-info-card wd-info-callout">
          <span className="wd-info-kicker">Product position</span>
          <strong>Not a signal room. Not financial advice. A control system.</strong>
          <p>
            WheelDesk is designed to help traders understand where market structure may be concentrated,
            where risk is building, and whether prior reads have actually worked.
          </p>
        </aside>
      </section>

      <section className="wd-section">
        <div className="wd-info-heading">
          <div className="wd-eyebrow">Core philosophy</div>
          <h2>Built around the decision loop traders actually live in.</h2>
        </div>

        <div className="wd-info-grid">
          {principles.map((principle) => (
            <article className="wd-info-card" key={principle.title}>
              <h3>{principle.title}</h3>
              <p>{principle.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="wd-section wd-split-section">
        <div>
          <div className="wd-eyebrow">Daily edge loop</div>
          <h2>The sticky habit is simple: what changed, what matters, what now?</h2>
          <p>
            The goal is for WheelDesk to become a trader’s daily options control read — especially before selling premium,
            rolling covered calls, managing cash-secured puts, or deciding to wait.
          </p>
        </div>

        <div className="wd-signal-stack">
          {loop.map((item, index) => (
            <div className="wd-signal-row" key={item}>
              <strong>{String(index + 1).padStart(2, "0")}</strong>
              <span>{item}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="wd-final-cta">
        <div>
          <div className="wd-eyebrow">Next product promise</div>
          <h2>WheelDesk should earn trust with receipts.</h2>
          <p>
            The long-term edge is not just producing a read. It is proving when that read worked, when it failed,
            and how the structure changed over time.
          </p>
        </div>
        <Link href="/pricing" className="wd-primary-cta">View Pricing</Link>
      </section>

      <footer className="wd-landing-footer">
        <span>WheelDesk · thewheeldesk.com</span>
        <span>About · FAQ · Pricing · Contact · Control Center</span>
      </footer>
    </main>
  );
}
