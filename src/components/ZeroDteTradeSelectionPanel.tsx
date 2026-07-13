"use client";

import type React from "react";
import type { ZeroDteMoodRead } from "../lib/zeroDteMoodEngine";
import type { ZeroDteCreditSpreadSelection } from "../lib/zeroDteCreditSpreadSelector";
import type { ZeroDteTradeSelection } from "../lib/zeroDteTradeSelector";
import type { ZeroDteStrikeFlowRead } from "../lib/zeroDteStrikeFlow";

export function ZeroDteTradeSelectionPanel({
  mood,
  tradeSelection,
  strikeFlow,
}: {
  mood: ZeroDteMoodRead | null | undefined;
  tradeSelection: ZeroDteTradeSelection | null | undefined;
  strikeFlow?: ZeroDteStrikeFlowRead | null;
}) {
  const book = tradeSelection?.creditSpreadBook ?? null;
  const put = book?.put ?? null;
  const call = book?.call ?? null;
  const preferredSide = tradeSelection?.creditSpread?.side ?? book?.preferredSide ?? "none";

  return (
    <section style={styles.card}>
      <div style={styles.headerRow}>
        <div>
          <h2 style={styles.title}>Live Credit-Spread Scan</h2>
          <p style={styles.muted}>
            This live scan updates execution context, confidence, flow, and current pricing. It does not replace the locked opening put/call strikes unless you deliberately rebuild today's trade map.
          </p>
        </div>
        <div style={styles.badgeWrap}>
          <div style={styles.smallCaps}>Live directional read</div>
          <div style={{ ...styles.badgeValue, color: preferredSide === "put" ? "#34d399" : preferredSide === "call" ? "#fb7185" : "#fde047" }}>
            {preferredSide === "put" ? "Put spread" : preferredSide === "call" ? "Call spread" : "Review"}
          </div>
          <div style={styles.sourceLine}>{tradeSelection?.selectionMode ?? "not selected"}</div>
        </div>
      </div>

      <div style={styles.grid4}>
        <Metric title="Mood" value={mood?.moodPercent == null ? "—" : `${mood.moodPercent.toFixed(1)}%`} tone={moodTone(mood?.moodPercent)} />
        <Metric title="Mood Bias" value={mood?.tradeBias ?? "—"} />
        <Metric title="Final Trade" value={tradeSelection?.label ?? "—"} />
        <Metric title="Confidence" value={tradeSelection?.confidence == null ? "—" : `${tradeSelection.confidence}%`} tone={tone(tradeSelection?.confidence ?? 0)} />
        <Metric title="Flow Guard" value={!strikeFlow?.hasPriorSnapshot ? "Baseline" : `${strikeFlow.callWall.state} / ${strikeFlow.putWall.state}`} />
      </div>

      <div style={styles.grid2}>
        <SpreadCard spread={put} preferred={preferredSide === "put"} />
        <SpreadCard spread={call} preferred={preferredSide === "call"} />
      </div>

      <div style={styles.grid2}>
        <ReasonList title="Why" items={[...(book?.notes ?? []), ...(tradeSelection?.reasons ?? [])]} empty="No selection notes yet." />
        <ReasonList title="Warnings" items={[...(book?.warnings ?? []), ...(tradeSelection?.warnings ?? [])]} empty="No warnings." warning />
      </div>

      <div style={styles.grid2}>
        <CandidateTable title="Top Put Spread Candidates" spread={put} />
        <CandidateTable title="Top Call Spread Candidates" spread={call} />
      </div>
    </section>
  );
}

