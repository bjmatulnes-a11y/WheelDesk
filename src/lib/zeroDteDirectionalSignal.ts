import type { ZeroDteExecutionRead } from "./zeroDteExecutionIntelligence";
import type { ZeroDteLeastResistancePath } from "./zeroDteLeastResistancePath";
import type { ZeroDteMoodRead } from "./zeroDteMoodEngine";
import type { ZeroDteRecommendation } from "./zeroDteOiIntelligence";
import type {
  StructureCandle,
  StructureDirection,
  StructureBreak,
  ZeroDteStructureSnapshot,
} from "./zeroDteStructureMap";
import type {
  OpeningPriorContext,
  PriorStructureLevel,
} from "./zeroDtePriorStructure";

export type ZeroDteDirectionalAction = "BUY" | "SELL" | "WAIT";
export type ZeroDteDirectionalStrategy = "PCS" | "CCS" | null;
export type ZeroDteDirectionalState = "TREND" | "TRANSITION" | "NEUTRAL";
export type ZeroDteDirectionalTrigger = "COMPOSITE" | "REVERSAL_CAPTURE" | "CONTINUATION_CAPTURE" | null;

export type ZeroDteDirectionalSignal = {
  action: ZeroDteDirectionalAction;
  strategy: ZeroDteDirectionalStrategy;
  score: number;
  bullishScore: number;
  bearishScore: number;
  margin: number;
  threshold: number;
  requiredMargin: number;
  generatedAt: number | null;
  currentPrice: number;
  state: ZeroDteDirectionalState;
  trigger: ZeroDteDirectionalTrigger;
  structureConfirmed: boolean;
  reasons: string[];
  blockers: string[];
  gates: {
    bullConfirmed: boolean;
    bearConfirmed: boolean;
    bullVeto: boolean;
    bearVeto: boolean;
    bullExternalBosVeto: boolean;
    bearExternalBosVeto: boolean;
    bullReversalCapture: boolean;
    bearReversalCapture: boolean;
    bullContinuationCapture: boolean;
    bearContinuationCapture: boolean;
    transition: boolean;
    higherExternalTrend: StructureDirection | null;
  };
  groups: {
    structureBull: number;
    structureBear: number;
    marketBull: number;
    marketBear: number;
    executionBull: number | null;
    executionBear: number | null;
  };
};

type Side = "BULL" | "BEAR";

type StructureScore = {
  bull: number;
  bear: number;
  bullConfirmed: boolean;
  bearConfirmed: boolean;
  bullVeto: boolean;
  bearVeto: boolean;
  bullExternalBosVeto: boolean;
  bearExternalBosVeto: boolean;
  transition: boolean;
  reasonsBull: string[];
  reasonsBear: string[];
};

type MarketScore = {
  bull: number;
  bear: number;
  reasonsBull: string[];
  reasonsBear: string[];
};

export type ZeroDteReversalCaptureRead = {
  direction: StructureDirection;
  qualified: boolean;
  choch: StructureBreak | null;
  bos: StructureBreak | null;
  bosAgeBars: number | null;
  confirmationCount: number;
  confirmations: string[];
  chaseDistancePoints: number | null;
  maxChaseDistancePoints: number | null;
  blocker: string | null;
};

export type ZeroDteContinuationCaptureRead = {
  direction: StructureDirection;
  qualified: boolean;
  priorBos: StructureBreak | null;
  freshBos: StructureBreak | null;
  freshBosAgeBars: number | null;
  pullbackSwingLabel: "HL" | "LH" | null;
  pullbackSwingPrice: number | null;
  confirmationCount: number;
  confirmations: string[];
  chaseDistancePoints: number | null;
  maxChaseDistancePoints: number | null;
  blocker: string | null;
};

