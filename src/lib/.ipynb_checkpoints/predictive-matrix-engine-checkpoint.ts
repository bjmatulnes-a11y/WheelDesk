import { type DealerPressureSummary } from "./dealer-pressure-engine";
import { type OIImpliedPathResult } from "./oi-implied-path-engine";
import { type TraderEdgeSummary } from "./trader-edge-engine";
import { type WallMigrationSummary } from "./oi-wall-migration-engine";

export type PredictiveScenarioKey =
  | "base_pin_magnet"
  | "bullish_unlock"
  | "bearish_failure"
  | "volatility_expansion";

export type PredictiveMatrixRow = {
  key: PredictiveScenarioKey;
  scenario: string;
  probabilityPct: number;
  activation: string;
  expectedTarget: number | null;
  expectedRangeLow: number | null;
  expectedRangeHigh: number | null;
  expectedMovePct: number | null;
  confidence: "low" | "medium" | "high";
  pressureRead: string;
  tradeAction: string;
  invalidation: string;
  why: string[];
};

export type PredictiveMatrixResult = {
  ticker: string;
  snapshotDate: string;
  currentPrice: number;
  horizonSessions: number;
  modelConfidence: "low" | "medium" | "high";
  modelScore: number;
  primaryScenario: PredictiveScenarioKey;
  expectedValueTarget: number | null;
  expectedRangeLow: number | null;
  expectedRangeHigh: number | null;
  bullishUnlock: number | null;
  bearishFailure: number | null;
  rows: PredictiveMatrixRow[];
  readout: string;
  warnings: string[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function normalizeProbabilities(scores: Record<PredictiveScenarioKey, number>): Record<PredictiveScenarioKey, number> {
  const clean = Object.fromEntries(
    Object.entries(scores).map(([key, value]) => [key, Math.max(1, Number.isFinite(value) ? value : 1)])
  ) as Record<PredictiveScenarioKey, number>;

  const total = Object.values(clean).reduce((sum, value) => sum + value, 0) || 1;
  const normalized = Object.fromEntries(
    Object.entries(clean).map(([key, value]) => [key, Math.round((value / total) * 100)])
  ) as Record<PredictiveScenarioKey, number>;

  const drift = 100 - Object.values(normalized).reduce((sum, value) => sum + value, 0);
  const leader = (Object.keys(normalized) as PredictiveScenarioKey[]).sort((a, b) => normalized[b] - normalized[a])[0];
  normalized[leader] += drift;
  return normalized;
}

function confidenceFromScore(score: number): "low" | "medium" | "high" {
  if (score >= 70) return "high";
  if (score >= 50) return "medium";
  return "low";
}

function lastPathValue(points?: { value: number }[]): number | null {
  const last = points?.[points.length - 1]?.value;
  return typeof last === "number" && Number.isFinite(last) ? last : null;
}

function minPathValue(points?: { value: number }[]): number | null {
  const values = (points ?? []).map((point) => point.value).filter(Number.isFinite);
  return values.length ? Math.min(...values) : null;
}

function maxPathValue(points?: { value: number }[]): number | null {
  const values = (points ?? []).map((point) => point.value).filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
}

function movePct(target: number | null, currentPrice: number): number | null {
  if (target == null || !currentPrice) return null;
  return round2(((target - currentPrice) / currentPrice) * 100);
}

function scoreModelConfidence(args: {
  path: OIImpliedPathResult;
  dealer?: DealerPressureSummary | null;
  edge?: TraderEdgeSummary | null;
  wallMigration?: WallMigrationSummary | null;
}): number {
  let score = args.path.confidence === "high" ? 72 : args.path.confidence === "medium" ? 58 : 42;
  if (args.dealer?.confidenceScore != null) score = score * 0.55 + args.dealer.confidenceScore * 0.45;
  if ((args.edge?.dataQualityScore ?? 0) >= 80) score += 6;
  if ((args.edge?.dataQualityScore ?? 100) < 55) score -= 12;
  if (args.wallMigration?.hasPrior) score += 6;
  if (!args.wallMigration?.hasPrior) score -= 7;
  if ((args.edge?.staleDays ?? 0) > 1) score -= Math.min(18, (args.edge?.staleDays ?? 0) * 6);
  if (args.dealer?.regime === "Stale / low confidence") score -= 18;
  return clamp(score, 0, 100);
}

function buildRawScenarioScores(args: {
  path: OIImpliedPathResult;
  dealer?: DealerPressureSummary | null;
  edge?: TraderEdgeSummary | null;
  wallMigration?: WallMigrationSummary | null;
}): Record<PredictiveScenarioKey, number> {
  const { path, dealer, edge, wallMigration } = args;
  const scores: Record<PredictiveScenarioKey, number> = {
    base_pin_magnet: 42,
    bullish_unlock: 24,
    bearish_failure: 24,
    volatility_expansion: 10
  };

  if (path.regime === "pin_chop" || path.regime === "magnet_pull") scores.base_pin_magnet += 16;
  if (path.regime === "bullish_unlock_watch") scores.bullish_unlock += 18;
  if (path.regime === "bearish_failure_watch") scores.bearish_failure += 18;
  if (path.regime === "expansion") scores.volatility_expansion += 18;

  if (path.pathBias === "bullish") {
    scores.bullish_unlock += 12;
    scores.bearish_failure -= 6;
  }
  if (path.pathBias === "bearish") {
    scores.bearish_failure += 12;
    scores.bullish_unlock -= 6;
  }

  if (dealer?.regime === "Volatility suppression / pinning") {
    scores.base_pin_magnet += 18;
    scores.volatility_expansion -= 5;
  }
  if (dealer?.regime === "Pin-to-snap") {
    scores.base_pin_magnet += 7;
    scores.bullish_unlock += 7;
    scores.bearish_failure += 7;
    scores.volatility_expansion += 6;
  }
  if (dealer?.regime === "Volatility expansion / amplification") {
    scores.volatility_expansion += 18;
    scores.bullish_unlock += dealer.hedgeFlowBias === "bullish" ? 9 : 2;
    scores.bearish_failure += dealer.hedgeFlowBias === "bearish" ? 9 : 2;
    scores.base_pin_magnet -= 10;
  }

  if (dealer?.hedgeFlowBias === "bullish") scores.bullish_unlock += 10;
  if (dealer?.hedgeFlowBias === "bearish") scores.bearish_failure += 10;
  if (dealer?.hedgeFlowBias === "neutral") scores.base_pin_magnet += 7;
  if (dealer?.hedgeFlowBias === "conflict") scores.volatility_expansion += 8;

  if (wallMigration?.migrationBias === "bullish") scores.bullish_unlock += 15;
  if (wallMigration?.migrationBias === "bearish") scores.bearish_failure += 15;
  if (wallMigration?.migrationBias === "compression") scores.base_pin_magnet += 12;
  if (wallMigration?.migrationBias === "expansion") scores.volatility_expansion += 12;

  if ((edge?.trapRisk ?? 0) >= 70) {
    scores.volatility_expansion += 8;
    scores.base_pin_magnet -= 5;
  }
  if (edge?.compressionState === "High compression") {
    scores.base_pin_magnet += 8;
    scores.volatility_expansion += 8;
  }
  if ((edge?.volumeThrust ?? 1) >= 1.35) {
    if (path.pathBias === "bullish") scores.bullish_unlock += 8;
    if (path.pathBias === "bearish") scores.bearish_failure += 8;
    scores.volatility_expansion += 5;
  }

  return scores;
}

function rowConfidence(modelScore: number, probabilityPct: number): "low" | "medium" | "high" {
  return confidenceFromScore(modelScore * 0.65 + probabilityPct * 0.35);
}

function rangeLow(...values: Array<number | null | undefined>): number | null {
  const clean = values.filter((value): value is number => value != null && Number.isFinite(value));
  return clean.length ? round2(Math.min(...clean)) : null;
}

function rangeHigh(...values: Array<number | null | undefined>): number | null {
  const clean = values.filter((value): value is number => value != null && Number.isFinite(value));
  return clean.length ? round2(Math.max(...clean)) : null;
}

export function buildPredictiveMatrix(args: {
  path: OIImpliedPathResult | null;
  dealerPressure?: DealerPressureSummary | null;
  edgeSummary?: TraderEdgeSummary | null;
  wallMigration?: WallMigrationSummary | null;
}): PredictiveMatrixResult | null {
  const path = args.path;
  if (!path) return null;

  const dealer = args.dealerPressure ?? null;
  const edge = args.edgeSummary ?? null;
  const wall = args.wallMigration ?? null;
  const modelScore = scoreModelConfidence({ path, dealer, edge, wallMigration: wall });
  const probabilities = normalizeProbabilities(buildRawScenarioScores({ path, dealer, edge, wallMigration: wall }));

  const current = path.currentPrice;
  const baseTarget = round2(lastPathValue(path.basePath));
  const baseLow = round2(minPathValue(path.lowerBand));
  const baseHigh = round2(maxPathValue(path.upperBand));
  const bullTarget = round2(lastPathValue(path.bullishUnlockPath));
  const bullLow = rangeLow(path.invalidAbove, minPathValue(path.bullishUnlockPath));
  const bullHigh = rangeHigh(path.invalidAbove, maxPathValue(path.bullishUnlockPath));
  const bearTarget = round2(lastPathValue(path.bearishFailurePath));
  const bearLow = rangeLow(path.invalidBelow, minPathValue(path.bearishFailurePath));
  const bearHigh = rangeHigh(path.invalidBelow, maxPathValue(path.bearishFailurePath));

  const expansionTarget = path.pathBias === "bearish" ? bearTarget : path.pathBias === "bullish" ? bullTarget : baseTarget;
  const expansionLow = rangeLow(baseLow, bearLow);
  const expansionHigh = rangeHigh(baseHigh, bullHigh);

  const rows: PredictiveMatrixRow[] = [
    {
      key: "base_pin_magnet",
      scenario: "Base / pin-magnet path",
      probabilityPct: probabilities.base_pin_magnet,
      activation: edge?.support != null && edge.resistance != null ? `Stays inside ${edge.support.toFixed(2)}–${edge.resistance.toFixed(2)}` : "Price remains inside the active OI range",
      expectedTarget: baseTarget,
      expectedRangeLow: baseLow,
      expectedRangeHigh: baseHigh,
      expectedMovePct: movePct(baseTarget, current),
      confidence: rowConfidence(modelScore, probabilities.base_pin_magnet),
      pressureRead: "Mean reversion, chop, or controlled drift while OI rails hold.",
      tradeAction: "Favor premium outside the active range; avoid selling directly at the magnet.",
      invalidation: path.invalidAbove != null && path.invalidBelow != null ? `Acceptance above ${path.invalidAbove.toFixed(2)} or loss of ${path.invalidBelow.toFixed(2)}` : "A clean rail break with acceptance",
      why: [
        path.baseCase,
        dealer?.regime ? `Dealer regime: ${dealer.regime}.` : "Dealer-pressure read unavailable.",
        wall?.label ? `Migration: ${wall.label}.` : "Wall migration unavailable."
      ]
    },
    {
      key: "bullish_unlock",
      scenario: "Bullish unlock",
      probabilityPct: probabilities.bullish_unlock,
      activation: path.invalidAbove != null ? `Accepts above ${path.invalidAbove.toFixed(2)}` : "Accepts above call wall / resistance",
      expectedTarget: bullTarget,
      expectedRangeLow: bullLow,
      expectedRangeHigh: bullHigh,
      expectedMovePct: movePct(bullTarget, current),
      confidence: rowConfidence(modelScore, probabilities.bullish_unlock),
      pressureRead: "Upside rail converts from resistance into potential fuel.",
      tradeAction: "Avoid tight covered calls; let long upside/repair structures work after acceptance.",
      invalidation: "Fails back below the old resistance/unlock rail.",
      why: [
        path.bullishUnlockCase,
        dealer?.hedgeFlowBias === "bullish" ? "Dealer-pressure bias leans bullish." : `Dealer hedge-flow bias: ${dealer?.hedgeFlowBias ?? "unknown"}.`,
        wall?.resistanceDirection ? `Resistance migration: ${wall.resistanceDirection}.` : "Resistance migration unavailable."
      ]
    },
    {
      key: "bearish_failure",
      scenario: "Bearish failure",
      probabilityPct: probabilities.bearish_failure,
      activation: path.invalidBelow != null ? `Loses ${path.invalidBelow.toFixed(2)}` : "Loses put wall / support",
      expectedTarget: bearTarget,
      expectedRangeLow: bearLow,
      expectedRangeHigh: bearHigh,
      expectedMovePct: movePct(bearTarget, current),
      confidence: rowConfidence(modelScore, probabilities.bearish_failure),
      pressureRead: "Support converts from floor into overhead risk; put support is no longer safe.",
      tradeAction: "Pause CSPs or move them lower; defend short puts and avoid averaging into the break.",
      invalidation: "Reclaims broken support and holds above it.",
      why: [
        path.bearishFailureCase,
        dealer?.hedgeFlowBias === "bearish" ? "Dealer-pressure bias leans bearish." : `Dealer hedge-flow bias: ${dealer?.hedgeFlowBias ?? "unknown"}.`,
        wall?.supportDirection ? `Support migration: ${wall.supportDirection}.` : "Support migration unavailable."
      ]
    },
    {
      key: "volatility_expansion",
      scenario: "Volatility expansion / snap",
      probabilityPct: probabilities.volatility_expansion,
      activation: dealer?.regime === "Volatility expansion / amplification" ? "Expansion regime already active" : "Pin-to-snap behavior or fast rail break",
      expectedTarget: expansionTarget,
      expectedRangeLow: expansionLow,
      expectedRangeHigh: expansionHigh,
      expectedMovePct: movePct(expansionTarget, current),
      confidence: rowConfidence(modelScore, probabilities.volatility_expansion),
      pressureRead: "Movement risk is greater than pin risk; static walls may not contain price.",
      tradeAction: "Reduce naked short-premium aggression; prefer defined risk or wait for the new range.",
      invalidation: "Price rejects both rails and returns to low-volume chop near the magnet.",
      why: [
        dealer ? `Snap risk ${dealer.snapRiskScore.toFixed(0)} / 100, pin risk ${dealer.pinRiskScore.toFixed(0)} / 100.` : "Dealer snap/pin scores unavailable.",
        edge?.trapRisk != null ? `Trap risk ${edge.trapRisk.toFixed(0)} / 100.` : "Trap risk unavailable.",
        path.regime === "expansion" ? "OI path regime already flags expansion." : `OI path regime: ${path.regime.replace(/_/g, " ")}.`
      ]
    }
  ];

  rows.sort((a, b) => b.probabilityPct - a.probabilityPct);

  const primaryScenario = rows[0].key;
  const weightedTargets = rows
    .filter((row) => row.expectedTarget != null)
    .map((row) => ({ target: row.expectedTarget as number, weight: row.probabilityPct }));
  const weightSum = weightedTargets.reduce((sum, row) => sum + row.weight, 0);
  const expectedValueTarget = weightSum > 0
    ? round2(weightedTargets.reduce((sum, row) => sum + row.target * row.weight, 0) / weightSum)
    : null;

  const expectedRangeLow = rangeLow(...rows.map((row) => row.expectedRangeLow));
  const expectedRangeHigh = rangeHigh(...rows.map((row) => row.expectedRangeHigh));

  const warnings: string[] = [];
  if (modelScore < 50) warnings.push("Model confidence is low; refresh candles/OI before trading from the matrix.");
  if (!wall?.hasPrior) warnings.push("Only one OI surface is available; migration-based prediction is limited.");
  if (dealer?.regime === "Stale / low confidence") warnings.push("Dealer-pressure input is stale or low-confidence.");
  if ((edge?.trapRisk ?? 0) >= 75) warnings.push("Trap risk is high; do not treat the highest-probability row as deterministic.");

  const readout = `${rows[0].scenario} is the lead scenario at ${rows[0].probabilityPct}%. Expected-value target is ${expectedValueTarget != null ? expectedValueTarget.toFixed(2) : "N/A"} over ${path.horizonSessions} sessions, bounded by ${expectedRangeLow != null ? expectedRangeLow.toFixed(2) : "N/A"}–${expectedRangeHigh != null ? expectedRangeHigh.toFixed(2) : "N/A"}.`;

  return {
    ticker: path.ticker,
    snapshotDate: path.snapshotDate,
    currentPrice: current,
    horizonSessions: path.horizonSessions,
    modelConfidence: confidenceFromScore(modelScore),
    modelScore: round2(modelScore) ?? 0,
    primaryScenario,
    expectedValueTarget,
    expectedRangeLow,
    expectedRangeHigh,
    bullishUnlock: path.invalidAbove,
    bearishFailure: path.invalidBelow,
    rows,
    readout,
    warnings
  };
}
