import { fetchSchwabQuotes } from "./schwab/client";
import type {
  SchwabQuoteInstrument,
  SchwabQuotesResponse,
} from "./schwab/types";
import { getDailySp500BreadthUniverse } from "./zeroDteLeadershipWeights";

export type ZeroDteBreadthSnapshot = {
  generatedAt: string;
  source:
    | "REQUEST"
    | "EXTERNAL_ADAPTER"
    | "SCHWAB_CONFIGURED_SYMBOLS"
    | "SCHWAB_SPX_UNIVERSE"
    | "UNAVAILABLE";
  tick: number | null;
  uvol: number | null;
  dvol: number | null;
  uvolDvolRatio: number | null;
  advanceDecline: number | null;
  coverage: "FULL" | "PARTIAL" | "UNAVAILABLE";
  symbols: {
    tick: string;
    uvol: string;
    dvol: string;
    advanceDecline: string;
  };
  universeCount: number | null;
  quotedCount: number | null;
  quoteCoveragePct: number | null;
  volumeCoveragePct: number | null;
  tickCoveragePct: number | null;
  advances: number | null;
  declines: number | null;
  unchanged: number | null;
  warnings: string[];
};

const TOS_REFERENCE = {
  tick: "$TIKSP",
  uvol: "$UVOLSP",
  dvol: "$DVOLSP",
  advanceDecline: "$ADSPD",
};

const SCHWAB_NATIVE_REFERENCE = {
  tick: "SCHWAB SPX 1M TICK PROXY",
  uvol: "SCHWAB SPX ADVANCING VOLUME",
  dvol: "SCHWAB SPX DECLINING VOLUME",
  advanceDecline: "SCHWAB SPX ADVANCE-DECLINE",
};

type TickDirection = -1 | 1;
type NativeTickState = {
  tradeDate: string;
  prices: Record<string, number>;
  directions: Record<string, TickDirection>;
};

const globalBreadth = globalThis as typeof globalThis & {
  __wheelDeskSpxNativeTickState?: NativeTickState;
};

export async function fetchZeroDteBreadthSnapshot(args: {
  tradeDate: string;
  generatedAt: string;
  requestValues?: Partial<{
    tick: number;
    uvol: number;
    dvol: number;
    advanceDecline: number;
  }>;
}): Promise<ZeroDteBreadthSnapshot> {
  const requested = normalizeValues(args.requestValues ?? {});
  if (countAvailable(requested) > 0) {
    return makeSnapshot(
      args.generatedAt,
      "REQUEST",
      requested,
      TOS_REFERENCE,
      [],
    );
  }

  const fallbackWarnings: string[] = [];

  // Explicit adapters remain first priority when configured. If one fails,
  // WheelDesk falls through to the Schwab-native universe rather than going dark.
  const externalUrl = process.env.ZERO_DTE_INTERNALS_URL?.trim();
  if (externalUrl) {
    try {
      const response = await fetch(externalUrl, {
        headers: {
          accept: "application/json",
          ...(process.env.ZERO_DTE_INTERNALS_BEARER_TOKEN
            ? {
                authorization: `Bearer ${process.env.ZERO_DTE_INTERNALS_BEARER_TOKEN}`,
              }
            : {}),
        },
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`internals adapter returned ${response.status}`);
      }
      const body = await response.json();
      const snapshot = makeSnapshot(
        args.generatedAt,
        "EXTERNAL_ADAPTER",
        normalizeValues({
          tick: body.tick,
          uvol: body.uvol,
          dvol: body.dvol,
          advanceDecline: body.advanceDecline ?? body.advance_decline,
        }),
        TOS_REFERENCE,
        [],
      );
      if (snapshot.coverage !== "UNAVAILABLE") return snapshot;
      fallbackWarnings.push(
        "Configured breadth adapter returned no usable breadth values; using Schwab-native fallback.",
      );
    } catch (error) {
      fallbackWarnings.push(
        `Configured breadth adapter failed; using Schwab-native fallback: ${message(error)}`,
      );
    }
  }

  const symbols = {
    tick: process.env.SCHWAB_SPX_TICK_SYMBOL?.trim() || "",
    uvol: process.env.SCHWAB_SPX_UVOL_SYMBOL?.trim() || "",
    dvol: process.env.SCHWAB_SPX_DVOL_SYMBOL?.trim() || "",
    advanceDecline:
      process.env.SCHWAB_SPX_ADVANCE_DECLINE_SYMBOL?.trim() || "",
  };
  const configured = Object.values(symbols).filter(Boolean);
  if (configured.length) {
    try {
      const quotes = await fetchSchwabQuotes(configured);
      const snapshot = makeSnapshot(
        args.generatedAt,
        "SCHWAB_CONFIGURED_SYMBOLS",
        normalizeValues({
          tick: valueForSymbol(quotes, symbols.tick),
          uvol: valueForSymbol(quotes, symbols.uvol),
          dvol: valueForSymbol(quotes, symbols.dvol),
          advanceDecline: valueForSymbol(quotes, symbols.advanceDecline),
        }),
        {
          tick: symbols.tick || TOS_REFERENCE.tick,
          uvol: symbols.uvol || TOS_REFERENCE.uvol,
          dvol: symbols.dvol || TOS_REFERENCE.dvol,
          advanceDecline:
            symbols.advanceDecline || TOS_REFERENCE.advanceDecline,
        },
        [],
      );
      if (snapshot.coverage !== "UNAVAILABLE") return snapshot;
      fallbackWarnings.push(
        "Configured Schwab breadth symbols returned no usable values; using constituent fallback.",
      );
    } catch (error) {
      fallbackWarnings.push(
        `Configured Schwab breadth symbols failed; using constituent fallback: ${message(error)}`,
      );
    }
  }

  try {
    return await buildSchwabNativeBreadth({
      tradeDate: args.tradeDate,
      generatedAt: args.generatedAt,
      warnings: fallbackWarnings,
    });
  } catch (error) {
    return makeSnapshot(
      args.generatedAt,
      "UNAVAILABLE",
      {},
      SCHWAB_NATIVE_REFERENCE,
      [
        ...fallbackWarnings,
        `Schwab-native SPX breadth failed: ${message(error)}`,
      ],
    );
  }
}

