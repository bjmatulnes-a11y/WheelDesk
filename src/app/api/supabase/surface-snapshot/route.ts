import { NextRequest, NextResponse } from "next/server";
import {
  deleteSurfaceSnapshotFromSupabase,
  readLatestSurfaceSnapshotFromSupabase,
  readSurfaceSnapshotsFromSupabase,
  saveSurfaceSnapshotToSupabase,
} from "../../../../lib/supabase-surface-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(message: string, status = 500) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
    },
    { status }
  );
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const ticker = searchParams.get("ticker");
    const latest = searchParams.get("latest") === "1";
    const limitRaw = searchParams.get("limit");

    if (!ticker) {
      return errorResponse("Missing required query parameter: ticker", 400);
    }

    if (latest) {
      const snapshot = await readLatestSurfaceSnapshotFromSupabase(ticker);

      return NextResponse.json({
        ok: true,
        mode: "latest",
        ticker: ticker.toUpperCase(),
        snapshot,
      });
    }

    const limit = limitRaw ? Number(limitRaw) : 50;

    const snapshots = await readSurfaceSnapshotsFromSupabase(
      ticker,
      Number.isFinite(limit) && limit > 0 ? limit : 50
    );

    return NextResponse.json({
      ok: true,
      mode: "list",
      ticker: ticker.toUpperCase(),
      count: snapshots.length,
      snapshots,
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Unknown Supabase read error"
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const snapshot = body?.snapshot ?? body;

    if (!snapshot || typeof snapshot !== "object") {
      return errorResponse("Missing option surface snapshot payload", 400);
    }

    const result = await saveSurfaceSnapshotToSupabase(snapshot);

    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Unknown Supabase save error"
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const ticker = searchParams.get("ticker");
    const snapshotDate = searchParams.get("snapshotDate");
    const surfaceKey = searchParams.get("surfaceKey");

    if (!ticker || !snapshotDate || !surfaceKey) {
      return errorResponse(
        "Missing required query parameters: ticker, snapshotDate, surfaceKey",
        400
      );
    }

    await deleteSurfaceSnapshotFromSupabase({
      ticker,
      snapshotDate,
      surfaceKey,
    });

    return NextResponse.json({
      ok: true,
      deleted: {
        ticker: ticker.toUpperCase(),
        snapshotDate,
        surfaceKey,
      },
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Unknown Supabase delete error"
    );
  }
}