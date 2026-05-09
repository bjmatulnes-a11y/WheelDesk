import { supabaseServer } from "./supabase-server";
import type { OptionSurfaceSnapshot } from "./wheeldesk-storage";

type AnyRecord = Record<string, any>;
type AnySurfaceSnapshot = OptionSurfaceSnapshot & AnyRecord;

export type SupabaseSurfaceSaveResult = {
  snapshotId: string;
  ticker: string;
  snapshotDate: string;
  surfaceKey: string;
  chainRowCount: number;
};

function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateOnly(value: unknown): string | null {
  if (!value) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const raw = String(value).trim();
  if (!raw) return null;

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const n = toFiniteNumber(value);
    if (n !== null) return n;
  }

  return null;
}
function calculateDte(snapshotDate: string | null, expiration: string | null): number | null {
  if (!snapshotDate || !expiration) return null;

  const start = new Date(`${snapshotDate}T00:00:00Z`);
  const end = new Date(`${expiration}T00:00:00Z`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000));
}
function normalizeTicker(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeSide(value: unknown): "call" | "put" | null {
  const side = String(value ?? "").trim().toLowerCase();

  if (side === "call" || side === "calls" || side === "c") return "call";
  if (side === "put" || side === "puts" || side === "p") return "put";

  return null;
}

function safeJson<T>(value: T): T | null {
  if (value === undefined) return null;

  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return null;
  }
}

function getSurfaceKey(snapshot: AnySurfaceSnapshot): string {
  const ticker = normalizeTicker(snapshot.ticker);
  const snapshotDate = dateOnly(snapshot.snapshotDate) ?? todayDateOnly();

  return String(
    snapshot.surfaceKey ??
      snapshot.key ??
      snapshot.snapshotKey ??
      `${ticker}:${snapshotDate}:${snapshot.selectedExpiration ?? snapshot.expiration ?? "surface"}`
  );
}

function stripLargeChainPayload(snapshot: AnySurfaceSnapshot): AnyRecord {
  const clone: AnyRecord = { ...snapshot };

  // These can become huge and are stored relationally in option_chain_rows.
  delete clone.chains;
  delete clone.chain;
  delete clone.rows;
  delete clone.chainRows;
  delete clone.optionRows;
  delete clone.rawRows;
  delete clone.calls;
  delete clone.puts;

  return clone;
}

function rowOpenInterest(row: AnyRecord, side: "call" | "put"): number | null {
  if (side === "call") {
    return toFiniteNumber(
      row.openInterest ??
        row.open_interest ??
        row.oi ??
        row.callOi ??
        row.callOI ??
        row.callOpenInterest ??
        row.call_open_interest ??
        row.callsOpenInterest
    );
  }

  return toFiniteNumber(
    row.openInterest ??
      row.open_interest ??
      row.oi ??
      row.putOi ??
      row.putOI ??
      row.putOpenInterest ??
      row.put_open_interest ??
      row.putsOpenInterest
  );
}

function rowVolume(row: AnyRecord, side: "call" | "put"): number | null {
  if (side === "call") {
    return toFiniteNumber(
      row.volume ??
        row.callVolume ??
        row.call_volume ??
        row.callsVolume
    );
  }

  return toFiniteNumber(
    row.volume ??
      row.putVolume ??
      row.put_volume ??
      row.putsVolume
  );
}

function rowIv(row: AnyRecord, side: "call" | "put"): number | null {
  if (side === "call") {
    return toFiniteNumber(
      row.iv ??
        row.impliedVolatility ??
        row.impliedVol ??
        row.volatility ??
        row.callIv ??
        row.callIV ??
        row.callImpliedVolatility ??
        row.call_implied_volatility
    );
  }

  return toFiniteNumber(
    row.iv ??
      row.impliedVolatility ??
      row.impliedVol ??
      row.volatility ??
      row.putIv ??
      row.putIV ??
      row.putImpliedVolatility ??
      row.put_implied_volatility
  );
}

