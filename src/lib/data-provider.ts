import {
  Candle,
  ChainRow,
  ChainSnapshot,
  ChainSnapshotEntry,
  ExpirationChain,
  Timeframe
} from "./types";
import { summarizeExpiration } from "./oi-engine";
import {
  deleteSavedChainSnapshots as removeSavedChainSnapshots,
  getSavedSnapshot as readSavedSnapshot,
  getSavedChainSnapshots as readSavedChainSnapshots,
  getSavedSnapshots as readSavedSnapshots,
  makeSnapshotKey as buildSnapshotKey,
  saveChainSnapshot as persistChainSnapshot
} from "./snapshot-store";
import { rankPrevailingChains } from "./prevailing-chain";
import { yahooProvider } from "./yahoo-provider";
import { OptionChain, OptionContract } from "./market-data-provider";

const fallbackBasePrices: Record<string, number> = {
  SOFI: 18,
  AAPL: 205,
  NVDA: 980,
  AMD: 165,
  SPY: 520,
  QQQ: 445
};

const timeframeToYahoo: Record<Timeframe, { range: string; interval: string }> = {
  weekly: { range: "2y", interval: "1wk" },
  daily: { range: "6mo", interval: "1d" },
  "4h": { range: "60d", interval: "1h" },
  "2h": { range: "60d", interval: "1h" },
  "1h": { range: "60d", interval: "1h" },
  "30m": { range: "30d", interval: "30m" },
  "15m": { range: "30d", interval: "15m" },
  "5m": { range: "5d", interval: "5m" },
  "1m": { range: "1d", interval: "1m" }
};

function fallbackBasePrice(symbol: string): number {
  return fallbackBasePrices[symbol.toUpperCase()] ?? 100;
}

function timestampToDateString(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function validNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function contractOi(contract?: OptionContract): number {
  return validNumber(contract?.openInterest) ? contract.openInterest : 0;
}

function contractVolume(contract?: OptionContract): number {
  return validNumber(contract?.volume) ? contract.volume : 0;
}

function contractIv(call?: OptionContract, put?: OptionContract): number {
  const callIv = validNumber(call?.impliedVolatility) ? call.impliedVolatility : undefined;
  const putIv = validNumber(put?.impliedVolatility) ? put.impliedVolatility : undefined;

  if (callIv !== undefined && putIv !== undefined) return Number(((callIv + putIv) / 2).toFixed(4));
  if (callIv !== undefined) return Number(callIv.toFixed(4));
  if (putIv !== undefined) return Number(putIv.toFixed(4));
  return 0;
}

function chainToRows(chain: OptionChain): ChainRow[] {
  const byStrike = new Map<
    number,
    {
      call?: OptionContract;
      put?: OptionContract;
    }
  >();

  for (const call of chain.calls ?? []) {
    if (!validNumber(call.strike)) continue;
    const existing = byStrike.get(call.strike) ?? {};
    existing.call = call;
    byStrike.set(call.strike, existing);
  }

  for (const put of chain.puts ?? []) {
    if (!validNumber(put.strike)) continue;
    const existing = byStrike.get(put.strike) ?? {};
    existing.put = put;
    byStrike.set(put.strike, existing);
  }

  return [...byStrike.entries()]
    .map(([strike, pair]) => ({
      strike,
      callOi: contractOi(pair.call),
      putOi: contractOi(pair.put),
      callVolume: contractVolume(pair.call),
      putVolume: contractVolume(pair.put),
      iv: contractIv(pair.call, pair.put)
    }))
    .filter((row) => row.callOi > 0 || row.putOi > 0 || row.callVolume > 0 || row.putVolume > 0)
    .sort((a, b) => a.strike - b.strike);
}

function buildFallbackCandles(symbol: string, timeframe: Timeframe): Candle[] {
  const base = fallbackBasePrice(symbol);
  const count = timeframe === "daily" ? 90 : timeframe === "weekly" ? 52 : 120;
  const candles: Candle[] = [];
  let lastClose = base;

  for (let i = count; i > 0; i -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - i);

    const wave = Math.sin(i / 7) * base * 0.01;
    const open = Math.max(0.01, lastClose);
    const close = Math.max(0.01, open + wave);
    const high = Math.max(open, close) + base * 0.008;
    const low = Math.max(0.01, Math.min(open, close) - base * 0.008);

    candles.push({
      time: date.toISOString(),
      open,
      high,
      low,
      close
    });

    lastClose = close;
  }

  return candles;
}

