"use client";

import Link from "next/link";
import { useState } from "react";

const waitlistStorageKey = "wheeldesk_waitlist_email";

export default function LandingPage() {
  const [email, setEmail] = useState("");
  const [waitlistStatus, setWaitlistStatus] = useState("");

  function handleJoinWaitlist() {
    const normalized = email.trim();

    if (!normalized || !normalized.includes("@")) {
      setWaitlistStatus("Enter a valid email to join the founding cohort.");
      return;
    }

    try {
      localStorage.setItem(waitlistStorageKey, normalized);
    } catch {
      // Non-blocking local capture only.
    }

    setWaitlistStatus("Saved. Founding cohort access request captured locally.");
    setEmail("");
  }

  return (
    <main style={styles.page}>
      <div style={styles.glowOne} />
      <div style={styles.glowTwo} />

      <header style={styles.nav}>
        <Link href="/" style={styles.brand}>
          <span style={styles.logo}>W</span>
          <span>
            <span style={styles.brandName}>WheelDesk</span>
            <span style={styles.brandSub}>OPTIONS CONTROL SYSTEM</span>
          </span>
        </Link>

        <nav style={styles.navLinks}>
          <Link href="/dashboard" style={styles.navLink}>Dashboard</Link>
          <Link href="/control-center" style={styles.navLink}>Control Center</Link>
          <Link href="/portfolio" style={styles.navLink}>Portfolio</Link>
          <Link href="/dashboard/scanner" style={styles.navLink}>Scanner</Link>
        </nav>
      </header>

      <section style={styles.hero}>
        <div style={styles.heroCopy}>
          <div style={styles.eyebrow}>Built for wheel traders, covered-call managers, and OI-driven operators</div>

          <h1 style={styles.title}>
            Turn option-chain chaos into a daily trading control center.
          </h1>

          <p style={styles.subtitle}>
            WheelDesk combines portfolio exposure, option surface snapshots, OI structure,
            dealer pressure, and ticker-level market intelligence into one operating system
            for disciplined premium selling.
          </p>

          <div style={styles.ctaRow}>
            <Link href="/dashboard" style={styles.primaryCta}>Open Dashboard</Link>
            <Link href="/control-center" style={styles.secondaryCta}>View Control Center</Link>
          </div>

          <div style={styles.proofRow}>
            <Metric label="Snapshot mode" value="Supabase-first" />
            <Metric label="Normal batch" value="10 tickers" />
            <Metric label="Premium lane" value="^SPX" />
          </div>
        </div>

        <div style={styles.terminal}>
          <div style={styles.terminalHeader}>
            <span style={styles.dotCyan} />
            <span style={styles.dotGreen} />
            <span style={styles.dotPink} />
            <span style={styles.terminalTitle}>WheelDesk Operator Console</span>
          </div>

          <div style={styles.statusGrid}>
            <StatusCard label="Current State" value="Bullish Unlock Watch" accent="#22d3ee" />
            <StatusCard label="Optimal Action" value="Wait / Repair" accent="#c084fc" />
            <StatusCard label="Bullish Trigger" value="20.09" accent="#34d399" />
            <StatusCard label="Bearish Failure" value="14.91" accent="#fb7185" />
          </div>

          <div style={styles.fakeChart}>
            <div style={{ ...styles.chartLine, top: "24%", background: "#ef4444" }} />
            <div style={{ ...styles.chartLine, top: "42%", background: "#22d3ee" }} />
            <div style={{ ...styles.chartLine, top: "58%", background: "#a855f7" }} />
            <div style={{ ...styles.chartLine, top: "72%", background: "#f59e0b" }} />

            {Array.from({ length: 36 }).map((_, index) => {
              const height = 26 + ((index * 11) % 48);
              const up = index % 4 !== 0;

              return (
                <span
                  key={index}
                  style={{
                    ...styles.candle,
                    height,
                    left: `${4 + index * 2.55}%`,
                    bottom: `${18 + ((index * 7) % 38)}%`,
                    background: up ? "#22c55e" : "#ef4444",
                  }}
                />
              );
            })}

            <span style={{ ...styles.priceTag, top: "22%", right: 18, background: "#ef4444" }}>Call Wall</span>
            <span style={{ ...styles.priceTag, top: "40%", right: 18, background: "#0891b2" }}>IV Upper</span>
            <span style={{ ...styles.priceTag, top: "56%", right: 18, background: "#9333ea" }}>OI Magnet</span>
          </div>
        </div>
      </section>

      <section style={styles.pillars}>
        <FeatureCard
          title="Snapshot Harvest"
          detail="Batch up to 10 normal tickers, save option surfaces directly to Supabase, and keep local storage as UI state only."
          number="01"
        />
        <FeatureCard
          title="Portfolio Monitor"
          detail="Aggregate positions across portfolios into a broker-style statement with DTE, open P/L, theta, delta, and BP estimate."
          number="02"
        />
        <FeatureCard
          title="Control Center"
          detail="Move OI surface, IV bands, dealer pressure, rail levels, and strategy cards into a dedicated analysis cockpit."
          number="03"
        />
      </section>

      <section style={styles.dataSection}>
        <div>
          <div style={styles.eyebrow}>Data-centric architecture</div>
          <h2 style={styles.sectionTitle}>Market snapshots are shared. User portfolios stay private.</h2>
          <p style={styles.sectionText}>
            WheelDesk is designed around a platform-level market data archive. When AAPL,
            SOFI, SPY, or ^SPX is harvested once, eligible users can query the same historical
            surface without duplicating the payload in every browser.
          </p>
        </div>

        <div style={styles.tierGrid}>
          <Tier title="Starter" rows={["5 tickers", "30-day history", "No premium index chains"]} />
          <Tier title="Core" rows={["10 tickers", "60-day history", "SPY / QQQ ready"]} highlight />
          <Tier title="Research" rows={["^SPX premium lane", "Longer archive", "Validation tools"]} />
        </div>
      </section>

      <section style={styles.waitlist}>
        <div>
          <h2 style={styles.waitlistTitle}>Join the founding cohort</h2>
          <p style={styles.sectionText}>
            Get early access while WheelDesk is moving from local trading tool to shared
            market-structure archive.
          </p>
        </div>

        <div style={styles.waitlistForm}>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@domain.com"
            style={styles.emailInput}
          />
          <button type="button" onClick={handleJoinWaitlist} style={styles.waitlistButton}>
            Join Waitlist
          </button>
          {waitlistStatus ? <div style={styles.waitlistStatus}>{waitlistStatus}</div> : null}
        </div>
      </section>

      <footer style={styles.footer}>
        <span>WheelDesk · thewheeldesk.com</span>
        <span>Dashboard · Portfolio · Control Center · Snapshot Harvest</span>
      </footer>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.metric}>
      <span style={styles.metricLabel}>{label}</span>
      <strong style={styles.metricValue}>{value}</strong>
    </div>
  );
}

function StatusCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{ ...styles.statusCard, borderLeftColor: accent }}>
      <div style={{ color: accent, fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {label}
      </div>
      <div style={styles.statusValue}>{value}</div>
    </div>
  );
}

function FeatureCard({ title, detail, number }: { title: string; detail: string; number: string }) {
  return (
    <div style={styles.featureCard}>
      <div style={styles.featureNumber}>{number}</div>
      <h3 style={styles.featureTitle}>{title}</h3>
      <p style={styles.featureText}>{detail}</p>
    </div>
  );
}

function Tier({ title, rows, highlight }: { title: string; rows: string[]; highlight?: boolean }) {
  return (
    <div style={{ ...styles.tier, ...(highlight ? styles.tierHighlight : null) }}>
      <h3 style={styles.tierTitle}>{title}</h3>
      <ul style={styles.tierList}>
        {rows.map((row) => (
          <li key={row}>{row}</li>
        ))}
      </ul>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background:
      "radial-gradient(circle at top left, rgba(34, 211, 238, 0.16), transparent 30%), radial-gradient(circle at 80% 20%, rgba(168, 85, 247, 0.12), transparent 28%), #050d17",
    color: "#e5f2ff",
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    overflow: "hidden",
    position: "relative",
  },
  glowOne: {
    position: "absolute",
    width: 420,
    height: 420,
    borderRadius: 999,
    background: "rgba(34, 211, 238, 0.08)",
    filter: "blur(40px)",
    top: -180,
    left: -100,
  },
  glowTwo: {
    position: "absolute",
    width: 460,
    height: 460,
    borderRadius: 999,
    background: "rgba(59, 130, 246, 0.07)",
    filter: "blur(50px)",
    right: -160,
    top: 160,
  },
  nav: {
    position: "relative",
    zIndex: 1,
    maxWidth: 1200,
    margin: "0 auto",
    padding: "24px 24px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    color: "#fff",
    textDecoration: "none",
  },
  logo: {
    width: 34,
    height: 34,
    borderRadius: 999,
    border: "1px solid #22d3ee",
    background: "#0b3a46",
    color: "#67e8f9",
    display: "grid",
    placeItems: "center",
    fontWeight: 900,
  },
  brandName: {
    display: "block",
    fontSize: 21,
    fontWeight: 900,
    letterSpacing: "-0.04em",
  },
  brandSub: {
    display: "block",
    color: "#8fb8d1",
    fontSize: 10,
    letterSpacing: "0.16em",
    marginTop: 1,
  },
  navLinks: {
    display: "flex",
    gap: 16,
    alignItems: "center",
  },
  navLink: {
    color: "#b8cce0",
    textDecoration: "none",
    fontWeight: 700,
    fontSize: 13,
  },
  hero: {
    position: "relative",
    zIndex: 1,
    maxWidth: 1200,
    margin: "0 auto",
    padding: "58px 24px 42px",
    display: "grid",
    gridTemplateColumns: "1fr 1.05fr",
    gap: 34,
    alignItems: "center",
  },
  heroCopy: {
    display: "grid",
    gap: 20,
  },
  eyebrow: {
    color: "#22d3ee",
    fontSize: 12,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.14em",
  },
  title: {
    margin: 0,
    fontSize: 58,
    lineHeight: 0.95,
    letterSpacing: "-0.07em",
    maxWidth: 620,
  },
  subtitle: {
    margin: 0,
    color: "#b8cce0",
    fontSize: 17,
    lineHeight: 1.55,
    maxWidth: 640,
  },
  ctaRow: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
  },
  primaryCta: {
    background: "#22d3ee",
    color: "#03121e",
    padding: "12px 16px",
    borderRadius: 10,
    textDecoration: "none",
    fontWeight: 900,
    boxShadow: "0 0 24px rgba(34, 211, 238, 0.22)",
  },
  secondaryCta: {
    background: "rgba(8, 24, 39, 0.9)",
    color: "#e5f2ff",
    padding: "12px 16px",
    borderRadius: 10,
    textDecoration: "none",
    fontWeight: 900,
    border: "1px solid #24465d",
  },
  proofRow: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 10,
    maxWidth: 560,
  },
  metric: {
    border: "1px solid #20384d",
    background: "rgba(8, 20, 34, 0.82)",
    borderRadius: 12,
    padding: "12px 13px",
  },
  metricLabel: {
    display: "block",
    color: "#7ea6c3",
    fontSize: 11,
    marginBottom: 6,
  },
  metricValue: {
    display: "block",
    color: "#fff",
    fontSize: 16,
  },
  terminal: {
    border: "1px solid #24465d",
    borderRadius: 18,
    background: "linear-gradient(180deg, rgba(10, 25, 41, 0.96), rgba(5, 13, 23, 0.98))",
    boxShadow: "0 30px 80px rgba(0, 0, 0, 0.38)",
    overflow: "hidden",
  },
  terminalHeader: {
    height: 42,
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "0 14px",
    borderBottom: "1px solid #1e3448",
    background: "rgba(8, 20, 34, 0.92)",
  },
  dotCyan: { width: 9, height: 9, borderRadius: 99, background: "#22d3ee" },
  dotGreen: { width: 9, height: 9, borderRadius: 99, background: "#22c55e" },
  dotPink: { width: 9, height: 9, borderRadius: 99, background: "#fb7185" },
  terminalTitle: {
    marginLeft: 8,
    color: "#9bb9ce",
    fontSize: 12,
    fontWeight: 800,
  },
  statusGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 10,
    padding: 14,
  },
  statusCard: {
    border: "1px solid #20384d",
    borderLeft: "4px solid",
    background: "#071523",
    borderRadius: 12,
    padding: "14px 14px",
  },
  statusValue: {
    marginTop: 8,
    color: "#fff",
    fontWeight: 900,
    fontSize: 19,
  },
  fakeChart: {
    height: 330,
    margin: "0 14px 14px",
    border: "1px solid #20384d",
    borderRadius: 14,
    background:
      "linear-gradient(#132235 1px, transparent 1px), linear-gradient(90deg, #132235 1px, transparent 1px), #07111f",
    backgroundSize: "100% 52px, 72px 100%",
    position: "relative",
    overflow: "hidden",
  },
  chartLine: {
    position: "absolute",
    left: 18,
    right: 18,
    height: 2,
    opacity: 0.8,
  },
  candle: {
    position: "absolute",
    width: 5,
    borderRadius: 2,
  },
  priceTag: {
    position: "absolute",
    color: "#fff",
    fontSize: 11,
    fontWeight: 900,
    padding: "4px 6px",
    borderRadius: 4,
  },
  pillars: {
    position: "relative",
    zIndex: 1,
    maxWidth: 1200,
    margin: "0 auto",
    padding: "18px 24px 42px",
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 16,
  },
  featureCard: {
    border: "1px solid #20384d",
    background: "rgba(8, 20, 34, 0.82)",
    borderRadius: 16,
    padding: 20,
  },
  featureNumber: {
    color: "#22d3ee",
    fontWeight: 900,
    fontSize: 12,
    marginBottom: 24,
  },
  featureTitle: {
    margin: 0,
    fontSize: 22,
  },
  featureText: {
    color: "#a9bfd1",
    lineHeight: 1.45,
    marginBottom: 0,
  },
  dataSection: {
    position: "relative",
    zIndex: 1,
    maxWidth: 1200,
    margin: "0 auto",
    padding: "18px 24px 46px",
    display: "grid",
    gridTemplateColumns: "0.9fr 1.1fr",
    gap: 24,
    alignItems: "start",
  },
  sectionTitle: {
    margin: "10px 0",
    fontSize: 38,
    lineHeight: 1,
    letterSpacing: "-0.05em",
  },
  sectionText: {
    color: "#b8cce0",
    lineHeight: 1.55,
    margin: 0,
  },
  tierGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 12,
  },
  tier: {
    border: "1px solid #20384d",
    borderRadius: 15,
    background: "rgba(8, 20, 34, 0.78)",
    padding: 18,
  },
  tierHighlight: {
    borderColor: "#22d3ee",
    boxShadow: "0 0 28px rgba(34, 211, 238, 0.12)",
  },
  tierTitle: {
    marginTop: 0,
    fontSize: 20,
  },
  tierList: {
    margin: 0,
    paddingLeft: 18,
    color: "#b8cce0",
    lineHeight: 1.7,
  },
  waitlist: {
    position: "relative",
    zIndex: 1,
    maxWidth: 1200,
    margin: "0 auto 38px",
    padding: 24,
    border: "1px solid #24465d",
    borderRadius: 18,
    background: "rgba(8, 20, 34, 0.82)",
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 20,
    alignItems: "center",
  },
  waitlistTitle: {
    margin: "0 0 8px",
    fontSize: 30,
    letterSpacing: "-0.04em",
  },
  waitlistForm: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: 10,
  },
  emailInput: {
    border: "1px solid #24465d",
    background: "#06111f",
    color: "#e5f2ff",
    borderRadius: 10,
    padding: "12px 13px",
    outline: "none",
  },
  waitlistButton: {
    border: 0,
    background: "#22d3ee",
    color: "#03121e",
    borderRadius: 10,
    padding: "12px 16px",
    fontWeight: 900,
    cursor: "pointer",
  },
  waitlistStatus: {
    gridColumn: "1 / -1",
    color: "#3dff9a",
    fontSize: 12,
    fontWeight: 800,
  },
  footer: {
    position: "relative",
    zIndex: 1,
    maxWidth: 1200,
    margin: "0 auto",
    padding: "0 24px 30px",
    display: "flex",
    justifyContent: "space-between",
    color: "#7895ab",
    fontSize: 12,
  },
};
