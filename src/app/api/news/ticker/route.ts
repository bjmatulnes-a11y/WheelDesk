import { NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabase-server";
import { getAuthenticatedUserFromRequest } from "../../../../lib/billing/auth-request";
import { buildNewsPulse, configuredNewsProvider, fetchTickerNews, hasNewsProviderCredentials } from "../../../../lib/news/news-provider";
import type { NormalizedNewsEvent } from "../../../../lib/news/news-types";

export const runtime = "nodejs";

type LinkedNewsRow = {
  symbol: string;
  relevance_score: number | null;
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

function normalizeSymbol(value: string | null): string {
  return (value ?? "").trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
}

function asBool(value: string | null): boolean {
  return value === "1" || value === "true" || value === "yes";
}

async function userLockedSymbols(userId: string): Promise<Set<string>> {
  const { data, error } = await supabaseServer
    .from("user_watchlist_tickers")
    .select("symbol")
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }

  return new Set((data ?? []).map((row) => normalizeSymbol(String(row.symbol ?? ""))).filter(Boolean));
}

function linkedRowToEvent(row: LinkedNewsRow): NormalizedNewsEvent | null {
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

async function storeNewsEvents(symbol: string, events: NormalizedNewsEvent[]): Promise<number> {
  let stored = 0;

  for (const event of events) {
    const { data, error } = await supabaseServer
      .from("news_events")
      .upsert(
        {
          provider: event.provider,
          provider_event_id: event.providerEventId,
          headline: event.headline,
          summary: event.summary,
          source_name: event.sourceName,
          url: event.url,
          image_url: event.imageUrl,
          published_at: event.publishedAt,
          sentiment_score: event.sentimentScore,
          materiality_score: event.materialityScore,
          raw: event.raw,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "provider,provider_event_id" },
      )
      .select("id")
      .single();

    if (error || !data?.id) continue;

    const { error: linkError } = await supabaseServer.from("news_ticker_links").upsert(
      {
        news_event_id: data.id,
        symbol,
        relevance_score: 1,
      },
      { onConflict: "news_event_id,symbol" },
    );

    if (!linkError) stored += 1;
  }

  return stored;
}

async function readCachedNews(symbol: string, hours: number, limit: number): Promise<NormalizedNewsEvent[]> {
  const cutoff = new Date(Date.now() - Math.max(1, hours) * 36e5).toISOString();

  const { data, error } = await supabaseServer
    .from("news_ticker_links")
    .select(
      "symbol,relevance_score,news_events(provider,provider_event_id,headline,summary,source_name,url,image_url,published_at,sentiment_score,materiality_score,raw)",
    )
    .eq("symbol", symbol)
    .gte("news_events.published_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as LinkedNewsRow[])
    .map(linkedRowToEvent)
    .filter((event): event is NormalizedNewsEvent => Boolean(event))
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
}

export async function GET(request: Request) {
  const provider = configuredNewsProvider();

  try {
    const user = await getAuthenticatedUserFromRequest(request);
    const { searchParams } = new URL(request.url);
    const symbol = normalizeSymbol(searchParams.get("symbol"));
    const hours = Math.min(Math.max(Number(searchParams.get("hours") ?? 72), 1), 24 * 14);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 25), 1), 100);
    const refresh = asBool(searchParams.get("refresh")) || process.env.NEWS_AUTOFETCH_ON_READ === "true";

    if (!symbol) {
      return NextResponse.json({ ok: false, error: "Ticker symbol is required." }, { status: 400 });
    }

    const locked = await userLockedSymbols(user.id);
    if (!locked.has(symbol)) {
      return NextResponse.json(
        {
          ok: false,
          symbol,
          error: "News access is limited to your locked WheelDesk ticker slots.",
        },
        { status: 403 },
      );
    }

    let source: "cache" | "cache+refresh" | "cache_only" = "cache";
    let inserted = 0;

    if (refresh && hasNewsProviderCredentials(provider)) {
      const daysBack = Math.ceil(hours / 24);
      const fetched = await fetchTickerNews(symbol, daysBack);
      inserted = await storeNewsEvents(symbol, fetched);
      source = "cache+refresh";
    } else if (refresh) {
      source = "cache_only";
    }

    const events = await readCachedNews(symbol, hours, limit);
    const pulse = buildNewsPulse(symbol, events, Math.min(hours, 24));

    return NextResponse.json({
      ok: true,
      symbol,
      provider,
      source,
      inserted,
      pulse,
      events,
      providerReady: hasNewsProviderCredentials(provider),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load ticker news.";
    const status = /bearer|session|auth|login/i.test(message) ? 401 : 500;
    return NextResponse.json({ ok: false, provider, error: message }, { status });
  }
}
