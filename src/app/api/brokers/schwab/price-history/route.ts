import { NextRequest, NextResponse } from "next/server";
import { requirePlanAccessFromRequest } from "../../../../../lib/billing/server-access";
import { fetchSchwabPriceHistory } from "../../../../../lib/schwab/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const access = await requirePlanAccessFromRequest(request, "research");
  if ("response" in access) return access.response;
  try {
    const symbol =
      request.nextUrl.searchParams.get("symbol")?.trim() ||
      process.env.SCHWAB_SPX_SYMBOL?.trim() ||
      "$SPX";

    const rawFrequency = Number(
      request.nextUrl.searchParams.get("frequency") ?? "1",
    );
    const frequency =
      rawFrequency === 5 ||
      rawFrequency === 10 ||
      rawFrequency === 15 ||
      rawFrequency === 30
        ? rawFrequency
        : 1;

    const result = await fetchSchwabPriceHistory({
      userId: access.access.user.id,
      symbol,
      frequency,
    });

    const candles = (result.candles ?? [])
      .filter(
        (candle) =>
          Number.isFinite(candle.datetime) &&
          Number.isFinite(candle.open) &&
          Number.isFinite(candle.high) &&
          Number.isFinite(candle.low) &&
          Number.isFinite(candle.close),
      )
      .map((candle) => ({
        time: Math.floor(candle.datetime / 1000),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: Number(candle.volume ?? 0),
      }));

    return NextResponse.json(
      {
        ok: true,
        provider: "schwab",
        symbol: result.symbol ?? symbol,
        previousClose: result.previousClose ?? null,
        candles,
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
