import { NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabase-server";
import { getAuthenticatedUserFromRequest } from "../../../../lib/billing/auth-request";
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

function normalizeSymbol(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
}

function normalizeSymbols(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((symbol) => normalizeSymbol(symbol))
    .filter(Boolean)
    .slice(0, 50);
}

async function userLockedSymbols(userId: string): Promise<string[]> {
  const { data, error } = await supabaseServer
    .from("user_watchlist_tickers")
    .select("symbol")
    .eq("user_id", userId)
    .order("slot_index", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => normalizeSymbol(String(row.symbol ?? ""))).filter(Boolean);
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
  try {
    const user = await getAuthenticatedUserFromRequest(request);
    const { searchParams } = new URL(request.url);
    const requestedSymbols = normalizeSymbols(searchParams.get("symbols"));
    const lockedSymbols = await userLockedSymbols(user.id);
    const lockedSet = new Set(lockedSymbols);
    const symbols = (requestedSymbols.length ? requestedSymbols : lockedSymbols)
      .filter((symbol) => lockedSet.has(symbol))
      .slice(0, 50);
    const hours = Math.min(Math.max(Number(searchParams.get("hours") ?? 24), 1), 24 * 14);

    if (!symbols.length) {
      return NextResponse.json(
        { ok: false, error: "News Pulse is limited to your locked ticker slots. Add tracked tickers from Dashboard first." },
        { status: 403 },
      );
    }

    const cutoff = new Date(Date.now() - Math.max(1, hours) * 36e5).toISOString();
    const { data, error } = await supabaseServer
      .from("news_ticker_links")
      .select(
        "symbol,news_events!inner(provider,provider_event_id,headline,summary,source_name,url,image_url,published_at,sentiment_score,materiality_score,raw)",
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

    return NextResponse.json({ ok: true, hours, pulses, symbols });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load news pulse.";
    const status = /bearer|session|auth|login/i.test(message) ? 401 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
