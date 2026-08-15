import {
  ES_TICK,
  historicalCandleMatchesSession,
  reconstructHistoricalCandleFootprint,
  type HistoricalEsCandle,
  type HistoricalFootprintCell,
} from "./zeroDteHistoricalFootprint";

export type AuctionState =
  | "WARMING"
  | "BALANCED"
  | "ACCEPTANCE"
  | "RELEASE_UP"
  | "RELEASE_DOWN"
  | "ABSORPTION_HIGH"
  | "ABSORPTION_LOW"
  | "EXHAUSTION_UP"
  | "EXHAUSTION_DOWN"
  | "REJECTION_HIGH"
  | "REJECTION_LOW";

export type AuctionProfileNode = "POC" | "HVN" | "LVN" | "NORMAL";
export type AuctionPocPosition = "ABOVE" | "BELOW" | "AT";
export type AuctionDeltaDivergence = "BEARISH" | "BULLISH" | "NONE";
export type AuctionDeltaReversal = "BEARISH" | "BULLISH" | "NONE";
export type AuctionPocMomentum = "UP" | "DOWN" | "STALLED";

export type HistoricalAuctionMinute = {
  time: number;
  label: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  developingPoc: number;
  distanceFromPoc: number;
  pocPosition: AuctionPocPosition;
  pocMigration5m: number;
  pocMomentum: AuctionPocMomentum;
  node: AuctionProfileNode;
  deltaProxyPct: number;
  volumeZ: number;
  rangeZ: number;
  efficiency5mPct: number;
  deltaDivergence: AuctionDeltaDivergence;
  deltaReversal: AuctionDeltaReversal;
  acceptanceScore: number;
  releaseUpScore: number;
  releaseDownScore: number;
  absorptionHighScore: number;
  absorptionLowScore: number;
  exhaustionUpScore: number;
  exhaustionDownScore: number;
  rejectionHighScore: number;
  rejectionLowScore: number;
  centerConfidence: number;
  callFadeScore: number;
  putFadeScore: number;
  state: AuctionState;
  stateScore: number;
  features: string[];
};

export type HistoricalAuctionSummary = {
  minutes: HistoricalAuctionMinute[];
  counts: Record<AuctionState, number>;
  featureCounts: {
    acceptance: number;
    release: number;
    absorption: number;
    exhaustion: number;
    rejection: number;
    bearishDeltaDivergence: number;
    bullishDeltaDivergence: number;
    thinZone: number;
  };
  topCallFade: HistoricalAuctionMinute[];
  topPutFade: HistoricalAuctionMinute[];
  topCenters: HistoricalAuctionMinute[];
};

type MutableCell = HistoricalFootprintCell;

const STATES: AuctionState[] = [
  "WARMING",
  "BALANCED",
  "ACCEPTANCE",
  "RELEASE_UP",
  "RELEASE_DOWN",
  "ABSORPTION_HIGH",
  "ABSORPTION_LOW",
  "EXHAUSTION_UP",
  "EXHAUSTION_DOWN",
  "REJECTION_HIGH",
  "REJECTION_LOW",
];

