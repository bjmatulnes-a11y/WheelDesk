import { NextRequest, NextResponse } from "next/server";
import { requirePlanAccessFromRequest } from "../../../../lib/billing/server-access";
import { schwabFetch, type SchwabPriceHistoryResponse } from "../../../../lib/schwab/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type HistoricalCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export async function GET(request: NextRequest) {
  const access = await requirePlanAccessFromRequest(request, "research");
  if ("response" in access) return access.response;
  const date = request.nextUrl.searchParams.get("date")?.trim() || previousWeekdayDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ ok: false, error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  const requested = request.nextUrl.searchParams.get("symbol")?.trim() || null;
  const configured = process.env.SCHWAB_ES_SYMBOL?.trim() || null;
  const contract = frontEsContractSymbol(new Date(`${date}T17:00:00Z`));
  const candidates = unique([requested, configured, contract, "/ES"]);

  const center = Date.parse(`${date}T12:00:00Z`);
  const startDate = center - 30 * 60 * 60 * 1000;
  const endDate = center + 30 * 60 * 60 * 1000;
  const failures: string[] = [];

  for (const symbol of candidates) {
    try {
      const es = await fetchHistory(symbol, startDate, endDate, true);
      if (!es.candles.length) {
        failures.push(`${symbol}: Schwab returned no candles`);
        continue;
      }

      const resolvedEsSymbol = es.symbol ?? symbol;
      const spxSymbol = process.env.SCHWAB_SPX_SYMBOL?.trim() || "$SPX";
      const basisInstrumentCompatible = resolvedEsSymbol.toUpperCase().includes("/ES");
      let spxCandles: HistoricalCandle[] = [];
      let spxPreviousClose: number | null = null;
      let basisFailure: string | null = basisInstrumentCompatible
        ? null
        : `Basis disabled for ${resolvedEsSymbol}; ES→SPX projection requires an ES futures symbol.`;
      if (basisInstrumentCompatible) {
        try {
          const spx = await fetchHistory(spxSymbol, startDate, endDate, false);
          spxCandles = spx.candles;
          spxPreviousClose = spx.previousClose;
          if (!spxCandles.length) basisFailure = `${spxSymbol}: Schwab returned no SPX candles`;
        } catch (error) {
          basisFailure = `${spxSymbol}: ${message(error)}`;
        }
      }

      return NextResponse.json(
        {
          ok: true,
          provider: "schwab-pricehistory-experiment",
          date,
          requestedSymbol: requested,
          symbol: resolvedEsSymbol,
          contractCandidate: contract,
          previousClose: es.previousClose,
          candleCount: es.candles.length,
          candles: es.candles,
          spxSymbol,
          spxPreviousClose,
          spxCandleCount: spxCandles.length,
          spxCandles,
          basisFailure,
          limitations: {
            trueTimeAndSales: false,
            historicalBidAskVolume: false,
            fullDepth: false,
            reconstruction: "OHLCV_AUCTION_STRUCTURE",
            esSpxBasis: spxCandles.length > 0,
          },
          note:
            "ES history is 1-minute OHLCV. The lab derives auction/profile structure from price and volume; synthetic bid/ask splits are not treated as true order flow. SPX history is returned separately so ES auction levels can be projected onto the SPX scale with a contemporaneous basis.",
        },
        { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
      );
    } catch (error) {
      failures.push(`${symbol}: ${message(error)}`);
    }
  }

  return NextResponse.json(
    {
      ok: false,
      provider: "schwab-pricehistory-experiment",
      date,
      contractCandidate: contract,
      error:
        "Schwab did not return historical ES futures candles for any tested symbol. This is an API capability result, not a chart error.",
      failures,
      limitations: {
        trueTimeAndSales: false,
        historicalBidAskVolume: false,
        fullDepth: false,
        esSpxBasis: false,
      },
    },
    {
      status: 422,
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    },
  );
}

async function fetchHistory(
  symbol: string,
  startDate: number,
  endDate: number,
  extendedHours: boolean,
) {
  const params = new URLSearchParams({
    symbol,
    periodType: "day",
    frequencyType: "minute",
    frequency: "1",
    startDate: String(startDate),
    endDate: String(endDate),
    needExtendedHoursData: extendedHours ? "true" : "false",
    needPreviousClose: "true",
  });
  const result = await schwabFetch<SchwabPriceHistoryResponse>(
    `/pricehistory?${params.toString()}`,
  );
  return {
    symbol: result.symbol ?? symbol,
    previousClose: result.previousClose ?? null,
    candles: normalizeCandles(result),
  };
}

function normalizeCandles(result: SchwabPriceHistoryResponse): HistoricalCandle[] {
  return (result.candles ?? [])
    .filter(
      (candle) =>
        Number.isFinite(candle.datetime) &&
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close) &&
        Number.isFinite(candle.volume),
    )
    .map((candle) => ({
      time: Math.floor(candle.datetime / 1000),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: Number(candle.volume ?? 0),
    }));
}

function frontEsContractSymbol(date: Date) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const quarterMonths = [3, 6, 9, 12];
  let contractMonth = quarterMonths.find((value) => value >= month) ?? 3;
  let contractYear = year;

  if (month === contractMonth) {
    const expiry = thirdFridayUtc(year, contractMonth);
    const rollMs = expiry.getTime() - 8 * 24 * 60 * 60 * 1000;
    if (date.getTime() >= rollMs) {
      const index = quarterMonths.indexOf(contractMonth);
      if (index === quarterMonths.length - 1) {
        contractMonth = 3;
        contractYear += 1;
      } else {
        contractMonth = quarterMonths[index + 1];
      }
    }
  }

  const code = ({ 3: "H", 6: "M", 9: "U", 12: "Z" } as Record<number, string>)[
    contractMonth
  ];
  return `/ES${code}${String(contractYear).slice(-2)}`;
}

function thirdFridayUtc(year: number, month: number) {
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  const daysUntilFriday = (5 - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month - 1, 1 + daysUntilFriday + 14, 12));
}

function previousWeekdayDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return date.toISOString().slice(0, 10);
}

function unique(values: Array<string | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
