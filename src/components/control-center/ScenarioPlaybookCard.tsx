"use client";

import { type AdaptivePositionControlResult } from "../../lib/nonlinear-mpc-engine";
import { colors, cardStyle } from "./styles";

type Props = { control: AdaptivePositionControlResult | null };

function Dot({ tone }: { tone: "bullish" | "bearish" | "neutral" | "warning" }) {
  const color = tone === "bullish" ? colors.green : tone === "bearish" ? colors.red : tone === "warning" ? colors.amber : colors.blue;
  return <span style={{ width: 10, height: 10, borderRadius: 99, background: color, boxShadow: `0 0 12px ${color}`, display: "inline-block", marginTop: 5 }} />;
}

export default function ScenarioPlaybookCard({ control }: Props) {
  const controls = control?.scenarioActions ?? [];

  return (
    <section style={{ ...cardStyle, padding: "1rem" }}>
      <h3 style={{ margin: 0, color: colors.teal }}>Scenario Playbook</h3>
      {!controls.length ? (
        <p style={{ color: colors.muted }}>No scenario matrix yet. Save an OI surface and load candles to activate the playbook.</p>
      ) : (
        <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.85rem" }}>
          {controls.slice(0, 4).map((item) => {
            const tone = item.scenario === "bullish_unlock" ? "bullish" : item.scenario === "bearish_failure" ? "bearish" : item.scenario === "volatility_expansion" ? "warning" : "neutral";
            return (
              <div key={item.scenario} style={{ display: "grid", gridTemplateColumns: "16px 1fr", gap: "0.6rem" }}>
                <Dot tone={tone} />
                <div>
                  <div style={{ color: "#f8fafc", fontWeight: 800 }}>{item.trigger}</div>
                  <div style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{item.preferredAction}</div>
                  <div style={{ color: tone === "bearish" ? colors.red : colors.amber, fontSize: 12, marginTop: 2 }}>{item.avoidAction}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