export function buildHistoricalAuctionAnalytics(args: {
  candles: HistoricalEsCandle[];
  date: string;
  session?: "RTH" | "FULL";
}): HistoricalAuctionSummary {
  const session = args.session ?? "RTH";
  const candles = args.candles
    .filter(isFiniteCandle)
    .filter((candle) => historicalCandleMatchesSession(candle, args.date, session))
    .sort((a, b) => a.time - b.time);

  const profile = new Map<number, MutableCell>();
  const minutes: HistoricalAuctionMinute[] = [];
  const pocHistory: number[] = [];
  const deltaHistory: number[] = [];
  const volumeHistory: number[] = [];
  const rangeHistory: number[] = [];

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const cells = reconstructHistoricalCandleFootprint(candle);
    for (const cell of cells) mergeCell(profile, cell);

    const developingPoc = findPoc(profile) ?? roundToTick(candle.close);
    pocHistory.push(developingPoc);

    const totalCellVolume = cells.reduce((sum, cell) => sum + cell.totalVolume, 0);
    const totalDelta = cells.reduce((sum, cell) => sum + cell.delta, 0);
    const deltaProxyPct = totalCellVolume > 0 ? (totalDelta / totalCellVolume) * 100 : 0;
    deltaHistory.push(deltaProxyPct);

    const range = Math.max(ES_TICK, candle.high - candle.low);
    const volumeZ = zScore(candle.volume, volumeHistory.slice(-20));
    const rangeZ = zScore(range, rangeHistory.slice(-20));
    volumeHistory.push(candle.volume);
    rangeHistory.push(range);

    const node = classifyNode(profile, roundToTick(candle.close), developingPoc);
    const distanceFromPoc = candle.close - developingPoc;
    const pocPosition: AuctionPocPosition =
      Math.abs(distanceFromPoc) <= ES_TICK * 2
        ? "AT"
        : distanceFromPoc > 0
          ? "ABOVE"
          : "BELOW";
    const pocMigration5m = developingPoc - (pocHistory[Math.max(0, index - 5)] ?? developingPoc);
    const pocMomentum: AuctionPocMomentum =
      pocMigration5m >= ES_TICK * 3
        ? "UP"
        : pocMigration5m <= -ES_TICK * 3
          ? "DOWN"
          : "STALLED";

    const efficiency5mPct = pathEfficiency(candles, index, 5);
    const upperWickPct = clamp(
      ((candle.high - Math.max(candle.open, candle.close)) / range) * 100,
      0,
      100,
    );
    const lowerWickPct = clamp(
      ((Math.min(candle.open, candle.close) - candle.low) / range) * 100,
      0,
      100,
    );
    const closeLocationPct = clamp(((candle.close - candle.low) / range) * 100, 0, 100);

    const priorDelta3 = mean(deltaHistory.slice(Math.max(0, index - 3), index));
    const priorVolume3 = mean(volumeHistory.slice(Math.max(0, volumeHistory.length - 4), -1));
    const close3m = candle.close - (candles[Math.max(0, index - 3)]?.close ?? candle.close);
    const close5m = candle.close - (candles[Math.max(0, index - 5)]?.close ?? candle.close);
    const previousHigh = max(candles.slice(Math.max(0, index - 5), index).map((item) => item.high));
    const previousLow = min(candles.slice(Math.max(0, index - 5), index).map((item) => item.low));

    const deltaDivergence = detectDeltaDivergence({
      candle,
      previousHigh,
      previousLow,
      deltaProxyPct,
      priorDelta3,
    });
    const deltaReversal = detectDeltaReversal(deltaHistory, index);

    const visitsNearPoc = candles
      .slice(Math.max(0, index - 7), index + 1)
      .filter((item) => Math.abs(item.close - developingPoc) <= 1).length;

    const proximityScore = clamp(100 - Math.abs(distanceFromPoc) * 28, 0, 100);
    const nodeAcceptanceScore =
      node === "POC" ? 100 : node === "HVN" ? 85 : node === "NORMAL" ? 38 : 8;
    const revisitScore = clamp((visitsNearPoc / 6) * 100, 0, 100);
    const slowTradeScore = 100 - efficiency5mPct;
    const pocStabilityScore = clamp(100 - Math.abs(pocMigration5m) * 35, 0, 100);
    const balancedDeltaScore = clamp(100 - Math.abs(deltaProxyPct) * 1.2, 0, 100);

    const acceptanceScore = weighted([
      [proximityScore, 0.24],
      [nodeAcceptanceScore, 0.20],
      [revisitScore, 0.18],
      [slowTradeScore, 0.16],
      [pocStabilityScore, 0.22],
    ]);

    const activityScore = clamp(50 + volumeZ * 22, 0, 100);
    const rangeActivityScore = clamp(50 + rangeZ * 22, 0, 100);
    const thinScore = node === "LVN" ? 100 : node === "NORMAL" ? 55 : node === "HVN" ? 20 : 0;
    const distanceScore = clamp(Math.abs(distanceFromPoc) * 24, 0, 100);
    const pocUpScore = pocMomentum === "UP" ? 100 : pocMomentum === "STALLED" ? 45 : 0;
    const pocDownScore = pocMomentum === "DOWN" ? 100 : pocMomentum === "STALLED" ? 45 : 0;
    const upDirectionScore = clamp(50 + close5m * 10, 0, 100);
    const downDirectionScore = clamp(50 - close5m * 10, 0, 100);

    const releaseUpScore = weighted([
      [efficiency5mPct, 0.34],
      [rangeActivityScore, 0.16],
      [thinScore, 0.15],
      [distanceScore, 0.12],
      [pocUpScore, 0.10],
      [upDirectionScore, 0.13],
    ]);
    const releaseDownScore = weighted([
      [efficiency5mPct, 0.34],
      [rangeActivityScore, 0.16],
      [thinScore, 0.15],
      [distanceScore, 0.12],
      [pocDownScore, 0.10],
      [downDirectionScore, 0.13],
    ]);

    const buyPressureScore = clamp(50 + deltaProxyPct * 0.9, 0, 100);
    const sellPressureScore = clamp(50 - deltaProxyPct * 0.9, 0, 100);
    const failureToProgress = 100 - efficiency5mPct;
    const upperLocationScore = clamp(48 + Math.max(0, distanceFromPoc) * 18, 0, 100);
    const lowerLocationScore = clamp(48 + Math.max(0, -distanceFromPoc) * 18, 0, 100);

    const absorptionHighScore = weighted([
      [activityScore, 0.22],
      [buyPressureScore, 0.24],
      [failureToProgress, 0.26],
      [upperWickPct, 0.16],
      [upperLocationScore, 0.12],
    ]);
    const absorptionLowScore = weighted([
      [activityScore, 0.22],
      [sellPressureScore, 0.24],
      [failureToProgress, 0.26],
      [lowerWickPct, 0.16],
      [lowerLocationScore, 0.12],
    ]);

    const deltaFadeUp = clamp(50 + (priorDelta3 - deltaProxyPct) * 1.5, 0, 100);
    const deltaFadeDown = clamp(50 + (deltaProxyPct - priorDelta3) * 1.5, 0, 100);
    const volumeFade =
      priorVolume3 > 0 ? clamp(50 + ((priorVolume3 - candle.volume) / priorVolume3) * 90, 0, 100) : 50;
    const upPushScore = clamp(Math.max(close3m, close5m) * 16, 0, 100);
    const downPushScore = clamp(Math.max(-close3m, -close5m) * 16, 0, 100);
    const failedHighScore =
      previousHigh === null
        ? 40
        : candle.high <= previousHigh + ES_TICK
          ? 85
          : clamp(100 - (candle.high - previousHigh) * 25, 20, 90);
    const failedLowScore =
      previousLow === null
        ? 40
        : candle.low >= previousLow - ES_TICK
          ? 85
          : clamp(100 - (previousLow - candle.low) * 25, 20, 90);

    const exhaustionUpScore = weighted([
      [upPushScore, 0.20],
      [deltaFadeUp, 0.24],
      [volumeFade, 0.14],
      [failureToProgress, 0.18],
      [upperWickPct, 0.12],
      [failedHighScore, 0.12],
    ]);
    const exhaustionDownScore = weighted([
      [downPushScore, 0.20],
      [deltaFadeDown, 0.24],
      [volumeFade, 0.14],
      [failureToProgress, 0.18],
      [lowerWickPct, 0.12],
      [failedLowScore, 0.12],
    ]);

    const upperCloseReversalScore = clamp(100 - closeLocationPct, 0, 100);
    const lowerCloseReversalScore = clamp(closeLocationPct, 0, 100);
    const highTestScore =
      previousHigh === null
        ? 35
        : candle.high >= previousHigh - ES_TICK
          ? 100
          : clamp(70 - (previousHigh - candle.high) * 20, 0, 70);
    const lowTestScore =
      previousLow === null
        ? 35
        : candle.low <= previousLow + ES_TICK
          ? 100
          : clamp(70 - (candle.low - previousLow) * 20, 0, 70);

    const rejectionHighScore = weighted([
      [upperWickPct, 0.30],
      [upperCloseReversalScore, 0.25],
      [highTestScore, 0.22],
      [upperLocationScore, 0.13],
      [deltaFadeUp, 0.10],
    ]);
    const rejectionLowScore = weighted([
      [lowerWickPct, 0.30],
      [lowerCloseReversalScore, 0.25],
      [lowTestScore, 0.22],
      [lowerLocationScore, 0.13],
      [deltaFadeDown, 0.10],
    ]);

    const centerConfidence = weighted([
      [acceptanceScore, 0.55],
      [balancedDeltaScore, 0.18],
      [pocStabilityScore, 0.17],
      [revisitScore, 0.10],
    ]);

    const bearishDeltaScore =
      deltaDivergence === "BEARISH" ? 100 : deltaReversal === "BEARISH" ? 85 : clamp(50 - deltaProxyPct, 0, 100);
    const bullishDeltaScore =
      deltaDivergence === "BULLISH" ? 100 : deltaReversal === "BULLISH" ? 85 : clamp(50 + deltaProxyPct, 0, 100);
    const upperPocContext =
      pocMomentum === "DOWN" ? 100 : pocMomentum === "STALLED" ? 78 : 25;
    const lowerPocContext =
      pocMomentum === "UP" ? 100 : pocMomentum === "STALLED" ? 78 : 25;

    const callFadeScore = weighted([
      [absorptionHighScore, 0.25],
      [exhaustionUpScore, 0.25],
      [rejectionHighScore, 0.24],
      [bearishDeltaScore, 0.16],
      [upperPocContext, 0.10],
    ]);
    const putFadeScore = weighted([
      [absorptionLowScore, 0.25],
      [exhaustionDownScore, 0.25],
      [rejectionLowScore, 0.24],
      [bullishDeltaScore, 0.16],
      [lowerPocContext, 0.10],
    ]);

    const { state, stateScore } = chooseState({
      index,
      acceptanceScore,
      releaseUpScore,
      releaseDownScore,
      absorptionHighScore,
      absorptionLowScore,
      exhaustionUpScore,
      exhaustionDownScore,
      rejectionHighScore,
      rejectionLowScore,
    });

    const features = buildFeatureList({
      node,
      pocPosition,
      pocMomentum,
      deltaDivergence,
      deltaReversal,
      absorptionHighScore,
      absorptionLowScore,
      exhaustionUpScore,
      exhaustionDownScore,
      rejectionHighScore,
      rejectionLowScore,
      efficiency5mPct,
    });

    minutes.push({
      time: candle.time,
      label: formatChicagoClock(candle.time),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      developingPoc,
      distanceFromPoc,
      pocPosition,
      pocMigration5m,
      pocMomentum,
      node,
      deltaProxyPct,
      volumeZ,
      rangeZ,
      efficiency5mPct,
      deltaDivergence,
      deltaReversal,
      acceptanceScore,
      releaseUpScore,
      releaseDownScore,
      absorptionHighScore,
      absorptionLowScore,
      exhaustionUpScore,
      exhaustionDownScore,
      rejectionHighScore,
      rejectionLowScore,
      centerConfidence,
      callFadeScore,
      putFadeScore,
      state,
      stateScore,
      features,
    });
  }

  const counts = Object.fromEntries(STATES.map((state) => [state, 0])) as Record<AuctionState, number>;
  for (const minute of minutes) counts[minute.state] += 1;

  const featureCounts = {
    acceptance: minutes.filter((minute) => minute.acceptanceScore >= 64).length,
    release: minutes.filter((minute) => Math.max(minute.releaseUpScore, minute.releaseDownScore) >= 70).length,
    absorption: minutes.filter((minute) => Math.max(minute.absorptionHighScore, minute.absorptionLowScore) >= 70).length,
    exhaustion: minutes.filter((minute) => Math.max(minute.exhaustionUpScore, minute.exhaustionDownScore) >= 70).length,
    rejection: minutes.filter((minute) => Math.max(minute.rejectionHighScore, minute.rejectionLowScore) >= 72).length,
    bearishDeltaDivergence: minutes.filter((minute) => minute.deltaDivergence === "BEARISH").length,
    bullishDeltaDivergence: minutes.filter((minute) => minute.deltaDivergence === "BULLISH").length,
    thinZone: minutes.filter((minute) => minute.node === "LVN").length,
  };

  return {
    minutes,
    counts,
    featureCounts,
    topCallFade: distinctTop(minutes, (minute) => minute.callFadeScore, 6),
    topPutFade: distinctTop(minutes, (minute) => minute.putFadeScore, 6),
    topCenters: distinctTop(minutes, (minute) => minute.centerConfidence, 6),
  };
}

