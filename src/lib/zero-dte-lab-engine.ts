export type ZeroDteSide = "call" | "put";
export type ZeroDteSourceSymbol = "SPX" | "SPY" | "SPY_EQUIV";

export type ZeroDteChainRow = {
  sourceSymbol: ZeroDteSourceSymbol;
  providerSymbol: string;
  expiration: string;
  strike: number;
  optionType: ZeroDteSide;
  openInterest: number;
  volume: number;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta?: number | null;
  bid: number | null;
  ask: number | null;
  last: number | null;
  mid: number | null;
  contractSymbol?: string | null;
  underlyingPrice: number;
  notionalWeight: number;
};

export type OiCluster = {
  strike: number;
  callOi: number;
  putOi: number;
  totalOi: number;
  callVolume: number;
  putVolume: number;
  totalVolume: number;
  callScore: number;
  putScore: number;
  totalScore: number;
  gammaExposure: number;
};

export type OiIntelligence = {
  label: "SPX" | "SPY_EQUIV" | "COMPOSITE";
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
  topClusters: OiCluster[];
};

export type ZeroDteLabRecommendation = {
  generatedAt: string;
  expirationDate: string;
  isZeroDte: boolean;
  provider: string;
  spxProviderSymbol: string;
  spyProviderSymbol: string;
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
  dealerPressureLabel: "downside" | "neutral" | "upside";
  spx: OiIntelligence;
  spyEquivalent: OiIntelligence;
  composite: OiIntelligence;
  management: string;
  notes: string[];
  warnings: string[];
  rawRowCount: number;
};

export type BuildZeroDteLabInput = {
  generatedAt?: string;
  expirationDate: string;
  targetDate: string;
  spxProviderSymbol: string;
  spyProviderSymbol: string;
  spxPrice: number;
  spyPrice: number;
  spxRows: ZeroDteChainRow[];
  spyRows: ZeroDteChainRow[];
  manualExpectedMove?: number | null;
};

