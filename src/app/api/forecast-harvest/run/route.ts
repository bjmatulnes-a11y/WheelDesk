import { NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabase-server";
import { getAuthenticatedUserFromRequest } from "../../../../lib/billing/auth-request";
import { normalizeSymbol } from "../../../../lib/ticker-entitlements";
import { readLatestSurfaceSnapshotFromSupabase } from "../../../../lib/supabase-surface-repository";
import { getPriceSeries } from "../../../../lib/data-provider";
import { buildTraderEdgeSummary } from "../../../../lib/trader-edge-engine";
import { buildWallMigrationSummary } from "../../../../lib/oi-wall-migration-engine";
import { buildOIProjectionReport } from "../../../../lib/oi-projection-engine";
import { buildOIImpliedPath } from "../../../../lib/oi-implied-path-engine";
import { buildIVSurfaceSummary } from "../../../../lib/iv-surface-engine";
import { buildOIFieldForecast } from "../../../../lib/oi-field-engine-v2";
import { buildOIFieldForecastCapturePayload } from "../../../../lib/oi-forecast-capture-payload";

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
  status: "captured" | "surface_missing" | "forecast_failed" | "failed";
  surfaceStatus?: "loaded" | "missing" | "failed";
  forecastStatus?: "generated" | "failed";
  saveStatus?: "saved" | "failed";
  forecastId?: string | null;
  surfaceDate?: string | null;
  expiration?: string | null;
  rowCount?: number;
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
  if (normalized === "auto") return autoSession();
  return normalized === "premarket" || normalized === "midday" || normalized === "close" ? normalized : "manual";
}

