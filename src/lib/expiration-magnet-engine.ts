import {
  type ChainSnapshot,
  type ChainRow,
  type ExpirationChain,
} from "./types";

/**
 * Expiration Magnet Path engine.
 *
 * Walks the option chain expiration-by-expiration and computes, for each real
 * expiration, the OI-weighted "magnet" (the strike the open interest clusters
 * around) over the active strike band. The result is a series of points keyed to
 * the REAL expiration calendar dates — not fixed 1/5/14/30-session buckets.
 *
 * This is what the chart's cyan "expiration magnet" line is supposed to plot:
 * the market's positioning center projected across the actual options calendar,
 * so you can watch the magnet migrate from one expiration to the next.
 *
 * Active-band filter (0.5x..1.75x spot) and the OI-weighted center formula match
 * analyzeOIIntelligence / the predictability engine, so the magnet here is
 * consistent with the rest of the app.
 */

export type ExpirationMagnetPoint = {
  expiration: string; // YYYY-MM-DD
  date: string; // same as expiration; the chart x-position
  dte: number;
  magnet: number; // OI-weighted center over the active band
  callWall: number; // largest-call-OI strike (resistance)
  putWall: number; // largest-put-OI strike (support)
  totalOi: number; // active-band call+put OI behind this point
  driftPct: number; // (magnet - spot) / spot * 100
};

export type ExpirationMagnetPath = {
  ok: boolean;
  ticker: string;
  snapshotDate: string;
  currentPrice: number;
  points: ExpirationMagnetPoint[];
  startMagnet: number | null;
  endMagnet: number | null;
  firstExpiration: string | null;
  lastExpiration: string | null;
  bias: "bullish" | "bearish" | "neutral";
  notes: string[];
};

const ACTIVE_LOW = 0.5;
const ACTIVE_HIGH = 1.75;
const MIN_ACTIVE_ROWS = 3;

function safeNum(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0;
}

function dateKey(value: unknown): string {
  return String(value ?? "").slice(0, 10);
}

