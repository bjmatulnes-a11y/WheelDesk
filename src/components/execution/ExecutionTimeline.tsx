"use client";

import type { ExecutionRead } from "../../lib/execution/types";

export function ExecutionTimeline({
  timeline,
}: {
  timeline: ExecutionRead[];
}) {
  return (
    <section style={styles.card}>
      <div style={styles.title}>Execution Timeline</div>
      <div style={styles.list}>
        {[...timeline]
          .reverse()
          .slice(0, 12)
          .map((item) => (
            <div
              key={`${item.generatedAt}-${item.action}`}
              style={styles.item}
            >
              <div style={styles.time}>
                {new Date(item.generatedAt).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </div>
              <div style={styles.action}>{item.action}</div>
              <div style={styles.score}>{item.harvestScore}</div>
            </div>
          ))}
        {!timeline.length ? (
          <div style={styles.empty}>Timeline begins after the first material state change.</div>
        ) : null}
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
  list: {
    display: "grid",
    marginTop: 9,
  },
  item: {
    display: "grid",
    gridTemplateColumns: "70px 1fr 38px",
    gap: 8,
    borderTop: "1px solid #172a3b",
    padding: "8px 0",
    fontSize: 10,
  },
  time: {
    color: "#73889b",
  },
  action: {
    color: "#d8e3ec",
    fontWeight: 800,
  },
  score: {
    textAlign: "right",
    color: "#55d6ff",
    fontWeight: 850,
  },
  empty: {
    color: "#62788d",
    fontSize: 10,
    paddingTop: 12,
  },
};
