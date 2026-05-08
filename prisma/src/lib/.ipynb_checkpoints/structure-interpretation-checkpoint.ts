import { OverallBias, StructureInterpretation, StructuralDirection, StructuralState, StructuralStrength } from "./types";

type InterpretationInput = {
  oiCenterDelta: number;
  callWeightedStrikeDelta: number;
  putWeightedStrikeDelta: number;
  callWallDelta: number;
  putWallDelta: number;
  oiRangeWidthDelta: number;
  supportConcentrationDelta: number;
  resistanceConcentrationDelta: number;
  nearPriceOiDelta: number;
  currentPrice: number;
};

function threshold(price: number, pct = 0.003): number {
  return Math.max(0.1, price * pct);
}

function classifyDirection(input: InterpretationInput): StructuralDirection {
  const t = threshold(input.currentPrice);
  const upVotes =
    Number(input.oiCenterDelta > t) +
    Number(input.callWeightedStrikeDelta > t) +
    Number(input.putWeightedStrikeDelta > t) +
    Number(input.callWallDelta > t) +
    Number(input.putWallDelta > t);
  const downVotes =
    Number(input.oiCenterDelta < -t) +
    Number(input.callWeightedStrikeDelta < -t) +
    Number(input.putWeightedStrikeDelta < -t) +
    Number(input.callWallDelta < -t) +
    Number(input.putWallDelta < -t);

  if (upVotes >= 3 && upVotes > downVotes) return "higher";
  if (downVotes >= 3 && downVotes > upVotes) return "lower";
  return "neutral";
}

function classifySupport(input: InterpretationInput): StructuralStrength {
  const t = threshold(input.currentPrice);
  if (input.putWallDelta > t && input.supportConcentrationDelta > 0) return "strengthening";
  if (input.putWallDelta < -t && input.supportConcentrationDelta < 0) return "weakening";
  return "stable";
}

function classifyResistance(input: InterpretationInput): StructuralStrength {
  const t = threshold(input.currentPrice);
  if (input.callWallDelta < -t && input.resistanceConcentrationDelta > 0) return "strengthening";
  if (input.callWallDelta > t && input.resistanceConcentrationDelta < 0) return "weakening";
  return "stable";
}

function classifyState(input: InterpretationInput): StructuralState {
  const t = threshold(input.currentPrice, 0.004);
  if (input.oiRangeWidthDelta < -t || (Math.abs(input.oiRangeWidthDelta) <= t && input.nearPriceOiDelta > 0)) return "compressing";
  if (input.oiRangeWidthDelta > t) return "expanding";
  return "stable";
}

function classifyOverallBias(
  direction: StructuralDirection,
  supportState: StructuralStrength,
  resistanceState: StructuralStrength
): OverallBias {
  if (direction === "higher" && supportState === "strengthening" && resistanceState !== "strengthening") return "constructive";
  if (direction === "lower" && supportState === "weakening" && resistanceState === "strengthening") return "defensive";
  return "mixed";
}

export function interpretStructure(input: InterpretationInput): StructureInterpretation {
  const structuralDirection = classifyDirection(input);
  const supportState = classifySupport(input);
  const resistanceState = classifyResistance(input);
  const structuralState = classifyState(input);
  const overallBias = classifyOverallBias(structuralDirection, supportState, resistanceState);

  const narrative =
    `${structuralDirection === "higher" ? "Structure shifting higher" : structuralDirection === "lower" ? "Structure shifting lower" : "Structure mostly neutral"}, ` +
    `support ${supportState}, resistance ${resistanceState}, and state ${structuralState}.`;

  let tacticalImplication = "Mixed structure: keep size moderate and wait for cleaner confirmation.";
  if (overallBias === "constructive") {
    tacticalImplication = "Constructive structure: support is improving; upside paths are more credible than breakdown paths.";
  } else if (overallBias === "defensive") {
    tacticalImplication = "Defensive structure: downside pressure dominates; favor caution on aggressive upside assumptions.";
  } else if (structuralState === "compressing") {
    tacticalImplication = "Compression is building: watch for a breakout from the balance zone.";
  } else if (structuralState === "expanding") {
    tacticalImplication = "Expansion underway: expect wider rotation and avoid tight assumptions.";
  }

  return {
    structuralDirection,
    supportState,
    resistanceState,
    structuralState,
    overallBias,
    narrative,
    tacticalImplication
  };
}

