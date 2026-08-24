import { NextRequest, NextResponse } from "next/server";
import {
  deleteSurfaceSnapshotFromSupabase,
  readAllSurfaceSnapshotsFromSupabase,
  readLatestSurfaceMetadataFromSupabase,
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
    const metadataOnly = searchParams.get("metadata") === "1";
    const mode = searchParams.get("mode");
    const limitRaw = searchParams.get("limit");

    const limit = limitRaw ? Number(limitRaw) : 50;
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 500) : 50;

    if (!ticker && mode === "list") {
      const snapshots = await readAllSurfaceSnapshotsFromSupabase(safeLimit);
      const tickers = Array.from(new Set(snapshots.map((snapshot: any) => String(snapshot.ticker ?? "").toUpperCase()).filter(Boolean))).sort();

      return NextResponse.json({
        ok: true,
        mode: "list",
        count: snapshots.length,
        tickers,
        tickerHints: tickers,
        snapshots,
      });
    }

    if (!ticker) {
      return errorResponse("Missing required query parameter: ticker. Use mode=list to read all stored surfaces.", 400);
    }

    if (latest && metadataOnly) {
      const metadata = await readLatestSurfaceMetadataFromSupabase(ticker);

      return NextResponse.json(
        {
          ok: true,
          mode: "metadata",
          ticker: ticker.toUpperCase(),
          metadata,
        },
        { headers: { "Cache-Control": "private, max-age=60" } },
      );
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

    const snapshots = await readSurfaceSnapshotsFromSupabase(
      ticker,
      safeLimit
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