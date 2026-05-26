import { NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabase-server";
import { getAuthenticatedUserFromRequest } from "../../../../lib/billing/auth-request";
import { normalizeSymbol } from "../../../../lib/ticker-entitlements";
import { readLatestSurfaceSnapshotFromSupabase } from "../../../../lib/supabase-surface-repository";
import { buildTraderEdgeSummary } from "../../../../lib/trader-edge-engine";
import { buildWallMigrationSummary } from "../../../../lib/oi-wall-migration-engine";
import { buildOIProjectionReport } from "../../../../lib/oi-projection-engine";
import { buildOIImpliedPath } from "../../../../lib/oi-implied-path-engine";
import { buildOIFieldForecast } from "../../../../lib/oi-field-engine-v2";
import { buildOIFieldForecastCapturePayload } from "../../../../lib/oi-forecast-capture-payload";
import type { OptionSurfaceSnapshot } from "../../../../lib/wheeldesk-storage";
import type { ChainSnapshot } from "../../../../lib/types";

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

type HarvestStageStatus =
  | "existing"
  | "captured"
  | "generated"
  | "missing"
  | "failed"
  | "skipped";

type HarvestItem = {
  symbol: string;
  status:
    | "captured"
    | "generated_from_surface"
    | "missing_surface"
    | "missing_forecast"
    | "failed";
  surfaceStatus?: HarvestStageStatus;
  forecastStatus?: HarvestStageStatus;
  saveStatus?: HarvestStageStatus;
  forecastId?: string | null;
  surfaceDate?: string | null;
  expiration?: string | null;
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

const LEGACY_RETURN_SELECT =
  "id,symbol,snapshot_date,expiration,generated_at,source";

function cleanSession(value: unknown): HarvestSession {
  const normalized = String(value ?? "manual").toLowerCase();
  return normalized === "premarket" ||
    normalized === "midday" ||
    normalized === "close"
    ? normalized
    : "manual";
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

function dateOnly(value: unknown): string | null {
  if (!value) return null;
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toISOString().slice(0, 10);
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function expirationOf(chain: any): string | null {
  return dateOnly(chain?.expiration ?? chain?.expirationDate ?? chain?.expiry);
}

function dteFrom(
  snapshotDate: string | null,
  expiration: string | null,
): number | null {
  if (!snapshotDate || !expiration) return null;
  const start = new Date(`${snapshotDate}T00:00:00Z`).getTime();
  const end = new Date(`${expiration}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / 86400000));
}

function snapshotSpot(surface: OptionSurfaceSnapshot | null): number | null {
  return (
    finite((surface as any)?.price?.close) ??
    finite((surface as any)?.dailyStructure?.spot) ??
    finite((surface as any)?.spot) ??
    null
  );
}

function selectHarvestChain(surface: OptionSurfaceSnapshot | null): any | null {
  const chains = Array.isArray((surface as any)?.chains)
    ? (surface as any).chains
    : [];
  if (!chains.length) return null;
  const snapshotDate = dateOnly(
    (surface as any)?.snapshotDate ?? (surface as any)?.snapshot_date,
  );
  return (
    chains
      .map((chain: any) => {
        const expiration = expirationOf(chain);
        const dte =
          finite(chain?.dte ?? chain?.dteAtCapture) ??
          dteFrom(snapshotDate, expiration) ??
          999;
        const rows = Array.isArray(chain?.rows) ? chain.rows.length : 0;
        return { chain, expiration, dte, rows };
      })
      .filter((item: any) => item.expiration && item.rows > 0)
      .sort(
        (a: any, b: any) =>
          Math.abs(a.dte - 30) - Math.abs(b.dte - 30) || b.rows - a.rows,
      )[0]?.chain ?? null
  );
}

function makeSingleChainSurface(
  surface: OptionSurfaceSnapshot,
  chain: any,
): OptionSurfaceSnapshot {
  return { ...(surface as any), chains: [chain] } as OptionSurfaceSnapshot;
}

function toChainSnapshot(
  surface: OptionSurfaceSnapshot | null,
): ChainSnapshot | null {
  if (
    !surface ||
    !Array.isArray((surface as any).chains) ||
    !(surface as any).chains.length
  )
    return null;
  return {
    ticker: String((surface as any).ticker ?? "").toUpperCase() as any,
    snapshotDate:
      dateOnly(
        (surface as any).snapshotDate ?? (surface as any).snapshot_date,
      ) ?? new Date().toISOString().slice(0, 10),
    chains: (surface as any).chains.map((chain: any) => ({
      expiration: expirationOf(chain) ?? String(chain?.expiration ?? ""),
      rows: chain?.rows ?? [],
      summary: chain?.summary ?? {},
    })),
  } as ChainSnapshot;
}

async function buildForecastCloneFromLatestSurface(args: {
  symbol: string;
  captureSession: HarvestSession;
  captureKind: CaptureKind;
  runId: string | null;
  startedAt: string;
  userId: string | null;
}): Promise<{
  clone: Record<string, unknown> | null;
  surfaceDate: string | null;
  expiration: string | null;
  message: string;
}> {
  const surface = await readLatestSurfaceSnapshotFromSupabase(args.symbol);
  if (!surface) {
    return {
      clone: null,
      surfaceDate: null,
      expiration: null,
      message: "No Supabase OI surface exists for this ticker.",
    };
  }

  const selectedChain = selectHarvestChain(surface);
  if (!selectedChain) {
    return {
      clone: null,
      surfaceDate: dateOnly((surface as any).snapshotDate),
      expiration: null,
      message:
        "Surface exists, but no usable expiration chain rows were found.",
    };
  }

  const selectedSurface = makeSingleChainSurface(surface, selectedChain);
  const spot = snapshotSpot(surface);
  if (!spot) {
    return {
      clone: null,
      surfaceDate: dateOnly((surface as any).snapshotDate),
      expiration: expirationOf(selectedChain),
      message: "Surface exists, but no valid spot/close price was found.",
    };
  }

  const edge = buildTraderEdgeSummary({
    ticker: args.symbol,
    surface: selectedSurface,
    candles: [],
    livePrice: spot,
  });
  const wall = buildWallMigrationSummary({
    currentSurface: selectedSurface,
    priorSurface: null,
  });
  const projection = buildOIProjectionReport({
    snapshot: toChainSnapshot(selectedSurface),
    currentPrice: spot,
  });
  const path = buildOIImpliedPath({
    projectionReport: projection,
    edgeSummary: edge,
    wallMigration: wall,
    currentPrice: spot,
  });
  const snapshotDate =
    dateOnly((surface as any).snapshotDate ?? (surface as any).snapshot_date) ??
    new Date().toISOString().slice(0, 10);
  const expiration = expirationOf(selectedChain);
  const selectedExpirationDte =
    finite(selectedChain?.dte ?? selectedChain?.dteAtCapture) ??
    dteFrom(snapshotDate, expiration);
  const forecast = buildOIFieldForecast({
    path,
    projectionReport: projection,
    edgeSummary: edge,
    wallMigration: wall,
    currentPrice: spot,
    selectedExpirationDte,
  });

  const payload = buildOIFieldForecastCapturePayload({
    ticker: args.symbol,
    spot,
    snapshotDate,
    expiration,
    dte: selectedExpirationDte,
    surfaceSnapshotId:
      String((surface as any).id ?? (surface as any).snapshotId ?? "") || null,
    source: `forecast_harvest_${args.captureSession}`,
    provider: "supabase_surface_fallback",
    forecast,
    selectedSurface: surface,
    selectedChainSurface: selectedSurface,
    inputs: {
      captureSession: args.captureSession,
      captureKind: args.captureKind,
      captureRunId: args.runId,
      generatedFrom: "latest_supabase_surface",
      selectedChainRows: Array.isArray(selectedChain?.rows)
        ? selectedChain.rows.length
        : null,
    },
  });

  if (!payload) {
    return {
      clone: null,
      surfaceDate: snapshotDate,
      expiration,
      message:
        "Surface fallback could not generate an OI Field forecast payload.",
    };
  }

  return {
    surfaceDate: snapshotDate,
    expiration,
    message: "Forecast generated from latest Supabase surface.",
    clone: {
      symbol: args.symbol,
      user_id: args.userId,
      surface_snapshot_id: payload.surfaceSnapshotId ?? null,
      source: `forecast_harvest_${args.captureSession}`,
      capture_session: args.captureSession,
      capture_kind: args.captureKind,
      capture_run_id: args.runId,
      forecast_anchor_at: args.startedAt,
      provider: payload.provider ?? "supabase_surface_fallback",
      snapshot_date: snapshotDate,
      expiration,
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
      base_1d: finite(
        (payload.horizons ?? []).find((h: any) => h?.horizon === "1D")?.base,
      ),
      base_3d: finite(
        (payload.horizons ?? []).find((h: any) => h?.horizon === "3D")?.base,
      ),
      base_5d: finite(
        (payload.horizons ?? []).find((h: any) => h?.horizon === "5D")?.base,
      ),
      base_10d: finite(
        (payload.horizons ?? []).find((h: any) => h?.horizon === "10D")?.base,
      ),
      base_14d: finite(
        (payload.horizons ?? []).find((h: any) => h?.horizon === "14D")?.base,
      ),
      base_30d: finite(
        (payload.horizons ?? []).find((h: any) => h?.horizon === "30D")?.base,
      ),
      base_exp: finite(
        (payload.horizons ?? []).find((h: any) => h?.horizon === "EXP")?.base,
      ),
      upper_1d: finite(
        (payload.horizons ?? []).find((h: any) => h?.horizon === "1D")?.upper,
      ),
      upper_3d: finite(
        (payload.horizons ?? []).find((h: any) => h?.horizon === "3D")?.upper,
      ),
      upper_5d: finite(
        (payload.horizons ?? []).find((h: any) => h?.horizon === "5D")?.upper,
      ),
      upper_10d: finite(
        (payload.horizons ?? []).find((h: any) => h?.horizon === "10D")?.upper,
      ),
      upper_14d: finite(
        (payload.horizons ?? []).find((h: any) => h?.horizon === "14D")?.upper,
      ),
      upper_30d: finite(
        (payload.horizons ?? []).find((h: any) => h?.horizon === "30D")?.upper,
      ),
      upper_exp: finite(
        (payload.horizons ?? []).find((h: any) => h?.horizon === "EXP")?.upper,
      ),
      lower_1d: finite(
        (payload.horizons ?? []).find((h: any) => h?.horizon === "1D")?.lower,
      ),
      lower_3d: finite(
        (payload.horizons ?? []).find((h: any) => h?.horizon === "3D")?.lower,
      ),
      lower_5d: finite(
        (payload.horizons ?? []).find((h: any) => h?.horizon === "5D")?.lower,
      ),
      lower_10d: finite(
        (payload.horizons ?? []).find((h: any) => h?.horizon === "10D")?.lower,
      ),
      lower_14d: finite(
        (payload.horizons ?? []).find((h: any) => h?.horizon === "14D")?.lower,
      ),
      lower_30d: finite(
        (payload.horizons ?? []).find((h: any) => h?.horizon === "30D")?.lower,
      ),
      lower_exp: finite(
        (payload.horizons ?? []).find((h: any) => h?.horizon === "EXP")?.lower,
      ),
      pin_probability: finite(payload.pinProbability),
      upper_touch_probability: finite(payload.upperTouchProbability),
      lower_break_probability: finite(payload.lowerBreakProbability),
      trap_probability: finite(payload.trapProbability),
      wheel_support_hold_probability: finite(
        payload.wheelSupportHoldProbability,
      ),
      posture: payload.posture ?? null,
      inputs: payload.inputs ?? null,
      forecast: payload.forecast ?? null,
      engine_version: payload.engineVersion ?? "oi-field-v2",
      model_status: payload.modelStatus ?? "collecting",
      nn_model_version: payload.nnModelVersion ?? null,
      baseline_forecast: payload.baselineForecast ?? payload.forecast ?? null,
      feature_vector: payload.featureVector ?? payload.inputs ?? null,
      nn_adjustment: payload.nnAdjustment ?? null,
      final_forecast: payload.finalForecast ?? payload.forecast ?? null,
      training_eligible: payload.trainingEligible ?? true,
      outcome_status: payload.outcomeStatus ?? "waiting",
    },
  };
}

async function optionalRunInsert(payload: Record<string, unknown>) {
  const { data, error } = await supabaseServer
    .from("forecast_capture_runs")
    .insert(payload)
    .select("id")
    .maybeSingle();

  if (error) return { id: null as string | null, error: error.message };
  return {
    id: (data?.id as string | undefined) ?? null,
    error: null as string | null,
  };
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

function stripLegacyOnlyFields(row: Record<string, unknown>) {
  const clone = { ...row };

  // Deployment-safe fallback for older Supabase schemas.
  // If these columns do not exist yet, PostgREST rejects the entire insert/upsert.
  delete clone.capture_session;
  delete clone.capture_kind;
  delete clone.capture_run_id;
  delete clone.forecast_anchor_at;
  delete clone.engine_version;
  delete clone.model_status;
  delete clone.nn_model_version;
  delete clone.baseline_forecast;
  delete clone.feature_vector;
  delete clone.nn_adjustment;
  delete clone.final_forecast;
  delete clone.training_eligible;
  delete clone.outcome_status;

  return clone;
}

function isMissingHarvestColumn(error: unknown) {
  const message = dbErrorMessage(error);
  return /capture_session|capture_kind|capture_run_id|forecast_anchor_at|model_status|engine_version|nn_model_version|baseline_forecast|feature_vector|nn_adjustment|final_forecast|training_eligible|outcome_status|schema cache|column/i.test(
    message,
  );
}

async function loadSymbols(
  userId: string | null,
  requested: string[],
  limit: number,
) {
  if (requested.length) return requested.slice(0, limit);

  if (userId) {
    const { data } = await supabaseServer
      .from("user_watchlist_tickers")
      .select("symbol")
      .eq("user_id", userId)
      .order("slot_index", { ascending: true })
      .limit(limit);

    return uniqueSymbols(
      (data ?? []).map((row: { symbol?: unknown }) => row.symbol),
    );
  }

  const { data } = await supabaseServer
    .from("ticker_universe")
    .select("symbol")
    .eq("is_active", true)
    .order("data_priority", { ascending: true })
    .limit(limit);

  return uniqueSymbols(
    (data ?? []).map((row: { symbol?: unknown }) => row.symbol),
  );
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
    .upsert(stripLegacyOnlyFields(clone), {
      onConflict: "symbol,snapshot_date,expiration,source",
    })
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
  const requestSecret =
    request.headers.get("x-cron-secret") ??
    request.headers.get("x-wheeldesk-cron-secret");
  const isCron = Boolean(
    cronSecret && requestSecret && requestSecret === cronSecret,
  );

  let userId: string | null = null;
  if (!isCron) {
    try {
      const user = await getAuthenticatedUserFromRequest(request);
      userId = user.id;
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          error:
            error instanceof Error ? error.message : "Missing bearer token",
        },
        { status: 401 },
      );
    }
  }

  const body = (await request.json().catch(() => ({}))) as RequestBody;
  const captureSession = cleanSession(body.captureSession);
  const captureKind: CaptureKind = isCron ? "scheduled" : "manual_batch";
  const requestedSymbols = uniqueSymbols(
    Array.isArray(body.symbols) ? body.symbols : [],
  );
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
        .not("source", "like", "forecast_harvest_%")
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestError) throw new Error(latestError.message);

      let clone: Record<string, unknown> | null = null;
      let surfaceStatus: HarvestStageStatus = "skipped";
      let forecastStatus: HarvestStageStatus = "skipped";
      let surfaceDate: string | null = null;
      let expiration: string | null = null;
      let sourceMessage = "";

      if (latest) {
        surfaceStatus = "existing";
        forecastStatus = "existing";
        surfaceDate = dateOnly(
          (latest as Record<string, unknown>).snapshot_date,
        );
        expiration = dateOnly((latest as Record<string, unknown>).expiration);
        sourceMessage = "Forecast cloned from latest non-harvest baseline row.";
        clone = {
          ...stripIdentity(latest as Record<string, unknown>),
          source: `forecast_harvest_${captureSession}`,
          capture_session: captureSession,
          capture_kind: captureKind,
          capture_run_id: run.id,
          forecast_anchor_at: startedAt,
          outcome_status:
            (latest as Record<string, unknown>).outcome_status ?? "waiting",
          model_status:
            (latest as Record<string, unknown>).model_status ?? "collecting",
          training_eligible:
            (latest as Record<string, unknown>).training_eligible ?? true,
        };
      } else {
        const fallback = await buildForecastCloneFromLatestSurface({
          symbol,
          captureSession,
          captureKind,
          runId: run.id,
          startedAt,
          userId,
        });
        clone = fallback.clone;
        surfaceDate = fallback.surfaceDate;
        expiration = fallback.expiration;
        sourceMessage = fallback.message;
        surfaceStatus = fallback.surfaceDate ? "captured" : "missing";
        forecastStatus = fallback.clone ? "generated" : "failed";

        if (!clone) {
          failed += 1;
          const status =
            surfaceStatus === "missing"
              ? "missing_surface"
              : "missing_forecast";
          items.push({
            symbol,
            status,
            surfaceStatus,
            forecastStatus,
            saveStatus: "skipped",
            surfaceDate,
            expiration,
            message: sourceMessage,
          });
          if (run.id) {
            await optionalRunItemInsert({
              run_id: run.id,
              symbol,
              status,
              message: sourceMessage,
              started_at: itemStartedAt,
              completed_at: new Date().toISOString(),
            });
          }
          continue;
        }
      }

      const save = await upsertHarvestForecast(clone);
      if (save.error) throw new Error(save.error);
      if (!save.saved)
        throw new Error("Forecast harvest save did not return a row.");
      if (save.schemaMode === "legacy") legacySchemaCount += 1;

      captured += 1;
      const forecastId = save.saved.id ?? null;
      const itemStatus = latest ? "captured" : "generated_from_surface";
      const message =
        save.schemaMode === "legacy"
          ? `${sourceMessage} Saved using legacy forecast schema fallback.`
          : sourceMessage;
      items.push({
        symbol,
        status: itemStatus,
        surfaceStatus,
        forecastStatus,
        saveStatus: "captured",
        forecastId,
        surfaceDate,
        expiration,
        message,
      });
      if (run.id) {
        await optionalRunItemInsert({
          run_id: run.id,
          symbol,
          status: itemStatus,
          forecast_id: forecastId,
          message,
          started_at: itemStartedAt,
          completed_at: new Date().toISOString(),
        });
      }
    } catch (error) {
      failed += 1;
      const message =
        error instanceof Error ? error.message : "Forecast harvest failed.";
      items.push({
        symbol,
        status: "failed",
        surfaceStatus: "failed",
        forecastStatus: "failed",
        saveStatus: "failed",
        message,
      });
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
