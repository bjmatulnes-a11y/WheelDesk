export type OptionType = "call" | "put";
export type ZeroDteSymbol = "SPX" | "SPY" | "SPY_EQUIV" | "COMPOSITE";

export type ZeroDteChainRow = {
  symbol: "SPX" | "SPY" | "SPY_EQUIV";
  strike: number;
  optionType: OptionType;
  expiration?: string | null;
  openInterest?: number | null;
  volume?: number | null;
  iv?: number | null;
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  bid?: number | null;
  ask?: number | null;
  mid?: number | null;
  last?: number | null;
};

export type OiCluster = {
  strike: number;
  callOi: number;
  putOi: number;
  totalOi: number;
  callVolume: number;
  putVolume: number;
  totalVolume: number;
  callGammaWeight: number;
  putGammaWeight: number;
  gammaWeight: number;
  score: number;
};

export type SymbolOiIntelligence = {
  symbol: ZeroDteSymbol;
  spot: number;
  gravity: number | null;
  strongestPin: number | null;
  callWall: number | null;
  putWall: number | null;
  oiStrength: number;
  symmetryScore: number;
  callOiAboveSpot: number;
  putOiBelowSpot: number;
  callPutImbalance: number;
  clusters: OiCluster[];
};

export type ZeroDteRecommendation = {
  spxPrice: number;
  spyPrice: number;
  expectedMove: number;
  suggestedCenter: number;
  suggestedWingWidth: number;
  lowerWing: number;
  upperWing: number;
  alignmentScore: number;
  confidenceScore: number;
  dealerPressure: number;
  pressureBias: "up" | "down" | "neutral";
  spx: SymbolOiIntelligence;
  spyEquivalent: SymbolOiIntelligence;
  composite: SymbolOiIntelligence;
  management: string;
  notes: string[];
};

export type BuildZeroDteInput = {
  spxPrice: number;
  spyPrice: number;
  spxRows: ZeroDteChainRow[];
  spyRows: ZeroDteChainRow[];
  manualExpectedMove?: number | null;
};

export function buildZeroDteRecommendation(input: BuildZeroDteInput): ZeroDteRecommendation {
  const { spxPrice, spyPrice, spxRows, spyRows, manualExpectedMove } = input;

  const spyEquivalentRows = convertSpyRowsToSpx(spyRows, spxPrice, spyPrice);

  const spx = buildOiIntelligence("SPX", spxPrice, spxRows);
  const spyEquivalent = buildOiIntelligence("SPY_EQUIV", spxPrice, spyEquivalentRows);
  const composite = buildOiIntelligence("COMPOSITE", spxPrice, [...spxRows, ...spyEquivalentRows]);

  const expectedMove =
    safe(manualExpectedMove) > 0
      ? safe(manualExpectedMove)
      : estimateAtmStraddle(spxRows, spxPrice) ?? estimateAtmStraddle(spyEquivalentRows, spxPrice) ?? 0;

  const alignmentScore = calculateAlignmentScore(spx.gravity, spyEquivalent.gravity, expectedMove || 70);
  const dealerPressure = estimateDealerPressure([...spxRows, ...spyEquivalentRows], spxPrice);
  const pressureBias = dealerPressure > 20 ? "up" : dealerPressure < -20 ? "down" : "neutral";

  const suggestedCenter = chooseIronFlyCenter({
    spot: spxPrice,
    compositeGravity: composite.gravity,
    compositePin: composite.strongestPin,
    dealerPressure,
    alignmentScore,
    symmetryScore: composite.symmetryScore,
  });

  const suggestedWingWidth = roundToFive(Math.max(expectedMove, 50));
  const lowerWing = suggestedCenter - suggestedWingWidth;
  const upperWing = suggestedCenter + suggestedWingWidth;

  const confidenceScore = calculateConfidenceScore({
    alignmentScore,
    oiStrength: composite.oiStrength,
    symmetryScore: composite.symmetryScore,
    dealerPressure,
    spot: spxPrice,
    center: suggestedCenter,
    expectedMove,
  });

  const management = getIronFlyManagement({
    spot: spxPrice,
    center: suggestedCenter,
    wingWidth: suggestedWingWidth,
    expectedMove,
    confidenceScore,
  });

  const notes = buildNotes({
    alignmentScore,
    confidenceScore,
    dealerPressure,
    spx,
    spyEquivalent,
    composite,
    suggestedCenter,
    lowerWing,
    upperWing,
  });

  return {
    spxPrice,
    spyPrice,
    expectedMove,
    suggestedCenter,
    suggestedWingWidth,
    lowerWing,
    upperWing,
    alignmentScore,
    confidenceScore,
    dealerPressure,
    pressureBias,
    spx,
    spyEquivalent,
    composite,
    management,
    notes,
  };
}

