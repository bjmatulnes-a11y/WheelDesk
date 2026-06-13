import { NextRequest, NextResponse } from "next/server";
import { buildZeroDteRecommendation, ZeroDteChainRow } from "../../../../lib/zeroDteOiIntelligence";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type YahooContract = {
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

type HarvestSymbolResult = {
  symbol: "SPX" | "SPY";
  yahooOptionSymbol: string;
  yahooQuoteSymbol: string;
  price: number;
  expirationTimestamp: number;
  expirationDate: string;
  rows: ZeroDteChainRow[];
  source: "yahoo";
  error?: string;
};

type HarvestResponse = {
  tradeDate: string;
  generatedAt: string;
  status: "ok" | "partial" | "error";
  spx?: HarvestSymbolResult;
  spy?: HarvestSymbolResult;
  recommendation?: ReturnType<typeof buildZeroDteRecommendation>;
  errors: string[];
};

const SPX_QUOTE_SYMBOL = process.env.ZERO_DTE_SPX_QUOTE_SYMBOL ?? "^GSPC";
const SPX_OPTION_SYMBOL = process.env.ZERO_DTE_SPX_OPTION_SYMBOL ?? "^SPX";
const SPY_QUOTE_SYMBOL = process.env.ZERO_DTE_SPY_QUOTE_SYMBOL ?? "SPY";
const SPY_OPTION_SYMBOL = process.env.ZERO_DTE_SPY_OPTION_SYMBOL ?? "SPY";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}

export async function GET(req: NextRequest) {
  const now = new Date();
  const tradeDate = req.nextUrl.searchParams.get("date") ?? nyDateString(now);
  const rangePct = numberParam(req, "rangePct", 0.045);
  const manualExpectedMove = numberParam(req, "expectedMove", 0);

  const errors: string[] = [];
  let spx: HarvestSymbolResult | undefined;
  let spy: HarvestSymbolResult | undefined;

  try {
    spx = await harvestSymbol({
      symbol: "SPX",
      quoteSymbol: SPX_QUOTE_SYMBOL,
      optionSymbol: SPX_OPTION_SYMBOL,
      tradeDate,
      rangePct,
    });
  } catch (error) {
    errors.push(`SPX harvest failed: ${message(error)}`);
  }

  try {
    spy = await harvestSymbol({
      symbol: "SPY",
      quoteSymbol: SPY_QUOTE_SYMBOL,
      optionSymbol: SPY_OPTION_SYMBOL,
      tradeDate,
      rangePct,
    });
  } catch (error) {
    errors.push(`SPY harvest failed: ${message(error)}`);
  }

  let recommendation: HarvestResponse["recommendation"] | undefined;

  if (spx?.rows.length && spy?.rows.length) {
    recommendation = buildZeroDteRecommendation({
      spxPrice: spx.price,
      spyPrice: spy.price,
      spxRows: spx.rows,
      spyRows: spy.rows,
      manualExpectedMove: manualExpectedMove > 0 ? manualExpectedMove : null,
    });
  } else {
    if (!spx?.rows.length) errors.push("No SPX 0DTE rows available.");
    if (!spy?.rows.length) errors.push("No SPY 0DTE rows available.");
  }

  const status: HarvestResponse["status"] = recommendation
    ? errors.length
      ? "partial"
      : "ok"
    : "error";

  return json({
    tradeDate,
    generatedAt: now.toISOString(),
    status,
    spx,
    spy,
    recommendation,
    errors,
  } satisfies HarvestResponse, status === "error" ? 502 : 200);
}

async function harvestSymbol(args: {
  symbol: "SPX" | "SPY";
  quoteSymbol: string;
  optionSymbol: string;
  tradeDate: string;
  rangePct: number;
}): Promise<HarvestSymbolResult> {
  const price = await fetchYahooPrice(args.quoteSymbol);
  const expirationTimestamp = await getZeroDteExpiration(args.optionSymbol, args.tradeDate);
  const chain = await fetchYahooOptionChain(args.optionSymbol, expirationTimestamp);
  const expirationDate = timestampToDateString(expirationTimestamp);

  const calls = Array.isArray(chain?.calls) ? chain.calls : [];
  const puts = Array.isArray(chain?.puts) ? chain.puts : [];
  const minStrike = price * (1 - args.rangePct);
  const maxStrike = price * (1 + args.rangePct);
  const yearsToExpiration = yearsUntilExpiration(args.tradeDate);

  const rows: ZeroDteChainRow[] = [
    ...calls.map((c: YahooContract) => mapContract(args.symbol, "call", c, price, yearsToExpiration)),
    ...puts.map((p: YahooContract) => mapContract(args.symbol, "put", p, price, yearsToExpiration)),
  ]
    .filter((row) => Number.isFinite(row.strike))
    .filter((row) => row.strike >= minStrike && row.strike <= maxStrike)
    .filter((row) => (row.openInterest ?? 0) > 0 || (row.volume ?? 0) > 0 || (row.bid ?? 0) > 0 || (row.ask ?? 0) > 0)
    .sort((a, b) => a.strike - b.strike || a.optionType.localeCompare(b.optionType));

  return {
    symbol: args.symbol,
    yahooOptionSymbol: args.optionSymbol,
    yahooQuoteSymbol: args.quoteSymbol,
    price,
    expirationTimestamp,
    expirationDate,
    rows,
    source: "yahoo",
  };
}

