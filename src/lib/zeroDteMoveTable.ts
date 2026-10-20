import type { StructureCandle } from "./zeroDteStructureMap";

export type MoveTableDayType = "INSIDE_RANGE" | "OUTSIDE_UP" | "OUTSIDE_DOWN";
export type MoveTableGapClass = "FLAT" | "MODERATE" | "LARGE";
export type VixBucket = "<15" | "15-20" | "20-25" | ">25";
export type MorningTrendBucket = "DOWN_GT_0_5" | "FLAT" | "UP_GT_0_5";
export type MoveTableSource = "SCHWAB_1M" | "SCHWAB_30M";

export type MoveTableContext = {
  timeBucket: string;
  dayType: MoveTableDayType;
  gapClass: MoveTableGapClass;
  vixBucket: VixBucket;
  morningTrend: MorningTrendBucket;
};

export type MoveTableObservation = MoveTableContext & {
  tradeDate: string;
  priorVixClose?: number | null;
  upMaxPct: number;
  downMaxPct: number;
  closeMovePct: number;
  source?: MoveTableSource;
};

export type MoveTableBucketSample = MoveTableObservation & {
  source: MoveTableSource;
};

export type MoveTableBucket = MoveTableContext & {
  upMaxPct: number[];
  downMaxPct: number[];
  closeMovePct: number[];
  /** Distinct trade dates in this bucket. */
  n: number;
  /** Present for Supabase-backed tables. Legacy static JSON may omit these. */
  sessionDates?: string[];
  samples?: MoveTableBucketSample[];
};

export type DailyMoveObservation = {
  tradeDate: string;
  priorVixClose: number;
  vixBucket: VixBucket;
  upMaxPct: number;
  downMaxPct: number;
  closeMovePct: number;
};

export type MoveTableRatio = {
  timeBucket: string;
  upRatio: number;
  downRatio: number;
  closeRatio: number;
  n: number;
};

export type MoveTableSourceMix = {
  SCHWAB_1M: number;
  SCHWAB_30M: number;
};

export type ZeroDteMoveTable = {
  version: 1;
  generatedAt: string | null;
  sessionCount: number;
  buckets: MoveTableBucket[];
  sourceMix?: MoveTableSourceMix;
  lastCaptureDate?: string | null;
  modeled?: {
    daily: DailyMoveObservation[];
    ratios: MoveTableRatio[];
  } | null;
};

export type MoveTableSample = {
  n: number;
  keyUsed: string;
  upMaxPct: number[];
  downMaxPct: number[];
  closeMovePct: number[];
  mode: "EMPIRICAL" | "MODELED";
  sourceMix: MoveTableSourceMix;
};

export type SpreadEdgeRead = {
  side: "PCS" | "CCS";
  shortStrike: number;
  longStrike: number;
  width: number;
  credit: number;
  distancePct: number;
  marketProbItm: number | null;
  histProbTouch: number;
  histProbItmAtClose: number;
  histExpectedLossPoints: number;
  evPerLotDollars: number;
  edgePts: number | null;
  sample: {
    n: number;
    keyUsed: string;
    mode: "EMPIRICAL" | "MODELED";
    sourceMix: MoveTableSourceMix;
  };
};

export type HistoricalSessionInput = {
  tradeDate: string;
  candles: readonly StructureCandle[];
  priorVixClose: number | null;
  priorExpectedMovePct?: number | null;
};

const ENTRY_BUCKETS = [
  "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
  "12:00", "12:30", "13:00", "13:30", "14:00",
] as const;
const CT = "America/Chicago";
const EMPTY_SOURCE_MIX: MoveTableSourceMix = { SCHWAB_1M: 0, SCHWAB_30M: 0 };

export function emptyZeroDteMoveTable(): ZeroDteMoveTable {
  return {
    version: 1,
    generatedAt: null,
    sessionCount: 0,
    buckets: [],
    sourceMix: { ...EMPTY_SOURCE_MIX },
    lastCaptureDate: null,
    modeled: null,
  };
}

