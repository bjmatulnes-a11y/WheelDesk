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

export type ZeroDteDirectionalAction = "BUY" | "SELL" | "WAIT";
export type ZeroDteDirectionalStrategy = "PCS" | "CCS" | null;
export type ZeroDteDirectionalState = "TREND" | "TRANSITION" | "NEUTRAL";

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
}): ZeroDteDirectionalSignal {
  const recommendation = args.recommendation ?? null;
  const currentPrice = finite(recommendation?.spxPrice)
    ? recommendation!.spxPrice
    : args.candles.at(-1)?.close ?? 0;
  const expectedMove = Math.max(1, finite(recommendation?.expectedMove) ? recommendation!.expectedMove : 20);

  const structure = scoreStructure({
    candles: args.candles,
    snapshot: args.structure,
    higher: args.higherTimeframeStructure ?? null,
    currentPrice,
    expectedMove,
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

  const transition = structure.transition;
  const threshold = transition ? 82 : 74;
  const requiredMargin = transition ? 20 : 14;
  const winnerConfirmed = winner === "BULL" ? structure.bullConfirmed : structure.bearConfirmed;
  const winnerVeto = winner === "BULL" ? structure.bullVeto : structure.bearVeto;
  const winnerStructureScore = winner === "BULL" ? structure.bull : structure.bear;
  const chopGuardRequired = transition || !args.higherTimeframeStructure?.trendExternal;
  const blockers: string[] = [];

  if (!winnerConfirmed) blockers.push("Structure has not confirmed the winning side.");
  if (winnerVeto) blockers.push("Fresh opposite continuation structure vetoes the signal.");
  if (chopGuardRequired && winnerStructureScore < 45) {
    blockers.push(`Structure score ${winnerStructureScore} is below 45 for transition / unconfirmed 5m structure.`);
  }
  if (winnerScore < threshold) blockers.push(`Score ${winnerScore} is below ${threshold}.`);
  if (margin < requiredMargin) blockers.push(`Directional margin ${margin} is below ${requiredMargin}.`);
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) blockers.push("Current SPX price is unavailable.");

  const action: ZeroDteDirectionalAction = blockers.length
    ? "WAIT"
    : winner === "BULL"
      ? "BUY"
      : "SELL";
  const strategy: ZeroDteDirectionalStrategy = action === "BUY" ? "PCS" : action === "SELL" ? "CCS" : null;

  const reasons = action === "BUY"
    ? [...structure.reasonsBull, ...market.reasonsBull, ...executionReasons(putRead, "PCS")]
    : action === "SELL"
      ? [...structure.reasonsBear, ...market.reasonsBear, ...executionReasons(callRead, "CCS")]
      : waitReasons({ bull, bear, structure, market, putRead, callRead });

  return {
    action,
    strategy,
    score: winnerScore,
    bullishScore: bull,
    bearishScore: bear,
    margin,
    threshold,
    requiredMargin,
    generatedAt: args.structure.generatedAt,
    currentPrice,
    state: transition ? "TRANSITION" : winnerScore >= 60 ? "TREND" : "NEUTRAL",
    structureConfirmed: winnerConfirmed,
    reasons: dedupe(reasons).slice(0, 8),
    blockers: dedupe(blockers),
    gates: {
      bullConfirmed: structure.bullConfirmed,
      bearConfirmed: structure.bearConfirmed,
      bullVeto: structure.bullVeto,
      bearVeto: structure.bearVeto,
      bullExternalBosVeto: structure.bullExternalBosVeto,
      bearExternalBosVeto: structure.bearExternalBosVeto,
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

function scoreMarket(args: {
  recommendation: ZeroDteRecommendation | null;
  mood: ZeroDteMoodRead | null;
  path: ZeroDteLeastResistancePath | null;
  pin: number | null;
  callWall: number | null;
  putWall: number | null;
  currentPrice: number;
  expectedMove: number;
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
  if (finite(args.putWall) && Math.abs(args.currentPrice - args.putWall) <= wallProximity) {
    bull += 7;
    reasonsBull.push("Near put-wall support");
  }
  if (finite(args.callWall) && Math.abs(args.currentPrice - args.callWall) <= wallProximity) {
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