async function fetchYahooPrice(symbol: string): Promise<number> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Yahoo quote ${symbol} failed ${res.status}: ${text.slice(0, 240)}`);

  const data = JSON.parse(text);
  const result = data?.chart?.result?.[0];
  const meta = result?.meta;
  const quote = result?.indicators?.quote?.[0];
  const closes = Array.isArray(quote?.close)
    ? quote.close.filter((x: unknown) => typeof x === "number" && Number.isFinite(x))
    : [];

  const price = finite(meta?.regularMarketPrice) ? meta.regularMarketPrice : closes.at(-1);
  if (!finite(price)) throw new Error(`Yahoo quote ${symbol} returned no price.`);
  return Number(price);
}

async function getZeroDteExpiration(optionSymbol: string, tradeDate: string): Promise<number> {
  const summary = await fetchYahooOptions(optionSymbol);
  const expirations: number[] = Array.isArray(summary?.expirationDates) ? summary.expirationDates : [];

  const exact = expirations.find((ts) => timestampToDateString(ts) === tradeDate);
  if (exact) return exact;

  const upcoming = expirations.find((ts) => timestampToDateString(ts) > tradeDate);
  if (upcoming) {
    throw new Error(
      `No 0DTE expiration for ${optionSymbol} on ${tradeDate}. Next listed expiration is ${timestampToDateString(upcoming)}.`
    );
  }

  throw new Error(`No expirations returned for ${optionSymbol}.`);
}

async function fetchYahooOptionChain(optionSymbol: string, expirationTimestamp: number) {
  const data = await fetchYahooOptions(optionSymbol, expirationTimestamp);
  const result = data?.optionChain?.result?.[0];
  const block = result?.options?.[0];

  if (!block) throw new Error(`Yahoo options ${optionSymbol} returned no chain block.`);

  return {
    calls: block.calls ?? [],
    puts: block.puts ?? [],
  };
}

async function fetchYahooOptions(optionSymbol: string, expirationTimestamp?: number) {
  const { crumb, cookie } = await getYahooCrumbAndCookie();
  const params = new URLSearchParams();
  params.set("crumb", crumb);
  if (expirationTimestamp) params.set("date", String(expirationTimestamp));

  const url = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(optionSymbol)}?${params.toString()}`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json,text/plain,*/*",
      Cookie: cookie,
    },
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Yahoo options ${optionSymbol} failed ${res.status}: ${text.slice(0, 400)}`);

  const data = JSON.parse(text);
  const error = data?.optionChain?.error;
  if (error) throw new Error(`Yahoo options ${optionSymbol}: ${JSON.stringify(error)}`);

  return data;
}

async function getYahooCrumbAndCookie() {
  const cookieRes = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "*/*" },
    cache: "no-store",
  });

  const cookie = cookieHeaderFromSetCookie(cookieRes.headers.get("set-cookie"));
  const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": "Mozilla/5.0", Cookie: cookie },
    cache: "no-store",
  });

  if (!crumbRes.ok) throw new Error(`Yahoo crumb failed: ${crumbRes.status}`);

  return { crumb: await crumbRes.text(), cookie };
}

function mapContract(
  symbol: "SPX" | "SPY",
  optionType: "call" | "put",
  contract: YahooContract,
  spot: number,
  yearsToExpiration: number
): ZeroDteChainRow {
  const strike = numberOrZero(contract.strike);
  const bid = cleanNumber(contract.bid);
  const ask = cleanNumber(contract.ask);
  const last = cleanNumber(contract.lastPrice);
  const mid = bid && ask ? (bid + ask) / 2 : last ?? null;
  const iv = cleanNumber(contract.impliedVolatility);
  const greek = iv && strike > 0 ? blackScholesGreeks({ spot, strike, iv, years: yearsToExpiration, optionType }) : null;

  return {
    symbol,
    strike,
    optionType,
    expiration: contract.expiration ? timestampToDateString(contract.expiration) : null,
    openInterest: cleanNumber(contract.openInterest),
    volume: cleanNumber(contract.volume),
    iv,
    delta: greek?.delta ?? null,
    gamma: greek?.gamma ?? null,
    theta: greek?.theta ?? null,
    bid,
    ask,
    mid,
    last,
  };
}

function blackScholesGreeks(args: {
  spot: number;
  strike: number;
  iv: number;
  years: number;
  optionType: "call" | "put";
}) {
  const S = args.spot;
  const K = args.strike;
  const sigma = args.iv;
  const T = Math.max(args.years, 1 / (365 * 24));
  const r = 0.045;

  if (S <= 0 || K <= 0 || sigma <= 0 || !Number.isFinite(sigma)) return null;

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const pdf = normalPdf(d1);

  const delta = args.optionType === "call" ? normalCdf(d1) : normalCdf(d1) - 1;
  const gamma = pdf / (S * sigma * sqrtT);
  const thetaCall = (-(S * pdf * sigma) / (2 * sqrtT) - r * K * Math.exp(-r * T) * normalCdf(d2)) / 365;
  const thetaPut = (-(S * pdf * sigma) / (2 * sqrtT) + r * K * Math.exp(-r * T) * normalCdf(-d2)) / 365;

  return {
    delta,
    gamma,
    theta: args.optionType === "call" ? thetaCall : thetaPut,
  };
}

function normalPdf(x: number) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function normalCdf(x: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (x > 0) p = 1 - p;
  return p;
}

function yearsUntilExpiration(tradeDate: string) {
  // 0DTE: use market close New York time as expiry proxy.
  const expiry = new Date(`${tradeDate}T16:00:00-04:00`).getTime();
  const now = Date.now();
  const ms = Math.max(expiry - now, 60 * 60 * 1000);
  return ms / (365 * 24 * 60 * 60 * 1000);
}

function nyDateString(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function timestampToDateString(ts: number) {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function cookieHeaderFromSetCookie(setCookie: string | null) {
  if (!setCookie) return "";
  return setCookie
    .split(",")
    .map((part) => part.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function numberParam(req: NextRequest, key: string, fallback: number) {
  const raw = req.nextUrl.searchParams.get(key);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
