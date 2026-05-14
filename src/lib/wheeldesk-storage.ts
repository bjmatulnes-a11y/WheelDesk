import { saveSurfaceSnapshotViaApi } from "./surface-snapshot-api-client";


export type CandleRecord = {
  date: string;
  open?: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};
export function mergeOptionSurfaceSnapshotsIntoLocalCache(
  snapshots: OptionSurfaceSnapshot[]
): {
  added: number;
  updated: number;
  total: number;
} {
  if (typeof window === "undefined") {
    return { added: 0, updated: 0, total: 0 };
  }

const incoming = snapshots
  .map((snapshot) => normalizeSurfaceSnapshot(snapshot))
  .filter((snapshot): snapshot is OptionSurfaceSnapshot => snapshot !== null)
  .map((snapshot) => makeOptionSurfaceLocalManifest(snapshot));

  const storage = readWheelDeskStorage();

  if (!incoming.length) {
    return {
      added: 0,
      updated: 0,
      total: storage.optionSurfaceSnapshots.length,
    };
  }

  const existingByKey = new Map<string, OptionSurfaceSnapshot>();

  for (const snapshot of storage.optionSurfaceSnapshots ?? []) {
    existingByKey.set(snapshot.surfaceKey, snapshot);
  }

  let added = 0;
  let updated = 0;

  for (const snapshot of incoming) {
    const existing = existingByKey.get(snapshot.surfaceKey);

    if (existing) {
      updated += 1;
    } else {
      added += 1;
    }

    existingByKey.set(snapshot.surfaceKey, {
      ...existing,
      ...snapshot,
      metadata: {
        ...(existing as any)?.metadata,
        ...(snapshot as any)?.metadata,
        hydratedFromSupabase: true,
        hydratedAt: new Date().toISOString(),
      },
    });
  }

  const optionSurfaceSnapshots = Array.from(existingByKey.values()).sort((a, b) => {
    const tickerCompare = a.ticker.localeCompare(b.ticker);
    if (tickerCompare !== 0) return tickerCompare;

    return b.snapshotDate.localeCompare(a.snapshotDate);
  });

  writeWheelDeskStorage({
    ...storage,
    optionSurfaceSnapshots: capLocalOptionSurfaceManifests(optionSurfaceSnapshots),
  });

  return {
    added,
    updated,
    total: optionSurfaceSnapshots.length,
  };
}
export type DailyStructureSnapshot = {
  ticker: string;
  snapshotDate: string;

  spot?: number;
  projectedBias?: string;
  pathDirection?: string;

  support?: number;
  resistance?: number;
  magnet?: number;
  oiMagnet?: number;

  primarySupport?: number;
  primaryResistance?: number;

  supportStrike?: number;
  resistanceStrike?: number;
  magnetStrike?: number;

  supportPressureType?: string;
  resistancePressureType?: string;
  supportPressureScore?: number;
  resistancePressureScore?: number;
  supportOiChange?: number;
  resistanceOiChange?: number;

  impliedPath?: any;
  prevailingLevels?: any;
  compression?: any;
  activeZone?: any;

  source?: string;
  createdAt?: string;
  updatedAt?: string;

  [key: string]: any;
};

export type ChainSnapshotEntry = {
  snapshotKey?: string;
  ticker: string;
  snapshotDate: string;
  expiration: string;

  chainKind?: string;
  dteAtCapture?: number;

  rows: any[];
  summary: any;

  createdAt?: string;
  updatedAt?: string;

  [key: string]: any;
};

export type OptionSurfaceSnapshot = {
  surfaceKey: string;
  ticker: string;
  snapshotDate: string;
  snapshotTimeZone: string;
  capturedAt: string;

  price?: {
    date?: string;
    open?: number;
    high?: number;
    low?: number;
    close?: number;
    volume?: number;
  };

  /**
   * All relevant expiration chains for this ticker/date.
   * This replaces separate per-expiration snapshot storage.
   */
  chains: ChainSnapshotEntry[];

  /**
   * Final daily structure read generated from the full option surface.
   * Tab A validation reads this.
   */
  dailyStructure: DailyStructureSnapshot;

  createdAt?: string;
  updatedAt?: string;

  [key: string]: any;
};

export type WheelDeskPreferences = {
  snapshotTimeZone: string;
};

export type EdgeProofConfidence =
  | "none"
  | "very_low"
  | "low"
  | "medium"
  | "high"
  | "strong";
export type EdgeProofGrade =
  | "none"
  | "early"
  | "developing"
  | "tested"
  | "proven"
  | "institutional";

export type EdgeProofSummary = {
  /** Optional ticker scope. Empty means global/all-ticker proof. */
  ticker?: string;
  label: string;
  horizonDays: number;
  total: number;
  evaluated: number;
  validated: number;
  rawRate: number | null;
  adjustedRate: number | null;
  confidence: EdgeProofConfidence;
  proofGrade: EdgeProofGrade;
  primaryOutcome?: string;
  outcomeDistribution?: Record<string, number>;
  updatedAt: string;
};

