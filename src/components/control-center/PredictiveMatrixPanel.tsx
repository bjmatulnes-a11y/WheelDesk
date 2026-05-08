"use client";

import { type PredictiveMatrixResult } from "../../lib/predictive-matrix-engine";
import { colors, cardStyle } from "./styles";

type Props = { matrix: PredictiveMatrixResult | null };

function money(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return value.toFixed(2);
}

function scenarioColor(key: string): string {
  if (key === "bullish_unlock") return colors.green;
  if (key === "bearish_failure") return colors.red;
  if (key === "volatility_expansion") return colors.amber;
  return colors.teal;
}

export default function PredictiveMatrixPanel({ matrix }: Props) {
  if (!matrix) return null;

  return (
    <section style={{ ...cardStyle, padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "baseline", flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, color: colors.teal }}>Predictive Matrix</h3>
        <div style={{ color: colors.muted, fontSize: 12 }}>
          EV target <strong style={{ color: colors.amber }}>{money(matrix.expectedValueTarget)}</strong> · range <strong style={{ color: colors.text }}>{money(matrix.expectedRangeLow)}–{money(matrix.expectedRangeHigh)}</strong>
        </div>
      </div>

      <div style={{ overflowX: "auto", marginTop: "0.8rem" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ color: colors.muted, textAlign: "left", borderBottom: `1px solid ${colors.border}` }}>
              <th style={{ padding: "0.55rem" }}>Scenario</th>
              <th style={{ padding: "0.55rem" }}>Probability</th>
              <th style={{ padding: "0.55rem" }}>Activation</th>
              <th style={{ padding: "0.55rem" }}>Target</th>
              <th style={{ padding: "0.55rem" }}>Trade Action</th>
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row) => (
              <tr key={row.key} style={{ borderBottom: `1px solid rgba(148, 163, 184, 0.10)` }}>
                <td style={{ padding: "0.6rem", color: scenarioColor(row.key), fontWeight: 900 }}>{row.scenario}</td>
                <td style={{ padding: "0.6rem", color: colors.text, fontWeight: 900 }}>{row.probabilityPct}%</td>
                <td style={{ padding: "0.6rem", color: colors.text }}>{row.activation}</td>
                <td style={{ padding: "0.6rem", color: scenarioColor(row.key), fontWeight: 900 }}>{money(row.expectedTarget)}</td>
                <td style={{ padding: "0.6rem", color: colors.text }}>{row.tradeAction}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ margin: "0.85rem 0 0", color: colors.muted, fontSize: 12 }}>{matrix.readout}</p>
    </section>
  );
}
