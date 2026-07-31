import { NextRequest, NextResponse } from "next/server";
import { buildSchwabAuthorizeUrl } from "../../../../../lib/schwab/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const state = crypto.randomUUID();
  const response = NextResponse.redirect(buildSchwabAuthorizeUrl(state));

  response.cookies.set("schwab_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return response;
}
