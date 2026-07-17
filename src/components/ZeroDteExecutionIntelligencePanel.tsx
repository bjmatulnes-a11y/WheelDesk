"use client";

import { useState } from "react";
import type { ZeroDteExecutionRead } from "../lib/zeroDteExecutionIntelligence";

type Props = {
  read: ZeroDteExecutionRead | null;
  quantity: number;
  onOpen: (entryCredit: number, quantity: number) => void;
  onClose: (exitDebit: number) => void;
  onReset: () => void | Promise<void>;
};

export function ZeroDteExecutionIntelligencePanel({ read, quantity, onOpen, onClose, onReset }: Props) {
  const [manualCredit, setManualCredit] = useState("");
  if (!read) return null;
  const activeCredit = Number(manualCredit) > 0 ? Number(manualCredit) : read.currentCredit ?? 0;

  return (
    <section style={styles.panel}>
      <div style={styles.header}>
        <div>
          <div style={styles.eyebrow}>Execution Intelligence</div>
          <h2 style={styles.title}>Iron Fly Sell / Buyback Engine</h2>
          <p style={styles.sub}>Locked map determines where. Live credit, stretch, dealer pressure, and strike flow determine when.</p>
        </div>
        <div style={{ ...styles.state, borderColor: tone(read.lifecycle), color: tone(read.lifecycle) }}>{read.lifecycle.replaceAll("_", " ")}</div>
      </div>

      <div style={styles.scoreGrid}>
        <Score label="IF Sell Score" value={read.sellScore} />
        <Score label="Spring Probability" value={read.springProbability} suffix="%" />
        <Score label="Opportunity Score" value={read.opportunityScore} />
        <Score label="Buyback Score" value={read.buybackScore} muted={!read.position} />
      </div>

      <div style={styles.action}>{read.action}</div>

      <div style={styles.metricGrid}>
        <Metric label="Current IF Credit" value={fmt(read.currentCredit)} />
        <Metric label="Opening Tracked Credit" value={fmt(read.openingCredit)} />
        <Metric label="Peak Tracked Credit" value={fmt(read.peakCredit)} />
        <Metric label="Expansion vs Open" value={pct(read.premiumExpansionPct)} />
        <Metric label="From Peak" value={pct(read.premiumFromPeakPct)} />
        <Metric label="Credit Velocity" value={read.premiumVelocityPerMinute == null ? "—" : `${read.premiumVelocityPerMinute.toFixed(2)} pt/min`} />
        <Metric label="Price Location" value={`${read.edge.toUpperCase()} EDGE`} />
        <Metric label="Expected Magnet" value={fmt(read.expectedMagnet)} />
        <Metric label="Expected Mean Reversion" value={`${read.expectedMeanReversionPoints} pts`} />
        <Metric label="Peak Detector" value={read.peakDetected ? "ROLLOVER DETECTED" : "Tracking"} />
      </div>

      <div style={styles.breakdownGrid}>
        <div style={styles.box}>
          <h3 style={styles.boxTitle}>Sell score breakdown</h3>
          <Break label="Price stretch" value={read.sellBreakdown.priceStretch} max={25} />
          <Break label="Premium expansion" value={read.sellBreakdown.premiumExpansion} max={25} />
          <Break label="Dealer compatibility" value={read.sellBreakdown.dealerPressure} max={15} />
          <Break label="Strike-flow confirmation" value={read.sellBreakdown.strikeFlow} max={15} />
          <Break label="Pin / time quality" value={read.sellBreakdown.pinAndTime} max={20} />
        </div>
        <div style={styles.box}>
          <h3 style={styles.boxTitle}>Why</h3>
          {read.sellReasons.map((reason, index) => <div key={index} style={styles.reason}>• {reason}</div>)}
          {read.position && read.buybackReasons.map((reason, index) => <div key={`buy-${index}`} style={styles.buyReason}>• {reason}</div>)}
        </div>
      </div>

      <div style={styles.controls}>
        <label style={styles.label}>Manual execution credit/debit
          <input value={manualCredit} onChange={(event) => setManualCredit(event.target.value)} type="number" step="0.05" placeholder={read.currentCredit == null ? "enter fill" : read.currentCredit.toFixed(2)} style={styles.input} />
        </label>
        {!read.position ? (
          <button disabled={activeCredit <= 0} onClick={() => onOpen(activeCredit, quantity)} style={styles.openButton}>Mark IF Sold @ {activeCredit > 0 ? activeCredit.toFixed(2) : "—"}</button>
        ) : (
          <button disabled={activeCredit <= 0} onClick={() => onClose(activeCredit)} style={styles.closeButton}>Mark Buyback @ {activeCredit > 0 ? activeCredit.toFixed(2) : "—"}</button>
        )}
        <button onClick={onReset} style={styles.resetButton}>Reload DB Execution Memory</button>
      </div>

      {read.position && (
        <div style={styles.positionBox}>
          <strong>POSITION OPEN:</strong> sold {read.position.quantity} × at {read.position.entryCredit.toFixed(2)} on the {read.position.side} setup. Entry sell score {read.position.entrySellScore}; spring {read.position.entrySpringProbability}%.
        </div>
      )}

      {read.closedTrades.length > 0 && (
        <div style={styles.history}>
          <h3 style={styles.boxTitle}>Recent IF execution memory</h3>
          {read.closedTrades.slice(0, 5).map((trade) => (
            <div key={`${trade.openedAt}-${trade.closedAt}`} style={styles.tradeRow}>
              <span>{new Date(trade.openedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} → {new Date(trade.closedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
              <span>{trade.entryCredit.toFixed(2)} → {trade.exitDebit.toFixed(2)}</span>
              <strong style={{ color: trade.pnlDollars >= 0 ? "#34d399" : "#fb7185" }}>{money(trade.pnlDollars)}</strong>
              <span>{Math.round(trade.durationMinutes)} min</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Score({ label, value, suffix = "", muted = false }: { label: string; value: number; suffix?: string; muted?: boolean }) {
  return <div style={{ ...styles.score, opacity: muted ? 0.45 : 1 }}><div style={styles.scoreLabel}>{label}</div><div style={{ ...styles.scoreValue, color: scoreTone(value) }}>{value}{suffix}</div></div>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div style={styles.metric}><span>{label}</span><strong>{value}</strong></div>; }
function Break({ label, value, max }: { label: string; value: number; max: number }) { return <div style={styles.break}><span>{label}</span><div style={styles.track}><div style={{ ...styles.fill, width: `${Math.min(100, value / max * 100)}%` }} /></div><strong>{value}/{max}</strong></div>; }
function fmt(value: number | null) { return value == null ? "—" : value.toFixed(2); }
function pct(value: number | null) { return value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`; }
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value); }
function scoreTone(value: number) { return value >= 88 ? "#34d399" : value >= 68 ? "#fde047" : "#94a3b8"; }
function tone(state: ZeroDteExecutionRead["lifecycle"]) { return state === "SELL_READY" || state === "BUYBACK_READY" ? "#34d399" : state === "ARMED" || state === "HOLD" ? "#fde047" : state === "COOLDOWN" ? "#67e8f9" : "#94a3b8"; }

const styles: Record<string, React.CSSProperties> = {
  panel: { border: "1px solid rgba(168,85,247,.5)", background: "linear-gradient(145deg,#11172a,#0b1b2b)", borderRadius: 16, padding: 18, marginBottom: 16 },
  header: { display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 14 },
  eyebrow: { color: "#c084fc", fontSize: 11, fontWeight: 900, letterSpacing: ".2em", textTransform: "uppercase" },
  title: { margin: "4px 0", fontSize: 23 }, sub: { margin: 0, color: "#aebfd2", fontSize: 13 },
  state: { border: "1px solid", borderRadius: 999, padding: "8px 13px", fontWeight: 950, fontSize: 12 },
  scoreGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 10 },
  score: { background: "#07111f", border: "1px solid #263a55", borderRadius: 12, padding: 13 },
  scoreLabel: { color: "#91a8c0", textTransform: "uppercase", letterSpacing: ".09em", fontSize: 10, fontWeight: 900 }, scoreValue: { fontSize: 30, fontWeight: 950, marginTop: 4 },
  action: { margin: "12px 0", border: "1px solid rgba(34,211,238,.35)", background: "rgba(14,116,144,.14)", color: "#cffafe", padding: 12, borderRadius: 10, fontWeight: 900 },
  metricGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8 },
  metric: { display: "flex", justifyContent: "space-between", gap: 10, background: "rgba(7,17,31,.65)", border: "1px solid #1d334d", borderRadius: 9, padding: 10, color: "#9fb4ca", fontSize: 12 },
  breakdownGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 10, marginTop: 10 }, box: { background: "#07111f", border: "1px solid #1d334d", borderRadius: 12, padding: 13 }, boxTitle: { margin: "0 0 9px", fontSize: 14 },
  break: { display: "grid", gridTemplateColumns: "145px 1fr 46px", gap: 8, alignItems: "center", fontSize: 11, color: "#b4c5d7", margin: "7px 0" }, track: { height: 7, background: "#17283b", borderRadius: 99, overflow: "hidden" }, fill: { height: "100%", background: "#a855f7" }, reason: { fontSize: 12, color: "#cbd5e1", lineHeight: 1.55 }, buyReason: { fontSize: 12, color: "#86efac", lineHeight: 1.55 },
  controls: { display: "flex", flexWrap: "wrap", alignItems: "end", gap: 9, marginTop: 12 }, label: { display: "grid", gap: 5, color: "#9fb4ca", fontSize: 11, fontWeight: 800 }, input: { background: "#07111f", color: "white", border: "1px solid #334a67", borderRadius: 8, padding: "9px 10px", width: 160 },
  openButton: { background: "#047857", border: "1px solid #34d399", color: "white", borderRadius: 9, padding: "10px 13px", fontWeight: 900 }, closeButton: { background: "#9f1239", border: "1px solid #fb7185", color: "white", borderRadius: 9, padding: "10px 13px", fontWeight: 900 }, resetButton: { background: "#172033", border: "1px solid #475569", color: "#cbd5e1", borderRadius: 9, padding: "10px 13px", fontWeight: 800 },
  positionBox: { marginTop: 10, background: "rgba(16,185,129,.1)", border: "1px solid rgba(52,211,153,.35)", color: "#d1fae5", borderRadius: 10, padding: 11, fontSize: 12 }, history: { marginTop: 12 }, tradeRow: { display: "grid", gridTemplateColumns: "1.4fr 1fr .8fr .6fr", gap: 8, padding: "8px 0", borderTop: "1px solid #20334b", color: "#b8c8d8", fontSize: 12 },
};