export function nearestAuctionMinute(
  minutes: HistoricalAuctionMinute[],
  epochSeconds: number,
  toleranceSeconds = 90,
) {
  let best: HistoricalAuctionMinute | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const minute of minutes) {
    const distance = Math.abs(minute.time - epochSeconds);
    if (distance < bestDistance) {
      best = minute;
      bestDistance = distance;
    }
  }
  return best && bestDistance <= toleranceSeconds ? best : null;
}

function chooseState(scores: {
  index: number;
  acceptanceScore: number;
  releaseUpScore: number;
  releaseDownScore: number;
  absorptionHighScore: number;
  absorptionLowScore: number;
  exhaustionUpScore: number;
  exhaustionDownScore: number;
  rejectionHighScore: number;
  rejectionLowScore: number;
}) {
  if (scores.index < 5) return { state: "WARMING" as const, stateScore: 0 };

  const candidates: Array<[AuctionState, number, number]> = [
    ["REJECTION_HIGH", scores.rejectionHighScore, 72],
    ["REJECTION_LOW", scores.rejectionLowScore, 72],
    ["EXHAUSTION_UP", scores.exhaustionUpScore, 70],
    ["EXHAUSTION_DOWN", scores.exhaustionDownScore, 70],
    ["ABSORPTION_HIGH", scores.absorptionHighScore, 68],
    ["ABSORPTION_LOW", scores.absorptionLowScore, 68],
    ["RELEASE_UP", scores.releaseUpScore, 70],
    ["RELEASE_DOWN", scores.releaseDownScore, 70],
    ["ACCEPTANCE", scores.acceptanceScore, 64],
  ];
  const eligible = candidates
    .filter(([, score, threshold]) => score >= threshold)
    .sort((a, b) => b[1] - a[1]);
  if (eligible.length) return { state: eligible[0][0], stateScore: eligible[0][1] };
  return {
    state: "BALANCED" as const,
    stateScore: Math.max(
      scores.acceptanceScore,
      scores.releaseUpScore,
      scores.releaseDownScore,
      scores.absorptionHighScore,
      scores.absorptionLowScore,
      scores.exhaustionUpScore,
      scores.exhaustionDownScore,
      scores.rejectionHighScore,
      scores.rejectionLowScore,
    ),
  };
}