export function buildZeroDteDirectionalSignal(args: {
  candles: readonly StructureCandle[];
  structure: ZeroDteStructureSnapshot;
  higherTimeframeStructure?: ZeroDteStructureSnapshot | null;
  recommendation: ZeroDteRecommendation | null | undefined;
  mood?: ZeroDteMoodRead | null;
  leastResistancePath?: ZeroDteLeastResistancePath | null;
  executionReads?: readonly ZeroDteExecutionRead[];
  pin?: number | null;
  callWall?: number | null;
  putWall?: number | null;
  priorLevels?: readonly PriorStructureLevel[];
  openingPriorContext?: OpeningPriorContext | null;
  usePriorStructure?: boolean;
}): ZeroDteDirectionalSignal {
  const recommendation = args.recommendation ?? null;
  const currentPrice = finite(recommendation?.spxPrice)
    ? recommendation!.spxPrice
    : args.candles.at(-1)?.close ?? 0;
  const expectedMove = Math.max(1, finite(recommendation?.expectedMove) ? recommendation!.expectedMove : 20);

  const usePriorStructure = args.usePriorStructure !== false;
  const structure = scoreStructure({
    candles: args.candles,
    snapshot: args.structure,
    higher: args.higherTimeframeStructure ?? null,
    currentPrice,
    expectedMove,
    priorLevels: usePriorStructure ? args.priorLevels ?? [] : [],
  });
  const market = scoreMarket({
    recommendation,
    mood: args.mood ?? null,
    path: args.leastResistancePath ?? null,
    pin: args.pin ?? recommendation?.spx.strongestPin ?? null,
    callWall: args.callWall ?? recommendation?.spx.callWall ?? null,
    putWall: args.putWall ?? recommendation?.spx.putWall ?? null,
    currentPrice,
    expectedMove,
    openingPriorContext: usePriorStructure ? args.openingPriorContext ?? null : null,
    usePriorStructure,
  });

  const putRead = findEntryRead(args.executionReads ?? [], "put-credit-spread");
  const callRead = findEntryRead(args.executionReads ?? [], "call-credit-spread");
  const executionBull = scoreExecutionAdjustment(putRead);
  const executionBear = scoreExecutionAdjustment(callRead);

  const bull = combineScores(structure.bull, market.bull, executionBull);
  const bear = combineScores(structure.bear, market.bear, executionBear);
  const winner: Side = bull >= bear ? "BULL" : "BEAR";
  const winnerScore = winner === "BULL" ? bull : bear;
  const loserScore = winner === "BULL" ? bear : bull;
  const margin = Math.max(0, winnerScore - loserScore);

  const bullReversal = detectDirectionalReversalCapture({
    candles: args.candles,
    snapshot: args.structure,
    leastResistancePath: args.leastResistancePath ?? null,
    currentPrice,
    expectedMove,
    direction: "BULL",
  });
  const bearReversal = detectDirectionalReversalCapture({
    candles: args.candles,
    snapshot: args.structure,
    leastResistancePath: args.leastResistancePath ?? null,
    currentPrice,
    expectedMove,
    direction: "BEAR",
  });
  const bullContinuation = detectDirectionalContinuationCapture({
    candles: args.candles,
    snapshot: args.structure,
    leastResistancePath: args.leastResistancePath ?? null,
    currentPrice,
    expectedMove,
    direction: "BULL",
  });
  const bearContinuation = detectDirectionalContinuationCapture({
    candles: args.candles,
    snapshot: args.structure,
    leastResistancePath: args.leastResistancePath ?? null,
    currentPrice,
    expectedMove,
    direction: "BEAR",
  });
  const priceValid = Number.isFinite(currentPrice) && currentPrice > 0;
  const structuralCapture = priceValid
    ? chooseStructuralCapture({ bullReversal, bearReversal, bullContinuation, bearContinuation })
    : null;

  const transition = structure.transition;
  const threshold = transition ? 82 : 74;
  const requiredMargin = transition ? 20 : 14;
  const winnerConfirmed = winner === "BULL" ? structure.bullConfirmed : structure.bearConfirmed;
  const winnerVeto = winner === "BULL" ? structure.bullVeto : structure.bearVeto;
  const winnerStructureScore = winner === "BULL" ? structure.bull : structure.bear;
  const chopGuardRequired = transition || !args.higherTimeframeStructure?.trendExternal;
  const compositeBlockers: string[] = [];

  if (!winnerConfirmed) compositeBlockers.push("Structure has not confirmed the winning side.");
  if (winnerVeto) compositeBlockers.push("Fresh opposite continuation structure vetoes the signal.");
  if (chopGuardRequired && winnerStructureScore < 45) {
    compositeBlockers.push(`Structure score ${winnerStructureScore} is below 45 for transition / unconfirmed 5m structure.`);
  }
  if (winnerScore < threshold) compositeBlockers.push(`Score ${winnerScore} is below ${threshold}.`);
  if (margin < requiredMargin) compositeBlockers.push(`Directional margin ${margin} is below ${requiredMargin}.`);
  if (!priceValid) compositeBlockers.push("Current SPX price is unavailable.");

  const compositeSide: Side | null = compositeBlockers.length ? null : winner;
  const selectedSide = structuralCapture?.side ?? compositeSide;
  const trigger: ZeroDteDirectionalTrigger = structuralCapture?.trigger ?? (compositeSide ? "COMPOSITE" : null);
  const action: ZeroDteDirectionalAction = selectedSide === "BULL"
    ? "BUY"
    : selectedSide === "BEAR"
      ? "SELL"
      : "WAIT";
  const strategy: ZeroDteDirectionalStrategy = action === "BUY" ? "PCS" : action === "SELL" ? "CCS" : null;
  const selectedScore = selectedSide === "BULL" ? bull : selectedSide === "BEAR" ? bear : winnerScore;
  const selectedConfirmed = selectedSide === "BULL"
    ? (structure.bullConfirmed || bullReversal.qualified || bullContinuation.qualified)
    : selectedSide === "BEAR"
      ? (structure.bearConfirmed || bearReversal.qualified || bearContinuation.qualified)
      : winnerConfirmed;
  const blockers = action === "WAIT" ? compositeBlockers : [];

  const captureReasons = trigger === "REVERSAL_CAPTURE"
    ? selectedSide === "BULL"
      ? reversalCaptureReasons(bullReversal)
      : selectedSide === "BEAR"
        ? reversalCaptureReasons(bearReversal)
        : []
    : trigger === "CONTINUATION_CAPTURE"
      ? selectedSide === "BULL"
        ? continuationCaptureReasons(bullContinuation)
        : selectedSide === "BEAR"
          ? continuationCaptureReasons(bearContinuation)
          : []
      : [];
  const reasons = action === "BUY"
    ? [...captureReasons, ...structure.reasonsBull, ...market.reasonsBull, ...executionReasons(putRead, "PCS")]
    : action === "SELL"
      ? [...captureReasons, ...structure.reasonsBear, ...market.reasonsBear, ...executionReasons(callRead, "CCS")]
      : waitReasons({ bull, bear, structure, market, putRead, callRead });

  return {
    action,
    strategy,
    score: selectedScore,
    bullishScore: bull,
    bearishScore: bear,
    margin,
    threshold,
    requiredMargin,
    generatedAt: args.structure.generatedAt,
    currentPrice,
    state: transition ? "TRANSITION" : selectedScore >= 60 ? "TREND" : "NEUTRAL",
    trigger,
    structureConfirmed: selectedConfirmed,
    reasons: dedupe(reasons).slice(0, 8),
    blockers: dedupe(blockers),
    gates: {
      bullConfirmed: structure.bullConfirmed || bullReversal.qualified || bullContinuation.qualified,
      bearConfirmed: structure.bearConfirmed || bearReversal.qualified || bearContinuation.qualified,
      bullVeto: structure.bullVeto && !bullReversal.qualified && !bullContinuation.qualified,
      bearVeto: structure.bearVeto && !bearReversal.qualified && !bearContinuation.qualified,
      bullExternalBosVeto: structure.bullExternalBosVeto && !bullReversal.qualified && !bullContinuation.qualified,
      bearExternalBosVeto: structure.bearExternalBosVeto && !bearReversal.qualified && !bearContinuation.qualified,
      bullReversalCapture: bullReversal.qualified,
      bearReversalCapture: bearReversal.qualified,
      bullContinuationCapture: bullContinuation.qualified,
      bearContinuationCapture: bearContinuation.qualified,
      transition,
      higherExternalTrend: args.higherTimeframeStructure?.trendExternal ?? null,
    },
    groups: {
      structureBull: structure.bull,
      structureBear: structure.bear,
      marketBull: market.bull,
      marketBear: market.bear,
      executionBull,
      executionBear,
    },
  };
}

