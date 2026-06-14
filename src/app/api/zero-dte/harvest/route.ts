import { NextRequest, NextResponse } from "next/server";
import { buildZeroDteRecommendation, ZeroDteChainRow } from "../../../../lib/zeroDteOiIntelligence";
import { buildZeroDteMoodRead, type ZeroDteMoodInput, type ZeroDteMoodRead } from "../../../../lib/zeroDteMoodEngine";
import { buildZeroDteTradeSelection, type ZeroDteTradeSelection } from "../../../../lib/zeroDteTradeSelector";

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

type YahooOptionBlock = {
  calls?: YahooContract[];
  puts?: YahooContract[];
};

type YahooOptionResult = {
  underlyingSymbol?: string;
  expirationDates?: number[];
  regularMarketPrice?: number;
  quote?: {
    regularMarketPrice?: number;
    marketPrice?: number;
    regularMarketPreviousClose?: number;
    previousClose?: number;
  };
  options?: YahooOptionBlock[];
};

type HarvestSymbolResult = {
  symbol: "SPX" | "SPY";
  yahooOptionSymbol: string;
  yahooQuoteSymbol: string;
  price: number;
  expirationTimestamp: number;
  expirationDate: string;
  isZeroDte: boolean;
  rows: ZeroDteChainRow[];
  source: "yahoo";
};

type QualityCheck = {
  label: string;
  status: "ok" | "warn" | "fail";
  message: string;
};

type HarvestResponse = {
  tradeDate: string;
  generatedAt: string;
  status: "ok" | "partial" | "error";
  spx?: HarvestSymbolResult;
  spy?: HarvestSymbolResult;
  recommendation?: ReturnType<typeof buildZeroDteRecommendation>;
  mood?: ZeroDteMoodRead;
  tradeSelection?: ZeroDteTradeSelection;
  errors: string[];
  qualityChecks: QualityCheck[];
};

