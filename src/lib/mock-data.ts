import { Candle } from "./types";

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/**
 * Local placeholder adapter for candlestick data.
 * Replace with real API integration later, but keep this function signature stable.
 */
export function getCandlesForTicker(ticker: string, length = 40): Candle[] {
  const rand = seededRandom(ticker.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) || 42);
  const candles: Candle[] = [];
  let lastClose = 100 + Math.floor(rand() * 120);

  for (let i = length; i > 0; i -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - i);

    const drift = (rand() - 0.48) * 3.5;
    const open = Math.max(1, lastClose + drift);
    const close = Math.max(1, open + (rand() - 0.5) * 5.5);
    const high = Math.max(open, close) + rand() * 2.2;
    const low = Math.max(0.5, Math.min(open, close) - rand() * 2.2);

    candles.push({
      time: date.toISOString().slice(0, 10),
      open,
      high,
      low,
      close
    });

    lastClose = close;
  }

  return candles;
}
