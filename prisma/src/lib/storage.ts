import { ChainSnapshot, ChainSnapshotEntry, DashboardPreferences, PositionRecord, SupportedTicker } from "./types";

type EntityBase = { ticker: SupportedTicker; ownerId?: string };

export type PersistenceAdapter = {
  listSnapshots(ticker: SupportedTicker): ChainSnapshot[];
  getSnapshot(ticker: SupportedTicker, snapshotDate: string): ChainSnapshot | undefined;
  saveSnapshot(snapshot: ChainSnapshot): void;
  listChainSnapshots(ticker: SupportedTicker, expiration?: string): ChainSnapshotEntry[];
  getChainSnapshot(ticker: SupportedTicker, snapshotDate: string, expiration: string): ChainSnapshotEntry | undefined;
  saveChainSnapshot(snapshot: ChainSnapshotEntry): void;
  deleteChainSnapshots(ticker: SupportedTicker, expiration: string): number;
  savePosition(record: PositionRecord): void;
  getPosition(ticker: SupportedTicker): PositionRecord | undefined;
  savePreferences(ticker: SupportedTicker, preferences: DashboardPreferences): void;
  getPreferences(ticker: SupportedTicker): DashboardPreferences | undefined;
  saveWatchlist(tickers: SupportedTicker[], ownerId?: string): void;
  getWatchlist(ownerId?: string): SupportedTicker[];
};

type StoreShape = {
  chainSnapshots: ChainSnapshotEntry[];
  snapshots: ChainSnapshot[];
  positions: PositionRecord[];
  preferences: DashboardPreferences[];
  watchlists: Array<{ ownerId?: string; tickers: SupportedTicker[] }>;
};

const STORAGE_KEY = "wheeldesk_storage_v1";

function normalizeTicker(ticker: string): SupportedTicker {
  return ticker.toUpperCase();
}

function chainSnapshotKey(ticker: SupportedTicker, snapshotDate: string, expiration: string): string {
  return `${normalizeTicker(ticker)}__${snapshotDate}__${expiration}`;
}