function buildFallbackRows(symbol: string, currentPrice: number): ChainRow[] {
  const step = currentPrice < 30 ? 0.5 : currentPrice < 300 ? 5 : 10;
  const rows: ChainRow[] = [];

  for (let i = -10; i <= 10; i += 1) {
    const strike = Number((currentPrice + i * step).toFixed(2));
    const distance = Math.abs(strike - currentPrice) / step;
    const baseOi = Math.round(5000 * Math.exp(-distance * distance / 12) + 500);

    rows.push({
      strike,
      callOi: Math.round(baseOi * (strike >= currentPrice ? 1.3 : 0.8)),
      putOi: Math.round(baseOi * (strike <= currentPrice ? 1.3 : 0.8)),
      callVolume: Math.round(baseOi * 0.05),
      putVolume: Math.round(baseOi * 0.05),
      iv: 0.35
    });
  }

  return rows;
}

export async function getPriceSeries(symbol: string, timeframe: Timeframe): Promise<Candle[]> {
  const normalized = symbol.toUpperCase();
  const yahoo = timeframeToYahoo[timeframe] ?? timeframeToYahoo.daily;

  try {
    const candles = await yahooProvider.getCandles(normalized, yahoo.range, yahoo.interval);

    if (!candles.length) {
      throw new Error("Yahoo returned no candles");
    }

    return candles.map((c) => ({
      time: new Date(c.time * 1000).toISOString(),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close
    }));
  } catch {
    return buildFallbackCandles(normalized, timeframe);
  }
}

export async function getAvailableExpirations(symbol: string): Promise<string[]> {
  const normalized = symbol.toUpperCase();

  try {
    const expirations = await yahooProvider.getOptionExpirations(normalized);
    return expirations.map(timestampToDateString).sort((a, b) => a.localeCompare(b));
  } catch {
    return ["2026-05-15", "2026-06-19", "2026-09-18", "2027-01-15"];
  }
}

export async function getOptionChain(symbol: string, asOfDate: string): Promise<ChainSnapshot> {
  const normalized = symbol.toUpperCase();

  let currentPrice = fallbackBasePrice(normalized);

  try {
    const quote = await yahooProvider.getQuote(normalized);
    if (validNumber(quote.price)) {
      currentPrice = quote.price;
    }
  } catch {
    // fallback currentPrice remains
  }

  try {
    const expirationTimestamps = await yahooProvider.getOptionExpirations(normalized);

    const chains: ExpirationChain[] = [];

    for (const expirationTimestamp of expirationTimestamps) {
      const chain = await yahooProvider.getOptionChain(normalized, expirationTimestamp);
      const expiration = chain.expirationDate ?? timestampToDateString(expirationTimestamp);
      const rows = chainToRows(chain);

      if (!rows.length) continue;

      const summary = summarizeExpiration(expiration, rows, currentPrice);

      chains.push({
        expiration,
        rows,
        summary
      });
    }

    if (!chains.length) {
      throw new Error("Yahoo returned no usable option chains");
    }

    const ranked = rankPrevailingChains(chains, currentPrice);

    return {
      ticker: normalized,
      snapshotDate: asOfDate,
      chains: ranked
    };
  } catch {
    const fallbackExpirations = ["2026-05-15", "2026-06-19", "2026-09-18", "2027-01-15"];

    const chains = fallbackExpirations.map((expiration) => {
      const rows = buildFallbackRows(normalized, currentPrice);
      const summary = summarizeExpiration(expiration, rows, currentPrice);

      return {
        expiration,
        rows,
        summary
      } satisfies ExpirationChain;
    });

    return {
      ticker: normalized,
      snapshotDate: asOfDate,
      chains: rankPrevailingChains(chains, currentPrice)
    };
  }
}

export function saveChainSnapshot(snapshot: ChainSnapshot): void {
  persistChainSnapshot(snapshot);
}

export function getSavedSnapshots(symbol: string): ChainSnapshot[] {
  return readSavedSnapshots(symbol.toUpperCase());
}

export function getSavedSnapshot(symbol: string, date: string): ChainSnapshot | undefined {
  return readSavedSnapshot(symbol.toUpperCase(), date);
}

export function getSavedChainSnapshots(symbol: string, expiration?: string): ChainSnapshotEntry[] {
  return readSavedChainSnapshots(symbol.toUpperCase(), expiration);
}

export function deleteChainSnapshots(symbol: string, expiration: string): number {
  return removeSavedChainSnapshots(symbol.toUpperCase(), expiration);
}

export function makeSnapshotKey(symbol: string, date: string, expiration: string): string {
  return buildSnapshotKey(symbol.toUpperCase(), date, expiration);
}