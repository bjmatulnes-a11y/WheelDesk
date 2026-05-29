import { NextResponse } from "next/server";
import { supabaseServer } from "../../../../lib/supabase-server";

export const runtime = "nodejs";

type CountResult = { count: number | null; error: { message: string } | null };

async function tableCount(table: string, filter?: (query: any) => any): Promise<number> {
  let query = supabaseServer.from(table).select("id", { count: "exact", head: true });
  if (filter) query = filter(query);
  const result = (await query) as CountResult;
  if (result.error) return 0;
  return result.count ?? 0;
}

async function safeFilteredCount(table: string, filter: (query: any) => any): Promise<{ count: number; ok: boolean; error?: string }> {
  let query = supabaseServer.from(table).select("id", { count: "exact", head: true });
  query = filter(query);
  const result = (await query) as CountResult;
  if (result.error) return { count: 0, ok: false, error: result.error.message };
  return { count: result.count ?? 0, ok: true };
}

export async function GET() {
  try {
    const [surfaceSnapshots, forecastRows, waitingResult, partialResult, maturedResult] = await Promise.all([
      tableCount("option_surface_snapshots"),
      tableCount("oi_field_forecasts"),
      safeFilteredCount("oi_field_forecasts", (q) => q.eq("outcome_status", "waiting")),
      safeFilteredCount("oi_field_forecasts", (q) => q.eq("outcome_status", "partial")),
      safeFilteredCount("oi_field_forecasts", (q) => q.eq("outcome_status", "matured")),
    ]);

    const collectingResult = await safeFilteredCount("oi_field_forecasts", (q) => q.eq("model_status", "collecting"));
    const activeResult = await safeFilteredCount("oi_field_forecasts", (q) => q.eq("model_status", "active"));

    // Legacy Supabase schemas do not have model_status yet. In that case the app should not
    // fail readiness; it should report baseline/collecting mode until the NN migration is applied.
    const modelStatusSupported = collectingResult.ok && activeResult.ok;
    const collecting = modelStatusSupported ? collectingResult.count : forecastRows;
    const active = modelStatusSupported ? activeResult.count : 0;

    const waiting = waitingResult.ok ? waitingResult.count : 0;
    const partial = partialResult.ok ? partialResult.count : 0;
    const matured = maturedResult.ok ? maturedResult.count : 0;

    const { data: outcomes, error: outcomesError } = await supabaseServer
      .from("oi_field_forecast_outcomes")
      .select("horizon")
      .limit(20000);

    const horizonCounts = outcomesError
      ? {}
      : (outcomes ?? []).reduce<Record<string, number>>((acc, row: any) => {
          const key = String(row?.horizon ?? "unknown").toUpperCase();
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {});

    const neuralStatus = !modelStatusSupported
      ? "collecting_baseline_only"
      : active > 0
        ? "active"
        : matured >= 500
          ? "eligible"
          : matured >= 100
            ? "research_preview"
            : "collecting";

    return NextResponse.json({
      ok: true,
      surfaceSnapshots,
      captured: forecastRows,
      waiting,
      partial,
      matured,
      collecting,
      active,
      horizonCounts,
      neuralStatus,
      schema: {
        modelStatusSupported,
        outcomeStatusSupported: waitingResult.ok && partialResult.ok && maturedResult.ok,
        notes: modelStatusSupported
          ? []
          : ["model_status column is not present; using baseline OI Field forecasts until NN schema migration is applied."],
      },
      thresholds: {
        collecting: "< 100 matured outcomes",
        research_preview: "100–499 matured outcomes",
        eligible: "500+ matured outcomes and out-of-sample improvement required",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load forecast harvest readiness.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
