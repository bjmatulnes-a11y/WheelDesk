import Link from "next/link";
import { WHEELDESK_PLANS } from "../lib/billing/plans";
import HeroProductFrame from "../components/marketing/HeroProductFrame";

export default function LandingPage() {
  return (
    <main className="wd-landing">
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
          <a href="#product">Product</a>
          <a href="#validation">Validation</a>
          <a href="#daily-loop">Daily Loop</a>
          <Link href="/demo">Demo</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/faq">FAQ</Link>
          <Link href="/about">About</Link>
          <Link href="/login">Login</Link>
          <Link href="/signup">Create Account</Link>
        </nav>
      </header>

      <section className="wd-hero" id="product">
        <div className="wd-hero-copy">
          <div className="wd-eyebrow">Built for premium sellers and OI-driven operators</div>
          <h1>Turn option-chain chaos into a daily trading control center.</h1>
          <p>
            WheelDesk combines portfolio exposure, OI surface snapshots, IV bands, dealer pressure,
            wall migration, and validation into one cockpit for disciplined wheel and covered-call management.
          </p>

          <div className="wd-hero-actions">
            <Link href="/pricing" className="wd-primary-cta">View Plans</Link>
            <Link href="/login" className="wd-secondary-cta">Log In</Link>
          </div>

          <div className="wd-proof-grid" aria-label="WheelDesk product highlights">
            <div><span>Database</span><strong>Supabase-first</strong></div>
            <div><span>Signal layer</span><strong>OI + IV + flow</strong></div>
            <div><span>Phone access</span><strong>PWA install ready</strong></div>
          </div>
        </div>

        <HeroProductFrame />
      </section>

      <section className="wd-feature-band" aria-label="WheelDesk product pillars">
        <FeatureCard number="01" title="Harvest" detail="Capture option-chain surfaces and candles into Supabase so the app is not trapped in browser storage." />
        <FeatureCard number="02" title="Control" detail="Translate OI walls, IV bands, dealer pressure, and price context into a daily action state." />
        <FeatureCard number="03" title="Validate" detail="Measure the projected OI path against actual candles so the edge earns trust with receipts." />
      </section>

      <section className="wd-section wd-split-section" id="validation">
        <div>
          <div className="wd-eyebrow">Why traders care</div>
          <h2>WheelDesk is not another watchlist. It is a decision layer.</h2>
          <p>
            The product is being shaped around one question: should the trader sell, repair, roll, wait,
            or stand down? The Control Center is the front end; the Validation page is where the product proves it.
          </p>
        </div>

        <div className="wd-signal-stack">
          <SignalRow label="OI Surface" value="Walls, magnets, path, and chain context" />
          <SignalRow label="Dealer Pressure" value="Pin risk, unlock zones, and neutralization pressure" />
          <SignalRow label="Portfolio" value="Theo value, mark value, delta/theta, cash capacity" />
          <SignalRow label="Validation" value="Projected path versus realized price behavior" />
        </div>
      </section>


      <section className="wd-section wd-split-section" id="daily-loop">
        <div>
          <div className="wd-eyebrow">Sticky by design</div>
          <h2>The daily edge loop gives traders a reason to come back.</h2>
          <p>
            WheelDesk is built around a repeatable trading routine: check what changed, read the current structure,
            compare the signal to validation receipts, then decide whether to sell premium, repair, roll, or wait.
          </p>
        </div>

        <div className="wd-signal-stack">
          <SignalRow label="Morning read" value="Saved tickers surface today’s bias, walls, pressure, and risk state" />
          <SignalRow label="What changed" value="Call walls, put supports, IV bands, and dealer pressure versus yesterday" />
          <SignalRow label="Signal receipts" value="Validation tracks whether prior projected paths actually worked" />
          <SignalRow label="Portfolio fit" value="Position risk and wheel basis keep the action map grounded" />
        </div>
      </section>

      <section className="wd-section wd-mobile-section" id="mobile">
        <div>
          <div className="wd-eyebrow">Mobile-first access</div>
          <h2>Install WheelDesk from Safari while the native app roadmap develops.</h2>
          <p>
            The current product is a PWA: deploy it, open it on iPhone, tap Share, then Add to Home Screen.
            That gives users an app icon and standalone launch while the native iPhone app and billing layer are finalized.
          </p>
        </div>
        <div className="wd-phone-card">
          <span className="wd-phone-notch" />
          <strong>WheelDesk</strong>
          <p>Control Center, Portfolio, Scanner, Wheel, and Validation in a phone-ready shell.</p>
          <Link href="/pricing">View plans</Link>
        </div>
      </section>

      <section className="wd-section" id="pricing">
        <div className="wd-pricing-heading">
          <div className="wd-eyebrow">Pricing</div>
          <h2>Choose the control level that matches your trading workflow.</h2>
          <p>
            Account creation is free, but the trading console is gated by subscription once billing is enabled.
            This keeps users from bypassing checkout and makes Stripe the source of truth for plan access.
          </p>
        </div>

        <div className="wd-pricing-grid">
          {WHEELDESK_PLANS.map((plan) => (
            <article key={plan.id} className={plan.highlight ? "wd-price-card wd-price-card-highlight" : "wd-price-card"}>
              <div>
                <h3>{plan.name}</h3>
                <p>{plan.description}</p>
              </div>
              <div className="wd-price">
                <strong>{plan.priceLabel}</strong>
                <span>{plan.note}</span>
              </div>
              <ul>
                {plan.features.slice(0, 5).map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <Link href={`/pricing?plan=${plan.id}`}>Choose {plan.name}</Link>
            </article>
          ))}
        </div>
      </section>

      <section className="wd-final-cta">
        <div>
          <div className="wd-eyebrow">Next milestone</div>
          <h2>Start with a plan. Unlock the console after Stripe confirms access.</h2>
          <p>
            Pricing is back on the landing page, while the app itself remains protected by login plus active subscription status.
            Users can create accounts, but they cannot bypass the paid access gate once billing is enabled.
          </p>
        </div>
        <Link href="/pricing" className="wd-primary-cta">View Plans</Link>
      </section>

      <footer className="wd-landing-footer">
        <span>WheelDesk · thewheeldesk.com</span>
        <span>Control Center · Validation · Portfolio · Pricing · Mobile · FAQ · About</span>
      </footer>
    </main>
  );
}

function ConsoleCard({ label, value, tone }: { label: string; value: string; tone: "cyan" | "green" | "violet" | "amber" }) {
  return (
    <div className={`wd-console-card wd-tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function FeatureCard({ number, title, detail }: { number: string; title: string; detail: string }) {
  return (
    <article className="wd-feature-card">
      <span>{number}</span>
      <h3>{title}</h3>
      <p>{detail}</p>
    </article>
  );
}

function SignalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="wd-signal-row">
      <strong>{label}</strong>
      <span>{value}</span>
    </div>
  );
}