export function classifyVixBucket(value: number | null | undefined): VixBucket | null {
  if (!finite(value) || value <= 0) return null;
  if (value < 15) return "<15";
  if (value < 20) return "15-20";
  if (value < 25) return "20-25";
  return ">25";
}

export function classifyMorningTrend(open: number, price: number): MorningTrendBucket {
  if (!finite(open) || open <= 0 || !finite(price)) return "FLAT";
  const movePct = (price - open) / open;
  if (movePct > 0.005) return "UP_GT_0_5";
  if (movePct < -0.005) return "DOWN_GT_0_5";
  return "FLAT";
}

export function halfHourTimeBucket(epochSeconds: number): string | null {
  if (!finite(epochSeconds)) return null;
  const parts = centralParts(epochSeconds);
  const minute = parts.hour * 60 + parts.minute;
  const clamped = Math.max(9 * 60, Math.min(14 * 60, Math.floor(minute / 30) * 30));
  return clockFromMinutes(clamped);
}

export function isInsideEntryWindow(epochSeconds: number, start: string, end: string): boolean {
  if (!finite(epochSeconds)) return false;
  const parts = centralParts(epochSeconds);
  const now = parts.hour * 60 + parts.minute;
  const lo = parseClockMinutes(start) ?? 9 * 60 + 30;
  const hi = parseClockMinutes(end) ?? 13 * 60 + 30;
  return now >= lo && now <= hi;
}

export function buildLiveMoveTableContext(args: {
  candles: readonly StructureCandle[];
  generatedAt: string | number | null | undefined;
  dayType: MoveTableDayType | null | undefined;
  gapClass: MoveTableGapClass | null | undefined;
  priorVixClose: number | null | undefined;
}): MoveTableContext | null {
  if (!args.candles.length || !args.dayType || !args.gapClass) return null;
  const vixBucket = classifyVixBucket(args.priorVixClose);
  if (!vixBucket) return null;
  const epoch = typeof args.generatedAt === "number"
    ? args.generatedAt
    : Date.parse(String(args.generatedAt ?? "")) / 1000;
  const timeBucket = halfHourTimeBucket(epoch);
  if (!timeBucket) return null;
  const first = args.candles[0];
  const last = args.candles.at(-1)!;
  return {
    timeBucket,
    dayType: args.dayType,
    gapClass: args.gapClass,
    vixBucket,
    morningTrend: classifyMorningTrend(first.open, last.close),
  };
}

/**
 * Builds recent 1-minute observations. Entry is the close of the candle at T,
 * therefore that candle's own high/low is excluded from post-entry excursion.
 */
export function buildMoveObservationsFromSessions(
  sessions: readonly HistoricalSessionInput[],
  source: MoveTableSource = "SCHWAB_1M",
): MoveTableObservation[] {
  return buildObservations(sessions, {
    source,
    entryMode: "CLOSE",
    buckets: "FIXED",
  });
}

/**
 * Builds 30-minute backfill observations. Entry is the OPEN of the bar that
 * starts at the observation time, so the entry bar itself is part of the
 * post-entry path. Actual Schwab bar timestamps are retained if alignment is
 * non-standard; the resolver will map a live half-hour context to the nearest
 * available historical time on that trade date.
 */
export function buildMoveObservationsFrom30MinuteSessions(
  sessions: readonly HistoricalSessionInput[],
): MoveTableObservation[] {
  return buildObservations(sessions, {
    source: "SCHWAB_30M",
    entryMode: "OPEN",
    buckets: "ACTUAL_30M",
  });
}

