export type BasisCandle = {
  time: number;
  close: number;
};

export type BasisSummary = {
  median: number | null;
  coveragePct: number | null;
  matched: number;
  eligible: number;
};

export function latestHistoricalCandleAtOrBefore<T extends BasisCandle>(
  candles: readonly T[],
  epochSeconds: number,
  toleranceSeconds = 90,
): T | null {
  let best: T | null = null;
  let bestLag = Number.POSITIVE_INFINITY;
  for (const candle of candles) {
    if (!Number.isFinite(candle.time) || !Number.isFinite(candle.close)) continue;
    if (candle.time > epochSeconds) continue;
    const lag = epochSeconds - candle.time;
    if (lag < bestLag) {
      best = candle;
      bestLag = lag;
    }
  }
  return best && bestLag <= toleranceSeconds ? best : null;
}

/**
 * Median ES-SPX basis across overlapping candles. Callers can pre-filter to a
 * specific window (for example the final 30 minutes of the prior cash session).
 */
export function buildBasisSummary(
  esCandles: readonly BasisCandle[],
  spxCandles: readonly BasisCandle[],
  toleranceSeconds = 90,
): BasisSummary {
  const orderedEs = [...esCandles]
    .filter((candle) => Number.isFinite(candle.time) && Number.isFinite(candle.close))
    .sort((a, b) => a.time - b.time);
  const orderedSpx = [...spxCandles]
    .filter((candle) => Number.isFinite(candle.time) && Number.isFinite(candle.close))
    .sort((a, b) => a.time - b.time);

  if (!orderedEs.length || !orderedSpx.length) {
    return { median: null, coveragePct: null, matched: 0, eligible: 0 };
  }

  const firstSpx = orderedSpx[0]?.time ?? 0;
  const lastSpx = orderedSpx.at(-1)?.time ?? 0;
  const eligibleEs = orderedEs.filter(
    (candle) => candle.time >= firstSpx && candle.time <= lastSpx,
  );
  const values: number[] = [];
  for (const es of eligibleEs) {
    const spx = latestHistoricalCandleAtOrBefore(orderedSpx, es.time, toleranceSeconds);
    if (spx) values.push(es.close - spx.close);
  }

  if (!values.length) {
    return {
      median: null,
      coveragePct: eligibleEs.length ? 0 : null,
      matched: 0,
      eligible: eligibleEs.length,
    };
  }

  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2
    ? values[middle]
    : (values[middle - 1] + values[middle]) / 2;

  return {
    median,
    coveragePct: eligibleEs.length ? (values.length / eligibleEs.length) * 100 : null,
    matched: values.length,
    eligible: eligibleEs.length,
  };
}