function SpreadCard({ spread, preferred }: { spread: ZeroDteCreditSpreadSelection | null; preferred: boolean }) {
  const sideSuffix = spread?.side === "put" ? "P" : spread?.side === "call" ? "C" : "";
  const sideTitle = spread?.side === "put" ? "Put Credit Spread" : "Call Credit Spread";

  return (
    <div style={{ ...styles.tradeBox, borderColor: preferred ? "rgba(103,232,249,0.75)" : "#1e3a5f" }}>
      <div style={styles.tradeHeaderRow}>
        <div>
          <div style={styles.smallCaps}>{sideTitle}</div>
          {preferred ? <div style={styles.preferredPill}>Preferred</div> : null}
        </div>
        <div style={{ ...styles.score, color: tone(spread?.confidence ?? 0) }}>{spread ? `${spread.confidence}%` : "—"}</div>
      </div>

      {spread?.shortStrike && spread.longStrike ? (
        <>
          <div style={styles.tradeText}>
            SELL {fmt(spread.shortStrike)}{sideSuffix} / BUY {fmt(spread.longStrike)}{sideSuffix}
          </div>
          <div style={styles.widthNote}>
            Width selected by optimizer: {spread.actualWidth}-wide. Max allowed width: {spread.maxAllowedWidth}. Risk mode: {spread.riskMode}.
          </div>
          <div style={styles.statsGrid}>
            <MiniStat label="Credit" value={money(spread.estimatedCredit)} />
            <MiniStat label="Width" value={spread.actualWidth ?? spread.requestedWidth} />
            <MiniStat label="Max Risk" value={money(spread.maxLoss)} />
            <MiniStat label="$ Risk" value={moneyDollars(spread.maxLossDollars)} />
            <MiniStat label="Credit/Risk" value={spread.creditToRiskPct == null ? "—" : `${(spread.creditToRiskPct * 100).toFixed(1)}%`} />
            <MiniStat label="Credit/Width" value={spread.creditToWidthPct == null ? "—" : `${(spread.creditToWidthPct * 100).toFixed(1)}%`} />
            <MiniStat label="BE" value={fmt(spread.breakeven)} />
            <MiniStat label="EM Used" value={spread.distanceAsExpectedMovePct == null ? "—" : `${Math.round(spread.distanceAsExpectedMovePct * 100)}%`} />
            <MiniStat label="Delta" value={spread.shortDeltaAbs == null ? "—" : spread.shortDeltaAbs.toFixed(2)} />
          </div>
          <div style={styles.wallText}>{spread.wallRelationship}</div>
          {spread.reasons.slice(0, 5).map((reason, idx) => <div key={idx} style={styles.reasonLine}>• {reason}</div>)}
        </>
      ) : (
        <div style={styles.emptySpread}>No executable candidate from current SPX quote rows and risk filters.</div>
      )}
    </div>
  );
}