function buildObservations(
  sessions: readonly HistoricalSessionInput[],
  options: {
    source: MoveTableSource;
    entryMode: "OPEN" | "CLOSE";
    buckets: "FIXED" | "ACTUAL_30M";
  },
): MoveTableObservation[] {
  const sorted = [...sessions]
    .filter((session) => /^\d{4}-\d{2}-\d{2}$/.test(session.tradeDate))
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  const observations: MoveTableObservation[] = [];

  for (let index = 1; index < sorted.length; index += 1) {
    const session = sorted[index];
    const prior = sorted[index - 1];
    const current = cashSessionCandles(session.candles, session.tradeDate);
    const priorCash = cashSessionCandles(prior.candles, prior.tradeDate);
    if (!current.length || !priorCash.length) continue;
    const vixBucket = classifyVixBucket(session.priorVixClose);
    if (!vixBucket) continue;

    const pdh = Math.max(...priorCash.map((candle) => candle.high));
    const pdl = Math.min(...priorCash.map((candle) => candle.low));
    const pdc = priorCash.at(-1)!.close;
    const todayOpen = current[0].open;
    const dayType: MoveTableDayType = todayOpen > pdh
      ? "OUTSIDE_UP"
      : todayOpen < pdl
        ? "OUTSIDE_DOWN"
        : "INSIDE_RANGE";
    const impliedPct = finite(session.priorExpectedMovePct) && session.priorExpectedMovePct! > 0
      ? session.priorExpectedMovePct!
      : (session.priorVixClose! / 100) / Math.sqrt(252);
    const expectedMovePoints = Math.max(0.01, todayOpen * impliedPct);
    const gapRatio = Math.abs(todayOpen - pdc) / expectedMovePoints;
    const gapClass: MoveTableGapClass = gapRatio < 0.25 ? "FLAT" : gapRatio < 0.5 ? "MODERATE" : "LARGE";
    const close = current.at(-1)!.close;

    const entries = options.buckets === "FIXED"
      ? ENTRY_BUCKETS
          .map((timeBucket) => ({ timeBucket: String(timeBucket), candle: candleAtClock(current, timeBucket) }))
          .filter((item): item is { timeBucket: string; candle: StructureCandle } => item.candle !== null)
      : current
          .filter((candle) => {
            const parts = centralParts(candle.time);
            const minute = parts.hour * 60 + parts.minute;
            return minute >= 9 * 60 && minute <= 14 * 60;
          })
          .map((candle) => ({
            timeBucket: clockFromMinutes(centralParts(candle.time).hour * 60 + centralParts(candle.time).minute),
            candle,
          }));

    for (const entry of entries) {
      const entryIndex = current.findIndex((candle) => candle.time === entry.candle.time);
      if (entryIndex < 0) continue;
      const future = options.entryMode === "OPEN"
        ? current.slice(entryIndex)
        : current.slice(entryIndex + 1);
      const p = options.entryMode === "OPEN" ? entry.candle.open : entry.candle.close;
      if (!future.length || !finite(p) || p <= 0) continue;

      observations.push({
        tradeDate: session.tradeDate,
        timeBucket: entry.timeBucket,
        dayType,
        gapClass,
        vixBucket,
        priorVixClose: session.priorVixClose,
        morningTrend: classifyMorningTrend(todayOpen, p),
        upMaxPct: (Math.max(...future.map((candle) => candle.high)) - p) / p,
        downMaxPct: (p - Math.min(...future.map((candle) => candle.low))) / p,
        closeMovePct: (close - p) / p,
        source: options.source,
      });
    }
  }

  return observations;
}

export function buildMoveTableFromObservations(
  observations: readonly MoveTableObservation[],
  options?: {
    dailyMoves?: readonly DailyMoveObservation[];
    lastCaptureDate?: string | null;
  },
): ZeroDteMoveTable {
  const buckets = new Map<string, MoveTableBucket>();
  const dates = new Set<string>();
  const sourceByDate = new Map<string, MoveTableSource>();

  for (const observation of observations) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(observation.tradeDate)) continue;
    const values = [observation.upMaxPct, observation.downMaxPct, observation.closeMovePct];
    if (!values.every(finite)) continue;
    const source = normalizeSource(observation.source);
    dates.add(observation.tradeDate);
    const previousSource = sourceByDate.get(observation.tradeDate);
    if (!previousSource || sourceRank(source) > sourceRank(previousSource)) {
      sourceByDate.set(observation.tradeDate, source);
    }

    const key = exactKey(observation);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        timeBucket: observation.timeBucket,
        dayType: observation.dayType,
        gapClass: observation.gapClass,
        vixBucket: observation.vixBucket,
        morningTrend: observation.morningTrend,
        upMaxPct: [],
        downMaxPct: [],
        closeMovePct: [],
        n: 0,
        sessionDates: [],
        samples: [],
      };
      buckets.set(key, bucket);
    }
    const sample: MoveTableBucketSample = { ...observation, source };
    bucket.samples!.push(sample);
  }

  const output = [...buckets.values()].map((bucket) => finalizeBucket(bucket));
  const sourceMix = sourceMixFromDateMap(sourceByDate);
  const dailyMoves = (options?.dailyMoves ?? []).filter(validDailyMove);
  const ratios = dailyMoves.length ? buildModeledRatios(observations, dailyMoves) : [];

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    sessionCount: dates.size,
    buckets: output,
    sourceMix,
    lastCaptureDate: options?.lastCaptureDate ?? maxDate([...dates]),
    modeled: dailyMoves.length ? { daily: [...dailyMoves], ratios } : null,
  };
}

