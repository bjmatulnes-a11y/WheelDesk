import type { SpxOiMapRow, ZeroDteChainRow, ZeroDteRecommendation } from "./zeroDteOiIntelligence";
import type { ZeroDteMoodRead } from "./zeroDteMoodEngine";

export type CreditSpreadSide = "put" | "call";
export type CreditSpreadRiskMode = "conservative" | "balanced" | "aggressive";
export type CreditSpreadSelectionMode = "auto-oi-dealer" | "manual-mood" | "manual-tos-mood" | "dealer-pressure" | "two-sided-review";

export type ZeroDteCreditSpreadBook = {
  preferredSide: CreditSpreadSide | "none";
  selectionMode: CreditSpreadSelectionMode;
  preferredSpread: ZeroDteCreditSpreadSelection | null;
  put: ZeroDteCreditSpreadSelection;
  call: ZeroDteCreditSpreadSelection;
  notes: string[];
  warnings: string[];
};

export type ZeroDteCreditSpreadSelection = {
  tradeType: "put-credit-spread" | "call-credit-spread";
  side: CreditSpreadSide;
  shortStrike: number | null;
  longStrike: number | null;
  actualWidth: number | null;
  requestedWidth: number;
  maxAllowedWidth: number;
  widthSource: "optimized";
  estimatedCredit: number | null;
  estimatedDebitToClose?: number | null;
  maxLoss: number | null;
  maxLossDollars: number | null;
  creditToWidthPct: number | null;
  creditToRiskPct: number | null;
  breakeven: number | null;
  confidence: number;
  riskMode: CreditSpreadRiskMode;
  aggression: "low" | "medium" | "high";
  score: number;
  expectedMoveRemaining: number;
  distanceFromSpot: number | null;
  distanceAsExpectedMovePct: number | null;
  shortDeltaAbs: number | null;
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
  actualWidth: number;
  requestedWidth: number;
  estimatedCredit: number;
  maxLoss: number;
  maxLossDollars: number;
  creditToWidthPct: number;
  creditToRiskPct: number;
  breakeven: number;
  shortMid: number;
  longMid: number;
  shortBid: number | null;
  shortAsk: number | null;
  longBid: number | null;
  longAsk: number | null;
  shortDeltaAbs: number | null;
  oiScore: number;
  wallScore: number;
  dealerScore: number;
  spyScore: number;
  premiumScore: number;
  distanceScore: number;
  deltaScore: number;
  liquidityScore: number;
  riskScore: number;
  widthScore: number;
  reasons: string[];
  warnings: string[];
};

export type SelectCreditSpreadInput = {
  recommendation: ZeroDteRecommendation;
  spxRows?: ZeroDteChainRow[];
  mood?: ZeroDteMoodRead | null;
  side: CreditSpreadSide;
  /** Legacy field. Now treated as max allowed width, not forced width. */
  width?: number | null;
  maxWidth?: number | null;
  minWidth?: number | null;
  maxRiskDollars?: number | null;
  minCredit?: number | null;
  minCreditToRiskPct?: number | null;
  riskMode?: CreditSpreadRiskMode;
  minDistancePctOfExpectedMove?: number;
  maxDistancePctOfExpectedMove?: number;
};

export type BuildCreditSpreadBookInput = {
  recommendation: ZeroDteRecommendation;
  spxRows: ZeroDteChainRow[];
  mood?: ZeroDteMoodRead | null;
  /** Legacy field. Now treated as max allowed width, not forced width. */
  width?: number | null;
  maxWidth?: number | null;
  minWidth?: number | null;
  maxRiskDollars?: number | null;
  minCredit?: number | null;
  minCreditToRiskPct?: number | null;
  riskMode?: CreditSpreadRiskMode;
};

export function buildZeroDteCreditSpreadBook(input: BuildCreditSpreadBookInput): ZeroDteCreditSpreadBook {
  const riskMode = input.riskMode ?? "balanced";
  const put = selectZeroDteCreditSpread({ ...input, side: "put", riskMode });
  const call = selectZeroDteCreditSpread({ ...input, side: "call", riskMode });
  const { preferredSide, selectionMode, notes, warnings } = choosePreferredSide({
    recommendation: input.recommendation,
    mood: input.mood ?? null,
    put,
    call,
  });

  const preferredSpread = preferredSide === "put" ? put : preferredSide === "call" ? call : null;

  return {
    preferredSide,
    selectionMode,
    preferredSpread,
    put,
    call,
    notes,
    warnings,
  };
}

