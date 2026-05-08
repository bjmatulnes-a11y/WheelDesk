import Link from "next/link";

export default function LandingPage() {
  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "3rem 1rem", fontFamily: "Inter, sans-serif" }}>
      <h1>WheelDesk</h1>
      <p>Decision support for covered calls, cash-secured puts, and wheel portfolio management.</p>

      <div style={{ marginTop: "1rem", display: "flex", gap: "0.75rem" }}>
        <Link href="/dashboard" style={{ padding: "0.6rem 1rem", border: "1px solid #ddd", borderRadius: 6 }}>
          Open Dashboard
        </Link>
        <Link href="/dashboard/wheel" style={{ padding: "0.6rem 1rem", border: "1px solid #111", borderRadius: 6 }}>
          Open Wheel Workspace
        </Link>
          {/* <Link href="/dashboard/zero-dte" style={{ padding: "0.6rem 1rem", border: "1px solid #111", borderRadius: 6 }}>
          0DTE Workspace
        </Link>*/}
      </div>

      <section style={{ marginTop: "2rem" }}>
        <h2>Why traders switch</h2>
        <ul>
          <li>Ranked call/put candidates aligned to your rules</li>
          <li>Roll alerts with explicit tradeoffs</li>
          <li>Wheel cycle income tracking and assignment context</li>
        </ul>
      </section>

      <section style={{ marginTop: "2rem", padding: "1rem", border: "1px solid #ddd", borderRadius: 8 }}>
        <h2>Join the founding cohort</h2>
        <p>Get early access and locked founding pricing.</p>
        <form method="post" action="/api/waitlist">
          <input
            type="email"
            name="email"
            placeholder="you@domain.com"
            required
            style={{ padding: "0.6rem", minWidth: 280, marginRight: "0.5rem" }}
          />
          <button type="submit" style={{ padding: "0.6rem 1rem" }}>Join Waitlist</button>
        </form>
      </section>
    </main>
  );
}
