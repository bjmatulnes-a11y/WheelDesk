import { evaluateRollDecision } from "../../../lib/analytics/rollDecision";
import { summarizeWheelCycle, type WheelEvent } from "../../../lib/analytics/wheelTracker";

const sampleEvents: WheelEvent[] = [
  { date: "2026-04-01", symbol: "AAPL", event: "SELL_PUT", premium: 220 },
  { date: "2026-04-19", symbol: "AAPL", event: "ASSIGNED" },
  { date: "2026-04-20", symbol: "AAPL", event: "SELL_CALL", premium: 180 },
];

export default function WheelWorkspacePage() {
  const summary = summarizeWheelCycle(sampleEvents);
  const roll = evaluateRollDecision({ currentDelta: 0.44, dte: 6, ivPercentile: 72, earningsSoon: false });

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "2rem 1rem" }}>
      <h1>Wheel Workspace</h1>
      <p>This is the place to manage wheel cycles, assignment context, and roll decisions.</p>

      <section style={{ marginTop: "1rem", border: "1px solid #e5e7eb", borderRadius: 8, padding: "1rem", background: "#fff" }}>
        <h2>Current Cycle Snapshot</h2>
        <p><strong>Symbol:</strong> {summary.symbol}</p>
        <p><strong>State:</strong> {summary.state}</p>
        <p><strong>Total Premium:</strong> ${summary.totalPremium.toFixed(2)}</p>
        <p><strong>Assignments:</strong> {summary.assignments} | <strong>Called Away:</strong> {summary.calledAway}</p>
      </section>

      <section style={{ marginTop: "1rem", border: "1px solid #e5e7eb", borderRadius: 8, padding: "1rem", background: "#fff" }}>
        <h2>Roll Assistant (Example)</h2>
        <p><strong>Suggested Action:</strong> {roll.action}</p>
        <ul>
          {roll.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