function scoreStructure(args: {
  candles: readonly StructureCandle[];
  snapshot: ZeroDteStructureSnapshot;
  higher: ZeroDteStructureSnapshot | null;
  currentPrice: number;
  expectedMove: number;
  priorLevels: readonly PriorStructureLevel[];
}): StructureScore {
  const { candles, snapshot, higher, currentPrice, expectedMove } = args;
  const lastIndex = Math.max(0, candles.length - 1);
  let bull = 0;
  let bear = 0;
  const reasonsBull: string[] = [];
  const reasonsBear: string[] = [];

  addTrend(snapshot.trendExternal, 22, "External trend", reasonsBull, reasonsBear, (side, value) => {
    if (side === "BULL") bull += value; else bear += value;
  });
  addTrend(snapshot.trendInternal, 12, "Internal trend", reasonsBull, reasonsBear, (side, value) => {
    if (side === "BULL") bull += value; else bear += value;
  });
  addTrend(higher?.trendExternal ?? null, 16, "5m external trend", reasonsBull, reasonsBear, (side, value) => {
    if (side === "BULL") bull += value; else bear += value;
  });
  addTrend(higher?.trendInternal ?? null, 8, "5m internal trend", reasonsBull, reasonsBear, (side, value) => {
    if (side === "BULL") bull += value; else bear += value;
  });

  const latestBreak = snapshot.breaks.at(-1) ?? null;
  const latestExternal = [...snapshot.breaks].reverse().find((event) => event.scale === "EXTERNAL") ?? null;
  const latestInternal = [...snapshot.breaks].reverse().find((event) => event.scale === "INTERNAL") ?? null;

  if (latestBreak) {
    const age = Math.max(0, lastIndex - latestBreak.breakIndex);
    if (age <= 12) {
      const base = latestBreak.scale === "EXTERNAL" ? 22 : 14;
      const kindBoost = latestBreak.kind === "BOS" ? 1 : 0.88;
      const recency = clamp(1 - age / 18, 0.45, 1);
      const points = Math.round(base * kindBoost * recency);
      if (latestBreak.direction === "BULL") {
        bull += points;
        reasonsBull.push(`${formatBreak(latestBreak)} ${age} bars ago`);
      } else {
        bear += points;
        reasonsBear.push(`${formatBreak(latestBreak)} ${age} bars ago`);
      }
    }
  }

  const recentSweep = snapshot.sweeps.at(-1) ?? null;
  if (recentSweep) {
    const age = Math.max(0, lastIndex - recentSweep.sweepIndex);
    if (age <= 8) {
      const points = recentSweep.scale === "EXTERNAL" ? 12 : 7;
      if (recentSweep.direction === "BULL") {
        bull += points;
        reasonsBull.push("Downside liquidity sweep reclaimed");
      } else {
        bear += points;
        reasonsBear.push("Upside liquidity sweep rejected");
      }
    }
  }

  const externalSwings = snapshot.swings.filter((swing) => swing.scale === "EXTERNAL");
  const lastHigh = [...externalSwings].reverse().find((swing) => swing.kind === "HIGH") ?? null;
  const lastLow = [...externalSwings].reverse().find((swing) => swing.kind === "LOW") ?? null;
  if (lastHigh?.label === "HH") { bull += 6; reasonsBull.push("External HH"); }
  if (lastHigh?.label === "LH") { bear += 6; reasonsBear.push("External LH"); }
  if (lastLow?.label === "HL") { bull += 6; reasonsBull.push("External HL"); }
  if (lastLow?.label === "LL") { bear += 6; reasonsBear.push("External LL"); }

  const reversal = snapshot.reversals.at(-1) ?? null;
  if (reversal) {
    const age = Math.max(0, lastIndex - reversal.index);
    if (age <= 4) {
      const points = reversal.enhanced ? 7 : 4;
      if (reversal.direction === "BULL") {
        bull += points;
        reasonsBull.push(`${reversal.enhanced ? "Enhanced " : ""}3-bar bullish reversal`);
      } else {
        bear += points;
        reasonsBear.push(`${reversal.enhanced ? "Enhanced " : ""}3-bar bearish reversal`);
      }
    }
  }

  const atr = averageTrueRange(candles, 14);
  const minGap = Math.max(0.35, atr * 0.16);
  const proximity = Math.max(4, Math.min(expectedMove * 0.32, 18));
  const activeFvgs = snapshot.fvgs.filter((fvg) => !fvg.mitigated && fvg.high - fvg.low >= minGap);
  const bullShelf = activeFvgs
    .filter((fvg) => fvg.direction === "BULL" && fvg.low <= currentPrice && currentPrice - fvg.high <= proximity)
    .sort((a, b) => Math.abs(currentPrice - a.high) - Math.abs(currentPrice - b.high))[0];
  const bearShelf = activeFvgs
    .filter((fvg) => fvg.direction === "BEAR" && fvg.high >= currentPrice && fvg.low - currentPrice <= proximity)
    .sort((a, b) => Math.abs(currentPrice - a.low) - Math.abs(currentPrice - b.low))[0];
  if (bullShelf) { bull += 8; reasonsBull.push("Meaningful bull FVG support nearby"); }
  if (bearShelf) { bear += 8; reasonsBear.push("Meaningful bear FVG resistance nearby"); }

  const recentBreaks = snapshot.breaks.filter((event) => lastIndex - event.breakIndex <= 18).slice(-8);
  let directionChanges = 0;
  for (let index = 1; index < recentBreaks.length; index += 1) {
    if (recentBreaks[index].direction !== recentBreaks[index - 1].direction) directionChanges += 1;
  }
  const bothDirectionsVeryRecent = recentBreaks
    .filter((event) => lastIndex - event.breakIndex <= 5)
    .some((event) => event.direction === "BULL") && recentBreaks
    .filter((event) => lastIndex - event.breakIndex <= 5)
    .some((event) => event.direction === "BEAR");
  const transition = directionChanges >= 3 || bothDirectionsVeryRecent;
  if (directionChanges >= 3) {
    bull *= 0.58;
    bear *= 0.58;
  } else if (directionChanges === 2) {
    bull *= 0.78;
    bear *= 0.78;
  }

  const priorSweep = priorSessionSweepBonus({
    snapshot,
    levels: args.priorLevels,
    expectedMove,
    lastIndex,
  });
  if (priorSweep?.direction === "BULL") {
    bull += 6;
    reasonsBull.push(`Prior/overnight level sweep reclaimed (${priorSweep.levelId})`);
  } else if (priorSweep?.direction === "BEAR") {
    bear += 6;
    reasonsBear.push(`Prior/overnight level sweep rejected (${priorSweep.levelId})`);
  }

  const latestBreakAge = latestBreak ? lastIndex - latestBreak.breakIndex : Number.POSITIVE_INFINITY;
  const bullConfirmed = Boolean(
    (latestBreak?.direction === "BULL" && latestBreakAge <= 10) ||
    (snapshot.trendInternal === "BULL" && snapshot.trendExternal === "BULL" && latestBreakAge <= 18),
  );
  const bearConfirmed = Boolean(
    (latestBreak?.direction === "BEAR" && latestBreakAge <= 10) ||
    (snapshot.trendInternal === "BEAR" && snapshot.trendExternal === "BEAR" && latestBreakAge <= 18),
  );

  const bullVeto = freshOppositeContinuation(latestExternal, latestInternal, lastIndex, "BULL");
  const bearVeto = freshOppositeContinuation(latestExternal, latestInternal, lastIndex, "BEAR");
  const bullExternalBosVeto = freshOppositeExternalContinuation(latestExternal, lastIndex, "BULL");
  const bearExternalBosVeto = freshOppositeExternalContinuation(latestExternal, lastIndex, "BEAR");

  return {
    bull: clamp(Math.round(bull), 0, 100),
    bear: clamp(Math.round(bear), 0, 100),
    bullConfirmed,
    bearConfirmed,
    bullVeto,
    bearVeto,
    bullExternalBosVeto,
    bearExternalBosVeto,
    transition,
    reasonsBull,
    reasonsBear,
  };
}