export function selectZeroDteCreditSpread(input: SelectCreditSpreadInput): ZeroDteCreditSpreadSelection {
  const rec = input.recommendation;
  const side = input.side;
  const riskMode = input.riskMode ?? "balanced";
  const maxAllowedWidth = normalizeWidth(input.maxWidth ?? input.width ?? maxWidthForRiskMode(riskMode));
  const minAllowedWidth = normalizeWidth(input.minWidth ?? minWidthForRiskMode(riskMode));
  const expectedMoveRemaining = Math.max(rec.expectedMove || 0, 1);
  const spot = rec.spxPrice;
  const wall = side === "put" ? rec.spx.putWall : rec.spx.callWall;
  const dealerPressure = rec.dealerPressure;
  const minPct = input.minDistancePctOfExpectedMove ?? minPctForRiskMode(riskMode);
  const maxPct = input.maxDistancePctOfExpectedMove ?? maxPctForRiskMode(riskMode);
  const rows = input.spxRows ?? [];
  const minCredit = input.minCredit ?? 0;
  const minCreditToRiskPct = input.minCreditToRiskPct ?? minCreditToRiskPctForRiskMode(riskMode);
  const maxRiskDollars = input.maxRiskDollars && input.maxRiskDollars > 0 ? input.maxRiskDollars : null;
  const widthCandidates = buildWidthCandidates({ riskMode, minWidth: minAllowedWidth, maxWidth: maxAllowedWidth });

  const candidates = rec.spxChainMap
    .filter((row) => isCandidateSide(row, side, spot))
    .flatMap((row) =>
      widthCandidates
        .map((requestedWidth) =>
          scoreCandidate({
            row,
            rows,
            rec,
            side,
            requestedWidth,
            riskMode,
            expectedMoveRemaining,
            wall,
            dealerPressure,
            minPct,
            maxPct,
            maxRiskDollars,
            minCredit,
            minCreditToRiskPct,
            maxAllowedWidth,
          })
        )
        .filter((candidate): candidate is CreditSpreadCandidate => candidate !== null)
    )
    .sort((a, b) => b.score - a.score || b.creditToRiskPct - a.creditToRiskPct || b.estimatedCredit - a.estimatedCredit);

  const best = candidates[0] ?? null;
  const warnings: string[] = [];
  const reasons: string[] = [];

  if (!rows.length) {
    warnings.push("No SPX option quote rows were supplied to the spread selector, so real credit/debit scoring is unavailable.");
  }

  if (!best) {
    warnings.push(`No executable ${side === "put" ? "put" : "call"} credit spread candidate was found within width/risk filters.`);
  } else {
    reasons.push(...best.reasons);
    warnings.push(...best.warnings);
  }

  if (maxRiskDollars !== null && best && best.maxLossDollars > maxRiskDollars) {
    warnings.push(`Selected spread exceeds max risk input $${Math.round(maxRiskDollars).toLocaleString()}.`);
  }

  if (side === "put" && dealerPressure < -20) warnings.push("Dealer pressure is negative, which conflicts with a bullish put credit spread.");
  if (side === "call" && dealerPressure > 20) warnings.push("Dealer pressure is positive, which conflicts with a bearish call credit spread.");

  const mood = input.mood ?? null;
  if (isManualMoodSource(mood)) {
    if (side === "put" && mood.directionalBias === "bearish") warnings.push("Manual mood override is bearish, which conflicts with the put spread side.");
    if (side === "call" && mood.directionalBias === "bullish") warnings.push("Manual mood override is bullish, which conflicts with the call spread side.");
  }

  return {
    tradeType: side === "put" ? "put-credit-spread" : "call-credit-spread",
    side,
    shortStrike: best?.strike ?? null,
    longStrike: best?.longStrike ?? null,
    actualWidth: best?.actualWidth ?? null,
    requestedWidth: best?.requestedWidth ?? maxAllowedWidth,
    maxAllowedWidth,
    widthSource: "optimized",
    estimatedCredit: best?.estimatedCredit ?? null,
    maxLoss: best?.maxLoss ?? null,
    maxLossDollars: best?.maxLossDollars ?? null,
    creditToWidthPct: best?.creditToWidthPct ?? null,
    creditToRiskPct: best?.creditToRiskPct ?? null,
    breakeven: best?.breakeven ?? null,
    confidence: best?.confidence ?? 0,
    riskMode,
    aggression: aggressionForRiskMode(riskMode, rec.dealerPressure, mood?.moodPercent ?? null),
    score: best?.score ?? 0,
    expectedMoveRemaining,
    distanceFromSpot: best?.distanceFromSpot ?? null,
    distanceAsExpectedMovePct: best?.distanceAsExpectedMovePct ?? null,
    shortDeltaAbs: best?.shortDeltaAbs ?? null,
    wall,
    wallRelationship: best ? describeWallRelationship(side, best.strike, wall) : "No short strike selected.",
    reasons,
    warnings: unique(warnings),
    candidates: candidates.slice(0, 12),
  };
}

