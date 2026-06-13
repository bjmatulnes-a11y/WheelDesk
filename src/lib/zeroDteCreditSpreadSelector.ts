import type { SpxOiMapRow, ZeroDteRecommendation } from "./zeroDteOiIntelligence";
import type { ZeroDteMoodRead } from "./zeroDteMoodEngine";

export type CreditSpreadSide = "put" | "call";
export type CreditSpreadRiskMode = "conservative" | "balanced" | "aggressive";

export type ZeroDteCreditSpreadSelection = {
  tradeType: "put-credit-spread" | "call-credit-spread";
  side: CreditSpreadSide;
  shortStrike: number | null;
  longStrike: number | null;
  width: number;
  confidence: number;
  riskMode: CreditSpreadRiskMode;
  aggression: "low" | "medium" | "high";
  score: number;
  expectedMoveRemaining: number;
  distanceFromSpot: number | null;
  distanceAsExpectedMovePct: number | null;
  wall: number | null;
  wallRelationship: string;
  reasons: string[];
  warnings: string[];
  candidates: CreditSpreadCandidate[];
};

export type CreditSpreadCandidate = {
  strike: number;
  longStrike: number;
  score: number;
  confidence: number;
  distanceFromSpot: number;
  distanceAsExpectedMovePct: number;
  oiScore: number;
  wallScore: number;
  dealerScore: number;
  spyScore: number;
  premiumProxy: number;
  reasons: string[];
};

export type SelectCreditSpreadInput = {
  recommendation: ZeroDteRecommendation;
  mood: ZeroDteMoodRead;
  side: CreditSpreadSide;
  width?: number | null;
  riskMode?: CreditSpreadRiskMode;
  minDistancePctOfExpectedMove?: number;
  maxDistancePctOfExpectedMove?: number;
};

export function selectZeroDteCreditSpread(input: SelectCreditSpreadInput): ZeroDteCreditSpreadSelection {
  const rec = input.recommendation;
  const side = input.side;
  const width = normalizeWidth(input.width ?? 20);
  const riskMode = input.riskMode ?? "balanced";
  const expectedMoveRemaining = Math.max(rec.expectedMove || 0, 1);
  const spot = rec.spxPrice;
  const wall = side === "put" ? rec.spx.putWall : rec.spx.callWall;
  const dealerPressure = rec.dealerPressure;
  const minPct = input.minDistancePctOfExpectedMove ?? minPctForRiskMode(riskMode);
  const maxPct = input.maxDistancePctOfExpectedMove ?? maxPctForRiskMode(riskMode);

  const candidates = rec.spxChainMap
    .filter((row) => isCandidateSide(row, side, spot))
    .map((row) => scoreCandidate({ row, rec, side, width, riskMode, expectedMoveRemaining, wall, dealerPressure, minPct, maxPct }))
    .sort((a, b) => b.score - a.score || Math.abs(a.distanceAsExpectedMovePct - 0.75) - Math.abs(b.distanceAsExpectedMovePct - 0.75));

  const best = candidates[0] ?? null;
  const warnings: string[] = [];
  const reasons: string[] = [];

  if (!best) {
    warnings.push(`No usable ${side === "put" ? "put" : "call"} credit spread short-strike candidate was found on the SPX OI map.`);
  } else {
    reasons.push(...best.reasons);
  }

  if (input.mood.coverageScore < 60 && input.mood.source !== "manual-tos-mood") {
    warnings.push("Mood input is partial. Use TOS mood override or internals before sizing this as a high-conviction credit spread.");
  }

  if (side === "put" && dealerPressure < -20) {
    warnings.push("Dealer pressure is negative, which conflicts with a bullish put credit spread.");
  }
  if (side === "call" && dealerPressure > 20) {
    warnings.push("Dealer pressure is positive, which conflicts with a bearish call credit spread.");
  }

  const confidence = best ? Math.round(clamp(best.confidence * 0.72 + input.mood.confidence * 0.18 + rec.confidenceScore * 0.1, 0, 100)) : 0;

  return {
    tradeType: side === "put" ? "put-credit-spread" : "call-credit-spread",
    side,
    shortStrike: best?.strike ?? null,
    longStrike: best?.longStrike ?? null,
    width,
    confidence,
    riskMode,
    aggression: aggressionForRiskMode(riskMode, rec.dealerPressure, input.mood.moodPercent),
    score: best?.score ?? 0,
    expectedMoveRemaining,
    distanceFromSpot: best?.distanceFromSpot ?? null,
    distanceAsExpectedMovePct: best?.distanceAsExpectedMovePct ?? null,
    wall,
    wallRelationship: best ? describeWallRelationship(side, best.strike, wall) : "No short strike selected.",
    reasons,
    warnings,
    candidates: candidates.slice(0, 8),
  };
}