function chooseStructuralCapture(args: {
  bullReversal: ZeroDteReversalCaptureRead;
  bearReversal: ZeroDteReversalCaptureRead;
  bullContinuation: ZeroDteContinuationCaptureRead;
  bearContinuation: ZeroDteContinuationCaptureRead;
}): { side: Side; trigger: Exclude<ZeroDteDirectionalTrigger, "COMPOSITE" | null> } | null {
  const candidates: Array<{
    side: Side;
    trigger: Exclude<ZeroDteDirectionalTrigger, "COMPOSITE" | null>;
    breakIndex: number;
    confirmations: number;
  }> = [];

  if (args.bullReversal.qualified) candidates.push({
    side: "BULL", trigger: "REVERSAL_CAPTURE",
    breakIndex: args.bullReversal.bos?.breakIndex ?? -1,
    confirmations: args.bullReversal.confirmationCount,
  });
  if (args.bearReversal.qualified) candidates.push({
    side: "BEAR", trigger: "REVERSAL_CAPTURE",
    breakIndex: args.bearReversal.bos?.breakIndex ?? -1,
    confirmations: args.bearReversal.confirmationCount,
  });
  if (args.bullContinuation.qualified) candidates.push({
    side: "BULL", trigger: "CONTINUATION_CAPTURE",
    breakIndex: args.bullContinuation.freshBos?.breakIndex ?? -1,
    confirmations: args.bullContinuation.confirmationCount,
  });
  if (args.bearContinuation.qualified) candidates.push({
    side: "BEAR", trigger: "CONTINUATION_CAPTURE",
    breakIndex: args.bearContinuation.freshBos?.breakIndex ?? -1,
    confirmations: args.bearContinuation.confirmationCount,
  });

  if (!candidates.length) return null;
  candidates.sort((a, b) =>
    b.breakIndex - a.breakIndex ||
    b.confirmations - a.confirmations ||
    (a.trigger === "REVERSAL_CAPTURE" ? -1 : 1),
  );
  const best = candidates[0];
  const tiedOpposite = candidates.find((item, index) =>
    index > 0 &&
    item.breakIndex === best.breakIndex &&
    item.confirmations === best.confirmations &&
    item.side !== best.side,
  );
  return tiedOpposite ? null : { side: best.side, trigger: best.trigger };
}

function reversalCaptureReasons(read: ZeroDteReversalCaptureRead): string[] {
  if (!read.qualified) return [];
  const side = read.direction === "BULL" ? "Bullish" : "Bearish";
  return [
    `${side} reversal capture: CHoCH → BOS`,
    ...read.confirmations.slice(0, 3),
  ];
}

/**
 * Early-turn path for the simple BULL/PCS and BEAR/CCS chart decision.
 *
 * This intentionally does not lower the normal 74/82 composite thresholds.
 * Instead it recognizes a compact structural reversal sequence soon after it
 * confirms, so lagging market context cannot hide an otherwise actionable turn.
 *
 * Mandatory:
 *   same-direction CHoCH -> later same-direction BOS
 *   BOS no older than 4 completed 1m bars
 *   no opposite BOS after that BOS
 *   not already extended too far beyond the BOS level
 *
 * Plus at least two independent confirmations:
 *   HL/LH, same-direction active FVG, same-direction liquidity sweep, LRP agreement.
 */
export function detectDirectionalReversalCapture(args: {
  candles: readonly StructureCandle[];
  snapshot: ZeroDteStructureSnapshot;
  leastResistancePath?: ZeroDteLeastResistancePath | null;
  currentPrice: number;
  expectedMove: number;
  direction: StructureDirection;
}): ZeroDteReversalCaptureRead {
  const { candles, snapshot, direction } = args;
  const lastIndex = Math.max(0, candles.length - 1);
  const opposite: Side = direction === "BULL" ? "BEAR" : "BULL";
  const sameDirectionBreaks = snapshot.breaks.filter((event) => event.direction === direction);

  let choch: StructureBreak | null = null;
  let bos: StructureBreak | null = null;
  for (let index = sameDirectionBreaks.length - 1; index >= 0; index -= 1) {
    const candidateBos = sameDirectionBreaks[index];
    if (candidateBos.kind !== "BOS") continue;
    const age = lastIndex - candidateBos.breakIndex;
    if (age < 0 || age > 4) continue;

    const candidateChoch = [...sameDirectionBreaks]
      .slice(0, index)
      .reverse()
      .find((event) =>
        event.kind === "CHOCH" &&
        event.breakIndex < candidateBos.breakIndex &&
        candidateBos.breakIndex - event.breakIndex <= 10,
      ) ?? null;
    if (!candidateChoch) continue;
    choch = candidateChoch;
    bos = candidateBos;
    break;
  }

  if (!choch || !bos) {
    return {
      direction,
      qualified: false,
      choch,
      bos,
      bosAgeBars: bos ? Math.max(0, lastIndex - bos.breakIndex) : null,
      confirmationCount: 0,
      confirmations: [],
      chaseDistancePoints: null,
      maxChaseDistancePoints: null,
      blocker: "CHoCH → BOS reversal sequence is not confirmed.",
    };
  }

  const bosAgeBars = Math.max(0, lastIndex - bos.breakIndex);
  const conflictingBreakBetween = snapshot.breaks.some((event) =>
    event.direction === opposite &&
    event.breakIndex > choch!.breakIndex &&
    event.breakIndex < bos!.breakIndex,
  );
  if (conflictingBreakBetween) {
    return {
      direction,
      qualified: false,
      choch,
      bos,
      bosAgeBars,
      confirmationCount: 0,
      confirmations: [],
      chaseDistancePoints: null,
      maxChaseDistancePoints: null,
      blocker: "Opposite structure interrupted the CHoCH → BOS sequence.",
    };
  }

  const bosStillHeld = direction === "BULL"
    ? args.currentPrice >= bos.level
    : args.currentPrice <= bos.level;
  if (!bosStillHeld) {
    return {
      direction,
      qualified: false,
      choch,
      bos,
      bosAgeBars,
      confirmationCount: 0,
      confirmations: [],
      chaseDistancePoints: 0,
      maxChaseDistancePoints: null,
      blocker: "Price failed back through the reversal BOS level.",
    };
  }

  const oppositeBosAfter = snapshot.breaks.some((event) =>
    event.kind === "BOS" &&
    event.direction === opposite &&
    event.breakIndex > bos!.breakIndex,
  );
  if (oppositeBosAfter) {
    return {
      direction,
      qualified: false,
      choch,
      bos,
      bosAgeBars,
      confirmationCount: 0,
      confirmations: [],
      chaseDistancePoints: null,
      maxChaseDistancePoints: null,
      blocker: "Opposite BOS printed after the reversal BOS.",
    };
  }

  const atr = averageTrueRange(candles, 14);
  const maxChaseDistancePoints = Math.max(
    3,
    Math.min(8, Math.max(args.expectedMove * 0.18, atr * 1.8)),
  );
  const chaseDistancePoints = direction === "BULL"
    ? Math.max(0, args.currentPrice - bos.level)
    : Math.max(0, bos.level - args.currentPrice);
  if (chaseDistancePoints > maxChaseDistancePoints) {
    return {
      direction,
      qualified: false,
      choch,
      bos,
      bosAgeBars,
      confirmationCount: 0,
      confirmations: [],
      chaseDistancePoints,
      maxChaseDistancePoints,
      blocker: "Reversal is already too extended to issue a fresh capture signal.",
    };
  }

  const confirmations: string[] = [];

  const desiredSwingLabel = direction === "BULL" ? "HL" : "LH";
  const confirmingSwing = [...snapshot.swings]
    .reverse()
    .find((swing) =>
      swing.label === desiredSwingLabel &&
      swing.confirmIndex >= choch!.breakIndex - 2 &&
      lastIndex - swing.confirmIndex <= 10,
    );
  if (confirmingSwing) confirmations.push(`${desiredSwingLabel} confirmed`);

  const minGap = Math.max(0.35, atr * 0.16);
  const fvgProximity = Math.max(4, Math.min(args.expectedMove * 0.30, 16));
  const confirmingFvg = [...snapshot.fvgs]
    .reverse()
    .find((fvg) => {
      if (fvg.mitigated || fvg.direction !== direction || fvg.high - fvg.low < minGap) return false;
      if (fvg.startIndex < choch!.breakIndex - 1) return false;
      if (direction === "BULL") {
        return fvg.low <= args.currentPrice && args.currentPrice - fvg.high <= fvgProximity;
      }
      return fvg.high >= args.currentPrice && fvg.low - args.currentPrice <= fvgProximity;
    });
  if (confirmingFvg) confirmations.push(`${direction === "BULL" ? "Bull" : "Bear"} FVG holding`);

  const confirmingSweep = [...snapshot.sweeps]
    .reverse()
    .find((sweep) =>
      sweep.direction === direction &&
      sweep.sweepIndex >= choch!.breakIndex - 8 &&
      sweep.sweepIndex <= bos!.breakIndex &&
      lastIndex - sweep.sweepIndex <= 12,
    );
  if (confirmingSweep) confirmations.push(`${direction === "BULL" ? "Downside" : "Upside"} sweep`);

  const path = args.leastResistancePath;
  const pathAligned = Boolean(
    path &&
    path.direction === (direction === "BULL" ? "UP" : "DOWN") &&
    path.confidence >= 45,
  );
  if (pathAligned) confirmations.push(`LRP ${direction === "BULL" ? "up" : "down"} ${Math.round(path!.confidence)}%`);

  const qualified = confirmations.length >= 2;
  return {
    direction,
    qualified,
    choch,
    bos,
    bosAgeBars,
    confirmationCount: confirmations.length,
    confirmations,
    chaseDistancePoints,
    maxChaseDistancePoints,
    blocker: qualified ? null : "Reversal needs at least two confirmations beyond CHoCH → BOS.",
  };
}

