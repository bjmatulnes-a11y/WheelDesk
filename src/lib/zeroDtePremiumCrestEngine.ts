export type PremiumTapeLike = {
  timestamp: string;
  credit: number;
};

export type ExecutionPremiumMinuteBar = {
  minuteKey: number;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  median: number;
  sampleCount: number;
  range: number;
};

export type PremiumCrestStatus =
  | "BUILDING_BASELINE"
  | "WAIT_EXPANSION"
  | "ARMED_NEAR_CREST"
  | "ROLLOVER_BUILDING"
  | "ROLLOVER_CONFIRMED"
  | "MISSED_RECYCLE";

export type ZeroDtePremiumCrestRead = {
  status: PremiumCrestStatus;
  rawSampleCount: number;
  completedMinuteCount: number;
  officialCredit: number | null;
  localTroughCredit: number | null;
  localPeakCredit: number | null;
  localPeakAt: string | null;
  cycleExpansionPoints: number | null;
  cycleExpansionPct: number | null;
  rolloverPoints: number | null;
  rolloverPct: number | null;
  expansionThresholdPoints: number | null;
  rolloverThresholdPoints: number | null;
  quoteNoisePoints: number | null;
  oneMinuteSlope: number | null;
  threeMinuteSlope: number | null;
  peakAgeMinutes: number | null;
  confirmationBars: number;
  cycleExpanded: boolean;
  nearCrest: boolean;
  rolloverStarted: boolean;
  rolloverConfirmed: boolean;
  missed: boolean;
  armed: boolean;
  signalEligible: boolean;
  score: number;
  reasons: string[];
  bars: ExecutionPremiumMinuteBar[];
};

const LOCAL_WINDOW_MINUTES = 8;
const MIN_COMPLETED_BARS = 3;
const MAX_SIGNAL_PEAK_AGE_MINUTES = 4;
const MIN_ABSOLUTE_EXPANSION = 0.05;
const MIN_ABSOLUTE_ROLLOVER = 0.05;