export function buildMoveTableFromSessions(
  sessions: readonly HistoricalSessionInput[],
): ZeroDteMoveTable {
  return buildMoveTableFromObservations(buildMoveObservationsFromSessions(sessions));
}

/** Legacy helper retained for old CLI workflows. Do not use for live EOD growth. */
export function mergeZeroDteMoveTables(
  base: ZeroDteMoveTable | null | undefined,
  incoming: ZeroDteMoveTable | null | undefined,
): ZeroDteMoveTable {
  if (!base?.buckets?.length) return incoming ?? emptyZeroDteMoveTable();
  if (!incoming?.buckets?.length) return base;

  const baseSamples = base.buckets.flatMap((bucket) => bucket.samples ?? []);
  const incomingSamples = incoming.buckets.flatMap((bucket) => bucket.samples ?? []);
  if (baseSamples.length && incomingSamples.length) {
    const byDateBucket = new Map<string, MoveTableBucketSample>();
    for (const sample of [...baseSamples, ...incomingSamples]) {
      const key = `${sample.tradeDate}|${sample.timeBucket}`;
      const existing = byDateBucket.get(key);
      if (!existing || sourceRank(sample.source) >= sourceRank(existing.source)) byDateBucket.set(key, sample);
    }
    return buildMoveTableFromObservations([...byDateBucket.values()], {
      dailyMoves: incoming.modeled?.daily ?? base.modeled?.daily ?? [],
      lastCaptureDate: maxDate([base.lastCaptureDate, incoming.lastCaptureDate].filter(Boolean) as string[]),
    });
  }

  // Legacy static tables have no per-date provenance, so preserve old behavior
  // only for backwards compatibility. The live system never uses this path.
  const merged = new Map<string, MoveTableBucket>();
  for (const bucket of [...base.buckets, ...incoming.buckets]) {
    const key = exactKey(bucket);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...bucket,
        upMaxPct: [...bucket.upMaxPct],
        downMaxPct: [...bucket.downMaxPct],
        closeMovePct: [...bucket.closeMovePct],
        n: bucket.n,
      });
      continue;
    }
    existing.upMaxPct.push(...bucket.upMaxPct);
    existing.downMaxPct.push(...bucket.downMaxPct);
    existing.closeMovePct.push(...bucket.closeMovePct);
    existing.n += bucket.n;
  }
  for (const bucket of merged.values()) {
    bucket.upMaxPct.sort((a, b) => a - b);
    bucket.downMaxPct.sort((a, b) => a - b);
    bucket.closeMovePct.sort((a, b) => a - b);
  }
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    sessionCount: Math.max(0, base.sessionCount) + Math.max(0, incoming.sessionCount),
    buckets: [...merged.values()],
    sourceMix: incoming.sourceMix ?? base.sourceMix ?? { ...EMPTY_SOURCE_MIX },
    lastCaptureDate: incoming.lastCaptureDate ?? base.lastCaptureDate ?? null,
    modeled: incoming.modeled ?? base.modeled ?? null,
  };
}

