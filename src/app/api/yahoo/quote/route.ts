import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");

  if (!symbol) {
    return NextResponse.json(
      { error: "Missing symbol" },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        symbol
      )}?range=5d&interval=1d`,
      { cache: "no-store" }
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: `Yahoo quote request failed: ${res.status}` },
        { status: 502 }
      );
    }

    const json = await res.json();
    const result = json?.chart?.result?.[0];
    const meta = result?.meta;
    const quote = result?.indicators?.quote?.[0];

    const closes: number[] = Array.isArray(quote?.close)
      ? quote.close.filter((x: unknown) => typeof x === "number" && Number.isFinite(x))
      : [];

    const price =
      (typeof meta?.regularMarketPrice === "number" && Number.isFinite(meta.regularMarketPrice)
        ? meta.regularMarketPrice
        : closes.at(-1)) ?? undefined;

    const previousClose =
      (typeof meta?.previousClose === "number" && Number.isFinite(meta.previousClose)
        ? meta.previousClose
        : closes.length >= 2
          ? closes[closes.length - 2]
          : closes.at(-1)) ?? undefined;

    return NextResponse.json({
      symbol: String(symbol).toUpperCase(),
      price,
      previousClose,
      currency: meta?.currency ?? "USD"
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown quote error"
      },
      { status: 500 }
    );
  }
}