import Link from "next/link";

export const metadata = {
  title: "Contact WheelDesk",
  description:
    "Contact WheelDesk for founder access, support, data partnerships, billing questions, and product feedback.",
};

const contactCards = [
  {
    label: "Founder access",
    title: "Questions before joining?",
    body:
      "Ask about founder access, product roadmap, beta limitations, supported tickers, and how the daily Watchlist Command flow works.",
    href: "mailto:support@thewheeldesk.com?subject=WheelDesk%20Founder%20Access%20Question",
    cta: "Email Founder Access",
  },
  {
    label: "Support",
    title: "Login, billing, or account help",
    body:
      "Use this for account access, Stripe billing, mobile install questions, or issues inside the Control Center, Watchlist, Validation, Wheel, or Portfolio pages.",
    href: "mailto:support@thewheeldesk.com?subject=WheelDesk%20Support%20Request",
    cta: "Email Support",
  },
  {
    label: "Partnerships",
    title: "Data, research, or platform partnerships",
    body:
      "Use this for data-provider conversations, API partnerships, affiliate discussions, enterprise interest, or acquisition / strategic inquiries.",
    href: "mailto:founder@thewheeldesk.com?subject=WheelDesk%20Partnership%20Inquiry",
    cta: "Email Partnerships",
  },
];

const routingNotes = [
  "WheelDesk is analytical software and does not provide individualized financial advice.",
  "Do not send sensitive brokerage credentials or private account statements by email.",
  "For support, include the page, ticker, browser/device, and a short description of what happened.",
];

export default function ContactPage() {
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

        <nav className="wd-landing-links" aria-label="Contact page navigation">
          <Link href="/pricing">Pricing</Link>
          <Link href="/demo">Demo</Link>
          <Link href="/faq">FAQ</Link>
          <Link href="/about">About</Link>
          <Link href="/login">Login</Link>
        </nav>
      </header>

      <section className="wd-section wd-info-hero">
        <div>
          <div className="wd-eyebrow">Contact WheelDesk</div>
          <h1>Questions, support, partnerships, or founder access.</h1>
          <p>
            WheelDesk is being built as an options market-structure control system for active traders.
            Reach out for founder access, product feedback, support, billing questions, or data/vendor conversations.
          </p>
          <div className="wd-hero-actions">
            <a className="wd-primary-cta" href="mailto:support@thewheeldesk.com?subject=WheelDesk%20Question">
              Email WheelDesk
            </a>
            <Link href="/pricing" className="wd-secondary-cta">View Plans</Link>
          </div>
        </div>

        <aside className="wd-info-card wd-info-callout">
          <span className="wd-info-kicker">Best first contact</span>
          <strong>support@thewheeldesk.com</strong>
          <p>
            For launch/beta support, include your account email, the ticker or page involved,
            and whether you were on desktop, iPhone, Android, or installed PWA mode.
          </p>
        </aside>
      </section>

      <section className="wd-section">
        <div className="wd-info-heading">
          <div className="wd-eyebrow">Route the message</div>
          <h2>Send the right question to the right lane.</h2>
        </div>

        <div className="wd-info-grid">
          {contactCards.map((card) => (
            <article className="wd-info-card" key={card.title}>
              <span className="wd-info-kicker">{card.label}</span>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
              <a className="wd-secondary-cta" href={card.href}>{card.cta}</a>
            </article>
          ))}
        </div>
      </section>

      <section className="wd-section wd-split-section">
        <div>
          <div className="wd-eyebrow">Before sending</div>
          <h2>Keep the contact channel clean and useful.</h2>
          <p>
            WheelDesk support is for product, data, account, and billing questions. Trading decisions remain the user’s responsibility.
          </p>
        </div>

        <div className="wd-signal-stack">
          {routingNotes.map((note, index) => (
            <div className="wd-signal-row" key={note}>
              <strong>{String(index + 1).padStart(2, "0")}</strong>
              <span>{note}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="wd-final-cta">
        <div>
          <div className="wd-eyebrow">Founder access</div>
          <h2>Want to help shape the daily options control room?</h2>
          <p>
            Founder users help harden Watchlist Command, Control Center, Chart Room, Wheel tools,
            Portfolio, Validation receipts, and the data-provider roadmap.
          </p>
        </div>
        <Link href="/pricing" className="wd-primary-cta">View Founder Access</Link>
      </section>

      <footer className="wd-landing-footer">
        <span>WheelDesk · thewheeldesk.com</span>
        <span>Contact · Pricing · Demo · FAQ · About</span>
      </footer>
    </main>
  );
}