const DEFAULT_SPX_QUOTE_SYMBOLS = "^GSPC,^SPX,SPX";
const DEFAULT_SPX_OPTION_SYMBOLS = "^SPX,SPX,^GSPC";
const DEFAULT_SPY_QUOTE_SYMBOLS = "SPY";
const DEFAULT_SPY_OPTION_SYMBOLS = "SPY";

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
  const manualMoodPercent = optionalNumberParam(req, "mood");
  // spreadWidth is retained for backward compatibility, but the selector now treats it as maxWidth, not a forced width.
  const legacySpreadWidth = optionalNumberParam(req, "spreadWidth");
  const maxWidth = optionalNumberParam(req, "maxWidth") ?? legacySpreadWidth ?? 40;
  const minWidth = optionalNumberParam(req, "minWidth") ?? 5;
  const maxRiskDollars = optionalNumberParam(req, "maxRisk");
  const minCredit = optionalNumberParam(req, "minCredit");
  const minCreditToRiskPct = percentParam(req, "minCreditToRiskPct");
  const riskMode = riskModeParam(req);
  const strictZeroDte = req.nextUrl.searchParams.get("strict") === "1";

  const errors: string[] = [];
  let spx: HarvestSymbolResult | undefined;
  let spy: HarvestSymbolResult | undefined;

  try {
    spx = await harvestSymbol({
      symbol: "SPX",
      quoteSymbols: envList("ZERO_DTE_SPX_QUOTE_SYMBOLS", DEFAULT_SPX_QUOTE_SYMBOLS),
      optionSymbols: envList("ZERO_DTE_SPX_OPTION_SYMBOLS", process.env.ZERO_DTE_SPX_OPTION_SYMBOL || DEFAULT_SPX_OPTION_SYMBOLS),
      tradeDate,
      rangePct,
      strictZeroDte,
    });
    if (!spx.isZeroDte) errors.push(`SPX using next listed expiration ${spx.expirationDate}; ${tradeDate} is not an available 0DTE session.`);
  } catch (error) {
    errors.push(`SPX harvest failed: ${message(error)}`);
  }

  try {
    spy = await harvestSymbol({
      symbol: "SPY",
      quoteSymbols: envList("ZERO_DTE_SPY_QUOTE_SYMBOLS", process.env.ZERO_DTE_SPY_QUOTE_SYMBOL || DEFAULT_SPY_QUOTE_SYMBOLS),
      optionSymbols: envList("ZERO_DTE_SPY_OPTION_SYMBOLS", process.env.ZERO_DTE_SPY_OPTION_SYMBOL || DEFAULT_SPY_OPTION_SYMBOLS),
      tradeDate,
      rangePct,
      strictZeroDte,
    });
    if (!spy.isZeroDte) errors.push(`SPY using next listed expiration ${spy.expirationDate}; ${tradeDate} is not an available 0DTE session.`);
  } catch (error) {
    errors.push(`SPY harvest failed: ${message(error)}`);
  }

  let recommendation: HarvestResponse["recommendation"] | undefined;
  let mood: ZeroDteMoodRead | undefined;
  let tradeSelection: ZeroDteTradeSelection | undefined;

  if (spx?.rows.length && spy?.rows.length) {
    recommendation = buildZeroDteRecommendation({
      spxPrice: spx.price,
      spyPrice: spy.price,
      spxRows: spx.rows,
      spyRows: spy.rows,
      manualExpectedMove: manualExpectedMove > 0 ? manualExpectedMove : null,
    });

    const moodInput = await buildMoodInput({
      req,
      generatedAt: now.toISOString(),
      spxPrice: spx.price,
      manualMoodPercent,
    }).catch((error) => {
      errors.push(`Mood harvest failed: ${message(error)}`);
      return { index: "SPX", manualMoodPercent, generatedAt: now.toISOString(), source: "unavailable" } satisfies ZeroDteMoodInput;
    });

    mood = buildZeroDteMoodRead(moodInput);
    tradeSelection = buildZeroDteTradeSelection({
      recommendation,
      spxRows: spx.rows,
      mood,
      spreadWidth: maxWidth,
      maxWidth,
      minWidth,
      maxRiskDollars,
      minCredit,
      minCreditToRiskPct,
      riskMode,
    });
  } else {
    if (!spx?.rows.length) errors.push("No SPX option rows available after range/filtering.");
    if (!spy?.rows.length) errors.push("No SPY option rows available after range/filtering.");
  }

  const qualityChecks = buildQualityChecks({
    tradeDate,
    spx,
    spy,
    recommendation,
    rangePct,
    manualExpectedMove,
  });

  const hasQualityFail = qualityChecks.some((check) => check.status === "fail");
  const hasQualityWarn = qualityChecks.some((check) => check.status === "warn");

  const status: HarvestResponse["status"] = recommendation
    ? hasQualityFail
      ? "error"
      : errors.length || hasQualityWarn
      ? "partial"
      : "ok"
    : "error";

  return json(
    {
      tradeDate,
      generatedAt: now.toISOString(),
      status,
      spx,
      spy,
      recommendation,
      mood,
      tradeSelection,
      errors,
      qualityChecks,
    } satisfies HarvestResponse,
    status === "error" ? 502 : 200
  );
}


function riskModeParam(req: NextRequest): "conservative" | "balanced" | "aggressive" {
  const raw = req.nextUrl.searchParams.get("riskMode");
  if (raw === "conservative" || raw === "balanced" || raw === "aggressive") return raw;
  return "balanced";
}

