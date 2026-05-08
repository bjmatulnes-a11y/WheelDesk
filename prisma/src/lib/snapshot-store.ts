import { ChainSnapshot, ChainSnapshotEntry, SupportedTicker } from "./types";
import { createLocalPersistenceAdapter } from "./storage";

const adapter = createLocalPersistenceAdapter();

export function makeSnapshotKey(symbol: SupportedTicker, date: string, expiration: string): string {
  return `${symbol.toUpperCase()}__${date}__${expiration}`;
}

export function saveChainSnapshot(snapshot: ChainSnapshot): void {
  adapter.saveSnapshot(snapshot);
}

export function saveChainSnapshotEntry(snapshot: ChainSnapshotEntry): void {
  adapter.saveChainSnapshot(snapshot);
}

export function getSavedSnapshots(symbol: SupportedTicker): ChainSnapshot[] {
  return adapter.listSnapshots(symbol);
}

export function getSavedSnapshot(symbol: SupportedTicker, date: string): ChainSnapshot | undefined {
  return adapter.getSnapshot(symbol, date);
}

export function getSavedChainSnapshots(symbol: SupportedTicker, expiration?: string): ChainSnapshotEntry[] {
  return adapter.listChainSnapshots(symbol, expiration);
}

export function deleteSavedChainSnapshots(symbol: SupportedTicker, expiration: string): number {
  return adapter.deleteChainSnapshots(symbol, expiration);
}