export function buildPremiumCrestRead(args: {
  samples: PremiumTapeLike[];
  generatedAt: string;
  currentCredit?: number | null;
}): ZeroDtePremiumCrestRead {
  const samples = normalizeSamples(args.samples);
  const bars = buildCompletedPremiumMinuteBars(samples, args.generatedAt);
  const officialCredit = bars.at(-1)?.median ?? null;
  const rawSampleCount = samples.length;
  const completedMinuteCount = bars.length;

  if (bars.length < MIN_COMPLETED_BARS || officialCredit === null) {
    return makeEmptyRead({
      status: "BUILDING_BASELINE",
      rawSampleCount,
      completedMinuteCount,
      officialCredit,
      bars,
      reasons: [
        `Need at least ${MIN_COMPLETED_BARS} completed one-minute premium bars before an exhaustion cycle can be trusted.`,
      ],
    });
  }

  const window = bars.slice(-LOCAL_WINDOW_MINUTES);
  const rawWindowStart = window[0]?.minuteKey ?? -Infinity;
  const rawWindowEnd = (window.at(-1)?.minuteKey ?? Infinity) + 60_000;
  const recentRaw = samples.filter((sample) => {
    const timestamp = Date.parse(sample.timestamp);
    return Number.isFinite(timestamp) && timestamp >= rawWindowStart && timestamp < rawWindowEnd;
  });
  const quoteNoisePoints = estimateQuoteNoise(recentRaw, window);

  const cycle = findCurrentExpansionCycle(window);
  const trough = cycle.trough;
  const peak = cycle.peak;
  const expansionPoints = peak && trough ? peak.median - trough.median : null;
  const expansionPct =
    expansionPoints !== null && trough && trough.median > 0
      ? (expansionPoints / trough.median) * 100
      : null;
  const expansionThresholdPoints = trough
    ? Math.max(
        MIN_ABSOLUTE_EXPANSION,
        trough.median * 0.035,
        quoteNoisePoints * 3,
      )
    : null;
  const cycleExpanded = Boolean(
    expansionPoints !== null &&
      expansionThresholdPoints !== null &&
      expansionPoints >= expansionThresholdPoints,
  );

  const rolloverThresholdPoints = peak
    ? Math.max(
        MIN_ABSOLUTE_ROLLOVER,
        peak.median * 0.025,
        quoteNoisePoints * 2.5,
      )
    : null;
  const rolloverPoints =
    peak && officialCredit !== null ? peak.median - officialCredit : null;
  const rolloverPct =
    rolloverPoints !== null && peak && peak.median > 0
      ? (rolloverPoints / peak.median) * 100
      : null;
  const oneMinuteSlope = slopeOneMinute(window);
  const threeMinuteSlope = regressionSlope(window.slice(-4));

  const peakIndex = peak
    ? window.findIndex((bar) => bar.minuteKey === peak.minuteKey)
    : -1;
  const postPeakBars = peakIndex >= 0 ? window.slice(peakIndex + 1) : [];
  const postPeakPath = peak ? [peak, ...postPeakBars].slice(-3) : [];
  const postPeakSlope = regressionSlope(postPeakPath);
  const decliningConfirmationBars = peak
    ? countTrailingDeclines([peak, ...postPeakBars])
    : 0;
  const latestCompletedAt = window.at(-1)?.minuteKey ?? null;
  const peakAgeMinutes =
    peak && latestCompletedAt !== null
      ? Math.max(0, (latestCompletedAt - peak.minuteKey) / 60_000)
      : null;

  const minNegativeSlope = Math.max(0.01, quoteNoisePoints * 0.2);
  const rolloverStarted = Boolean(
    cycleExpanded &&
      rolloverPoints !== null &&
      rolloverThresholdPoints !== null &&
      rolloverPoints >= rolloverThresholdPoints * 0.75 &&
      (oneMinuteSlope ?? 0) <= -minNegativeSlope,
  );
  const decisiveFastRollover = Boolean(
    cycleExpanded &&
      postPeakBars.length >= 1 &&
      rolloverPoints !== null &&
      rolloverThresholdPoints !== null &&
      rolloverPoints >= rolloverThresholdPoints * 1.75 &&
      (oneMinuteSlope ?? 0) <= -minNegativeSlope,
  );
  const twoBarRollover = Boolean(
    cycleExpanded &&
      postPeakBars.length >= 2 &&
      rolloverPoints !== null &&
      rolloverThresholdPoints !== null &&
      rolloverPoints >= rolloverThresholdPoints &&
      decliningConfirmationBars >= 2 &&
      (postPeakSlope ?? 0) <= -minNegativeSlope,
  );
  const rolloverConfirmed = Boolean(
    cycleExpanded && (twoBarRollover || decisiveFastRollover),
  );

  const thresholdPct =
    peak && rolloverThresholdPoints !== null && peak.median > 0
      ? (rolloverThresholdPoints / peak.median) * 100
      : 0;
  const missedDropPct = Math.max(12, thresholdPct * 3.5);
  const stalePeak =
    peakAgeMinutes !== null && peakAgeMinutes > MAX_SIGNAL_PEAK_AGE_MINUTES;
  const missed = Boolean(
    rolloverConfirmed &&
      ((rolloverPct ?? 0) >= missedDropPct || stalePeak),
  );

  const nearCrest = Boolean(
    cycleExpanded &&
      !rolloverConfirmed &&
      rolloverPoints !== null &&
      rolloverThresholdPoints !== null &&
      rolloverPoints <= rolloverThresholdPoints * 1.1,
  );
  const armed = Boolean(
    cycleExpanded && !missed && (nearCrest || rolloverStarted || rolloverConfirmed),
  );
  const signalEligible = Boolean(rolloverConfirmed && !missed);

  const status: PremiumCrestStatus = missed
    ? "MISSED_RECYCLE"
    : rolloverConfirmed
      ? "ROLLOVER_CONFIRMED"
      : rolloverStarted
        ? "ROLLOVER_BUILDING"
        : nearCrest
          ? "ARMED_NEAR_CREST"
          : cycleExpanded
            ? "ARMED_NEAR_CREST"
            : "WAIT_EXPANSION";

  const score = scoreCrest({
    cycleExpanded,
    nearCrest,
    rolloverStarted,
    rolloverConfirmed,
    missed,
    expansionPct,
    rolloverPct,
    threeMinuteSlope,
    quoteNoisePoints,
  });

  const reasons: string[] = [];
  if (trough && peak) {
    reasons.push(
      `Local cycle ${trough.median.toFixed(2)} → ${peak.median.toFixed(2)} (${formatSigned(expansionPct)}%) across the last ${window.length} completed minute bars.`,
    );
  }
  if (expansionThresholdPoints !== null) {
    reasons.push(
      `Expansion threshold ${expansionThresholdPoints.toFixed(2)} points; estimated quote noise ${quoteNoisePoints.toFixed(3)}.`,
    );
  }
  if (!cycleExpanded) {
    reasons.push("Premium has not produced a large enough local expansion cycle to arm an exhaustion trade.");
  } else if (nearCrest) {
    reasons.push("Premium is expanded and still near the local crest; the engine is armed but will not sell before rollover confirmation.");
  }
  if (rolloverStarted && !rolloverConfirmed) {
    reasons.push("The first closed-minute rollover is visible; waiting for a second confirmation or a decisive noise-adjusted drop.");
  }
  if (rolloverConfirmed) {
    reasons.push(
      `Rollover confirmed ${formatNumber(rolloverPoints)} points (${formatNumber(rolloverPct)}%) below the local crest with ${decliningConfirmationBars} closed-minute decline confirmation bar${decliningConfirmationBars === 1 ? "" : "s"}.`,
    );
  }
  if (missed) {
    reasons.push(
      `The local crest is now too stale or too far behind current premium (${formatNumber(peakAgeMinutes)} min, ${formatNumber(rolloverPct)}% off peak); wait for a fresh expansion cycle instead of chasing.`,
    );
  }

  return {
    status,
    rawSampleCount,
    completedMinuteCount,
    officialCredit,
    localTroughCredit: trough?.median ?? null,
    localPeakCredit: peak?.median ?? null,
    localPeakAt: peak?.timestamp ?? null,
    cycleExpansionPoints: expansionPoints,
    cycleExpansionPct: expansionPct,
    rolloverPoints,
    rolloverPct,
    expansionThresholdPoints,
    rolloverThresholdPoints,
    quoteNoisePoints,
    oneMinuteSlope,
    threeMinuteSlope,
    peakAgeMinutes,
    confirmationBars: decliningConfirmationBars,
    cycleExpanded,
    nearCrest,
    rolloverStarted,
    rolloverConfirmed,
    missed,
    armed,
    signalEligible,
    score,
    reasons,
    bars,
  };
}