function dteOf(snapshotDate: string, expiration: string): number {
  const a = new Date(`${dateKey(snapshotDate)}T00:00:00Z`).getTime();
  const b = new Date(`${dateKey(expiration)}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function rowStrike(row: any): number {
  return safeNum(row?.strike ?? row?.strikePrice ?? row?.raw?.strike);
}

function sideRowOpenInterest(row: any, side: "call" | "put"): number | null {
  const rowSide = String(row?.side ?? row?.option_type ?? row?.type ?? "").toLowerCase();
  if (rowSide !== side) return null;
  const value = safeNum(
    row?.openInterest ??
      row?.open_interest ??
      row?.oi ??
      row?.raw?.openInterest ??
      row?.raw?.open_interest ??
      row?.raw?.oi,
  );
  return value > 0 ? value : 0;
}

function rowCallOi(row: any): number {
  const sideValue = sideRowOpenInterest(row, "call");
  if (sideValue != null) return sideValue;
  return safeNum(
    row?.callOi ??
      row?.callOI ??
      row?.call_oi ??
      row?.callOpenInterest ??
      row?.call_open_interest ??
      row?.call?.openInterest ??
      row?.raw?.callOi ??
      row?.raw?.call_oi ??
      row?.raw?.callOpenInterest ??
      row?.raw?.call_open_interest,
  );
}

function rowPutOi(row: any): number {
  const sideValue = sideRowOpenInterest(row, "put");
  if (sideValue != null) return sideValue;
  return safeNum(
    row?.putOi ??
      row?.putOI ??
      row?.put_oi ??
      row?.putOpenInterest ??
      row?.put_open_interest ??
      row?.put?.openInterest ??
      row?.raw?.putOi ??
      row?.raw?.put_oi ??
      row?.raw?.putOpenInterest ??
      row?.raw?.put_open_interest,
  );
}

type ActiveRow = { strike: number; callOi: number; putOi: number };

function activeRows(chain: ExpirationChain, spot: number): ActiveRow[] {
  const low = spot * ACTIVE_LOW;
  const high = spot * ACTIVE_HIGH;
  const byStrike = new Map<string, ActiveRow>();

  for (const raw of chain.rows ?? []) {
    const strike = rowStrike(raw as ChainRow | any);
    if (!(strike >= low && strike <= high && strike > 0)) continue;
    const key = strike.toFixed(4);
    const existing = byStrike.get(key) ?? { strike, callOi: 0, putOi: 0 };
    existing.callOi += rowCallOi(raw);
    existing.putOi += rowPutOi(raw);
    byStrike.set(key, existing);
  }

  return Array.from(byStrike.values())
    .filter((r) => r.callOi + r.putOi > 0)
    .sort((a, b) => a.strike - b.strike);
}

function weightedCenter(rows: ActiveRow[]): number {
  const total = rows.reduce((s, r) => s + r.callOi + r.putOi, 0);
  if (!total) return 0;
  return rows.reduce((s, r) => s + r.strike * (r.callOi + r.putOi), 0) / total;
}

function maxBy(rows: ActiveRow[], key: "callOi" | "putOi"): number {
  let best = rows[0];
  for (const r of rows) if (best && r[key] > best[key]) best = r;
  return best?.strike ?? 0;
}

export function buildExpirationMagnetPath(args: {
  snapshot: ChainSnapshot | null;
  currentPrice: number | null;
  maxDte?: number | null;
}): ExpirationMagnetPath | null {
  const snapshot = args.snapshot;
  const spot = safeNum(args.currentPrice);
  if (!snapshot || !snapshot.chains?.length || spot <= 0) return null;

  const notes: string[] = [];
  const points: ExpirationMagnetPoint[] = [];
  let skippedThin = 0;

  for (const chain of snapshot.chains) {
    const expiration = dateKey(chain.expiration);
    if (!expiration) continue;
    const dte = dteOf(snapshot.snapshotDate, expiration);
    if (dte <= 0) continue;
    if (args.maxDte != null && dte > args.maxDte) continue;

    const rows = activeRows(chain, spot);
    if (rows.length < MIN_ACTIVE_ROWS) {
      skippedThin += 1;
      continue;
    }

    const magnet = weightedCenter(rows);
    if (!(magnet > 0)) {
      skippedThin += 1;
      continue;
    }

    const totalOi = rows.reduce((s, r) => s + r.callOi + r.putOi, 0);
    points.push({
      expiration,
      date: expiration,
      dte,
      magnet: Math.round(magnet * 100) / 100,
      callWall: maxBy(rows, "callOi"),
      putWall: maxBy(rows, "putOi"),
      totalOi,
      driftPct: Math.round(((magnet - spot) / spot) * 10000) / 100,
    });
  }

  if (!points.length) return null;
  points.sort((a, b) => a.dte - b.dte);

  const start = points[0];
  const end = points[points.length - 1];
  const drift = (end.magnet - start.magnet) / spot;
  const bias =
    drift > 0.01 ? "bullish" : drift < -0.01 ? "bearish" : "neutral";

  notes.push(
    `Magnet path spans ${points.length} expiration${points.length === 1 ? "" : "s"} from ${start.expiration} (${start.dte}d) to ${end.expiration} (${end.dte}d); each point is the OI-weighted center of that chain over the active band.`,
  );
  if (skippedThin > 0)
    notes.push(
      `Skipped ${skippedThin} expiration${skippedThin === 1 ? "" : "s"} with too little active-band OI to place a reliable magnet.`,
    );
  if (points.length === 1)
    notes.push(
      "Only one expiration had usable OI; the path is a single anchor, not a trajectory.",
    );

  return {
    ok: true,
    ticker: snapshot.ticker,
    snapshotDate: dateKey(snapshot.snapshotDate),
    currentPrice: spot,
    points,
    startMagnet: start.magnet,
    endMagnet: end.magnet,
    firstExpiration: start.expiration,
    lastExpiration: end.expiration,
    bias,
    notes,
  };
}
