import { NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabase-server";
import { getAuthenticatedUserFromRequest } from "../../../../lib/billing/auth-request";
import { normalizeSymbol } from "../../../../lib/ticker-entitlements";

export const runtime = "nodejs";

type HarvestSession = "premarket" | "midday" | "close" | "manual";
type CaptureKind = "scheduled" | "manual_batch";

type RequestBody = {
  symbols?: string[];
  captureSession?: HarvestSession | string;
  notes?: Record<string, unknown>;
  limit?: number;
};

type ForecastReturnRow = {
  id: string;
  symbol: string;
  snapshot_date: string;
  expiration: string;
  generated_at: string;
  source: string | null;
  capture_session?: string | null;
  capture_kind?: string | null;
  model_status?: string | null;
  engine_version?: string | null;
  training_eligible?: boolean | null;
  outcome_status?: string | null;
};

type HarvestItem = {
  symbol: string;
  status: "captured" | "missing_forecast" | "failed";
  forecastId?: string | null;
  message?: string;
};

const NN_READY_RETURN_SELECT = [
  "id",
  "symbol",
  "snapshot_date",
  "expiration",
  "generated_at",
  "source",
  "capture_session",
  "capture_kind",
  "model_status",
  "engine_version",
  "training_eligible",
  "outcome_status",
].join(",");

const LEGACY_RETURN_SELECT = "id,symbol,snapshot_date,expiration,generated_at,source";

function cleanSession(value: unknown): HarvestSession {
  const normalized = String(value ?? "manual").toLowerCase();
  return normalized === "premarket" || normalized === "midday" || normalized === "close" ? normalized : "manual";
}

function uniqueSymbols(symbols: unknown[]): string[] {
  return Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean)));
}

function dbErrorMessage(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: unknown }).message ?? "");
  }
  return String(error);
}

async function optionalRunInsert(payload: Record<string, unknown>) {
  const { data, error } = await supabaseServer
    .from("forecast_capture_runs")
    .insert(payload)
    .select("id")
    .maybeSingle();

  if (error) return { id: null as string | null, error: error.message };
  return { id: (data?.id as string | undefined) ?? null, error: null as string | null };
}

async function optionalRunItemInsert(payload: Record<string, unknown>) {
  await supabaseServer.from("forecast_capture_run_items").insert(payload);
}

function stripIdentity(row: Record<string, unknown>) {
  const clone = { ...row };
  delete clone.id;
  delete clone.created_at;
  delete clone.generated_at;
  return clone;
}

function stripHarvestFields(row: Record<string, unknown>) {
  const clone = { ...row };
  delete clone.capture_session;
  delete clone.capture_kind;
  delete clone.capture_run_id;
  delete clone.forecast_anchor_at;
  return clone;
}

function isMissingHarvestColumn(error: unknown) {
  const message = dbErrorMessage(error);
  return /capture_session|capture_kind|capture_run_id|forecast_anchor_at|model_status|engine_version|training_eligible|outcome_status|schema cache|column/i.test(message);
}

async function loadSymbols(userId: string | null, requested: string[], limit: number) {
  if (requested.length) return requested.slice(0, limit);

  if (userId) {
    const { data } = await supabaseServer
      .from("user_watchlist_tickers")
      .select("symbol")
      .eq("user_id", userId)
      .order("slot_index", { ascending: true })
      .limit(limit);

    return uniqueSymbols((data ?? []).map((row: { symbol?: unknown }) => row.symbol));
  }

  const { data } = await supabaseServer
    .from("ticker_universe")
    .select("symbol")
    .eq("is_active", true)
    .order("data_priority", { ascending: true })
    .limit(limit);

  return uniqueSymbols((data ?? []).map((row: { symbol?: unknown }) => row.symbol));
}

