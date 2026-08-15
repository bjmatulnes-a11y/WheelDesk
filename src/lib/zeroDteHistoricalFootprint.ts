export type HistoricalEsCandle = {
  time: number; // epoch seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/**
 * PROVENANCE NOTICE
 * -----------------
 * These cells are NOT reconstructed from a bid/ask tape. There is no trade-side
 * classification in the source data — only OHLCV bars. `askVolume`/`bidVolume`
 * are SYNTHESISED from candle geometry, and `shapeProxy` reduces algebraically to:
 *
 *     shapeProxy = 56 * body + 34 * closeLocation
 *
 * Volume cancels out entirely (it appears in both numerator and denominator of
 * delta/totalVolume). The field therefore carries ZERO information beyond OHLC.
 *
 * It must never be scored as evidence independent of candle shape. See
 * `zeroDteAuctionAnalytics.ts` → `shapeEvidenceWeight()` for the collapse rule.
 */
export const FOOTPRINT_PROVENANCE = "SYNTHETIC_FROM_OHLCV" as const;
export type FootprintProvenance = typeof FOOTPRINT_PROVENANCE | "TRUE_TAPE";

export type HistoricalFootprintCell = {
  price: number;
  /** Synthetic. Derived from candle geometry, not from a tape. */
  bidVolume: number;
  /** Synthetic. Derived from candle geometry, not from a tape. */
  askVolume: number;
  totalVolume: number;
  /**
   * Synthetic shape proxy, NOT order-flow delta.
   * Renamed from `delta` to prevent it being read as tape-derived.
   */
  shapeProxy: number;
  provenance: FootprintProvenance;
};

export type HistoricalFootprintBucket = {
  key: string;
  label: string;
  startTime: number;
  endTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  cells: HistoricalFootprintCell[];
};

export type HistoricalSessionProfileLevel = HistoricalFootprintCell & {
  sharePct: number;
  rankPct: number;
  node: "POC" | "HVN" | "LVN" | "NORMAL";
};

export type HistoricalFootprintStudy = {
  buckets: HistoricalFootprintBucket[];
  profile: HistoricalSessionProfileLevel[];
  poc: number | null;
  valueAreaLow: number | null;
  valueAreaHigh: number | null;
  totalVolume: number;
  candleCount: number;
};

export const ES_TICK = 0.25;

/** ES equity-index regular trading hours, Chicago local minutes-of-day. */
export const ES_RTH_OPEN_MINUTE = 8 * 60 + 30; // 08:30 CT
export const ES_RTH_CLOSE_MINUTE = 15 * 60 + 15; // 15:15 CT futures close

export function buildHistoricalFootprintStudy(args: {
  candles: HistoricalEsCandle[];
  date: string;
  aggregationMinutes?: 1 | 5 | 15 | 30;
  session?: "RTH" | "FULL";
}): HistoricalFootprintStudy {
  const aggregationMinutes = args.aggregationMinutes ?? 30;
  const session = args.session ?? "RTH";
  const candles = args.candles
    .filter((candle) => isFiniteCandle(candle))
    .filter((candle) => historicalCandleMatchesSession(candle, args.date, session))
    .sort((a, b) => a.time - b.time);

  const bucketMap = new Map<string, HistoricalFootprintBucket>();
  const profileMap = new Map<number, HistoricalFootprintCell>();

  for (const candle of candles) {
    const bucketInfo = bucketForCandle(candle, aggregationMinutes);
    const distributed = reconstructHistoricalCandleFootprint(candle);
    let bucket = bucketMap.get(bucketInfo.key);
    if (!bucket) {
      bucket = {
        key: bucketInfo.key,
        label: bucketInfo.label,
        startTime: bucketInfo.startTime,
        endTime: bucketInfo.endTime,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: 0,
        cells: [],
      };
      bucketMap.set(bucketInfo.key, bucket);
    }

    bucket.high = Math.max(bucket.high, candle.high);
    bucket.low = Math.min(bucket.low, candle.low);
    bucket.close = candle.close;
    bucket.volume += Math.max(0, candle.volume || 0);

    const local = new Map<number, HistoricalFootprintCell>(
      bucket.cells.map((cell) => [cell.price, { ...cell }]),
    );
    for (const cell of distributed) {
      mergeCell(local, cell);
      mergeCell(profileMap, cell);
    }
    bucket.cells = [...local.values()].sort((a, b) => b.price - a.price);
  }

  const buckets = [...bucketMap.values()].sort((a, b) => a.startTime - b.startTime);
  const rawProfile = [...profileMap.values()].sort((a, b) => b.price - a.price);
  const totalVolume = rawProfile.reduce((sum, level) => sum + level.totalVolume, 0);
  const sortedByVolume = [...rawProfile].sort((a, b) => b.totalVolume - a.totalVolume);
  const poc = sortedByVolume[0]?.price ?? null;
  const rankByPrice = new Map<number, number>();
  sortedByVolume.forEach((level, index) => {
    rankByPrice.set(level.price, sortedByVolume.length <= 1 ? 1 : index / (sortedByVolume.length - 1));
  });

  const profile: HistoricalSessionProfileLevel[] = rawProfile.map((level) => {
    const rankPct = (rankByPrice.get(level.price) ?? 1) * 100;
    const node =
      level.price === poc
        ? "POC"
        : rankPct <= 20
          ? "HVN"
          : rankPct >= 80
            ? "LVN"
            : "NORMAL";
    return {
      ...level,
      sharePct: totalVolume > 0 ? (level.totalVolume / totalVolume) * 100 : 0,
      rankPct,
      node,
    };
  });

  const valueArea = calculateValueArea(profile, totalVolume, poc);

  return {
    buckets,
    profile,
    poc,
    valueAreaLow: valueArea.low,
    valueAreaHigh: valueArea.high,
    totalVolume,
    candleCount: candles.length,
  };
}

export function reconstructHistoricalCandleFootprint(candle: HistoricalEsCandle): HistoricalFootprintCell[] {
  const low = roundToTick(Math.min(candle.low, candle.high));
  const high = roundToTick(Math.max(candle.low, candle.high));
  const prices: number[] = [];
  for (let price = low; price <= high + ES_TICK / 2; price += ES_TICK) {
    prices.push(roundToTick(price));
    if (prices.length > 1000) break;
  }
  if (!prices.length) prices.push(roundToTick(candle.close));

  const range = Math.max(ES_TICK, high - low);
  const body = clamp((candle.close - candle.open) / range, -1, 1);
  const closeLocation = clamp(((candle.close - low) / range) * 2 - 1, -1, 1);
  const askShare = clamp(0.5 + body * 0.28 + closeLocation * 0.17, 0.08, 0.92);

  const weights = prices.map((price) => {
    const closeDistance = Math.abs(price - candle.close) / range;
    const bodyLow = Math.min(candle.open, candle.close);
    const bodyHigh = Math.max(candle.open, candle.close);
    const inBody = price >= bodyLow - ES_TICK / 2 && price <= bodyHigh + ES_TICK / 2;
    return Math.max(0.2, 1.35 - closeDistance) * (inBody ? 1.25 : 1);
  });
  const weightTotal = weights.reduce((sum, value) => sum + value, 0) || 1;
  const volume = Math.max(0, candle.volume || 0);

  return prices.map((price, index) => {
    const allocated = volume * (weights[index] / weightTotal);
    const askVolume = allocated * askShare;
    const bidVolume = allocated - askVolume;
    return {
      price,
      bidVolume,
      askVolume,
      totalVolume: allocated,
      shapeProxy: askVolume - bidVolume,
      provenance: FOOTPRINT_PROVENANCE,
    };
  });
}

/**
 * Closed-form equivalent of the per-candle shape proxy, expressed as a percentage
 * of that candle's volume. Exposed so callers can reason about it directly rather
 * than rediscovering it by summing synthetic cells.
 *
 *   shapeProxyPct = 56 * body + 34 * closeLocation   (range ±84, clamped)
 */
export function candleShapeProxyPct(candle: HistoricalEsCandle): number {
  const range = Math.max(ES_TICK, candle.high - candle.low);
  const body = clamp((candle.close - candle.open) / range, -1, 1);
  const closeLocation = clamp(((candle.close - candle.low) / range) * 2 - 1, -1, 1);
  const askShare = clamp(0.5 + body * 0.28 + closeLocation * 0.17, 0.08, 0.92);
  return (askShare - (1 - askShare)) * 100;
}

/**
 * Standard volume value area: start at POC and expand CONTIGUOUSLY, at each step
 * taking whichever adjacent side (above or below) contributes more volume, until
 * 70% of session volume is enclosed.
 *
 * The prior implementation took the globally highest-volume levels and returned
 * their bounding box. That admitted low-volume prices that were never in the real
 * value area, and on a two-distribution day it reported a single VA spanning both
 * distributions instead of revealing the split.
 */
function calculateValueArea(
  profile: HistoricalSessionProfileLevel[],
  totalVolume: number,
  poc: number | null,
) {
  if (!profile.length || totalVolume <= 0 || poc == null) return { low: null, high: null };

  // profile arrives sorted by price DESC; walk it ascending for index arithmetic.
  const ascending = [...profile].sort((a, b) => a.price - b.price);
  const pocIndex = ascending.findIndex((level) => level.price === poc);
  if (pocIndex < 0) return { low: null, high: null };

  const target = totalVolume * 0.7;
  let accumulated = ascending[pocIndex].totalVolume;
  let lowIndex = pocIndex;
  let highIndex = pocIndex;

  while (accumulated < target && (lowIndex > 0 || highIndex < ascending.length - 1)) {
    // Standard practice pairs levels on each side; single-level steps are used
    // here because ES tick granularity already makes each step small.
    const below = lowIndex > 0 ? ascending[lowIndex - 1].totalVolume : -1;
    const above = highIndex < ascending.length - 1 ? ascending[highIndex + 1].totalVolume : -1;

    if (above > below) {
      highIndex += 1;
      accumulated += ascending[highIndex].totalVolume;
    } else if (below >= 0) {
      lowIndex -= 1;
      accumulated += ascending[lowIndex].totalVolume;
    } else {
      break;
    }
  }

  return { low: ascending[lowIndex].price, high: ascending[highIndex].price };
}

function mergeCell(map: Map<number, HistoricalFootprintCell>, incoming: HistoricalFootprintCell) {
  const prior = map.get(incoming.price);
  if (!prior) {
    map.set(incoming.price, { ...incoming });
    return;
  }
  prior.bidVolume += incoming.bidVolume;
  prior.askVolume += incoming.askVolume;
  prior.totalVolume += incoming.totalVolume;
  prior.shapeProxy += incoming.shapeProxy;
}

function bucketForCandle(candle: HistoricalEsCandle, aggregationMinutes: number) {
  const parts = chicagoParts(candle.time * 1000);
  const minuteOfDay = parts.hour * 60 + parts.minute;
  const bucketMinute = Math.floor(minuteOfDay / aggregationMinutes) * aggregationMinutes;
  const hour = Math.floor(bucketMinute / 60);
  const minute = bucketMinute % 60;
  const key = `${parts.date}-${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const label = formatClock(hour, minute);
  const startTime = candle.time - ((minuteOfDay - bucketMinute) * 60 + parts.second);
  return {
    key,
    label,
    startTime,
    endTime: startTime + aggregationMinutes * 60,
  };
}

export function historicalCandleMatchesSession(
  candle: HistoricalEsCandle,
  requestedDate: string,
  session: "RTH" | "FULL",
) {
  const parts = chicagoParts(candle.time * 1000);
  const minuteOfDay = parts.hour * 60 + parts.minute;
  if (session === "RTH") {
    // ES equity-index RTH runs 08:30–15:15 CT. The prior 15:00 cutoff dropped the
    // final 15 minutes, which is among the most informative window for a 0DTE
    // exhaustion study (SPX settles 15:00; futures keep trading to 15:15).
    return (
      parts.date === requestedDate &&
      minuteOfDay >= ES_RTH_OPEN_MINUTE &&
      minuteOfDay <= ES_RTH_CLOSE_MINUTE
    );
  }

  if (parts.date === requestedDate && minuteOfDay <= 16 * 60) return true;
  const priorDate = addUtcDate(requestedDate, -1);
  return parts.date === priorDate && minuteOfDay >= 17 * 60;
}

function chicagoParts(ms: number) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(ms)).map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function addUtcDate(date: string, days: number) {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function formatClock(hour: number, minute: number) {
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function roundToTick(value: number) {
  return Math.round(value / ES_TICK) * ES_TICK;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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