function CandidateTable({ title, spread }: { title: string; spread: ZeroDteCreditSpreadSelection | null }) {
  const sideSuffix = spread?.side === "put" ? "P" : spread?.side === "call" ? "C" : "";
  const candidates = spread?.candidates ?? [];

  return (
    <div style={styles.tableWrap}>
      <div style={styles.smallCaps}>{title}</div>
      {candidates.length ? (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Short</th>
              <th style={styles.th}>Long</th>
              <th style={styles.th}>Width</th>
              <th style={styles.th}>Credit</th>
              <th style={styles.th}>Risk</th>
              <th style={styles.th}>C/R</th>
              <th style={styles.th}>Score</th>
              <th style={styles.th}>EM</th>
              <th style={styles.th}>Δ</th>
            </tr>
          </thead>
          <tbody>
            {candidates.slice(0, 8).map((candidate) => (
              <tr key={`${candidate.strike}-${candidate.longStrike}-${candidate.actualWidth}`} style={styles.tr}>
                <td style={styles.tdStrong}>{fmt(candidate.strike)}{sideSuffix}</td>
                <td style={styles.td}>{fmt(candidate.longStrike)}{sideSuffix}</td>
                <td style={styles.td}>{candidate.actualWidth}</td>
                <td style={styles.td}>{money(candidate.estimatedCredit)}</td>
                <td style={styles.td}>{money(candidate.maxLoss)}</td>
                <td style={styles.td}>{(candidate.creditToRiskPct * 100).toFixed(1)}%</td>
                <td style={styles.td}>{candidate.score}</td>
                <td style={styles.td}>{Math.round(candidate.distanceAsExpectedMovePct * 100)}%</td>
                <td style={styles.td}>{candidate.shortDeltaAbs == null ? "—" : candidate.shortDeltaAbs.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={styles.muted}>No candidates available.</div>
      )}
    </div>
  );
}

function Metric({ title, value, tone }: { title: string; value: string | number; tone?: string }) {
  return (
    <div style={styles.metricCard}>
      <div style={styles.smallCaps}>{title}</div>
      <div style={{ ...styles.metricValue, color: tone ?? "#f8fafc" }}>{value}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div style={styles.miniStat}>
      <div style={styles.miniLabel}>{label}</div>
      <div style={styles.miniValue}>{value ?? "—"}</div>
    </div>
  );
}

function ReasonList({ title, items, empty, warning }: { title: string; items: string[]; empty: string; warning?: boolean }) {
  return (
    <div style={styles.reasonBox}>
      <div style={styles.smallCaps}>{title}</div>
      {items.length ? items.slice(0, 8).map((item, idx) => <div key={`${item}-${idx}`} style={warning ? styles.warningLine : styles.reasonLine}>• {item}</div>) : <div style={styles.muted}>{empty}</div>}
    </div>
  );
}

function fmt(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function money(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `$${value.toFixed(2)}`;
}

function moneyDollars(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `$${Math.round(value).toLocaleString()}`;
}

function tone(score: number) {
  if (score >= 70) return "#34d399";
  if (score <= 40) return "#fb7185";
  return "#fde047";
}

function moodTone(mood: number | null | undefined) {
  if (mood === null || mood === undefined) return "#94a3b8";
  if (mood >= 40) return "#34d399";
  if (mood <= -40) return "#fb7185";
  return "#fde047";
}

const styles: Record<string, React.CSSProperties> = {
  card: { border: "1px solid rgba(34,211,238,0.28)", background: "#0b1b2b", borderRadius: 18, padding: 18, marginBottom: 16 },
  headerRow: { display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 14 },
  title: { fontSize: 20, fontWeight: 950, margin: "0 0 4px" },
  muted: { color: "#94a3b8", fontSize: 13, lineHeight: 1.45, margin: 0 },
  smallCaps: { color: "#93b5d9", fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase" },
  sourceLine: { marginTop: 3, color: "#94a3b8", fontSize: 12 },
  badgeWrap: { textAlign: "right", minWidth: 230 },
  badgeValue: { marginTop: 4, fontSize: 18, fontWeight: 950 },
  grid4: { display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 12, marginBottom: 14 },
  grid2: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginTop: 14 },
  metricCard: { border: "1px solid #1e3a5f", background: "#07111f", borderRadius: 14, padding: 14 },
  metricValue: { marginTop: 6, fontSize: 19, fontWeight: 950, wordBreak: "break-word" },
  tradeBox: { border: "1px solid #1e3a5f", background: "#06111f", borderRadius: 16, padding: 16 },
  tradeHeaderRow: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  preferredPill: { display: "inline-block", marginTop: 6, padding: "4px 8px", borderRadius: 999, background: "rgba(34,211,238,0.14)", color: "#67e8f9", fontSize: 11, fontWeight: 900 },
  score: { fontSize: 24, fontWeight: 950 },
  tradeText: { marginTop: 10, fontSize: 23, fontWeight: 950, color: "#67e8f9" },
  widthNote: { marginTop: 8, color: "#93b5d9", fontSize: 12, fontWeight: 800 },
  emptySpread: { marginTop: 16, color: "#fca5a5", fontSize: 14, fontWeight: 800 },
  statsGrid: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 12 },
  miniStat: { border: "1px solid #1e3a5f", background: "#07111f", borderRadius: 10, padding: 9 },
  miniLabel: { color: "#93b5d9", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 900 },
  miniValue: { marginTop: 4, color: "#f8fafc", fontSize: 15, fontWeight: 900 },
  wallText: { marginTop: 10, color: "#cbd5e1", fontSize: 13, lineHeight: 1.5 },
  reasonBox: { border: "1px solid #1e3a5f", background: "#07111f", borderRadius: 14, padding: 14 },
  reasonLine: { color: "#cbd5e1", fontSize: 13, lineHeight: 1.55, marginTop: 5 },
  warningLine: { color: "#fde68a", fontSize: 13, lineHeight: 1.55, marginTop: 5 },
  tableWrap: { overflowX: "auto", border: "1px solid #1e3a5f", borderRadius: 14, padding: 12, background: "#07111f" },
  table: { width: "100%", borderCollapse: "collapse", marginTop: 8, fontSize: 13 },
  th: { textAlign: "left", color: "#93b5d9", borderBottom: "1px solid #1e3a5f", padding: "8px 10px", whiteSpace: "nowrap" },
  tr: { borderBottom: "1px solid rgba(30,58,95,0.6)" },
  td: { color: "#cbd5e1", padding: "8px 10px", whiteSpace: "nowrap" },
  tdStrong: { color: "#67e8f9", padding: "8px 10px", fontWeight: 900, whiteSpace: "nowrap" },
};