function scoreCandidate(args: {
  row: SpxOiMapRow;
  rec: ZeroDteRecommendation;
  side: CreditSpreadSide;
  width: number;
  riskMode: CreditSpreadRiskMode;
  expectedMoveRemaining: number;
  wall: number | null;
  dealerPressure: number;
  minPct: number;
  maxPct: number;
}): CreditSpreadCandidate {
  const { row, rec, side, width, expectedMoveRemaining, wall, dealerPressure, minPct, maxPct } = args;
  const spot = rec.spxPrice;
  const distanceFromSpot = Math.abs(spot - row.strike);
  const distanceAsExpectedMovePct = distanceFromSpot / expectedMoveRemaining;
  const longStrike = findLongStrike(rec.spxChainMap, row.strike, side, width);

  const oiMagnitude = Math.max(...rec.spxChainMap.map((r) => Math.max(r.callOi, r.putOi, r.totalOi)), 1);
  const sideOi = side === "put" ? row.putOi : row.callOi;
  const totalOi = row.totalOi;
  const gamma = row.gammaWeight;

  const oiScore = clamp((sideOi / oiMagnitude) * 42 + (totalOi / oiMagnitude) * 18 + Math.min(gamma / Math.max(oiMagnitude, 1), 1) * 10, 0, 70);
  const distanceScore = scoreDistance(distanceAsExpectedMovePct, minPct, maxPct);
  const wallScore = scoreWall(side, row.strike, wall, expectedMoveRemaining);
  const dealerScore = scoreDealer(side, dealerPressure);
  const spyScore = row.spyAlignment === "aligned" ? 12 : row.spyAlignment === "near" ? 6 : 0;
  const sideBiasScore = scoreSideBias(side, row);
  const premiumProxy = scorePremiumProxy(distanceAsExpectedMovePct, row.totalVolume, rec.spxChainMap);

  const score = clamp(
    oiScore * 0.28 +
      distanceScore * 0.26 +
      wallScore * 0.18 +
      dealerScore * 0.13 +
      spyScore * 0.07 +
      sideBiasScore * 0.05 +
      premiumProxy * 0.03,
    0,
    100
  );

  const reasons: string[] = [];
  reasons.push(`${row.strike} is ${distanceFromSpot.toFixed(1)} points from spot (${Math.round(distanceAsExpectedMovePct * 100)}% of expected move).`);
  if (wall) reasons.push(describeWallRelationship(side, row.strike, wall));
  if (row.spyAlignment !== "none") reasons.push(`SPY confirmation is ${row.spyAlignment} near this SPX strike.`);
  if (side === "put" && dealerPressure > 20) reasons.push("Dealer pressure supports bullish/neutral put-spread placement.");
  if (side === "call" && dealerPressure < -20) reasons.push("Dealer pressure supports bearish/neutral call-spread placement.");
  if (sideOi > 0) reasons.push(`Side-specific OI at strike is ${Math.round(sideOi).toLocaleString()}.`);

  return {
    strike: row.strike,
    longStrike,
    score: Math.round(score),
    confidence: Math.round(clamp(score * 0.8 + distanceScore * 0.2, 0, 100)),
    distanceFromSpot,
    distanceAsExpectedMovePct,
    oiScore: Math.round(oiScore),
    wallScore: Math.round(wallScore),
    dealerScore: Math.round(dealerScore),
    spyScore: Math.round(spyScore),
    premiumProxy: Math.round(premiumProxy),
    reasons,
  };
}

function isCandidateSide(row: SpxOiMapRow, side: CreditSpreadSide, spot: number) {
  if (!Number.isFinite(row.strike)) return false;
  if (side === "put") return row.strike < spot;
  return row.strike > spot;
}