function scoreCandidate(args: {
  row: SpxOiMapRow;
  rows: ZeroDteChainRow[];
  rec: ZeroDteRecommendation;
  side: CreditSpreadSide;
  requestedWidth: number;
  riskMode: CreditSpreadRiskMode;
  expectedMoveRemaining: number;
  wall: number | null;
  dealerPressure: number;
  minPct: number;
  maxPct: number;
  maxRiskDollars: number | null;
  minCredit: number;
  minCreditToRiskPct: number;
  maxAllowedWidth: number;
}): CreditSpreadCandidate | null {
  const {
    row,
    rows,
    rec,
    side,
    requestedWidth,
    riskMode,
    expectedMoveRemaining,
    wall,
    dealerPressure,
    minPct,
    maxPct,
    maxRiskDollars,
    minCredit,
    minCreditToRiskPct,
    maxAllowedWidth,
  } = args;
  const spot = rec.spxPrice;
  const shortRow = findExactOptionRow(rows, side, row.strike);
  if (!shortRow) return null;

  const longRow = findLongOptionRow(rows, row.strike, side, requestedWidth);
  if (!longRow) return null;

  const shortMid = getMid(shortRow);
  const longMid = getMid(longRow);
  if (shortMid === null || longMid === null) return null;

  const estimatedCredit = roundMoney(shortMid - longMid);
  if (!Number.isFinite(estimatedCredit) || estimatedCredit <= 0) return null;

  const actualWidth = Math.abs(row.strike - longRow.strike);
  if (actualWidth <= 0 || actualWidth > maxAllowedWidth) return null;

  const maxLoss = roundMoney(actualWidth - estimatedCredit);
  if (maxLoss <= 0) return null;

  const maxLossDollars = Math.round(maxLoss * 100);
  const creditToWidthPct = estimatedCredit / actualWidth;
  const creditToRiskPct = estimatedCredit / maxLoss;

  if (minCredit > 0 && estimatedCredit < minCredit) return null;
  if (minCreditToRiskPct > 0 && creditToRiskPct < minCreditToRiskPct) return null;
  if (maxRiskDollars !== null && maxLossDollars > maxRiskDollars) return null;

  const distanceFromSpot = Math.abs(spot - row.strike);
  const distanceAsExpectedMovePct = distanceFromSpot / expectedMoveRemaining;
  const breakeven = side === "put" ? row.strike - estimatedCredit : row.strike + estimatedCredit;
  const shortDeltaAbs = cleanAbs(shortRow.delta);

  const oiMagnitude = Math.max(...rec.spxChainMap.map((r) => Math.max(r.callOi, r.putOi, r.totalOi)), 1);
  const sideOi = side === "put" ? row.putOi : row.callOi;
  const totalOi = row.totalOi;

  const oiScore = clamp((sideOi / oiMagnitude) * 55 + (totalOi / oiMagnitude) * 20, 0, 100);
  const distanceScore = scoreDistance(distanceAsExpectedMovePct, minPct, maxPct, riskMode);
  const wallScore = scoreWall(side, row.strike, wall, expectedMoveRemaining);
  const dealerScore = scoreDealer(side, dealerPressure);
  const spyScore = row.spyAlignment === "aligned" ? 100 : row.spyAlignment === "near" ? 70 : 40;
  const premiumScore = scorePremium({ creditToRiskPct, creditToWidthPct, riskMode });
  const deltaScore = scoreDelta(shortDeltaAbs, riskMode);
  const liquidityScore = scoreLiquidity(shortRow, longRow);
  const skewScore = scoreSideBias(side, row);
  const riskScore = scoreRisk({ maxLossDollars, maxRiskDollars, actualWidth, riskMode });
  const widthScore = scoreWidth(actualWidth, riskMode);

  let score =
    oiScore * 0.15 +
    wallScore * 0.17 +
    distanceScore * 0.16 +
    premiumScore * 0.18 +
    dealerScore * 0.11 +
    deltaScore * 0.07 +
    spyScore * 0.05 +
    liquidityScore * 0.04 +
    riskScore * 0.04 +
    widthScore * 0.02 +
    skewScore * 0.01;

  const warnings: string[] = [];
  if (distanceAsExpectedMovePct < minPct) {
    score -= 12;
    warnings.push(`${row.strike} is inside the minimum distance band for ${riskMode} risk mode.`);
  }
  if (distanceAsExpectedMovePct > maxPct) warnings.push(`${row.strike} is far outside the target distance band; safer, but credit may be inefficient.`);
  if (creditToRiskPct < minCreditToRiskPctForRiskMode(riskMode)) warnings.push("Credit/risk is below the default target for this risk mode.");
  if (creditToWidthPct > 0.38) warnings.push("Credit is rich because the short strike is likely close/risky for 0DTE.");
  if (liquidityScore < 45) warnings.push("Schwab bid/ask quality is weak or incomplete. Verify the live combination mark before entry.");

  score = clamp(score, 0, 100);
  const confidence = clamp(Math.round(score * 0.86 + rec.confidenceScore * 0.14), 0, 100);

  const reasons: string[] = [];
  reasons.push(`Width was optimized, not assumed: tested ${actualWidth}-wide candidate from ${row.strike}${side === "put" ? "P" : "C"} to ${longRow.strike}${side === "put" ? "P" : "C"}.`);
  reasons.push(`${row.strike}${side === "put" ? "P" : "C"} sells for about ${fmtMoney(shortMid)} and long leg is near ${fmtMoney(longMid)}.`);
  reasons.push(`Estimated credit ${fmtMoney(estimatedCredit)}; max risk about ${fmtMoney(maxLoss)} per spread (${fmtMoney(maxLossDollars)} contract risk).`);
  reasons.push(`Credit/risk is ${(creditToRiskPct * 100).toFixed(1)}%; credit/width is ${(creditToWidthPct * 100).toFixed(1)}%.`);
  reasons.push(`${row.strike} is ${distanceFromSpot.toFixed(1)} points from spot (${Math.round(distanceAsExpectedMovePct * 100)}% of expected move).`);
  if (shortDeltaAbs !== null) reasons.push(`Short strike delta estimate: ${shortDeltaAbs.toFixed(2)}.`);
  if (wall) reasons.push(describeWallRelationship(side, row.strike, wall));
  if (row.spyAlignment !== "none") reasons.push(`SPY confirmation is ${row.spyAlignment} near this SPX strike.`);
  if (side === "put" && dealerPressure > 20) reasons.push("Dealer pressure supports bullish/neutral put-spread placement.");
  if (side === "call" && dealerPressure < -20) reasons.push("Dealer pressure supports bearish/neutral call-spread placement.");
  if (sideOi > 0) reasons.push(`Side-specific OI at strike is ${Math.round(sideOi).toLocaleString()}.`);

  return {
    strike: row.strike,
    longStrike: longRow.strike,
    score: Math.round(score),
    confidence,
    distanceFromSpot,
    distanceAsExpectedMovePct,
    actualWidth,
    requestedWidth,
    estimatedCredit,
    maxLoss,
    maxLossDollars,
    creditToWidthPct,
    creditToRiskPct,
    breakeven,
    shortMid,
    longMid,
    shortBid: numOrNull(shortRow.bid),
    shortAsk: numOrNull(shortRow.ask),
    longBid: numOrNull(longRow.bid),
    longAsk: numOrNull(longRow.ask),
    shortDeltaAbs,
    oiScore: Math.round(oiScore),
    wallScore: Math.round(wallScore),
    dealerScore: Math.round(dealerScore),
    spyScore: Math.round(spyScore),
    premiumScore: Math.round(premiumScore),
    distanceScore: Math.round(distanceScore),
    deltaScore: Math.round(deltaScore),
    liquidityScore: Math.round(liquidityScore),
    riskScore: Math.round(riskScore),
    widthScore: Math.round(widthScore),
    reasons,
    warnings,
  };
}