export type WheelDeskStorageV2 = {
  version: 2;
  preferences: WheelDeskPreferences;

  /**
   * SOURCE OF TRUTH.
   * One ticker + one snapshotDate = one full surface snapshot.
   */
  optionSurfaceSnapshots: OptionSurfaceSnapshot[];

  /**
   * Price candles may be cached here later.
   * Yahoo candles are still the source of truth for validation spot/future OHLC.
   */
  candles: Record<string, CandleRecord[]>;

  positions: any[];
  watchlists: any[];

  /** Validation proof summaries produced by the validation page and consumed by the scanner. */
  edgeProofSummaries: EdgeProofSummary[];
};

const STORAGE_V2_KEY = "wheeldesk_storage_v2";

const LEGACY_STORAGE_V1_KEY = "wheeldesk_storage_v1";
const LEGACY_CHAIN_V2_KEY = "wheeldesk_chain_snapshots_v2";
const LEGACY_DAILY_PREFIX = "wheelDesk.dailyStructure.";
const MAX_CANDLE_ROWS_PER_TICKER = 420;
const MAX_CANDLE_TICKERS = 60;


function isBrowser(): boolean {
  return (
    typeof window !== "undefined" && typeof window.localStorage !== "undefined"
  );
}

export function normalizeTicker(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

export function dateKey(value: unknown): string {
  return String(value ?? "").slice(0, 10);
}

function nowIso(): string {
  return new Date().toISOString();
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeCandleRecords(candles: CandleRecord[]): CandleRecord[] {
  const byDate = new Map<string, CandleRecord>();

  for (const candle of candles ?? []) {
    const date = dateKey(candle?.date);
    const close = Number(candle?.close);
    const high = Number(candle?.high ?? close);
    const low = Number(candle?.low ?? close);
    const openRaw = Number(candle?.open ?? close);
    const volumeRaw = Number(candle?.volume ?? 0);

    if (!date || !Number.isFinite(close) || !Number.isFinite(high) || !Number.isFinite(low)) {
      continue;
    }

    byDate.set(date, {
      date,
      open: Number.isFinite(openRaw) ? openRaw : close,
      high,
      low,
      close,
      volume: Number.isFinite(volumeRaw) ? volumeRaw : 0,
    });
  }

  return Array.from(byDate.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_CANDLE_ROWS_PER_TICKER);
}

function compactCandlesMap(
  candles: Record<string, CandleRecord[]> | undefined,
  maxTickers = MAX_CANDLE_TICKERS,
): Record<string, CandleRecord[]> {
  const entries = Object.entries(candles ?? {})
    .map(([ticker, rows]) => ({
      ticker: normalizeTicker(ticker),
      rows: normalizeCandleRecords(Array.isArray(rows) ? rows : []),
    }))
    .filter((entry) => entry.ticker && entry.rows.length > 0)
    .sort((a, b) => {
      const aLast = a.rows.at(-1)?.date ?? "";
      const bLast = b.rows.at(-1)?.date ?? "";
      return bLast.localeCompare(aLast) || a.ticker.localeCompare(b.ticker);
    })
    .slice(0, maxTickers);

  return Object.fromEntries(entries.map((entry) => [entry.ticker, entry.rows]));
}

function localStorageBytesForKey(key: string): number {
  if (!isBrowser()) return 0;
  const raw = window.localStorage.getItem(key) ?? "";
  return raw.length * 2;
}

function emptyStorage(): WheelDeskStorageV2 {
  return {
    version: 2,
    preferences: {
      snapshotTimeZone: "America/Chicago",
    },
    optionSurfaceSnapshots: [],
    candles: {},
    positions: [],
    watchlists: [],
    edgeProofSummaries: [],
  };
}

export function makeSurfaceSnapshotKey(args: {
  ticker: string;
  snapshotDate: string;
}): string {
  return `${normalizeTicker(args.ticker)}_${dateKey(args.snapshotDate)}`;
}

export function makeChainSnapshotKey(args: {
  ticker: string;
  snapshotDate: string;
  expiration: string;
}): string {
  return `${normalizeTicker(args.ticker)}_${dateKey(args.snapshotDate)}_${String(
    args.expiration ?? "",
  )}`;
}

export function readWheelDeskStorage(): WheelDeskStorageV2 {
  if (!isBrowser()) return emptyStorage();

  const parsed = safeParse<any>(
    window.localStorage.getItem(STORAGE_V2_KEY),
    {},
  );

  /**
   * Defensive read:
   * If older v2 still has chainSnapshots/dailyStructures, ignore them here.
   * They should only be migrated into optionSurfaceSnapshots.
   */
  return {
    ...emptyStorage(),
    ...parsed,
    version: 2,
    preferences: {
      ...emptyStorage().preferences,
      ...(parsed.preferences ?? {}),
    },
    optionSurfaceSnapshots: Array.isArray(parsed.optionSurfaceSnapshots)
      ? parsed.optionSurfaceSnapshots
          .map(normalizeSurfaceSnapshot)
          .filter(
            (x: OptionSurfaceSnapshot | null): x is OptionSurfaceSnapshot =>
              x != null,
          )
      : [],
    candles: compactCandlesMap(parsed.candles ?? {}),
    positions: Array.isArray(parsed.positions) ? parsed.positions : [],
    watchlists: Array.isArray(parsed.watchlists) ? parsed.watchlists : [],
    edgeProofSummaries: Array.isArray(parsed.edgeProofSummaries)
      ? parsed.edgeProofSummaries
      : [],
  };
}

export function writeWheelDeskStorage(storage: WheelDeskStorageV2): void {
  if (!isBrowser()) return;

  /**
   * Write only the clean v2 shape.
   * Do not write legacy chainSnapshots/dailyStructures.
   * Candles are compacted before every write because v2 is also carrying
   * large option surfaces; uncontrolled candle growth can fill localStorage
   * and make the whole app look broken.
   */
  const clean: WheelDeskStorageV2 = {
    version: 2,
    preferences: {
      snapshotTimeZone:
        storage.preferences?.snapshotTimeZone ?? "America/Chicago",
    },
    optionSurfaceSnapshots: storage.optionSurfaceSnapshots ?? [],
    candles: compactCandlesMap(storage.candles),
    positions: storage.positions ?? [],
    watchlists: storage.watchlists ?? [],
    edgeProofSummaries: storage.edgeProofSummaries ?? [],
  };

  try {
    window.localStorage.setItem(STORAGE_V2_KEY, JSON.stringify(clean));
    return;
  } catch (error) {
    // Prefer preserving OI surfaces and proof history. If localStorage is full,
    // reduce candle cache first, then clear candle cache as a last-resort write.
    const reducedCandles = compactCandlesMap(clean.candles, 20);
    const reduced: WheelDeskStorageV2 = { ...clean, candles: reducedCandles };

    try {
      window.localStorage.setItem(STORAGE_V2_KEY, JSON.stringify(reduced));
      console.warn("WheelDesk storage was compacted after localStorage quota pressure.", error);
      return;
    } catch {
      const withoutCandles: WheelDeskStorageV2 = { ...clean, candles: {} };
      window.localStorage.setItem(STORAGE_V2_KEY, JSON.stringify(withoutCandles));
      console.warn("WheelDesk candle cache was cleared after localStorage quota pressure.", error);
    }
  }
}

export function getSnapshotDateInTimeZone(
  date: Date,
  timeZone: string,
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function getSnapshotTimestampInTimeZone(
  date: Date,
  timeZone: string,
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get(
    "minute",
  )}:${get("second")}`;
}

export function readPreferences(): WheelDeskPreferences {
  return readWheelDeskStorage().preferences;
}

export function savePreferences(
  preferences: Partial<WheelDeskPreferences>,
): void {
  const storage = readWheelDeskStorage();

  writeWheelDeskStorage({
    ...storage,
    preferences: {
      ...storage.preferences,
      ...preferences,
    },
  });
}

export function normalizeChainSnapshotEntry(
  item: any,
): ChainSnapshotEntry | null {
  const ticker = normalizeTicker(item?.ticker ?? item?.symbol);
  const snapshotDate = dateKey(item?.snapshotDate ?? item?.date);
  const expiration = String(item?.expiration ?? "");

  if (!ticker || !snapshotDate || !expiration) return null;

  const rows = Array.isArray(item?.rows) ? item.rows : [];

  const snapshotKey =
    item?.snapshotKey ??
    makeChainSnapshotKey({
      ticker,
      snapshotDate,
      expiration,
    });

  return {
    ...item,
    snapshotKey,
    ticker,
    snapshotDate,
    expiration,
    rows,
    summary: item?.summary ?? {},
    createdAt: item?.createdAt ?? nowIso(),
    updatedAt: item?.updatedAt ?? item?.createdAt ?? nowIso(),
  };
}

export function normalizeDailyStructure(
  item: any,
): DailyStructureSnapshot | null {
  const ticker = normalizeTicker(item?.ticker ?? item?.symbol);
  const snapshotDate = dateKey(item?.snapshotDate ?? item?.date);

  if (!ticker || !snapshotDate) return null;

  return {
    ...item,
    ticker,
    snapshotDate,
    createdAt: item?.createdAt ?? nowIso(),
    updatedAt: item?.updatedAt ?? item?.createdAt ?? nowIso(),
  };
}

export function normalizeSurfaceSnapshot(
  item: any,
): OptionSurfaceSnapshot | null {
  const ticker = normalizeTicker(item?.ticker ?? item?.symbol);
  const snapshotDate = dateKey(item?.snapshotDate ?? item?.date);

  if (!ticker || !snapshotDate) return null;

  const chains = Array.isArray(item?.chains)
    ? item.chains
        .map((chain: any) =>
          normalizeChainSnapshotEntry({
            ...chain,
            ticker,
            snapshotDate,
          }),
        )
        .filter(
          (chain: ChainSnapshotEntry | null): chain is ChainSnapshotEntry =>
            chain != null,
        )
        .sort((a: ChainSnapshotEntry, b: ChainSnapshotEntry) =>
          a.expiration.localeCompare(b.expiration),
        )
    : [];

  const dailyStructure = normalizeDailyStructure({
    ...(item?.dailyStructure ?? {}),
    ticker,
    snapshotDate,
  });

  if (!dailyStructure) return null;

  const surfaceKey =
    item?.surfaceKey ??
    makeSurfaceSnapshotKey({
      ticker,
      snapshotDate,
    });

  return {
    ...item,
    surfaceKey,
    ticker,
    snapshotDate,
    snapshotTimeZone: item?.snapshotTimeZone ?? "America/Chicago",
    capturedAt:
      item?.capturedAt ?? item?.updatedAt ?? item?.createdAt ?? nowIso(),
    price: item?.price,
    chains,
    dailyStructure,
    createdAt: item?.createdAt ?? nowIso(),
    updatedAt: item?.updatedAt ?? item?.createdAt ?? nowIso(),
  };
}

/**
 * SOURCE-OF-TRUTH READERS
 */

export function readOptionSurfaceSnapshots(
  ticker?: string,
): OptionSurfaceSnapshot[] {
  const storage = readWheelDeskStorage();

  if (!ticker) return storage.optionSurfaceSnapshots;

  const t = normalizeTicker(ticker);

  return storage.optionSurfaceSnapshots.filter(
    (snapshot) => normalizeTicker(snapshot.ticker) === t,
  );
}

export function readOptionSurfaceSnapshot(args: {
  ticker: string;
  snapshotDate: string;
}): OptionSurfaceSnapshot | null {
  const key = makeSurfaceSnapshotKey(args);

  return (
    readWheelDeskStorage().optionSurfaceSnapshots.find(
      (snapshot) => snapshot.surfaceKey === key,
    ) ?? null
  );
}

export function readLatestOptionSurfaceSnapshot(
  ticker: string,
): OptionSurfaceSnapshot | null {
  const snapshots = readOptionSurfaceSnapshots(ticker).sort((a, b) =>
    dateKey(b.snapshotDate).localeCompare(dateKey(a.snapshotDate)),
  );

  return snapshots[0] ?? null;
}

export function getSurfaceSnapshotDates(ticker: string): string[] {
  return readOptionSurfaceSnapshots(ticker)
    .map((snapshot) => dateKey(snapshot.snapshotDate))
    .filter(Boolean)
    .sort();
}

export function getSurfaceSnapshotTickers(): string[] {
  return Array.from(
    new Set(
      readOptionSurfaceSnapshots()
        .map((snapshot) => normalizeTicker(snapshot.ticker))
        .filter(Boolean),
    ),
  ).sort();
}

export function getChainsForSurface(args: {
  ticker: string;
  snapshotDate: string;
}): ChainSnapshotEntry[] {
  return readOptionSurfaceSnapshot(args)?.chains ?? [];
}

export function getChainFromSurface(args: {
  ticker: string;
  snapshotDate: string;
  expiration: string;
}): ChainSnapshotEntry | null {
  const surface = readOptionSurfaceSnapshot(args);
  if (!surface) return null;

  return (
    surface.chains.find((chain) => chain.expiration === args.expiration) ?? null
  );
}
function mirrorSurfaceSnapshotToSupabase(snapshot: OptionSurfaceSnapshot): void {
  if (typeof window === "undefined") return;

  void saveSurfaceSnapshotViaApi(snapshot)
    .then((result) => {
      console.info(
        `[WheelDesk] Supabase mirror saved ${result.ticker} ${result.snapshotDate} ` +
          `(${result.chainRowCount} OI rows)`
      );
    })
    .catch((error) => {
      console.warn("[WheelDesk] Supabase mirror failed:", error);
    });
}

const MAX_LOCAL_SURFACE_MANIFESTS_PER_TICKER = 3;

function countOptionSurfaceRows(snapshot: OptionSurfaceSnapshot): number {
  return (snapshot.chains ?? []).reduce((sum: number, chain: any) => {
    return sum + ((chain?.rows ?? []).length || 0);
  }, 0);
}

function makeOptionSurfaceLocalManifest(
  snapshot: OptionSurfaceSnapshot
): OptionSurfaceSnapshot {
  const originalRowCount = countOptionSurfaceRows(snapshot);

  return {
    ...snapshot,

    // Keep the chain shells/summaries locally, but do not keep 10k-25k rows
    // in wheeldesk_storage_v2.
    chains: (snapshot.chains ?? []).map((chain: any) => {
      const chainRowCount = (chain?.rows ?? []).length || 0;

      return {
        ...chain,
        rows: [],
        metadata: {
          ...(chain?.metadata ?? {}),
          localRowsOmitted: true,
          originalRowCount: chainRowCount,
        },
      };
    }),

    metadata: {
      ...((snapshot as any).metadata ?? {}),
      savedToSupabase: true,
      localManifestOnly: true,
      originalRowCount,
      chainCount: snapshot.chains?.length ?? 0,
      localManifestUpdatedAt: new Date().toISOString(),
    },
  };
}

function capLocalOptionSurfaceManifests(
  snapshots: OptionSurfaceSnapshot[]
): OptionSurfaceSnapshot[] {
  const byTicker = new Map<string, OptionSurfaceSnapshot[]>();

  for (const snapshot of snapshots) {
    const ticker = String(snapshot.ticker ?? "").toUpperCase();
    const list = byTicker.get(ticker) ?? [];

    list.push(snapshot);
    byTicker.set(ticker, list);
  }

  return Array.from(byTicker.values()).flatMap((list) =>
    list
      .sort((a, b) => {
        const dateCompare = String(b.snapshotDate ?? "").localeCompare(
          String(a.snapshotDate ?? "")
        );

        if (dateCompare !== 0) return dateCompare;

        return String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""));
      })
      .slice(0, MAX_LOCAL_SURFACE_MANIFESTS_PER_TICKER)
  );
}


/**
 * SOURCE-OF-TRUTH WRITER
 *
 * This is the only snapshot save function the dashboard should use.
 * It overwrites one ticker/date surface snapshot.
 */
export function saveOptionSurfaceSnapshot(
  snapshot: Omit<OptionSurfaceSnapshot, "surfaceKey"> & {
    surfaceKey?: string;
  },
): void {
  const storage = readWheelDeskStorage();

  const normalized = normalizeSurfaceSnapshot({
    ...snapshot,
    surfaceKey:
      snapshot.surfaceKey ??
      makeSurfaceSnapshotKey({
        ticker: snapshot.ticker,
        snapshotDate: snapshot.snapshotDate,
      }),
    snapshotTimeZone:
      snapshot.snapshotTimeZone ?? storage.preferences.snapshotTimeZone,
    capturedAt: snapshot.capturedAt ?? nowIso(),
    updatedAt: nowIso(),
  });

  if (!normalized) return

const localManifest = makeOptionSurfaceLocalManifest(normalized);

const nextSurfaceSnapshots = capLocalOptionSurfaceManifests(
  [
    ...(storage.optionSurfaceSnapshots ?? []).filter(
      (item) => item.surfaceKey !== localManifest.surfaceKey
    ),
    localManifest,
  ].sort((a, b) => {
    const tickerCompare = String(a.ticker ?? "").localeCompare(String(b.ticker ?? ""));
    if (tickerCompare !== 0) return tickerCompare;

    return String(b.snapshotDate ?? "").localeCompare(String(a.snapshotDate ?? ""));
  })
);

writeWheelDeskStorage({
  ...storage,
  optionSurfaceSnapshots: nextSurfaceSnapshots,
});
}
/**
 * Compatibility readers.
 * These do NOT read old standalone v2 fields anymore.
 * They derive from optionSurfaceSnapshots.
 */
export function readDailyStructures(ticker?: string): DailyStructureSnapshot[] {
  const snapshots = readOptionSurfaceSnapshots(ticker);

  return snapshots
    .map((snapshot) => snapshot.dailyStructure)
    .filter(Boolean)
    .sort((a, b) => {
      const tickerCompare = a.ticker.localeCompare(b.ticker);
      if (tickerCompare !== 0) return tickerCompare;
      return dateKey(a.snapshotDate).localeCompare(dateKey(b.snapshotDate));
    });
}

export function readChainSnapshots(ticker?: string): ChainSnapshotEntry[] {
  const snapshots = readOptionSurfaceSnapshots(ticker);

  return snapshots.flatMap((snapshot) => snapshot.chains ?? []);
}

/**
 * Deprecated compatibility writers.
 * Use saveOptionSurfaceSnapshot instead.
 */
export function saveDailyStructure(_snapshot: DailyStructureSnapshot): void {
  console.warn(
    "saveDailyStructure is deprecated. Use saveOptionSurfaceSnapshot with dailyStructure included.",
  );
}

export function saveChainSnapshot(_snapshot: ChainSnapshotEntry): void {
  console.warn(
    "saveChainSnapshot is deprecated. Use saveOptionSurfaceSnapshot with chains included.",
  );
}

/**
 * Candles
 */
export function readCandles(ticker: string): CandleRecord[] {
  const storage = readWheelDeskStorage();
  return storage.candles[normalizeTicker(ticker)] ?? [];
}

export function saveCandles(ticker: string, candles: CandleRecord[]): void {
  const storage = readWheelDeskStorage();
  const t = normalizeTicker(ticker);
  if (!t) return;

  const existing = storage.candles?.[t] ?? [];
  const normalized = normalizeCandleRecords([...existing, ...(candles ?? [])]);

  writeWheelDeskStorage({
    ...storage,
    candles: {
      ...storage.candles,
      [t]: normalized,
    },
  });
}

export function clearCandles(ticker?: string): void {
  const storage = readWheelDeskStorage();

  if (ticker) {
    const normalizedTicker = normalizeTicker(ticker);
    const nextCandles = { ...(storage.candles ?? {}) };
    delete nextCandles[normalizedTicker];

    writeWheelDeskStorage({
      ...storage,
      candles: nextCandles,
    });

    return;
  }

  writeWheelDeskStorage({
    ...storage,
    candles: {},
  });
}

export function getSavedCandleStats(): {
  tickerCount: number;
  candleCount: number;
  tickers: { ticker: string; count: number }[];
} {
  const candlesByTicker = readWheelDeskStorage().candles ?? {};
  const tickers = Object.entries(candlesByTicker)
    .map(([ticker, rows]) => ({
      ticker: normalizeTicker(ticker),
      count: Array.isArray(rows) ? rows.length : 0,
    }))
    .filter((item) => item.ticker && item.count > 0)
    .sort((a, b) => a.ticker.localeCompare(b.ticker));

  return {
    tickerCount: tickers.length,
    candleCount: tickers.reduce((sum, item) => sum + item.count, 0),
    tickers,
  };
}

export function compactSavedCandles(): { before: ReturnType<typeof getSavedCandleStats>; after: ReturnType<typeof getSavedCandleStats> } {
  const before = getSavedCandleStats();
  const storage = readWheelDeskStorage();

  writeWheelDeskStorage({
    ...storage,
    candles: compactCandlesMap(storage.candles),
  });

  return { before, after: getSavedCandleStats() };
}

export function getWheelDeskStorageDiagnostics(): {
  v2Bytes: number;
  totalLocalStorageBytes: number;
  surfaceCount: number;
  chainCount: number;
  candleTickerCount: number;
  candleCount: number;
  legacyKeyCount: number;
  largestKeys: { key: string; bytes: number }[];
} {
  if (!isBrowser()) {
    return {
      v2Bytes: 0,
      totalLocalStorageBytes: 0,
      surfaceCount: 0,
      chainCount: 0,
      candleTickerCount: 0,
      candleCount: 0,
      legacyKeyCount: 0,
      largestKeys: [],
    };
  }

  const storage = readWheelDeskStorage();
  const candleStats = getSavedCandleStats();
  const keys = Object.keys(window.localStorage);
  const keySizes = keys
    .map((key) => ({ key, bytes: localStorageBytesForKey(key) }))
    .sort((a, b) => b.bytes - a.bytes);

  return {
    v2Bytes: localStorageBytesForKey(STORAGE_V2_KEY),
    totalLocalStorageBytes: keySizes.reduce((sum, item) => sum + item.bytes, 0),
    surfaceCount: storage.optionSurfaceSnapshots.length,
    chainCount: storage.optionSurfaceSnapshots.reduce((sum, surface) => sum + (surface.chains?.length ?? 0), 0),
    candleTickerCount: candleStats.tickerCount,
    candleCount: candleStats.candleCount,
    legacyKeyCount: keys.filter(
      (key) =>
        key === LEGACY_STORAGE_V1_KEY ||
        key === LEGACY_CHAIN_V2_KEY ||
        key.startsWith(LEGACY_DAILY_PREFIX) ||
        key.startsWith("tradingOperator.dashboard."),
    ).length,
    largestKeys: keySizes.slice(0, 8),
  };
}

/**
 * Delete selected surface snapshots.
 * This deletes the full ticker/date snapshot, including all chains and the daily structure.
 */
export function deleteSnapshotsByTickerAndDate(args: {
  ticker: string;
  dates: string[];
}): void {
  const storage = readWheelDeskStorage();

  const ticker = normalizeTicker(args.ticker);
  const dates = new Set(args.dates.map(dateKey).filter(Boolean));

  const nextSurfaceSnapshots = storage.optionSurfaceSnapshots.filter(
    (snapshot) => {
      if (normalizeTicker(snapshot.ticker) !== ticker) return true;
      return !dates.has(dateKey(snapshot.snapshotDate));
    },
  );

  writeWheelDeskStorage({
    ...storage,
    optionSurfaceSnapshots: nextSurfaceSnapshots,
  });
}

/**
 * Optional: delete one expiration from a surface snapshot.
 * Use carefully. This mutates the saved surface.
 */
export function deleteExpirationFromSurfaceSnapshot(args: {
  ticker: string;
  snapshotDate: string;
  expiration: string;
}): void {
  const storage = readWheelDeskStorage();

  const surfaceKey = makeSurfaceSnapshotKey({
    ticker: args.ticker,
    snapshotDate: args.snapshotDate,
  });

  const nextSurfaceSnapshots = storage.optionSurfaceSnapshots.map(
    (snapshot) => {
      if (snapshot.surfaceKey !== surfaceKey) return snapshot;

      return {
        ...snapshot,
        chains: snapshot.chains.filter(
          (chain) => chain.expiration !== args.expiration,
        ),
        updatedAt: nowIso(),
      };
    },
  );

  writeWheelDeskStorage({
    ...storage,
    optionSurfaceSnapshots: nextSurfaceSnapshots,
  });
}

/**
 * Legacy migration
 *
 * Reads:
 * - wheeldesk_storage_v1.chainSnapshots
 * - wheeldesk_storage_v1.snapshots
 * - wheeldesk_chain_snapshots_v2
 * - wheelDesk.dailyStructure.<TICKER>
 *
 * Writes:
 * - wheeldesk_storage_v2.optionSurfaceSnapshots only
 */
function readLegacyStorageV1(): any {
  if (!isBrowser()) return {};
  return safeParse<any>(window.localStorage.getItem(LEGACY_STORAGE_V1_KEY), {});
}

function readLegacyChainSnapshotsV2(): any[] {
  if (!isBrowser()) return [];

  const parsed = safeParse<any>(
    window.localStorage.getItem(LEGACY_CHAIN_V2_KEY),
    [],
  );

  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.chainSnapshots)) return parsed.chainSnapshots;
  if (Array.isArray(parsed.snapshots)) return parsed.snapshots;
  if (Array.isArray(parsed.entries)) return parsed.entries;

  return [];
}

function readLegacyDailyStructureKeys(): DailyStructureSnapshot[] {
  if (!isBrowser()) return [];

  const all: DailyStructureSnapshot[] = [];

  for (const key of Object.keys(window.localStorage)) {
    if (!key.startsWith(LEGACY_DAILY_PREFIX)) continue;

    const parsed = safeParse<any>(window.localStorage.getItem(key), []);
    if (!Array.isArray(parsed)) continue;

    const tickerFromKey = normalizeTicker(
      key.slice(LEGACY_DAILY_PREFIX.length),
    );

    for (const item of parsed) {
      const normalized = normalizeDailyStructure({
        ...item,
        ticker: normalizeTicker(item.ticker ?? tickerFromKey),
      });

      if (normalized) all.push(normalized);
    }
  }

  return all;
}

function buildSurfacesFromLegacy(args: {
  chainSnapshots: ChainSnapshotEntry[];
  dailyStructures: DailyStructureSnapshot[];
}): OptionSurfaceSnapshot[] {
  const dailyMap = new Map<string, DailyStructureSnapshot>();

  for (const daily of args.dailyStructures) {
    dailyMap.set(makeSurfaceSnapshotKey(daily), daily);
  }

  const chainGroups = new Map<string, ChainSnapshotEntry[]>();

  for (const chain of args.chainSnapshots) {
    const surfaceKey = makeSurfaceSnapshotKey({
      ticker: chain.ticker,
      snapshotDate: chain.snapshotDate,
    });

    const group = chainGroups.get(surfaceKey) ?? [];
    group.push(chain);
    chainGroups.set(surfaceKey, group);
  }

  const surfaceMap = new Map<string, OptionSurfaceSnapshot>();

  for (const [surfaceKey, chains] of chainGroups.entries()) {
    const first = chains[0];

    const dailyStructure =
      dailyMap.get(surfaceKey) ??
      ({
        ticker: first.ticker,
        snapshotDate: first.snapshotDate,
        source: "legacy_chain_group",
      } as DailyStructureSnapshot);

    const surface: OptionSurfaceSnapshot = {
      surfaceKey,
      ticker: first.ticker,
      snapshotDate: first.snapshotDate,
      snapshotTimeZone: "America/Chicago",
      capturedAt: first.updatedAt ?? first.createdAt ?? nowIso(),
      price: undefined,
      chains: chains.sort((a, b) => a.expiration.localeCompare(b.expiration)),
      dailyStructure,
      createdAt: first.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    };

    surfaceMap.set(surfaceKey, surface);
  }

  /**
   * Include daily structures without chains.
   * This keeps old validation records from disappearing.
   */
  for (const daily of args.dailyStructures) {
    const surfaceKey = makeSurfaceSnapshotKey(daily);

    if (surfaceMap.has(surfaceKey)) continue;

    surfaceMap.set(surfaceKey, {
      surfaceKey,
      ticker: daily.ticker,
      snapshotDate: daily.snapshotDate,
      snapshotTimeZone: "America/Chicago",
      capturedAt: daily.updatedAt ?? daily.createdAt ?? nowIso(),
      price: undefined,
      chains: [],
      dailyStructure: daily,
      createdAt: daily.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    });
  }

  return Array.from(surfaceMap.values()).sort((a, b) => {
    const tickerCompare = a.ticker.localeCompare(b.ticker);
    if (tickerCompare !== 0) return tickerCompare;
    return a.snapshotDate.localeCompare(b.snapshotDate);
  });
}

export function migrateLegacyStorageToV2(): {
  migrated: boolean;
  surfaceSnapshotCount: number;
} {
  if (!isBrowser()) {
    return {
      migrated: false,
      surfaceSnapshotCount: 0,
    };
  }

  const existing = readWheelDeskStorage();
  const legacyV1 = readLegacyStorageV1();

  const legacyChainItems = [
    ...(Array.isArray(legacyV1.chainSnapshots) ? legacyV1.chainSnapshots : []),
    ...readLegacyChainSnapshotsV2(),
  ];

  const legacyChains = legacyChainItems
    .map(normalizeChainSnapshotEntry)
    .filter((item): item is ChainSnapshotEntry => item != null);

  const legacyDailyItems: any[] = [
    ...readLegacyDailyStructureKeys(),
    ...(Array.isArray(legacyV1.snapshots) ? legacyV1.snapshots : []),
  ];

  if (
    legacyV1.dailyStructures &&
    typeof legacyV1.dailyStructures === "object"
  ) {
    for (const [ticker, items] of Object.entries(legacyV1.dailyStructures)) {
      if (!Array.isArray(items)) continue;

      for (const item of items) {
        legacyDailyItems.push({
          ...item,
          ticker: normalizeTicker((item as any).ticker ?? ticker),
        });
      }
    }
  }

  const legacyDaily = legacyDailyItems
    .map(normalizeDailyStructure)
    .filter((item): item is DailyStructureSnapshot => item != null);

  const generatedSurfaces = buildSurfacesFromLegacy({
    chainSnapshots: legacyChains,
    dailyStructures: legacyDaily,
  });

  const surfaceMap = new Map<string, OptionSurfaceSnapshot>();

  for (const existingSurface of existing.optionSurfaceSnapshots) {
    surfaceMap.set(existingSurface.surfaceKey, existingSurface);
  }

  for (const generated of generatedSurfaces) {
    if (!surfaceMap.has(generated.surfaceKey)) {
      surfaceMap.set(generated.surfaceKey, generated);
    }
  }

  const migratedStorage: WheelDeskStorageV2 = {
    version: 2,
    preferences: existing.preferences,
    optionSurfaceSnapshots: Array.from(surfaceMap.values()).sort((a, b) => {
      const tickerCompare = a.ticker.localeCompare(b.ticker);
      if (tickerCompare !== 0) return tickerCompare;
      return a.snapshotDate.localeCompare(b.snapshotDate);
    }),
    candles: existing.candles,
    positions:
      existing.positions.length > 0
        ? existing.positions
        : Array.isArray(legacyV1.positions)
          ? legacyV1.positions
          : [],
    watchlists:
      existing.watchlists.length > 0
        ? existing.watchlists
        : Array.isArray(legacyV1.watchlists)
          ? legacyV1.watchlists
          : [],
    edgeProofSummaries: existing.edgeProofSummaries ?? [],
  };

  writeWheelDeskStorage(migratedStorage);

  return {
    migrated: true,
    surfaceSnapshotCount: migratedStorage.optionSurfaceSnapshots.length,
  };
}

/**
 * Optional cleanup helper.
 * This deletes old legacy keys after you verify v2 is correct.
 */
export function deleteLegacyStorageKeys(): void {
  if (!isBrowser()) return;

  window.localStorage.removeItem(LEGACY_STORAGE_V1_KEY);
  window.localStorage.removeItem(LEGACY_CHAIN_V2_KEY);

  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith(LEGACY_DAILY_PREFIX)) {
      window.localStorage.removeItem(key);
    }
  }
}

/**
 * Validation proof summaries.
 * These are generated by /dashboard/validation and consumed by the scanner as a
 * historical proof badge. They are not live trade signals; they describe how
 * prior saved edge labels have followed through.
 */
export function readEdgeProofSummaries(label?: string): EdgeProofSummary[] {
  const summaries = readWheelDeskStorage().edgeProofSummaries ?? [];
  if (!label) return summaries;
  const normalized = String(label).trim().toLowerCase();
  return summaries.filter(
    (summary) =>
      String(summary.label ?? "")
        .trim()
        .toLowerCase() === normalized,
  );
}

export function saveEdgeProofSummaries(summaries: EdgeProofSummary[]): void {
  const storage = readWheelDeskStorage();
  const incoming = Array.isArray(summaries) ? summaries : [];
  const incomingKeys = new Set(
    incoming.map((summary) => `${summary.label}|${summary.horizonDays}`),
  );
  const existing = (storage.edgeProofSummaries ?? []).filter(
    (summary) =>
      !incomingKeys.has(
        `${summary.ticker ?? ""}|${summary.label}|${summary.horizonDays}`,
      ),
  );

  writeWheelDeskStorage({
    ...storage,
    edgeProofSummaries: [...existing, ...incoming].sort((a, b) => {
      const labelCompare = String(a.label).localeCompare(String(b.label));
      if (labelCompare !== 0) return labelCompare;
      return Number(a.horizonDays ?? 0) - Number(b.horizonDays ?? 0);
    }),
  });
}

export function clearEdgeProofSummaries(): void {
  const storage = readWheelDeskStorage();
  writeWheelDeskStorage({ ...storage, edgeProofSummaries: [] });
}