function autoSession(): HarvestSession {
  const now = new Date();
  const eastern = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(eastern.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(eastern.find((part) => part.type === "minute")?.value ?? 0);
  const minutes = hour * 60 + minute;
  if (minutes < 9 * 60 + 30) return "premarket";
  if (minutes < 15 * 60 + 45) return "midday";
  return "close";
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
  [
    "capture_session",
    "capture_kind",
    "capture_run_id",
    "forecast_anchor_at",
    "engine_version",
    "model_status",
    "nn_model_version",
    "baseline_forecast",
    "feature_vector",
    "nn_adjustment",
    "final_forecast",
    "training_eligible",
    "outcome_status",
  ].forEach((key) => delete clone[key]);
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


function dateOnly(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function dte(snapshotDate: string | null, expiration: string | null): number | null {
  if (!snapshotDate || !expiration) return null;
  const start = new Date(`${snapshotDate}T00:00:00Z`).getTime();
  const end = new Date(`${expiration}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function chainExpiration(chain: any): string | null {
  return dateOnly(chain?.expiration ?? chain?.expirationDate ?? chain?.expiry);
}

function chainRows(chain: any): any[] {
  return Array.isArray(chain?.rows) ? chain.rows : Array.isArray(chain?.chainRows) ? chain.chainRows : [];
}

type ForecastChainCandidate = { chain: any; expiration: string | null; dte: number | null; rows: number };

function chooseForecastChain(surface: any): any | null {
  const snapshotDate = dateOnly(surface?.snapshotDate ?? surface?.snapshot_date);
  const chains = Array.isArray(surface?.chains) ? surface.chains : [];
  const candidates: ForecastChainCandidate[] = chains
    .map((chain: any) => {
      const expiration = chainExpiration(chain);
      const chainDte = finite(chain?.dteAtCapture ?? chain?.dte ?? chain?.summary?.dte) ?? dte(snapshotDate, expiration);
      return { chain, expiration, dte: chainDte, rows: chainRows(chain).length };
    })
    .filter((item: ForecastChainCandidate) => Boolean(item.expiration) && item.rows > 0 && item.dte != null && item.dte >= 0)
    .sort((a: ForecastChainCandidate, b: ForecastChainCandidate) => Math.abs((a.dte ?? 999) - 30) - Math.abs((b.dte ?? 999) - 30));

  return candidates[0]?.chain ?? null;
}

function singleChainSurface(surface: any, chain: any): any {
  return { ...surface, chains: [chain] };
}

function toChainSnapshot(surface: any) {
  if (!surface?.chains?.length) return null;
  return {
    ticker: surface.ticker,
    snapshotDate: surface.snapshotDate ?? surface.snapshot_date,
    chains: surface.chains.map((chain: any) => ({
      expiration: chain.expiration,
      rows: chain.rows ?? [],
      summary: chain.summary ?? {},
    })),
  };
}

function candleRecords(candles: any[]) {
  return (candles ?? []).map((candle) => ({
    date: String(candle.date ?? candle.time ?? candle.timestamp ?? ""),
    open: finite(candle.open) ?? 0,
    high: finite(candle.high) ?? 0,
    low: finite(candle.low) ?? 0,
    close: finite(candle.close) ?? 0,
    volume: finite(candle.volume) ?? 0,
  })).filter((candle) => candle.date && candle.close > 0);
}

function horizonValue(payload: any, key: string, field: "base" | "upper" | "lower") {
  const row = (payload?.horizons ?? []).find((horizon: any) => String(horizon?.horizon ?? "").toUpperCase() === key);
  return finite(row?.[field]);
}

function capturePayloadToDb(payload: any, userId: string | null, captureSession: HarvestSession, captureKind: CaptureKind, runId: string | null, startedAt: string) {
  return {
    symbol: normalizeSymbol(payload.symbol),
    user_id: userId,
    surface_snapshot_id: payload.surfaceSnapshotId ?? null,
    source: `forecast_harvest_${captureSession}`,
    capture_session: captureSession,
    capture_kind: captureKind,
    capture_run_id: runId,
    forecast_anchor_at: startedAt,
    provider: payload.provider ?? "supabase_surface",
    snapshot_date: dateOnly(payload.snapshotDate) ?? new Date().toISOString().slice(0, 10),
    expiration: dateOnly(payload.expiration),
    dte: finite(payload.dte),
    spot: finite(payload.spot),
    bias: payload.bias ?? null,
    confidence: finite(payload.confidence),
    structure_band_lower: finite(payload.structureBandLower),
    structure_band_upper: finite(payload.structureBandUpper),
    expected_move_lower: finite(payload.expectedMoveLower),
    expected_move_upper: finite(payload.expectedMoveUpper),
    expected_move: finite(payload.expectedMove),
    expected_move_source: payload.expectedMoveSource ?? null,
    base_1d: horizonValue(payload, "1D", "base"),
    base_3d: horizonValue(payload, "3D", "base"),
    base_5d: horizonValue(payload, "5D", "base"),
    base_10d: horizonValue(payload, "10D", "base"),
    base_14d: horizonValue(payload, "14D", "base"),
    base_30d: horizonValue(payload, "30D", "base"),
    base_exp: horizonValue(payload, "EXP", "base"),
    upper_1d: horizonValue(payload, "1D", "upper"),
    upper_3d: horizonValue(payload, "3D", "upper"),
    upper_5d: horizonValue(payload, "5D", "upper"),
    upper_10d: horizonValue(payload, "10D", "upper"),
    upper_14d: horizonValue(payload, "14D", "upper"),
    upper_30d: horizonValue(payload, "30D", "upper"),
    upper_exp: horizonValue(payload, "EXP", "upper"),
    lower_1d: horizonValue(payload, "1D", "lower"),
    lower_3d: horizonValue(payload, "3D", "lower"),
    lower_5d: horizonValue(payload, "5D", "lower"),
    lower_10d: horizonValue(payload, "10D", "lower"),
    lower_14d: horizonValue(payload, "14D", "lower"),
    lower_30d: horizonValue(payload, "30D", "lower"),
    lower_exp: horizonValue(payload, "EXP", "lower"),
    pin_probability: finite(payload.pinProbability),
    upper_touch_probability: finite(payload.upperTouchProbability),
    lower_break_probability: finite(payload.lowerBreakProbability),
    trap_probability: finite(payload.trapProbability),
    wheel_support_hold_probability: finite(payload.wheelSupportHoldProbability),
    posture: payload.posture ?? null,
    inputs: payload.inputs ?? null,
    forecast: payload.forecast ?? null,
    engine_version: payload.engineVersion ?? payload.inputs?.engineVersion ?? "oi-field-v2",
    model_status: "collecting",
    nn_model_version: null,
    baseline_forecast: payload.baselineForecast ?? payload.forecast ?? null,
    feature_vector: payload.featureVector ?? payload.inputs ?? null,
    nn_adjustment: null,
    final_forecast: payload.finalForecast ?? payload.forecast ?? null,
    training_eligible: Boolean(payload.trainingEligible),
    outcome_status: "waiting",
  };
}

async function buildForecastFromLatestSurface(symbol: string, userId: string | null, captureSession: HarvestSession, captureKind: CaptureKind, runId: string | null, startedAt: string) {
  const surface = await readLatestSurfaceSnapshotFromSupabase(symbol);
  if (!surface) throw new Error("No saved OI surface found. Run Surface Harvest first.");

  const chain = chooseForecastChain(surface);
  if (!chain) throw new Error("Saved surface has no usable expiration chain rows.");

  const selectedSurface = singleChainSurface(surface, chain);
  const candles = candleRecords(await getPriceSeries(symbol as any, "daily").catch(() => []));
  const spot = finite(candles.at(-1)?.close) ?? finite((surface as any).price?.close) ?? finite((surface as any).dailyStructure?.spot) ?? null;
  if (!spot) throw new Error("Could not determine spot price for forecast generation.");

  const edgeSummary = buildTraderEdgeSummary({ ticker: symbol, surface: selectedSurface as any, candles: candles as any, livePrice: spot });
  const wallMigration = buildWallMigrationSummary({ currentSurface: selectedSurface as any, priorSurface: null });
  const projectionReport = buildOIProjectionReport({ snapshot: toChainSnapshot(selectedSurface) as any, currentPrice: spot });
  const path = buildOIImpliedPath({ projectionReport, edgeSummary, wallMigration, currentPrice: spot });
  const selectedExpiration = chainExpiration(chain);
  const selectedDte = finite((chain as any).dteAtCapture ?? (chain as any).dte ?? (chain as any).summary?.dte) ?? dte(dateOnly((surface as any).snapshotDate), selectedExpiration);
  const forecast = buildOIFieldForecast({ path, projectionReport, edgeSummary, wallMigration, currentPrice: spot, selectedExpirationDte: selectedDte });
  if (!forecast) throw new Error("Baseline OI Field forecast could not be generated from the saved surface.");

  const ivSurface = buildIVSurfaceSummary({ surface: selectedSurface as any, currentPrice: spot, horizonDays: selectedDte ?? 30, candles: candles as any });
  const capturePayload = buildOIFieldForecastCapturePayload({
    ticker: symbol,
    spot,
    snapshotDate: (surface as any).snapshotDate,
    expiration: selectedExpiration,
    dte: selectedDte,
    surfaceSnapshotId: (surface as any).id ?? (surface as any).surfaceKey ?? null,
    forecast,
    ivSurface,
    selectedSurface: surface,
    selectedChainSurface: selectedSurface,
    source: "forecast_harvest",
    provider: "supabase_surface",
    inputs: { captureSession, captureKind, generatedBy: "forecast_harvest_surface_baseline" },
  });

  if (!capturePayload) throw new Error("Forecast capture payload could not be built.");

  return {
    dbPayload: capturePayloadToDb(capturePayload, userId, captureSession, captureKind, runId, startedAt),
    surfaceDate: dateOnly((surface as any).snapshotDate),
    expiration: selectedExpiration,
    rowCount: chainRows(chain).length,
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
      const generated = await buildForecastFromLatestSurface(symbol, userId, captureSession, captureKind, run.id, startedAt);
      const save = await upsertHarvestForecast(generated.dbPayload);
      if (save.error) throw new Error(save.error);
      if (!save.saved) throw new Error("Forecast harvest save did not return a row.");
      if (save.schemaMode === "legacy") legacySchemaCount += 1;

      captured += 1;
      const forecastId = save.saved.id ?? null;
      const message = save.schemaMode === "legacy"
        ? "Surface loaded, baseline forecast generated, saved with legacy schema fallback."
        : "Surface loaded, baseline forecast generated, forecast saved.";

      items.push({
        symbol,
        status: "captured",
        surfaceStatus: "loaded",
        forecastStatus: "generated",
        saveStatus: "saved",
        forecastId,
        surfaceDate: generated.surfaceDate,
        expiration: generated.expiration,
        rowCount: generated.rowCount,
        message,
      });

      if (run.id) {
        await optionalRunItemInsert({
          run_id: run.id,
          symbol,
          status: "captured",
          forecast_id: forecastId,
          message,
          started_at: itemStartedAt,
          completed_at: new Date().toISOString(),
        });
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "Forecast harvest failed.";
      const status = /No saved OI surface/i.test(message) ? "surface_missing" : /forecast/i.test(message) ? "forecast_failed" : "failed";
      items.push({
        symbol,
        status: status as HarvestItem["status"],
        surfaceStatus: status === "surface_missing" ? "missing" : "loaded",
        forecastStatus: status === "surface_missing" ? undefined : "failed",
        saveStatus: "failed",
        message,
      });
      if (run.id) {
        await optionalRunItemInsert({
          run_id: run.id,
          symbol,
          status,
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
