"use client";

import { useState } from "react";
import type React from "react";
import type {
  ExecutionLeg,
  ZeroDteExecutionRead,
} from "../lib/zeroDteExecutionIntelligence";

type Props = {
  read: ZeroDteExecutionRead | null;
  quantity?: number;
  onOpen?: (entryCredit: number, quantity: number) => void | Promise<void>;
  onClose?: (exitDebit: number) => void | Promise<void>;
  onReset?: () => void | Promise<void>;
  readOnly?: boolean;
};

export function ZeroDteExecutionIntelligencePanel({
  read,
  quantity = 1,
  onOpen,
  onClose,
  onReset,
  readOnly = false,
}: Props) {
  const [manualCredit, setManualCredit] = useState("");
  if (!read) return null;

  const activeCredit =
    Number(manualCredit) >= 0 && manualCredit.trim() !== ""
      ? Number(manualCredit)
      : read.currentCredit ?? 0;
  const canOpen =
    Boolean(read.candidate) &&
    activeCredit > 0 &&
    (read.lifecycle === "ARMED" || read.lifecycle === "SELL_READY") &&
    !read.position;
  const canClose = Boolean(read.position) && activeCredit >= 0;
  const hasTrackedSetup = Boolean(read.position || read.candidate);
  const sessionClosed = read.timeRegime.regime === "CLOSED";

  return (
    <section style={styles.panel}>
      <div style={styles.header}>
        <div>
          <div style={styles.eyebrow}>Layer 6D · Time-Aware Execution Lifecycle</div>
          <h2 style={styles.title}>Iron Fly + Credit Spread Execution</h2>
          <p style={styles.sub}>
            Scanner discovery, stable candidate tracking, exact-strike premium history, portfolio acceptance, and buyback management.
          </p>
        </div>
        <div
          style={{
            ...styles.state,
            borderColor: tone(read.lifecycle, read.emergencyExit),
            color: tone(read.lifecycle, read.emergencyExit),
          }}
        >
          {read.lifecycle.replaceAll("_", " ")}
        </div>
      </div>

      <div style={styles.strategyBanner}>
        <div>
          <div style={styles.smallCaps}>{read.position ? "Managed Position" : "Tracked Execution Setup"}</div>
          <div style={styles.strategyName}>
            {hasTrackedSetup ? read.strategyLabel : "No tracked setup"}
          </div>
          <div style={styles.legs}>
            {hasTrackedSetup
              ? formatLegs(read.position?.legs ?? read.candidate?.legs ?? [])
              : "The scanner has not produced a watchable exact strike set."}
          </div>
        </div>
        <div style={styles.mapRead}>
          <span>{sessionClosed ? "EOD FROZEN" : read.mapPhase}</span>
          <strong>{read.railBreached === "NONE" ? "Rails Holding" : `${read.railBreached} Rail Breached`}</strong>
          <small>Center {read.mapCenter.toFixed(0)}</small>
          <small>{read.timeRegime.label} · {read.timeRegime.centralTime} CT</small>
        </div>
      </div>

      <div style={styles.scoreGrid}>
        <Score label="Entry Readiness" value={read.entryScore} muted={Boolean(read.position) || !hasTrackedSetup} />
        <Score label="Exit Readiness" value={read.exitScore} muted={!read.position} />
        <Score label={read.position ? "Active Exit Readiness" : "Active Entry Readiness"} value={read.confidence} muted={!hasTrackedSetup} />
        <Score label="Emergency Exit" value={read.emergencyExit ? 100 : 0} muted={!read.emergencyExit} />
      </div>

      <div style={styles.trackingGrid}>
        <Metric label="Time Regime" value={read.timeRegime.label.toUpperCase()} />
        <Metric label="Tracking State" value={read.trackingStatus?.replaceAll("_", " ") ?? "NO TRACK"} />
        <Metric label="Candidate Age" value={hasTrackedSetup ? `${read.candidateAgeCandles} candle${read.candidateAgeCandles === 1 ? "" : "s"}` : "—"} />
        <Metric label="Scanner Score" value={read.scannerScore == null ? "—" : String(Math.round(read.scannerScore))} />
        <Metric label="Premium Tape" value={`${read.premiumSampleCount} points`} />
        <Metric label="Entry Gate" value={`${Math.round(read.entryScore)}/${Math.round(read.minimumEntryScore)}`} />
        <Metric label="Trigger" value={read.regimeTriggerReady ? "READY" : "BUILDING"} />
        <Metric label="Hard Block" value={read.entryHardBlocked ? "YES" : "NO"} />
      </div>

      <div
        style={{
          ...styles.action,
          borderColor: read.emergencyExit ? "rgba(251,113,133,.65)" : "#1d4863",
          color: read.emergencyExit ? "#fecdd3" : "#d9f6ff",
        }}
      >
        {read.action}
      </div>

      <div style={styles.metricGrid}>
        <Metric label="Current Credit / Debit" value={fmt(read.currentCredit)} />
        <Metric label="Setup Opening Credit" value={fmt(read.openingCredit)} />
        <Metric label="Tracked Peak" value={fmt(read.peakCredit)} />
        <Metric label="Entry Fill" value={fmt(read.entryCredit)} />
        <Metric label="Expansion vs Open" value={pct(read.premiumExpansionPct)} />
        <Metric label="From Peak" value={pct(read.premiumFromPeakPct)} />
        <Metric
          label="Credit Velocity"
          value={
            read.premiumVelocityPerMinute == null
              ? "—"
              : `${signed(read.premiumVelocityPerMinute, 3)} pt/min`
          }
        />
        <Metric label="Captured Premium" value={pct(read.capturedPremiumPct)} />
        <Metric label="Live P/L" value={money(read.livePnlDollars)} tone={pnlTone(read.livePnlDollars)} />
        <Metric label="Max Risk / Contract" value={money(read.maxRiskDollars)} />
        <Metric label="Price Location" value={`${read.edge.toUpperCase()} EDGE`} />
        <Metric label="Peak Detector" value={read.peakDetected ? "ROLLOVER" : "TRACKING"} />
      </div>

      <div style={styles.breakdownGrid}>
        <div style={styles.box}>
          <h3 style={styles.boxTitle}>{read.position ? "Exit readiness breakdown" : "Entry readiness breakdown"}</h3>
          {read.components.length ? (
            read.components.map((component) => (
              <Break
                key={component.key}
                label={component.label}
                value={component.value}
                max={component.max}
                reason={component.reason}
              />
            ))
          ) : (
            <div style={styles.muted}>
              No exact tracked setup is available, so WheelDesk is not manufacturing a readiness score from unrelated market inputs.
            </div>
          )}
        </div>

        <div style={styles.box}>
          <h3 style={styles.boxTitle}>Why</h3>
          {read.reasons.length ? (
            read.reasons.map((reason, index) => (
              <div key={`${reason}-${index}`} style={styles.reason}>• {reason}</div>
            ))
          ) : (
            <div style={styles.muted}>The execution stack is still building.</div>
          )}
          {read.warnings.map((warning, index) => (
            <div key={`${warning}-${index}`} style={styles.warning}>• {warning}</div>
          ))}
        </div>
      </div>

      {!readOnly ? (
        <div style={styles.controls}>
          <label style={styles.label}>
            Manual execution credit / debit
            <input
              value={manualCredit}
              onChange={(event) => setManualCredit(event.target.value)}
              type="number"
              step="0.05"
              min="0"
              placeholder={
                read.currentCredit == null ? "enter fill" : read.currentCredit.toFixed(2)
              }
              style={styles.input}
            />
          </label>

          {!read.position ? (
            <button
              disabled={!canOpen || !onOpen}
              onClick={() => onOpen?.(activeCredit, Math.max(1, quantity))}
              style={{
                ...styles.openButton,
                opacity: canOpen && onOpen ? 1 : 0.45,
              }}
            >
              Mark {read.strategyLabel} Sold @ {activeCredit > 0 ? activeCredit.toFixed(2) : "—"}
            </button>
          ) : (
            <button
              disabled={!canClose || !onClose}
              onClick={() => onClose?.(activeCredit)}
              style={{
                ...styles.closeButton,
                opacity: canClose && onClose ? 1 : 0.45,
              }}
            >
              Mark Buyback @ {activeCredit >= 0 ? activeCredit.toFixed(2) : "—"}
            </button>
          )}

          {onReset ? (
            <button onClick={onReset} style={styles.resetButton}>
              Reload DB Execution Memory
            </button>
          ) : null}
        </div>
      ) : onReset ? (
        <div style={styles.readOnlyBar}>
          <span>Read-only execution mirror</span>
          <button onClick={onReset} style={styles.resetButton}>Reload DB Memory</button>
        </div>
      ) : null}

      {read.position ? (
        <div style={styles.positionBox}>
          <strong>POSITION OPEN:</strong> {read.position.label} · {read.position.quantity} × sold at {read.position.entryCredit.toFixed(2)} · entry score {read.position.entryScore} · entry map {read.position.entryMapPhase} at {read.position.entryMapCenter.toFixed(0)}.
        </div>
      ) : null}

      {read.closedTrades.length > 0 ? (
        <div style={styles.history}>
          <h3 style={styles.boxTitle}>Recent unified execution memory</h3>
          {read.closedTrades.slice(0, 5).map((trade) => (
            <div key={`${trade.id}-${trade.closedAt}`} style={styles.tradeRow}>
              <span>{trade.label}</span>
              <span>
                {new Date(trade.openedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} → {new Date(trade.closedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </span>
              <span>{trade.entryCredit.toFixed(2)} → {trade.exitDebit.toFixed(2)}</span>
              <strong style={{ color: trade.pnlDollars >= 0 ? "#34d399" : "#fb7185" }}>
                {money(trade.pnlDollars)}
              </strong>
              <span>{Math.round(trade.durationMinutes)} min</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function Score({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: number;
  muted?: boolean;
}) {
  return (
    <div style={{ ...styles.score, opacity: muted ? 0.45 : 1 }}>
      <div style={styles.scoreLabel}>{label}</div>
      <div style={{ ...styles.scoreValue, color: scoreTone(value) }}>{Math.round(value)}</div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone: metricTone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div style={styles.metric}>
      <div style={styles.metricLabel}>{label}</div>
      <div style={{ ...styles.metricValue, color: metricTone ?? "#e5eef6" }}>{value}</div>
    </div>
  );
}

function Break({
  label,
  value,
  max,
  reason,
}: {
  label: string;
  value: number;
  max: number;
  reason: string;
}) {
  const width = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div style={styles.breakRow}>
      <div style={styles.breakHeader}>
        <span>{label}</span>
        <strong>{value.toFixed(1)} / {max}</strong>
      </div>
      <div style={styles.breakTrack}>
        <div style={{ ...styles.breakFill, width: `${width}%` }} />
      </div>
      <div style={styles.breakReason}>{reason}</div>
    </div>
  );
}

function formatLegs(legs: ExecutionLeg[]) {
  if (!legs.length) return "No executable legs";
  return legs
    .map((leg) => `${leg.action === "sell" ? "SELL" : "BUY"} ${leg.strike.toFixed(0)}${leg.optionType === "put" ? "P" : "C"}`)
    .join(" · ");
}

function fmt(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(2);
}

function pct(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : `${signed(value, 1)}%`;
}

function signed(value: number, digits: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function money(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  const absolute = Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return `${value < 0 ? "-" : ""}$${absolute}`;
}

function pnlTone(value: number | null | undefined) {
  if (value == null) return "#e5eef6";
  return value >= 0 ? "#34d399" : "#fb7185";
}

function scoreTone(value: number) {
  if (value >= 80) return "#34d399";
  if (value >= 60) return "#fde047";
  return "#fb7185";
}

function tone(state: ZeroDteExecutionRead["lifecycle"], emergency: boolean) {
  if (emergency) return "#fb7185";
  if (state === "SELL_READY" || state === "BUYBACK_READY" || state === "EXITED") return "#34d399";
  if (state === "ARMED" || state === "HOLD" || state === "POSITION_OPEN") return "#fde047";
  if (state === "COOLDOWN") return "#67e8f9";
  return "#94a3b8";
}

const styles: Record<string, React.CSSProperties> = {
  panel: { border: "1px solid #1d4660", background: "#071621", borderRadius: 18, padding: 18, marginBottom: 16 },
  header: { display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" },
  eyebrow: { color: "#67e8f9", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 900 },
  title: { margin: "5px 0 4px", fontSize: 21, fontWeight: 950 },
  sub: { margin: 0, color: "#91a4b5", fontSize: 13, lineHeight: 1.45, maxWidth: 760 },
  state: { border: "1px solid", borderRadius: 999, padding: "8px 12px", fontSize: 12, fontWeight: 950, letterSpacing: ".08em" },
  strategyBanner: { marginTop: 14, display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap", border: "1px solid #1c3b52", background: "#091b28", borderRadius: 14, padding: 14 },
  smallCaps: { color: "#7795ad", fontSize: 10, fontWeight: 900, letterSpacing: ".1em", textTransform: "uppercase" },
  strategyName: { marginTop: 4, color: "#67e8f9", fontSize: 20, fontWeight: 950 },
  legs: { marginTop: 5, color: "#c4d4df", fontSize: 12, lineHeight: 1.45 },
  mapRead: { display: "grid", gap: 2, textAlign: "right", color: "#71879a", fontSize: 10 },
  scoreGrid: { display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10, marginTop: 14 },
  trackingGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginTop: 12 },
  score: { background: "#091b28", border: "1px solid #1c3b52", borderRadius: 12, padding: 12 },
  scoreLabel: { color: "#7890a4", fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 850 },
  scoreValue: { marginTop: 5, fontSize: 30, lineHeight: 1, fontWeight: 950 },
  action: { marginTop: 12, border: "1px solid", borderRadius: 12, padding: 12, fontSize: 14, fontWeight: 850, lineHeight: 1.45 },
  metricGrid: { display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 9, marginTop: 12 },
  metric: { background: "#081822", border: "1px solid #18364a", borderRadius: 10, padding: 10 },
  metricLabel: { color: "#70879a", fontSize: 9, textTransform: "uppercase", letterSpacing: ".07em", fontWeight: 850 },
  metricValue: { marginTop: 4, fontSize: 15, fontWeight: 900 },
  breakdownGrid: { display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12, marginTop: 12 },
  box: { background: "#081822", border: "1px solid #18364a", borderRadius: 12, padding: 13 },
  boxTitle: { margin: "0 0 10px", fontSize: 13, fontWeight: 900 },
  breakRow: { marginTop: 9 },
  breakHeader: { display: "flex", justifyContent: "space-between", gap: 8, color: "#9db0bf", fontSize: 10 },
  breakTrack: { marginTop: 4, height: 6, background: "#122838", borderRadius: 999, overflow: "hidden" },
  breakFill: { height: "100%", background: "linear-gradient(90deg,#1b7ea9,#34d399)", borderRadius: 999 },
  breakReason: { marginTop: 3, color: "#657f92", fontSize: 9 },
  reason: { color: "#c2d0db", fontSize: 12, lineHeight: 1.5, marginTop: 5 },
  warning: { color: "#fda4af", fontSize: 12, lineHeight: 1.5, marginTop: 5 },
  muted: { color: "#71879a", fontSize: 12 },
  controls: { display: "grid", gridTemplateColumns: "minmax(220px,1fr) auto auto", gap: 10, alignItems: "end", marginTop: 13 },
  label: { display: "grid", gap: 5, color: "#8ea3b4", fontSize: 11, fontWeight: 800 },
  input: { width: "100%", border: "1px solid #23475f", background: "#06131d", color: "#e5eef6", borderRadius: 9, padding: "9px 10px" },
  openButton: { border: "1px solid rgba(52,211,153,.55)", background: "rgba(52,211,153,.14)", color: "#a7f3d0", borderRadius: 10, padding: "10px 13px", fontWeight: 900, cursor: "pointer" },
  closeButton: { border: "1px solid rgba(251,113,133,.55)", background: "rgba(251,113,133,.14)", color: "#fecdd3", borderRadius: 10, padding: "10px 13px", fontWeight: 900, cursor: "pointer" },
  resetButton: { border: "1px solid #31516a", background: "#0b2130", color: "#b8d3e5", borderRadius: 10, padding: "10px 13px", fontWeight: 850, cursor: "pointer" },
  readOnlyBar: { marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, color: "#71879a", fontSize: 11 },
  positionBox: { marginTop: 12, border: "1px solid rgba(253,224,71,.35)", background: "rgba(253,224,71,.08)", color: "#fef3c7", borderRadius: 10, padding: 11, fontSize: 12, lineHeight: 1.5 },
  history: { marginTop: 14, borderTop: "1px solid #18364a", paddingTop: 12 },
  tradeRow: { display: "grid", gridTemplateColumns: "1.3fr 1fr .8fr .7fr .5fr", gap: 10, borderTop: "1px solid #132d3f", padding: "8px 0", color: "#91a4b5", fontSize: 11, alignItems: "center" },
};
