import type { DealerPressureSummary } from "./dealer-pressure-engine";

export type ZeroDteFlowState = "ABSORBING" | "RELEASING" | "AMPLIFYING" | "MIXED";
export type ZeroDteFlowDirection = "UP" | "DOWN" | "NEUTRAL";

export type ZeroDteFlowStateRead = {
  state: ZeroDteFlowState;
  direction: ZeroDteFlowDirection;
  hoseScore: number;
  viscosityScore: number;
  releaseRiskScore: number;
  confidenceScore: number;
  label: string;
  interpretation: string;
  reasons: string[];
};

export function buildZeroDteFlowState(args: {
  summary: DealerPressureSummary;
  signedPressure: number;
}): ZeroDteFlowStateRead {
  const { summary } = args;
  const signedPressure = clamp(args.signedPressure, -100, 100);
  const pressureMagnitude = Math.abs(signedPressure);
  const direction: ZeroDteFlowDirection =
    signedPressure >= 16 ? "UP" : signedPressure <= -16 ? "DOWN" : "NEUTRAL";

  const suppression = weightedAverage([
    [summary.pinRiskScore, 0.42],
    [summary.gammaConcentrationScore, 0.23],
    [summary.nearSpotBalanceScore, 0.2],
    [100 - summary.snapRiskScore, 0.15],
  ]);

  const expansion = weightedAverage([
    [summary.snapRiskScore, 0.42],
    [summary.railProximityScore, 0.2],
    [summary.wallMigrationIntensityScore, 0.2],
    [pressureMagnitude, 0.18],
  ]);

  const releaseRiskScore = clampScore(
    summary.snapRiskScore * 0.46 +
      summary.wallMigrationIntensityScore * 0.24 +
      summary.railProximityScore * 0.18 +
      Math.max(0, pressureMagnitude - 25) * 0.12,
  );

  let state: ZeroDteFlowState;
  if (
    summary.regime === "Volatility expansion / amplification" ||
    (expansion >= 64 && expansion >= suppression + 9)
  ) {
    state = "AMPLIFYING";
  } else if (
    summary.regime === "Pin-to-snap" ||
    (releaseRiskScore >= 58 && Math.abs(expansion - suppression) < 20)
  ) {
    state = "RELEASING";
  } else if (
    summary.regime === "Volatility suppression / pinning" ||
    (suppression >= 58 && suppression >= expansion + 8)
  ) {
    state = "ABSORBING";
  } else {
    state = "MIXED";
  }

  const hoseScore = clampScore(
    state === "ABSORBING"
      ? 100 - suppression
      : state === "AMPLIFYING"
        ? 55 + expansion * 0.45
        : state === "RELEASING"
          ? 38 + releaseRiskScore * 0.45
          : 35 + expansion * 0.25,
  );

  const viscosityScore = clampScore(
    state === "ABSORBING"
      ? 55 + suppression * 0.45
      : state === "AMPLIFYING"
        ? 100 - expansion
        : state === "RELEASING"
          ? 62 - releaseRiskScore * 0.35
          : 50,
  );

  const confidenceScore = clampScore(
    summary.confidenceScore * 0.72 +
      Math.abs(suppression - expansion) * 0.18 +
      Math.min(100, summary.gammaConcentrationScore) * 0.1,
  );

  const reasons = buildReasons({
    summary,
    state,
    direction,
    signedPressure,
    suppression,
    expansion,
    releaseRiskScore,
  });

  return {
    state,
    direction,
    hoseScore: Math.round(hoseScore),
    viscosityScore: Math.round(viscosityScore),
    releaseRiskScore: Math.round(releaseRiskScore),
    confidenceScore: Math.round(confidenceScore),
    label: buildLabel(state, direction),
    interpretation: buildInterpretation({
      state,
      direction,
      viscosityScore,
      releaseRiskScore,
    }),
    reasons,
  };
}

function buildLabel(state: ZeroDteFlowState, direction: ZeroDteFlowDirection) {
  if (state === "ABSORBING") return "HOSE OFF / FLOW ABSORBED";
  if (state === "RELEASING") return `VALVE OPENING${direction === "NEUTRAL" ? "" : ` ${direction}`}`;
  if (state === "AMPLIFYING") return `HOSE ON${direction === "NEUTRAL" ? "" : ` / ${direction}`}`;
  return "FLOW CONFLICT / MIXED";
}

function buildInterpretation(args: {
  state: ZeroDteFlowState;
  direction: ZeroDteFlowDirection;
  viscosityScore: number;
  releaseRiskScore: number;
}) {
  const directionText = args.direction === "UP" ? "upside" : args.direction === "DOWN" ? "downside" : "either direction";

  if (args.state === "ABSORBING") {
    return `Options positioning is behaving like a high-viscosity medium: movement is being absorbed and mean reversion/pinning is favored. Viscosity ${Math.round(args.viscosityScore)}.`;
  }
  if (args.state === "RELEASING") {
    return `Containment is weakening. The next low-resistance release is biased toward ${directionText}; release risk ${Math.round(args.releaseRiskScore)}.`;
  }
  if (args.state === "AMPLIFYING") {
    return `Dealer-related flow is more likely to reinforce movement toward ${directionText} than absorb it. Expect faster travel between strikes and weaker pin behavior.`;
  }
  return "Dealer pressure is conflicted or insufficiently organized. Treat the path as unstable until pin or snap pressure becomes dominant.";
}

function buildReasons(args: {
  summary: DealerPressureSummary;
  state: ZeroDteFlowState;
  direction: ZeroDteFlowDirection;
  signedPressure: number;
  suppression: number;
  expansion: number;
  releaseRiskScore: number;
}) {
  const reasons = [
    `Pin ${Math.round(args.summary.pinRiskScore)} vs snap ${Math.round(args.summary.snapRiskScore)}.`,
    `Suppression ${Math.round(args.suppression)} vs expansion ${Math.round(args.expansion)}.`,
    `Signed pressure ${args.signedPressure > 0 ? "+" : ""}${Math.round(args.signedPressure)} (${args.direction.toLowerCase()}).`,
  ];

  if (args.summary.wallMigrationIntensityScore >= 55) {
    reasons.push(`Wall migration is active (${Math.round(args.summary.wallMigrationIntensityScore)}), increasing valve-transition risk.`);
  }
  if (args.releaseRiskScore >= 60 && args.state !== "AMPLIFYING") {
    reasons.push("The structure is close to a containment-to-release transition.");
  }
  return reasons;
}

function weightedAverage(values: Array<[number, number]>) {
  const weight = values.reduce((sum, [, w]) => sum + w, 0);
  if (!weight) return 0;
  return values.reduce((sum, [value, w]) => sum + clampScore(value) * w, 0) / weight;
}

function clampScore(value: number) {
  return clamp(value, 0, 100);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
