import { getPriceSeries } from "./data-provider";
import { saveCandles, type CandleRecord } from "./wheeldesk-storage";

export function normalizeStorageTicker(value: string): string {
  const t = String(value ?? "").trim().toUpperCase();

  if (["SPX", "^SPX", "$SPX", "GSPC", "^GSPC"].includes(t)) return "^SPX";
  if (["VIX", "^VIX", "$VIX"].includes(t)) return "^VIX";

  return t;
}

export function yahooSymbolForTicker(value: string): string {
  const t = normalizeStorageTicker(value);

  if (t === "^SPX") return "^GSPC";
  if (t === "^VIX") return "^VIX";

  return t;
}

export function normalizeCandlesForStorage(raw: unknown[]): CandleRecord[] {
  return (Array.isArray(raw) ? raw : [])
    .map((c: any) => ({
      date: String(c?.date ?? c?.time ?? c?.timestamp ?? "").slice(0, 10),
      open: Number(c?.open ?? c?.o ?? c?.close),
      high: Number(c?.high ?? c?.h ?? c?.close),
      low: Number(c?.low ?? c?.l ?? c?.close),
      close: Number(c?.close ?? c?.c),
      volume: Number(c?.volume ?? c?.v ?? 0) || undefined,
    }))
    .filter(
      (c) =>
        c.date &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close)
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function importYahooCandlesForTicker(
  ticker: string,
  range: "1y" | "daily" = "1y"
): Promise<number> {
  const storageTicker = normalizeStorageTicker(ticker);
  const yahooTicker = yahooSymbolForTicker(ticker);

  // getPriceSeries expects the app's timeframe naming.
  // For now, "1y" means daily candles over the default provider range.
  const timeframe = range === "1y" ? "daily" : range;

  const series = await getPriceSeries(yahooTicker, timeframe as any);
  const candles = normalizeCandlesForStorage(series as any[]);

  if (candles.length) {
    saveCandles(storageTicker, candles);
  }

  return candles.length;
}