function percentParam(req: NextRequest, key: string) {
  const value = optionalNumberParam(req, key);
  if (value === null) return null;
  // UI may pass 8 for 8%, or 0.08. Normalize both to 0.08.
  return value > 1 ? value / 100 : value;
}
function buildQualityChecks(args: {
  tradeDate: string;
  spx?: HarvestSymbolResult;
  spy?: HarvestSymbolResult;
  recommendation?: ReturnType<typeof buildZeroDteRecommendation>;
  rangePct: number;
  manualExpectedMove: number;
}): QualityCheck[] {
  const checks: QualityCheck[] = [];
  const { tradeDate, spx, spy, recommendation } = args;

  if (spx?.isZeroDte && spy?.isZeroDte) {
    checks.push({ label: "Expiration", status: "ok", message: `Both chains match trade date ${tradeDate}.` });
  } else if (spx || spy) {
    checks.push({
      label: "Expiration",
      status: "warn",
      message: `Not a true same-day 0DTE harvest. SPX=${spx?.expirationDate ?? "none"}, SPY=${spy?.expirationDate ?? "none"}, tradeDate=${tradeDate}. Treat as preview only.`,
    });
  } else {
    checks.push({ label: "Expiration", status: "fail", message: "No usable option expiration was harvested." });
  }

  if (spx?.rows?.length) {
    checks.push({
      label: "SPX Rows",
      status: spx.rows.length >= 30 ? "ok" : "warn",
      message: `${spx.rows.length} SPX option rows inside ±${(args.rangePct * 100).toFixed(1)}% range.`,
    });
  } else {
    checks.push({ label: "SPX Rows", status: "fail", message: "No SPX rows available." });
  }

  if (spy?.rows?.length) {
    checks.push({
      label: "SPY Rows",
      status: spy.rows.length >= 30 ? "ok" : "warn",
      message: `${spy.rows.length} SPY option rows inside ±${(args.rangePct * 100).toFixed(1)}% range.`,
    });
  } else {
    checks.push({ label: "SPY Rows", status: "fail", message: "No SPY rows available." });
  }

  if (recommendation) {
    const ratio = recommendation.spxPrice / recommendation.spyPrice;
    checks.push({
      label: "SPX/SPY Ratio",
      status: ratio >= 8.5 && ratio <= 11.5 ? "ok" : "warn",
      message: `SPX/SPY conversion ratio is ${ratio.toFixed(3)}.`,
    });

    const emPct = recommendation.expectedMove / recommendation.spxPrice;
    checks.push({
      label: "Expected Move",
      status: recommendation.expectedMove > 0 && emPct <= 0.035 ? "ok" : recommendation.expectedMove > 0 ? "warn" : "fail",
      message: args.manualExpectedMove > 0
        ? `Manual expected move override used: ${recommendation.expectedMove.toFixed(2)} SPX points.`
        : `ATM straddle expected move estimate: ${recommendation.expectedMove.toFixed(2)} SPX points (${(emPct * 100).toFixed(2)}%).`,
    });

    checks.push({
      label: "SPY Weighting",
      status: "ok",
      message: `SPY OI/volume is reduced to ${(recommendation.spyNotionalWeight * 100).toFixed(1)}% SPX-contract-equivalent weight before composite scoring.`,
    });

    const centerDistance = Math.abs(recommendation.suggestedCenter - recommendation.spxPrice);
    checks.push({
      label: "Center Distance",
      status: centerDistance <= Math.max(recommendation.expectedMove * 0.45, 25) ? "ok" : "warn",
      message: `Suggested center is ${centerDistance.toFixed(1)} points from SPX spot.`,
    });
  } else {
    checks.push({ label: "Recommendation", status: "fail", message: "No recommendation could be calculated." });
  }

  checks.push({
    label: "Provider",
    status: "warn",
    message: "Yahoo data is a useful sanity feed but not broker-grade for live 0DTE execution. Validate ATM mids and OI against Thinkorswim/IBKR before placing trades.",
  });

  return checks;
}


async function buildMoodInput(args: {
  req: NextRequest;
  generatedAt: string;
  spxPrice: number;
  manualMoodPercent: number | null;
}): Promise<ZeroDteMoodInput> {
  const manualMoodPercent = args.manualMoodPercent;

  if (manualMoodPercent !== null) {
    return {
      index: "SPX",
      manualMoodPercent,
      generatedAt: args.generatedAt,
      source: "manual-tos-mood",
    };
  }

  const internalsFromQuery: Partial<ZeroDteMoodInput> = {
    tick: optionalNumberParam(args.req, "tick"),
    uvolDvolRatio: optionalNumberParam(args.req, "uvolDvolRatio"),
    advanceDecline: optionalNumberParam(args.req, "add"),
    highWeightTrend: optionalNumberParam(args.req, "highWeightTrend"),
    tickTrend: optionalNumberParam(args.req, "tickTrend"),
    uvolDvolTrend: optionalNumberParam(args.req, "uvolDvolTrend"),
    advanceDeclineTrend: optionalNumberParam(args.req, "addTrend"),
  };

  const highWeight = await fetchSpxHighWeightPull().catch(() => null);

  return {
    index: "SPX",
    manualMoodPercent: null,
    indexPctChange: highWeight?.indexPctChange ?? null,
    highWeightPullPct: highWeight?.highWeightPullPct ?? null,
    ...internalsFromQuery,
    generatedAt: args.generatedAt,
    source: highWeight ? "yahoo-high-weight-components" : "partial-query-internals",
  };
}

