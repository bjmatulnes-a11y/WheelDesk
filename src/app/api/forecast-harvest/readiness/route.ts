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

export async function GET() {
  try {
    const [captured, waiting, partial, matured, collecting, active] = await Promise.all([
      tableCount("oi_field_forecasts"),
      tableCount("oi_field_forecasts", (q) => q.eq("outcome_status", "waiting")),
      tableCount("oi_field_forecasts", (q) => q.eq("outcome_status", "partial")),
      tableCount("oi_field_forecasts", (q) => q.eq("outcome_status", "matured")),
      tableCount("oi_field_forecasts", (q) => q.eq("model_status", "collecting")),
      tableCount("oi_field_forecasts", (q) => q.eq("model_status", "active")),
    ]);

    const { data: outcomes } = await supabaseServer
      .from("oi_field_forecast_outcomes")
      .select("horizon")
      .limit(20000);

    const horizonCounts = (outcomes ?? []).reduce<Record<string, number>>((acc, row: any) => {
      const key = String(row?.horizon ?? "unknown").toUpperCase();
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

    const neuralStatus = active > 0
      ? "active"
      : matured >= 500
        ? "eligible"
        : matured >= 100
          ? "research_preview"
          : "collecting";

    return NextResponse.json({
      ok: true,
      captured,
      waiting,
      partial,
      matured,
      collecting,
      active,
      horizonCounts,
      neuralStatus,
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