export function buildOiIntelligence(
  symbol: ZeroDteSymbol,
  spot: number,
  rows: ZeroDteChainRow[]
): SymbolOiIntelligence {
  const clusters = buildClusters(rows);
  const sortedByScore = [...clusters].sort((a, b) => b.score - a.score);
  const strongestPin = sortedByScore[0]?.strike ?? null;

  const callWall = strongestBySide(clusters, "call");
  const putWall = strongestBySide(clusters, "put");
  const gravity = calculateOiGravity(clusters);
  const oiStrength = calculateOiStrength(clusters);
  const symmetryScore = calculateSymmetryScore({ spot, callWall, putWall });

  const callOiAboveSpot = clusters
    .filter((c) => c.strike >= spot)
    .reduce((sum, c) => sum + c.callOi, 0);

  const putOiBelowSpot = clusters
    .filter((c) => c.strike <= spot)
    .reduce((sum, c) => sum + c.putOi, 0);

  const callPutImbalance = percentImbalance(callOiAboveSpot, putOiBelowSpot);

  return {
    symbol,
    spot,
    gravity,
    strongestPin,
    callWall,
    putWall,
    oiStrength,
    symmetryScore,
    callOiAboveSpot,
    putOiBelowSpot,
    callPutImbalance,
    clusters: sortedByScore,
  };
}

export function convertSpyRowsToSpx(
  spyRows: ZeroDteChainRow[],
  spxPrice: number,
  spyPrice: number
): ZeroDteChainRow[] {
  const ratio = spyPrice > 0 ? spxPrice / spyPrice : 10;

  return spyRows.map((row) => ({
    ...row,
    symbol: "SPY_EQUIV",
    strike: row.strike * ratio,
  }));
}

function buildClusters(rows: ZeroDteChainRow[]): OiCluster[] {
  const map = new Map<number, OiCluster>();

  for (const row of rows) {
    const strike = roundToFive(row.strike);
    const existing = map.get(strike) ?? {
      strike,
      callOi: 0,
      putOi: 0,
      totalOi: 0,
      callVolume: 0,
      putVolume: 0,
      totalVolume: 0,
      callGammaWeight: 0,
      putGammaWeight: 0,
      gammaWeight: 0,
      score: 0,
    };

    const oi = safe(row.openInterest);
    const volume = safe(row.volume);
    const gammaWeight = Math.abs(safe(row.gamma)) * Math.max(oi + volume * 0.35, 1) * 1000;

    if (row.optionType === "call") {
      existing.callOi += oi;
      existing.callVolume += volume;
      existing.callGammaWeight += gammaWeight;
    } else {
      existing.putOi += oi;
      existing.putVolume += volume;
      existing.putGammaWeight += gammaWeight;
    }

    existing.totalOi += oi;
    existing.totalVolume += volume;
    existing.gammaWeight += gammaWeight;
    existing.score = existing.totalOi + existing.totalVolume * 0.35 + existing.gammaWeight;

    map.set(strike, existing);
  }

  return [...map.values()];
}

