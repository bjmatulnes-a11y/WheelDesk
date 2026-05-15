import { analyzeOIIntelligence, type OIIntelligenceReport } from "./oi-intelligence-engine";
import type { ChainRow, ExpirationSummary } from "./types";
import type { OptionSurfaceSnapshot } from "./wheeldesk-storage";

type Side = "call" | "put";

type NormalizedOptionRow = {
  strike: number;
  side: Side;
  oi: number;
  volume: number;
};

export type OIIntelligenceView = {
  rows: NormalizedOptionRow[];
  chainRows: ChainRow[];
  summary: ExpirationSummary;
  report: OIIntelligenceReport | null;
  activeRows: ChainRow[];
};

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getSide(row: any): Side | null {
  const value = String(
    row?.side ??
      row?.type ??
      row?.optionType ??
      row?.option_type ??
      row?.raw?.side ??
      row?.raw?.type ??
      row?.raw?.optionType ??
      row?.raw?.option_type ??
      ""
  ).toLowerCase();

  if (value.includes("call")) return "call";
  if (value.includes("put")) return "put";

  return null;
}

function getStrike(row: any): number | null {
  return toNumber(row?.strike) ?? toNumber(row?.raw?.strike) ?? null;
}

function getOpenInterest(row: any): number {
  return (
    toNumber(row?.openInterest) ??
    toNumber(row?.open_interest) ??
    toNumber(row?.oi) ??
    toNumber(row?.raw?.openInterest) ??
    toNumber(row?.raw?.open_interest) ??
    toNumber(row?.raw?.oi) ??
    0
  );
}

function getVolume(row: any): number {
  return toNumber(row?.volume) ?? toNumber(row?.raw?.volume) ?? 0;
}

function normalizeRows(surface: OptionSurfaceSnapshot | null): NormalizedOptionRow[] {
  const rows: NormalizedOptionRow[] = [];

  for (const chain of surface?.chains ?? []) {
    for (const row of (chain as any)?.rows ?? []) {
      const strike = getStrike(row);
      const side = getSide(row);
      const oi = getOpenInterest(row);
      const volume = getVolume(row);

      if (strike == null || !side || !Number.isFinite(oi)) continue;

      rows.push({
        strike,
        side,
        oi,
        volume,
      });
    }
  }

  return rows;
}

function toChainRows(rows: NormalizedOptionRow[]): ChainRow[] {
  const byStrike = new Map<number, any>();

  for (const row of rows) {
    const existing = byStrike.get(row.strike) ?? {
      strike: row.strike,
      callOi: 0,
      putOi: 0,
      callVolume: 0,
      putVolume: 0,
    };

    if (row.side === "call") {
      existing.callOi += row.oi;
      existing.callVolume += row.volume;
    } else {
      existing.putOi += row.oi;
      existing.putVolume += row.volume;
    }

    byStrike.set(row.strike, existing);
  }

  return Array.from(byStrike.values()).sort((a, b) => a.strike - b.strike) as ChainRow[];
}

function largestWall(rows: ChainRow[], side: Side): { strike: number; oi: number } {
  let bestStrike = 0;
  let bestOi = -Infinity;

  for (const row of rows as any[]) {
    const oi = side === "call" ? Number(row.callOi ?? 0) : Number(row.putOi ?? 0);
    const strike = Number(row.strike ?? 0);

    if (oi > bestOi || (oi === bestOi && strike < bestStrike)) {
      bestOi = oi;
      bestStrike = strike;
    }
  }

  return {
    strike: bestStrike,
    oi: Number.isFinite(bestOi) ? bestOi : 0,
  };
}

function weightedCenter(rows: ChainRow[]): number {
  const total = (rows as any[]).reduce(
    (sum, row) => sum + Number(row.callOi ?? 0) + Number(row.putOi ?? 0),
    0
  );

  if (!total) return 0;

  return (
    (rows as any[]).reduce(
      (sum, row) =>
        sum + Number(row.strike ?? 0) * (Number(row.callOi ?? 0) + Number(row.putOi ?? 0)),
      0
    ) / total
  );
}

function buildSummary(rows: ChainRow[]): ExpirationSummary {
  const callWall = largestWall(rows, "call");
  const putWall = largestWall(rows, "put");
  const combinedCenter = weightedCenter(rows);

  const totalCallOi = (rows as any[]).reduce((sum, row) => sum + Number(row.callOi ?? 0), 0);
  const totalPutOi = (rows as any[]).reduce((sum, row) => sum + Number(row.putOi ?? 0), 0);
  const totalCallVolume = (rows as any[]).reduce((sum, row) => sum + Number(row.callVolume ?? 0), 0);
  const totalPutVolume = (rows as any[]).reduce((sum, row) => sum + Number(row.putVolume ?? 0), 0);

  const strikes = (rows as any[]).map((row) => Number(row.strike)).filter(Number.isFinite);

const callWeightedStrike =
  totalCallOi > 0
    ? (rows as any[]).reduce(
        (sum, row) => sum + Number(row.strike ?? 0) * Number(row.callOi ?? 0),
        0
      ) / totalCallOi
    : 0;

const putWeightedStrike =
  totalPutOi > 0
    ? (rows as any[]).reduce(
        (sum, row) => sum + Number(row.strike ?? 0) * Number(row.putOi ?? 0),
        0
      ) / totalPutOi
    : 0;

return {
  expiration: "",
  dte: 0,
  totalCallOi,
  totalPutOi,
  totalCallVolume,
  totalPutVolume,
  callWall: callWall.strike,
  putWall: putWall.strike,
  combinedCenter,
  callWeightedStrike,
  putWeightedStrike,
  lowerRange: strikes.length ? Math.min(...strikes) : 0,
  upperRange: strikes.length ? Math.max(...strikes) : 0,
  prevailingScore: 0,
} as ExpirationSummary;
}

function activeRows(rows: ChainRow[], currentPrice: number): ChainRow[] {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return [];

  const low = currentPrice * 0.5;
  const high = currentPrice * 1.75;

  return rows.filter((row) => row.strike >= low && row.strike <= high);
}

export function buildOIIntelligenceView(args: {
  surface: OptionSurfaceSnapshot | null;
  currentPrice: number;
}): OIIntelligenceView | null {
  const rows = normalizeRows(args.surface);
  const chainRows = toChainRows(rows);
  const summary = buildSummary(chainRows);

  if (!chainRows.length || !Number.isFinite(args.currentPrice) || args.currentPrice <= 0) {
    return {
      rows,
      chainRows,
      summary,
      report: null,
      activeRows: [],
    };
  }

  const report = analyzeOIIntelligence({
    rows: chainRows,
    summary,
    currentPrice: args.currentPrice,
  });

  return {
    rows,
    chainRows,
    summary,
    report,
    activeRows: activeRows(chainRows, args.currentPrice),
  };
}