function choosePreferredSide(args: {
  recommendation: ZeroDteRecommendation;
  mood: ZeroDteMoodRead | null;
  put: ZeroDteCreditSpreadSelection;
  call: ZeroDteCreditSpreadSelection;
}): { preferredSide: CreditSpreadSide | "none"; selectionMode: CreditSpreadSelectionMode; notes: string[]; warnings: string[] } {
  const { recommendation: rec, mood, put, call } = args;
  const notes: string[] = [];
  const warnings: string[] = [];

  if (isManualMoodSource(mood)) {
    if (mood.tradeBias === "put-credit-spread" || mood.tradeBias === "skewed-bullish-condor") {
      notes.push(`Manual mood override favors bullish premium selling, so the put spread is preferred if its optimized strike score is valid.`);
      return { preferredSide: put.shortStrike ? "put" : "none", selectionMode: "manual-mood", notes, warnings };
    }
    if (mood.tradeBias === "call-credit-spread" || mood.tradeBias === "skewed-bearish-condor") {
      notes.push(`Manual mood override favors bearish premium selling, so the call spread is preferred if its optimized strike score is valid.`);
      return { preferredSide: call.shortStrike ? "call" : "none", selectionMode: "manual-mood", notes, warnings };
    }
    notes.push("Manual mood override is neutral; showing both optimized credit-spread sides while the iron fly/condor remains primary.");
  }

  if (rec.dealerPressure > 25) {
    notes.push("Dealer pressure is positive, so the optimized put credit spread side gets preference.");
    return { preferredSide: put.shortStrike ? "put" : "none", selectionMode: "dealer-pressure", notes, warnings };
  }

  if (rec.dealerPressure < -25) {
    notes.push("Dealer pressure is negative, so the optimized call credit spread side gets preference.");
    return { preferredSide: call.shortStrike ? "call" : "none", selectionMode: "dealer-pressure", notes, warnings };
  }

  const putScore = put.confidence;
  const callScore = call.confidence;
  if (!put.shortStrike && !call.shortStrike) {
    warnings.push("No executable put or call spread candidate found from current SPX chain marks and risk filters.");
    return { preferredSide: "none", selectionMode: "two-sided-review", notes, warnings };
  }

  if (Math.abs(putScore - callScore) < 8) {
    notes.push("Dealer pressure is neutral and both sides are close; review both optimized candidates rather than forcing a directional call.");
    return { preferredSide: putScore >= callScore && put.shortStrike ? "put" : call.shortStrike ? "call" : "none", selectionMode: "two-sided-review", notes, warnings };
  }

  const preferredSide = putScore > callScore ? "put" : "call";
  notes.push(`No strong mood/pressure input; preferred side is chosen from higher optimized SPX OI/credit/dealer candidate score.`);
  return { preferredSide: preferredSide === "put" && put.shortStrike ? "put" : preferredSide === "call" && call.shortStrike ? "call" : "none", selectionMode: "auto-oi-dealer", notes, warnings };
}

