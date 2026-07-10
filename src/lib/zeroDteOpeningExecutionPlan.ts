import type { ZeroDteChainRow, ZeroDteRecommendation } from "./zeroDteOiIntelligence";
import type { ZeroDteCreditSpreadBook } from "./zeroDteCreditSpreadSelector";

export type ZeroDteExecutionMode =
  | "WAIT"
  | "PUT CREDIT SPREAD BIAS"
  | "CALL CREDIT SPREAD BIAS"
  | "UPPER EDGE FLY SETUP"
  | "LOWER EDGE FLY SETUP"
  | "CENTER PIN FLY SETUP"
  | "BREAKOUT — DO NOT FADE";

export type ZeroDteCreditQuality = "avoid" | "weak" | "acceptable" | "good" | "excellent" | "unknown";

export type ZeroDteOpeningIfMap = {
  tradeDate?: string | null;
  lockedAt?: string | null;
  center: number;
  wingWidth: number;
  lowerWing: number;
  upperWing: number;
  lowerEdgeStart: number;
  lowerEdgeEnd: number;
  upperEdgeStart: number;
  upperEdgeEnd: number;
};

export type ZeroDteOpeningExecutionPlan = {
  map: ZeroDteOpeningIfMap;
  mode: ZeroDteExecutionMode;
  primaryAction: string;
  priceLocation:
    | "below-lower-wing"
    | "lower-edge"
    | "below-center"
    | "center"
    | "above-center"
    | "upper-edge"
    | "above-upper-wing";
  estimatedIronFlyCredit: number | null;
  creditQuality: ZeroDteCreditQuality;
  maxRiskPoints: number | null;
  maxRiskDollarsPerContract: number | null;
  lowerBreakeven: number | null;
  upperBreakeven: number | null;
  centerTarget: number;
  creditSpreadBias: "put" | "call" | "none";
  reasons: string[];
  warnings: string[];
};

export const ZERO_DTE_OPENING_IF_WIDTH = 50;

export function buildOpeningIfMapFromRecommendation(
  recommendation: ZeroDteRecommendation,
  tradeDate?: string | null,
  generatedAt?: string | null,
): ZeroDteOpeningIfMap {
  const center = roundToFive(recommendation.suggestedCenter || recommendation.spx.strongestPin || recommendation.spx.gravity || recommendation.spxPrice);
  const wingWidth = ZERO_DTE_OPENING_IF_WIDTH;
  const lowerWing = center - wingWidth;
  const upperWing = center + wingWidth;
  const edgeDepth = Math.min(20, Math.max(10, wingWidth * 0.4));

  return {
    tradeDate: tradeDate ?? null,
    lockedAt: generatedAt ?? null,
    center,
    wingWidth,
    lowerWing,
    upperWing,
    lowerEdgeStart: lowerWing,
    lowerEdgeEnd: lowerWing + edgeDepth,
    upperEdgeStart: upperWing - edgeDepth,
    upperEdgeEnd: upperWing,
  };
}

