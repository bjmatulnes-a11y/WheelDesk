import { ConfidenceLevel, ExecutionPlan, PositionInputs, StructureInterpretation, TacticalDecision } from "./types";

type ExecutionInput = {
  tacticalDecision: TacticalDecision;
  structure: StructureInterpretation;
  currentPrice: number;
  oiCenter: number;
  oiLowerRange: number;
  oiUpperRange: number;
  callWall: number;
  putWall: number;
  position: Pick<PositionInputs, "shares" | "shortCallStrike" | "shortCallDte" | "cashAvailable">;
};

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function confidenceFromAlignment(input: ExecutionInput): ConfidenceLevel {
  let aligned = 0;
  let conflict = 0;

  if (input.structure.structuralDirection === "higher" && input.structure.supportState === "strengthening") aligned += 1;
  if (input.structure.structuralDirection === "lower" && input.structure.supportState === "weakening") aligned += 1;
  if (input.structure.overallBias === "mixed") conflict += 1;
  if (input.structure.supportState === "strengthening" && input.structure.resistanceState === "strengthening") conflict += 1;
  if (input.structure.structuralState === "compressing" && input.structure.overallBias !== "mixed") aligned += 1;

  const score = aligned - conflict;
  if (score >= 2) return "high";
  if (score <= 0) return "low";
  return "moderate";
}

export function buildExecutionPlan(input: ExecutionInput): ExecutionPlan {
  const lower = input.oiLowerRange;
  const upper = input.oiUpperRange;

  let cspLow = Math.min(lower, input.putWall) * 0.99;
  let cspHigh = Math.min(lower, input.putWall) * 1.005;
  let ccLow = Math.max(input.callWall, upper) * 0.99;
  let ccHigh = Math.max(input.callWall, upper) * 1.02;

  if (input.structure.supportState === "weakening") {
    cspLow *= 0.985;
    cspHigh *= 0.99;
  }
  if (input.structure.supportState === "strengthening") {
    cspLow *= 1.003;
    cspHigh *= 1.005;
  }
  if (input.structure.structuralState === "expanding") {
    cspLow *= 0.99;
    cspHigh *= 0.995;
    ccLow *= 1.005;
    ccHigh *= 1.01;
  }
  if (input.currentPrice < input.oiCenter) {
    cspLow *= 0.995;
    cspHigh *= 0.995;
  }

  if (input.structure.resistanceState === "strengthening") {
    ccLow *= 0.995;
    ccHigh *= 0.995;
  }
  if (input.structure.resistanceState === "stable") {
    ccLow = Math.max(ccLow, input.callWall * 0.995);
  }
  if (input.structure.structuralDirection === "higher") {
    ccLow *= 1.005;
    ccHigh *= 1.01;
  }

  const conditionalTriggers = [
    `Enable CSP if price stabilizes near ${round2(lower)}-${round2(lower * 1.01)} and holds above ${round2(input.putWall)}.`,
    `Pause CSP if price breaks below ${round2(lower)} with momentum.`,
    `Favor CC entries if price rejects near call wall ${round2(input.callWall)}.`,
    `Shift to more constructive posture if price reclaims OI center ${round2(input.oiCenter)} and holds.`
  ];

  const timeGuidance = [
    "Near-term (1–3 sessions): monitor reaction at lower/upper range boundaries.",
    "Wait for confirmation before full-size entries when structure is mixed or compressing.",
    "Monitor volatility expansion to widen strikes and avoid tight assumptions."
  ];

  const executionNotes = [
    `CSP candidates anchored around ${round2(cspLow)}-${round2(cspHigh)}.`,
    `Covered call candidates anchored around ${round2(ccLow)}-${round2(ccHigh)}.`,
    input.position.shortCallDte <= 7 ? "Short call DTE is tight; prioritize roll/assignment decision timing." : "Short call DTE allows tactical patience."
  ];

  const confidence = confidenceFromAlignment(input);
  const executionSummary = `${input.structure.overallBias} structure with ${confidence} confidence: stage entries around anchored levels and use trigger confirmation.`;

  return {
    cspCandidateRange: { low: round2(Math.min(cspLow, cspHigh)), high: round2(Math.max(cspLow, cspHigh)) },
    coveredCallCandidateRange: { low: round2(Math.min(ccLow, ccHigh)), high: round2(Math.max(ccLow, ccHigh)) },
    conditionalTriggers: conditionalTriggers.slice(0, 4),
    timeGuidance: timeGuidance.slice(0, 3),
    executionNotes: executionNotes.slice(0, 3),
    executionSummary,
    confidence
  };
}

