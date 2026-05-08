import {
  Candle,
  MarketDataProvider,
  OptionChain,
  UnderlyingQuote
} from "./market-data-provider";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });

  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

export class YahooProvider implements MarketDataProvider {
  async getQuote(symbol: string): Promise<UnderlyingQuote> {
    return fetchJson<UnderlyingQuote>(
      `/api/yahoo/quote?symbol=${encodeURIComponent(symbol)}`
    );
  }

  async getCandles(symbol: string, range = "1mo", interval = "1d"): Promise<Candle[]> {
    return fetchJson<Candle[]>(
      `/api/yahoo/candles?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(
        range
      )}&interval=${encodeURIComponent(interval)}`
    );
  }

  async getOptionExpirations(symbol: string): Promise<number[]> {
    const data = await fetchJson<{ expirations: number[] }>(
      `/api/yahoo/options?symbol=${encodeURIComponent(symbol)}`
    );

    return data.expirations ?? [];
  }

  async getOptionChain(symbol: string, expirationTimestamp?: number): Promise<OptionChain> {
    const url = expirationTimestamp
      ? `/api/yahoo/options?symbol=${encodeURIComponent(symbol)}&date=${expirationTimestamp}`
      : `/api/yahoo/options?symbol=${encodeURIComponent(symbol)}`;

    return fetchJson<OptionChain>(url);
  }
}

export const yahooProvider = new YahooProvider();