async function buildSchwabNativeBreadth(args: {
  tradeDate: string;
  generatedAt: string;
  warnings: string[];
}): Promise<ZeroDteBreadthSnapshot> {
  const universe = await getDailySp500BreadthUniverse({
    tradeDate: args.tradeDate,
  });
  const providerSymbols = universe.constituents.map(
    (item) => item.providerSymbol,
  );
  const quotes = await fetchSchwabQuotes(providerSymbols);

  let quotedCount = 0;
  let volumeCount = 0;
  let advances = 0;
  let declines = 0;
  let unchanged = 0;
  let uvol = 0;
  let dvol = 0;

  const state =
    globalBreadth.__wheelDeskSpxNativeTickState?.tradeDate === args.tradeDate
      ? globalBreadth.__wheelDeskSpxNativeTickState
      : {
          tradeDate: args.tradeDate,
          prices: {},
          directions: {},
        };

  let tickKnown = 0;
  let tickSum = 0;

  for (const constituent of universe.constituents) {
    const quote = findQuote(
      quotes,
      constituent.providerSymbol,
      constituent.symbol,
    );
    const current = quoteCurrent(quote);
    const previousClose = quotePrevious(quote);
    const volume = quoteVolume(quote);

    if (current === null || previousClose === null || previousClose <= 0) {
      continue;
    }

    quotedCount += 1;

    if (current > previousClose) advances += 1;
    else if (current < previousClose) declines += 1;
    else unchanged += 1;

    if (volume !== null && volume >= 0) {
      volumeCount += 1;
      if (current > previousClose) uvol += volume;
      else if (current < previousClose) dvol += volume;
    }

    const key = constituent.providerSymbol.toUpperCase();
    const previousObserved = finite(state.prices[key]);
    if (previousObserved !== null) {
      if (current > previousObserved) state.directions[key] = 1;
      else if (current < previousObserved) state.directions[key] = -1;
    }
    state.prices[key] = current;

    const direction = state.directions[key];
    if (direction === 1 || direction === -1) {
      tickKnown += 1;
      tickSum += direction;
    }
  }

  globalBreadth.__wheelDeskSpxNativeTickState = state;

  const universeCount = universe.constituents.length;
  const quoteCoveragePct =
    universeCount > 0 ? (quotedCount / universeCount) * 100 : 0;
  const volumeCoveragePct =
    quotedCount > 0 ? (volumeCount / quotedCount) * 100 : 0;
  const tickCoveragePct =
    quotedCount > 0 ? (tickKnown / quotedCount) * 100 : 0;

  // This is intentionally identified as a proxy rather than pretending Schwab
  // exposes Thinkorswim's proprietary $TIKSP symbol. The value is scaled to the
  // quoted S&P universe so the existing SPX mood thresholds remain meaningful.
  const tick =
    tickKnown >= 50 && tickCoveragePct >= 10
      ? Math.round((tickSum / tickKnown) * quotedCount)
      : null;

  const usableAdvanceDecline =
    quoteCoveragePct >= 70 ? advances - declines : null;
  const usableUvol = volumeCoveragePct >= 60 ? uvol : null;
  const usableDvol = volumeCoveragePct >= 60 ? dvol : null;

  const warnings = [...args.warnings];
  warnings.push(
    "Schwab-native breadth uses the State Street SPY constituent universe. TICK is a one-minute constituent price-direction proxy, not the proprietary $TIKSP feed.",
  );
  if (quoteCoveragePct < 90) {
    warnings.push(
      `SPX breadth quote coverage is ${quoteCoveragePct.toFixed(0)}% (${quotedCount}/${universeCount}).`,
    );
  }
  if (volumeCoveragePct < 80) {
    warnings.push(
      `SPX breadth volume coverage is ${volumeCoveragePct.toFixed(0)}%; UVOL/DVOL may remain unavailable until quote coverage improves.`,
    );
  }
  if (tick === null) {
    warnings.push(
      `SPX TICK proxy is warming up (${tickCoveragePct.toFixed(0)}% directional coverage). A-D and UVOL/DVOL remain usable independently.`,
    );
  }

  return makeSnapshot(
    args.generatedAt,
    "SCHWAB_SPX_UNIVERSE",
    {
      tick,
      uvol: usableUvol,
      dvol: usableDvol,
      advanceDecline: usableAdvanceDecline,
    },
    SCHWAB_NATIVE_REFERENCE,
    [...warnings, ...universe.warnings],
    {
      universeCount,
      quotedCount,
      quoteCoveragePct,
      volumeCoveragePct,
      tickCoveragePct,
      advances,
      declines,
      unchanged,
    },
  );
}

