import { buildZeroDteDealerPressureRead, type ZeroDteDealerPressureRead } from "./zeroDteDealerPressureBridge";
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
  /** SPX contract-equivalent weighting. SPY rows are reduced by SPY/SPX before composite reference scoring. */
  notionalWeight?: number | null;
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

export type SpxOiMapRow = OiCluster & {
  distanceFromSpot: number;
  isCallWall: boolean;
  isPutWall: boolean;
  isPin: boolean;
  sideBias: "call" | "put" | "balanced";
  sideBiasPct: number;
  nearestSpyStrike: number | null;
  nearestSpyDistance: number | null;
  spyScore: number;
  spyAlignment: "aligned" | "near" | "none";
};

export type SpyAlignmentRow = OiCluster & {
  nearestSpxStrike: number | null;
  nearestSpxDistance: number | null;
  spxScore: number;
  alignment: "aligned" | "near" | "none";
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
  spxDealerPressure: number;
  spyDealerPressure: number;
  pressureBias: "up" | "down" | "neutral";
  dealerPressureSource: "dealer-pressure-engine" | "local-proxy";
  dealerPressureRead: ZeroDteDealerPressureRead | null;
  spyNotionalWeight: number;
  spx: SymbolOiIntelligence;
  spyEquivalent: SymbolOiIntelligence;
  composite: SymbolOiIntelligence;
  spxChainMap: SpxOiMapRow[];
  spyAlignmentMap: SpyAlignmentRow[];
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

  const spyNotionalWeight = calculateSpyNotionalWeight(spxPrice, spyPrice);
  const spyEquivalentRows = convertSpyRowsToSpx(spyRows, spxPrice, spyPrice);

  // SPX is the traded instrument. This is the primary footprint.
  const spx = buildOiIntelligence("SPX", spxPrice, spxRows);

  // SPY is converted to the SPX coordinate system and used as confirmation/alignment only.
  const spyEquivalent = buildOiIntelligence("SPY_EQUIV", spxPrice, spyEquivalentRows);

  // Composite is retained as a reference, not the primary center source.
  const composite = buildOiIntelligence("COMPOSITE", spxPrice, [...spxRows, ...spyEquivalentRows]);

  const expectedMove =
    safe(manualExpectedMove) > 0
      ? safe(manualExpectedMove)
      : estimateAtmStraddle(spxRows, spxPrice) ?? estimateAtmStraddle(spyEquivalentRows, spxPrice) ?? 0;

  const alignmentScore = calculateAlignmentScore(spx.gravity, spyEquivalent.gravity, expectedMove || 70);
  const dealerPressureRead = buildZeroDteDealerPressureRead({
    ticker: "SPX",
    spot: spxPrice,
    rows: spxRows,
    snapshotDate: spxRows[0]?.expiration?.slice(0, 10) ?? null,
    expiration: spxRows[0]?.expiration ?? null,
    support: spx.putWall,
    resistance: spx.callWall,
    magnet: spx.strongestPin ?? spx.gravity,
  });

  const localSpxDealerPressure = estimateDealerPressure(spxRows, spxPrice);
  const spxDealerPressure =
    dealerPressureRead.source === "dealer-pressure-engine"
      ? dealerPressureRead.signedPressure
      : localSpxDealerPressure;

  const spyDealerPressure = estimateDealerPressure(spyEquivalentRows, spxPrice);

  // SPX dominates. SPY confirms or warns, but it should not move the trade by itself.
  // SPX dealer pressure comes from dealer-pressure-engine when available.
  const dealerPressure = clamp(Math.round(spxDealerPressure * 0.86 + spyDealerPressure * 0.14), -100, 100);
  const pressureBias = dealerPressure > 20 ? "up" : dealerPressure < -20 ? "down" : "neutral";

  const suggestedCenter = chooseIronFlyCenter({
    spot: spxPrice,
    spxGravity: spx.gravity,
    spxPin: spx.strongestPin,
    spyGravity: spyEquivalent.gravity,
    dealerPressure,
    alignmentScore,
    symmetryScore: spx.symmetryScore,
  });

  const suggestedWingWidth = 50;
  const lowerWing = suggestedCenter - suggestedWingWidth;
  const upperWing = suggestedCenter + suggestedWingWidth;

  const confidenceScore = calculateConfidenceScore({
    alignmentScore,
    oiStrength: spx.oiStrength,
    symmetryScore: spx.symmetryScore,
    dealerPressure,
    spot: spxPrice,
    center: suggestedCenter,
    expectedMove,
  });

  const spxChainMap = buildSpxOiMap({
    spxClusters: spx.clusters,
    spyClusters: spyEquivalent.clusters,
    spot: spxPrice,
    spxCallWall: spx.callWall,
    spxPutWall: spx.putWall,
    spxPin: spx.strongestPin,
  });

  const spyAlignmentMap = buildSpyAlignmentMap({
    spyClusters: spyEquivalent.clusters,
    spxClusters: spx.clusters,
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
    spxDealerPressure,
    spyDealerPressure,
    spx,
    spyEquivalent,
    composite,
    dealerPressureRead,
    spyNotionalWeight,
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
    spxDealerPressure,
    spyDealerPressure,
    pressureBias,
    dealerPressureSource: dealerPressureRead.source === "dealer-pressure-engine" ? "dealer-pressure-engine" : "local-proxy",
    dealerPressureRead,
    spyNotionalWeight,
    spx,
    spyEquivalent,
    composite,
    spxChainMap,
    spyAlignmentMap,
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

  const callWall = strongestBySide(clusters, "call", spot);
  const putWall = strongestBySide(clusters, "put", spot);
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
  const notionalWeight = calculateSpyNotionalWeight(spxPrice, spyPrice);

  return spyRows.map((row) => ({
    ...row,
    symbol: "SPY_EQUIV",
    strike: row.strike * ratio,
    // SPY contracts are roughly 1/10th the notional of SPX contracts.
    // Raw SPY OI is large and should not overpower SPX, which is the actual trade.
    openInterest: scale(row.openInterest, notionalWeight),
    volume: scale(row.volume, notionalWeight),
    // Coordinate transform: S_spx = ratio * S_spy and premium_spx = ratio * premium_spy.
    // Delta is invariant, while gamma transforms by 1/ratio.
    gamma: typeof row.gamma === "number" && Number.isFinite(row.gamma)
      ? row.gamma / ratio
      : null,
    // Premium/expected-move values are SPY points, so convert them to SPX points.
    bid: scale(row.bid, ratio),
    ask: scale(row.ask, ratio),
    mid: scale(row.mid, ratio),
    last: scale(row.last, ratio),
    notionalWeight,
  }));
}

export function calculateSpyNotionalWeight(spxPrice: number, spyPrice: number) {
  if (spxPrice > 0 && spyPrice > 0) return spyPrice / spxPrice;
  return 0.10;
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
    // Structural OI intelligence intentionally excludes intraday volume.
    // Volume is cumulative and belongs in the strike-flow execution layer.
    const gammaWeight = Math.abs(safe(row.gamma)) * Math.max(oi, 1) * 1000;

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
    existing.score = existing.totalOi + existing.gammaWeight;

    map.set(strike, existing);
  }

  return [...map.values()];
}

function strongestBySide(clusters: OiCluster[], side: OptionType, spot: number) {
  if (!clusters.length) return null;

  const geometricallyValid = clusters.filter((cluster) =>
    side === "call" ? cluster.strike >= spot : cluster.strike <= spot,
  );
  if (!geometricallyValid.length) return null;

  return [...geometricallyValid]
    .map((cluster) => ({
      strike: cluster.strike,
      score:
        side === "call"
          ? cluster.callOi + cluster.callGammaWeight
          : cluster.putOi + cluster.putGammaWeight,
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
    // Signed-pressure contract: positive = upward/bullish hedge pressure,
    // negative = downward/bearish. Put concentration is therefore positive
    // and call concentration negative, matching dealerSummaryToSignedPressure().
    const side = row.optionType === "put" ? 1 : -1;

    pressure += side * gamma * (oi + volume * 0.5) * distanceWeight;
  }

  return clamp(Math.round(pressure / 1000), -100, 100);
}

function chooseIronFlyCenter(args: {
  spot: number;
  spxGravity: number | null;
  spxPin: number | null;
  spyGravity: number | null;
  dealerPressure: number;
  alignmentScore: number;
  symmetryScore: number;
}) {
  const { spot, spxGravity, spxPin, spyGravity, dealerPressure, alignmentScore, symmetryScore } = args;

  let center = spot;

  // Primary center uses SPX only.
  if (spxGravity) center = center * 0.25 + spxGravity * 0.75;
  if (spxPin) center = center * 0.80 + spxPin * 0.20;

  // SPY only nudges when it confirms reasonably well; it never controls the center.
  if (spyGravity && alignmentScore >= 65) {
    center += clamp((spyGravity - center) * 0.10, -5, 5);
  }

  // Dealer pressure can shift center, but capped.
  center += clamp(dealerPressure * 0.12, -15, 15);

  // Bad alignment/symmetry means do not chase the OI footprint too far from spot.
  if (alignmentScore < 45 || symmetryScore < 45) {
    center = center * 0.55 + spot * 0.45;
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
  score += alignmentScore * 0.30;
  score += oiStrength * 0.30;
  score += symmetryScore * 0.25;

  const pressurePenalty = Math.min(Math.abs(dealerPressure), 70) * 0.22;
  score += 20 - pressurePenalty;

  if (expectedMove > 0) {
    const centerDistance = Math.abs(center - spot);
    if (centerDistance > expectedMove * 0.45) score -= 15;
  }

  return clamp(Math.round(score), 0, 100);
}

function buildSpxOiMap(args: {
  spxClusters: OiCluster[];
  spyClusters: OiCluster[];
  spot: number;
  spxCallWall: number | null;
  spxPutWall: number | null;
  spxPin: number | null;
}): SpxOiMapRow[] {
  return [...args.spxClusters]
    .sort((a, b) => a.strike - b.strike)
    .map((cluster) => {
      const nearestSpy = nearestCluster(cluster.strike, args.spyClusters);
      const nearestSpyDistance = nearestSpy ? Math.abs(nearestSpy.strike - cluster.strike) : null;
      const sideBias = getSideBias(cluster);
      const sideBiasPct = getSideBiasPct(cluster.callOi, cluster.putOi);

      return {
        ...cluster,
        distanceFromSpot: cluster.strike - args.spot,
        isCallWall: args.spxCallWall === cluster.strike,
        isPutWall: args.spxPutWall === cluster.strike,
        isPin: args.spxPin === cluster.strike,
        sideBias,
        sideBiasPct,
        nearestSpyStrike: nearestSpy?.strike ?? null,
        nearestSpyDistance,
        spyScore: nearestSpy?.score ?? 0,
        spyAlignment: nearestSpyDistance === null ? "none" : nearestSpyDistance <= 7.5 ? "aligned" : nearestSpyDistance <= 20 ? "near" : "none",
      };
    });
}

function buildSpyAlignmentMap(args: {
  spyClusters: OiCluster[];
  spxClusters: OiCluster[];
}): SpyAlignmentRow[] {
  return [...args.spyClusters]
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((cluster) => {
      const nearestSpx = nearestCluster(cluster.strike, args.spxClusters);
      const nearestSpxDistance = nearestSpx ? Math.abs(nearestSpx.strike - cluster.strike) : null;

      return {
        ...cluster,
        nearestSpxStrike: nearestSpx?.strike ?? null,
        nearestSpxDistance,
        spxScore: nearestSpx?.score ?? 0,
        alignment: nearestSpxDistance === null ? "none" : nearestSpxDistance <= 7.5 ? "aligned" : nearestSpxDistance <= 20 ? "near" : "none",
      };
    });
}

function nearestCluster(strike: number, clusters: OiCluster[]) {
  if (!clusters.length) return null;
  return [...clusters].sort((a, b) => Math.abs(a.strike - strike) - Math.abs(b.strike - strike))[0] ?? null;
}

function getSideBias(cluster: OiCluster): "call" | "put" | "balanced" {
  const total = cluster.callOi + cluster.putOi;
  if (!total) return "balanced";
  const imbalance = Math.abs(cluster.callOi - cluster.putOi) / total;
  if (imbalance < 0.15) return "balanced";
  return cluster.callOi > cluster.putOi ? "call" : "put";
}

function getSideBiasPct(callOi: number, putOi: number) {
  return percentImbalance(callOi, putOi);
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
  spxDealerPressure: number;
  spyDealerPressure: number;
  spx: SymbolOiIntelligence;
  spyEquivalent: SymbolOiIntelligence;
  composite: SymbolOiIntelligence;
  dealerPressureRead?: ZeroDteDealerPressureRead | null;
  spyNotionalWeight?: number;
  suggestedCenter: number;
  lowerWing: number;
  upperWing: number;
}) {
  const notes: string[] = [];

  if (args.confidenceScore >= 70) notes.push("High-confidence SPX iron fly footprint.");
  else if (args.confidenceScore >= 55) notes.push("Moderate confidence; size conservatively.");
  else notes.push("Low confidence; wait or favor directional credit-spread logic instead of an iron fly.");

  if (args.alignmentScore >= 75) notes.push("SPY confirms the SPX OI gravity area.");
  else if (args.alignmentScore <= 45) notes.push("SPY conflicts with the SPX OI gravity area. Treat SPX center with lower confidence.");
  else notes.push("SPY is only partially aligned with SPX.");

  if (args.dealerPressure > 25) notes.push("Dealer pressure leans upward; center may need a small upside adjustment.");
  else if (args.dealerPressure < -25) notes.push("Dealer pressure leans downward; center may need a small downside adjustment.");
  else notes.push("Dealer pressure is relatively neutral, which supports pin behavior.");

  notes.push(`SPX gravity: ${fmt(args.spx.gravity)}. SPY-equivalent gravity: ${fmt(args.spyEquivalent.gravity)}. Composite reference gravity: ${fmt(args.composite.gravity)}.`);
  notes.push(`Dealer pressure blend: SPX ${signed(args.spxDealerPressure)}, SPY alignment ${signed(args.spyDealerPressure)}, combined ${signed(args.dealerPressure)}.`);
  if (args.dealerPressureRead?.summary) notes.push(`Dealer-pressure-engine: ${args.dealerPressureRead.summary.regime}; hedge-flow ${args.dealerPressureRead.summary.hedgeFlowBias}; pin ${Math.round(args.dealerPressureRead.summary.pinRiskScore)} / snap ${Math.round(args.dealerPressureRead.summary.snapRiskScore)}.`);
  else if (args.dealerPressureRead?.notes?.length) notes.push(args.dealerPressureRead.notes[0]);
  if (args.spyNotionalWeight) notes.push(`SPY footprint is notional-weighted to ${(args.spyNotionalWeight * 100).toFixed(1)}% of raw SPY OI/volume and is used for alignment, not as the primary trade center.`);
  notes.push(`Opening SPX IF map: ${args.lowerWing} / ${args.suggestedCenter} / ${args.upperWing}. The 50-point wings are a locked daily map, not an automatic opening entry.`);

  return notes;
}

function getMid(row?: ZeroDteChainRow) {
  if (!row) return null;
  if (safe(row.mid) > 0) return safe(row.mid);
  if (safe(row.bid) > 0 && safe(row.ask) > 0) return (safe(row.bid) + safe(row.ask)) / 2;
  // LAST may be hours old in 0DTE. Never let it manufacture the live ATM
  // straddle/expected-move input when the executable market is unavailable.
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

function scale(n: number | null | undefined, factor: number) {
  if (typeof n !== "number" || !Number.isFinite(n)) return n ?? null;
  return n * factor;
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

function signed(n: number) {
  return `${n > 0 ? "+" : ""}${n}`;
}