export function buildZeroDteLabRecommendation(input: BuildZeroDteLabInput): ZeroDteLabRecommendation {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const spxRows = sanitizeRows(input.spxRows);
  const spyRows = sanitizeRows(input.spyRows);
  const spyEquivalentRows = convertSpyRowsToSpx(spyRows, input.spxPrice, input.spyPrice);
  const combinedRows = [...spxRows, ...spyEquivalentRows];

  const spx = buildOiIntelligence("SPX", input.spxPrice, spxRows);
  const spyEquivalent = buildOiIntelligence("SPY_EQUIV", input.spxPrice, spyEquivalentRows);
  const composite = buildOiIntelligence("COMPOSITE", input.spxPrice, combinedRows);

  const expectedMove =
    positive(input.manualExpectedMove) ??
    estimateAtmStraddle(spxRows, input.spxPrice) ??
    scaleSpyExpectedMove(estimateAtmStraddle(spyRows, input.spyPrice), input.spxPrice, input.spyPrice) ??
    0;

  const alignmentScore = calculateAlignmentScore(spx.gravity, spyEquivalent.gravity, expectedMove || 70);
  const dealerPressure = estimateDealerPressure(combinedRows, input.spxPrice, expectedMove || 70);

  const suggestedCenter = chooseIronFlyCenter({
    spot: input.spxPrice,
    compositeGravity: composite.gravity,
    compositePin: composite.strongestPin,
    dealerPressure,
    alignmentScore,
    symmetryScore: composite.symmetryScore,
    expectedMove,
  });

  const suggestedWingWidth = roundToFive(Math.max(expectedMove, 50));
  const lowerWing = suggestedCenter - suggestedWingWidth;
  const upperWing = suggestedCenter + suggestedWingWidth;

  const confidenceScore = calculateConfidenceScore({
    alignmentScore,
    oiStrength: composite.oiStrength,
    symmetryScore: composite.symmetryScore,
    dealerPressure,
    spot: input.spxPrice,
    center: suggestedCenter,
    expectedMove,
    rowCount: combinedRows.length,
  });

  const warnings = buildWarnings({
    input,
    expectedMove,
    spxRows,
    spyRows,
    alignmentScore,
    confidenceScore,
  });

  const management = getIronFlyManagement({
    spot: input.spxPrice,
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
    generatedAt,
    expirationDate: input.expirationDate,
    isZeroDte: input.expirationDate === input.targetDate,
    provider: "Yahoo Finance delayed options",
    spxProviderSymbol: input.spxProviderSymbol,
    spyProviderSymbol: input.spyProviderSymbol,
    spxPrice: input.spxPrice,
    spyPrice: input.spyPrice,
    expectedMove,
    suggestedCenter,
    suggestedWingWidth,
    lowerWing,
    upperWing,
    alignmentScore,
    confidenceScore,
    dealerPressure,
    dealerPressureLabel: dealerPressure > 20 ? "upside" : dealerPressure < -20 ? "downside" : "neutral",
    spx,
    spyEquivalent,
    composite,
    management,
    notes,
    warnings,
    rawRowCount: combinedRows.length,
  };
}

export function convertSpyRowsToSpx(
  spyRows: ZeroDteChainRow[],
  spxPrice: number,
  spyPrice: number
): ZeroDteChainRow[] {
  const ratio = spyPrice > 0 ? spxPrice / spyPrice : 10;
  const notionalWeight = spyPrice > 0 && spxPrice > 0 ? spyPrice / spxPrice : 0.1;

  return spyRows.map((row) => ({
    ...row,
    sourceSymbol: "SPY_EQUIV",
    strike: row.strike * ratio,
    underlyingPrice: spxPrice,
    notionalWeight,
  }));
}

export function buildOiIntelligence(
  label: OiIntelligence["label"],
  spot: number,
  rows: ZeroDteChainRow[]
): OiIntelligence {
  const clusters = buildClusters(rows, spot);
  const sorted = [...clusters].sort((a, b) => b.totalScore - a.totalScore);
  const strongestPin = sorted[0]?.strike ?? null;
  const callWall = strongestSideWall(clusters, "call");
  const putWall = strongestSideWall(clusters, "put");
  const gravity = calculateGravity(clusters);
  const oiStrength = calculateOiStrength(clusters);
  const symmetryScore = calculateSymmetryScore({ spot, callWall, putWall });

  const callOiAboveSpot = clusters
    .filter((cluster) => cluster.strike >= spot)
    .reduce((sum, cluster) => sum + cluster.callOi, 0);

  const putOiBelowSpot = clusters
    .filter((cluster) => cluster.strike <= spot)
    .reduce((sum, cluster) => sum + cluster.putOi, 0);

  return {
    label,
    spot,
    gravity,
    strongestPin,
    callWall,
    putWall,
    oiStrength,
    symmetryScore,
    callOiAboveSpot,
    putOiBelowSpot,
    callPutImbalance: percentImbalance(callOiAboveSpot, putOiBelowSpot),
    topClusters: sorted.slice(0, 20),
  };
}

function buildClusters(rows: ZeroDteChainRow[], spot: number): OiCluster[] {
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
      callScore: 0,
      putScore: 0,
      totalScore: 0,
      gammaExposure: 0,
    };

    const oi = Math.max(row.openInterest, 0);
    const volume = Math.max(row.volume, 0);
    const notionalWeight = Math.max(row.notionalWeight, 0.0001);
    const distanceWeight = Math.max(0.12, 1 - Math.abs(strike - spot) / Math.max(spot * 0.055, 175));
    const gammaExposure = estimateDollarGamma(row, oi || volume || 1) * distanceWeight;
    const score = (oi + volume * 0.35) * notionalWeight * distanceWeight + gammaExposure / 250000;

    if (row.optionType === "call") {
      existing.callOi += oi;
      existing.callVolume += volume;
      existing.callScore += score;
    } else {
      existing.putOi += oi;
      existing.putVolume += volume;
      existing.putScore += score;
    }

    existing.totalOi += oi;
    existing.totalVolume += volume;
    existing.gammaExposure += gammaExposure;
    existing.totalScore = existing.callScore + existing.putScore;
    map.set(strike, existing);
  }

  return [...map.values()].filter((cluster) => cluster.totalScore > 0);
}

function strongestSideWall(clusters: OiCluster[], side: ZeroDteSide): number | null {
  const key = side === "call" ? "callScore" : "putScore";
  const sorted = [...clusters]
    .filter((cluster) => cluster[key] > 0)
    .sort((a, b) => b[key] - a[key]);
  return sorted[0]?.strike ?? null;
}

function calculateGravity(clusters: OiCluster[]): number | null {
  const totalScore = clusters.reduce((sum, cluster) => sum + cluster.totalScore, 0);
  if (totalScore <= 0) return null;
  const weighted = clusters.reduce((sum, cluster) => sum + cluster.strike * cluster.totalScore, 0);
  return roundToFive(weighted / totalScore);
}

function calculateOiStrength(clusters: OiCluster[]): number {
  const total = clusters.reduce((sum, cluster) => sum + cluster.totalScore, 0);
  if (total <= 0) return 0;
  const topThree = [...clusters]
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, 3)
    .reduce((sum, cluster) => sum + cluster.totalScore, 0);
  return clamp(Math.round((topThree / total) * 100), 0, 100);
}

