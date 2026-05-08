import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  const range = req.nextUrl.searchParams.get("range") || "1mo";
  const interval = req.nextUrl.searchParams.get("interval") || "1d";

  if (!symbol) {
    return NextResponse.json(
      { error: "Missing symbol" },
      { status: 400 }
    );
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;

    const res = await fetch(url, { cache: "no-store" });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Yahoo candles request failed: ${res.status}` },
        { status: 502 }
      );
    }

    const json = await res.json();
    const result = json?.chart?.result?.[0];
    const timestamps: number[] = Array.isArray(result?.timestamp) ? result.timestamp : [];
    const quote = result?.indicators?.quote?.[0];

    const candles = timestamps
      .map((time, idx) => ({
        time,
        open: quote?.open?.[idx],
        high: quote?.high?.[idx],
        low: quote?.low?.[idx],
        close: quote?.close?.[idx],
        volume: quote?.volume?.[idx]
      }))
      .filter(
        (c) =>
          [c.open, c.high, c.low, c.close].every(
            (v) => typeof v === "number" && Number.isFinite(v)
          )
      );

    return NextResponse.json(candles);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown candles error"
      },
      { status: 500 }
    );
  }
}