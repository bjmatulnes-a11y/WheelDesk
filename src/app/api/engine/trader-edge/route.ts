import { NextRequest, NextResponse } from "next/server";
import { getPriceSeries } from "../../../../lib/data-provider";
import { buildTraderEdgeSummary } from "../../../../lib/trader-edge-engine";
import { makeSingleExpirationSurface, getDefaultExpirationContext } from "../../../../lib/trader-edge-context";
import { readLatestSurfaceSnapshotFromSupabase } from "../../../../lib/supabase-surface-repository";
import type { Timeframe } from "../../../../lib/types";
import type { CandleRecord, OptionSurfaceSnapshot } from "../../../../lib/wheeldesk-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENGINE_VERSION = "trader-edge-chain-v1";

function normalizeTicker(value: unknown): string {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
}

function normalizeTimeframe(value: string | null): Timeframe {
  const raw = String(value ?? "daily").toLowerCase();
  const allowed = new Set(["daily", "weekly", "4h", "2h", "1h", "30m", "15m", "5m", "1m"]);
  return (allowed.has(raw) ? raw : "daily") as Timeframe;
}

async function buildCanonicalTraderEdge(ticker: string, expiration?: string | null, timeframe: Timeframe = "daily") {
  const surface = (await readLatestSurfaceSnapshotFromSupabase(ticker)) as OptionSurfaceSnapshot | null;

  if (!surface) {
    return {
      ticker,
      ok: false,
      error: "No Supabase surface snapshot found for ticker.",
    };
  }

  const selectedExpiration = String(expiration ?? "").slice(0, 10) || getDefaultExpirationContext(surface);
  const edgeSurface = makeSingleExpirationSurface(surface, selectedExpiration) ?? surface;
  const priceSeries = await getPriceSeries(ticker, timeframe);
  const candles: CandleRecord[] = priceSeries.map((candle) => ({
    date: String(candle.time ?? "").slice(0, 10),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }));
  const livePrice = candles.at(-1)?.close ?? surface.price?.close ?? surface.dailyStructure?.spot ?? null;
  const summary = buildTraderEdgeSummary({ ticker, surface: edgeSurface, candles, livePrice });

  return {
    ok: true,
    ticker,
    selectedExpiration,
    timeframe,
    engineVersion: ENGINE_VERSION,
    source: "supabase_surface_snapshot + canonical_daily_candles",
    surfaceKey: (surface as any).surfaceKey ?? (surface as any).id ?? null,
    snapshotDate: surface.snapshotDate,
    generatedAt: new Date().toISOString(),
    summary,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbolsRaw = searchParams.get("symbols");
    const ticker = normalizeTicker(searchParams.get("ticker"));
    const symbols = (symbolsRaw ?? "")
      .split(",")
      .map(normalizeTicker)
      .filter(Boolean)
      .slice(0, 50);
    const expiration = searchParams.get("expiration");
    const timeframe = normalizeTimeframe(searchParams.get("timeframe"));

    if (symbols.length) {
      const rows = await Promise.all(symbols.map((symbol) => buildCanonicalTraderEdge(symbol, expiration, timeframe)));
      return NextResponse.json({ ok: true, mode: "batch", engineVersion: ENGINE_VERSION, rows });
    }

    if (!ticker) {
      return NextResponse.json({ ok: false, error: "Missing ticker or symbols query parameter." }, { status: 400 });
    }

    const row = await buildCanonicalTraderEdge(ticker, expiration, timeframe);
    return NextResponse.json(row, { status: row.ok ? 200 : 404 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown Trader Edge engine error." },
      { status: 500 },
    );
  }
}
