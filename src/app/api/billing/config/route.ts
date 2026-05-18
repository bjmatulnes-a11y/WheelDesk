import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "../../../../lib/billing/auth-request";
import { getBillingConfigStatus } from "../../../../lib/billing/stripe-server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await getAuthenticatedUserFromRequest(request);
    return NextResponse.json({ ok: true, ...getBillingConfigStatus() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read billing config.";
    return NextResponse.json({ ok: false, error: message }, { status: 401 });
  }
}
