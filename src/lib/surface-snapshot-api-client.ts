import type { OptionSurfaceSnapshot } from "./wheeldesk-storage";

export type SurfaceSnapshotApiSaveResult = {
  snapshotId: string;
  ticker: string;
  snapshotDate: string;
  surfaceKey: string;
  chainRowCount: number;
};

type SurfaceSnapshotListResponse = {
  ok: boolean;
  mode: "list";
  ticker: string;
  count: number;
  snapshots: OptionSurfaceSnapshot[];
  error?: string;
};

type SurfaceSnapshotLatestResponse = {
  ok: boolean;
  mode: "latest";
  ticker: string;
  snapshot: OptionSurfaceSnapshot | null;
  error?: string;
};

type SurfaceSnapshotSaveResponse = {
  ok: boolean;
  result?: SurfaceSnapshotApiSaveResult;
  error?: string;
};

async function readJsonOrThrow<T>(response: Response): Promise<T> {
  let payload: any = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(
      payload?.error ??
        `Surface snapshot API failed: ${response.status} ${response.statusText}`
    );
  }

  return payload as T;
}

export async function saveSurfaceSnapshotViaApi(
  snapshot: OptionSurfaceSnapshot
): Promise<SurfaceSnapshotApiSaveResult> {
  const response = await fetch("/api/supabase/surface-snapshot", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ snapshot }),
  });

  const payload = await readJsonOrThrow<SurfaceSnapshotSaveResponse>(response);

  if (!payload.ok || !payload.result) {
    throw new Error(payload.error ?? "Failed to save surface snapshot.");
  }

  return payload.result;
}

export async function readSurfaceSnapshotsViaApi(
  ticker: string,
  limit = 50
): Promise<OptionSurfaceSnapshot[]> {
  const params = new URLSearchParams({
    ticker,
    limit: String(limit),
  });

  const response = await fetch(
    `/api/supabase/surface-snapshot?${params.toString()}`,
    {
      method: "GET",
      cache: "no-store",
    }
  );

  const payload = await readJsonOrThrow<SurfaceSnapshotListResponse>(response);

  if (!payload.ok) {
    throw new Error(payload.error ?? "Failed to read surface snapshots.");
  }

  return payload.snapshots ?? [];
}

export async function readLatestSurfaceSnapshotViaApi(
  ticker: string
): Promise<OptionSurfaceSnapshot | null> {
  const params = new URLSearchParams({
    ticker,
    latest: "1",
  });

  const response = await fetch(
    `/api/supabase/surface-snapshot?${params.toString()}`,
    {
      method: "GET",
      cache: "no-store",
    }
  );

  const payload = await readJsonOrThrow<SurfaceSnapshotLatestResponse>(response);

  if (!payload.ok) {
    throw new Error(payload.error ?? "Failed to read latest surface snapshot.");
  }

  return payload.snapshot ?? null;
}