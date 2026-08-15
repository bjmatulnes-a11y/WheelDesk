import Link from "next/link";

export const metadata = {
  title: "WheelDesk FAQ",
  description:
    "Frequently asked questions about WheelDesk, options market structure, validation, mobile install, data, login, and risk disclosures.",
};

const faqs = [
  {
    question: "What is WheelDesk?",
    answer:
      "WheelDesk is an options intelligence and portfolio risk control center for active traders. It combines open-interest structure, implied-volatility context, dealer pressure, validation tools, and wheel-strategy decision support.",
  },
  {
    question: "Who is WheelDesk built for?",
    answer:
      "WheelDesk is built for traders who actively manage options positions, especially premium sellers, wheel traders, covered-call managers, and traders who care about where option-chain structure may influence price behavior.",
  },
  {
    question: "What is the Control Center?",
    answer:
      "The Control Center is the main daily read. It pulls together OI surface context, selected expiration-chain levels, IV bands, dealer pressure, wall migration, and flow intelligence into one operating view.",
  },
  {
    question: "What does Validation do?",
    answer:
      "Validation compares prior projected OI paths and structural levels against realized candles. The goal is to show whether the model has been useful historically instead of asking users to blindly trust a signal.",
  },
  {
    question: "Does WheelDesk make trade recommendations?",
    answer:
      "WheelDesk is a decision-support and research tool. It can help organize market structure and portfolio risk, but users remain responsible for their own trades. It is not individualized financial advice.",
  },
  {
    question: "What does dealer pressure mean inside WheelDesk?",
    answer:
      "Dealer pressure is a readout of how option-chain positioning may create pinning, unlock, or neutralization zones. It is intended to provide context, not certainty.",
  },
  {
    question: "Why do some values show N/A?",
    answer:
      "N/A usually means the required data was not available from the current provider, the selected chain did not have enough rows, the ticker was not loaded yet, or the metric needs historical snapshots that have not been captured.",
  },
  {
    question: "Where does the data come from?",
    answer:
      "The current app can use market-data endpoints and Supabase-backed storage for option-chain surfaces, candles, and validation records. Some data quality depends on the provider and what has already been saved.",
  },
  {
    question: "Can I install WheelDesk on my phone?",
    answer:
      "Yes. The current mobile path is a PWA. On iPhone, open the site in Safari, tap Share, then Add to Home Screen. On Android, use Chrome and choose Install app or Add to Home Screen.",
  },
  {
    question: "Is there a native iPhone app?",
    answer:
      "Not yet. The PWA is the first mobile product. A native iPhone app can come later after login, account state, billing, and the core data flow are stable.",
  },
  {
    question: "Why is the product focused on receipts?",
    answer:
      "Most trading tools make claims. WheelDesk is being built to preserve prior reads and compare them against what happened later, so the edge can be inspected instead of assumed.",
  },
  {
    question: "Is WheelDesk financial advice?",
    answer:
      "No. WheelDesk is educational and analytical software. It does not guarantee outcomes, returns, or suitability for any user’s financial situation. Options involve risk and can result in substantial losses.",
  },
];

export default function FAQPage() {
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

        <nav className="wd-landing-links" aria-label="FAQ page navigation">
          <Link href="/about">About</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/login">Login</Link>
          <Link href="/signup">Create Account</Link>
        </nav>
      </header>

      <section className="wd-section wd-info-hero">
        <div>
          <div className="wd-eyebrow">Frequently asked questions</div>
          <h1>What WheelDesk is, how it works, and what it is not.</h1>
          <p>
            Use this page to explain the product clearly before traders create an account. The language is built to be credible,
            not hype-driven.
          </p>
        </div>

        <aside className="wd-info-card wd-disclaimer-card">
          <span className="wd-info-kicker">Important disclosure</span>
          <strong>WheelDesk is not financial advice.</strong>
          <p>
            Options trading involves risk. WheelDesk provides analytics, structure, and validation context; users make their own decisions.
          </p>
        </aside>
      </section>

      <section className="wd-section">
        <div className="wd-faq-stack">
          {faqs.map((faq, index) => (
            <details className="wd-faq-item" key={faq.question} open={index < 3}>
              <summary>{faq.question}</summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="wd-final-cta">
        <div>
          <div className="wd-eyebrow">Still evaluating?</div>
          <h2>Choose the WheelDesk that fits how you trade.</h2>
          <p>
            Compare WheelDesk and WheelDesk Command, then create an account when you are ready to use the platform.
          </p>
        </div>
        <Link href="/pricing" className="wd-primary-cta">View Pricing</Link>
      </section>

      <footer className="wd-landing-footer">
        <span>WheelDesk · thewheeldesk.com</span>
        <span>FAQ · About · Pricing · Contact</span>
      </footer>
    </main>
  );
}
