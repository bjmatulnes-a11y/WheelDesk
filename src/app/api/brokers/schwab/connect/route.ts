import { NextResponse } from "next/server";
import { buildSchwabAuthorizeUrl } from "../../../../../lib/schwab/client";
import { createSchwabOAuthState } from "../../../../../lib/schwab/oauth-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const state = createSchwabOAuthState();
  return NextResponse.redirect(buildSchwabAuthorizeUrl(state));
}
