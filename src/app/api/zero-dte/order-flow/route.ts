import { NextRequest, NextResponse } from "next/server";
import { requirePlanAccessFromRequest } from "../../../../lib/billing/server-access";
import { fetchSchwabQuotes } from "../../../../lib/schwab/client";
import type { SchwabQuoteInstrument } from "../../../../lib/schwab/types";
import type { EsOrderFlowSnapshot } from "../../../../lib/zeroDteEsOrderFlow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const access = await requirePlanAccessFromRequest(request, "research");
  if ("response" in access) return access.response;
  const generatedAt = new Date().toISOString();
  const requested = request.nextUrl.searchParams.get("symbol")?.trim() || null;
  const configured = process.env.SCHWAB_ES_SYMBOL?.trim() || null;
  const candidates = unique([
    requested,
    configured,
    "/ES",
    frontEsContractSymbol(new Date()),
  ]);

  const failures: string[] = [];
  for (const symbol of candidates) {
    try {
      const quotes = await fetchSchwabQuotes([symbol]);
      const instrument = pickInstrument(quotes, symbol);
      if (!instrument) {
        failures.push(`${symbol}: no quote instrument returned`);
        continue;
      }
      const quote = instrument.quote ?? instrument.regular ?? {};
      const snapshot: EsOrderFlowSnapshot = {
        generatedAt,
        symbol: instrument.symbol?.trim() || symbol,
        bid: finite(quote.bidPrice),
        ask: finite(quote.askPrice),
        bidSize: nonNegative(quote.bidSize),
        askSize: nonNegative(quote.askSize),
        last: finite(quote.lastPrice ?? quote.regularMarketLastPrice),
        lastSize: nonNegative(quote.lastSize),
        totalVolume: nonNegative(quote.totalVolume),
        quoteTime: finite(quote.quoteTime),
        tradeTime: finite(quote.tradeTime ?? quote.regularMarketTradeTime),
      };

      const topOfBook = snapshot.bid != null && snapshot.ask != null;
      const bookSizes = snapshot.bidSize != null && snapshot.askSize != null;
      const tapeProxy =
        snapshot.last != null &&
        (snapshot.totalVolume != null || snapshot.lastSize != null);

      if (!topOfBook && !tapeProxy) {
        failures.push(`${symbol}: quote returned but lacks usable futures bid/ask or trade fields`);
        continue;
      }

      return NextResponse.json(
        {
          ok: true,
          generatedAt,
          source: "schwab-rest",
          snapshot,
          capabilities: {
            topOfBook,
            bookSizes,
            tapeProxy,
            fullDepth: false,
            trueTimeAndSales: false,
          },
          availableQuoteFields: Object.keys(quote).sort(),
          note:
            "REST v1 classifies aggregate volume between snapshots using the prevailing bid/ask and tick rule. It is not yet a full CME depth or trade-by-trade stream.",
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
      generatedAt,
      source: "schwab-rest",
      error: `No usable ES quote was returned. Tried ${candidates.join(", ")}.`,
      failures,
      capabilities: {
        topOfBook: false,
        bookSizes: false,
        tapeProxy: false,
        fullDepth: false,
        trueTimeAndSales: false,
      },
    },
    {
      status: 502,
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    },
  );
}

function pickInstrument(
  quotes: Record<string, SchwabQuoteInstrument>,
  requestedSymbol: string,
) {
  return (
    quotes[requestedSymbol] ??
    quotes[requestedSymbol.toUpperCase()] ??
    Object.values(quotes).find((item) => item.symbol === requestedSymbol) ??
    Object.values(quotes)[0]
  );
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

function finite(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonNegative(value: unknown) {
  const number = finite(value);
  return number != null && number >= 0 ? number : null;
}

function unique(values: Array<string | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