function isCandidateSide(row: SpxOiMapRow, side: CreditSpreadSide, spot: number) {
  if (!Number.isFinite(row.strike)) return false;
  if (side === "put") return row.strike < spot;
  return row.strike > spot;
}

function findExactOptionRow(rows: ZeroDteChainRow[], side: CreditSpreadSide, strike: number) {
  const optionType = side === "put" ? "put" : "call";
  return rows.find((row) => row.optionType === optionType && Math.abs(row.strike - strike) < 0.01) ?? null;
}

function findLongOptionRow(rows: ZeroDteChainRow[], shortStrike: number, side: CreditSpreadSide, requestedWidth: number) {
  const optionType = side === "put" ? "put" : "call";
  const target = side === "put" ? shortStrike - requestedWidth : shortStrike + requestedWidth;
  const candidates = rows.filter((row) => row.optionType === optionType && (side === "put" ? row.strike < shortStrike : row.strike > shortStrike));
  if (!candidates.length) return null;

  const best = candidates.sort((a, b) => Math.abs(a.strike - target) - Math.abs(b.strike - target))[0] ?? null;
  if (!best) return null;

  const actualWidth = Math.abs(shortStrike - best.strike);
  if (actualWidth < 4.9) return null;
  return best;
}

function buildWidthCandidates(args: { riskMode: CreditSpreadRiskMode; minWidth: number; maxWidth: number }) {
  const base = args.riskMode === "conservative"
    ? [5, 10, 15, 20, 25]
    : args.riskMode === "aggressive"
    ? [10, 15, 20, 25, 30, 40, 50, 60]
    : [5, 10, 15, 20, 25, 30, 40, 50];

  return uniqueNumbers(base.filter((width) => width >= args.minWidth && width <= args.maxWidth)).sort((a, b) => a - b);
}

