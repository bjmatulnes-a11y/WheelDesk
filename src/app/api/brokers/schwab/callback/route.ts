import { NextRequest, NextResponse } from "next/server";
import { exchangeSchwabCode } from "../../../../../lib/schwab/client";
import { verifySchwabOAuthState } from "../../../../../lib/schwab/oauth-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const returnedState = request.nextUrl.searchParams.get("state");
  const oauthError = request.nextUrl.searchParams.get("error");
  const oauthErrorDescription = request.nextUrl.searchParams.get("error_description");

  if (oauthError) {
    return NextResponse.json(
      {
        ok: false,
        error: `Schwab authorization failed: ${oauthError}${
          oauthErrorDescription ? ` — ${oauthErrorDescription}` : ""
        }`,
      },
      { status: 400 },
    );
  }

  if (!code) {
    return NextResponse.json(
      { ok: false, error: "Schwab callback did not include an authorization code." },
      { status: 400 },
    );
  }

  const verifiedState = verifySchwabOAuthState(returnedState);
  if (!verifiedState) {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid or expired Schwab OAuth callback state. Start again from WheelDesk.",
      },
      { status: 400 },
    );
  }

  try {
    await exchangeSchwabCode(code, verifiedState.userId);
    return NextResponse.redirect(new URL("/zero-dte?schwab=connected", request.url));
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
