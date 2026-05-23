import { NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabase-server";
import { buildNewsPulse } from "../../../../lib/news/news-provider";
import type { NormalizedNewsEvent } from "../../../../lib/news/news-types";

export const runtime = "nodejs";

type LinkedNewsRow = {
  symbol: string;
  news_events: {
    provider: string;
    provider_event_id: string;
    headline: string;
    summary: string | null;
    source_name: string | null;
    url: string | null;
    image_url: string | null;
    published_at: string;
    sentiment_score: number | null;
    materiality_score: number | null;
    raw: Record<string, unknown> | null;
  } | null;
};

function normalizeSymbols(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12))
    .filter(Boolean)
    .slice(0, 50);
}

function toEvent(row: LinkedNewsRow): NormalizedNewsEvent | null {
  const event = row.news_events;
  if (!event) return null;
  return {
    provider: event.provider,
    providerEventId: event.provider_event_id,
    symbols: [row.symbol],
    headline: event.headline,
    summary: event.summary,
    sourceName: event.source_name,
    url: event.url,
    imageUrl: event.image_url,
    publishedAt: event.published_at,
    sentimentScore: typeof event.sentiment_score === "number" ? event.sentiment_score : null,
    materialityScore: Number(event.materiality_score ?? 0),
    raw: event.raw ?? {},
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbols = normalizeSymbols(searchParams.get("symbols"));
  const hours = Math.min(Math.max(Number(searchParams.get("hours") ?? 24), 1), 24 * 14);

  if (!symbols.length) {
    return NextResponse.json({ ok: false, error: "At least one symbol is required." }, { status: 400 });
  }

  try {
    const cutoff = new Date(Date.now() - Math.max(1, hours) * 36e5).toISOString();
    const { data, error } = await supabaseServer
      .from("news_ticker_links")
      .select(
        "symbol,news_events(provider,provider_event_id,headline,summary,source_name,url,image_url,published_at,sentiment_score,materiality_score,raw)",
      )
      .in("symbol", symbols)
      .gte("news_events.published_at", cutoff)
      .limit(500);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const grouped = new Map<string, NormalizedNewsEvent[]>();
    for (const symbol of symbols) grouped.set(symbol, []);

    for (const row of (data ?? []) as unknown as LinkedNewsRow[]) {
      const event = toEvent(row);
      if (event) grouped.get(row.symbol)?.push(event);
    }

    const pulses = symbols.map((symbol) => buildNewsPulse(symbol, grouped.get(symbol) ?? [], Math.min(hours, 24)));

    return NextResponse.json({ ok: true, hours, pulses });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load news pulse.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
