import { NextRequest, NextResponse } from "next/server";
import { getDailyLeadershipWeightSnapshot } from "../../../../../lib/zeroDteLeadershipWeights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const tradeDate =
    request.nextUrl.searchParams.get("date") ??
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  try {
    const snapshot = await getDailyLeadershipWeightSnapshot({
      tradeDate,
      forceRefresh,
    });
    return NextResponse.json({ ok: true, snapshot }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