function buildFeatureList(args: {
  node: AuctionProfileNode;
  pocPosition: AuctionPocPosition;
  pocMomentum: AuctionPocMomentum;
  deltaDivergence: AuctionDeltaDivergence;
  deltaReversal: AuctionDeltaReversal;
  absorptionHighScore: number;
  absorptionLowScore: number;
  exhaustionUpScore: number;
  exhaustionDownScore: number;
  rejectionHighScore: number;
  rejectionLowScore: number;
  efficiency5mPct: number;
}) {
  const features: string[] = [];
  features.push(`${args.pocPosition} POC`);
  if (args.pocMomentum !== "STALLED") features.push(`POC ${args.pocMomentum}`);
  else features.push("POC STALLED");
  if (args.node === "LVN") features.push("THIN / LVN");
  if (args.node === "HVN" || args.node === "POC") features.push("HVN / ACCEPTANCE");
  if (args.deltaDivergence !== "NONE") features.push(`${args.deltaDivergence} Δ DIVERGENCE`);
  if (args.deltaReversal !== "NONE") features.push(`${args.deltaReversal} Δ REVERSAL`);
  if (args.absorptionHighScore >= 70) features.push("PASSIVE ABSORPTION HIGH");
  if (args.absorptionLowScore >= 70) features.push("PASSIVE ABSORPTION LOW");
  if (args.exhaustionUpScore >= 70) features.push("EXHAUSTION UP");
  if (args.exhaustionDownScore >= 70) features.push("EXHAUSTION DOWN");
  if (args.rejectionHighScore >= 72) features.push("REJECTION HIGH");
  if (args.rejectionLowScore >= 72) features.push("REJECTION LOW");
  if (args.efficiency5mPct >= 72) features.push("FAST / RELEASE");
  return features;
}

