import { NextRequest, NextResponse } from "next/server";
import { exchangeSchwabCode } from "../../../../../lib/schwab/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const returnedState = request.nextUrl.searchParams.get("state");
  const storedState = request.cookies.get("schwab_oauth_state")?.value;
  const oauthError = request.nextUrl.searchParams.get("error");

  if (oauthError) {
    return NextResponse.json(
      { ok: false, error: `Schwab authorization failed: ${oauthError}` },
      { status: 400 },
    );
  }

  if (!code || !returnedState || !storedState || returnedState !== storedState) {
    return NextResponse.json(
      { ok: false, error: "Invalid or expired Schwab OAuth callback state." },
      { status: 400 },
    );
  }

  try {
    await exchangeSchwabCode(code);
    const response = NextResponse.redirect(
      new URL("/zero-dte?schwab=connected", request.url),
    );
    response.cookies.delete("schwab_oauth_state");
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