export function resolveMoveTableSample(
  table: ZeroDteMoveTable | null | undefined,
  context: MoveTableContext | null | undefined,
  minN = 30,
): MoveTableSample | null {
  if (!table?.buckets?.length || !context) return resolveModeledSample(table, context, minN);
  const stages: Array<{ label: string; match: (bucket: MoveTableBucket) => boolean }> = [
    { label: exactKey(context), match: (bucket) => exactKey(bucket) === exactKey(context) },
    {
      label: `${context.timeBucket}|${context.dayType}|${context.gapClass}|${context.vixBucket}|trend=*`,
      match: (bucket) => bucket.timeBucket === context.timeBucket && bucket.dayType === context.dayType && bucket.gapClass === context.gapClass && bucket.vixBucket === context.vixBucket,
    },
    {
      label: `${context.timeBucket}|${context.dayType}|gap=*|${context.vixBucket}|trend=*`,
      match: (bucket) => bucket.timeBucket === context.timeBucket && bucket.dayType === context.dayType && bucket.vixBucket === context.vixBucket,
    },
    {
      label: `${context.timeBucket}|day=*|gap=*|${context.vixBucket}|trend=*`,
      match: (bucket) => bucket.timeBucket === context.timeBucket && bucket.vixBucket === context.vixBucket,
    },
  ];

  let last: MoveTableSample | null = null;
  for (const stage of stages) {
    const sample = mergeBucketsDistinctDays(table.buckets.filter(stage.match), stage.label, context.timeBucket);
    if (sample) last = sample;
    if (sample && sample.n >= minN) return sample;
  }

  const targetMinute = parseClockMinutes(context.timeBucket) ?? 0;
  for (const radius of [30, 60, 90]) {
    const sample = mergeBucketsDistinctDays(
      table.buckets.filter((bucket) => {
        const minute = parseClockMinutes(bucket.timeBucket);
        return bucket.vixBucket === context.vixBucket && minute !== null && Math.abs(minute - targetMinute) <= radius;
      }),
      `time±${radius}m|day=*|gap=*|${context.vixBucket}|trend=*`,
      context.timeBucket,
    );
    if (sample) last = sample;
    if (sample && sample.n >= minN) return sample;
  }

  const modeled = resolveModeledSample(table, context, minN);
  if (modeled) return modeled;
  return last;
}

export function buildSpreadEdgeRead(args: {
  side: "PCS" | "CCS";
  shortStrike: number;
  longStrike: number;
  credit: number;
  spot: number;
  shortDeltaAbs: number | null | undefined;
  table: ZeroDteMoveTable | null | undefined;
  context: MoveTableContext | null | undefined;
}): SpreadEdgeRead | null {
  const width = Math.abs(args.shortStrike - args.longStrike);
  if (![args.shortStrike, args.longStrike, args.credit, args.spot, width].every((value) => finite(value)) || args.spot <= 0 || width <= 0 || args.credit < 0) {
    return null;
  }
  const sample = resolveMoveTableSample(args.table, args.context);
  if (!sample?.n) return null;
  const distancePoints = args.side === "PCS"
    ? args.spot - args.shortStrike
    : args.shortStrike - args.spot;
  const distancePct = Math.max(0, distancePoints / args.spot);
  const adverseMax = args.side === "PCS" ? sample.downMaxPct : sample.upMaxPct;
  const adverseClosePct = sample.closeMovePct.map((move) => args.side === "PCS" ? Math.max(0, -move) : Math.max(0, move));
  const histProbTouch = probabilityAtOrAbove(adverseMax, distancePct);
  const histProbItmAtClose = probabilityAtOrAbove(adverseClosePct, distancePct);
  const lossPoints = adverseClosePct.map((movePct) => clamp((movePct - distancePct) * args.spot, 0, width));
  const histExpectedLossPoints = mean(lossPoints);
  const marketProbItm = finite(args.shortDeltaAbs) ? clamp(args.shortDeltaAbs!, 0, 1) : null;
  return {
    side: args.side,
    shortStrike: args.shortStrike,
    longStrike: args.longStrike,
    width,
    credit: args.credit,
    distancePct,
    marketProbItm,
    histProbTouch,
    histProbItmAtClose,
    histExpectedLossPoints,
    evPerLotDollars: 100 * (args.credit - histExpectedLossPoints),
    edgePts: marketProbItm === null ? null : (marketProbItm - histProbItmAtClose) * 100,
    sample: {
      n: sample.n,
      keyUsed: sample.keyUsed,
      mode: sample.mode,
      sourceMix: sample.sourceMix,
    },
  };
}

