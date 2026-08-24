import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "../../../../../lib/billing/auth-request";
import { loadSchwabTokens } from "../../../../../lib/schwab/token-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUserFromRequest(request);
    const tokens = await loadSchwabTokens(user.id);
    const refreshExpired = Boolean(
      tokens?.refresh_expires_at && Date.parse(tokens.refresh_expires_at) <= Date.now(),
    );
    return NextResponse.json(
      {
        ok: true,
        connected: Boolean(tokens) && !refreshExpired,
        needsReconnect: refreshExpired,
        accessExpiresAt: tokens?.expires_at ?? null,
        refreshExpiresAt: tokens?.refresh_expires_at ?? null,
        updatedAt: tokens?.updated_at ?? null,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, connected: false, error: error instanceof Error ? error.message : String(error) },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