async function fetchSpxHighWeightPull(): Promise<{
  indexPctChange: number;
  highWeightPctChange: number;
  highWeightPullPct: number;
}> {
  const indexQuote = await fetchYahooDailyQuote("^GSPC");
  const components = [
    { symbol: "AAPL", weight: 6.32 },
    { symbol: "MSFT", weight: 6.71 },
    { symbol: "NVDA", weight: 6.57 },
    { symbol: "AMZN", weight: 3.85 },
    { symbol: "META", weight: 2.81 },
    { symbol: "TSLA", weight: 1.91 },
    { symbol: "GOOGL", weight: 1.9 },
    { symbol: "AVGO", weight: 2.17 },
    { symbol: "GOOG", weight: 1.56 },
    { symbol: "BRK-B", weight: 1.85 },
  ];

  const settled = await Promise.allSettled(
    components.map(async (component) => ({
      ...component,
      quote: await fetchYahooDailyQuote(component.symbol),
    }))
  );

  const usable = settled
    .filter((x): x is PromiseFulfilledResult<{ symbol: string; weight: number; quote: YahooDailyQuote }> => x.status === "fulfilled")
    .map((x) => x.value)
    .filter((x) => Number.isFinite(x.quote.pctChange));

  if (!usable.length) throw new Error("No usable high-weight component quotes were returned.");

  const weightSum = usable.reduce((sum, x) => sum + x.weight, 0);
  const highWeightPctChange = usable.reduce((sum, x) => sum + x.quote.pctChange * x.weight, 0) / weightSum;
  const indexPctChange = indexQuote.pctChange;

  return {
    indexPctChange,
    highWeightPctChange,
    highWeightPullPct: highWeightPctChange - indexPctChange,
  };
}

type YahooDailyQuote = {
  symbol: string;
  price: number;
  previousClose: number;
  pctChange: number;
};

async function fetchYahooDailyQuote(symbol: string): Promise<YahooDailyQuote> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
  const res = await fetch(url, yahooFetchInit());
  const text = await res.text();

  if (!res.ok) throw new Error(`Yahoo quote ${symbol} failed ${res.status}: ${text.slice(0, 240)}`);

  const data = JSON.parse(text);
  const result = data?.chart?.result?.[0];
  const meta = result?.meta;
  const quote = result?.indicators?.quote?.[0];
  const closes = Array.isArray(quote?.close)
    ? quote.close.filter((x: unknown) => typeof x === "number" && Number.isFinite(x))
    : [];

  const price = finite(meta?.regularMarketPrice) ?? closes.at(-1) ?? null;
  const previousClose = finite(meta?.previousClose) ?? (closes.length >= 2 ? closes.at(-2) ?? null : null);

  if (!price || !previousClose || previousClose <= 0) {
    throw new Error(`Yahoo quote ${symbol} returned no usable price/previous close.`);
  }

  return {
    symbol,
    price,
    previousClose,
    pctChange: ((price - previousClose) / previousClose) * 100,
  };
}