export function buildZeroDteOpeningExecutionPlan(input: {
  recommendation: ZeroDteRecommendation;
  spxRows: ZeroDteChainRow[];
  creditSpreadBook?: ZeroDteCreditSpreadBook | null;
  tradeDate?: string | null;
  generatedAt?: string | null;
}): ZeroDteOpeningExecutionPlan {
  const { recommendation: rec, spxRows } = input;
  const map = buildOpeningIfMapFromRecommendation(rec, input.tradeDate, input.generatedAt);
  const spot = rec.spxPrice;
  const dealerPressure = rec.dealerPressure ?? 0;
  const pinScore = rec.confidenceScore ?? 0;
  const centerDistance = spot - map.center;
  const absCenterDistance = Math.abs(centerDistance);
  const estimatedIronFlyCredit = estimateIronFlyCredit(spxRows, map.center, map.lowerWing, map.upperWing);
  const creditQuality = gradeIronFlyCredit(estimatedIronFlyCredit);
  const maxRiskPoints = estimatedIronFlyCredit == null ? null : Math.max(0, map.wingWidth - estimatedIronFlyCredit);
  const maxRiskDollarsPerContract = maxRiskPoints == null ? null : maxRiskPoints * 100;
  const lowerBreakeven = estimatedIronFlyCredit == null ? null : map.center - estimatedIronFlyCredit;
  const upperBreakeven = estimatedIronFlyCredit == null ? null : map.center + estimatedIronFlyCredit;
  const reasons: string[] = [];
  const warnings: string[] = [];

  reasons.push(`Opening IF map is locked at ${map.lowerWing} / ${map.center} / ${map.upperWing} using fixed 50-wide wings.`);
  reasons.push("Opening harvest is the battlefield map; execution waits for location plus reaction.");

  const priceLocation = classifyPriceLocation(spot, map);
  const bullishStructure = spot >= map.center && dealerPressure >= -15;
  const bearishStructure = spot <= map.center && dealerPressure <= 15;
  const stronglyBullish = dealerPressure >= 40;
  const stronglyBearish = dealerPressure <= -40;
  const neutralPressure = Math.abs(dealerPressure) <= 15;
  const centerPinReady = absCenterDistance <= 10 && neutralPressure && pinScore >= 70;
  const upperEdge = priceLocation === "upper-edge";
  const lowerEdge = priceLocation === "lower-edge";
  const upperBreakout = priceLocation === "above-upper-wing" && stronglyBullish;
  const lowerBreakdown = priceLocation === "below-lower-wing" && stronglyBearish;

  let mode: ZeroDteExecutionMode = "WAIT";
  let creditSpreadBias: "put" | "call" | "none" = "none";
  let primaryAction = "WAIT — use the locked IF as the map, not an automatic open-entry order.";

  if (upperBreakout || lowerBreakdown) {
    mode = "BREAKOUT — DO NOT FADE";
    primaryAction = upperBreakout
      ? "Do not fade the upper wing while dealer pressure is strongly bullish. Avoid call credit spreads and wait for a failed breakout."
      : "Do not fade the lower wing while dealer pressure is strongly bearish. Avoid put credit spreads and wait for absorption.";
    warnings.push("Price is outside the 50-wide opening map with dealer pressure confirming the move.");
  } else if (upperEdge) {
    if (estimatedIronFlyCredit != null && estimatedIronFlyCredit >= 40 && dealerPressure < 40) {
      mode = "UPPER EDGE FLY SETUP";
      primaryAction = "Watch for upper-edge rejection. Edge-loaded fly is valid only after failure/rejection; target springback toward center.";
    } else {
      mode = "CALL CREDIT SPREAD BIAS";
      creditSpreadBias = "call";
      primaryAction = "Upper edge is being tested, but fly credit is not fat enough yet. Prefer call credit-spread review after rejection.";
    }
    reasons.push(`Spot is in the upper edge zone ${map.upperEdgeStart}-${map.upperEdgeEnd}.`);
  } else if (lowerEdge) {
    if (estimatedIronFlyCredit != null && estimatedIronFlyCredit >= 40 && dealerPressure > -40) {
      mode = "LOWER EDGE FLY SETUP";
      primaryAction = "Watch for lower-edge absorption. Edge-loaded fly is valid only after absorption/reclaim; target springback toward center.";
    } else {
      mode = "PUT CREDIT SPREAD BIAS";
      creditSpreadBias = "put";
      primaryAction = "Lower edge is being tested, but fly credit is not fat enough yet. Prefer put credit-spread review after absorption.";
    }
    reasons.push(`Spot is in the lower edge zone ${map.lowerEdgeStart}-${map.lowerEdgeEnd}.`);
  } else if (centerPinReady) {
    mode = "CENTER PIN FLY SETUP";
    primaryAction = "Center pin setup. Fly is acceptable only because price is near center, pressure is neutral, and pin/confidence is high.";
    reasons.push("Price is near center with neutral dealer pressure and high pin/confidence score.");
  } else if (bullishStructure && centerDistance > 0) {
    mode = "PUT CREDIT SPREAD BIAS";
    creditSpreadBias = "put";
    primaryAction = "Directional/opening phase favors put credit spreads over immediate fly entry.";
    reasons.push("Price is above the locked center/gravity zone without edge rejection yet.");
  } else if (bearishStructure && centerDistance < 0) {
    mode = "CALL CREDIT SPREAD BIAS";
    creditSpreadBias = "call";
    primaryAction = "Directional/opening phase favors call credit spreads over immediate fly entry.";
    reasons.push("Price is below the locked center/gravity zone without edge absorption yet.");
  }

  if (estimatedIronFlyCredit == null) {
    warnings.push("Could not estimate the live 50-wide IF credit from current SPX quote rows.");
  } else if (estimatedIronFlyCredit < 35) {
    warnings.push("50-wide IF credit is below 35; avoid fly execution unless there is a very strong pin setup.");
  } else if (estimatedIronFlyCredit >= 43) {
    reasons.push("50-wide IF credit is excellent (43+), so max risk is compressed if an edge/pin trigger confirms.");
  }

  return {
    map,
    mode,
    primaryAction,
    priceLocation,
    estimatedIronFlyCredit,
    creditQuality,
    maxRiskPoints,
    maxRiskDollarsPerContract,
    lowerBreakeven,
    upperBreakeven,
    centerTarget: map.center,
    creditSpreadBias,
    reasons,
    warnings,
  };
}

