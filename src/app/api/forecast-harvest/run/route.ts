import { NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabase-server";
import { getAuthenticatedUserFromRequest } from "../../../../lib/billing/auth-request";
import { normalizeSymbol } from "../../../../lib/ticker-entitlements";
import { readLatestSurfaceSnapshotFromSupabase } from "../../../../lib/supabase-surface-repository";
import { getPriceSeries } from "../../../../lib/data-provider";
import { summarizeExpiration } from "../../../../lib/oi-engine";
import { buildTraderEdgeSummary } from "../../../../lib/trader-edge-engine";
import { buildWallMigrationSummary } from "../../../../lib/oi-wall-migration-engine";
import { buildOIProjectionReport } from "../../../../lib/oi-projection-engine";
import { buildOIImpliedPath } from "../../../../lib/oi-implied-path-engine";
import { buildIVSurfaceSummary } from "../../../../lib/iv-surface-engine";
import { buildOIFieldForecast } from "../../../../lib/oi-field-engine-v2";
import { buildOIFieldForecastCapturePayload } from "../../../../lib/oi-forecast-capture-payload";
import { edgeDteFromExpiration, edgeExpirationOf, makeSingleExpirationSurface } from "../../../../lib/trader-edge-context";
import type { CandleRecord, OptionSurfaceSnapshot } from "../../../../lib/wheeldesk-storage";
import type { ChainRow, ChainSnapshot, Timeframe } from "../../../../lib/types";

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
  expiration: string | null;
  generated_at: string;
  source?: string | null;
  model_status?: string | null;
  engine_version?: string | null;
  training_eligible?: boolean | null;
  outcome_status?: string | null;
};

type HarvestItem = {
  symbol: string;
  status: "captured" | "failed";
  surfaceStatus: "loaded" | "missing" | "failed";
  forecastStatus: "generated" | "failed";
  saveStatus: "saved" | "failed" | "skipped";
  forecastId?: string | null;
  snapshotDate?: string | null;
  expiration?: string | null;
  surfaceRows?: number | null;
  surfaceChains?: number | null;
  message?: string;
};