async function harvestSymbol(args: {
  symbol: "SPX" | "SPY";
  quoteSymbols: string[];
  optionSymbols: string[];
  tradeDate: string;
  rangePct: number;
  strictZeroDte: boolean;
}): Promise<HarvestSymbolResult> {
  const errors: string[] = [];

  for (const optionSymbol of args.optionSymbols) {
    try {
      const summary = await fetchYahooOptionResult(optionSymbol);
      const expirations = normalizeExpirationDates(summary.expirationDates);
      const expiration = chooseExpiration(expirations, args.tradeDate, !args.strictZeroDte);

      if (!expiration) {
        const available = expirations.slice(0, 8).map((x) => x.date).join(", ") || "none returned";
        throw new Error(
          args.strictZeroDte
            ? `No exact 0DTE expiration for ${optionSymbol} on ${args.tradeDate}. Available: ${available}`
            : `No same-day or future expiration for ${optionSymbol} on ${args.tradeDate}. Available: ${available}`
        );
      }

      const chainResult = await fetchYahooOptionResult(optionSymbol, expiration.timestamp);
      const block = chainResult.options?.[0];
      if (!block) throw new Error(`Yahoo returned no option block for ${optionSymbol} ${expiration.date}.`);

      const quotePrice = await fetchYahooPriceCandidates(args.quoteSymbols).catch(() => null);
      const chainPrice =
        finite(chainResult.quote?.regularMarketPrice) ??
        finite(chainResult.quote?.marketPrice) ??
        finite(chainResult.regularMarketPrice) ??
        finite(summary.quote?.regularMarketPrice) ??
        finite(summary.regularMarketPrice) ??
        quotePrice;

      if (!chainPrice || chainPrice <= 0) throw new Error(`No usable underlying price for ${optionSymbol}.`);

      const minStrike = chainPrice * (1 - args.rangePct);
      const maxStrike = chainPrice * (1 + args.rangePct);
      const yearsToExpiration = yearsUntilExpiration(expiration.date);

      const rows: ZeroDteChainRow[] = [
        ...(block.calls ?? []).map((c) => mapContract(args.symbol, "call", c, chainPrice, yearsToExpiration, expiration.date)),
        ...(block.puts ?? []).map((p) => mapContract(args.symbol, "put", p, chainPrice, yearsToExpiration, expiration.date)),
      ]
        .filter((row) => Number.isFinite(row.strike))
        .filter((row) => row.strike >= minStrike && row.strike <= maxStrike)
        .filter((row) =>
          (row.openInterest ?? 0) > 0 ||
          (row.volume ?? 0) > 0 ||
          (row.bid ?? 0) > 0 ||
          (row.ask ?? 0) > 0 ||
          (row.mid ?? 0) > 0
        )
        .sort((a, b) => a.strike - b.strike || a.optionType.localeCompare(b.optionType));

      if (!rows.length) {
        throw new Error(`No usable ${optionSymbol} strikes inside ±${(args.rangePct * 100).toFixed(1)}% of ${chainPrice.toFixed(2)}.`);
      }

      return {
        symbol: args.symbol,
        yahooOptionSymbol: optionSymbol,
        yahooQuoteSymbol: args.quoteSymbols[0] ?? optionSymbol,
        price: chainPrice,
        expirationTimestamp: expiration.timestamp,
        expirationDate: expiration.date,
        isZeroDte: expiration.date === args.tradeDate,
        rows,
        source: "yahoo",
      };
    } catch (error) {
      errors.push(`${optionSymbol}: ${message(error)}`);
    }
  }

  throw new Error(errors.join(" | "));
}

async function fetchYahooOptionResult(optionSymbol: string, expirationTimestamp?: number): Promise<YahooOptionResult> {
  const attempts: Array<() => Promise<YahooOptionResult>> = [
    () => fetchYahooOptionResultNoCrumb("query2", optionSymbol, expirationTimestamp),
    () => fetchYahooOptionResultNoCrumb("query1", optionSymbol, expirationTimestamp),
    () => fetchYahooOptionResultWithCrumb("query2", optionSymbol, expirationTimestamp),
    () => fetchYahooOptionResultWithCrumb("query1", optionSymbol, expirationTimestamp),
  ];

  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      const result = await attempt();
      if (result) return result;
    } catch (error) {
      errors.push(message(error));
    }
  }

  throw new Error(errors.join(" | "));
}

async function fetchYahooOptionResultNoCrumb(host: "query1" | "query2", optionSymbol: string, expirationTimestamp?: number): Promise<YahooOptionResult> {
  const params = new URLSearchParams();
  if (expirationTimestamp) params.set("date", String(expirationTimestamp));

  const url = `https://${host}.finance.yahoo.com/v7/finance/options/${encodeURIComponent(optionSymbol)}${params.toString() ? `?${params.toString()}` : ""}`;
  return parseYahooOptionResponse(url, await fetch(url, yahooFetchInit()));
}

async function fetchYahooOptionResultWithCrumb(host: "query1" | "query2", optionSymbol: string, expirationTimestamp?: number): Promise<YahooOptionResult> {
  const { crumb, cookie } = await getYahooCrumbAndCookie();
  const params = new URLSearchParams({ crumb });
  if (expirationTimestamp) params.set("date", String(expirationTimestamp));

  const url = `https://${host}.finance.yahoo.com/v7/finance/options/${encodeURIComponent(optionSymbol)}?${params.toString()}`;
  return parseYahooOptionResponse(url, await fetch(url, yahooFetchInit(cookie)));
}

