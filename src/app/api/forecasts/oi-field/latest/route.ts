import { NextResponse } from "next/server";
import { supabaseServer } from "../../../../../lib/supabase-server";
import { normalizeSymbol } from "../../../../../lib/ticker-entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanDate(value: string | null): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return raw.slice(0, 10);
}

function cleanText(value: string | null): string | null {
  const raw = String(value ?? "").trim();
  return raw || null;
}

function withOptionalFilters(query: any, filters: {
  source?: string | null;
  snapshotDate?: string | null;
  expiration?: string | null;
  captureSession?: string | null;
}) {
  let next = query;
  if (filters.source && filters.source !== "any") next = next.eq("source", filters.source);
  if (filters.snapshotDate) next = next.eq("snapshot_date", filters.snapshotDate);
  if (filters.expiration) next = next.eq("expiration", filters.expiration);
  if (filters.captureSession && filters.captureSession !== "any") next = next.eq("capture_session", filters.captureSession);
  return next;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = normalizeSymbol(searchParams.get("symbol"));
  const source = cleanText(searchParams.get("source"));
  const snapshotDate = cleanDate(searchParams.get("snapshotDate") ?? searchParams.get("surfaceDate"));
  const expiration = cleanDate(searchParams.get("expiration"));
  const captureSession = cleanText(searchParams.get("captureSession"));
  const allowFallback = searchParams.get("fallback") !== "0";

  if (!symbol) {
    return NextResponse.json({ ok: false, error: "symbol is required" }, { status: 400 });
  }

  try {
    const hasExactContext = Boolean(snapshotDate || expiration || captureSession);

    let exactQuery = supabaseServer
      .from("oi_field_forecasts")
      .select("*")
      .eq("symbol", symbol)
      .order("generated_at", { ascending: false })
      .limit(1);

    exactQuery = withOptionalFilters(exactQuery, {
      source,
      snapshotDate,
      expiration,
      captureSession,
    });

    const exact = await exactQuery.maybeSingle();

    if (exact.error) {
      return NextResponse.json({ ok: false, error: exact.error.message }, { status: 500 });
    }

    if (exact.data || !hasExactContext || !allowFallback) {
      return NextResponse.json({
        ok: true,
        forecast: exact.data ?? null,
        matchStatus: exact.data ? "exact" : "missing_exact",
        requested: {
          symbol,
          source: source ?? null,
          snapshotDate: snapshotDate ?? null,
          expiration: expiration ?? null,
          captureSession: captureSession ?? null,
        },
      });
    }

    let fallbackQuery = supabaseServer
      .from("oi_field_forecasts")
      .select("*")
      .eq("symbol", symbol)
      .order("generated_at", { ascending: false })
      .limit(1);

    if (source && source !== "any") fallbackQuery = fallbackQuery.eq("source", source);

    const fallback = await fallbackQuery.maybeSingle();

    if (fallback.error) {
      return NextResponse.json({ ok: false, error: fallback.error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      forecast: fallback.data ?? null,
      matchStatus: fallback.data ? "fallback_latest" : "missing",
      warning: fallback.data
        ? "No exact forecast matched the selected surface/expiration. Returned latest forecast for this symbol."
        : "No captured forecast found for this symbol.",
      requested: {
        symbol,
        source: source ?? null,
        snapshotDate: snapshotDate ?? null,
        expiration: expiration ?? null,
        captureSession: captureSession ?? null,
      },
      fallback: fallback.data
        ? {
            snapshotDate: fallback.data.snapshot_date ?? null,
            expiration: fallback.data.expiration ?? null,
            captureSession: fallback.data.capture_session ?? null,
            generatedAt: fallback.data.generated_at ?? null,
          }
        : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load latest OI field forecast.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
