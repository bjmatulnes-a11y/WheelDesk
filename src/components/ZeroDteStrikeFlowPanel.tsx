"use client";

import type React from "react";
import type { ZeroDteStrikeFlowRead, ZeroDteStrikeFlowRow, ZeroDteWallFlowRead } from "../lib/zeroDteStrikeFlow";

export function ZeroDteStrikeFlowPanel({ flow }: { flow: ZeroDteStrikeFlowRead | null | undefined }) {
  const activeRows = (flow?.rows ?? [])
    .filter((row) => row.totalVolumeDelta > 0)
    .sort((a, b) => b.totalVolumeDelta - a.totalVolumeDelta)
    .slice(0, 12);

  return (
    <section style={styles.card}>
      <div style={styles.headerRow}>
        <div>
          <h2 style={styles.title}>SPX Strike Flow / Volume Acceleration</h2>
          <p style={styles.muted}>Compares cumulative Yahoo strike volume with the prior harvest. OI defines the locked map; new volume confirms wall defense, attack, absorption, or breakdown.</p>
        </div>
        <div style={styles.badge}>
          {flow?.hasPriorSnapshot ? `${fmtMinutes(flow.elapsedMinutes)} comparison` : "Baseline only"}
        </div>
      </div>

      <div style={styles.grid4}>
        <Metric title="SPX Change" value={flow?.priceChange == null ? "—" : signed(flow.priceChange)} />
        <Metric title="Δ Call Volume" value={flow ? integer(flow.totalCallVolumeDelta) : "—"} tone="#67e8f9" />
        <Metric title="Δ Put Volume" value={flow ? integer(flow.totalPutVolumeDelta) : "—"} tone="#fb7185" />
        <Metric title="Net Δ Flow" value={flow ? signed(flow.netVolumeDelta, 0) : "—"} />
      </div>

      <div style={styles.grid2}>
        <WallCard label="Call Wall" wall={flow?.callWall ?? null} />
        <WallCard label="Put Wall" wall={flow?.putWall ?? null} />
      </div>

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Strike</th>
              <th style={styles.th}>Activity</th>
              <th style={styles.th}>Δ Call Vol</th>
              <th style={styles.th}>Δ Put Vol</th>
              <th style={styles.th}>Call Vol/OI</th>
              <th style={styles.th}>Put Vol/OI</th>
              <th style={styles.th}>Bias</th>
              <th style={styles.th}>From Spot</th>
            </tr>
          </thead>
          <tbody>
            {activeRows.length ? activeRows.map((row) => <FlowRow key={row.strike} row={row} />) : (
              <tr><td colSpan={8} style={styles.empty}>Harvest again later to calculate strike-level volume acceleration.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={styles.notes}>{(flow?.notes ?? ["No strike-flow read yet."]).map((note, index) => <div key={index}>• {note}</div>)}</div>
    </section>
  );
}

function WallCard({ label, wall }: { label: string; wall: ZeroDteWallFlowRead | null }) {
  return (
    <div style={{ ...styles.wallCard, borderColor: wallTone(wall?.state) }}>
      <div style={styles.smallCaps}>{label}</div>
      <div style={{ ...styles.wallState, color: wallTone(wall?.state) }}>{wall?.state?.toUpperCase() ?? "—"}</div>
      <div style={styles.wallStats}>Strike {wall?.strike ?? "—"} | Δ volume {integer(wall?.volumeDelta ?? 0)} | Vol/OI {percent(wall?.volumeOiRatio)}</div>
      <div style={styles.wallMessage}>{wall?.message ?? "No wall-flow read available."}</div>
    </div>
  );
}

function FlowRow({ row }: { row: ZeroDteStrikeFlowRow }) {
  return (
    <tr style={styles.tr}>
      <td style={styles.tdStrong}>{row.strike}</td>
      <td style={{ ...styles.tdStrong, color: activityTone(row.activity) }}>{row.activity.toUpperCase()}</td>
      <td style={styles.td}>{integer(row.callVolumeDelta)}</td>
      <td style={styles.td}>{integer(row.putVolumeDelta)}</td>
      <td style={styles.td}>{percent(row.callVolumeOiRatio)}</td>
      <td style={styles.td}>{percent(row.putVolumeOiRatio)}</td>
      <td style={styles.td}>{row.deltaBias.toUpperCase()}</td>
      <td style={styles.td}>{signed(row.distanceFromSpot)}</td>
    </tr>
  );
}

function Metric({ title, value, tone }: { title: string; value: string; tone?: string }) {
  return <div style={styles.metric}><div style={styles.smallCaps}>{title}</div><div style={{ ...styles.metricValue, color: tone ?? "#f8fafc" }}>{value}</div></div>;
}

function wallTone(state: string | null | undefined) {
  if (state === "defended" || state === "absorbed") return "#34d399";
  if (state === "attacked" || state === "breaking") return "#fb7185";
  if (state === "unclear") return "#fde047";
  return "#64748b";
}
function activityTone(activity: string) {
  if (activity === "extreme") return "#fb7185";
  if (activity === "active") return "#fde047";
  if (activity === "building") return "#67e8f9";
  return "#94a3b8";
}
function integer(value: number) { return Math.round(value).toLocaleString(); }
function percent(value: number | null | undefined) { return value == null ? "—" : `${(value * 100).toFixed(1)}%`; }
function signed(value: number, digits = 1) { return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`; }
function fmtMinutes(value: number | null | undefined) { return value == null ? "Prior harvest" : `${Math.max(0, Math.round(value))}m`; }

const styles: Record<string, React.CSSProperties> = {
  card: { border: "1px solid rgba(103,232,249,0.28)", background: "#0b1b2b", borderRadius: 18, padding: 18, marginBottom: 16 },
  headerRow: { display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 14 },
  title: { fontSize: 20, fontWeight: 950, margin: "0 0 4px" },
  muted: { color: "#94a3b8", fontSize: 13, lineHeight: 1.45, margin: 0 },
  badge: { border: "1px solid #1e3a5f", background: "#07111f", borderRadius: 999, padding: "7px 11px", color: "#67e8f9", fontSize: 12, fontWeight: 900, whiteSpace: "nowrap" },
  grid4: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginBottom: 12 },
  grid2: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginBottom: 14 },
  metric: { border: "1px solid #1e3a5f", background: "#07111f", borderRadius: 14, padding: 13 },
  metricValue: { marginTop: 6, fontSize: 20, fontWeight: 950 },
  smallCaps: { color: "#93b5d9", fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase" },
  wallCard: { border: "1px solid #1e3a5f", background: "#06111f", borderRadius: 14, padding: 14 },
  wallState: { marginTop: 5, fontSize: 20, fontWeight: 950 },
  wallStats: { marginTop: 6, color: "#cbd5e1", fontSize: 12, fontWeight: 800 },
  wallMessage: { marginTop: 8, color: "#94a3b8", fontSize: 13, lineHeight: 1.45 },
  tableWrap: { overflowX: "auto", border: "1px solid #1e3a5f", borderRadius: 14, background: "#07111f" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", color: "#93b5d9", borderBottom: "1px solid #1e3a5f", padding: "9px 10px", whiteSpace: "nowrap" },
  tr: { borderBottom: "1px solid rgba(30,58,95,0.6)" },
  td: { color: "#cbd5e1", padding: "8px 10px", whiteSpace: "nowrap" },
  tdStrong: { color: "#67e8f9", padding: "8px 10px", fontWeight: 900, whiteSpace: "nowrap" },
  empty: { color: "#94a3b8", padding: 18, textAlign: "center" },
  notes: { marginTop: 12, color: "#94a3b8", fontSize: 12, lineHeight: 1.55 },
};