export function buildInitialBalance(candles: readonly StructureCandle[]): { high: number; low: number } | null {
  const rows = candles.filter((candle) => {
    const part = centralParts(candle.time);
    const minute = part.hour * 60 + part.minute;
    return minute >= 8 * 60 + 30 && minute < 9 * 60 + 30;
  });
  if (!rows.length) return null;
  const latest = centralParts(rows.at(-1)!.time);
  if (latest.hour * 60 + latest.minute < 9 * 60 + 29) return null;
  return {
    high: Math.max(...rows.map((candle) => candle.high)),
    low: Math.min(...rows.map((candle) => candle.low)),
  };
}

export function moveTablePercentile(values: readonly number[], pct: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * clamp(pct, 0, 1))));
  return sorted[index];
}

export function sourcePrecedence(source: MoveTableSource): number {
  return sourceRank(source);
}

export function diagnoseIntradayBarAlignment(candles: readonly StructureCandle[]) {
  const byDate = new Map<string, StructureCandle[]>();
  for (const candle of candles) {
    const date = centralDate(candle.time);
    const rows = byDate.get(date) ?? [];
    rows.push(candle);
    byDate.set(date, rows);
  }
  const spacing = new Map<number, number>();
  const firstBars: Array<{ tradeDate: string; firstBar: string; rowCount: number }> = [];
  for (const [tradeDate, raw] of [...byDate.entries()].sort().slice(0, 8)) {
    const rows = cashSessionCandles(raw, tradeDate);
    if (!rows.length) continue;
    firstBars.push({
      tradeDate,
      firstBar: clockFromMinutes(centralParts(rows[0].time).hour * 60 + centralParts(rows[0].time).minute),
      rowCount: rows.length,
    });
    for (let i = 1; i < rows.length; i += 1) {
      const diff = Math.round((rows[i].time - rows[i - 1].time) / 60);
      spacing.set(diff, (spacing.get(diff) ?? 0) + 1);
    }
  }
  const spacingMinutes = [...spacing.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const alignedToCashOpen = firstBars.length > 0 && firstBars.every((row) => row.firstBar === "08:30");
  return { spacingMinutes, alignedToCashOpen, firstBars };
}

function resolveModeledSample(
  table: ZeroDteMoveTable | null | undefined,
  context: MoveTableContext | null | undefined,
  minN: number,
): MoveTableSample | null {
  if (!table?.modeled?.daily?.length || !table.modeled.ratios.length || !context) return null;
  const daily = table.modeled.daily.filter((item) => item.vixBucket === context.vixBucket);
  const distinctDates = new Set(daily.map((item) => item.tradeDate));
  if (distinctDates.size < minN) return null;
  const ratio = nearestRatio(table.modeled.ratios, context.timeBucket);
  if (!ratio) return null;
  const upMaxPct = daily.map((item) => Math.max(0, item.upMaxPct * ratio.upRatio)).sort((a, b) => a - b);
  const downMaxPct = daily.map((item) => Math.max(0, item.downMaxPct * ratio.downRatio)).sort((a, b) => a - b);
  const closeMovePct = daily.map((item) => item.closeMovePct * ratio.closeRatio).sort((a, b) => a - b);
  return {
    n: distinctDates.size,
    keyUsed: `MODELED|${context.timeBucket}|${context.vixBucket}|ratioN=${ratio.n}`,
    upMaxPct,
    downMaxPct,
    closeMovePct,
    mode: "MODELED",
    sourceMix: { ...EMPTY_SOURCE_MIX },
  };
}

function nearestRatio(ratios: readonly MoveTableRatio[], target: string): MoveTableRatio | null {
  const targetMinute = parseClockMinutes(target);
  if (targetMinute === null) return null;
  return [...ratios]
    .filter((item) => parseClockMinutes(item.timeBucket) !== null)
    .sort((a, b) => {
      const da = Math.abs((parseClockMinutes(a.timeBucket) ?? 0) - targetMinute);
      const db = Math.abs((parseClockMinutes(b.timeBucket) ?? 0) - targetMinute);
      return da - db || b.n - a.n;
    })[0] ?? null;
}

function buildModeledRatios(
  observations: readonly MoveTableObservation[],
  dailyMoves: readonly DailyMoveObservation[],
): MoveTableRatio[] {
  const dailyByDate = new Map(dailyMoves.map((item) => [item.tradeDate, item]));
  const groups = new Map<string, { up: number[]; down: number[]; close: number[] }>();
  for (const observation of observations) {
    const daily = dailyByDate.get(observation.tradeDate);
    if (!daily) continue;
    const group = groups.get(observation.timeBucket) ?? { up: [], down: [], close: [] };
    if (daily.upMaxPct > 1e-6) group.up.push(clamp(observation.upMaxPct / daily.upMaxPct, 0, 2));
    if (daily.downMaxPct > 1e-6) group.down.push(clamp(observation.downMaxPct / daily.downMaxPct, 0, 2));
    if (Math.abs(daily.closeMovePct) > 1e-6 && Math.sign(daily.closeMovePct) === Math.sign(observation.closeMovePct)) {
      group.close.push(clamp(Math.abs(observation.closeMovePct / daily.closeMovePct), 0, 2));
    }
    groups.set(observation.timeBucket, group);
  }
  return [...groups.entries()].map(([timeBucket, group]) => {
    const upRatio = median(group.up) ?? 0.5;
    const downRatio = median(group.down) ?? 0.5;
    const closeRatio = median(group.close) ?? (upRatio + downRatio) / 2;
    return {
      timeBucket,
      upRatio,
      downRatio,
      closeRatio,
      n: Math.max(group.up.length, group.down.length, group.close.length),
    };
  }).filter((item) => item.n > 0).sort((a, b) => (parseClockMinutes(a.timeBucket) ?? 0) - (parseClockMinutes(b.timeBucket) ?? 0));
}

function mergeBucketsDistinctDays(
  buckets: readonly MoveTableBucket[],
  keyUsed: string,
  targetTimeBucket: string,
): MoveTableSample | null {
  if (!buckets.length) return null;
  const samples = buckets.flatMap((bucket) => bucket.samples ?? []);
  if (samples.length) {
    const targetMinute = parseClockMinutes(targetTimeBucket) ?? 0;
    const byDate = new Map<string, MoveTableBucketSample>();
    for (const sample of samples) {
      const existing = byDate.get(sample.tradeDate);
      if (!existing || betterSample(sample, existing, targetMinute)) byDate.set(sample.tradeDate, sample);
    }
    const chosen = [...byDate.values()];
    if (!chosen.length) return null;
    return {
      n: chosen.length,
      keyUsed,
      upMaxPct: chosen.map((item) => item.upMaxPct).sort((a, b) => a - b),
      downMaxPct: chosen.map((item) => item.downMaxPct).sort((a, b) => a - b),
      closeMovePct: chosen.map((item) => item.closeMovePct).sort((a, b) => a - b),
      mode: "EMPIRICAL",
      sourceMix: sourceMixFromSamples(chosen),
    };
  }

  // Legacy static JSON fallback: dates are unavailable, so n is observation
  // count. The card labels this source as STATIC to make that limitation clear.
  const upMaxPct = buckets.flatMap((bucket) => bucket.upMaxPct).sort((a, b) => a - b);
  const downMaxPct = buckets.flatMap((bucket) => bucket.downMaxPct).sort((a, b) => a - b);
  const closeMovePct = buckets.flatMap((bucket) => bucket.closeMovePct).sort((a, b) => a - b);
  const n = Math.min(upMaxPct.length, downMaxPct.length, closeMovePct.length);
  if (!n) return null;
  return {
    n,
    keyUsed,
    upMaxPct,
    downMaxPct,
    closeMovePct,
    mode: "EMPIRICAL",
    sourceMix: { ...EMPTY_SOURCE_MIX },
  };
}

function betterSample(next: MoveTableBucketSample, current: MoveTableBucketSample, targetMinute: number) {
  const nextMinute = parseClockMinutes(next.timeBucket) ?? 0;
  const currentMinute = parseClockMinutes(current.timeBucket) ?? 0;
  const nextDistance = Math.abs(nextMinute - targetMinute);
  const currentDistance = Math.abs(currentMinute - targetMinute);
  if (nextDistance !== currentDistance) return nextDistance < currentDistance;
  return sourceRank(next.source) > sourceRank(current.source);
}

function finalizeBucket(bucket: MoveTableBucket): MoveTableBucket {
  const samples = [...(bucket.samples ?? [])].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  const uniqueDates = [...new Set(samples.map((sample) => sample.tradeDate))];
  return {
    ...bucket,
    samples,
    sessionDates: uniqueDates,
    n: uniqueDates.length,
    upMaxPct: samples.map((sample) => sample.upMaxPct).sort((a, b) => a - b),
    downMaxPct: samples.map((sample) => sample.downMaxPct).sort((a, b) => a - b),
    closeMovePct: samples.map((sample) => sample.closeMovePct).sort((a, b) => a - b),
  };
}

function cashSessionCandles(candles: readonly StructureCandle[], tradeDate: string): StructureCandle[] {
  return candles.filter((candle) => {
    const p = centralParts(candle.time);
    const date = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
    const minute = p.hour * 60 + p.minute;
    return date === tradeDate && minute >= 8 * 60 + 30 && minute <= 15 * 60;
  }).sort((a, b) => a.time - b.time);
}

function candleAtClock(candles: readonly StructureCandle[], clock: string): StructureCandle | null {
  const minute = parseClockMinutes(clock);
  if (minute === null) return null;
  return candles.find((candle) => {
    const p = centralParts(candle.time);
    return p.hour * 60 + p.minute === minute;
  }) ?? null;
}

function probabilityAtOrAbove(values: readonly number[], threshold: number): number {
  if (!values.length) return 0;
  let count = 0;
  for (const value of values) if (value >= threshold) count += 1;
  return count / values.length;
}

function exactKey(context: MoveTableContext) {
  return `${context.timeBucket}|${context.dayType}|${context.gapClass}|${context.vixBucket}|${context.morningTrend}`;
}

function parseClockMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function clockFromMinutes(total: number) {
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function centralParts(epochSeconds: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CT,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(epochSeconds * 1000));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.year), month: Number(map.month), day: Number(map.day),
    hour: Number(map.hour), minute: Number(map.minute),
  };
}