function makeSnapshot(
  generatedAt: string,
  source: ZeroDteBreadthSnapshot["source"],
  values: Partial<{
    tick: number | null;
    uvol: number | null;
    dvol: number | null;
    advanceDecline: number | null;
  }>,
  symbols: ZeroDteBreadthSnapshot["symbols"],
  warnings: string[],
  meta?: Partial<
    Pick<
      ZeroDteBreadthSnapshot,
      | "universeCount"
      | "quotedCount"
      | "quoteCoveragePct"
      | "volumeCoveragePct"
      | "tickCoveragePct"
      | "advances"
      | "declines"
      | "unchanged"
    >
  >,
): ZeroDteBreadthSnapshot {
  const tick = finite(values.tick);
  const uvol = finite(values.uvol);
  const dvol = finite(values.dvol);
  const advanceDecline = finite(values.advanceDecline);
  const uvolDvolRatio = signedRatio(uvol, dvol);
  const available = [tick, uvolDvolRatio, advanceDecline].filter(
    (value) => value !== null,
  ).length;

  return {
    generatedAt,
    source,
    tick,
    uvol,
    dvol,
    uvolDvolRatio,
    advanceDecline,
    coverage:
      available === 3
        ? "FULL"
        : available > 0
          ? "PARTIAL"
          : "UNAVAILABLE",
    symbols,
    universeCount: meta?.universeCount ?? null,
    quotedCount: meta?.quotedCount ?? null,
    quoteCoveragePct: meta?.quoteCoveragePct ?? null,
    volumeCoveragePct: meta?.volumeCoveragePct ?? null,
    tickCoveragePct: meta?.tickCoveragePct ?? null,
    advances: meta?.advances ?? null,
    declines: meta?.declines ?? null,
    unchanged: meta?.unchanged ?? null,
    warnings,
  };
}

function signedRatio(uvol: number | null, dvol: number | null) {
  if (uvol === null || dvol === null || uvol <= 0 || dvol <= 0) return null;
  return uvol >= dvol ? uvol / dvol : -(dvol / uvol);
}

function normalizeValues(values: Record<string, unknown>) {
  return {
    tick: finite(values.tick),
    uvol: finite(values.uvol),
    dvol: finite(values.dvol),
    advanceDecline: finite(values.advanceDecline),
  };
}

function countAvailable(values: Record<string, unknown>) {
  return Object.values(values).filter((value) => finite(value) !== null).length;
}

function valueForSymbol(quotes: SchwabQuotesResponse, symbol: string) {
  if (!symbol) return null;
  const quote = findQuote(quotes, symbol, symbol);
  return quoteCurrent(quote);
}

function findQuote(
  quotes: SchwabQuotesResponse,
  providerSymbol: string,
  originalSymbol: string,
) {
  const alternatives = [
    providerSymbol,
    originalSymbol,
    providerSymbol.replace("/", "."),
    providerSymbol.replace("/", "-"),
  ];
  for (const symbol of alternatives) {
    const exact = quotes[symbol];
    if (exact) return exact;
    const key = Object.keys(quotes).find(
      (candidate) => candidate.toUpperCase() === symbol.toUpperCase(),
    );
    if (key) return quotes[key];
  }
  return undefined;
}

function quoteCurrent(quote: SchwabQuoteInstrument | undefined) {
  return finite(
    quote?.quote?.lastPrice ??
      quote?.quote?.mark ??
      quote?.regular?.regularMarketLastPrice ??
      quote?.regular?.lastPrice ??
      quote?.regular?.mark,
  );
}

function quotePrevious(quote: SchwabQuoteInstrument | undefined) {
  return finite(quote?.quote?.closePrice ?? quote?.regular?.closePrice);
}

function quoteVolume(quote: SchwabQuoteInstrument | undefined) {
  return finite(quote?.quote?.totalVolume ?? quote?.regular?.totalVolume);
}

function finite(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    value !== null &&
    value !== undefined &&
    Number.isFinite(Number(value))
  ) {
    return Number(value);
  }
  return null;
}

function message(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    const parts = [
      typeof candidate.code === "string" ? `[${candidate.code}]` : "",
      typeof candidate.message === "string" ? candidate.message : "",
      typeof candidate.details === "string" ? candidate.details : "",
      typeof candidate.hint === "string" ? candidate.hint : "",
    ].filter(Boolean);
    if (parts.length) return parts.join(" · ");
  }
  return String(error);
}
