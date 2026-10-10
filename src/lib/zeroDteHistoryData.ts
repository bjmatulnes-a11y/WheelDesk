import { fetchSchwabPriceHistory, type SchwabPriceHistoryResponse } from "./schwab/client";
import type { StructureCandle } from "./zeroDteStructureMap";

export type HistoricalMarketSeries = {
  symbol: string;
  previousClose: number | null;
  previousCloseDate: number | null;
  candles: Array<StructureCandle & { volume: number }>;
};

export async function fetchHistoricalSeries(args: {
  userId: string;
  symbol: string;
  startDate?: number;
  endDate?: number;
  extendedHours?: boolean;
  frequencyType?: "minute" | "daily";
  frequency?: 1 | 5 | 10 | 15 | 30;
  periodType?: "day" | "month" | "year" | "ytd";
  period?: number;
}): Promise<HistoricalMarketSeries> {
  const result = await fetchSchwabPriceHistory({
    userId: args.userId,
    symbol: args.symbol,
    startDate: args.startDate,
    endDate: args.endDate,
    frequencyType: args.frequencyType ?? "minute",
    frequency: args.frequency ?? 1,
    periodType: args.periodType ?? "day",
    period: args.period ?? 1,
    needExtendedHoursData: args.extendedHours ?? false,
    needPreviousClose: true,
  });
  return {
    symbol: result.symbol ?? args.symbol,
    previousClose: result.previousClose ?? null,
    previousCloseDate: result.previousCloseDate ?? null,
    candles: normalizeSchwabHistoryCandles(result),
  };
}

export function normalizeSchwabHistoryCandles(
  result: SchwabPriceHistoryResponse,
): Array<StructureCandle & { volume: number }> {
  return (result.candles ?? [])
    .filter(
      (candle) =>
        Number.isFinite(candle.datetime) &&
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close),
    )
    .map((candle) => ({
      time: Math.floor(candle.datetime / 1000),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: Number.isFinite(candle.volume) ? Number(candle.volume) : 0,
    }));
}

export function frontEsContractSymbol(date: Date) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const quarterMonths = [3, 6, 9, 12];
  let contractMonth = quarterMonths.find((value) => value >= month) ?? 3;
  let contractYear = year;

  if (month === contractMonth) {
    const expiry = thirdFridayUtc(year, contractMonth);
    const rollMs = expiry.getTime() - 8 * 24 * 60 * 60 * 1000;
    if (date.getTime() >= rollMs) {
      const index = quarterMonths.indexOf(contractMonth);
      if (index === quarterMonths.length - 1) {
        contractMonth = 3;
        contractYear += 1;
      } else {
        contractMonth = quarterMonths[index + 1];
      }
    }
  }

  const code = ({ 3: "H", 6: "M", 9: "U", 12: "Z" } as Record<number, string>)[
    contractMonth
  ];
  return `/ES${code}${String(contractYear).slice(-2)}`;
}

function thirdFridayUtc(year: number, month: number) {
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  const daysUntilFriday = (5 - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month - 1, 1 + daysUntilFriday + 14, 12));
}

export function uniqueSymbols(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))];
}

export async function fetchFirstAvailableEsSeries(args: {
  userId: string;
  candidates: readonly string[];
  startDate: number;
  endDate: number;
}): Promise<{ series: HistoricalMarketSeries | null; failures: string[] }> {
  const failures: string[] = [];
  for (const symbol of args.candidates) {
    try {
      const series = await fetchHistoricalSeries({
        userId: args.userId,
        symbol,
        startDate: args.startDate,
        endDate: args.endDate,
        extendedHours: true,
        frequencyType: "minute",
        frequency: 1,
        periodType: "day",
        period: 1,
      });
      if (!series.candles.length) {
        failures.push(`${symbol}: Schwab returned no candles`);
        continue;
      }
      return { series, failures };
    } catch (error) {
      failures.push(`${symbol}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { series: null, failures };
}
