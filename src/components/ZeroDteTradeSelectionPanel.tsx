"use client";

import type React from "react";
import type { ZeroDteMoodRead } from "../lib/zeroDteMoodEngine";
import type { ZeroDteTradeSelection } from "../lib/zeroDteTradeSelector";

export function ZeroDteTradeSelectionPanel({
  mood,
  tradeSelection,
}: {
  mood: ZeroDteMoodRead | null | undefined;
  tradeSelection: ZeroDteTradeSelection | null | undefined;
}) {
  const spread = tradeSelection?.creditSpread ?? null;
  const sideSuffix = spread?.side === "put" ? "P" : spread?.side === "call" ? "C" : "";

  return (
    <section style={styles.card}>
      <div style={styles.headerRow}>
        <div>
          <h2 style={styles.title}>0DTE Trade Selector</h2>
          <p style={styles.muted}>Mood chooses the structure. SPX OI map chooses the short strike. SPY remains confirmation only.</p>
        </div>
        <div style={styles.badgeWrap}>
          <div style={styles.smallCaps}>Final Bias</div>
          <div style={{ ...styles.badgeValue, color: tone(tradeSelection?.confidence ?? 0) }}>{tradeSelection?.label ?? "No read"}</div>
        </div>
      </div>

      <div style={styles.grid4}>
        <Metric title="Mood" value={mood?.moodPercent == null ? "—" : `${mood.moodPercent.toFixed(1)}%`} tone={moodTone(mood?.moodPercent)} />
        <Metric title="Mood Source" value={mood?.source ?? "—"} />
        <Metric title="Coverage" value={mood ? `${mood.coverageScore}%` : "—"} tone={tone(mood?.coverageScore ?? 0)} />
        <Metric title="Trade Confidence" value={tradeSelection ? `${tradeSelection.confidence}%` : "—"} tone={tone(tradeSelection?.confidence ?? 0)} />
      </div>

      {spread ? (
        <div style={styles.tradeBox}>
          <div style={styles.smallCaps}>Suggested Credit Spread</div>
          <div style={styles.tradeText}>
            SELL {fmt(spread.shortStrike)}{sideSuffix} / BUY {fmt(spread.longStrike)}{sideSuffix}
          </div>
          <div style={styles.muted}>Width: {spread.width} | Distance: {spread.distanceFromSpot == null ? "—" : `${spread.distanceFromSpot.toFixed(1)} pts`} | EM used: {spread.distanceAsExpectedMovePct == null ? "—" : `${Math.round(spread.distanceAsExpectedMovePct * 100)}%`}</div>
          <div style={styles.wallText}>{spread.wallRelationship}</div>
        </div>
      ) : tradeSelection?.ironFly ? (
        <div style={styles.tradeBox}>
          <div style={styles.smallCaps}>Suggested Neutral Structure</div>
          <div style={styles.tradeText}>
            {fmt(tradeSelection.ironFly.lowerWing)} / {fmt(tradeSelection.ironFly.center)} / {fmt(tradeSelection.ironFly.upperWing)}
          </div>
          <div style={styles.muted}>Mood is neutral or non-directional; use the SPX iron fly/condor placement engine.</div>
        </div>
      ) : (
        <div style={styles.tradeBox}>
          <div style={styles.smallCaps}>No Credit Spread Strike</div>
          <div style={styles.tradeText}>Wait / No Trade</div>
          <div style={styles.muted}>No usable mood read or no valid SPX strike candidate was available.</div>
        </div>
      )}

      <div style={styles.grid2}>
        <ReasonList title="Reasons" items={tradeSelection?.reasons ?? []} empty="No reasons available yet." />
        <ReasonList title="Warnings" items={[...(mood?.warnings ?? []), ...(tradeSelection?.warnings ?? [])]} empty="No warnings." warning />
      </div>

      {spread?.candidates?.length ? (
        <div style={styles.tableWrap}>
          <div style={styles.smallCaps}>Top Short-Strike Candidates</div>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Short</th>
                <th style={styles.th}>Long</th>
                <th style={styles.th}>Score</th>
                <th style={styles.th}>Distance</th>
                <th style={styles.th}>OI</th>
                <th style={styles.th}>Wall</th>
                <th style={styles.th}>Dealer</th>
                <th style={styles.th}>SPY</th>
              </tr>
            </thead>
            <tbody>
              {spread.candidates.slice(0, 6).map((candidate) => (
                <tr key={`${candidate.strike}-${candidate.longStrike}`} style={styles.tr}>
                  <td style={styles.tdStrong}>{fmt(candidate.strike)}{sideSuffix}</td>
                  <td style={styles.td}>{fmt(candidate.longStrike)}{sideSuffix}</td>
                  <td style={styles.td}>{candidate.score}</td>
                  <td style={styles.td}>{Math.round(candidate.distanceAsExpectedMovePct * 100)}% EM</td>
                  <td style={styles.td}>{candidate.oiScore}</td>
                  <td style={styles.td}>{candidate.wallScore}</td>
                  <td style={styles.td}>{candidate.dealerScore}</td>
                  <td style={styles.td}>{candidate.spyScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
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

function ReasonList({ title, items, empty, warning }: { title: string; items: string[]; empty: string; warning?: boolean }) {
  return (
    <div style={styles.reasonBox}>
      <div style={styles.smallCaps}>{title}</div>
      {items.length ? items.slice(0, 7).map((item, idx) => <div key={`${item}-${idx}`} style={warning ? styles.warningLine : styles.reasonLine}>• {item}</div>) : <div style={styles.muted}>{empty}</div>}
    </div>
  );
}

function fmt(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
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
  badgeWrap: { textAlign: "right", minWidth: 220 },
  badgeValue: { marginTop: 4, fontSize: 18, fontWeight: 950 },
  grid4: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginBottom: 14 },
  grid2: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginTop: 14 },
  metricCard: { border: "1px solid #1e3a5f", background: "#07111f", borderRadius: 14, padding: 14 },
  metricValue: { marginTop: 6, fontSize: 20, fontWeight: 950, wordBreak: "break-word" },
  tradeBox: { border: "1px solid rgba(103,232,249,0.25)", background: "#06111f", borderRadius: 16, padding: 16 },
  tradeText: { marginTop: 6, fontSize: 26, fontWeight: 950, color: "#67e8f9" },
  wallText: { marginTop: 8, color: "#cbd5e1", fontSize: 13, lineHeight: 1.5 },
  reasonBox: { border: "1px solid #1e3a5f", background: "#07111f", borderRadius: 14, padding: 14 },
  reasonLine: { color: "#cbd5e1", fontSize: 13, lineHeight: 1.55, marginTop: 5 },
  warningLine: { color: "#fde68a", fontSize: 13, lineHeight: 1.55, marginTop: 5 },
  tableWrap: { overflowX: "auto", marginTop: 14, border: "1px solid #1e3a5f", borderRadius: 14, padding: 12, background: "#07111f" },
  table: { width: "100%", borderCollapse: "collapse", marginTop: 8, fontSize: 13 },
  th: { textAlign: "left", color: "#93b5d9", borderBottom: "1px solid #1e3a5f", padding: "8px 10px", whiteSpace: "nowrap" },
  tr: { borderBottom: "1px solid rgba(30,58,95,0.6)" },
  td: { color: "#cbd5e1", padding: "8px 10px", whiteSpace: "nowrap" },
  tdStrong: { color: "#67e8f9", padding: "8px 10px", fontWeight: 900, whiteSpace: "nowrap" },
};
