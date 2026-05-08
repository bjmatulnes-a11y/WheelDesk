import { ChainSnapshotEntry, ExpirationSummary } from "./types";

export type SnapshotStructurePoint = {
  snapshotDate: string;
  snapshotTs: number;
  summary: ExpirationSummary;
  role: "primary" | "compare";
  expirationUsed: string;
  matchType: "exact" | "fallback_nearest_expiration";
};

export function buildSnapshotStructureSeries(args: {
  snapshots: ChainSnapshotEntry[];
  role: "primary" | "compare";
  maxSnapshotDate?: string;
}): SnapshotStructurePoint[] {
  const { snapshots, role, maxSnapshotDate } = args;
  return snapshots
    .filter((snap) => !maxSnapshotDate || snap.snapshotDate <= maxSnapshotDate)
    .map((snap) => {
      const snapshotTs = new Date(`${snap.snapshotDate}T00:00:00Z`).getTime();

      return {
        snapshotDate: snap.snapshotDate,
        snapshotTs,
        summary: snap.summary,
        role,
        expirationUsed: snap.expiration,
        matchType: "exact"
      } satisfies SnapshotStructurePoint;
    })
    .filter((v) => Number.isFinite(v.snapshotTs))
    .sort((a, b) => a.snapshotTs - b.snapshotTs);
}
