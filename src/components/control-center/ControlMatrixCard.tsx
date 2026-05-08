"use client";

import { type AdaptivePositionControlResult } from "../../lib/nonlinear-mpc-engine";
import { colors, cardStyle } from "./styles";

type Props = { control: AdaptivePositionControlResult | null };

function scoreColor(score: number): string {
  if (score >= 70) return colors.green;
  if (score >= 50) return colors.amber;
  return colors.red;
}

export default function ControlMatrixCard({ control }: Props) {
  if (!control) return null;

  return (
    <section style={{ ...cardStyle, padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "baseline" }}>
        <h3 style={{ margin: 0, color: colors.teal }}>Control Matrix</h3>
        <div style={{ color: colors.muted, fontSize: 12 }}>Scores: 0 weak — 100 strong</div>
      </div>

      <div style={{ overflowX: "auto", marginTop: "0.8rem" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ color: colors.muted, textAlign: "left", borderBottom: `1px solid ${colors.border}` }}>
              <th style={{ padding: "0.55rem" }}>Action</th>
              <th style={{ padding: "0.55rem" }}>Score</th>
              <th style={{ padding: "0.55rem" }}>When Valid</th>
              <th style={{ padding: "0.55rem" }}>Warning</th>
            </tr>
          </thead>
          <tbody>
            {control.rows.map((row) => (
              <tr key={row.key} style={{ borderBottom: `1px solid rgba(148, 163, 184, 0.10)` }}>
                <td style={{ padding: "0.6rem", color: colors.teal, fontWeight: 900 }}>{row.action}</td>
                <td style={{ padding: "0.6rem" }}>
                  <span style={{ display: "inline-block", minWidth: 42, textAlign: "center", borderRadius: 8, padding: "0.25rem 0.45rem", background: `${scoreColor(row.score)}33`, color: scoreColor(row.score), fontWeight: 900 }}>{row.score}</span>
                </td>
                <td style={{ padding: "0.6rem", color: colors.text }}>{row.whenValid}</td>
                <td style={{ padding: "0.6rem", color: row.score < 50 ? colors.red : colors.amber, fontWeight: 700 }}>{row.warning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
