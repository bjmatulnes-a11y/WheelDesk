import { fetchSchwabQuotes } from "./schwab/client";

export type ZeroDteBreadthSnapshot = {
  generatedAt: string;
  source: "REQUEST" | "EXTERNAL_ADAPTER" | "SCHWAB_CONFIGURED_SYMBOLS" | "UNAVAILABLE";
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
  warnings: string[];
};

const TOS_REFERENCE = {
  tick: "$TIKSP",
  uvol: "$UVOLSP",
  dvol: "$DVOLSP",
  advanceDecline: "$ADSPD",
};

export async function fetchZeroDteBreadthSnapshot(args: {
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
    return makeSnapshot(args.generatedAt, "REQUEST", requested, TOS_REFERENCE, []);
  }

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
      return makeSnapshot(
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
    } catch (error) {
      return makeSnapshot(
        args.generatedAt,
        "UNAVAILABLE",
        {},
        TOS_REFERENCE,
        [
          `Configured breadth adapter failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ],
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
      return makeSnapshot(
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
    } catch (error) {
      return makeSnapshot(
        args.generatedAt,
        "UNAVAILABLE",
        {},
        TOS_REFERENCE,
        [
          `Configured Schwab breadth symbols failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ],
      );
    }
  }

  return makeSnapshot(args.generatedAt, "UNAVAILABLE", {}, TOS_REFERENCE, []);
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
    coverage: available === 3 ? "FULL" : available > 0 ? "PARTIAL" : "UNAVAILABLE",
    symbols,
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

function valueForSymbol(quotes: any, symbol: string) {
  if (!symbol) return null;
  const quote = quotes[symbol] ??
    Object.entries(quotes).find(([key]) => key.toUpperCase() === symbol.toUpperCase())?.[1];
  return finite(
    quote?.quote?.lastPrice ??
      quote?.quote?.mark ??
      quote?.regular?.regularMarketLastPrice ??
      quote?.regular?.lastPrice,
  );
}

function finite(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value !== null && value !== undefined && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}
