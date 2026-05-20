import { NextResponse } from "next/server";
import { supabaseServer } from "../../../lib/supabase-server";

export const runtime = "nodejs";

type TickerUniverseRow = {
  symbol: string;
  name: string | null;
  asset_type: string;
  supports_options: boolean;
  supports_equity_candles: boolean;
  supports_index_context: boolean;
  data_priority: number;
  provider_hint: string | null;
  notes: string | null;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawQuery = searchParams.get("q")?.trim().toUpperCase() ?? "";
  const limit = Math.min(Number(searchParams.get("limit") ?? 100), 250);

  try {
    let query = supabaseServer
      .from("ticker_universe")
      .select(
        "symbol,name,asset_type,supports_options,supports_equity_candles,supports_index_context,data_priority,provider_hint,notes",
      )
      .eq("is_active", true)
      .order("data_priority", { ascending: true })
      .order("symbol", { ascending: true })
      .limit(limit);

    if (rawQuery) {
      query = query.or(`symbol.ilike.%${rawQuery}%,name.ilike.%${rawQuery}%`);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, tickers: (data ?? []) as TickerUniverseRow[] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load ticker universe.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
