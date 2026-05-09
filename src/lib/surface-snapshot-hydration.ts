import { readSurfaceSnapshotsViaApi } from "./surface-snapshot-api-client";
import {
  mergeOptionSurfaceSnapshotsIntoLocalCache,
  type OptionSurfaceSnapshot,
} from "./wheeldesk-storage";

export type SurfaceSnapshotHydrationResult = {
  ticker: string;
  fetched: number;
  added: number;
  updated: number;
  total: number;
  snapshots: OptionSurfaceSnapshot[];
};

export async function hydrateSurfaceSnapshotsFromSupabase(
  ticker: string,
  limit = 50
): Promise<SurfaceSnapshotHydrationResult> {
  const normalizedTicker = String(ticker ?? "").trim().toUpperCase();

  if (!normalizedTicker) {
    return {
      ticker: "",
      fetched: 0,
      added: 0,
      updated: 0,
      total: 0,
      snapshots: [],
    };
  }

  const snapshots = await readSurfaceSnapshotsViaApi(normalizedTicker, limit);
  const merge = mergeOptionSurfaceSnapshotsIntoLocalCache(snapshots);

  return {
    ticker: normalizedTicker,
    fetched: snapshots.length,
    added: merge.added,
    updated: merge.updated,
    total: merge.total,
    snapshots,
  };
}