function flattenOptionChainRows(snapshot: AnySurfaceSnapshot): AnyRecord[] {
  const rows: AnyRecord[] = [];

  const pushDirectRow = (
    row: AnyRecord,
    context: AnyRecord = {},
    forcedSide?: "call" | "put"
  ) => {
    const side = forcedSide ?? normalizeSide(row.side ?? row.type ?? row.optionType);
    if (!side) return;

    const strike = toFiniteNumber(row.strike ?? row.strikePrice);
    if (strike === null) return;

    rows.push({
      ...row,
      ...context,
      side,
      strike,
    });
  };

  const pushStrikePairRow = (row: AnyRecord, context: AnyRecord = {}) => {
    const strike = toFiniteNumber(row.strike ?? row.strikePrice);
    if (strike === null) return;

    const hasCall =
      row.call ||
      row.callOi !== undefined ||
      row.callOI !== undefined ||
      row.callOpenInterest !== undefined ||
      row.call_open_interest !== undefined ||
      row.callVolume !== undefined ||
      row.callIv !== undefined ||
      row.callIV !== undefined;

    const hasPut =
      row.put ||
      row.putOi !== undefined ||
      row.putOI !== undefined ||
      row.putOpenInterest !== undefined ||
      row.put_open_interest !== undefined ||
      row.putVolume !== undefined ||
      row.putIv !== undefined ||
      row.putIV !== undefined;

    if (hasCall) {
      pushDirectRow(
        {
          ...row,
          ...(typeof row.call === "object" && row.call ? row.call : {}),
          strike,
        },
        context,
        "call"
      );
    }

    if (hasPut) {
      pushDirectRow(
        {
          ...row,
          ...(typeof row.put === "object" && row.put ? row.put : {}),
          strike,
        },
        context,
        "put"
      );
    }

    if (!hasCall && !hasPut) {
      pushDirectRow(row, context);
    }
  };

  const chainContainers = [
    snapshot.chains,
    snapshot.chainSnapshots,
    snapshot.expirationChains,
    snapshot.surfaces,
  ].filter(Array.isArray) as AnyRecord[][];

  for (const chains of chainContainers) {
    for (const chain of chains) {
      const context = {
        expiration:
          chain.expiration ??
          chain.expirationDate ??
          chain.expiry ??
          snapshot.selectedExpiration,
        dte: chain.dte ?? chain.daysToExpiration ?? chain.DTE,
      };

      const chainRows = chain.rows ?? chain.chainRows ?? chain.optionRows ?? chain.contracts;
      if (Array.isArray(chainRows)) {
        for (const row of chainRows) {
          pushStrikePairRow(row, context);
        }
      }

      if (Array.isArray(chain.calls)) {
        for (const row of chain.calls) {
          pushDirectRow(row, context, "call");
        }
      }

      if (Array.isArray(chain.puts)) {
        for (const row of chain.puts) {
          pushDirectRow(row, context, "put");
        }
      }
    }
  }

  const directRows = [
    snapshot.rows,
    snapshot.chainRows,
    snapshot.optionRows,
    snapshot.rawRows,
  ].filter(Array.isArray) as AnyRecord[][];

  for (const rowSet of directRows) {
    for (const row of rowSet) {
      pushStrikePairRow(row, {
        expiration: snapshot.selectedExpiration ?? snapshot.expiration,
        dte: snapshot.selectedDte ?? snapshot.dte,
      });
    }
  }

  if (Array.isArray(snapshot.calls)) {
    for (const row of snapshot.calls) {
      pushDirectRow(
        row,
        {
          expiration: snapshot.selectedExpiration ?? snapshot.expiration,
          dte: snapshot.selectedDte ?? snapshot.dte,
        },
        "call"
      );
    }
  }

  if (Array.isArray(snapshot.puts)) {
    for (const row of snapshot.puts) {
      pushDirectRow(
        row,
        {
          expiration: snapshot.selectedExpiration ?? snapshot.expiration,
          dte: snapshot.selectedDte ?? snapshot.dte,
        },
        "put"
      );
    }
  }

  return rows;
}

