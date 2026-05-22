import { NextResponse } from "next/server";
import { supabaseServer } from "../../../../../lib/supabase-server";
import { normalizeSymbol } from "../../../../../lib/ticker-entitlements";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = normalizeSymbol(searchParams.get("symbol"));
  const source = searchParams.get("source");

  if (!symbol) {
    return NextResponse.json({ ok: false, error: "symbol is required" }, { status: 400 });
  }

  try {
    let query = supabaseServer
      .from("oi_field_forecasts")
      .select("*")
      .eq("symbol", symbol)
      .order("generated_at", { ascending: false })
      .limit(1);

    if (source && source !== "any") query = query.eq("source", source);

    const { data, error } = await query.maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, forecast: data ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load latest OI field forecast.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
