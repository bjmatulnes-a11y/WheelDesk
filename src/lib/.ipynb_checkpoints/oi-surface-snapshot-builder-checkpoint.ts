import {
  ChainSnapshotEntry,
  DailyStructureSnapshot,
  OptionSurfaceSnapshot,
  getSnapshotDateInTimeZone,
  makeSurfaceSnapshotKey,
  normalizeTicker
} from "./wheeldesk-storage";

export function buildOptionSurfaceSnapshot(args: {
  ticker: string;
  snapshotTimeZone: string;
  chains: ChainSnapshotEntry[];
  dailyStructure: DailyStructureSnapshot;
  price?: {
    date?: string;
    open?: number;
    high?: number;
    low?: number;
    close?: number;
    volume?: number;
  };
  captureDate?: Date;
}): OptionSurfaceSnapshot {
  const captureDate = args.captureDate ?? new Date();
  const ticker = normalizeTicker(args.ticker);

  const snapshotDate =
    args.dailyStructure.snapshotDate ??
    args.price?.date ??
    getSnapshotDateInTimeZone(captureDate, args.snapshotTimeZone);

  const surfaceKey = makeSurfaceSnapshotKey({
    ticker,
    snapshotDate
  });

  return {
    surfaceKey,
    ticker,
    snapshotDate,
    snapshotTimeZone: args.snapshotTimeZone,
    capturedAt: captureDate.toISOString(),
    price: args.price,
    chains: args.chains.map((chain) => ({
      ...chain,
      ticker,
      snapshotDate
    })),
    dailyStructure: {
      ...args.dailyStructure,
      ticker,
      snapshotDate
    },
    createdAt: captureDate.toISOString(),
    updatedAt: captureDate.toISOString()
  };
}