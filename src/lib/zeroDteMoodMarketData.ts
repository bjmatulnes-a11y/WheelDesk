import {
  fetchSchwabPriceHistory,
  fetchSchwabQuotes,
  type SchwabPriceCandle,
} from "./schwab/client";
import { fetchZeroDteBreadthSnapshot, type ZeroDteBreadthSnapshot } from "./zeroDteBreadthAdapter";
import { buildZeroDteLeadershipRead, type ZeroDteLeadershipRead } from "./zeroDteLeadershipEngine";
import { getDailyLeadershipWeightSnapshot } from "./zeroDteLeadershipWeights";
import { getZeroDteSessionClock } from "./zeroDteSessionClock";

export type ZeroDteMoodMarketData = {
  leadership: ZeroDteLeadershipRead;
  breadth: ZeroDteBreadthSnapshot;
  spxCandles: SchwabPriceCandle[];
};

type CacheRecord = {
  key: string;
  value: ZeroDteMoodMarketData;
};

const globalCache = globalThis as typeof globalThis & {
  __wheelDeskMoodMarketData?: CacheRecord[];
};

export async function loadZeroDteMoodMarketData(args: {
  tradeDate: string;
  generatedAt: string;
  spxProviderSymbol: string;
  spxCurrent: number;
  requestValues?: Partial<{
    tick: number;
    uvol: number;
    dvol: number;
    advanceDecline: number;
  }>;
}): Promise<ZeroDteMoodMarketData> {
  const clock = getZeroDteSessionClock(args.generatedAt);
  const requestKey = Object.entries(args.requestValues ?? {})
    .filter(([, value]) => typeof value === "number" && Number.isFinite(value))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join("|");
  const bucket =
    clock.sessionStatus === "CLOSED"
      ? "EOD"
      : clock.sessionStatus === "PREOPEN"
        ? "PREOPEN"
        : String(clock.epochMinute);
  const key = `${args.tradeDate}:${bucket}:${requestKey}`;
  const cache = globalCache.__wheelDeskMoodMarketData ?? [];
  const existing = cache.find((item) => item.key === key);
  if (existing) return existing.value;

  const [weights, priceHistory, breadth] = await Promise.all([
    getDailyLeadershipWeightSnapshot({ tradeDate: args.tradeDate }),
    fetchSchwabPriceHistory({
      symbol: args.spxProviderSymbol,
      frequency: 1,
      startDate: Date.now() - 24 * 60 * 60 * 1000,
      endDate: Date.now(),
    }),
    fetchZeroDteBreadthSnapshot({
      tradeDate: args.tradeDate,
      generatedAt: args.generatedAt,
      requestValues: args.requestValues,
    }),
  ]);
  const quotes = await fetchSchwabQuotes(
    weights.constituents.map((item) => item.providerSymbol),
  );
  const leadership = buildZeroDteLeadershipRead({
    weights,
    quotes,
    spxCurrent: args.spxCurrent,
    spxPreviousClose: finite(priceHistory.previousClose),
  });
  const value = {
    leadership,
    breadth,
    spxCandles: priceHistory.candles ?? [],
  };

  globalCache.__wheelDeskMoodMarketData = [
    { key, value },
    ...cache.filter((item) => item.key !== key),
  ].slice(0, 8);
  return value;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
