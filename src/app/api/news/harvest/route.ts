import { NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabase-server";
import { getAuthenticatedUserFromRequest } from "../../../../lib/billing/auth-request";
import { configuredNewsProvider, fetchTickerNews, hasNewsProviderCredentials } from "../../../../lib/news/news-provider";
import type { NormalizedNewsEvent } from "../../../../lib/news/news-types";

export const runtime = "nodejs";

type HarvestBody = {
  symbols?: string[];
  hours?: number;
};

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
}

async function symbolsFromUserWatchlist(userId: string): Promise<string[]> {
  const { data, error } = await supabaseServer
    .from("user_watchlist_tickers")
    .select("symbol")
    .eq("user_id", userId)
    .order("slot_index", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error) return [];
  return (data ?? []).map((row) => normalizeSymbol(String(row.symbol ?? ""))).filter(Boolean);
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

export async function POST(request: Request) {
  const provider = configuredNewsProvider();

  try {
    const user = await getAuthenticatedUserFromRequest(request);
    const body = (await request.json().catch(() => ({}))) as HarvestBody;
    const requestedSymbols = (body.symbols ?? [])
      .map((symbol) => normalizeSymbol(symbol))
      .filter(Boolean)
      .slice(0, 50);
    const symbols = requestedSymbols.length ? requestedSymbols : await symbolsFromUserWatchlist(user.id);
    const hours = Math.min(Math.max(Number(body.hours ?? 72), 1), 24 * 14);

    if (!symbols.length) {
      return NextResponse.json({ ok: false, error: "No symbols supplied and no watchlist tickers found." }, { status: 400 });
    }

    const { data: run, error: runError } = await supabaseServer
      .from("news_harvest_runs")
      .insert({
        provider,
        symbols,
        status: "running",
        total_requested: symbols.length,
      })
      .select("id")
      .single();

    if (runError) {
      return NextResponse.json({ ok: false, error: runError.message }, { status: 500 });
    }

    if (!hasNewsProviderCredentials(provider)) {
      await supabaseServer
        .from("news_harvest_runs")
        .update({
          status: "missing_provider_credentials",
          completed_at: new Date().toISOString(),
          total_failed: symbols.length,
          errors: [{ message: `Missing credentials for provider ${provider}.` }],
        })
        .eq("id", run.id);

      return NextResponse.json({
        ok: false,
        provider,
        runId: run.id,
        error: `Missing credentials for provider ${provider}. Add FINNHUB_API_KEY or MARKETAUX_API_KEY, or set NEWS_PROVIDER=mock for local testing.`,
      }, { status: 400 });
    }

    let totalInserted = 0;
    let totalFailed = 0;
    const errors: Array<{ symbol: string; message: string }> = [];
    const daysBack = Math.ceil(hours / 24);

    for (const symbol of symbols) {
      try {
        const events = await fetchTickerNews(symbol, daysBack);
        totalInserted += await storeNewsEvents(symbol, events);
      } catch (error) {
        totalFailed += 1;
        errors.push({ symbol, message: error instanceof Error ? error.message : "Unknown news harvest error." });
      }
    }

    await supabaseServer
      .from("news_harvest_runs")
      .update({
        status: totalFailed ? "completed_with_errors" : "completed",
        completed_at: new Date().toISOString(),
        total_inserted: totalInserted,
        total_failed: totalFailed,
        errors,
      })
      .eq("id", run.id);

    return NextResponse.json({
      ok: true,
      provider,
      runId: run.id,
      symbols,
      totalRequested: symbols.length,
      totalInserted,
      totalFailed,
      errors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not harvest news.";
    return NextResponse.json({ ok: false, provider, error: message }, { status: 401 });
  }
}
