"use client";

import type { ExecutionRead } from "../../lib/execution/types";

export function ScoreBreakdown({ read }: { read: ExecutionRead | null }) {
  return (
    <section style={styles.card}>
      <div style={styles.title}>Harvest Score Breakdown</div>
      <div style={styles.totalRow}>
        <span>Total</span>
        <strong>{read?.harvestScore ?? 0}/100</strong>
      </div>

      <div style={styles.rows}>
        {(read?.components ?? []).map((component) => {
          const pct = component.max
            ? (component.score / component.max) * 100
            : 0;

          return (
            <div key={component.key} style={styles.row}>
              <div style={styles.rowHeader}>
                <span>{component.label}</span>
                <strong>
                  {component.score.toFixed(1)}/{component.max}
                </strong>
              </div>
              <div style={styles.track}>
                <div style={{ ...styles.fill, width: `${pct}%` }} />
              </div>
              <div style={styles.reason}>{component.reason}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: "#08131d",
    border: "1px solid #1d3447",
    borderRadius: 14,
    padding: 14,
  },
  title: {
    fontSize: 13,
    fontWeight: 850,
  },
  totalRow: {
    display: "flex",
    justifyContent: "space-between",
    marginTop: 10,
    color: "#8ea2b5",
    fontSize: 12,
  },
  rows: {
    display: "grid",
    gap: 11,
    marginTop: 13,
  },
  row: {
    display: "grid",
    gap: 5,
  },
  rowHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    fontSize: 10,
    color: "#a9bac9",
  },
  track: {
    height: 7,
    background: "#122333",
    borderRadius: 99,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 99,
    background: "linear-gradient(90deg,#196e9c,#20c997)",
  },
  reason: {
    fontSize: 9,
    color: "#61768a",
  },
};
