import type { StructureCandle } from "./zeroDteStructureMap";

export type MoveTableDayType = "INSIDE_RANGE" | "OUTSIDE_UP" | "OUTSIDE_DOWN";
export type MoveTableGapClass = "FLAT" | "MODERATE" | "LARGE";
export type VixBucket = "<15" | "15-20" | "20-25" | ">25";
export type MorningTrendBucket = "DOWN_GT_0_5" | "FLAT" | "UP_GT_0_5";

export type MoveTableContext = {
  timeBucket: string;
  dayType: MoveTableDayType;
  gapClass: MoveTableGapClass;
  vixBucket: VixBucket;
  morningTrend: MorningTrendBucket;
};

export type MoveTableBucket = MoveTableContext & {
  upMaxPct: number[];
  downMaxPct: number[];
  closeMovePct: number[];
  n: number;
};

export type ZeroDteMoveTable = {
  version: 1;
  generatedAt: string | null;
  sessionCount: number;
  buckets: MoveTableBucket[];
};

export type MoveTableSample = {
  n: number;
  keyUsed: string;
  upMaxPct: number[];
  downMaxPct: number[];
  closeMovePct: number[];
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
  sample: { n: number; keyUsed: string };
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

export function emptyZeroDteMoveTable(): ZeroDteMoveTable {
  return { version: 1, generatedAt: null, sessionCount: 0, buckets: [] };
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
  const hour = Math.floor(clamped / 60);
  const mins = clamped % 60;
  return `${String(hour).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
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

export function buildMoveTableFromSessions(
  sessions: readonly HistoricalSessionInput[],
): ZeroDteMoveTable {
  const sorted = [...sessions]
    .filter((session) => /^\d{4}-\d{2}-\d{2}$/.test(session.tradeDate))
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  const buckets = new Map<string, MoveTableBucket>();

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

    for (const timeBucket of ENTRY_BUCKETS) {
      const entry = candleAtClock(current, timeBucket);
      if (!entry) continue;
      const entryIndex = current.findIndex((candle) => candle.time === entry.time);
      const future = current.slice(entryIndex);
      if (!future.length || entry.close <= 0) continue;
      const p = entry.close;
      const upMaxPct = (Math.max(...future.map((candle) => candle.high)) - p) / p;
      const downMaxPct = (p - Math.min(...future.map((candle) => candle.low))) / p;
      const closeMovePct = (close - p) / p;
      const context: MoveTableContext = {
        timeBucket,
        dayType,
        gapClass,
        vixBucket,
        morningTrend: classifyMorningTrend(todayOpen, p),
      };
      const key = exactKey(context);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { ...context, upMaxPct: [], downMaxPct: [], closeMovePct: [], n: 0 };
        buckets.set(key, bucket);
      }
      bucket.upMaxPct.push(upMaxPct);
      bucket.downMaxPct.push(downMaxPct);
      bucket.closeMovePct.push(closeMovePct);
      bucket.n += 1;
    }
  }

  const output = [...buckets.values()].map((bucket) => ({
    ...bucket,
    upMaxPct: [...bucket.upMaxPct].sort((a, b) => a - b),
    downMaxPct: [...bucket.downMaxPct].sort((a, b) => a - b),
    closeMovePct: [...bucket.closeMovePct].sort((a, b) => a - b),
  }));
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    sessionCount: sorted.length,
    buckets: output,
  };
}


export function mergeZeroDteMoveTables(
  base: ZeroDteMoveTable | null | undefined,
  incoming: ZeroDteMoveTable | null | undefined,
): ZeroDteMoveTable {
  if (!base?.buckets?.length) return incoming ?? emptyZeroDteMoveTable();
  if (!incoming?.buckets?.length) return base;
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
  };
}

export function resolveMoveTableSample(
  table: ZeroDteMoveTable | null | undefined,
  context: MoveTableContext | null | undefined,
  minN = 30,
): MoveTableSample | null {
  if (!table?.buckets?.length || !context) return null;
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
    const sample = mergeBuckets(table.buckets.filter(stage.match), stage.label);
    if (sample) last = sample;
    if (sample && sample.n >= minN) return sample;
  }

  const targetMinute = parseClockMinutes(context.timeBucket) ?? 0;
  for (const radius of [30, 60, 90]) {
    const sample = mergeBuckets(
      table.buckets.filter((bucket) => {
        const minute = parseClockMinutes(bucket.timeBucket);
        return bucket.vixBucket === context.vixBucket && minute !== null && Math.abs(minute - targetMinute) <= radius;
      }),
      `time±${radius}m|day=*|gap=*|${context.vixBucket}|trend=*`,
    );
    if (sample) last = sample;
    if (sample && sample.n >= minN) return sample;
  }
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
    sample: { n: sample.n, keyUsed: sample.keyUsed },
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

function mergeBuckets(buckets: readonly MoveTableBucket[], keyUsed: string): MoveTableSample | null {
  if (!buckets.length) return null;
  const upMaxPct = buckets.flatMap((bucket) => bucket.upMaxPct).sort((a, b) => a - b);
  const downMaxPct = buckets.flatMap((bucket) => bucket.downMaxPct).sort((a, b) => a - b);
  const closeMovePct = buckets.flatMap((bucket) => bucket.closeMovePct).sort((a, b) => a - b);
  const n = Math.min(upMaxPct.length, downMaxPct.length, closeMovePct.length);
  if (!n) return null;
  return { n, keyUsed, upMaxPct, downMaxPct, closeMovePct };
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

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function clamp(value: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, value));
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