function scoreDistance(pct: number, minPct: number, maxPct: number) {
  if (!Number.isFinite(pct)) return 0;
  if (pct < minPct) return Math.max(0, 55 * (pct / Math.max(minPct, 0.01)));
  if (pct > maxPct) return Math.max(0, 100 - (pct - maxPct) * 75);
  const target = (minPct + maxPct) / 2;
  const halfRange = Math.max((maxPct - minPct) / 2, 0.01);
  return clamp(100 - (Math.abs(pct - target) / halfRange) * 24, 70, 100);
}

function scoreWall(side: CreditSpreadSide, strike: number, wall: number | null, expectedMove: number) {
  if (!wall) return 45;
  const distance = Math.abs(strike - wall);
  const nearBonus = Math.max(0, 25 - distance);

  if (side === "put") {
    if (strike <= wall) return clamp(78 + nearBonus, 0, 100);
    return clamp(48 - Math.min(35, ((strike - wall) / expectedMove) * 70), 0, 100);
  }

  if (strike >= wall) return clamp(78 + nearBonus, 0, 100);
  return clamp(48 - Math.min(35, ((wall - strike) / expectedMove) * 70), 0, 100);
}

function scoreDealer(side: CreditSpreadSide, pressure: number) {
  if (side === "put") return clamp(55 + pressure * 0.55, 0, 100);
  return clamp(55 - pressure * 0.55, 0, 100);
}

function scoreSideBias(side: CreditSpreadSide, row: SpxOiMapRow) {
  if (side === "put" && row.sideBias === "put") return 12;
  if (side === "call" && row.sideBias === "call") return 12;
  if (row.sideBias === "balanced") return 7;
  return 0;
}

function scorePremiumProxy(distancePct: number, volume: number, rows: SpxOiMapRow[]) {
  const maxVol = Math.max(...rows.map((r) => r.totalVolume), 1);
  const distance = clamp(100 - Math.abs(distancePct - 0.55) * 95, 0, 100);
  const vol = clamp((volume / maxVol) * 100, 0, 100);
  return distance * 0.75 + vol * 0.25;
}

function findLongStrike(rows: SpxOiMapRow[], shortStrike: number, side: CreditSpreadSide, width: number) {
  const target = side === "put" ? shortStrike - width : shortStrike + width;
  const candidates = rows.map((r) => r.strike).filter((s) => (side === "put" ? s < shortStrike : s > shortStrike));
  if (!candidates.length) return roundToFive(target);
  return candidates.sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0] ?? roundToFive(target);
}

function describeWallRelationship(side: CreditSpreadSide, strike: number, wall: number | null) {
  if (!wall) return "No wall available for this side.";
  if (side === "put") {
    if (strike < wall) return `Short put is below the SPX put wall (${wall}), using OI support as cushion.`;
    if (strike === wall) return `Short put is directly at the SPX put wall (${wall}); higher premium but wall-touch risk.`;
    return `Short put is above the SPX put wall (${wall}); more aggressive placement.`;
  }

  if (strike > wall) return `Short call is above the SPX call wall (${wall}), using OI resistance as cushion.`;
  if (strike === wall) return `Short call is directly at the SPX call wall (${wall}); higher premium but wall-touch risk.`;
  return `Short call is below the SPX call wall (${wall}); more aggressive placement.`;
}

function minPctForRiskMode(mode: CreditSpreadRiskMode) {
  if (mode === "conservative") return 0.65;
  if (mode === "aggressive") return 0.35;
  return 0.5;
}

function maxPctForRiskMode(mode: CreditSpreadRiskMode) {
  if (mode === "conservative") return 1.2;
  if (mode === "aggressive") return 0.9;
  return 1.05;
}

function aggressionForRiskMode(mode: CreditSpreadRiskMode, dealerPressure: number, moodPercent: number | null | undefined): ZeroDteCreditSpreadSelection["aggression"] {
  const absMood = Math.abs(moodPercent ?? 0);
  if (mode === "aggressive" || Math.abs(dealerPressure) > 55 || absMood > 82) return "high";
  if (mode === "conservative" || Math.abs(dealerPressure) < 18 || absMood < 55) return "low";
  return "medium";
}

function normalizeWidth(width: number) {
  if (!Number.isFinite(width) || width <= 0) return 20;
  return Math.max(5, roundToFive(width));
}

function roundToFive(value: number) {
  return Math.round(value / 5) * 5;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