async function upsertHarvestForecast(clone: Record<string, unknown>): Promise<{
  saved: ForecastReturnRow | null;
  schemaMode: "nn-ready" | "legacy";
  error: string | null;
}> {
  const primary = await supabaseServer
    .from("oi_field_forecasts")
    .upsert(clone, { onConflict: "symbol,snapshot_date,expiration,source" })
    .select(NN_READY_RETURN_SELECT)
    .maybeSingle();

  if (!primary.error) {
    return {
      saved: (primary.data ?? null) as ForecastReturnRow | null,
      schemaMode: "nn-ready",
      error: null,
    };
  }

  if (!isMissingHarvestColumn(primary.error)) {
    return {
      saved: null,
      schemaMode: "nn-ready",
      error: primary.error.message,
    };
  }

  const legacy = await supabaseServer
    .from("oi_field_forecasts")
    .upsert(stripHarvestFields(clone), { onConflict: "symbol,snapshot_date,expiration,source" })
    .select(LEGACY_RETURN_SELECT)
    .maybeSingle();

  if (legacy.error) {
    return {
      saved: null,
      schemaMode: "legacy",
      error: legacy.error.message,
    };
  }

  return {
    saved: (legacy.data ?? null) as ForecastReturnRow | null,
    schemaMode: "legacy",
    error: null,
  };
}

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const requestSecret = request.headers.get("x-cron-secret") ?? request.headers.get("x-wheeldesk-cron-secret");
  const isCron = Boolean(cronSecret && requestSecret && requestSecret === cronSecret);

  let userId: string | null = null;
  if (!isCron) {
    try {
      const user = await getAuthenticatedUserFromRequest(request);
      userId = user.id;
    } catch (error) {
      return NextResponse.json(
        { ok: false, error: error instanceof Error ? error.message : "Missing bearer token" },
        { status: 401 }
      );
    }
  }

  const body = (await request.json().catch(() => ({}))) as RequestBody;
  const captureSession = cleanSession(body.captureSession);
  const captureKind: CaptureKind = isCron ? "scheduled" : "manual_batch";
  const requestedSymbols = uniqueSymbols(Array.isArray(body.symbols) ? body.symbols : []);
  const limit = Math.max(1, Math.min(Number(body.limit ?? 50), 100));
  const symbols = await loadSymbols(userId, requestedSymbols, limit);

  const run = await optionalRunInsert({
    user_id: userId,
    capture_session: captureSession,
    run_status: "running",
    requested_count: symbols.length,
    captured_count: 0,
    failed_count: 0,
    notes: body.notes ?? {},
  });

  const startedAt = new Date().toISOString();
  const items: HarvestItem[] = [];
  let captured = 0;
  let failed = 0;
  let legacySchemaCount = 0;

  for (const symbol of symbols) {
    const itemStartedAt = new Date().toISOString();

    try {
      const { data: latest, error: latestError } = await supabaseServer
        .from("oi_field_forecasts")
        .select("*")
        .eq("symbol", symbol)
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestError) throw new Error(latestError.message);

      if (!latest) {
        failed += 1;
        const message =
          "No OI Field forecast exists yet. Open Control Center or Chart Room and capture once, then forecast harvest can reuse the baseline.";
        items.push({ symbol, status: "missing_forecast", message });
        if (run.id) {
          await optionalRunItemInsert({
            run_id: run.id,
            symbol,
            status: "missing_forecast",
            message,
            started_at: itemStartedAt,
            completed_at: new Date().toISOString(),
          });
        }
        continue;
      }

      const clone = {
        ...stripIdentity(latest as Record<string, unknown>),
        source: `forecast_harvest_${captureSession}`,
        capture_session: captureSession,
        capture_kind: captureKind,
        capture_run_id: run.id,
        forecast_anchor_at: startedAt,
        outcome_status: (latest as Record<string, unknown>).outcome_status ?? "waiting",
        model_status: (latest as Record<string, unknown>).model_status ?? "collecting",
        training_eligible: (latest as Record<string, unknown>).training_eligible ?? true,
      };

      const save = await upsertHarvestForecast(clone);
      if (save.error) throw new Error(save.error);
      if (!save.saved) throw new Error("Forecast harvest save did not return a row.");
      if (save.schemaMode === "legacy") legacySchemaCount += 1;

      captured += 1;
      const forecastId = save.saved.id ?? null;
      items.push({ symbol, status: "captured", forecastId });
      if (run.id) {
        await optionalRunItemInsert({
          run_id: run.id,
          symbol,
          status: "captured",
          forecast_id: forecastId,
          message: save.schemaMode === "legacy" ? "Forecast captured using legacy forecast schema fallback." : "Forecast captured from latest baseline row.",
          started_at: itemStartedAt,
          completed_at: new Date().toISOString(),
        });
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "Forecast harvest failed.";
      items.push({ symbol, status: "failed", message });
      if (run.id) {
        await optionalRunItemInsert({
          run_id: run.id,
          symbol,
          status: "failed",
          message,
          started_at: itemStartedAt,
          completed_at: new Date().toISOString(),
        });
      }
    }
  }

  if (run.id) {
    await supabaseServer
      .from("forecast_capture_runs")
      .update({
        run_status: failed ? (captured ? "partial" : "failed") : "complete",
        captured_count: captured,
        failed_count: failed,
        completed_at: new Date().toISOString(),
      })
      .eq("id", run.id);
  }

  return NextResponse.json({
    ok: true,
    runId: run.id,
    runTableWarning: run.error,
    captureSession,
    requested: symbols.length,
    captured,
    failed,
    schemaMode: legacySchemaCount ? "mixed-or-legacy" : "nn-ready",
    legacySchemaCount,
    items,
  });
}
