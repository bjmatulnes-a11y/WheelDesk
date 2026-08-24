import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "../../../../../lib/billing/auth-request";
import { buildSchwabAuthorizeUrl } from "../../../../../lib/schwab/client";
import { createSchwabOAuthState } from "../../../../../lib/schwab/oauth-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUserFromRequest(request);
    const state = createSchwabOAuthState(user.id);
    return NextResponse.json(
      { ok: true, authorizeUrl: buildSchwabAuthorizeUrl(state) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Authentication required.",
      },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
}