function scoreDistance(pct: number, minPct: number, maxPct: number, riskMode: CreditSpreadRiskMode) {
  if (!Number.isFinite(pct)) return 0;
  const target = riskMode === "aggressive" ? 0.48 : riskMode === "conservative" ? 0.85 : 0.65;
  if (pct < minPct) return Math.max(0, 54 * (pct / Math.max(minPct, 0.01)));
  if (pct > maxPct) return Math.max(20, 100 - (pct - maxPct) * 65);
  return clamp(100 - Math.abs(pct - target) * 85, 52, 100);
}

function scoreWall(side: CreditSpreadSide, strike: number, wall: number | null, expectedMove: number) {
  if (!wall) return 50;
  const distance = Math.abs(strike - wall);
  const nearBonus = Math.max(0, 20 - distance) * 0.75;

  if (side === "put") {
    if (strike < wall) return clamp(84 + nearBonus - Math.max(0, distance - 35) * 0.45, 0, 100);
    if (strike === wall) return 74;
    return clamp(38 - Math.min(35, ((strike - wall) / expectedMove) * 80), 0, 100);
  }

  if (strike > wall) return clamp(84 + nearBonus - Math.max(0, distance - 35) * 0.45, 0, 100);
  if (strike === wall) return 74;
  return clamp(38 - Math.min(35, ((wall - strike) / expectedMove) * 80), 0, 100);
}

function scoreDealer(side: CreditSpreadSide, pressure: number) {
  if (side === "put") return clamp(56 + pressure * 0.55, 0, 100);
  return clamp(56 - pressure * 0.55, 0, 100);
}

function scorePremium(args: { creditToRiskPct: number; creditToWidthPct: number; riskMode: CreditSpreadRiskMode }) {
  const targetRisk = args.riskMode === "aggressive" ? 0.22 : args.riskMode === "conservative" ? 0.10 : 0.15;
  const targetWidth = args.riskMode === "aggressive" ? 0.18 : args.riskMode === "conservative" ? 0.09 : 0.12;
  const riskScore = 100 - Math.abs(args.creditToRiskPct - targetRisk) * 260;
  const widthScore = 100 - Math.abs(args.creditToWidthPct - targetWidth) * 220;
  return clamp(riskScore * 0.7 + widthScore * 0.3, 0, 100);
}

function scoreDelta(deltaAbs: number | null, riskMode: CreditSpreadRiskMode) {
  if (deltaAbs === null) return 55;
  const target = riskMode === "aggressive" ? 0.30 : riskMode === "conservative" ? 0.12 : 0.20;
  return clamp(100 - Math.abs(deltaAbs - target) * 250, 0, 100);
}

function scoreRisk(args: { maxLossDollars: number; maxRiskDollars: number | null; actualWidth: number; riskMode: CreditSpreadRiskMode }) {
  if (args.maxRiskDollars !== null) {
    const pct = args.maxLossDollars / Math.max(args.maxRiskDollars, 1);
    if (pct <= 0.65) return 100;
    if (pct <= 1.0) return 100 - (pct - 0.65) * 90;
    return 0;
  }

  const preferredWidth = args.riskMode === "aggressive" ? 30 : args.riskMode === "conservative" ? 10 : 20;
  return clamp(100 - Math.abs(args.actualWidth - preferredWidth) * 2.2, 35, 100);
}

function scoreWidth(width: number, riskMode: CreditSpreadRiskMode) {
  const preferred = riskMode === "aggressive" ? 30 : riskMode === "conservative" ? 10 : 20;
  return clamp(100 - Math.abs(width - preferred) * 2.5, 30, 100);
}

function scoreLiquidity(shortRow: ZeroDteChainRow, longRow: ZeroDteChainRow) {
  const short = quoteQuality(shortRow);
  const long = quoteQuality(longRow);
  return Math.round((short * 0.65 + long * 0.35));
}