function strongestBySide(clusters: OiCluster[], side: OptionType) {
  if (!clusters.length) return null;

  return [...clusters]
    .map((cluster) => ({
      strike: cluster.strike,
      score:
        side === "call"
          ? cluster.callOi + cluster.callVolume * 0.35 + cluster.callGammaWeight
          : cluster.putOi + cluster.putVolume * 0.35 + cluster.putGammaWeight,
    }))
    .sort((a, b) => b.score - a.score)[0]?.strike ?? null;
}

function calculateOiGravity(clusters: OiCluster[]) {
  const totalScore = clusters.reduce((sum, c) => sum + c.score, 0);
  if (!totalScore) return null;

  const weighted = clusters.reduce((sum, c) => sum + c.strike * c.score, 0);
  return roundToFive(weighted / totalScore);
}

function calculateOiStrength(clusters: OiCluster[]) {
  if (!clusters.length) return 0;
  const total = clusters.reduce((sum, c) => sum + c.score, 0);
  if (!total) return 0;

  const topThree = [...clusters]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .reduce((sum, c) => sum + c.score, 0);

  return clamp(Math.round((topThree / total) * 100), 0, 100);
}

function calculateSymmetryScore(args: {
  spot: number;
  callWall: number | null;
  putWall: number | null;
}) {
  const { spot, callWall, putWall } = args;
  if (!callWall || !putWall || callWall <= spot || putWall >= spot) return 35;

  const upside = Math.abs(callWall - spot);
  const downside = Math.abs(spot - putWall);
  const bigger = Math.max(upside, downside);
  const smaller = Math.min(upside, downside);
  if (!bigger) return 100;

  return clamp(Math.round((smaller / bigger) * 100), 0, 100);
}

function calculateAlignmentScore(
  spxGravity: number | null,
  spyGravity: number | null,
  expectedMove: number
) {
  if (!spxGravity || !spyGravity) return 50;

  const distance = Math.abs(spxGravity - spyGravity);
  const tolerance = Math.max(expectedMove * 0.75, 30);

  return clamp(Math.round(100 - (distance / tolerance) * 100), 0, 100);
}

function estimateDealerPressure(rows: ZeroDteChainRow[], spot: number) {
  let pressure = 0;

  for (const row of rows) {
    const distanceWeight = Math.max(0, 1 - Math.abs(row.strike - spot) / 175);
    const gamma = safe(row.gamma);
    const oi = safe(row.openInterest);
    const volume = safe(row.volume);
    const side = row.optionType === "call" ? 1 : -1;

    pressure += side * gamma * (oi + volume * 0.5) * distanceWeight;
  }

  return clamp(Math.round(pressure / 1000), -100, 100);
}

function chooseIronFlyCenter(args: {
  spot: number;
  compositeGravity: number | null;
  compositePin: number | null;
  dealerPressure: number;
  alignmentScore: number;
  symmetryScore: number;
}) {
  const { spot, compositeGravity, compositePin, dealerPressure, alignmentScore, symmetryScore } = args;

  let center = spot;

  if (compositeGravity) center = center * 0.30 + compositeGravity * 0.70;
  if (compositePin) center = center * 0.80 + compositePin * 0.20;

  center += clamp(dealerPressure * 0.12, -15, 15);

  if (alignmentScore < 55 || symmetryScore < 45) {
    center = center * 0.6 + spot * 0.4;
  }

  return roundToFive(center);
}

function calculateConfidenceScore(args: {
  alignmentScore: number;
  oiStrength: number;
  symmetryScore: number;
  dealerPressure: number;
  spot: number;
  center: number;
  expectedMove: number;
}) {
  const { alignmentScore, oiStrength, symmetryScore, dealerPressure, spot, center, expectedMove } = args;

  let score = 0;
  score += alignmentScore * 0.35;
  score += oiStrength * 0.25;
  score += symmetryScore * 0.25;

  const pressurePenalty = Math.min(Math.abs(dealerPressure), 70) * 0.22;
  score += 20 - pressurePenalty;

  if (expectedMove > 0) {
    const centerDistance = Math.abs(center - spot);
    if (centerDistance > expectedMove * 0.45) score -= 15;
  }

  return clamp(Math.round(score), 0, 100);
}

