import Link from "next/link";
import HeroProductFrame from "../components/marketing/HeroProductFrame";

export default function LandingPage() {
  return (
    <main className="wd-landing wd-landing-minimal">
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

        <nav className="wd-landing-links" aria-label="Primary landing navigation">
          <a href="#platform">Platform</a>
          <Link href="/pricing">Pricing</Link>
          <Link href="/about">About</Link>
          <Link href="/login">Log in</Link>
          <Link href="/signup" className="wd-nav-cta">Get started</Link>
        </nav>
      </header>

      <section className="wd-hero" id="platform">
        <div className="wd-hero-copy">
          <div className="wd-eyebrow">Options market structure for active premium sellers</div>
          <h1>See the structure. Trade the decision.</h1>
          <p>
            WheelDesk turns options positioning, dealer pressure, premium behavior, and portfolio context
            into a clearer operating picture — from SPX 0DTE execution to wheel management.
          </p>

          <div className="wd-hero-actions">
            <Link href="/signup" className="wd-primary-cta">Get started</Link>
            <Link href="/pricing" className="wd-secondary-cta">View pricing</Link>
          </div>

          <div className="wd-hero-points" aria-label="WheelDesk focus areas">
            <span>Market structure</span>
            <span>Execution timing</span>
            <span>Validation</span>
          </div>
        </div>

        <HeroProductFrame />
      </section>

      <section className="wd-value-band" aria-label="WheelDesk product pillars">
        <article>
          <span>01</span>
          <h2>Find the structure</h2>
          <p>Surface the levels, pressure, positioning, and path that matter without living inside the raw option chain.</p>
        </article>
        <article>
          <span>02</span>
          <h2>Wait for the trade</h2>
          <p>Use premium behavior and execution context to separate a setup from a trade that is actually ready.</p>
        </article>
        <article>
          <span>03</span>
          <h2>Keep the receipts</h2>
          <p>Compare prior reads with realized price action so confidence comes from evidence, not another black-box signal.</p>
        </article>
      </section>

      <section className="wd-horizon-section">
        <div className="wd-horizon-heading">
          <div className="wd-eyebrow">One platform · two horizons</div>
          <h2>Built for the decisions before, during, and after the trade.</h2>
        </div>

        <div className="wd-horizon-grid">
          <article className="wd-horizon-card">
            <div>
              <span className="wd-horizon-kicker">Intraday</span>
              <h3>0DTE Command</h3>
              <p>
                Read pressure, premium, exhaustion, and execution readiness as the session develops.
              </p>
            </div>
            <Link href="/zero-dte/chart">Explore 0DTE →</Link>
          </article>

          <article className="wd-horizon-card">
            <div>
              <span className="wd-horizon-kicker">Portfolio</span>
              <h3>Wheel + Control Center</h3>
              <p>
                Put OI structure, forecast context, basis, Greeks, and position risk around covered calls and cash-secured puts.
              </p>
            </div>
            <Link href="/about">Explore the platform →</Link>
          </article>
        </div>
      </section>

      <section className="wd-final-cta wd-final-cta-minimal">
        <div>
          <div className="wd-eyebrow">WheelDesk</div>
          <h2>A quieter screen. A clearer decision.</h2>
          <p>Bring the market structure and the position into the same operating picture.</p>
        </div>
        <div className="wd-hero-actions">
          <Link href="/signup" className="wd-primary-cta">Create account</Link>
          <Link href="/login" className="wd-secondary-cta">Log in</Link>
        </div>
      </section>

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