function quoteQuality(row: ZeroDteChainRow) {
  const mid = getMid(row);
  const bid = numOrNull(row.bid);
  const ask = numOrNull(row.ask);
  if (mid === null || bid === null || ask === null || ask <= bid) return 35;
  const spreadPct = (ask - bid) / Math.max(mid, 0.05);
  if (spreadPct <= 0.10) return 100;
  if (spreadPct <= 0.20) return 82;
  if (spreadPct <= 0.35) return 62;
  if (spreadPct <= 0.55) return 44;
  return 25;
}

function scoreSideBias(side: CreditSpreadSide, row: SpxOiMapRow) {
  if (side === "put" && row.sideBias === "put") return 100;
  if (side === "call" && row.sideBias === "call") return 100;
  if (row.sideBias === "balanced") return 70;
  return 45;
}

function describeWallRelationship(side: CreditSpreadSide, strike: number, wall: number | null) {
  if (!wall) return "No wall available for this side.";
  if (side === "put") {
    if (strike < wall) return `Short put is below the SPX put wall (${wall}), using OI support as cushion.`;
    if (strike === wall) return `Short put is directly at the SPX put wall (${wall}); higher premium but wall-touch risk.`;
    return `Short put is above the SPX put wall (${wall}); aggressive because it sells inside support.`;
  }

  if (strike > wall) return `Short call is above the SPX call wall (${wall}), using OI resistance as cushion.`;
  if (strike === wall) return `Short call is directly at the SPX call wall (${wall}); higher premium but wall-touch risk.`;
  return `Short call is below the SPX call wall (${wall}); aggressive because it sells inside resistance.`;
}

function minPctForRiskMode(mode: CreditSpreadRiskMode) {
  if (mode === "aggressive") return 0.32;
  if (mode === "conservative") return 0.62;
  return 0.45;
}

function maxPctForRiskMode(mode: CreditSpreadRiskMode) {
  if (mode === "aggressive") return 0.95;
  if (mode === "conservative") return 1.35;
  return 1.15;
}

function minCreditToRiskPctForRiskMode(mode: CreditSpreadRiskMode) {
  if (mode === "aggressive") return 0.10;
  if (mode === "conservative") return 0.06;
  return 0.08;
}

function maxWidthForRiskMode(mode: CreditSpreadRiskMode) {
  if (mode === "aggressive") return 50;
  if (mode === "conservative") return 25;
  return 40;
}

function minWidthForRiskMode(mode: CreditSpreadRiskMode) {
  if (mode === "conservative") return 5;
  return 5;
}


function isManualMoodSource(
  mood: ZeroDteMoodRead | null | undefined,
): mood is ZeroDteMoodRead {
  return (
    mood?.source === "manual-fallback" ||
    mood?.source === "manual-forced"
  );
}


function aggressionForRiskMode(mode: CreditSpreadRiskMode, pressure: number, moodPercent: number | null) {
  if (mode === "aggressive") return "high";
  if (mode === "conservative") return "low";
  if (Math.abs(pressure) > 45 || (moodPercent !== null && Math.abs(moodPercent) > 70)) return "high";
  if (Math.abs(pressure) < 15) return "low";
  return "medium";
}

function normalizeWidth(width: number) {
  const cleaned = Number.isFinite(width) && width > 0 ? width : 20;
  return Math.max(5, Math.round(cleaned / 5) * 5);
}

function getMid(row?: ZeroDteChainRow | null) {
  if (!row) return null;
  const mid = numOrNull(row.mid);
  if (mid !== null && mid > 0) return mid;
  const bid = numOrNull(row.bid);
  const ask = numOrNull(row.ask);
  if (bid !== null && ask !== null && ask > 0) return (bid + ask) / 2;
  const last = numOrNull(row.last);
  if (last !== null && last > 0) return last;
  return null;
}

function cleanAbs(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.abs(value);
}

function numOrNull(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundMoney(n: number) {
  return Math.round(n * 100) / 100;
}

function fmtMoney(n: number) {
  return `$${n.toFixed(2)}`;
}

function unique(items: string[]) {
  return [...new Set(items.filter(Boolean))];
}

function uniqueNumbers(items: number[]) {
  return [...new Set(items.filter((n) => Number.isFinite(n) && n > 0))];
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