function continuationCaptureReasons(read: ZeroDteContinuationCaptureRead): string[] {
  if (!read.qualified) return [];
  const side = read.direction === "BULL" ? "Bullish" : "Bearish";
  return [
    `${side} continuation capture: pullback → BOS`,
    ...read.confirmations.slice(0, 3),
  ];
}

/**
 * Early continuation path for the simple BULL/PCS and BEAR/CCS decision.
 *
 * This catches the second leg of an established move without lowering the
 * normal 74/82 composite thresholds. It deliberately waits for a countertrend
 * pullback (HL for BULL / LH for BEAR) and a fresh same-direction BOS, then
 * refuses to print if the move has already run too far beyond that BOS.
 *
 * Mandatory:
 *   prior same-direction BOS -> pullback HL/LH -> fresh same-direction BOS
 *   no opposite BOS between the two BOS events
 *   fresh BOS no older than 3 completed 1m bars
 *   price still holds beyond the fresh BOS
 *   no opposite BOS after the fresh BOS
 *   not already extended too far beyond the trigger
 *
 * Plus at least one additional confirmation beyond the mandatory pullback:
 *   same-direction active FVG, LRP agreement, same-direction 3BR, or aligned
 *   external trend. This keeps the path structural rather than score-driven.
 */
export function detectDirectionalContinuationCapture(args: {
  candles: readonly StructureCandle[];
  snapshot: ZeroDteStructureSnapshot;
  leastResistancePath?: ZeroDteLeastResistancePath | null;
  currentPrice: number;
  expectedMove: number;
  direction: StructureDirection;
}): ZeroDteContinuationCaptureRead {
  const { candles, snapshot, direction } = args;
  const lastIndex = Math.max(0, candles.length - 1);
  const opposite: Side = direction === "BULL" ? "BEAR" : "BULL";
  const desiredSwingLabel = direction === "BULL" ? "HL" : "LH";
  const sameBos = snapshot.breaks.filter((event) =>
    event.kind === "BOS" && event.direction === direction,
  );

  let freshBos: StructureBreak | null = null;
  let priorBos: StructureBreak | null = null;
  let pullbackSwing = null as ZeroDteStructureSnapshot["swings"][number] | null;

  for (let index = sameBos.length - 1; index >= 0; index -= 1) {
    const candidateFresh = sameBos[index];
    const age = lastIndex - candidateFresh.breakIndex;
    if (age < 0 || age > 3) continue;

    for (let priorIndex = index - 1; priorIndex >= 0; priorIndex -= 1) {
      const candidatePrior = sameBos[priorIndex];
      const separation = candidateFresh.breakIndex - candidatePrior.breakIndex;
      if (separation < 2) continue;
      if (separation > 30) break;

      const oppositeBosBetween = snapshot.breaks.some((event) =>
        event.kind === "BOS" &&
        event.direction === opposite &&
        event.breakIndex > candidatePrior.breakIndex &&
        event.breakIndex < candidateFresh.breakIndex,
      );
      if (oppositeBosBetween) continue;

      const swing = [...snapshot.swings]
        .reverse()
        .find((candidate) =>
          candidate.label === desiredSwingLabel &&
          candidate.index > candidatePrior.breakIndex &&
          candidate.confirmIndex <= candidateFresh.breakIndex + 1 &&
          candidate.confirmIndex >= candidatePrior.breakIndex &&
          candidateFresh.breakIndex - candidate.confirmIndex <= 12,
        ) ?? null;
      if (!swing) continue;

      priorBos = candidatePrior;
      freshBos = candidateFresh;
      pullbackSwing = swing;
      break;
    }
    if (freshBos) break;
  }

  if (!priorBos || !freshBos || !pullbackSwing) {
    return {
      direction,
      qualified: false,
      priorBos,
      freshBos,
      freshBosAgeBars: freshBos ? Math.max(0, lastIndex - freshBos.breakIndex) : null,
      pullbackSwingLabel: pullbackSwing?.label === "HL" || pullbackSwing?.label === "LH" ? pullbackSwing.label : null,
      pullbackSwingPrice: pullbackSwing?.price ?? null,
      confirmationCount: 0,
      confirmations: [],
      chaseDistancePoints: null,
      maxChaseDistancePoints: null,
      blocker: `Continuation needs prior BOS → ${desiredSwingLabel} pullback → fresh BOS.`,
    };
  }

  const freshBosAgeBars = Math.max(0, lastIndex - freshBos.breakIndex);
  const bosStillHeld = direction === "BULL"
    ? args.currentPrice >= freshBos.level
    : args.currentPrice <= freshBos.level;
  if (!bosStillHeld) {
    return {
      direction, qualified: false, priorBos, freshBos, freshBosAgeBars,
      pullbackSwingLabel: desiredSwingLabel, pullbackSwingPrice: pullbackSwing.price,
      confirmationCount: 1, confirmations: [`${desiredSwingLabel} pullback confirmed`],
      chaseDistancePoints: 0, maxChaseDistancePoints: null,
      blocker: "Price failed back through the continuation BOS level.",
    };
  }

  const oppositeBosAfter = snapshot.breaks.some((event) =>
    event.kind === "BOS" &&
    event.direction === opposite &&
    event.breakIndex > freshBos!.breakIndex,
  );
  if (oppositeBosAfter) {
    return {
      direction, qualified: false, priorBos, freshBos, freshBosAgeBars,
      pullbackSwingLabel: desiredSwingLabel, pullbackSwingPrice: pullbackSwing.price,
      confirmationCount: 1, confirmations: [`${desiredSwingLabel} pullback confirmed`],
      chaseDistancePoints: null, maxChaseDistancePoints: null,
      blocker: "Opposite BOS printed after the continuation BOS.",
    };
  }

  const atr = averageTrueRange(candles, 14);
  const maxChaseDistancePoints = Math.max(
    2.5,
    Math.min(6, Math.max(args.expectedMove * 0.12, atr * 1.5)),
  );
  const chaseDistancePoints = direction === "BULL"
    ? Math.max(0, args.currentPrice - freshBos.level)
    : Math.max(0, freshBos.level - args.currentPrice);
  if (chaseDistancePoints > maxChaseDistancePoints) {
    return {
      direction, qualified: false, priorBos, freshBos, freshBosAgeBars,
      pullbackSwingLabel: desiredSwingLabel, pullbackSwingPrice: pullbackSwing.price,
      confirmationCount: 1, confirmations: [`${desiredSwingLabel} pullback confirmed`],
      chaseDistancePoints, maxChaseDistancePoints,
      blocker: "Continuation is already too extended to issue a fresh capture signal.",
    };
  }

  const confirmations: string[] = [`${desiredSwingLabel} pullback confirmed`];
  const minGap = Math.max(0.35, atr * 0.16);
  const fvgProximity = Math.max(4, Math.min(args.expectedMove * 0.30, 16));
  const confirmingFvg = [...snapshot.fvgs]
    .reverse()
    .find((fvg) => {
      if (fvg.mitigated || fvg.direction !== direction || fvg.high - fvg.low < minGap) return false;
      if (fvg.startIndex < priorBos!.breakIndex - 2 || fvg.startIndex > freshBos!.breakIndex + 1) return false;
      if (direction === "BULL") {
        return fvg.low <= args.currentPrice && args.currentPrice - fvg.high <= fvgProximity;
      }
      return fvg.high >= args.currentPrice && fvg.low - args.currentPrice <= fvgProximity;
    });
  if (confirmingFvg) confirmations.push(`${direction === "BULL" ? "Bull" : "Bear"} FVG held through pullback`);

  const confirmingReversal = [...snapshot.reversals]
    .reverse()
    .find((reversal) =>
      reversal.direction === direction &&
      reversal.index >= pullbackSwing!.index - 2 &&
      reversal.index <= freshBos!.breakIndex &&
      freshBos!.breakIndex - reversal.index <= 8,
    );
  if (confirmingReversal) confirmations.push(`${confirmingReversal.enhanced ? "Enhanced " : ""}3-bar continuation rejection`);

  if (snapshot.trendExternal === direction) confirmations.push("External trend aligned");

  const path = args.leastResistancePath;
  const pathAligned = Boolean(
    path &&
    path.direction === (direction === "BULL" ? "UP" : "DOWN") &&
    path.confidence >= 45,
  );
  if (pathAligned) confirmations.push(`LRP ${direction === "BULL" ? "up" : "down"} ${Math.round(path!.confidence)}%`);

  const qualified = confirmations.length >= 2;
  return {
    direction,
    qualified,
    priorBos,
    freshBos,
    freshBosAgeBars,
    pullbackSwingLabel: desiredSwingLabel,
    pullbackSwingPrice: pullbackSwing.price,
    confirmationCount: confirmations.length,
    confirmations,
    chaseDistancePoints,
    maxChaseDistancePoints,
    blocker: qualified ? null : "Continuation needs one confirmation beyond the HL/LH pullback and fresh BOS.",
  };
}

