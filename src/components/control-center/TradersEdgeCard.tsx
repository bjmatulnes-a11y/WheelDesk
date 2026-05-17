"use client";

import type { ControlCenterState } from "../../lib/control-state-engine";
import type { TraderEdgeSummary } from "../../lib/trader-edge-engine";
import { colors, cardStyle } from "./styles";

function fmt(value?: number | null): string {
  return value == null || !Number.isFinite(value) ? "N/A" : value.toFixed(2);
}

function pct(value?: number | null): string {
  return value == null || !Number.isFinite(value) ? "N/A" : `${value.toFixed(1)}%`;
}

function score(value?: number | null): string {
  return value == null || !Number.isFinite(value) ? "N/A" : `${Math.round(value)} / 100`;
}

function Metric({
  label,
  value,
  tone = colors.text,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div style={styles.metric}>
      <div style={styles.metricLabel}>{label}</div>
      <div style={{ ...styles.metricValue, color: tone }}>{value}</div>
    </div>
  );
}

export default function TradersEdgeCard({
  state,
  edgeSummary,
}: {
  state: ControlCenterState;
  edgeSummary?: TraderEdgeSummary | null;
}) {
  const hasOldEngine = Boolean(edgeSummary);

  return (
    <section style={{ ...cardStyle, padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start" }}>
        <div>
          <h3 style={{ margin: 0, color: colors.text }}>Trader&apos;s Edge</h3>
          <p style={{ color: colors.muted, margin: "0.35rem 0 0", fontSize: 12 }}>
            {hasOldEngine
              ? "Restored dashboard Trader Edge engine: wheel/CSP/covered-call scores, trap risk, executable strike zones, and action bucket."
              : "Synthesis layer: converts OI, dealer pressure, IV, flow, wall migration, and portfolio context into a trade posture."}
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
          {hasOldEngine ? score(edgeSummary?.edgeScore) : `${Math.round(state.traderEdge.score)} / 100`}
        </div>
      </div>

      {hasOldEngine ? (
        <div style={{ marginTop: "1rem", display: "grid", gap: "0.85rem" }}>
          <div style={styles.primaryAction}>
            <div style={{ color: colors.muted, fontSize: 11, fontWeight: 900, textTransform: "uppercase" }}>
              Action Bucket
            </div>
            <div style={{ color: colors.amber, fontSize: 22, fontWeight: 950, marginTop: 5 }}>
              {edgeSummary?.actionBucket ?? "N/A"}
            </div>
            <div style={{ color: colors.text, fontSize: 13, marginTop: 8, lineHeight: 1.4 }}>
              {edgeSummary?.bestAction ?? "No best action available."}
            </div>
          </div>

          <div style={styles.grid}>
            <Metric label="Edge Score" value={score(edgeSummary?.edgeScore)} tone={colors.teal} />
            <Metric label="Wheel Score" value={score(edgeSummary?.wheelScore)} tone={colors.green} />
            <Metric label="CSP Score" value={score(edgeSummary?.cspScore)} tone={colors.green} />
            <Metric label="Covered Call Score" value={score(edgeSummary?.coveredCallScore)} tone={colors.amber} />
            <Metric label="Trap Risk" value={score(edgeSummary?.trapRisk)} tone={(edgeSummary?.trapRisk ?? 0) >= 70 ? colors.red : colors.amber} />
            <Metric label="Pin/Snap Risk" value={score(edgeSummary?.pinSnapRiskScore)} tone={colors.amber} />
            <Metric label="Premium Proxy" value={score(edgeSummary?.premiumProxyScore)} tone={colors.teal} />
            <Metric label="Data Quality" value={score(edgeSummary?.dataQualityScore)} tone={colors.teal} />
          </div>

          <div style={styles.grid}>
            <Metric label="Support" value={fmt(edgeSummary?.support)} tone={colors.red} />
            <Metric label="Magnet" value={fmt(edgeSummary?.magnet)} tone={colors.amber} />
            <Metric label="Resistance" value={fmt(edgeSummary?.resistance)} tone={colors.green} />
            <Metric label="Compression" value={edgeSummary?.compressionState ?? "N/A"} tone={colors.teal} />
            <Metric label="Chart Bias" value={(edgeSummary?.chartBias ?? "N/A").toUpperCase()} tone={colors.text} />
            <Metric label="Options Bias" value={(edgeSummary?.optionsBias ?? "N/A").toUpperCase()} tone={colors.text} />
            <Metric label="ATR" value={pct(edgeSummary?.atrPct)} tone={colors.teal} />
            <Metric label="Realized Vol" value={pct(edgeSummary?.realizedVolPct)} tone={colors.teal} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: "0.75rem" }}>
            <div style={styles.zone}>
              <div style={styles.zoneTitle}>Executable CSP Zone</div>
              <div style={{ color: colors.green, fontWeight: 900 }}>
                Target {fmt(edgeSummary?.cspCushionTarget)} · Sell at/below {fmt(edgeSummary?.executableCspCeiling)}
              </div>
            </div>

            <div style={styles.zone}>
              <div style={styles.zoneTitle}>Executable Covered-Call Zone</div>
              <div style={{ color: colors.amber, fontWeight: 900 }}>
                Target {fmt(edgeSummary?.coveredCallCushionTarget)} · Sell at/above {fmt(edgeSummary?.executableCoveredCallFloor)}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: "0.75rem" }}>
            <div>
              <div style={styles.sectionTitle}>Trigger Notes</div>
              <ul style={styles.list}>
                {(edgeSummary?.triggerNotes ?? []).slice(0, 4).map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            </div>

            <div>
              <div style={styles.sectionTitle}>Trap Notes</div>
              <ul style={styles.list}>
                {(edgeSummary?.trapNotes ?? []).slice(0, 4).map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            </div>
          </div>

          {(edgeSummary?.dataQualityNotes?.length ?? 0) > 0 ? (
            <div style={styles.warning}>
              <strong>Data Quality:</strong> {edgeSummary?.dataQualityNotes.slice(0, 2).join(" ")}
            </div>
          ) : null}
        </div>
      ) : (
        <div style={{ marginTop: "1rem", display: "grid", gap: "0.75rem" }}>
          <div style={styles.primaryAction}>
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
            <div style={styles.sectionTitle}>Edge rationale</div>
            <ul style={styles.list}>
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
      )}
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  primaryAction: {
    border: "1px solid #20384d",
    background: "rgba(7, 21, 35, 0.72)",
    borderRadius: 10,
    padding: "0.75rem",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
    gap: "0.65rem",
  },
  metric: {
    border: "1px solid #20384d",
    background: "rgba(7, 21, 35, 0.72)",
    borderRadius: 10,
    padding: "0.65rem",
  },
  metricLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
    marginBottom: 5,
  },
  metricValue: {
    fontWeight: 950,
    fontSize: 14,
    lineHeight: 1.2,
  },
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
  sectionTitle: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  list: {
    margin: 0,
    paddingLeft: "1.1rem",
    color: colors.muted,
    lineHeight: 1.45,
    fontSize: 12,
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
