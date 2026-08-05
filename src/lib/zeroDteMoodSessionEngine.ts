import {
  applyManualMoodMode,
  buildZeroDteMoodRead,
  type ZeroDteManualMoodMode,
  type ZeroDteMarketStage,
  type ZeroDteMoodDivergence,
  type ZeroDteMoodInput,
  type ZeroDteMoodRead,
} from "./zeroDteMoodEngine";
import type { SchwabPriceCandle } from "./schwab/client";
import type { ZeroDteLeadershipRead } from "./zeroDteLeadershipEngine";
import type { ZeroDteBreadthSnapshot } from "./zeroDteBreadthAdapter";
import {
  loadZeroDteMoodHistory,
  saveZeroDteMoodSample,
  type PersistedZeroDteMoodSample,
} from "./zeroDteMoodSessionRepository";
import { getZeroDteSessionClock } from "./zeroDteSessionClock";

export async function buildZeroDteMoodSessionRead(args: {
  tradeDate: string;
  generatedAt: string;
  leadership: ZeroDteLeadershipRead;
  breadth: ZeroDteBreadthSnapshot;
  spxCandles: SchwabPriceCandle[];
  manualMoodPercent?: number | null;
  manualMoodMode?: ZeroDteManualMoodMode;
  optionChainCoverage: "full" | "partial" | "unavailable";
  averageLength?: number;
  smoothingLength?: number;
}): Promise<ZeroDteMoodRead> {
  const averageLength = clampInt(args.averageLength ?? 5, 1, 10);
  const smoothingLength = clampInt(args.smoothingLength ?? 3, 1, 10);
  const clock = getZeroDteSessionClock(args.generatedAt);
  const history = await loadZeroDteMoodHistory(args.tradeDate, 180);
  const latest = history.at(-1) ?? null;

  if (clock.sessionStatus === "CLOSED") {
    const frozen = latest?.read ?? unavailableRead(args, "EOD_FROZEN");
    return applyManualMoodMode(
      { ...frozen, calculationMode: "EOD_FROZEN" },
      args.manualMoodPercent,
      args.manualMoodMode ?? "fallback",
    );
  }

  if (clock.sessionStatus !== "OPEN" || clock.minuteIndex <= 0) {
    return applyManualMoodMode(
      unavailableRead(args, "UNAVAILABLE"),
      args.manualMoodPercent,
      args.manualMoodMode ?? "fallback",
    );
  }

  const completedMinuteKey = clock.epochMinute - 1;
  if (latest && latest.minuteKey >= completedMinuteKey) {
    return applyManualMoodMode(
      latest.read,
      args.manualMoodPercent,
      args.manualMoodMode ?? "fallback",
    );
  }

  const mode = history.length < averageLength ? "FAST_OPEN" : "NORMAL";
  const highWeightTrend =
    mode === "NORMAL"
      ? trendAgainstEma(
          args.leadership.pullVsIndexPct,
          history.map((item) => item.input.highWeightPullPct),
          averageLength,
        )
      : null;
  const tickTrend =
    mode === "NORMAL"
      ? trendAgainstEma(
          args.breadth.tick,
          history.map((item) => item.input.tick),
          averageLength,
        )
      : null;
  const uvolDvolTrend =
    mode === "NORMAL"
      ? trendAgainstEma(
          args.breadth.uvolDvolRatio,
          history.map((item) => item.input.uvolDvolRatio),
          averageLength,
        )
      : null;
  const advanceDeclineTrend =
    mode === "NORMAL"
      ? trendAgainstEma(
          args.breadth.advanceDecline,
          history.map((item) => item.input.advanceDecline),
          averageLength,
        )
      : null;
  const marketStage =
    mode === "NORMAL" ? inferMarketStage(args.spxCandles) : null;

  const input: ZeroDteMoodInput = {
    index: "SPX",
    optionChainCoverage: args.optionChainCoverage,
    indexPctChange: args.leadership.indexPctChange,
    highWeightPullPct: args.leadership.pullVsIndexPct,
    highWeightTrend,
    tick: args.breadth.tick,
    tickTrend,
    uvolDvolRatio: args.breadth.uvolDvolRatio,
    uvolDvolTrend,
    advanceDecline: args.breadth.advanceDecline,
    advanceDeclineTrend,
    marketStage,
    generatedAt: args.generatedAt,
    source: "layer6d4-calculated",
    calculationMode: mode,
    smoothingLength,
    averageLength,
    minuteKey: completedMinuteKey,
    leadership: args.leadership,
    breadth: args.breadth,
  };

  const raw = buildZeroDteMoodRead(input);
  const smoothed = ema(
    raw.rawMoodPercent,
    latest?.read.moodPercent ?? null,
    smoothingLength,
  );
  const divergence = detectDivergence(
    args.leadership.indexPctChange,
    smoothed,
    history,
    averageLength,
  );
  const calculated = buildZeroDteMoodRead({
    ...input,
    smoothedMoodPercent: smoothed,
    internalDivergence: divergence,
  });
  const sampledAt = new Date(completedMinuteKey * 60_000 + 59_999).toISOString();
  await saveZeroDteMoodSample({
    tradeDate: args.tradeDate,
    minuteKey: completedMinuteKey,
    sampledAt,
    calculationMode: mode,
    input,
    read: calculated,
    leadership: args.leadership,
    breadth: args.breadth,
  });

  return applyManualMoodMode(
    calculated,
    args.manualMoodPercent,
    args.manualMoodMode ?? "fallback",
  );
}