function scoreMarket(args: {
  recommendation: ZeroDteRecommendation | null;
  mood: ZeroDteMoodRead | null;
  path: ZeroDteLeastResistancePath | null;
  pin: number | null;
  callWall: number | null;
  putWall: number | null;
  currentPrice: number;
  expectedMove: number;
  openingPriorContext: OpeningPriorContext | null;
  usePriorStructure: boolean;
}): MarketScore {
  let bull = 0;
  let bear = 0;
  const reasonsBull: string[] = [];
  const reasonsBear: string[] = [];

  const path = args.path;
  if (path && path.direction !== "NEUTRAL") {
    const confidence = clamp(path.confidence / 100, 0, 1);
    const routeQuality = clamp(path.routeSeparationScore / 100, 0, 1);
    const points = 26 * confidence + 10 * routeQuality;
    if (path.direction === "UP") {
      bull += points;
      reasonsBull.push(`LRP up ${path.confidence}%`);
    } else {
      bear += points;
      reasonsBear.push(`LRP down ${path.confidence}%`);
    }
  }

  const pressure = args.recommendation?.dealerPressure ?? 0;
  if (Math.abs(pressure) >= 10) {
    const points = 24 * clamp(Math.abs(pressure) / 70, 0, 1);
    if (pressure > 0) {
      bull += points;
      reasonsBull.push(`Dealer pressure +${Math.round(pressure)}`);
    } else {
      bear += points;
      reasonsBear.push(`Dealer pressure ${Math.round(pressure)}`);
    }
  }

  const mood = args.mood;
  if (mood && (mood.directionalBias === "bullish" || mood.directionalBias === "bearish")) {
    const quality = clamp((mood.confidence / 100) * (mood.coverageScore / 100), 0, 1);
    const points = 14 * quality;
    if (mood.directionalBias === "bullish") {
      bull += points;
      reasonsBull.push(`Mood bullish ${Math.round(mood.confidence)}%`);
    } else {
      bear += points;
      reasonsBear.push(`Mood bearish ${Math.round(mood.confidence)}%`);
    }
  }

  const pin = args.pin;
  if (finite(pin) && path && path.direction !== "NEUTRAL") {
    const delta = pin - args.currentPrice;
    const distance = Math.abs(delta);
    const maxDistance = Math.max(args.expectedMove * 1.25, 25);
    if (distance >= 1 && distance <= maxDistance) {
      const towardPin: Side = delta > 0 ? "BULL" : "BEAR";
      const pathSide: Side = path.direction === "UP" ? "BULL" : "BEAR";
      if (towardPin === pathSide) {
        const points = 14 * clamp(path.confidence / 100, 0, 1);
        if (towardPin === "BULL") {
          bull += points;
          reasonsBull.push("LRP agrees with pull toward pin");
        } else {
          bear += points;
          reasonsBear.push("LRP agrees with pull toward pin");
        }
      }
    }
  }

  const wallProximity = Math.max(3, Math.min(args.expectedMove * 0.16, 12));
  const trendGap = args.usePriorStructure &&
    args.openingPriorContext?.gapClass === "LARGE" &&
    !args.openingPriorContext.regainedPriorRange
      ? args.openingPriorContext.openingDayType
      : null;
  if (
    finite(args.putWall) &&
    Math.abs(args.currentPrice - args.putWall) <= wallProximity &&
    trendGap !== "OUTSIDE_DOWN"
  ) {
    bull += 7;
    reasonsBull.push("Near put-wall support");
  }
  if (
    finite(args.callWall) &&
    Math.abs(args.currentPrice - args.callWall) <= wallProximity &&
    trendGap !== "OUTSIDE_UP"
  ) {
    bear += 7;
    reasonsBear.push("Near call-wall resistance");
  }

  return {
    bull: clamp(Math.round(bull), 0, 100),
    bear: clamp(Math.round(bear), 0, 100),
    reasonsBull,
    reasonsBear,
  };
}

