import { Candle, ChainSnapshot, Timeframe } from "./types";

const CACHE_PREFIX = "tradingOperator.dashboard";
const CANDLE_TTL_MS = 15 * 60 * 1000;

function todayLocalKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function nextLocalMidnightMs(): number {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function candleKey(ticker: string, timeframe: Timeframe): string {
  return `${CACHE_PREFIX}.candles.${ticker.toUpperCase()}.${timeframe}`;
}

function chainKey(ticker: string, snapshotDate: string): string {
  return `${CACHE_PREFIX}.chain.${ticker.toUpperCase()}.${snapshotDate}`;
}

type CandleCache = {
  ticker: string;
  timeframe: Timeframe;
  fetchedAt: number;
  candles: Candle[];
};

type ChainCache = {
  ticker: string;
  snapshotDate: string;
  fetchedAt: number;
  expiresAt: number;
  snapshot: ChainSnapshot;
};

export function saveCachedCandles(ticker: string, timeframe: Timeframe, candles: Candle[]): void {
  if (typeof window === "undefined") return;

  const payload: CandleCache = {
    ticker: ticker.toUpperCase(),
    timeframe,
    fetchedAt: Date.now(),
    candles
  };

  window.localStorage.setItem(candleKey(ticker, timeframe), JSON.stringify(payload));
}

export function loadCachedCandles(ticker: string, timeframe: Timeframe): Candle[] | null {
  if (typeof window === "undefined") return null;

  const cached = safeParse<CandleCache>(window.localStorage.getItem(candleKey(ticker, timeframe)));
  if (!cached) return null;
  if (cached.ticker !== ticker.toUpperCase()) return null;
  if (cached.timeframe !== timeframe) return null;
  if (Date.now() - cached.fetchedAt > CANDLE_TTL_MS) return null;
  if (!Array.isArray(cached.candles) || cached.candles.length === 0) return null;

  return cached.candles;
}

export function saveCachedOptionChain(snapshot: ChainSnapshot): void {
  if (typeof window === "undefined") return;

  const payload: ChainCache = {
    ticker: snapshot.ticker.toUpperCase(),
    snapshotDate: snapshot.snapshotDate,
    fetchedAt: Date.now(),
    expiresAt: nextLocalMidnightMs(),
    snapshot
  };

  window.localStorage.setItem(chainKey(snapshot.ticker, snapshot.snapshotDate), JSON.stringify(payload));
}

export function loadCachedOptionChain(ticker: string, snapshotDate: string): ChainSnapshot | null {
  if (typeof window === "undefined") return null;

  const cached = safeParse<ChainCache>(window.localStorage.getItem(chainKey(ticker, snapshotDate)));
  if (!cached) return null;
  if (cached.ticker !== ticker.toUpperCase()) return null;
  if (cached.snapshotDate !== snapshotDate) return null;
  if (cached.expiresAt < Date.now()) return null;
  if (cached.snapshot.snapshotDate !== snapshotDate) return null;

  return cached.snapshot;
}

export function clearExpiredDashboardCache(): void {
  if (typeof window === "undefined") return;

  const today = todayLocalKey();

  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith(CACHE_PREFIX)) continue;

    const raw = safeParse<any>(window.localStorage.getItem(key));
    if (!raw) {
      window.localStorage.removeItem(key);
      continue;
    }

    if ("expiresAt" in raw && raw.expiresAt < Date.now()) {
      window.localStorage.removeItem(key);
    }

    if ("snapshotDate" in raw && raw.snapshotDate < today && "expiresAt" in raw && raw.expiresAt < Date.now()) {
      window.localStorage.removeItem(key);
    }

    if ("fetchedAt" in raw && key.includes(".candles.") && Date.now() - raw.fetchedAt > CANDLE_TTL_MS) {
      window.localStorage.removeItem(key);
    }
  }
}