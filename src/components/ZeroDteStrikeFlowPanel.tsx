"use client";

import type React from "react";
import type {
  ZeroDteStrikeFlowRead,
  ZeroDteStrikeFlowRow,
  ZeroDteWallFlowRead,
} from "../lib/zeroDteStrikeFlow";

export function ZeroDteStrikeFlowPanel({
  flow,
}: {
  flow: ZeroDteStrikeFlowRead | null | undefined;
}) {
  const activeRows = (flow?.rows ?? [])
    .filter(
      (row) =>
        row.totalVolumeDelta1m > 0 ||
        row.totalVolumeDelta5m > 0 ||
        row.totalVolumeDelta15m > 0,
    )
    .sort(
      (a, b) =>
        b.localFlowPercentile - a.localFlowPercentile ||
        b.totalVolumeDelta1m - a.totalVolumeDelta1m,
    )
    .slice(0, 14);

  return (
    <section style={styles.card}>
      <div style={styles.headerRow}>
        <div>
          <h2 style={styles.title}>SPX Strike Flow / Δ Volume</h2>
          <p style={styles.muted}>
            Five-second Schwab harvests collect cumulative strike volume. The
            official trigger is the completed one-minute delta; rolling flow
            confirms whether a wall is accepted, defended, absorbed, or broken.
          </p>
        </div>
        <div style={styles.badgeStack}>
          <div style={styles.badge}>
            {flow?.sessionStatus ?? "BUILDING"}
          </div>
          <div style={styles.subBadge}>
            {flow?.officialThrough
              ? `Official through ${formatTime(flow.officialThrough)}`
              : "Waiting for first closed minute"}
          </div>
        </div>
      </div>

      <div style={styles.grid4}>
        <Metric
          title="SPX Δ 1m"
          value={flow?.priceChange1m == null ? "—" : signed(flow.priceChange1m)}
        />
        <Metric
          title="Net Δ Volume 1m"
          value={flow ? signed(flow.netVolumeDelta1m, 0) : "—"}
        />
        <Metric
          title={`Net Δ Volume ${flow?.confirmationWindowMinutes ?? 5}m`}
          value={
            flow ? signed(flow.netVolumeDeltaConfirmation, 0) : "—"
          }
        />
        <Metric
          title="Map Flow Read"
          value={flow?.mapDirection ?? "—"}
          tone={mapTone(flow?.mapDirection)}
        />
      </div>

      <div style={styles.grid4}>
        <Metric
          title="Call Δ 1m / 5m"
          value={
            flow
              ? `${integer(flow.totalCallVolumeDelta1m)} / ${integer(
                  flow.totalCallVolumeDelta5m,
                )}`
              : "—"
          }
          tone="#67e8f9"
        />
        <Metric
          title="Put Δ 1m / 5m"
          value={
            flow
              ? `${integer(flow.totalPutVolumeDelta1m)} / ${integer(
                  flow.totalPutVolumeDelta5m,
                )}`
              : "—"
          }
          tone="#fb7185"
        />
        <Metric
          title="15m Context"
          value={
            flow
              ? `${integer(flow.totalCallVolumeDelta15m)}C / ${integer(
                  flow.totalPutVolumeDelta15m,
                )}P`
              : "—"
          }
        />
        <Metric
          title="Map Confirmation"
          value={flow ? `${flow.mapConfirmationScore}/100` : "—"}
        />
      </div>

      <div style={styles.grid2}>
        <WallCard label="Call Wall" wall={flow?.callWall ?? null} />
        <WallCard label="Put Wall" wall={flow?.putWall ?? null} />
      </div>

      <div style={styles.flowMessage}>
        <strong>Flow interpretation:</strong>{" "}
        {flow?.mapMessage ??
          "Collecting the first completed-minute flow baseline."}
      </div>

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Strike</th>
              <th style={styles.th}>Activity</th>
              <th style={styles.th}>Percentile</th>
              <th style={styles.th}>Δ Call 1m</th>
              <th style={styles.th}>Δ Put 1m</th>
              <th style={styles.th}>Total 5m</th>
              <th style={styles.th}>Acceleration</th>
              <th style={styles.th}>Bias</th>
              <th style={styles.th}>From Spot</th>
            </tr>
          </thead>
          <tbody>
            {activeRows.length ? (
              activeRows.map((row) => <FlowRow key={row.strike} row={row} />)
            ) : (
              <tr>
                <td colSpan={9} style={styles.empty}>
                  Five-second snapshots are collecting. A strike-level delta
                  becomes official after the next one-minute candle closes.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={styles.notes}>
        {(flow?.notes ?? ["No strike-flow read yet."]).map((note, index) => (
          <div key={index}>• {note}</div>
        ))}
      </div>
    </section>
  );
}

function WallCard({
  label,
  wall,
}: {
  label: string;
  wall: ZeroDteWallFlowRead | null;
}) {
  return (
    <div
      style={{
        ...styles.wallCard,
        borderColor: wallTone(wall?.state),
      }}
    >
      <div style={styles.smallCaps}>{label}</div>
      <div style={{ ...styles.wallState, color: wallTone(wall?.state) }}>
        {wall?.state?.toUpperCase() ?? "—"}
      </div>
      <div style={styles.wallStats}>
        Strike {wall?.strike ?? "—"} · Δ1m {integer(wall?.volumeDelta1m ?? 0)}
        {" · "}Confirm Δ {integer(
          wall?.volumeDeltaConfirmation ?? 0,
        )}
        {" · "}Pctl {wall?.localFlowPercentile ?? 0}
      </div>
      <div style={styles.wallStats}>
        Acceleration {signed(wall?.acceleration ?? 0, 0)} · Vol/OI{" "}
        {percent(wall?.volumeOiRatio)}
      </div>
      <div style={styles.wallMessage}>
        {wall?.message ?? "No wall-flow read available."}
      </div>
    </div>
  );
}

function FlowRow({ row }: { row: ZeroDteStrikeFlowRow }) {
  return (
    <tr style={styles.tr}>
      <td style={styles.tdStrong}>{row.strike}</td>
      <td
        style={{
          ...styles.tdStrong,
          color: activityTone(row.activity),
        }}
      >
        {row.activity.toUpperCase()}
      </td>
      <td style={styles.td}>{row.localFlowPercentile}</td>
      <td style={styles.td}>{integer(row.callVolumeDelta1m)}</td>
      <td style={styles.td}>{integer(row.putVolumeDelta1m)}</td>
      <td style={styles.td}>{integer(row.totalVolumeDelta5m)}</td>
      <td
        style={{
          ...styles.td,
          color:
            row.totalVolumeAcceleration > 0
              ? "#34d399"
              : row.totalVolumeAcceleration < 0
                ? "#fb7185"
                : "#94a3b8",
        }}
      >
        {signed(row.totalVolumeAcceleration, 0)}
      </td>
      <td style={styles.td}>{row.deltaBias.toUpperCase()}</td>
      <td style={styles.td}>{signed(row.distanceFromSpot)}</td>
    </tr>
  );
}

function Metric({
  title,
  value,
  tone,
}: {
  title: string;
  value: string;
  tone?: string;
}) {
  return (
    <div style={styles.metric}>
      <div style={styles.smallCaps}>{title}</div>
      <div
        style={{
          ...styles.metricValue,
          color: tone ?? "#f8fafc",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function wallTone(state: string | null | undefined) {
  if (state === "defended" || state === "absorbed") return "#34d399";
  if (state === "attacked" || state === "breaking") return "#fb7185";
  if (state === "unclear") return "#fde047";
  return "#64748b";
}

function mapTone(state: string | null | undefined) {
  if (state === "UPPER_ACCEPTED" || state === "LOWER_ACCEPTED") {
    return "#34d399";
  }
  if (state === "UPPER_REJECTED" || state === "LOWER_REJECTED") {
    return "#fb7185";
  }
  if (state === "BUILDING") return "#fde047";
  return "#94a3b8";
}

function activityTone(activity: string) {
  if (activity === "extreme") return "#fb7185";
  if (activity === "active") return "#fde047";
  if (activity === "building") return "#67e8f9";
  return "#94a3b8";
}

function integer(value: number) {
  return Math.round(value).toLocaleString();
}

function percent(value: number | null | undefined) {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function signed(value: number, digits = 1) {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function formatTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    border: "1px solid rgba(103,232,249,0.28)",
    background: "#0b1b2b",
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    alignItems: "flex-start",
    marginBottom: 14,
  },
  title: {
    fontSize: 20,
    fontWeight: 950,
    margin: "0 0 4px",
  },
  muted: {
    color: "#94a3b8",
    fontSize: 13,
    lineHeight: 1.45,
    margin: 0,
    maxWidth: 900,
  },
  badgeStack: {
    display: "grid",
    gap: 5,
    justifyItems: "end",
  },
  badge: {
    border: "1px solid #1e3a5f",
    background: "#07111f",
    borderRadius: 999,
    padding: "7px 11px",
    color: "#67e8f9",
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  subBadge: {
    color: "#93b5d9",
    fontSize: 11,
    whiteSpace: "nowrap",
  },
  grid4: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 12,
    marginBottom: 12,
  },
  grid2: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 12,
    marginBottom: 14,
  },
  metric: {
    border: "1px solid #1e3a5f",
    background: "#07111f",
    borderRadius: 14,
    padding: 13,
  },
  metricValue: {
    marginTop: 6,
    fontSize: 18,
    fontWeight: 950,
  },
  smallCaps: {
    color: "#93b5d9",
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
  },
  wallCard: {
    border: "1px solid #1e3a5f",
    background: "#06111f",
    borderRadius: 14,
    padding: 14,
  },
  wallState: {
    marginTop: 5,
    fontSize: 20,
    fontWeight: 950,
  },
  wallStats: {
    marginTop: 6,
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: 800,
  },
  wallMessage: {
    marginTop: 8,
    color: "#94a3b8",
    fontSize: 13,
    lineHeight: 1.45,
  },
  flowMessage: {
    marginBottom: 14,
    border: "1px solid #1e3a5f",
    background: "#07111f",
    borderRadius: 12,
    padding: 12,
    color: "#cbd5e1",
    fontSize: 13,
    lineHeight: 1.45,
  },
  tableWrap: {
    overflowX: "auto",
    border: "1px solid #1e3a5f",
    borderRadius: 14,
    background: "#07111f",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  },
  th: {
    textAlign: "left",
    color: "#93b5d9",
    borderBottom: "1px solid #1e3a5f",
    padding: "9px 10px",
    whiteSpace: "nowrap",
  },
  tr: {
    borderBottom: "1px solid rgba(30,58,95,0.6)",
  },
  td: {
    color: "#cbd5e1",
    padding: "8px 10px",
    whiteSpace: "nowrap",
  },
  tdStrong: {
    color: "#67e8f9",
    padding: "8px 10px",
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  empty: {
    color: "#94a3b8",
    padding: 18,
    textAlign: "center",
  },
  notes: {
    marginTop: 12,
    color: "#94a3b8",
    fontSize: 12,
    lineHeight: 1.55,
  },
};