function priorSessionSweepBonus(args: {
  snapshot: ZeroDteStructureSnapshot;
  levels: readonly PriorStructureLevel[];
  expectedMove: number;
  lastIndex: number;
}): { direction: StructureDirection; levelId: string } | null {
  const keyLevels = args.levels.filter((level) =>
    level.id === "PDH" || level.id === "PDL" || level.id === "ONH" || level.id === "ONL",
  );
  if (!keyLevels.length) return null;
  const tolerance = Math.max(1, 0.05 * Math.max(1, args.expectedMove));
  const recent = [...args.snapshot.sweeps]
    .reverse()
    .find((sweep) =>
      args.lastIndex - sweep.sweepIndex <= 8 &&
      keyLevels.some((level) => Math.abs(level.price - sweep.level) <= tolerance),
    );
  if (!recent) return null;
  const level = keyLevels.find((item) => Math.abs(item.price - recent.level) <= tolerance);
  return level ? { direction: recent.direction, levelId: level.id } : null;
}

export function scoreExecutionAdjustment(read: ZeroDteExecutionRead | null): number | null {
  if (!read?.candidate) return null;
  let adjustment = 0;
  if (read.entryHardBlocked) adjustment -= 10;
  else if (read.lifecycle === "SELL_READY") adjustment += 8;
  else if (read.lifecycle === "ARMED") adjustment += 4;
  if (read.priceRejectionReady) adjustment += 3;
  return adjustment;
}

export function combineScores(structure: number, market: number, execution: number | null): number {
  const base = structure * 0.62 + market * 0.38;
  return clamp(Math.round(base + (execution ?? 0)), 0, 100);
}

function findEntryRead(
  reads: readonly ZeroDteExecutionRead[],
  strategy: "put-credit-spread" | "call-credit-spread",
): ZeroDteExecutionRead | null {
  return reads.find((read) => read.strategy === strategy && !read.position) ?? null;
}

function executionReasons(read: ZeroDteExecutionRead | null, label: "PCS" | "CCS"): string[] {
  if (!read?.candidate) return [];
  const reasons: string[] = [`${label} entry score ${Math.round(read.entryScore)}`];
  if (read.lifecycle === "SELL_READY") reasons.push(`${label} execution ready`);
  else if (read.lifecycle === "ARMED") reasons.push(`${label} armed`);
  if (read.priceRejectionReady) reasons.push(`${label} rejection confirmed`);
  if (read.entryHardBlocked) reasons.push(`${label} execution gate blocked`);
  return reasons;
}

function waitReasons(args: {
  bull: number;
  bear: number;
  structure: StructureScore;
  market: MarketScore;
  putRead: ZeroDteExecutionRead | null;
  callRead: ZeroDteExecutionRead | null;
}): string[] {
  const reasons: string[] = [`Bull ${args.bull} vs Bear ${args.bear}`];
  if (args.structure.transition) reasons.push("Alternating structure: transition / whipsaw");
  if (args.structure.bullVeto) reasons.push("Fresh bearish continuation blocks bullish bias");
  if (args.structure.bearVeto) reasons.push("Fresh bullish continuation blocks bearish bias");
  if (args.putRead?.entryHardBlocked && args.callRead?.entryHardBlocked) reasons.push("Both spread sides are execution-blocked");
  return reasons;
}

function freshOppositeContinuation(
  latestExternal: StructureBreak | null,
  latestInternal: StructureBreak | null,
  lastIndex: number,
  desired: Side,
): boolean {
  const opposite: Side = desired === "BULL" ? "BEAR" : "BULL";
  if (
    latestExternal?.direction === opposite &&
    latestExternal.kind === "BOS" &&
    lastIndex - latestExternal.breakIndex <= 7
  ) return true;
  if (
    latestInternal?.direction === opposite &&
    latestInternal.kind === "BOS" &&
    lastIndex - latestInternal.breakIndex <= 3
  ) return true;
  return false;
}

function freshOppositeExternalContinuation(
  latestExternal: StructureBreak | null,
  lastIndex: number,
  desired: Side,
): boolean {
  const opposite: Side = desired === "BULL" ? "BEAR" : "BULL";
  return Boolean(
    latestExternal?.direction === opposite &&
    latestExternal.kind === "BOS" &&
    lastIndex - latestExternal.breakIndex <= 7,
  );
}

function addTrend(
  trend: StructureDirection | null,
  points: number,
  label: string,
  bullReasons: string[],
  bearReasons: string[],
  add: (side: Side, points: number) => void,
) {
  if (!trend) return;
  add(trend, points);
  if (trend === "BULL") bullReasons.push(`${label} bullish`);
  else bearReasons.push(`${label} bearish`);
}

