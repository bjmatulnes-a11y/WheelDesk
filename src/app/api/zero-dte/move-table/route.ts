import { NextRequest, NextResponse } from "next/server";
import { requirePlanAccessFromRequest } from "../../../../lib/billing/server-access";
import { loadMoveTableState } from "../../../../lib/zeroDteMoveTableRepository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const access = await requirePlanAccessFromRequest(request, "research");
  if ("response" in access) return access.response;

  try {
    const state = await loadMoveTableState();
    if (!state) {
      return NextResponse.json(
        {
          ok: true,
          source: "none",
          table: null,
          observationCount: 0,
          distinctDayCount: 0,
          sourceMix: { SCHWAB_1M: 0, SCHWAB_30M: 0 },
          lastCaptureDate: null,
          capture: null,
          stale: true,
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return NextResponse.json({ ok: true, ...state }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