function estimateAtmStraddle(rows: ZeroDteChainRow[], spot: number) {
  const atm = roundToFive(spot);
  const call = rows.find((r) => r.optionType === "call" && roundToFive(r.strike) === atm);
  const put = rows.find((r) => r.optionType === "put" && roundToFive(r.strike) === atm);

  const callMid = getMid(call);
  const putMid = getMid(put);

  if (!callMid || !putMid) return null;
  return callMid + putMid;
}

export function getIronFlyManagement(args: {
  spot: number;
  center: number;
  wingWidth: number;
  expectedMove: number;
  confidenceScore: number;
}) {
  const { spot, center, wingWidth, expectedMove, confidenceScore } = args;
  const distance = Math.abs(spot - center);
  const emUsed = expectedMove > 0 ? distance / expectedMove : 0;

  if (confidenceScore < 45) return "Low confidence. Avoid opening full-size iron fly.";
  if (distance > wingWidth * 0.6) return "High risk. Spot is approaching the long wing.";
  if (emUsed >= 0.75) return "Defensive action. Price has consumed over 75% of expected move.";
  if (emUsed >= 0.5) return "Caution. Price has consumed over 50% of expected move.";
  if (emUsed < 0.35 && confidenceScore >= 65) return "Hold. Price remains inside favorable pin zone.";
  return "Neutral. Continue monitoring.";
}

function buildNotes(args: {
  alignmentScore: number;
  confidenceScore: number;
  dealerPressure: number;
  spx: SymbolOiIntelligence;
  spyEquivalent: SymbolOiIntelligence;
  composite: SymbolOiIntelligence;
  suggestedCenter: number;
  lowerWing: number;
  upperWing: number;
}) {
  const notes: string[] = [];

  if (args.confidenceScore >= 70) notes.push("High-confidence iron fly footprint.");
  else if (args.confidenceScore >= 55) notes.push("Moderate confidence; size conservatively.");
  else notes.push("Low confidence; wait or favor directional credit-spread logic instead of an iron fly.");

  if (args.alignmentScore >= 75) notes.push("SPX and SPY OI gravity are aligned.");
  else if (args.alignmentScore <= 45) notes.push("SPX and SPY OI gravity conflict.");

  if (args.dealerPressure > 25) notes.push("Dealer pressure leans upward; center may need an upside adjustment.");
  else if (args.dealerPressure < -25) notes.push("Dealer pressure leans downward; center may need a downside adjustment.");
  else notes.push("Dealer pressure is relatively neutral, which supports pin behavior.");

  notes.push(`SPX gravity: ${fmt(args.spx.gravity)}. SPY-equivalent gravity: ${fmt(args.spyEquivalent.gravity)}. Composite gravity: ${fmt(args.composite.gravity)}.`);
  notes.push(`Suggested IF: ${args.lowerWing} / ${args.suggestedCenter} / ${args.upperWing}.`);

  return notes;
}

function getMid(row?: ZeroDteChainRow) {
  if (!row) return null;
  if (safe(row.mid) > 0) return safe(row.mid);
  if (safe(row.bid) > 0 && safe(row.ask) > 0) return (safe(row.bid) + safe(row.ask)) / 2;
  if (safe(row.last) > 0) return safe(row.last);
  return null;
}

function percentImbalance(a: number, b: number) {
  const total = a + b;
  if (!total) return 0;
  return Math.round(((a - b) / total) * 100);
}

function roundToFive(n: number) {
  return Math.round(n / 5) * 5;
}

function safe(n: number | null | undefined) {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return "N/A";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
}
