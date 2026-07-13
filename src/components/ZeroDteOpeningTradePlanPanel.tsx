"use client";

import type React from "react";
import type { ZeroDteStrikeFlowRead } from "../lib/zeroDteStrikeFlow";
import type { ZeroDteTradeSelection } from "../lib/zeroDteTradeSelector";
import type { LockedCreditSpread, ZeroDteOpeningTradePlan } from "../lib/zeroDteOpeningTradePlan";

export function ZeroDteOpeningTradePlanPanel({
  plan,
  liveSelection,
  strikeFlow,
  onReset,
}: {
  plan: ZeroDteOpeningTradePlan | null;
  liveSelection: ZeroDteTradeSelection | null;
  strikeFlow: ZeroDteStrikeFlowRead | null;
  onReset: () => void;
}) {
  if (!plan) return null;

  const liveSide = liveSelection?.creditSpread?.side ?? "none";
  const liveConfidence = liveSelection?.confidence ?? 0;
  const putBlocked = strikeFlow?.putWall.state === "breaking";
  const callBlocked = strikeFlow?.callWall.state === "attacked";
  const readySide = liveConfidence >= 75 && ((liveSide === "put" && !putBlocked) || (liveSide === "call" && !callBlocked)) ? liveSide : "none";
  const status = readySide === "put" ? "PUT SPREAD READY" : readySide === "call" ? "CALL SPREAD READY" : putBlocked || callBlocked ? "DO NOT FADE BREAKOUT" : "WAIT";

  return (
    <section style={styles.card}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Opening Credit-Spread Map — Locked for {plan.tradeDate}</h2>
          <p style={styles.muted}>Opening harvest fixes today&apos;s put and call spreads. Live harvests update execution only; they do not replace these strikes.</p>
        </div>
        <button type="button" onClick={onReset} style={styles.button}>Rebuild Today&apos;s Trade Map</button>
      </div>

      <div style={styles.grid}>
        <PlanCard title="Today's Put Spread" spread={plan.put} ready={readySide === "put"} />
        <PlanCard title="Today's Call Spread" spread={plan.call} ready={readySide === "call"} />
      </div>

      <div style={styles.execution}>
        <div>
          <div style={styles.smallCaps}>Live Execution</div>
          <div style={{ ...styles.status, color: readySide === "put" ? "#34d399" : readySide === "call" ? "#fb7185" : status.includes("DO NOT") ? "#f97316" : "#fde047" }}>{status}</div>
        </div>
        <div style={styles.metrics}>
          <Metric label="Execution confidence" value={`${liveConfidence}%`} />
          <Metric label="Live directional read" value={liveSide === "put" ? "Put" : liveSide === "call" ? "Call" : "None"} />
          <Metric label="Flow guard" value={!strikeFlow?.hasPriorSnapshot ? "Baseline" : `${strikeFlow.callWall.state} / ${strikeFlow.putWall.state}`} />
        </div>
      </div>
    </section>
  );
}

function PlanCard({ title, spread, ready }: { title: string; spread: LockedCreditSpread | null; ready: boolean }) {
  return (
    <div style={{ ...styles.plan, borderColor: ready ? "#67e8f9" : "#1e3a5f" }}>
      <div style={styles.smallCaps}>{title}</div>
      {spread ? (
        <>
          <div style={styles.trade}>SELL {fmt(spread.shortStrike)}{spread.side === "put" ? "P" : "C"} / BUY {fmt(spread.longStrike)}{spread.side === "put" ? "P" : "C"}</div>
          <div style={styles.sub}>{spread.width}-wide · opening credit {spread.openingCredit == null ? "—" : `$${spread.openingCredit.toFixed(2)}`} · opening confidence {spread.openingConfidence}%</div>
          <div style={ready ? styles.ready : styles.wait}>{ready ? "READY" : "LOCKED — WAIT FOR CONFIRMATION"}</div>
        </>
      ) : <div style={styles.muted}>No executable opening candidate was available.</div>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div style={styles.metric}><div style={styles.smallCaps}>{label}</div><div style={styles.metricValue}>{value}</div></div>;
}

function fmt(value: number) { return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value); }

const styles: Record<string, React.CSSProperties> = {
  card: { border: "1px solid rgba(34,211,238,0.35)", background: "#0b1b2b", borderRadius: 18, padding: 18, marginBottom: 16 },
  header: { display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 14 },
  title: { fontSize: 20, fontWeight: 950, margin: "0 0 4px" },
  muted: { color: "#94a3b8", fontSize: 13, lineHeight: 1.45, margin: 0 },
  button: { border: "1px solid #1e3a5f", background: "#07111f", color: "#cbd5e1", borderRadius: 10, padding: "9px 12px", fontWeight: 850, cursor: "pointer" },
  grid: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 },
  plan: { border: "1px solid #1e3a5f", background: "#06111f", borderRadius: 15, padding: 15 },
  smallCaps: { color: "#93b5d9", fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase" },
  trade: { marginTop: 9, color: "#67e8f9", fontSize: 21, fontWeight: 950 },
  sub: { marginTop: 7, color: "#94a3b8", fontSize: 12 },
  ready: { marginTop: 10, color: "#34d399", fontWeight: 950 },
  wait: { marginTop: 10, color: "#fde047", fontWeight: 900 },
  execution: { display: "flex", justifyContent: "space-between", gap: 18, alignItems: "center", border: "1px solid #1e3a5f", background: "#07111f", borderRadius: 15, padding: 15, marginTop: 12 },
  status: { marginTop: 5, fontSize: 24, fontWeight: 950 },
  metrics: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, flex: 1, maxWidth: 620 },
  metric: { border: "1px solid #1e3a5f", borderRadius: 10, padding: 9 },
  metricValue: { marginTop: 4, color: "#f8fafc", fontWeight: 900 },
};
