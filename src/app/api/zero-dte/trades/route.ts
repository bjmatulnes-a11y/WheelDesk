import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "../../../../lib/billing/auth-request";
import { supabaseServer } from "../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status = 500) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function n(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function s(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  return raw || null;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUserFromRequest(request);
    const limitRaw = request.nextUrl.searchParams.get("limit");
    const limit = Math.min(Math.max(Number(limitRaw || 25), 1), 100);

    const { data, error } = await supabaseServer
      .from("zero_dte_lab_trades")
      .select("*")
      .eq("user_id", user.id)
      .order("entry_time", { ascending: false })
      .limit(limit);

    if (error) return jsonError(error.message, 500);
    return NextResponse.json({ ok: true, trades: data ?? [] });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unknown trade read error", 401);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUserFromRequest(request);
    const body = await request.json();

    const snapshotId = s(body?.snapshotId);
    const tradeDate = s(body?.tradeDate);
    const expirationDate = s(body?.expirationDate);
    const strategy = s(body?.strategy) ?? "iron_fly";

    if (!snapshotId) return jsonError("Missing snapshotId", 400);
    if (!tradeDate) return jsonError("Missing tradeDate", 400);
    if (!expirationDate) return jsonError("Missing expirationDate", 400);

    const payload = {
      user_id: user.id,
      snapshot_id: snapshotId,
      trade_date: tradeDate,
      expiration_date: expirationDate,
      strategy,
      status: "planned",
      entry_time: new Date().toISOString(),
      suggested_center: n(body?.suggestedCenter),
      actual_center: n(body?.actualCenter),
      wing_width: n(body?.wingWidth),
      lower_wing: n(body?.lowerWing),
      upper_wing: n(body?.upperWing),
      credit_received: n(body?.creditReceived),
      notes: s(body?.notes),
    };

    const { data, error } = await supabaseServer
      .from("zero_dte_lab_trades")
      .insert(payload)
      .select("*")
      .maybeSingle();

    if (error) return jsonError(error.message, 500);
    return NextResponse.json({ ok: true, trade: data });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unknown trade save error", 500);
  }
}
