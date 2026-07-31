"use client";

import type { ExecutionRead } from "../../lib/execution/types";

export function ExecutionDecisionPanel({
  read,
}: {
  read: ExecutionRead | null;
}) {
  const tone =
    read?.zone === "harvest"
      ? "#16c784"
      : read?.zone === "watch"
        ? "#f5c542"
        : read?.zone === "manage"
          ? "#42a5f5"
          : "#ea3943";

  return (
    <section style={{ ...styles.card, borderColor: `${tone}88` }}>
      <div style={styles.eyebrow}>Execution Engine</div>
      <div style={{ ...styles.action, color: tone }}>
        {read?.action ?? "WAIT"}
      </div>
      <div style={styles.confidence}>
        {read?.confidence ?? 0}
        <span style={styles.percent}>%</span>
      </div>
      <div style={styles.caption}>Execution confidence</div>

      <div style={styles.reasons}>
        {(read?.reasons ?? ["Waiting for live structure"]).map((reason) => (
          <div key={reason} style={styles.reason}>
            <span style={{ ...styles.dot, background: tone }} />
            {reason}
          </div>
        ))}
      </div>

      {read?.warningReasons.length ? (
        <div style={styles.warningBox}>
          {read.warningReasons.map((reason) => (
            <div key={reason}>⚠ {reason}</div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: "#08131d",
    border: "1px solid #1d3447",
    borderRadius: 14,
    padding: 16,
  },
  eyebrow: {
    fontSize: 10,
    color: "#71869a",
    textTransform: "uppercase",
    letterSpacing: 1,
    fontWeight: 800,
  },
  action: {
    fontSize: 30,
    fontWeight: 950,
    marginTop: 4,
  },
  confidence: {
    fontSize: 58,
    fontWeight: 950,
    lineHeight: 1,
    marginTop: 5,
  },
  percent: {
    fontSize: 20,
    color: "#7f93a6",
    marginLeft: 2,
  },
  caption: {
    color: "#708397",
    fontSize: 11,
    marginTop: 4,
  },
  reasons: {
    display: "grid",
    gap: 8,
    marginTop: 16,
  },
  reason: {
    display: "flex",
    gap: 8,
    alignItems: "flex-start",
    fontSize: 11,
    color: "#c0ccd7",
    lineHeight: 1.4,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    marginTop: 4,
    flex: "0 0 auto",
  },
  warningBox: {
    marginTop: 13,
    background: "rgba(234,57,67,.08)",
    border: "1px solid rgba(234,57,67,.25)",
    borderRadius: 9,
    padding: 9,
    color: "#e7a3a7",
    fontSize: 10,
    display: "grid",
    gap: 5,
  },
};
