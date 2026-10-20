import { NextRequest, NextResponse } from "next/server";
import { requirePlanAccessFromRequest } from "../../../../../lib/billing/server-access";
import { supabaseServer } from "../../../../../lib/supabase-server";
import { captureZeroDteMoveTableEod } from "../../../../../lib/zeroDteMoveTableRefresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}

async function handle(request: NextRequest) {
  try {
    const cron = isAuthorizedCron(request);
    let userId: string;

    if (cron) {
      userId = await resolveCronHistoryUserId();
    } else {
      const access = await requirePlanAccessFromRequest(request, "research");
      if ("response" in access) return access.response;
      if (access.access.role !== "admin") {
        return NextResponse.json({ ok: false, error: "Admin access is required to run a manual move-table capture." }, { status: 403 });
      }
      userId = access.access.user.id;
    }

    const result = await captureZeroDteMoveTableEod({ userId });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

function isAuthorizedCron(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.replace(/^Bearer\s+/i, "").trim();
  const explicit = request.headers.get("x-cron-secret") ?? request.headers.get("x-wheeldesk-cron-secret") ?? "";
  return bearer === secret || explicit === secret;
}

async function resolveCronHistoryUserId(): Promise<string> {
  const configured = process.env.MOVE_TABLE_SCHWAB_USER_ID?.trim() || process.env.ZERO_DTE_HISTORY_USER_ID?.trim();
  if (configured) return configured;

  const { data, error } = await supabaseServer
    .from("broker_connections")
    .select("user_id,updated_at")
    .eq("provider", "schwab")
    .order("updated_at", { ascending: false })
    .limit(3);
  if (error) throw new Error(`Unable to resolve Schwab history owner: ${error.message}`);

  const userIds: string[] = [...new Set<string>((data ?? []).map((row: any) => String(row.user_id ?? "")).filter((value: string) => Boolean(value)))];
  if (userIds.length === 1) return userIds[0]!;
  if (userIds.length === 0) throw new Error("No connected Schwab user is available for the EOD move-table capture.");
  throw new Error("Multiple Schwab users are connected. Set MOVE_TABLE_SCHWAB_USER_ID in Vercel.");
}
