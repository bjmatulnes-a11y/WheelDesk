import Link from "next/link";

const pricingPlans = [
  {
    name: "Founder",
    price: "$49",
    note: "early cohort",
    description: "Best for the first users helping validate the WheelDesk edge.",
    features: ["Control Center", "Portfolio risk console", "OI snapshots", "Validation page", "Installable mobile app"],
    cta: "Join Founding Cohort",
  },
  {
    name: "Core",
    price: "$79",
    note: "per month",
    description: "The normal WheelDesk subscription for active premium sellers.",
    features: ["Market Structure workspace", "Scanner", "Wheel repair tools", "Saved surfaces", "Mobile-first dashboard"],
    cta: "Start Core",
    highlight: true,
  },
  {
    name: "Research",
    price: "$129",
    note: "per month",
    description: "For traders who want the full validation and dealer-pressure stack.",
    features: ["Dealer pressure", "Wall migration", "Multi-chain confluence", "Validation history", "Research exports"],
    cta: "Go Research",
  },
];

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
          <Link href="/pricing">Pricing</Link>
          <a href="#mobile">Mobile</a>
          <Link href="/login">Login</Link>
          <Link href="/signup">Start Founder</Link>
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
            <Link href="/signup?plan=founder" className="wd-primary-cta">Start Founder Access</Link>
            <Link href="/login" className="wd-secondary-cta">Log In</Link>
          </div>

          <div className="wd-proof-grid" aria-label="WheelDesk product highlights">
            <div><span>Database</span><strong>Supabase-first</strong></div>
            <div><span>Signal layer</span><strong>OI + IV + flow</strong></div>
            <div><span>Phone access</span><strong>PWA install ready</strong></div>
          </div>
        </div>

        <aside className="wd-terminal" aria-label="WheelDesk operator console preview">
          <div className="wd-terminal-bar">
            <span />
            <span />
            <span />
            <strong>WheelDesk Operator Console</strong>
          </div>

          <div className="wd-console-grid">
            <ConsoleCard label="Control State" value="Pin / Repair Watch" tone="cyan" />
            <ConsoleCard label="Dealer Pressure" value="Positive Gamma Drift" tone="green" />
            <ConsoleCard label="Bullish Unlock" value="Above call wall" tone="violet" />
            <ConsoleCard label="Risk Mode" value="Manage, don't chase" tone="amber" />
          </div>

          <div className="wd-chart-preview">
            <div className="wd-line wd-line-red">Call Wall</div>
            <div className="wd-line wd-line-cyan">IV Upper</div>
            <div className="wd-line wd-line-purple">OI Magnet</div>
            {Array.from({ length: 34 }).map((_, index) => (
              <span
                key={index}
                className={index % 4 === 0 ? "wd-candle wd-candle-red" : "wd-candle wd-candle-green"}
                style={{
                  height: `${24 + ((index * 13) % 54)}px`,
                  left: `${5 + index * 2.6}%`,
                  bottom: `${17 + ((index * 9) % 42)}%`,
                }}
              />
            ))}
          </div>
        </aside>
      </section>

      <section className="wd-feature-band" aria-label="WheelDesk product pillars">
        <FeatureCard number="01" title="Harvest" detail="Capture option-chain surfaces and candles into Supabase so the app is not trapped in browser storage." />
        <FeatureCard number="02" title="Control" detail="Translate OI walls, IV bands, dealer pressure, and price context into a daily action state." />
        <FeatureCard number="03" title="Validate" detail="Measure the projected OI path against actual candles so the edge earns trust with receipts." />
      </section>

      <section className="wd-section wd-split-section">
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

      <section className="wd-section wd-mobile-section" id="mobile">
        <div>
          <div className="wd-eyebrow">Mobile-first access</div>
          <h2>Install WheelDesk today from Safari. Native iPhone app comes next.</h2>
          <p>
            The current product is a PWA: deploy it, open it on iPhone, tap Share, then Add to Home Screen.
            That gives users an app icon and standalone launch while we finish login, billing, and subscription gating.
          </p>
        </div>
        <div className="wd-phone-card">
          <span className="wd-phone-notch" />
          <strong>WheelDesk</strong>
          <p>Control Center, Portfolio, Scanner, Wheel, and Validation in a phone-ready shell.</p>
          <Link href="/signup?plan=founder">Install after signup</Link>
        </div>
      </section>

      <section className="wd-section wd-pricing-section" id="pricing">
        <div className="wd-pricing-heading">
          <div className="wd-eyebrow">Pricing path</div>
          <h2>Simple tiers before we overbuild the business model.</h2>
          <p>Founder validates demand. Core becomes the main product. Research holds the deeper edge stack.</p>
        </div>

        <div className="wd-pricing-grid">
          {pricingPlans.map((plan) => (
            <article key={plan.name} className={plan.highlight ? "wd-price-card wd-price-card-highlight" : "wd-price-card"}>
              <div>
                <h3>{plan.name}</h3>
                <p>{plan.description}</p>
              </div>
              <div className="wd-price"><strong>{plan.price}</strong><span>{plan.note}</span></div>
              <ul>
                {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
              </ul>
              <Link href={`/signup?plan=${plan.name.toLowerCase()}`}>{plan.cta}</Link>
            </article>
          ))}
        </div>
      </section>

      <section className="wd-final-cta">
        <div>
          <div className="wd-eyebrow">Next milestone</div>
          <h2>Login, billing, and account gating.</h2>
          <p>
            Once auth and Stripe are wired, WheelDesk can move from a deployed tool to a sellable SaaS.
          </p>
        </div>
        <Link href="/signup?plan=founder" className="wd-primary-cta">Create Account</Link>
      </section>

      <footer className="wd-landing-footer">
        <span>WheelDesk · thewheeldesk.com</span>
        <span>Control Center · Validation · Portfolio · Mobile</span>
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