async function parseYahooOptionResponse(url: string, res: Response): Promise<YahooOptionResult> {
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`${url} failed ${res.status}: ${text.slice(0, 220)}`);
  }

  const data = JSON.parse(text);
  const error = data?.optionChain?.error;
  if (error) throw new Error(`${url}: ${JSON.stringify(error)}`);

  const result = data?.optionChain?.result?.[0];
  if (!result) throw new Error(`${url}: no optionChain.result[0]`);

  return result as YahooOptionResult;
}

async function fetchYahooPriceCandidates(symbols: string[]): Promise<number> {
  const errors: string[] = [];
  for (const symbol of symbols) {
    try {
      return await fetchYahooPrice(symbol);
    } catch (error) {
      errors.push(`${symbol}: ${message(error)}`);
    }
  }
  throw new Error(errors.join(" | "));
}

async function fetchYahooPrice(symbol: string): Promise<number> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
  const res = await fetch(url, yahooFetchInit());

  const text = await res.text();
  if (!res.ok) throw new Error(`Yahoo quote ${symbol} failed ${res.status}: ${text.slice(0, 240)}`);

  const data = JSON.parse(text);
  const result = data?.chart?.result?.[0];
  const meta = result?.meta;
  const quote = result?.indicators?.quote?.[0];
  const closes = Array.isArray(quote?.close)
    ? quote.close.filter((x: unknown) => typeof x === "number" && Number.isFinite(x))
    : [];

  const price = finite(meta?.regularMarketPrice) ?? finite(meta?.previousClose) ?? closes.at(-1) ?? null;
  if (!price || price <= 0) throw new Error(`Yahoo quote ${symbol} returned no price.`);
  return Number(price);
}

async function getYahooCrumbAndCookie() {
  const cookieRes = await fetch("https://fc.yahoo.com", yahooFetchInit());
  const cookie = cookieHeaderFromSetCookie(cookieRes.headers.get("set-cookie"));

  const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", yahooFetchInit(cookie));
  if (!crumbRes.ok) throw new Error(`Yahoo crumb failed: ${crumbRes.status}`);

  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.includes("<")) throw new Error("Yahoo crumb response was not usable.");

  return { crumb, cookie };
}

function mapContract(
  symbol: "SPX" | "SPY",
  optionType: "call" | "put",
  contract: YahooContract,
  spot: number,
  yearsToExpiration: number,
  expirationDate: string
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
    expiration: expirationDate,
    openInterest: cleanNumber(contract.openInterest),
    volume: cleanNumber(contract.volume),
    iv,
    delta: greek?.delta ?? null,
    gamma: greek?.gamma ?? null,
    theta: greek?.theta ?? null,
    bid,
    ask,
    mid,
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
    delta: Number.isFinite(delta) ? delta : null,
    gamma: Number.isFinite(gamma) ? gamma : null,
    theta: Number.isFinite(thetaCall) && Number.isFinite(thetaPut) ? (args.optionType === "call" ? thetaCall : thetaPut) : null,
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
  // 4 PM New York proxy. This is only for ranking gamma when Yahoo does not return greeks.
  const expiry = new Date(`${tradeDate}T21:00:00.000Z`).getTime();
  const now = Date.now();
  const ms = Math.max(expiry - now, 60 * 60 * 1000);
  return ms / (365 * 24 * 60 * 60 * 1000);
}

function chooseExpiration(
  expirations: Array<{ timestamp: number; date: string }>,
  tradeDate: string,
  allowNext: boolean
): { timestamp: number; date: string } | null {
  const exact = expirations.find((x) => x.date === tradeDate);
  if (exact) return exact;
  if (!allowNext) return null;
  return expirations.find((x) => x.date > tradeDate) ?? null;
}

function normalizeExpirationDates(values: unknown): Array<{ timestamp: number; date: string }> {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .map((timestamp) => ({ timestamp, date: timestampToDateString(timestamp) }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function envList(key: string, fallback: string) {
  return (process.env[key] || fallback)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function yahooFetchInit(cookie?: string): RequestInit {
  return {
    cache: "no-store",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
      Accept: "application/json,text/plain,*/*",
      ...(cookie ? { Cookie: cookie } : {}),
    },
  };
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
    .split(/,(?=\s*[^;=]+=)/g)
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

function optionalNumberParam(req: NextRequest, key: string): number | null {
  const raw = req.nextUrl.searchParams.get(key);
  if (raw === null || raw.trim() === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