const NN_READY_RETURN_SELECT = [
  "id",
  "symbol",
  "snapshot_date",
  "expiration",
  "generated_at",
  "source",
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
  if (typeof error === "object" && error && "message" in error) return String((error as { message?: unknown }).message ?? "");
  return String(error);
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function dateOnly(value: unknown): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function isMissingForecastColumn(error: unknown) {
  const message = dbErrorMessage(error);
  return /engine_version|model_status|nn_model_version|baseline_forecast|feature_vector|nn_adjustment|final_forecast|training_eligible|outcome_status|capture_session|capture_kind|capture_run_id|forecast_anchor_at|schema cache|column/i.test(message);
}

async function optionalRunInsert(payload: Record<string, unknown>) {
  const { data, error } = await supabaseServer.from("forecast_capture_runs").insert(payload).select("id").maybeSingle();
  if (error) return { id: null as string | null, error: error.message };
  return { id: (data?.id as string | undefined) ?? null, error: null as string | null };
}

async function optionalRunItemInsert(payload: Record<string, unknown>) {
  await supabaseServer.from("forecast_capture_run_items").insert(payload);
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

function optionSide(row: any): "call" | "put" | null {
  const side = String(row?.side ?? row?.type ?? row?.optionType ?? row?.putCall ?? "").toLowerCase();
  if (side === "call" || side === "calls" || side === "c") return "call";
  if (side === "put" || side === "puts" || side === "p") return "put";
  return null;
}

function rowStrike(row: any): number | null {
  return finiteNumber(row?.strike ?? row?.strikePrice);
}

function rowOpenInterest(row: any): number {
  return finiteNumber(row?.openInterest ?? row?.open_interest ?? row?.oi) ?? 0;
}

function rowVolume(row: any): number {
  return finiteNumber(row?.volume ?? row?.vol) ?? 0;
}

function rowIv(row: any): number | null {
  return finiteNumber(row?.iv ?? row?.impliedVolatility ?? row?.implied_volatility);
}

function pairRows(rows: any[]): ChainRow[] {
  const byStrike = new Map<number, ChainRow & { _callIv?: number | null; _putIv?: number | null }>();

  for (const row of rows ?? []) {
    const strike = rowStrike(row);
    if (strike == null) continue;

    const existing = byStrike.get(strike) ?? { strike, callOi: 0, putOi: 0, callVolume: 0, putVolume: 0, iv: 0 };
    const side = optionSide(row);

    const pairedCallOi = finiteNumber(row?.callOi ?? row?.callOI ?? row?.callOpenInterest ?? row?.call_open_interest);
    const pairedPutOi = finiteNumber(row?.putOi ?? row?.putOI ?? row?.putOpenInterest ?? row?.put_open_interest);

    if (pairedCallOi != null || pairedPutOi != null) {
      existing.callOi += pairedCallOi ?? 0;
      existing.putOi += pairedPutOi ?? 0;
      existing.callVolume = (existing.callVolume ?? 0) + (finiteNumber(row?.callVolume ?? row?.call_volume) ?? 0);
      existing.putVolume = (existing.putVolume ?? 0) + (finiteNumber(row?.putVolume ?? row?.put_volume) ?? 0);
      const iv = rowIv(row);
      if (iv != null) existing.iv = iv;
    } else if (side === "call") {
      existing.callOi += rowOpenInterest(row);
      existing.callVolume = (existing.callVolume ?? 0) + rowVolume(row);
      existing._callIv = rowIv(row);
    } else if (side === "put") {
      existing.putOi += rowOpenInterest(row);
      existing.putVolume = (existing.putVolume ?? 0) + rowVolume(row);
      existing._putIv = rowIv(row);
    }

    byStrike.set(strike, existing);
  }

  return Array.from(byStrike.values())
    .map((row) => {
      const ivs = [row._callIv, row._putIv].filter((value): value is number => value != null && Number.isFinite(value));
      const iv = ivs.length ? ivs.reduce((sum, value) => sum + value, 0) / ivs.length : finiteNumber(row.iv) ?? 0;
      const clean: ChainRow = {
        strike: row.strike,
        callOi: row.callOi,
        putOi: row.putOi,
        callVolume: row.callVolume,
        putVolume: row.putVolume,
        iv,
      };
      return clean;
    })
    .filter((row) => row.callOi > 0 || row.putOi > 0 || (row.callVolume ?? 0) > 0 || (row.putVolume ?? 0) > 0)
    .sort((a, b) => a.strike - b.strike);
}

function normalizeSurfaceForEngines(surface: OptionSurfaceSnapshot, currentPrice: number): OptionSurfaceSnapshot {
  const snapshotDate = dateOnly((surface as any).snapshotDate ?? (surface as any).snapshot_date) ?? new Date().toISOString().slice(0, 10);
  const chains = (((surface as any).chains ?? []) as any[])
    .map((chain) => {
      const expiration = edgeExpirationOf(chain);
      const rows = pairRows(Array.isArray(chain?.rows) ? chain.rows : []);
      if (!expiration || !rows.length) return null;

      return {
        ...chain,
        expiration,
        rows,
        dteAtCapture: finiteNumber(chain?.dteAtCapture ?? chain?.dte) ?? edgeDteFromExpiration(expiration, snapshotDate),
        summary: summarizeExpiration(expiration, rows, currentPrice),
      };
    })
    .filter(Boolean);

  return {
    ...surface,
    ticker: normalizeSymbol((surface as any).ticker ?? (surface as any).symbol),
    snapshotDate,
    chains,
  } as OptionSurfaceSnapshot;
}

function toCandleRecords(candles: Awaited<ReturnType<typeof getPriceSeries>>): CandleRecord[] {
  return candles.map((candle) => ({
    date: String((candle as any).date ?? candle.time ?? "").slice(0, 10),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: (candle as any).volume,
  }));
}

function toChainSnapshot(surface: OptionSurfaceSnapshot | null): ChainSnapshot | null {
  if (!surface?.chains?.length) return null;

  return {
    ticker: (surface as any).ticker,
    snapshotDate: (surface as any).snapshotDate,
    chains: (surface.chains as any[]).map((chain) => ({
      expiration: chain.expiration,
      rows: chain.rows ?? [],
      summary: chain.summary ?? {},
    })),
  } as ChainSnapshot;
}

function selectedExpiration(surface: OptionSurfaceSnapshot): string | null {
  const explicit = dateOnly((surface as any).selectedExpiration ?? (surface as any).expiration);
  if (explicit && (surface.chains as any[]).some((chain) => edgeExpirationOf(chain) === explicit)) return explicit;

  const chains = ((surface.chains ?? []) as any[])
    .map((chain) => ({ expiration: edgeExpirationOf(chain), dte: finiteNumber(chain?.dteAtCapture ?? chain?.dte) ?? edgeDteFromExpiration(edgeExpirationOf(chain), (surface as any).snapshotDate), rows: Array.isArray(chain?.rows) ? chain.rows.length : 0 }))
    .filter((chain) => chain.expiration && chain.rows > 0)
    .sort((a, b) => {
      const aDte = a.dte ?? 9999;
      const bDte = b.dte ?? 9999;
      const aTarget = Math.abs(aDte - 30);
      const bTarget = Math.abs(bDte - 30);
      return aTarget - bTarget || a.expiration.localeCompare(b.expiration);
    });

  return chains[0]?.expiration ?? null;
}

function fieldFromHorizon(payload: any, key: string, field: "base" | "upper" | "lower") {
  const row = (payload.horizons ?? []).find((item: any) => String(item.horizon ?? item.key ?? "").toUpperCase() === key);
  return finiteNumber(row?.[field]);
}

function stripNeuralFields(dbPayload: Record<string, unknown>) {
  const clone = { ...dbPayload };
  [
    "engine_version",
    "model_status",
    "nn_model_version",
    "baseline_forecast",
    "feature_vector",
    "nn_adjustment",
    "final_forecast",
    "training_eligible",
    "outcome_status",
    "capture_session",
    "capture_kind",
    "capture_run_id",
    "forecast_anchor_at",
  ].forEach((key) => delete clone[key]);
  return clone;
}

function toDbPayload(payload: any, args: { userId: string | null; captureSession: HarvestSession; captureKind: CaptureKind; runId: string | null; startedAt: string }) {
  const source = `forecast_harvest_${args.captureSession}`;
  return {
    symbol: normalizeSymbol(payload.symbol),
    user_id: args.userId,
    surface_snapshot_id: payload.surfaceSnapshotId ?? null,
    source,
    capture_session: args.captureSession,
    capture_kind: args.captureKind,
    capture_run_id: args.runId,
    forecast_anchor_at: args.startedAt,
    provider: payload.provider ?? null,
    snapshot_date: dateOnly(payload.snapshotDate) ?? new Date().toISOString().slice(0, 10),
    expiration: dateOnly(payload.expiration),
    dte: finiteNumber(payload.dte),
    spot: finiteNumber(payload.spot),
    bias: payload.bias ?? null,
    confidence: finiteNumber(payload.confidence),
    structure_band_lower: finiteNumber(payload.structureBandLower),
    structure_band_upper: finiteNumber(payload.structureBandUpper),
    expected_move_lower: finiteNumber(payload.expectedMoveLower),
    expected_move_upper: finiteNumber(payload.expectedMoveUpper),
    expected_move: finiteNumber(payload.expectedMove),
    expected_move_source: payload.expectedMoveSource ?? null,
    base_1d: fieldFromHorizon(payload, "1D", "base"),
    base_3d: fieldFromHorizon(payload, "3D", "base"),
    base_5d: fieldFromHorizon(payload, "5D", "base"),
    base_10d: fieldFromHorizon(payload, "10D", "base"),
    base_14d: fieldFromHorizon(payload, "14D", "base"),
    base_30d: fieldFromHorizon(payload, "30D", "base"),
    base_exp: fieldFromHorizon(payload, "EXP", "base"),
    upper_1d: fieldFromHorizon(payload, "1D", "upper"),
    upper_3d: fieldFromHorizon(payload, "3D", "upper"),
    upper_5d: fieldFromHorizon(payload, "5D", "upper"),
    upper_10d: fieldFromHorizon(payload, "10D", "upper"),
    upper_14d: fieldFromHorizon(payload, "14D", "upper"),
    upper_30d: fieldFromHorizon(payload, "30D", "upper"),
    upper_exp: fieldFromHorizon(payload, "EXP", "upper"),
    lower_1d: fieldFromHorizon(payload, "1D", "lower"),
    lower_3d: fieldFromHorizon(payload, "3D", "lower"),
    lower_5d: fieldFromHorizon(payload, "5D", "lower"),
    lower_10d: fieldFromHorizon(payload, "10D", "lower"),
    lower_14d: fieldFromHorizon(payload, "14D", "lower"),
    lower_30d: fieldFromHorizon(payload, "30D", "lower"),
    lower_exp: fieldFromHorizon(payload, "EXP", "lower"),
    pin_probability: finiteNumber(payload.pinProbability),
    upper_touch_probability: finiteNumber(payload.upperTouchProbability),
    lower_break_probability: finiteNumber(payload.lowerBreakProbability),
    trap_probability: finiteNumber(payload.trapProbability),
    wheel_support_hold_probability: finiteNumber(payload.wheelSupportHoldProbability),
    posture: payload.posture ?? null,
    inputs: payload.inputs ?? null,
    forecast: payload.forecast ?? payload.finalForecast ?? null,
    engine_version: payload.engineVersion ?? payload.inputs?.engineVersion ?? "oi-field-v2",
    model_status: payload.modelStatus ?? "collecting",
    nn_model_version: null,
    baseline_forecast: payload.baselineForecast ?? payload.forecast ?? null,
    feature_vector: payload.featureVector ?? payload.inputs ?? null,
    nn_adjustment: null,
    final_forecast: payload.finalForecast ?? payload.forecast ?? null,
    training_eligible: payload.trainingEligible ?? true,
    outcome_status: payload.outcomeStatus ?? "waiting",
  };
}

async function saveForecast(dbPayload: Record<string, unknown>) {
  const primary = await supabaseServer
    .from("oi_field_forecasts")
    .upsert(dbPayload, { onConflict: "symbol,snapshot_date,expiration,source" })
    .select(NN_READY_RETURN_SELECT)
    .maybeSingle();

  if (!primary.error) {
    return { saved: (primary.data ?? null) as ForecastReturnRow | null, schemaMode: "nn-ready" as const, error: null as string | null };
  }

  if (!isMissingForecastColumn(primary.error)) {
    return { saved: null, schemaMode: "nn-ready" as const, error: primary.error.message };
  }

  const legacyPayload = stripNeuralFields(dbPayload);
  const legacy = await supabaseServer
    .from("oi_field_forecasts")
    .upsert(legacyPayload, { onConflict: "symbol,snapshot_date,expiration,source" })
    .select(LEGACY_RETURN_SELECT)
    .maybeSingle();

  if (legacy.error) return { saved: null, schemaMode: "legacy" as const, error: legacy.error.message };
  return { saved: (legacy.data ?? null) as ForecastReturnRow | null, schemaMode: "legacy" as const, error: null as string | null };
}

async function generateForecastPayload(symbol: string, source: string) {
  const rawSurface = await readLatestSurfaceSnapshotFromSupabase(symbol);
  if (!rawSurface) throw new Error("No saved OI surface found. Run Harvest Central Slots first.");

  const rawSpot = finiteNumber((rawSurface as any).spot ?? (rawSurface as any).price?.close ?? (rawSurface as any).dailyStructure?.spot) ?? 0;
  const candlesRaw = await getPriceSeries(symbol, "daily" as Timeframe);
  const candles = toCandleRecords(candlesRaw);
  const livePrice = candles.at(-1)?.close ?? rawSpot;
  if (!livePrice || livePrice <= 0) throw new Error("No usable live/close price for OI forecast generation.");

  const surface = normalizeSurfaceForEngines(rawSurface, livePrice);
  const expiration = selectedExpiration(surface);
  if (!expiration) throw new Error("Saved OI surface has no usable expiration chain.");

  const selectedSurface = makeSingleExpirationSurface(surface, expiration);
  if (!selectedSurface?.chains?.length) throw new Error("Could not isolate selected expiration chain.");

  const selectedChain = (selectedSurface.chains as any[])[0];
  const selectedDte = finiteNumber(selectedChain?.dteAtCapture ?? selectedChain?.dte) ?? edgeDteFromExpiration(expiration, (surface as any).snapshotDate);
  const snapshot = toChainSnapshot(selectedSurface);
  const edge = buildTraderEdgeSummary({ ticker: symbol, surface: selectedSurface, candles, livePrice });
  const wallMigration = buildWallMigrationSummary({ currentSurface: selectedSurface, priorSurface: null });
  const projection = buildOIProjectionReport({ snapshot, currentPrice: livePrice });
  const path = buildOIImpliedPath({ projectionReport: projection, edgeSummary: edge, wallMigration, currentPrice: livePrice });
  const horizonDays = finiteNumber((path as any)?.horizonDays ?? (path as any)?.horizonSessions) ?? 14;
  const ivSurface = buildIVSurfaceSummary({ surface: selectedSurface, currentPrice: livePrice, horizonDays, candles });
  const forecast = buildOIFieldForecast({ path, projectionReport: projection, edgeSummary: edge, wallMigration, currentPrice: livePrice, selectedExpirationDte: selectedDte });

  if (!forecast) throw new Error("OI Field forecast engine returned no forecast from the saved surface.");

  const payload = buildOIFieldForecastCapturePayload({
    ticker: symbol,
    spot: livePrice,
    snapshotDate: (surface as any).snapshotDate,
    expiration,
    dte: selectedDte,
    surfaceSnapshotId: String((surface as any).metadata?.supabaseSnapshotId ?? "") || null,
    source,
    provider: "supabase_surface_harvest",
    forecast,
    ivSurface,
    selectedSurface: surface,
    selectedChainSurface: selectedSurface,
    inputs: {
      captureSource: "forecast_harvest_surface_fallback",
      nnMode: "collecting_baseline_only",
      selectedExpiration: expiration,
      selectedExpirationDte: selectedDte,
      surfaceKey: (surface as any).surfaceKey ?? null,
    },
  });

  if (!payload) throw new Error("Could not build OI Field forecast capture payload.");

  const surfaceRows = (surface.chains as any[]).reduce((sum, chain) => sum + (Array.isArray(chain?.rows) ? chain.rows.length : 0), 0);

  return {
    payload,
    surface,
    expiration,
    surfaceRows,
    surfaceChains: (surface.chains as any[]).length,
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
      return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Missing bearer token" }, { status: 401 });
    }
  }

  const body = (await request.json().catch(() => ({}))) as RequestBody;
  const captureSession = cleanSession(body.captureSession);
  const captureKind: CaptureKind = isCron ? "scheduled" : "manual_batch";
  const requestedSymbols = uniqueSymbols(Array.isArray(body.symbols) ? body.symbols : []);
  const limit = Math.max(1, Math.min(Number(body.limit ?? 50), 100));
  const symbols = await loadSymbols(userId, requestedSymbols, limit);
  const startedAt = new Date().toISOString();
  const source = `forecast_harvest_${captureSession}`;

  const run = await optionalRunInsert({
    user_id: userId,
    capture_session: captureSession,
    run_status: "running",
    requested_count: symbols.length,
    captured_count: 0,
    failed_count: 0,
    notes: body.notes ?? {},
  });

  const items: HarvestItem[] = [];
  let captured = 0;
  let failed = 0;
  let legacySchemaCount = 0;

  for (const symbol of symbols) {
    const itemStartedAt = new Date().toISOString();

    try {
      const generated = await generateForecastPayload(symbol, source);
      const dbPayload = toDbPayload(generated.payload, { userId, captureSession, captureKind, runId: run.id, startedAt });
      const save = await saveForecast(dbPayload);

      if (save.error) throw new Error(save.error);
      if (!save.saved) throw new Error("Forecast save did not return a row.");
      if (save.schemaMode === "legacy") legacySchemaCount += 1;

      captured += 1;
      const forecastId = save.saved.id ?? null;
      const item: HarvestItem = {
        symbol,
        status: "captured",
        surfaceStatus: "loaded",
        forecastStatus: "generated",
        saveStatus: "saved",
        forecastId,
        snapshotDate: dateOnly(generated.payload.snapshotDate),
        expiration: generated.expiration,
        surfaceRows: generated.surfaceRows,
        surfaceChains: generated.surfaceChains,
        message: save.schemaMode === "legacy"
          ? "Surface loaded → baseline OI Field generated → saved using legacy DB schema. NN fields remain baseline-only until migration is applied."
          : "Surface loaded → baseline OI Field generated → NN-ready forecast row saved."
      };
      items.push(item);

      if (run.id) {
        await optionalRunItemInsert({
          run_id: run.id,
          symbol,
          status: "captured",
          forecast_id: forecastId,
          message: item.message,
          started_at: itemStartedAt,
          completed_at: new Date().toISOString(),
        });
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "Forecast harvest failed.";
      const missingSurface = /No saved OI surface/i.test(message);
      const item: HarvestItem = {
        symbol,
        status: "failed",
        surfaceStatus: missingSurface ? "missing" : "failed",
        forecastStatus: "failed",
        saveStatus: "skipped",
        message,
      };
      items.push(item);

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
    legacySchemaCount,
    neuralMode: legacySchemaCount > 0 ? "baseline_legacy_schema" : "collecting_baseline_nn_ready",
    message: legacySchemaCount > 0
      ? "Forecast harvest used baseline OI calculations and legacy schema fallback. Apply the NN migration later for model columns."
      : "Forecast harvest saved baseline OI calculations in NN-ready collecting mode.",
    items,
  });
}
