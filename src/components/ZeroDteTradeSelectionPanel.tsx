"use client";

import type React from "react";
import type { ZeroDteMoodRead } from "../lib/zeroDteMoodEngine";
import type { ZeroDteCreditSpreadSelection } from "../lib/zeroDteCreditSpreadSelector";
import type { ZeroDteTradeSelection } from "../lib/zeroDteTradeSelector";
import type { ZeroDteOpeningIfMap } from "../lib/zeroDteOpeningExecutionPlan";

export function ZeroDteTradeSelectionPanel({
  mood,
  tradeSelection,
  openingMapOverride,
}: {
  mood: ZeroDteMoodRead | null | undefined;
  tradeSelection: ZeroDteTradeSelection | null | undefined;
  openingMapOverride?: ZeroDteOpeningIfMap | null;
}) {
  const book = tradeSelection?.creditSpreadBook ?? null;
  const put = book?.put ?? null;
  const call = book?.call ?? null;
  const preferredSide = book?.preferredSide ?? "none";
  const executionPlan = tradeSelection?.openingExecutionPlan ?? null;
  const executionMap = openingMapOverride ?? executionPlan?.map ?? null;

  return (
    <section style={styles.card}>
      <div style={styles.headerRow}>
        <div>
          <h2 style={styles.title}>SPX Execution Plan</h2>
          <p style={styles.muted}>
            Opening harvest locks the 50-wide IF map. Execution waits for location and reaction: credit spreads are preferred during directional impulse; flies are reserved for confirmed edge or center-pin setups.
          </p>
        </div>
        <div style={styles.badgeWrap}>
          <div style={styles.smallCaps}>Preferred</div>
          <div style={{ ...styles.badgeValue, color: preferredSide === "put" ? "#34d399" : preferredSide === "call" ? "#fb7185" : "#fde047" }}>
            {preferredSide === "put" ? "Put spread" : preferredSide === "call" ? "Call spread" : "Review"}
          </div>
          <div style={styles.sourceLine}>{tradeSelection?.selectionMode ?? "not selected"}</div>
        </div>
      </div>

      <div style={styles.grid4}>
        <Metric title="Mode" value={executionPlan?.mode ?? "—"} tone={executionTone(executionPlan?.mode)} />
        <Metric title="Location" value={executionPlan?.priceLocation?.split("-").join(" ") ?? "—"} />
        <Metric title="IF Credit" value={executionPlan?.estimatedIronFlyCredit == null ? "—" : money(executionPlan.estimatedIronFlyCredit)} tone={creditTone(executionPlan?.creditQuality)} />
        <Metric title="Spread Bias" value={executionPlan?.creditSpreadBias === "put" ? "Put spread" : executionPlan?.creditSpreadBias === "call" ? "Call spread" : "None / wait"} />
      </div>

      {executionPlan && executionMap ? (
        <div style={styles.executionBox}>
          <div style={styles.executionHeader}>
            <div>
              <div style={styles.smallCaps}>Opening Harvest IF Map — Locked For Day</div>
              <div style={styles.structureText}>{fmt(executionMap.lowerWing)} / {fmt(executionMap.center)} / {fmt(executionMap.upperWing)}</div>
              <div style={styles.muted}>Fixed width: ±{fmt(executionMap.wingWidth)} | Upper edge: {fmt(executionMap.upperEdgeStart)}-{fmt(executionMap.upperEdgeEnd)} | Lower edge: {fmt(executionMap.lowerEdgeStart)}-{fmt(executionMap.lowerEdgeEnd)}</div>
            </div>
            <div style={styles.executionMode}>{executionPlan.mode}</div>
          </div>
          <div style={styles.actionText}>{executionPlan.primaryAction}</div>
          <div style={styles.statsGrid}>
            <MiniStat label="Center Target" value={fmt(executionMap.center)} />
            <MiniStat label="Breakevens" value={executionPlan.lowerBreakeven == null || executionPlan.upperBreakeven == null ? "—" : `${fmt(executionPlan.lowerBreakeven)} / ${fmt(executionPlan.upperBreakeven)}`} />
            <MiniStat label="Max Risk/Contract" value={executionPlan.maxRiskDollarsPerContract == null ? "—" : moneyDollars(executionPlan.maxRiskDollarsPerContract)} />
          </div>
        </div>
      ) : null}

      <div style={styles.grid4}>
        <Metric title="Mood" value={mood?.moodPercent == null ? "—" : `${mood.moodPercent.toFixed(1)}%`} tone={moodTone(mood?.moodPercent)} />
        <Metric title="Mood Bias" value={mood?.tradeBias ?? "—"} />
        <Metric title="Model Favorite" value={tradeSelection?.label ?? "—"} />
        <Metric title="Confidence" value={tradeSelection?.confidence == null ? "—" : `${tradeSelection.confidence}%`} tone={tone(tradeSelection?.confidence ?? 0)} />
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


function executionTone(mode: string | null | undefined) {
  if (!mode) return "#94a3b8";
  if (mode.includes("PUT")) return "#34d399";
  if (mode.includes("CALL")) return "#fb7185";
  if (mode.includes("EDGE") || mode.includes("PIN")) return "#67e8f9";
  if (mode.includes("BREAKOUT")) return "#fde047";
  return "#94a3b8";
}

function creditTone(quality: string | null | undefined) {
  if (quality === "excellent" || quality === "good") return "#34d399";
  if (quality === "acceptable") return "#fde047";
  if (quality === "weak" || quality === "avoid") return "#fb7185";
  return "#94a3b8";
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
  grid4: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginBottom: 14 },
  grid2: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginTop: 14 },
  metricCard: { border: "1px solid #1e3a5f", background: "#07111f", borderRadius: 14, padding: 14 },
  metricValue: { marginTop: 6, fontSize: 19, fontWeight: 950, wordBreak: "break-word" },
  tradeBox: { border: "1px solid #1e3a5f", background: "#06111f", borderRadius: 16, padding: 16 },
  tradeHeaderRow: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  preferredPill: { display: "inline-block", marginTop: 6, padding: "4px 8px", borderRadius: 999, background: "rgba(34,211,238,0.14)", color: "#67e8f9", fontSize: 11, fontWeight: 900 },
  score: { fontSize: 24, fontWeight: 950 },
  tradeText: { marginTop: 10, fontSize: 23, fontWeight: 950, color: "#67e8f9" },
  executionBox: { border: "1px solid rgba(34,211,238,0.42)", background: "linear-gradient(135deg, rgba(8,24,40,0.98), rgba(7,17,31,0.98))", borderRadius: 16, padding: 16, marginBottom: 14 },
  executionHeader: { display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start" },
  executionMode: { color: "#67e8f9", fontSize: 17, fontWeight: 950, textAlign: "right" },
  structureText: { marginTop: 6, color: "#f8fafc", fontSize: 28, fontWeight: 950 },
  actionText: { marginTop: 12, color: "#e2e8f0", fontSize: 14, fontWeight: 850, lineHeight: 1.55 },
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
