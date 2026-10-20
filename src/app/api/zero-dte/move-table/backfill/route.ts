import { NextRequest, NextResponse } from "next/server";
import { requirePlanAccessFromRequest } from "../../../../../lib/billing/server-access";
import { backfillZeroDteMoveTable30m, refreshDailyMoveFallback } from "../../../../../lib/zeroDteMoveTableRefresh";
import { moveTableCoverageReport, rebuildAndSaveMoveTable } from "../../../../../lib/zeroDteMoveTableRepository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const access = await requirePlanAccessFromRequest(request, "research");
  if ("response" in access) return access.response;
  if (access.access.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Admin access is required for the historical backfill." }, { status: 403 });
  }

  try {
    const rawDays = Number(request.nextUrl.searchParams.get("days") ?? "180");
    const days = Number.isFinite(rawDays) ? Math.max(30, Math.min(220, Math.floor(rawDays))) : 180;
    const backfill = await backfillZeroDteMoveTable30m({ userId: access.access.user.id, lookbackDays: days });
    const dailyRowsWritten = await refreshDailyMoveFallback({ userId: access.access.user.id });
    const state = await rebuildAndSaveMoveTable();
    const coverage = await moveTableCoverageReport();
    return NextResponse.json({
      ok: true,
      backfill,
      dailyRowsWritten,
      sessionCount: state.table.sessionCount,
      observationCount: state.observationCount,
      sourceMix: state.sourceMix,
      coverage,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