function detectDeltaDivergence(args: {
  candle: HistoricalEsCandle;
  previousHigh: number | null;
  previousLow: number | null;
  deltaProxyPct: number;
  priorDelta3: number;
}): AuctionDeltaDivergence {
  if (
    args.previousHigh !== null &&
    args.candle.high >= args.previousHigh + ES_TICK &&
    args.deltaProxyPct <= args.priorDelta3 - 12
  ) {
    return "BEARISH";
  }
  if (
    args.previousLow !== null &&
    args.candle.low <= args.previousLow - ES_TICK &&
    args.deltaProxyPct >= args.priorDelta3 + 12
  ) {
    return "BULLISH";
  }
  return "NONE";
}

function detectDeltaReversal(history: number[], index: number): AuctionDeltaReversal {
  if (index < 2) return "NONE";
  const previous = mean(history.slice(Math.max(0, index - 2), index));
  const current = history[index] ?? 0;
  if (previous >= 12 && current <= -6) return "BEARISH";
  if (previous <= -12 && current >= 6) return "BULLISH";
  return "NONE";
}

function classifyNode(
  profile: Map<number, MutableCell>,
  price: number,
  poc: number,
): AuctionProfileNode {
  if (price === poc) return "POC";
  const levels = [...profile.values()].sort((a, b) => b.totalVolume - a.totalVolume);
  if (!levels.length) return "NORMAL";
  const cell = profile.get(price);
  if (!cell) return "LVN";
  const rank = levels.findIndex((level) => level.price === price);
  if (rank < 0) return "NORMAL";
  const pct = levels.length <= 1 ? 0 : (rank / (levels.length - 1)) * 100;
  if (pct <= 20) return "HVN";
  if (pct >= 80) return "LVN";
  return "NORMAL";
}