function inferDte(snapshotDate: string, expiration: string): number {
  const snapTs = new Date(`${snapshotDate}T00:00:00Z`).getTime();
  const expTs = new Date(`${expiration}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((expTs - snapTs) / (1000 * 60 * 60 * 24)));
}

function inferChainKind(expiration: string): "monthly" | "weekly" {
  const d = new Date(`${expiration}T00:00:00Z`);
  const weekday = d.getUTCDay();
  const day = d.getUTCDate();
  return weekday === 5 && day >= 15 && day <= 21 ? "monthly" : "weekly";
}

function filterByOwnerAndTicker<T extends EntityBase>(rows: T[], ticker: SupportedTicker, ownerId?: string): T[] {
  return rows.filter((row) => normalizeTicker(row.ticker) === normalizeTicker(ticker) && row.ownerId === ownerId);
}

function readStore(): StoreShape {
  if (typeof window === "undefined") {
    return { chainSnapshots: [], snapshots: [], positions: [], preferences: [], watchlists: [] };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { chainSnapshots: [], snapshots: [], positions: [], preferences: [], watchlists: [] };
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    const normalizedChainSnapshots = (parsed.chainSnapshots ?? []).map((s) => ({
      ...s,
      snapshotKey: s.snapshotKey ?? chainSnapshotKey(s.ticker, s.snapshotDate, s.expiration),
      dteAtCapture: s.dteAtCapture ?? inferDte(s.snapshotDate, s.expiration),
      chainKind: s.chainKind ?? inferChainKind(s.expiration)
    }));
    return {
      chainSnapshots: normalizedChainSnapshots,
      snapshots: parsed.snapshots ?? [],
      positions: parsed.positions ?? [],
      preferences: parsed.preferences ?? [],
      watchlists: parsed.watchlists ?? []
    };
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return { chainSnapshots: [], snapshots: [], positions: [], preferences: [], watchlists: [] };
  }
}

function writeStore(next: StoreShape): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function createLocalPersistenceAdapter(ownerId?: string): PersistenceAdapter {
  const aggregateSnapshots = (entries: ChainSnapshotEntry[], ticker: SupportedTicker): ChainSnapshot[] => {
    const byDate = new Map<string, ChainSnapshotEntry[]>();
    entries.forEach((entry) => {
      const bucket = byDate.get(entry.snapshotDate) ?? [];
      bucket.push(entry);
      byDate.set(entry.snapshotDate, bucket);
    });
    return [...byDate.entries()]
      .map(([snapshotDate, chains]) => ({
        ticker,
        snapshotDate,
        chains: chains
          .map((c) => ({
            expiration: c.expiration,
            rows: c.rows,
            summary: { ...c.summary, prevailingScore: c.prevailingScore }
          }))
          .sort((a, b) => b.summary.prevailingScore - a.summary.prevailingScore),
        ownerId
      }))
      .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));
  };

  return {
    listSnapshots(ticker) {
      const store = readStore();
      const chainEntries = filterByOwnerAndTicker(store.chainSnapshots, ticker, ownerId);
      if (chainEntries.length) return aggregateSnapshots(chainEntries, ticker);
      return filterByOwnerAndTicker(store.snapshots, ticker, ownerId).sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));
    },
    getSnapshot(ticker, snapshotDate) {
      return this.listSnapshots(ticker).find((s) => s.snapshotDate === snapshotDate);
    },
    saveSnapshot(snapshot) {
      const normalizedTicker = normalizeTicker(snapshot.ticker);
      snapshot.chains.forEach((chain) => {
        this.saveChainSnapshot({
          ticker: normalizedTicker,
          snapshotKey: chainSnapshotKey(normalizedTicker, snapshot.snapshotDate, chain.expiration),
          snapshotDate: snapshot.snapshotDate,
          expiration: chain.expiration,
          dteAtCapture: inferDte(snapshot.snapshotDate, chain.expiration),
          chainKind: inferChainKind(chain.expiration),
          rows: chain.rows,
          summary: chain.summary,
          prevailingScore: chain.summary.prevailingScore,
          ownerId
        });
      });
    },
    listChainSnapshots(ticker, expiration) {
      const store = readStore();
      const normalizedTicker = normalizeTicker(ticker);
      return store.chainSnapshots
        .filter((s) => normalizeTicker(s.ticker) === normalizedTicker && s.ownerId === ownerId && (!expiration || s.expiration === expiration))
        .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));
    },
    getChainSnapshot(ticker, snapshotDate, expiration) {
      const key = chainSnapshotKey(ticker, snapshotDate, expiration);
      return this.listChainSnapshots(ticker, expiration).find((s) => s.snapshotKey === key);
    },
    saveChainSnapshot(snapshot) {
      const store = readStore();
      const normalizedTicker = normalizeTicker(snapshot.ticker);
      const key = chainSnapshotKey(normalizedTicker, snapshot.snapshotDate, snapshot.expiration);
      const filteredChain = store.chainSnapshots.filter(
        (s) => !(s.snapshotKey === key && s.ownerId === ownerId)
      );
      filteredChain.push({
        ...snapshot,
        ticker: normalizedTicker,
        snapshotKey: key,
        dteAtCapture: snapshot.dteAtCapture ?? inferDte(snapshot.snapshotDate, snapshot.expiration),
        chainKind: snapshot.chainKind ?? inferChainKind(snapshot.expiration),
        ownerId
      });
      const filteredLegacy = store.snapshots.filter((s) => normalizeTicker(s.ticker) !== normalizedTicker || s.ownerId !== ownerId);
      writeStore({ ...store, chainSnapshots: filteredChain, snapshots: filteredLegacy });
    },
    deleteChainSnapshots(ticker, expiration) {
      const store = readStore();
      const normalizedTicker = normalizeTicker(ticker);
      const before = store.chainSnapshots.length;
      const filteredChain = store.chainSnapshots.filter(
        (s) => !(normalizeTicker(s.ticker) === normalizedTicker && s.expiration === expiration && s.ownerId === ownerId)
      );
      const removed = before - filteredChain.length;
      if (removed > 0) writeStore({ ...store, chainSnapshots: filteredChain });
      return removed;
    },
    savePosition(record) {
      const store = readStore();
      const normalizedTicker = normalizeTicker(record.ticker);
      const filtered = store.positions.filter((p) => !(normalizeTicker(p.ticker) === normalizedTicker && p.ownerId === ownerId));
      filtered.push({ ...record, ticker: normalizedTicker, ownerId });
      writeStore({ ...store, positions: filtered });
    },
    getPosition(ticker) {
      const store = readStore();
      return filterByOwnerAndTicker(store.positions, ticker, ownerId)[0];
    },
    savePreferences(ticker, preferences) {
      const store = readStore();
      const normalizedTicker = normalizeTicker(ticker);
      const filtered = store.preferences.filter(
        (p) => !(normalizeTicker(p.ticker) === normalizedTicker && p.ownerId === ownerId)
      );
      filtered.push({ ...preferences, ticker: normalizedTicker, ownerId });
      writeStore({ ...store, preferences: filtered });
    },
    getPreferences(ticker) {
      const store = readStore();
      return filterByOwnerAndTicker(store.preferences, ticker, ownerId)[0];
    },
    saveWatchlist(tickers, listOwnerId) {
      const store = readStore();
      const effectiveOwner = listOwnerId ?? ownerId;
      const normalized = tickers.map((t) => normalizeTicker(t));
      const filtered = store.watchlists.filter((w) => w.ownerId !== effectiveOwner);
      filtered.push({ ownerId: effectiveOwner, tickers: normalized });
      writeStore({ ...store, watchlists: filtered });
    },
    getWatchlist(listOwnerId) {
      const store = readStore();
      const effectiveOwner = listOwnerId ?? ownerId;
      return store.watchlists.find((w) => w.ownerId === effectiveOwner)?.tickers ?? [];
    }
  };
}
