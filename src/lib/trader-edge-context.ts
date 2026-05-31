import type { OptionSurfaceSnapshot } from "./wheeldesk-storage";

export type ExpirationContextOption = {
  expiration: string;
  dte: number | null;
  rows: number;
  totalOi: number;
  dominanceScore?: number | null;
  score?: number | null;
};

export function edgeDateOnly(value: unknown): string {
  const raw = String(value ?? "").trim();
  return raw ? raw.slice(0, 10) : "";
}

export function edgeExpirationOf(chain: any): string {
  return edgeDateOnly(chain?.expiration ?? chain?.expirationDate ?? chain?.expiry ?? chain?.date);
}

export function edgeDteFromExpiration(expiration?: string, snapshotDate?: string): number | null {
  if (!expiration || !snapshotDate) return null;
  const start = new Date(`${snapshotDate}T00:00:00Z`).getTime();
  const end = new Date(`${expiration}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const n = toFiniteNumber(value);
    if (n != null) return n;
  }
  return null;
}

function rowSide(row: any): "call" | "put" | null {
  const side = String(
    row?.side ??
      row?.type ??
      row?.optionType ??
      row?.option_type ??
      row?.raw?.side ??
      row?.raw?.type ??
      ""
  ).toLowerCase();

  if (side.includes("call")) return "call";
  if (side.includes("put")) return "put";
  return null;
}

function sideOpenInterest(row: any, side: "call" | "put"): number | null {
  if (side === "call") {
    return firstNumber(
      row?.callOi,
      row?.callOI,
      row?.call_oi,
      row?.callOpenInterest,
      row?.call_open_interest,
      row?.call?.openInterest,
      row?.call?.open_interest,
      row?.raw?.callOi,
      row?.raw?.callOI,
      row?.raw?.call_oi,
      row?.raw?.callOpenInterest,
      row?.raw?.call_open_interest,
      row?.raw?.call?.openInterest,
      row?.raw?.call?.open_interest
    );
  }

  return firstNumber(
    row?.putOi,
    row?.putOI,
    row?.put_oi,
    row?.putOpenInterest,
    row?.put_open_interest,
    row?.put?.openInterest,
    row?.put?.open_interest,
    row?.raw?.putOi,
    row?.raw?.putOI,
    row?.raw?.put_oi,
    row?.raw?.putOpenInterest,
    row?.raw?.put_open_interest,
    row?.raw?.put?.openInterest,
    row?.raw?.put?.open_interest
  );
}

function genericOpenInterest(row: any): number | null {
  return firstNumber(
    row?.openInterest,
    row?.open_interest,
    row?.oi,
    row?.raw?.openInterest,
    row?.raw?.open_interest,
    row?.raw?.oi
  );
}

function rowOi(row: any): number {
  const side = rowSide(row);
  if (side) return sideOpenInterest(row, side) ?? genericOpenInterest(row) ?? 0;

  const callOi = sideOpenInterest(row, "call") ?? 0;
  const putOi = sideOpenInterest(row, "put") ?? 0;
  const generic = genericOpenInterest(row) ?? 0;

  return callOi + putOi + (callOi || putOi ? 0 : generic);
}

export function chainRows(chain: any): any[] {
  return Array.isArray(chain?.rows)
    ? chain.rows
    : Array.isArray(chain?.optionRows)
      ? chain.optionRows
      : Array.isArray(chain?.chainRows)
        ? chain.chainRows
        : [];
}

export function getExpirationContextOptions(surface: OptionSurfaceSnapshot | null): ExpirationContextOption[] {
  if (!surface?.chains?.length) return [];

  return (surface.chains as any[])
    .map((chain) => {
      const expiration = edgeExpirationOf(chain);
      const rows = chainRows(chain);
      const totalOi = rows.reduce((sum, row) => sum + rowOi(row), 0);
      return {
        expiration,
        dte: chain?.dteAtCapture ?? chain?.dte ?? edgeDteFromExpiration(expiration, surface.snapshotDate),
        rows: rows.length,
        totalOi,
      };
    })
    .filter((item) => item.expiration)
    .sort((a, b) => a.expiration.localeCompare(b.expiration));
}

export function getDefaultExpirationContext(surface: OptionSurfaceSnapshot | null): string {
  return getExpirationContextOptions(surface)[0]?.expiration ?? "";
}

export function makeSingleExpirationSurface(
  surface: OptionSurfaceSnapshot | null,
  expiration: string
): OptionSurfaceSnapshot | null {
  if (!surface) return null;
  const selectedExpiration = edgeDateOnly(expiration) || getDefaultExpirationContext(surface);
  if (!selectedExpiration) return surface;

  const chain = (surface.chains as any[] | undefined)?.find(
    (item) => edgeExpirationOf(item) === selectedExpiration
  );

  if (!chain) return surface;

  return {
    ...surface,
    chains: [chain],
    selectedExpiration,
    contextAlignment: {
      ...(surface as any).contextAlignment,
      mode: "selected_expiration",
      selectedExpiration,
      scoreScope: "canonical_chain_edge",
      source: "shared_trader_edge_context",
    },
  } as OptionSurfaceSnapshot;
}

export function findMatchingExpirationSurface(
  surface: OptionSurfaceSnapshot | null,
  expiration: string
): OptionSurfaceSnapshot | null {
  if (!surface || !expiration) return null;
  return makeSingleExpirationSurface(surface, expiration);
}
