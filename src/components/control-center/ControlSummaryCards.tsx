"use client";

import { type AdaptivePositionControlResult } from "../../lib/nonlinear-mpc-engine";
import { type PredictiveMatrixResult } from "../../lib/predictive-matrix-engine";
import { colors, cardStyle } from "./styles";

type Props = {
  control: AdaptivePositionControlResult | null;
  matrix: PredictiveMatrixResult | null;
};

function money(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return value.toFixed(2);
}

function SummaryCard({ label, value, accent, subtitle }: { label: string; value: string; accent: string; subtitle?: string }) {
  return (
    <section style={{ ...cardStyle, padding: "1rem", borderLeft: `4px solid ${accent}`, minHeight: 84 }}>
      <div style={{ color: accent, fontSize: 12, fontWeight: 900, letterSpacing: 0.6, textTransform: "uppercase" }}>{label}</div>
      <div style={{ marginTop: 10, color: "#f8fafc", fontSize: 22, fontWeight: 900, lineHeight: 1.1 }}>{value}</div>
      {subtitle ? <div style={{ marginTop: 6, color: colors.muted, fontSize: 12 }}>{subtitle}</div> : null}
    </section>
  );
}

export default function ControlSummaryCards({ control, matrix }: Props) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "0.85rem" }}>
      <SummaryCard label="Current State" value={control?.currentState ?? "Awaiting Data"} accent={colors.teal} subtitle={control?.snapshotDate ? `Surface ${control.snapshotDate}` : "Save an OI surface first"} />
      <SummaryCard label="Optimal Action" value={control?.optimalAction ?? "N/A"} accent={colors.violet} subtitle={control ? `${control.actionScore}/100 action score` : "No control model yet"} />
      <SummaryCard label="Bullish Trigger" value={money(matrix?.bullishUnlock)} accent={colors.green} subtitle="Unlock / acceptance rail" />
      <SummaryCard label="Bearish Trigger" value={money(matrix?.bearishFailure)} accent={colors.red} subtitle="Failure / support-loss rail" />
    </div>
  );
}