function pathEfficiency(candles: HistoricalEsCandle[], index: number, lookback: number) {
  const start = Math.max(0, index - lookback + 1);
  const slice = candles.slice(start, index + 1);
  if (slice.length <= 1) return 0;
  const net = Math.abs(slice[slice.length - 1].close - slice[0].open);
  let gross = 0;
  for (let i = 0; i < slice.length; i += 1) {
    const previousClose = i === 0 ? slice[i].open : slice[i - 1].close;
    const trueRange = Math.max(
      slice[i].high - slice[i].low,
      Math.abs(slice[i].high - previousClose),
      Math.abs(slice[i].low - previousClose),
    );
    gross += Math.max(ES_TICK, trueRange);
  }
  // True-range travel intentionally penalizes wick-heavy churn. The 1.25 factor
  // keeps clean directional sequences in the familiar 70–100 release band.
  return clamp((net / Math.max(ES_TICK, gross)) * 125, 0, 100);
}

function findPoc(profile: Map<number, MutableCell>) {
  let bestPrice: number | null = null;
  let bestVolume = -1;
  for (const [price, cell] of profile) {
    if (cell.totalVolume > bestVolume) {
      bestPrice = price;
      bestVolume = cell.totalVolume;
    }
  }
  return bestPrice;
}

function distinctTop(
  minutes: HistoricalAuctionMinute[],
  score: (minute: HistoricalAuctionMinute) => number,
  limit: number,
) {
  const sorted = [...minutes].sort((a, b) => score(b) - score(a));
  const selected: HistoricalAuctionMinute[] = [];
  for (const minute of sorted) {
    if (selected.some((prior) => Math.abs(prior.time - minute.time) < 5 * 60)) continue;
    selected.push(minute);
    if (selected.length >= limit) break;
  }
  return selected;
}

function mergeCell(map: Map<number, MutableCell>, incoming: HistoricalFootprintCell) {
  const prior = map.get(incoming.price);
  if (!prior) {
    map.set(incoming.price, { ...incoming });
    return;
  }
  prior.bidVolume += incoming.bidVolume;
  prior.askVolume += incoming.askVolume;
  prior.totalVolume += incoming.totalVolume;
  prior.delta += incoming.delta;
}

function weighted(items: Array<[number, number]>) {
  const totalWeight = items.reduce((sum, [, weight]) => sum + weight, 0) || 1;
  return clamp(
    items.reduce((sum, [value, weight]) => sum + clamp(value, 0, 100) * weight, 0) / totalWeight,
    0,
    100,
  );
}

function zScore(value: number, history: number[]) {
  if (history.length < 5) return 0;
  const avg = mean(history);
  const variance = mean(history.map((item) => (item - avg) ** 2));
  const sd = Math.sqrt(variance);
  if (!Number.isFinite(sd) || sd <= 1e-9) return 0;
  return clamp((value - avg) / sd, -5, 5);
}

function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function max(values: number[]) {
  if (!values.length) return null;
  return Math.max(...values);
}

function min(values: number[]) {
  if (!values.length) return null;
  return Math.min(...values);
}

function roundToTick(value: number) {
  return Math.round(value / ES_TICK) * ES_TICK;
}

function clamp(value: number, minValue: number, maxValue: number) {
  return Math.max(minValue, Math.min(maxValue, value));
}

function formatChicagoClock(epochSeconds: number) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(epochSeconds * 1000));
}

function isFiniteCandle(candle: HistoricalEsCandle) {
  return (
    Number.isFinite(candle.time) &&
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close) &&
    Number.isFinite(candle.volume)
  );
}