function calculateSymmetryScore(args: {
  spot: number;
  callWall: number | null;
  putWall: number | null;
}): number {
  const { spot, callWall, putWall } = args;
  if (!callWall || !putWall || callWall <= spot || putWall >= spot) return 30;

  const upside = Math.abs(callWall - spot);
  const downside = Math.abs(spot - putWall);
  const bigger = Math.max(upside, downside);
  const smaller = Math.min(upside, downside);
  if (bigger <= 0) return 100;

  return clamp(Math.round((smaller / bigger) * 100), 0, 100);
}

function calculateAlignmentScore(
  spxGravity: number | null,
  spyGravity: number | null,
  expectedMove: number
): number {
  if (!spxGravity || !spyGravity) return 35;
  const distance = Math.abs(spxGravity - spyGravity);
  const tolerance = Math.max(expectedMove * 0.8, 25);
  return clamp(Math.round(100 - (distance / tolerance) * 100), 0, 100);
}

function estimateDealerPressure(rows: ZeroDteChainRow[], spot: number, expectedMove: number): number {
  let signed = 0;
  let total = 0;
  const window = Math.max(expectedMove * 1.75, 125);

  for (const row of rows) {
    const distance = row.strike - spot;
    const distanceWeight = Math.max(0, 1 - Math.abs(distance) / window);
    if (distanceWeight <= 0) continue;

    const oi = Math.max(row.openInterest, 0);
    const volume = Math.max(row.volume, 0);
    const notionalWeight = Math.max(row.notionalWeight, 0.0001);
    const gammaExposure = Math.max(0, estimateDollarGamma(row, oi || volume || 1) / 250000);
    const base = (oi + volume * 0.5) * notionalWeight + gammaExposure;
    const side = row.optionType === "call" ? 1 : -1;
    const score = base * distanceWeight;

    signed += side * score;
    total += Math.abs(score);
  }

  if (total <= 0) return 0;
  return clamp(Math.round((signed / total) * 100), -100, 100);
}

function chooseIronFlyCenter(args: {
  spot: number;
  compositeGravity: number | null;
  compositePin: number | null;
  dealerPressure: number;
  alignmentScore: number;
  symmetryScore: number;
  expectedMove: number;
}): number {
  let center = args.spot;

  if (args.compositeGravity) center = center * 0.3 + args.compositeGravity * 0.7;
  if (args.compositePin) center = center * 0.78 + args.compositePin * 0.22;

  const maxPressureShift = Math.max(10, Math.min(25, (args.expectedMove || 70) * 0.3));
  center += clamp(args.dealerPressure * 0.12, -maxPressureShift, maxPressureShift);

  if (args.alignmentScore < 45 || args.symmetryScore < 35) {
    center = center * 0.55 + args.spot * 0.45;
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
  rowCount: number;
}): number {
  let score = 0;
  score += args.alignmentScore * 0.34;
  score += args.oiStrength * 0.24;
  score += args.symmetryScore * 0.22;
  score += Math.max(0, 100 - Math.abs(args.dealerPressure)) * 0.2;

  if (args.expectedMove > 0) {
    const centerDistance = Math.abs(args.center - args.spot);
    if (centerDistance > args.expectedMove * 0.5) score -= 15;
  }

  if (args.rowCount < 20) score -= 15;

  return clamp(Math.round(score), 0, 100);
}

function estimateAtmStraddle(rows: ZeroDteChainRow[], spot: number): number | null {
  if (!rows.length) return null;
  const nearestCall = nearestOption(rows, spot, "call");
  const nearestPut = nearestOption(rows, spot, "put");
  const callMid = positive(nearestCall?.mid);
  const putMid = positive(nearestPut?.mid);
  if (!callMid || !putMid) return null;
  return callMid + putMid;
}

function nearestOption(rows: ZeroDteChainRow[], spot: number, side: ZeroDteSide): ZeroDteChainRow | null {
  return [...rows]
    .filter((row) => row.optionType === side)
    .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0] ?? null;
}

function scaleSpyExpectedMove(value: number | null, spxPrice: number, spyPrice: number): number | null {
  if (!value || spyPrice <= 0) return null;
  return value * (spxPrice / spyPrice);
}