export function buildCompletedPremiumMinuteBars(
  samples: PremiumTapeLike[],
  generatedAt: string,
): ExecutionPremiumMinuteBar[] {
  const normalized = normalizeSamples(samples);
  const generatedMs = Date.parse(generatedAt);
  if (!Number.isFinite(generatedMs)) return [];
  const currentMinute = Math.floor(generatedMs / 60_000) * 60_000;
  const groups = new Map<number, PremiumTapeLike[]>();

  for (const sample of normalized) {
    const timestamp = Date.parse(sample.timestamp);
    if (!Number.isFinite(timestamp) || timestamp >= currentMinute) continue;
    const minuteKey = Math.floor(timestamp / 60_000) * 60_000;
    const list = groups.get(minuteKey) ?? [];
    list.push(sample);
    groups.set(minuteKey, list);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([minuteKey, points]) => {
      const ordered = [...points].sort(
        (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp),
      );
      const values = ordered.map((point) => point.credit);
      const sortedValues = [...values].sort((left, right) => left - right);
      const high = Math.max(...values);
      const low = Math.min(...values);
      return {
        minuteKey,
        timestamp: new Date(minuteKey).toISOString(),
        open: ordered[0]!.credit,
        high,
        low,
        close: ordered.at(-1)!.credit,
        median: median(sortedValues),
        sampleCount: values.length,
        range: high - low,
      };
    });
}

function normalizeSamples(samples: PremiumTapeLike[]) {
  const byTimestamp = new Map<string, PremiumTapeLike>();
  for (const sample of samples) {
    const timestamp = Date.parse(sample.timestamp);
    if (
      !Number.isFinite(timestamp) ||
      !Number.isFinite(sample.credit) ||
      sample.credit < 0
    ) {
      continue;
    }
    byTimestamp.set(sample.timestamp, sample);
  }
  return [...byTimestamp.values()].sort(
    (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp),
  );
}

function estimateQuoteNoise(
  raw: PremiumTapeLike[],
  bars: ExecutionPremiumMinuteBar[],
) {
  const diffs: number[] = [];
  for (let index = 1; index < raw.length; index += 1) {
    const previous = raw[index - 1]!;
    const current = raw[index]!;
    const elapsed = Date.parse(current.timestamp) - Date.parse(previous.timestamp);
    if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed > 45_000) continue;
    diffs.push(Math.abs(current.credit - previous.credit));
  }
  const barHalfRanges = bars
    .slice(-5)
    .map((bar) => bar.range / 2)
    .filter((value) => Number.isFinite(value));
  const medianDiff = diffs.length ? median(diffs.sort((a, b) => a - b)) : 0;
  const medianHalfRange = barHalfRanges.length
    ? median(barHalfRanges.sort((a, b) => a - b))
    : 0;
  return Math.max(0.01, medianDiff * 1.25, medianHalfRange * 0.5);
}

