import { OIProjectionPoint, ProjectionBias } from "./oi-projection-engine";
import { PrevailingLevels } from "./oi-prevailing-levels";

const KEY_PREFIX = "wheelDesk.dailyStructure";

export type DailyStructureSnapshot = {
  ticker: string;
  snapshotDate: string;
  spot: number;
  projectedBias: ProjectionBias;
  confidence: "low" | "medium" | "high";
  slope: number;
  spotOffset: number;
  curveDelta: number;
  magnet: number;
  support: number | null;
  resistance: number | null;
  supportOi: number | null;
  resistanceOi: number | null;
  projectionPoints: OIProjectionPoint[];
  createdAt: string;
};

function key(ticker: string): string {
  return `${KEY_PREFIX}.${ticker.toUpperCase()}`;
}

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function saveDailyStructureSnapshot(snapshot: DailyStructureSnapshot): void {
  if (typeof window === "undefined") return;

  const existing = listDailyStructureSnapshots(snapshot.ticker);
  const next = [
    snapshot,
    ...existing.filter((s) => s.snapshotDate !== snapshot.snapshotDate)
  ].sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));

  window.localStorage.setItem(key(snapshot.ticker), JSON.stringify(next));
}

export function listDailyStructureSnapshots(ticker: string): DailyStructureSnapshot[] {
  if (typeof window === "undefined") return [];

  const rows = safeParse<DailyStructureSnapshot[]>(window.localStorage.getItem(key(ticker)));
  return Array.isArray(rows) ? rows : [];
}

export function getDailyStructureSnapshot(
  ticker: string,
  snapshotDate: string
): DailyStructureSnapshot | undefined {
  return listDailyStructureSnapshots(ticker).find((s) => s.snapshotDate === snapshotDate);
}

export function buildDailyStructureSnapshot(args: {
  ticker: string;
  snapshotDate: string;
  spot: number;
  projection: {
    projectedBias: ProjectionBias;
    confidence: "low" | "medium" | "high";
    slope: number;
    spotOffset: number;
    curveDelta: number;
    points: OIProjectionPoint[];
  };
  prevailingLevels: PrevailingLevels | null;
}): DailyStructureSnapshot {
  return {
    ticker: args.ticker.toUpperCase(),
    snapshotDate: args.snapshotDate,
    spot: args.spot,
    projectedBias: args.projection.projectedBias,
    confidence: args.projection.confidence,
    slope: args.projection.slope,
    spotOffset: args.projection.spotOffset,
    curveDelta: args.projection.curveDelta,
    magnet: args.prevailingLevels?.magnet.strike ?? args.spot,
    support: args.prevailingLevels?.support?.strike ?? null,
    resistance: args.prevailingLevels?.resistance?.strike ?? null,
    supportOi: args.prevailingLevels?.support?.openInterest ?? null,
    resistanceOi: args.prevailingLevels?.resistance?.openInterest ?? null,
    projectionPoints: args.projection.points,
    createdAt: new Date().toISOString()
  };
}