function unavailableRead(
  args: {
    generatedAt: string;
    leadership: ZeroDteLeadershipRead;
    breadth: ZeroDteBreadthSnapshot;
    optionChainCoverage: "full" | "partial" | "unavailable";
  },
  mode: "EOD_FROZEN" | "UNAVAILABLE",
) {
  return buildZeroDteMoodRead({
    index: "SPX",
    optionChainCoverage: args.optionChainCoverage,
    generatedAt: args.generatedAt,
    source: "layer6d4-calculated",
    calculationMode: mode,
    leadership: args.leadership,
    breadth: args.breadth,
  });
}

function trendAgainstEma(
  current: number | null | undefined,
  values: Array<number | null | undefined>,
  length: number,
) {
  if (current === null || current === undefined || !Number.isFinite(current)) {
    return null;
  }
  const valid = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  if (!valid.length) return 0;
  let average = valid[0];
  const alpha = 2 / (length + 1);
  for (const value of valid.slice(1)) average = alpha * value + (1 - alpha) * average;
  if (current > average) return 1;
  if (current < average) return -1;
  return 0;
}

function ema(current: number | null, previous: number | null, length: number) {
  if (current === null) return null;
  if (previous === null || !Number.isFinite(previous)) return current;
  const alpha = 2 / (length + 1);
  return alpha * current + (1 - alpha) * previous;
}

function inferMarketStage(candles: SchwabPriceCandle[]): ZeroDteMarketStage {
  const closes = candles
    .filter((candle) => Number.isFinite(candle.close))
    .map((candle) => candle.close)
    .slice(-60);
  if (closes.length < 10) return "unknown";
  const fast = emaSeries(closes, 8);
  const medium = emaSeries(closes, 21);
  const slow = emaSeries(closes, 34);
  const adaptive = emaSeries(closes, 10);
  if (fast > medium && medium > slow) return "acceleration";
  if (fast < medium && medium < slow) return "deceleration";
  return closes.at(-1)! >= adaptive ? "accumulation" : "distribution";
}

function emaSeries(values: number[], length: number) {
  const alpha = 2 / (length + 1);
  let average = values[0];
  for (const value of values.slice(1)) average = alpha * value + (1 - alpha) * average;
  return average;
}

function detectDivergence(
  indexPctChange: number | null,
  moodPercent: number | null,
  history: PersistedZeroDteMoodSample[],
  length: number,
): ZeroDteMoodDivergence {
  if (indexPctChange === null || moodPercent === null || history.length < 2) {
    return "NONE";
  }
  const recentIndex = history
    .slice(-length)
    .map((item) => item.input.indexPctChange)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const averageIndex = recentIndex.length
    ? recentIndex.reduce((sum, value) => sum + value, 0) / recentIndex.length
    : indexPctChange;
  const previousMood = history.at(-1)?.read.moodPercent;
  const twoBackMood = history.at(-2)?.read.moodPercent;
  if (previousMood == null || twoBackMood == null) return "NONE";
  if (
    indexPctChange > averageIndex &&
    moodPercent < previousMood &&
    previousMood < twoBackMood
  ) {
    return "PRICE_UP_MOOD_DOWN";
  }
  if (
    indexPctChange < averageIndex &&
    moodPercent > previousMood &&
    previousMood > twoBackMood
  ) {
    return "PRICE_DOWN_MOOD_UP";
  }
  return "NONE";
}

function clampInt(value: number, min: number, max: number) {
  return Math.round(Math.max(min, Math.min(max, value)));
}