export function getIronFlyManagement(args: {
  spot: number;
  center: number;
  wingWidth: number;
  expectedMove: number;
  confidenceScore: number;
}): string {
  const distance = Math.abs(args.spot - args.center);
  const emUsed = args.expectedMove > 0 ? distance / args.expectedMove : 0;

  if (args.confidenceScore < 45) return "Low confidence. Avoid full-size iron fly or wait for opening range.";
  if (distance > args.wingWidth * 0.6) return "High risk. Spot is already too close to a long wing.";
  if (emUsed >= 0.75) return "Defensive. Price has consumed more than 75% of expected move from center.";
  if (emUsed >= 0.5) return "Caution. Price has consumed more than 50% of expected move from center.";
  if (emUsed < 0.35 && args.confidenceScore >= 65) return "Hold zone. Footprint supports the center and price remains inside the pin band.";
  return "Neutral. Manage by price distance to center and expected move consumed.";
}

function buildNotes(args: {
  alignmentScore: number;
  confidenceScore: number;
  dealerPressure: number;
  spx: OiIntelligence;
  spyEquivalent: OiIntelligence;
  composite: OiIntelligence;
  suggestedCenter: number;
  lowerWing: number;
  upperWing: number;
}): string[] {
  const notes: string[] = [];

  if (args.confidenceScore >= 70) notes.push("High-confidence iron fly footprint: aligned OI gravity, useful concentration, and acceptable symmetry.");
  else if (args.confidenceScore >= 55) notes.push("Moderate-confidence footprint. Size conservatively or wait for the opening range to settle.");
  else notes.push("Low-confidence footprint. Prefer no trade or directional credit-spread logic over a centered iron fly.");

  if (args.alignmentScore >= 75) notes.push("SPX and SPY-equivalent OI gravity are aligned.");
  else if (args.alignmentScore <= 45) notes.push("SPX and SPY-equivalent OI gravity conflict; do not trust the center blindly.");
  else notes.push("SPX/SPY alignment is mixed.");

  if (args.dealerPressure > 25) notes.push("Dealer pressure proxy leans upward; avoid centering too low.");
  else if (args.dealerPressure < -25) notes.push("Dealer pressure proxy leans downward; avoid centering too high.");
  else notes.push("Dealer pressure proxy is neutral, which is better for pin behavior.");

  notes.push(`SPX gravity ${fmt(args.spx.gravity)}, SPY-equivalent gravity ${fmt(args.spyEquivalent.gravity)}, composite gravity ${fmt(args.composite.gravity)}.`);
  notes.push(`Suggested IF: ${fmt(args.lowerWing)} / ${fmt(args.suggestedCenter)} / ${fmt(args.upperWing)}.`);

  return notes;
}

function buildWarnings(args: {
  input: BuildZeroDteLabInput;
  expectedMove: number;
  spxRows: ZeroDteChainRow[];
  spyRows: ZeroDteChainRow[];
  alignmentScore: number;
  confidenceScore: number;
}): string[] {
  const warnings: string[] = [];

  if (args.input.expirationDate !== args.input.targetDate) {
    warnings.push(`No same-day expiration was available for ${args.input.targetDate}; using ${args.input.expirationDate}. This is a real chain preview, not a 0DTE read.`);
  }

  if (!args.spxRows.length) warnings.push("No usable SPX option rows were harvested.");
  if (!args.spyRows.length) warnings.push("No usable SPY option rows were harvested.");
  if (args.expectedMove <= 0) warnings.push("ATM expected move could not be calculated from the harvested chain.");
  if (args.alignmentScore < 45) warnings.push("SPX/SPY alignment is weak.");
  if (args.confidenceScore < 45) warnings.push("Iron fly confidence is low.");

  return warnings;
}

function estimateDollarGamma(row: ZeroDteChainRow, contracts: number): number {
  const gamma = positive(row.gamma) ?? 0;
  if (gamma <= 0 || contracts <= 0) return 0;
  return gamma * row.underlyingPrice * row.underlyingPrice * 0.01 * 100 * contracts * Math.max(row.notionalWeight, 0.0001);
}

function sanitizeRows(rows: ZeroDteChainRow[]): ZeroDteChainRow[] {
  return rows
    .filter((row) => Number.isFinite(row.strike) && row.strike > 0)
    .map((row) => ({
      ...row,
      openInterest: Math.max(0, safe(row.openInterest)),
      volume: Math.max(0, safe(row.volume)),
      iv: positive(row.iv),
      delta: row.delta === null ? null : Number.isFinite(row.delta ?? NaN) ? row.delta ?? null : null,
      gamma: positive(row.gamma),
      bid: positive(row.bid),
      ask: positive(row.ask),
      last: positive(row.last),
      mid: positive(row.mid),
      notionalWeight: positive(row.notionalWeight) ?? 1,
    }));
}

function percentImbalance(a: number, b: number): number {
  const total = a + b;
  if (total <= 0) return 0;
  return Math.round(((a - b) / total) * 100);
}

function roundToFive(value: number): number {
  return Math.round(value / 5) * 5;
}

function positive(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function safe(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function fmt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}
