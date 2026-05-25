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

function rowOi(row: any): number {
  const callOi = Number(row?.callOpenInterest ?? row?.callOI ?? row?.call_oi ?? row?.call?.openInterest ?? 0);
  const putOi = Number(row?.putOpenInterest ?? row?.putOI ?? row?.put_oi ?? row?.put?.openInterest ?? 0);
  return (Number.isFinite(callOi) ? callOi : 0) + (Number.isFinite(putOi) ? putOi : 0);
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
