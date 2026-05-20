import { NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabase-server";
import { getAuthenticatedUserFromRequest } from "../../../../lib/billing/auth-request";
import { normalizeSymbol } from "../../../../lib/ticker-entitlements";
import {
  dateOnly,
  finiteNumber,
  FORECAST_HORIZONS,
  horizonByKey,
  type ForecastHorizonKey,
  type OIFieldForecastPayload,
} from "../../../../lib/oi-forecast-types";

export const runtime = "nodejs";

function fieldFromHorizon(payload: OIFieldForecastPayload, key: ForecastHorizonKey, field: "base" | "upper" | "lower") {
  return finiteNumber(horizonByKey(payload, key)?.[field]);
}

function toDbPayload(payload: OIFieldForecastPayload, userId: string | null) {
  const symbol = normalizeSymbol(payload.symbol);
  const snapshotDate = dateOnly(payload.snapshotDate) ?? new Date().toISOString().slice(0, 10);
  const expiration = dateOnly(payload.expiration);

  return {
    symbol,
    user_id: userId,
    surface_snapshot_id: payload.surfaceSnapshotId ?? null,
    source: payload.source ?? "control_center",
    provider: payload.provider ?? null,
    snapshot_date: snapshotDate,
    expiration,
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
    forecast: payload.forecast ?? { horizons: payload.horizons ?? FORECAST_HORIZONS.map((horizon) => ({ horizon })) },
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = normalizeSymbol(searchParams.get("symbol"));
  const limit = Math.min(Number(searchParams.get("limit") ?? 25), 100);

  try {
    let query = supabaseServer
      .from("oi_field_forecasts")
      .select("*")
      .order("generated_at", { ascending: false })
      .limit(limit);

    if (symbol) query = query.eq("symbol", symbol);

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, forecasts: data ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load OI field forecasts.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUserFromRequest(request).catch(() => null);
    const payload = (await request.json()) as OIFieldForecastPayload;
    const dbPayload = toDbPayload(payload, user?.id ?? null);

    if (!dbPayload.symbol) {
      return NextResponse.json({ ok: false, error: "Forecast symbol is required." }, { status: 400 });
    }

    if (dbPayload.spot === null) {
      return NextResponse.json({ ok: false, error: "Forecast spot price is required." }, { status: 400 });
    }

    const { data: universeRow } = await supabaseServer
      .from("ticker_universe")
      .select("symbol")
      .eq("symbol", dbPayload.symbol)
      .maybeSingle();

    if (!universeRow) {
      await supabaseServer.from("ticker_universe").upsert(
        {
          symbol: dbPayload.symbol,
          name: dbPayload.symbol,
          asset_type: "stock",
          is_active: true,
          data_priority: 500,
          notes: "Auto-added from OI forecast capture.",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "symbol" },
      );
    }

    const { data, error } = await supabaseServer
      .from("oi_field_forecasts")
      .upsert(dbPayload, { onConflict: "symbol,snapshot_date,expiration,source" })
      .select("id,symbol,snapshot_date,expiration,generated_at")
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, forecast: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save OI field forecast.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
