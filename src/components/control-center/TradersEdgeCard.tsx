"use client";

import type { ControlCenterState } from "../../lib/control-state-engine";
import { colors, cardStyle } from "./styles";

function fmt(value?: number | null): string {
  return value == null || !Number.isFinite(value) ? "N/A" : value.toFixed(2);
}

export default function TradersEdgeCard({ state }: { state: ControlCenterState }) {
  return (
    <section style={{ ...cardStyle, padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start" }}>
        <div>
          <h3 style={{ margin: 0, color: colors.text }}>Trader&apos;s Edge</h3>
          <p style={{ color: colors.muted, margin: "0.35rem 0 0", fontSize: 12 }}>
            Synthesis layer: converts OI, dealer pressure, IV, flow, wall migration, and portfolio context into a trade posture.
          </p>
        </div>
        <div
          style={{
            border: "1px solid #24465d",
            background: "#071523",
            color: colors.teal,
            borderRadius: 999,
            padding: "0.35rem 0.65rem",
            fontSize: 12,
            fontWeight: 900,
            whiteSpace: "nowrap",
          }}
        >
          {Math.round(state.traderEdge.score)} / 100
        </div>
      </div>

      <div style={{ marginTop: "1rem", display: "grid", gap: "0.75rem" }}>
        <div
          style={{
            border: "1px solid #20384d",
            background: "rgba(7, 21, 35, 0.72)",
            borderRadius: 10,
            padding: "0.75rem",
          }}
        >
          <div style={{ color: colors.muted, fontSize: 11, fontWeight: 900, textTransform: "uppercase" }}>Posture</div>
          <div style={{ color: colors.amber, fontSize: 22, fontWeight: 950, marginTop: 5 }}>{state.traderEdge.posture}</div>
        </div>

        {state.traderEdge.bestZone ? (
          <div style={styles.zone}>
            <div style={styles.zoneTitle}>{state.traderEdge.bestZone.label}</div>
            <div style={{ color: colors.green, fontWeight: 900 }}>
              {fmt(state.traderEdge.bestZone.low)} → {fmt(state.traderEdge.bestZone.high)}
            </div>
          </div>
        ) : null}

        {state.traderEdge.avoidZone ? (
          <div style={{ ...styles.zone, borderColor: "rgba(245, 158, 11, 0.35)", background: "rgba(245, 158, 11, 0.06)" }}>
            <div style={{ ...styles.zoneTitle, color: colors.amber }}>Avoid Zone</div>
            <div style={{ color: colors.text, fontWeight: 900 }}>
              {fmt(state.traderEdge.avoidZone.low)} → {fmt(state.traderEdge.avoidZone.high)}
            </div>
            <div style={{ color: colors.muted, fontSize: 12, marginTop: 5 }}>{state.traderEdge.avoidZone.reason}</div>
          </div>
        ) : null}

        <div>
          <div style={{ color: colors.muted, fontSize: 11, fontWeight: 900, textTransform: "uppercase", marginBottom: 6 }}>
            Edge rationale
          </div>
          <ul style={{ margin: 0, paddingLeft: "1.1rem", color: colors.muted, lineHeight: 1.45, fontSize: 12 }}>
            {state.traderEdge.bullets.slice(0, 5).map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>

        {state.traderEdge.warnings.length ? (
          <div style={styles.warning}>
            <strong>Warnings:</strong> {state.traderEdge.warnings.slice(0, 2).join(" ")}
          </div>
        ) : null}
      </div>
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  zone: {
    border: "1px solid #20384d",
    background: "rgba(7, 21, 35, 0.72)",
    borderRadius: 10,
    padding: "0.75rem",
  },
  zoneTitle: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  warning: {
    color: colors.amber,
    border: "1px solid rgba(245, 158, 11, 0.35)",
    background: "rgba(245, 158, 11, 0.08)",
    borderRadius: 10,
    padding: "0.7rem",
    fontSize: 12,
    lineHeight: 1.4,
  },
};
