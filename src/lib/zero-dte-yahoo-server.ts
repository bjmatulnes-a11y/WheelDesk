import type { ZeroDteChainRow, ZeroDteSide } from "./zero-dte-lab-engine";

export type YahooHarvestSymbolResult = {
  requestedSymbol: "SPX" | "SPY";
  providerSymbol: string;
  quoteSymbol: string;
  price: number;
  expirationDate: string;
  expirationTimestamp: number;
  targetDate: string;
  isZeroDte: boolean;
  rows: ZeroDteChainRow[];
  rawExpirationDates: Array<{ timestamp: number; date: string }>;
};

export type YahooHarvestOptions = {
  targetDate?: string;
  allowNextExpiration?: boolean;
  spxRange?: number;
  spyRange?: number;
};

type YahooOptionContract = {
  contractSymbol?: string;
  strike?: number;
  expiration?: number;
  impliedVolatility?: number;
  openInterest?: number;
  volume?: number;
  bid?: number;
  ask?: number;
  lastPrice?: number;
};

type YahooOptionBlock = {
  calls?: YahooOptionContract[];
  puts?: YahooOptionContract[];
};

type YahooOptionResult = {
  underlyingSymbol?: string;
  expirationDates?: number[];
  regularMarketPrice?: number;
  quote?: { regularMarketPrice?: number; marketPrice?: number; regularMarketPreviousClose?: number };
  options?: YahooOptionBlock[];
};

function cookieHeaderFromSetCookie(setCookie: string | null): string {
  if (!setCookie) return "";
  return setCookie
    .split(/,(?=\s*[^;=]+=)/g)
    .map((part) => part.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function getYahooCrumbAndCookie() {
  const cookieRes = await fetch("https://fc.yahoo.com", {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "*/*",
    },
    cache: "no-store",
  });

  const cookie = cookieHeaderFromSetCookie(cookieRes.headers.get("set-cookie"));

  const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Cookie: cookie,
    },
    cache: "no-store",
  });

  if (!crumbRes.ok) {
    throw new Error(`Yahoo crumb failed: ${crumbRes.status}`);
  }

  const crumb = await crumbRes.text();
  return { crumb, cookie };
}