export function gradeIronFlyCredit(credit: number | null | undefined): ZeroDteCreditQuality {
  if (credit == null || !Number.isFinite(credit) || credit <= 0) return "unknown";
  if (credit < 35) return "avoid";
  if (credit < 38) return "weak";
  if (credit < 40) return "acceptable";
  if (credit < 43) return "good";
  return "excellent";
}

function classifyPriceLocation(spot: number, map: ZeroDteOpeningIfMap): ZeroDteOpeningExecutionPlan["priceLocation"] {
  if (spot > map.upperWing + 5) return "above-upper-wing";
  if (spot >= map.upperEdgeStart) return "upper-edge";
  if (spot < map.lowerWing - 5) return "below-lower-wing";
  if (spot <= map.lowerEdgeEnd) return "lower-edge";
  if (Math.abs(spot - map.center) <= 10) return "center";
  return spot > map.center ? "above-center" : "below-center";
}

function estimateIronFlyCredit(rows: ZeroDteChainRow[], center: number, lowerWing: number, upperWing: number): number | null {
  const shortPut = mid(findOption(rows, center, "put"));
  const shortCall = mid(findOption(rows, center, "call"));
  const longPut = mid(findOption(rows, lowerWing, "put"));
  const longCall = mid(findOption(rows, upperWing, "call"));
  if (shortPut == null || shortCall == null || longPut == null || longCall == null) return null;
  const credit = shortPut + shortCall - longPut - longCall;
  return Number.isFinite(credit) && credit > 0 ? round(credit, 2) : null;
}

function findOption(rows: ZeroDteChainRow[], strike: number, optionType: "put" | "call") {
  return rows.find((row) => row.optionType === optionType && Math.abs(row.strike - strike) < 0.01) ?? null;
}

function mid(row: ZeroDteChainRow | null | undefined): number | null {
  if (!row) return null;
  if (Number(row.mid) > 0) return Number(row.mid);
  if (Number(row.bid) > 0 && Number(row.ask) > 0) return (Number(row.bid) + Number(row.ask)) / 2;
  if (Number(row.last) > 0) return Number(row.last);
  return null;
}

function roundToFive(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value / 5) * 5;
}

function round(value: number, digits: number) {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}
