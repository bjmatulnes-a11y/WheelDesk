import { NextResponse } from "next/server";
import { loadSchwabTokens } from "../../../../../lib/schwab/token-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const tokens = await loadSchwabTokens();
    return NextResponse.json({
      ok: true,
      connected: Boolean(tokens),
      accessExpiresAt: tokens?.expires_at ?? null,
      refreshExpiresAt: tokens?.refresh_expires_at ?? null,
      updatedAt: tokens?.updated_at ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, connected: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