async function fetchYahooOptions(symbol: string, date?: number): Promise<YahooOptionResult> {
  const { crumb, cookie } = await getYahooCrumbAndCookie();
  const params = new URLSearchParams({ crumb });
  if (date) params.set("date", String(date));

  const url = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json,text/plain,*/*",
      Cookie: cookie,
    },
    cache: "no-store",
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Yahoo options failed for ${symbol}: ${res.status} ${text.slice(0, 250)}`);
  }

  const json = JSON.parse(text);
  const result = json?.optionChain?.result?.[0];
  const error = json?.optionChain?.error;

  if (!result || error) {
    throw new Error(`Yahoo returned no option chain for ${symbol}${error ? `: ${JSON.stringify(error)}` : ""}`);
  }

  return result as YahooOptionResult;
}

async function fetchYahooQuote(symbol: string): Promise<number> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`Yahoo quote failed for ${symbol}: ${res.status}`);

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  const meta = result?.meta;
  const quote = result?.indicators?.quote?.[0];
  const closes: number[] = Array.isArray(quote?.close)
    ? quote.close.filter((value: unknown) => typeof value === "number" && Number.isFinite(value))
    : [];

  const price =
    finite(meta?.regularMarketPrice) ??
    finite(meta?.previousClose) ??
    closes.at(-1) ??
    null;

  if (!price || price <= 0) throw new Error(`Yahoo quote had no usable price for ${symbol}`);
  return price;
}

export async function harvestZeroDteFromYahoo(options: YahooHarvestOptions = {}) {
  const targetDate = options.targetDate || currentEasternDate();

  const spxCandidates = (process.env.ZERO_DTE_SPX_SYMBOLS || "^SPX,SPX")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const spx = await tryHarvestCandidates({
    requestedSymbol: "SPX",
    quoteCandidates: ["^SPX", "SPX"],
    optionCandidates: spxCandidates,
    targetDate,
    allowNextExpiration: options.allowNextExpiration ?? true,
    range: options.spxRange ?? 250,
  });

  const spy = await tryHarvestCandidates({
    requestedSymbol: "SPY",
    quoteCandidates: ["SPY"],
    optionCandidates: ["SPY"],
    targetDate,
    allowNextExpiration: options.allowNextExpiration ?? true,
    range: options.spyRange ?? 25,
  });

  return { targetDate, spx, spy };
}

async function tryHarvestCandidates(args: {
  requestedSymbol: "SPX" | "SPY";
  quoteCandidates: string[];
  optionCandidates: string[];
  targetDate: string;
  allowNextExpiration: boolean;
  range: number;
}): Promise<YahooHarvestSymbolResult> {
  const errors: string[] = [];

  for (const providerSymbol of args.optionCandidates) {
    try {
      const first = await fetchYahooOptions(providerSymbol);
      const expirations = normalizeExpirationDates(first.expirationDates);
      const chosen = chooseExpiration(expirations, args.targetDate, args.allowNextExpiration);

      if (!chosen) {
        throw new Error(`No ${args.allowNextExpiration ? "same-day or future" : "same-day"} expiration found for ${args.targetDate}`);
      }

      const chain = await fetchYahooOptions(providerSymbol, chosen.timestamp);
      const quoteSymbol = args.quoteCandidates[0] ?? providerSymbol;
      const price = finite(chain.quote?.regularMarketPrice) ?? finite(chain.regularMarketPrice) ?? (await fetchQuoteCandidates(args.quoteCandidates));
      const block = chain.options?.[0];

      if (!block) throw new Error(`Yahoo returned no option block for ${providerSymbol} ${chosen.date}`);

      const rows = optionBlockToRows({
        requestedSymbol: args.requestedSymbol,
        providerSymbol,
        expirationDate: chosen.date,
        price,
        range: args.range,
        block,
      });

      if (!rows.length) {
        throw new Error(`No usable strikes inside ±${args.range} for ${providerSymbol} ${chosen.date}`);
      }

      return {
        requestedSymbol: args.requestedSymbol,
        providerSymbol,
        quoteSymbol,
        price,
        expirationDate: chosen.date,
        expirationTimestamp: chosen.timestamp,
        targetDate: args.targetDate,
        isZeroDte: chosen.date === args.targetDate,
        rows,
        rawExpirationDates: expirations,
      };
    } catch (error) {
      errors.push(`${providerSymbol}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Unable to harvest ${args.requestedSymbol}. ${errors.join(" | ")}`);
}

async function fetchQuoteCandidates(symbols: string[]): Promise<number> {
  const errors: string[] = [];
  for (const symbol of symbols) {
    try {
      return await fetchYahooQuote(symbol);
    } catch (error) {
      errors.push(`${symbol}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`No usable quote. ${errors.join(" | ")}`);
}

function optionBlockToRows(args: {
  requestedSymbol: "SPX" | "SPY";
  providerSymbol: string;
  expirationDate: string;
  price: number;
  range: number;
  block: YahooOptionBlock;
}): ZeroDteChainRow[] {
  const rows: ZeroDteChainRow[] = [];
  const notionalWeight = 1;

  for (const contract of args.block.calls ?? []) {
    const row = contractToRow(contract, "call", args, notionalWeight);
    if (row) rows.push(row);
  }

  for (const contract of args.block.puts ?? []) {
    const row = contractToRow(contract, "put", args, notionalWeight);
    if (row) rows.push(row);
  }

  return rows.sort((a, b) => a.strike - b.strike || a.optionType.localeCompare(b.optionType));
}

function contractToRow(
  contract: YahooOptionContract,
  side: ZeroDteSide,
  args: {
    requestedSymbol: "SPX" | "SPY";
    providerSymbol: string;
    expirationDate: string;
    price: number;
    range: number;
  },
  notionalWeight: number
): ZeroDteChainRow | null {
  const strike = finite(contract.strike);
  if (!strike || Math.abs(strike - args.price) > args.range) return null;

  const bid = finite(contract.bid);
  const ask = finite(contract.ask);
  const last = finite(contract.lastPrice);
  const mid = bid && ask ? (bid + ask) / 2 : last ?? null;
  const iv = finite(contract.impliedVolatility);
  const t = timeToExpirationYears(args.expirationDate);
  const greeks = iv ? blackScholesGreeks({ side, s: args.price, k: strike, t, sigma: iv, r: 0 }) : { delta: null, gamma: null };

  return {
    sourceSymbol: args.requestedSymbol,
    providerSymbol: args.providerSymbol,
    expiration: args.expirationDate,
    strike,
    optionType: side,
    openInterest: Math.max(0, finite(contract.openInterest) ?? 0),
    volume: Math.max(0, finite(contract.volume) ?? 0),
    iv,
    delta: greeks.delta,
    gamma: greeks.gamma,
    bid,
    ask,
    last,
    mid,
    contractSymbol: contract.contractSymbol ?? null,
    underlyingPrice: args.price,
    notionalWeight,
  };
}

function normalizeExpirationDates(values: unknown): Array<{ timestamp: number; date: string }> {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .map((timestamp) => ({ timestamp, date: timestampToDateString(timestamp) }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function chooseExpiration(
  expirations: Array<{ timestamp: number; date: string }>,
  targetDate: string,
  allowNext: boolean
): { timestamp: number; date: string } | null {
  const exact = expirations.find((expiration) => expiration.date === targetDate);
  if (exact) return exact;
  if (!allowNext) return null;
  return expirations.find((expiration) => expiration.date > targetDate) ?? null;
}

function timestampToDateString(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function currentEasternDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) return new Date().toISOString().slice(0, 10);
  return `${year}-${month}-${day}`;
}

function timeToExpirationYears(expirationDate: string): number {
  // Conservative 4 PM ET approximation. The exact minute is not critical for
  // ranking strikes; it only gives us a non-fake gamma estimate when Yahoo does
  // not provide Greeks.
  const expirationUtc = new Date(`${expirationDate}T21:00:00.000Z`).getTime();
  const minutes = Math.max(1, (expirationUtc - Date.now()) / 60000);
  return minutes / (365 * 24 * 60);
}

function blackScholesGreeks(args: {
  side: ZeroDteSide;
  s: number;
  k: number;
  t: number;
  sigma: number;
  r: number;
}): { delta: number | null; gamma: number | null } {
  const { side, s, k, t, sigma, r } = args;
  if (s <= 0 || k <= 0 || t <= 0 || sigma <= 0) return { delta: null, gamma: null };

  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(s / k) + (r + 0.5 * sigma * sigma) * t) / (sigma * sqrtT);
  const pdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  const gamma = pdf / (s * sigma * sqrtT);
  const nd1 = normalCdf(d1);
  const delta = side === "call" ? nd1 : nd1 - 1;

  return {
    delta: Number.isFinite(delta) ? delta : null,
    gamma: Number.isFinite(gamma) ? gamma : null,
  };
}

function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
