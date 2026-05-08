"use client";

import { type DealerPressureSummary } from "../../lib/dealer-pressure-engine";
import { type PredictiveMatrixResult } from "../../lib/predictive-matrix-engine";
import { colors, cardStyle } from "./styles";

type Props = { dealer: DealerPressureSummary | null; matrix: PredictiveMatrixResult | null };

function ScoreDots({ score, color }: { score?: number | null; color: string }) {
  const filled = Math.round(((score ?? 0) / 100) * 8);
  return (
    <span style={{ display: "inline-flex", gap: 5 }}>
      {Array.from({ length: 8 }).map((_, index) => (
        <span key={index} style={{ width: 8, height: 8, borderRadius: 99, background: index < filled ? color : "rgba(148, 163, 184, 0.22)" }} />
      ))}
    </span>
  );
}

function Row({ label, value, score, color }: { label: string; value: string; score?: number | null; color: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 64px 86px", gap: "0.6rem", alignItems: "center" }}>
      <span style={{ color: colors.text }}>{label}</span>
      <strong style={{ color }}>{value}</strong>
      <ScoreDots score={score} color={color} />
    </div>
  );
}

export default function ModelReadoutCard({ dealer, matrix }: Props) {
  return (
    <section style={{ ...cardStyle, padding: "1rem" }}>
      <h3 style={{ margin: 0, color: colors.teal }}>Model Readout</h3>
      <div style={{ display: "grid", gap: "0.6rem", marginTop: "0.85rem", fontSize: 13 }}>
        <Row label="Pin Risk" value={`${(dealer?.pinRiskScore ?? 0).toFixed(0)}%`} score={dealer?.pinRiskScore} color={colors.amber} />
        <Row label="Snap Risk" value={`${(dealer?.snapRiskScore ?? 0).toFixed(0)}%`} score={dealer?.snapRiskScore} color={colors.green} />
        <Row label="Gamma Concentration" value={`${(dealer?.gammaConcentrationScore ?? 0).toFixed(0)}`} score={dealer?.gammaConcentrationScore} color={colors.red} />
        <Row label="Rail Proximity" value={`${(dealer?.railProximityScore ?? 0).toFixed(0)}`} score={dealer?.railProximityScore} color={colors.amber} />
        <Row label="Model Score" value={`${(matrix?.modelScore ?? 0).toFixed(0)}`} score={matrix?.modelScore} color={colors.blue} />
      </div>
      <div style={{ marginTop: "0.8rem", color: colors.muted, fontSize: 12 }}>
        Dealer pressure bias: <strong style={{ color: colors.blue }}>{dealer?.hedgeFlowBias ?? "unknown"}</strong><br />
        Regime: <strong style={{ color: colors.text }}>{dealer?.regime ?? "unavailable"}</strong>
      </div>
    </section>
  );
}
