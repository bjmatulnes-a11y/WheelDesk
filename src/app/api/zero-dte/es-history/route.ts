import { NextRequest, NextResponse } from "next/server";
import { requirePlanAccessFromRequest } from "../../../../lib/billing/server-access";
import {
  fetchHistoricalSeries,
  frontEsContractSymbol,
  uniqueSymbols,
} from "../../../../lib/zeroDteHistoryData";
import { dateInTimeZone, previousTradingSessionDate } from "../../../../lib/zeroDtePriorStructure";

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
  const date = request.nextUrl.searchParams.get("date")?.trim() || previousTradingSessionDate(
    dateInTimeZone(Math.floor(Date.now() / 1000)),
  );
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ ok: false, error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  const requested = request.nextUrl.searchParams.get("symbol")?.trim() || null;
  const configured = process.env.SCHWAB_ES_SYMBOL?.trim() || null;
  const contract = frontEsContractSymbol(new Date(`${date}T17:00:00Z`));
  const candidates = uniqueSymbols([requested, configured, contract, "/ES"]);

  const center = Date.parse(`${date}T12:00:00Z`);
  const startDate = center - 30 * 60 * 60 * 1000;
  const endDate = center + 30 * 60 * 60 * 1000;
  const failures: string[] = [];

  for (const symbol of candidates) {
    try {
      const es = await fetchHistoricalSeries({
        userId: access.access.user.id,
        symbol,
        startDate,
        endDate,
        extendedHours: true,
      });
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
          const spx = await fetchHistoricalSeries({
            userId: access.access.user.id,
            symbol: spxSymbol,
            startDate,
            endDate,
            extendedHours: false,
          });
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

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