function centralDate(epochSeconds: number) {
  const p = centralParts(epochSeconds);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function clamp(value: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, value));
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeSource(source: MoveTableSource | undefined): MoveTableSource {
  return source === "SCHWAB_30M" ? "SCHWAB_30M" : "SCHWAB_1M";
}

function sourceRank(source: MoveTableSource) {
  return source === "SCHWAB_1M" ? 2 : 1;
}

function sourceMixFromSamples(samples: readonly MoveTableBucketSample[]): MoveTableSourceMix {
  const sourceByDate = new Map<string, MoveTableSource>();
  for (const sample of samples) {
    const existing = sourceByDate.get(sample.tradeDate);
    if (!existing || sourceRank(sample.source) > sourceRank(existing)) sourceByDate.set(sample.tradeDate, sample.source);
  }
  return sourceMixFromDateMap(sourceByDate);
}

function sourceMixFromDateMap(sourceByDate: Map<string, MoveTableSource>): MoveTableSourceMix {
  const mix: MoveTableSourceMix = { ...EMPTY_SOURCE_MIX };
  for (const source of sourceByDate.values()) mix[source] += 1;
  return mix;
}

function validDailyMove(item: DailyMoveObservation) {
  return /^\d{4}-\d{2}-\d{2}$/.test(item.tradeDate) &&
    finite(item.priorVixClose) && item.priorVixClose > 0 &&
    [item.upMaxPct, item.downMaxPct, item.closeMovePct].every(finite);
}

function maxDate(values: readonly string[]) {
  return values.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)).sort().at(-1) ?? null;
}