function mapChainRowToDbRow(args: {
  snapshotId: string;
  ticker: string;
  snapshotDate: string;
  selectedExpiration: string | null;
  selectedDte: number | null;
  row: AnyRecord;
}) {
  const side = normalizeSide(args.row.side);
  if (!side) return null;

  const strike = toFiniteNumber(args.row.strike ?? args.row.strikePrice);
  if (strike === null) return null;

  const expiration =
    dateOnly(args.row.expiration ?? args.row.expirationDate ?? args.row.expiry) ??
    args.selectedExpiration;

  const dte =
  firstFiniteNumber(
    args.row.dte,
    args.row.DTE,
    args.row.daysToExpiration,
    args.row.days_to_expiration,
    args.selectedDte
  ) ?? calculateDte(args.snapshotDate, expiration);  

  return {
    snapshot_id: args.snapshotId,
    ticker: args.ticker,
    snapshot_date: args.snapshotDate,
    expiration,
    dte,

    strike,
    side,

    open_interest: rowOpenInterest(args.row, side),
    volume: rowVolume(args.row, side),
    iv: rowIv(args.row, side),

    delta: firstFiniteNumber(args.row.delta, args.row.greeks?.delta),
gamma: firstFiniteNumber(args.row.gamma, args.row.greeks?.gamma),
theta: firstFiniteNumber(args.row.theta, args.row.greeks?.theta),
vega: firstFiniteNumber(args.row.vega, args.row.greeks?.vega),

bid: firstFiniteNumber(args.row.bid, args.row.bidPrice, args.row.bestBid),
ask: firstFiniteNumber(args.row.ask, args.row.askPrice, args.row.bestAsk),
last: firstFiniteNumber(
  args.row.last,
  args.row.lastPrice,
  args.row.lastTradePrice,
  args.row.regularMarketPrice,
  args.row.mark,
  args.row.mid
),
change: firstFiniteNumber(
  args.row.change,
  args.row.priceChange,
  args.row.regularMarketChange
),
percent_change: firstFiniteNumber(
  args.row.percentChange,
  args.row.percent_change,
  args.row.changePercent,
  args.row.regularMarketChangePercent
),

    raw: safeJson(args.row),
  };
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

export async function saveSurfaceSnapshotToSupabase(
  snapshot: OptionSurfaceSnapshot
): Promise<SupabaseSurfaceSaveResult> {
  const s = snapshot as AnySurfaceSnapshot;

  const ticker = normalizeTicker(s.ticker);
  if (!ticker) {
    throw new Error("Cannot save option surface snapshot without ticker.");
  }

  const snapshotDate = dateOnly(s.snapshotDate) ?? todayDateOnly();
  const surfaceKey = getSurfaceKey(s);

  const selectedExpiration = dateOnly(
    s.selectedExpiration ??
      s.expiration ??
      s.chainExpiration ??
      s.primaryExpiration
  );

const selectedDte = firstFiniteNumber(
  s.selectedDte,
  s.selectedDTE,
  s.dte,
  s.DTE,
  s.daysToExpiration,
  s.days_to_expiration,
  s.dailyStructure?.selectedDte,
  s.dailyStructure?.selectedDTE,
  s.dailyStructure?.dte
);

  const parentPayload = {
    ticker,
    snapshot_date: snapshotDate,
    surface_key: surfaceKey,

    spot: firstFiniteNumber(
  s.spot,
  s.currentPrice,
  s.underlyingPrice,
  s.price,
  s.analysisPrice,
  s.livePrice,
  s.lastPrice,
  s.mark,
  s.dailyStructure?.spot,
  s.dailyStructure?.currentPrice,
  s.dailyStructure?.analysisPrice,
  s.summary?.spot,
  s.summary?.currentPrice,
  s.quote?.price,
  s.quote?.regularMarketPrice,
  s.quote?.regular_market_price,
  s.quote?.postMarketPrice,
  s.quote?.preMarketPrice
),
    selected_expiration: selectedExpiration,
    selected_dte: selectedDte,

    daily_structure: safeJson(s.dailyStructure ?? null),
    prevailing_levels: safeJson(s.prevailingLevels ?? s.dailyStructure?.prevailingLevels ?? null),
    implied_path: safeJson(s.impliedPath ?? s.dailyStructure?.impliedPath ?? null),
    summary: safeJson(s.summary ?? null),
    metadata: safeJson({
      originalSnapshot: stripLargeChainPayload(s),
      source: "wheeldesk_supabase_repository",
    }),

    updated_at: new Date().toISOString(),
  };

  const { data: parent, error: parentError } = await supabaseServer
    .from("option_surface_snapshots")
    .upsert(parentPayload, {
      onConflict: "ticker,snapshot_date,surface_key",
    })
    .select("id")
    .single();

  if (parentError || !parent?.id) {
    throw new Error(
      `Failed to save option surface snapshot: ${parentError?.message ?? "missing snapshot id"}`
    );
  }

  const snapshotId = String(parent.id);

  const { error: deleteError } = await supabaseServer
    .from("option_chain_rows")
    .delete()
    .eq("snapshot_id", snapshotId);

  if (deleteError) {
    throw new Error(`Failed to replace option chain rows: ${deleteError.message}`);
  }

  const flattenedRows = flattenOptionChainRows(s);

  const dbRows = flattenedRows
    .map((row) =>
      mapChainRowToDbRow({
        snapshotId,
        ticker,
        snapshotDate,
        selectedExpiration,
        selectedDte,
        row,
      })
    )
    .filter((row): row is NonNullable<typeof row> => row !== null);

  for (const chunk of chunkArray(dbRows, 500)) {
    const { error: insertError } = await supabaseServer
      .from("option_chain_rows")
      .insert(chunk);

    if (insertError) {
      throw new Error(`Failed to insert option chain rows: ${insertError.message}`);
    }
  }

  return {
    snapshotId,
    ticker,
    snapshotDate,
    surfaceKey,
    chainRowCount: dbRows.length,
  };
}

function reconstructChains(rows: AnyRecord[]): AnyRecord[] {
  const chainMap = new Map<string, AnyRecord>();

  for (const row of rows) {
    const expiration = row.expiration ?? "unknown";
    const dte = row.dte ?? null;
    const key = `${expiration}|${dte}`;

    if (!chainMap.has(key)) {
      chainMap.set(key, {
        expiration,
        dte,
        rows: [],
        calls: [],
        puts: [],
      });
    }

    const chain = chainMap.get(key)!;

    const reconstructedRow = {
      ...(row.raw ?? {}),
      id: row.id,
      expiration: row.expiration,
      dte: row.dte,
      strike: row.strike === null ? undefined : Number(row.strike),
      side: row.side,
      openInterest:
        row.open_interest === null || row.open_interest === undefined
          ? undefined
          : Number(row.open_interest),
      volume:
        row.volume === null || row.volume === undefined
          ? undefined
          : Number(row.volume),
      iv:
        row.iv === null || row.iv === undefined
          ? undefined
          : Number(row.iv),
      delta:
        row.delta === null || row.delta === undefined
          ? undefined
          : Number(row.delta),
      gamma:
        row.gamma === null || row.gamma === undefined
          ? undefined
          : Number(row.gamma),
      theta:
        row.theta === null || row.theta === undefined
          ? undefined
          : Number(row.theta),
      vega:
        row.vega === null || row.vega === undefined
          ? undefined
          : Number(row.vega),
      bid:
        row.bid === null || row.bid === undefined
          ? undefined
          : Number(row.bid),
      ask:
        row.ask === null || row.ask === undefined
          ? undefined
          : Number(row.ask),
      last:
        row.last === null || row.last === undefined
          ? undefined
          : Number(row.last),
    };

    chain.rows.push(reconstructedRow);

    if (row.side === "call") chain.calls.push(reconstructedRow);
    if (row.side === "put") chain.puts.push(reconstructedRow);
  }

  return Array.from(chainMap.values()).sort((a, b) =>
    String(a.expiration).localeCompare(String(b.expiration))
  );
}

function mapParentAndRowsToSnapshot(
  parent: AnyRecord,
  rows: AnyRecord[]
): OptionSurfaceSnapshot {
  const original = parent.metadata?.originalSnapshot ?? {};

  const reconstructed: AnyRecord = {
    ...original,

    surfaceKey: parent.surface_key,
    ticker: parent.ticker,
    snapshotDate: parent.snapshot_date,

    spot:
      parent.spot === null || parent.spot === undefined
        ? original.spot
        : Number(parent.spot),

    selectedExpiration:
      parent.selected_expiration ?? original.selectedExpiration,

    selectedDte:
      parent.selected_dte === null || parent.selected_dte === undefined
        ? original.selectedDte
        : Number(parent.selected_dte),

    dailyStructure:
      parent.daily_structure ?? original.dailyStructure,

    prevailingLevels:
      parent.prevailing_levels ?? original.prevailingLevels,

    impliedPath:
      parent.implied_path ?? original.impliedPath,

    summary:
      parent.summary ?? original.summary,

    metadata: {
      ...(original.metadata ?? {}),
      ...(parent.metadata ?? {}),
      supabaseSnapshotId: parent.id,
      loadedFrom: "supabase",
    },

    chains: reconstructChains(rows),

    createdAt: parent.created_at ?? original.createdAt,
    updatedAt: parent.updated_at ?? original.updatedAt,
  };

  return reconstructed as OptionSurfaceSnapshot;
}

export async function readSurfaceSnapshotsFromSupabase(
  ticker: string,
  limit = 50
): Promise<OptionSurfaceSnapshot[]> {
  const normalizedTicker = normalizeTicker(ticker);

  if (!normalizedTicker) return [];

  const { data: parents, error: parentError } = await supabaseServer
    .from("option_surface_snapshots")
    .select("*")
    .eq("ticker", normalizedTicker)
    .order("snapshot_date", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (parentError) {
    throw new Error(`Failed to read surface snapshots: ${parentError.message}`);
  }

  if (!parents?.length) return [];

  const snapshotIds = parents.map((parent) => parent.id);

  const { data: rows, error: rowsError } = await supabaseServer
    .from("option_chain_rows")
    .select("*")
    .in("snapshot_id", snapshotIds)
    .order("expiration", { ascending: true })
    .order("strike", { ascending: true });

  if (rowsError) {
    throw new Error(`Failed to read option chain rows: ${rowsError.message}`);
  }

  const rowsBySnapshotId = new Map<string, AnyRecord[]>();

  for (const row of rows ?? []) {
    const key = String(row.snapshot_id);
    const list = rowsBySnapshotId.get(key) ?? [];
    list.push(row);
    rowsBySnapshotId.set(key, list);
  }

  return parents.map((parent) =>
    mapParentAndRowsToSnapshot(
      parent,
      rowsBySnapshotId.get(String(parent.id)) ?? []
    )
  );
}

export async function readLatestSurfaceSnapshotFromSupabase(
  ticker: string
): Promise<OptionSurfaceSnapshot | null> {
  const snapshots = await readSurfaceSnapshotsFromSupabase(ticker, 1);
  return snapshots[0] ?? null;
}

export async function deleteSurfaceSnapshotFromSupabase(args: {
  ticker: string;
  snapshotDate: string;
  surfaceKey: string;
}): Promise<void> {
  const { error } = await supabaseServer
    .from("option_surface_snapshots")
    .delete()
    .eq("ticker", normalizeTicker(args.ticker))
    .eq("snapshot_date", dateOnly(args.snapshotDate) ?? args.snapshotDate)
    .eq("surface_key", args.surfaceKey);

  if (error) {
    throw new Error(`Failed to delete surface snapshot: ${error.message}`);
  }
}

// Aliases for easier naming from API routes.
export const saveOptionSurfaceSnapshotToSupabase = saveSurfaceSnapshotToSupabase;
export const readOptionSurfaceSnapshotsFromSupabase = readSurfaceSnapshotsFromSupabase;
export const readLatestOptionSurfaceSnapshotFromSupabase =
  readLatestSurfaceSnapshotFromSupabase;