function findCurrentExpansionCycle(bars: ExecutionPremiumMinuteBar[]) {
  if (!bars.length) return { trough: null, peak: null };
  let trough = bars[0]!;
  let peak = bars[0]!;

  for (const bar of bars.slice(1)) {
    if (bar.median < trough.median) {
      trough = bar;
      peak = bar;
      continue;
    }
    if (bar.median > peak.median) {
      peak = bar;
    }
  }

  return { trough, peak };
}

function countTrailingDeclines(values: ExecutionPremiumMinuteBar[]) {
  if (values.length < 2) return 0;
  let count = 0;
  for (let index = values.length - 1; index > 0; index -= 1) {
    if (values[index]!.median >= values[index - 1]!.median) break;
    count += 1;
  }
  return count;
}

function slopeOneMinute(bars: ExecutionPremiumMinuteBar[]) {
  const latest = bars.at(-1);
  const previous = bars.at(-2);
  if (!latest || !previous) return null;
  const minutes = Math.max((latest.minuteKey - previous.minuteKey) / 60_000, 1);
  return (latest.median - previous.median) / minutes;
}

function regressionSlope(bars: ExecutionPremiumMinuteBar[]) {
  if (bars.length < 2) return null;
  const origin = bars[0]!.minuteKey;
  const points = bars.map((bar) => ({
    x: (bar.minuteKey - origin) / 60_000,
    y: bar.median,
  }));
  const xMean = average(points.map((point) => point.x));
  const yMean = average(points.map((point) => point.y));
  let numerator = 0;
  let denominator = 0;
  for (const point of points) {
    numerator += (point.x - xMean) * (point.y - yMean);
    denominator += (point.x - xMean) ** 2;
  }
  if (denominator <= 0) return null;
  return numerator / denominator;
}

function scoreCrest(args: {
  cycleExpanded: boolean;
  nearCrest: boolean;
  rolloverStarted: boolean;
  rolloverConfirmed: boolean;
  missed: boolean;
  expansionPct: number | null;
  rolloverPct: number | null;
  threeMinuteSlope: number | null;
  quoteNoisePoints: number;
}) {
  if (args.missed) return 35;
  if (!args.cycleExpanded) return 22;

  let score = 58;
  score += Math.min(12, Math.max(0, (args.expansionPct ?? 0) - 3) * 1.5);
  if (args.nearCrest) score = Math.max(score, 72);
  if (args.rolloverStarted) score = Math.max(score, 84);
  if (args.rolloverConfirmed) score = Math.max(score, 96);
  if ((args.threeMinuteSlope ?? 0) < -Math.max(0.01, args.quoteNoisePoints * 0.2)) {
    score += 4;
  }
  if ((args.rolloverPct ?? 0) > 8) score -= Math.min(12, (args.rolloverPct ?? 0) - 8);
  return clamp(score);
}

function makeEmptyRead(args: {
  status: PremiumCrestStatus;
  rawSampleCount: number;
  completedMinuteCount: number;
  officialCredit: number | null;
  bars: ExecutionPremiumMinuteBar[];
  reasons: string[];
}): ZeroDtePremiumCrestRead {
  return {
    status: args.status,
    rawSampleCount: args.rawSampleCount,
    completedMinuteCount: args.completedMinuteCount,
    officialCredit: args.officialCredit,
    localTroughCredit: null,
    localPeakCredit: null,
    localPeakAt: null,
    cycleExpansionPoints: null,
    cycleExpansionPct: null,
    rolloverPoints: null,
    rolloverPct: null,
    expansionThresholdPoints: null,
    rolloverThresholdPoints: null,
    quoteNoisePoints: null,
    oneMinuteSlope: null,
    threeMinuteSlope: null,
    peakAgeMinutes: null,
    confirmationBars: 0,
    cycleExpanded: false,
    nearCrest: false,
    rolloverStarted: false,
    rolloverConfirmed: false,
    missed: false,
    armed: false,
    signalEligible: false,
    score: 12,
    reasons: args.reasons,
    bars: args.bars,
  };
}

function median(values: number[]) {
  if (!values.length) return 0;
  const middle = Math.floor(values.length / 2);
  return values.length % 2
    ? values[middle]!
    : (values[middle - 1]! + values[middle]!) / 2;
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatSigned(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function formatNumber(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}