function formatBreak(event: StructureBreak): string {
  return `${event.scale === "INTERNAL" ? "Internal" : "External"} ${event.direction === "BULL" ? "bull" : "bear"} ${event.kind === "CHOCH" ? "CHoCH" : "BOS"}`;
}

function averageTrueRange(candles: readonly StructureCandle[], length: number): number {
  if (candles.length < 2) return 1;
  const start = Math.max(1, candles.length - Math.max(2, length));
  const ranges: number[] = [];
  for (let index = start; index < candles.length; index += 1) {
    const candle = candles[index];
    const priorClose = candles[index - 1]?.close ?? candle.open;
    ranges.push(Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - priorClose),
      Math.abs(candle.low - priorClose),
    ));
  }
  return ranges.length ? ranges.reduce((sum, value) => sum + value, 0) / ranges.length : 1;
}

export function aggregateStructureCandles(
  candles: readonly StructureCandle[],
  minutes: number,
): StructureCandle[] {
  const seconds = Math.max(1, Math.round(minutes)) * 60;
  const buckets = new Map<number, StructureCandle>();
  const counts = new Map<number, number>();
  for (const candle of candles) {
    const time = Math.floor(candle.time / seconds) * seconds;
    const current = buckets.get(time);
    if (!current) {
      buckets.set(time, { ...candle, time });
      counts.set(time, 1);
      continue;
    }
    counts.set(time, (counts.get(time) ?? 0) + 1);
    current.high = Math.max(current.high, candle.high);
    current.low = Math.min(current.low, candle.low);
    current.close = candle.close;
    if (finite(candle.volume)) current.volume = (finite(current.volume) ? current.volume! : 0) + candle.volume!;
  }
  const result = [...buckets.values()].sort((a, b) => a.time - b.time);
  const lastOneMinuteTime = candles.at(-1)?.time ?? null;
  const lastBucket = result.at(-1) ?? null;
  if (lastBucket && lastOneMinuteTime !== null) {
    const completeByTime = lastBucket.time + seconds <= lastOneMinuteTime + 60;
    const completeByCount = (counts.get(lastBucket.time) ?? 0) >= Math.max(1, Math.round(minutes));
    if (!completeByTime || !completeByCount) result.pop();
  }
  return result;
}

export type ZeroDteDirectionalLatchSide = "BULL" | "BEAR" | "WAIT";

export type ZeroDteDirectionalLatchState = {
  side: ZeroDteDirectionalLatchSide;
  trigger: ZeroDteDirectionalTrigger;
  enteredBarTime: number | null;
  lastBarTime: number | null;
  barsHeld: number;
};

export type ZeroDteDirectionalLatchStep = {
  state: ZeroDteDirectionalLatchState;
  entered: "BULL" | "BEAR" | null;
  exited: "BULL" | "BEAR" | null;
};

export function emptyDirectionalLatch(): ZeroDteDirectionalLatchState {
  return {
    side: "WAIT",
    trigger: null,
    enteredBarTime: null,
    lastBarTime: null,
    barsHeld: 0,
  };
}

/**
 * Advance the visible directional decision exactly once per completed 1m bar.
 * The raw signal may update every harvest tick, but the latch intentionally
 * prevents those intrabar updates from blinking the chart decision on/off.
 */
export function advanceDirectionalLatch(
  previous: ZeroDteDirectionalLatchState,
  raw: ZeroDteDirectionalSignal,
  completedBarTime: number,
): ZeroDteDirectionalLatchStep {
  if (previous.lastBarTime === completedBarTime) {
    return { state: previous, entered: null, exited: null };
  }

  if (previous.side === "WAIT") {
    const entered = raw.action === "BUY" ? "BULL" : raw.action === "SELL" ? "BEAR" : null;
    if (!entered) {
      return {
        state: { ...previous, lastBarTime: completedBarTime },
        entered: null,
        exited: null,
      };
    }
    return {
      state: {
        side: entered,
        trigger: raw.trigger ?? "COMPOSITE",
        enteredBarTime: completedBarTime,
        lastBarTime: completedBarTime,
        barsHeld: 1,
      },
      entered,
      exited: null,
    };
  }

  const held = previous.side;
  const heldScore = held === "BULL" ? raw.bullishScore : raw.bearishScore;
  const heldVeto = held === "BULL" ? raw.gates.bullVeto : raw.gates.bearVeto;
  const heldExternalBosVeto = held === "BULL"
    ? raw.gates.bullExternalBosVeto
    : raw.gates.bearExternalBosVeto;
  const oppositeConfirmed = held === "BULL" ? raw.gates.bearConfirmed : raw.gates.bullConfirmed;
  const nextBarsHeld = previous.barsHeld + 1;

  // A genuine continuation veto exits immediately; this is the one exception
  // to the three-bar minimum hold because the directional thesis is invalid.
  if (heldVeto || heldExternalBosVeto) {
    return {
      state: {
        side: "WAIT",
        trigger: null,
        enteredBarTime: null,
        lastBarTime: completedBarTime,
        barsHeld: 0,
      },
      entered: null,
      exited: held,
    };
  }

  const minimumHoldSatisfied = previous.barsHeld >= 3;
  const holdFloor = Math.max(0, raw.threshold - 10);
  const shouldExit = minimumHoldSatisfied && (heldScore < holdFloor || oppositeConfirmed);
  if (shouldExit) {
    return {
      state: {
        side: "WAIT",
        trigger: null,
        enteredBarTime: null,
        lastBarTime: completedBarTime,
        barsHeld: 0,
      },
      entered: null,
      exited: held,
    };
  }

  return {
    state: {
      ...previous,
      lastBarTime: completedBarTime,
      barsHeld: nextBarsHeld,
    },
    entered: null,
    exited: null,
  };
}

export function applyDirectionalLatch(
  raw: ZeroDteDirectionalSignal,
  latch: ZeroDteDirectionalLatchState,
): ZeroDteDirectionalSignal {
  if (latch.side === "WAIT") {
    return {
      ...raw,
      action: "WAIT",
      strategy: null,
      structureConfirmed: false,
    };
  }

  const bull = latch.side === "BULL";
  return {
    ...raw,
    action: bull ? "BUY" : "SELL",
    strategy: bull ? "PCS" : "CCS",
    trigger: latch.trigger,
    score: bull ? raw.bullishScore : raw.bearishScore,
    structureConfirmed: bull ? raw.gates.bullConfirmed : raw.gates.bearConfirmed,
    blockers: [],
    reasons: dedupe([
      `Latched ${latch.side} decision · held ${latch.barsHeld} completed bar${latch.barsHeld === 1 ? "" : "s"}`,
      ...raw.reasons,
    ]).slice(0, 8),
  };
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}
