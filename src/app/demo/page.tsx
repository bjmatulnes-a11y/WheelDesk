import Link from "next/link";

export const metadata = {
  title: "WheelDesk Demo Flow",
  description:
    "A public WheelDesk demo flow for showing the Control Center, Scanner, Wheel, Validation, Portfolio, and mobile install story.",
};

const demoSteps = [
  {
    title: "Start with the Control Center",
    detail:
      "Load a ticker, select the stored OI surface, choose the expiration chain, and read the current bias, walls, dealer pressure, IV band, and action state.",
  },
  {
    title: "Check what changed",
    detail:
      "Compare today’s walls, magnets, and pressure against prior snapshots so the trader knows whether structure is migrating or compressing.",
  },
  {
    title: "Use Scanner for opportunity",
    detail:
      "Scan tickers for structure quality, edge score, wall clarity, and setup candidates instead of manually hunting every chain.",
  },
  {
    title: "Move to Wheel for action context",
    detail:
      "Translate the structure into wheel posture: sell premium, wait, repair, roll, or stand down based on risk and price location.",
  },
  {
    title: "Prove it with Validation",
    detail:
      "Compare projected OI paths and structural levels against realized candles. This is where WheelDesk earns trust with receipts.",
  },
  {
    title: "Manage exposure in Portfolio",
    detail:
      "Review wheel basis, theo/mark value, greeks, cash capacity, expiration ladder, and risk profile so the next action fits the account.",
  },
];

const voiceover = [
  "WheelDesk turns options market structure into a daily control read.",
  "The Control Center shows the trader where open interest, IV, and dealer pressure are concentrated.",
  "Scanner helps find tickers where the structure is worth reviewing.",
  "Wheel and Portfolio keep the decision grounded in actual exposure and basis.",
  "Validation is the proof layer: did the projected path and key levels actually matter?",
  "The goal is not another signal room. The goal is options intelligence with receipts.",
];

export default function DemoPage() {
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

        <nav className="wd-landing-links" aria-label="Demo page navigation">
          <Link href="/about">About</Link>
          <Link href="/faq">FAQ</Link>
          <Link href="/login">Login</Link>
          <Link href="/signup">Create Account</Link>
        </nav>
      </header>

      <section className="wd-section wd-info-hero">
        <div>
          <div className="wd-eyebrow">Demo flow</div>
          <h1>A clean walkthrough for recording WheelDesk in action.</h1>
          <p>
            This page is a public shot list for the product video. Use it as the anchor for a Loom, OBS, or phone-screen recording,
            then cut to the live app pages once logged in.
          </p>
          <div className="wd-hero-actions">
            <Link href="/login" className="wd-primary-cta">Open App Login</Link>
            <Link href="/faq" className="wd-secondary-cta">FAQ</Link>
          </div>
        </div>

        <aside className="wd-info-card wd-info-callout">
          <span className="wd-info-kicker">60-second hook</span>
          <strong>“Options intelligence with validation receipts.”</strong>
          <p>
            Lead with the Control Center. Close with Validation. That is the strongest product story.
          </p>
        </aside>
      </section>

      <section className="wd-section">
        <div className="wd-info-heading">
          <div className="wd-eyebrow">Shot list</div>
          <h2>Record these screens in this order.</h2>
        </div>

        <div className="wd-demo-timeline">
          {demoSteps.map((step, index) => (
            <article className="wd-info-card wd-demo-step" key={step.title}>
              <span className="wd-step-number">{String(index + 1).padStart(2, "0")}</span>
              <h3>{step.title}</h3>
              <p>{step.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="wd-section wd-split-section">
        <div>
          <div className="wd-eyebrow">Voiceover</div>
          <h2>Use this script for the first demo video.</h2>
          <p>
            Keep it under a minute. Do not over-explain every number. Make users feel the daily workflow.
          </p>
        </div>

        <div className="wd-signal-stack">
          {voiceover.map((line, index) => (
            <div className="wd-signal-row" key={line}>
              <strong>{String(index + 1).padStart(2, "0")}</strong>
              <span>{line}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="wd-final-cta">
        <div>
          <div className="wd-eyebrow">Video note</div>
          <h2>Record from your logged-in Vercel session.</h2>
          <p>
            The protected app pages need your authenticated browser session, so the fastest path is recording locally with Loom or OBS.
          </p>
        </div>
        <Link href="/login" className="wd-primary-cta">Go to Login</Link>
      </section>

      <footer className="wd-landing-footer">
        <span>WheelDesk · thewheeldesk.com</span>
        <span>Demo · Control Center · Validation · Portfolio</span>
      </footer>
    </main>
  );
}
