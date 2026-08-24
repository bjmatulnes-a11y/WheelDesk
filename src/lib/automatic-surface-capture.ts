import { getOptionChain } from "./data-provider";
import { buildOptionSurfaceSnapshot } from "./oi-surface-snapshot-builder";
import { readPreferences } from "./wheeldesk-storage";

export const AUTO_SURFACE_CAPTURE_EVENT = "wheeldesk:auto-surface-capture";

export type AutomaticSurfaceCapturePhase =
  | "checking"
  | "capturing"
  | "complete"
  | "delayed"
  | "skipped";

export type AutomaticSurfaceCaptureStatus = {
  phase: AutomaticSurfaceCapturePhase;
  targetDate: string;
  requested: number;
  captured: number;
  skipped: number;
  failed: number;
  currentSymbol?: string;
  message: string;
  completedAt?: string;
};

type WatchlistPayload = {
  ok?: boolean;
  tickers?: Array<{ symbol?: string }>;
  error?: string;
};

type CaptureArgs = {
  accessToken: string;
  userId: string;
  force?: boolean;
};

const STATUS_KEY = "wheelDesk.autoSurfaceCapture.status";
const ATTEMPT_PREFIX = "wheelDesk.autoSurfaceCapture.attempt";
const RECENT_ATTEMPT_MS = 5 * 60_000;

function normalizeSymbol(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function uniqueSymbols(values: unknown[]): string[] {
  return Array.from(new Set(values.map(normalizeSymbol).filter(Boolean)));
}

function easternDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);

  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    weekday: value("weekday"),
  };
}

/**
 * Surface OI is a daily dataset. On weekends, Friday remains the current market
 * surface. Exchange holidays are intentionally not hard-coded here; the live
 * provider remains the source of truth and a failed capture is reported as
 * delayed rather than replaced by synthetic data.
 */
export function expectedSurfaceDate(now = new Date()): string {
  const parts = easternDateParts(now);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));

  if (parts.weekday === "Sat") date.setUTCDate(date.getUTCDate() - 1);
  if (parts.weekday === "Sun") date.setUTCDate(date.getUTCDate() - 2);

  return date.toISOString().slice(0, 10);
}

function latestSurfaceDate(payload: any): string | null {
  const snapshots = [
    ...(Array.isArray(payload?.snapshots) ? payload.snapshots : []),
    ...(payload?.snapshot ? [payload.snapshot] : []),
    ...(payload?.metadata ? [payload.metadata] : []),
  ];

  const dates = snapshots
    .map((snapshot: any) => String(snapshot?.snapshotDate ?? snapshot?.snapshot_date ?? snapshot?.date ?? "").slice(0, 10))
    .filter((value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort((a: string, b: string) => b.localeCompare(a));

  return dates[0] ?? null;
}

function emitStatus(status: AutomaticSurfaceCaptureStatus) {
  if (typeof window === "undefined") return;

  try {
    sessionStorage.setItem(STATUS_KEY, JSON.stringify(status));
  } catch {
    // Status persistence is convenience only.
  }

  window.dispatchEvent(new CustomEvent(AUTO_SURFACE_CAPTURE_EVENT, { detail: status }));
}

export function readAutomaticSurfaceCaptureStatus(): AutomaticSurfaceCaptureStatus | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STATUS_KEY);
    return raw ? (JSON.parse(raw) as AutomaticSurfaceCaptureStatus) : null;
  } catch {
    return null;
  }
}

async function authHeaders(accessToken: string, includeJson = false): Promise<Record<string, string>> {
  return {
    ...(includeJson ? { "Content-Type": "application/json" } : {}),
    Authorization: `Bearer ${accessToken}`,
  };
}

async function loadWatchlist(accessToken: string): Promise<string[]> {
  const response = await fetch("/api/user-watchlist", {
    cache: "no-store",
    headers: await authHeaders(accessToken),
  });
  const payload = (await response.json().catch(() => null)) as WatchlistPayload | null;

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error ?? `Could not load tracked markets (${response.status}).`);
  }

  return uniqueSymbols((payload.tickers ?? []).map((row) => row.symbol));
}

async function surfaceIsCurrent(symbol: string, targetDate: string): Promise<boolean> {
  const response = await fetch(`/api/supabase/surface-snapshot?ticker=${encodeURIComponent(symbol)}&latest=1&metadata=1`, {
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) return false;

  const latest = latestSurfaceDate(payload);
  return Boolean(latest && latest >= targetDate);
}

async function loadLiveQuote(symbol: string): Promise<number> {
  const response = await fetch(`/api/yahoo/quote?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
  const payload = await response.json().catch(() => null);
  const price = Number(payload?.price);

  if (!response.ok || !Number.isFinite(price) || price <= 0) {
    throw new Error(payload?.error ?? `Live quote unavailable for ${symbol}.`);
  }

  return price;
}

async function saveSurface(accessToken: string, snapshot: any) {
  const response = await fetch("/api/supabase/surface-snapshot", {
    method: "POST",
    headers: await authHeaders(accessToken, true),
    body: JSON.stringify(snapshot),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error ?? `Surface save failed (${response.status}).`);
  }
}

async function captureSymbol(symbol: string, targetDate: string, accessToken: string) {
  // Automatic capture is strict: never persist data-provider fallback chains as
  // though they were a live market surface.
  const chain = await getOptionChain(symbol, targetDate, { allowFallback: false });
  const rowCount = (chain.chains ?? []).reduce((sum, expiration) => sum + (expiration.rows?.length ?? 0), 0);

  if (!chain.chains?.length || !rowCount) {
    throw new Error(`No live option-chain rows returned for ${symbol}.`);
  }

  const price = await loadLiveQuote(symbol);
  let snapshotTimeZone = "America/New_York";
  try {
    snapshotTimeZone = readPreferences().snapshotTimeZone || snapshotTimeZone;
  } catch {
    // Local preference storage is optional for automatic capture.
  }

  const surface = buildOptionSurfaceSnapshot({
    ticker: symbol,
    snapshotTimeZone,
    chains: chain.chains.map((expiration: any) => ({
      ticker: symbol,
      snapshotDate: targetDate,
      expiration: expiration.expiration,
      rows: expiration.rows ?? [],
      summary: expiration.summary ?? {},
      chainKind: expiration.chainKind,
      dteAtCapture: expiration.dteAtCapture,
    })),
    dailyStructure: {
      ticker: symbol,
      snapshotDate: targetDate,
      spot: price,
      source: "automatic_surface_capture",
      chainCount: chain.chains.length,
      rowCount,
    },
    price: {
      date: targetDate,
      close: price,
    },
  } as any);

  await saveSurface(accessToken, surface);
}

export async function runAutomaticSurfaceCapture(args: CaptureArgs): Promise<AutomaticSurfaceCaptureStatus> {
  const targetDate = expectedSurfaceDate();
  const attemptKey = `${ATTEMPT_PREFIX}.${args.userId}.${targetDate}`;

  if (typeof window !== "undefined" && !args.force) {
    try {
      const prior = readAutomaticSurfaceCaptureStatus();
      if (prior?.targetDate === targetDate && (prior.phase === "complete" || prior.phase === "skipped")) {
        return prior;
      }

      const lastAttempt = Number(localStorage.getItem(attemptKey) ?? 0);
      if (Number.isFinite(lastAttempt) && Date.now() - lastAttempt < RECENT_ATTEMPT_MS) {
        if (prior) return prior;
      }
      localStorage.setItem(attemptKey, String(Date.now()));
    } catch {
      // Locking is best-effort; database freshness checks still prevent most duplicates.
    }
  }

  let symbols: string[] = [];
  let captured = 0;
  let skipped = 0;
  let failed = 0;

  try {
    emitStatus({
      phase: "checking",
      targetDate,
      requested: 0,
      captured: 0,
      skipped: 0,
      failed: 0,
      message: "Checking tracked-market surface freshness…",
    });

    symbols = await loadWatchlist(args.accessToken);

    if (!symbols.length) {
      const status: AutomaticSurfaceCaptureStatus = {
        phase: "skipped",
        targetDate,
        requested: 0,
        captured: 0,
        skipped: 0,
        failed: 0,
        message: "No tracked markets require surface capture.",
        completedAt: new Date().toISOString(),
      };
      emitStatus(status);
      return status;
    }

    for (const symbol of symbols) {
      try {
        if (await surfaceIsCurrent(symbol, targetDate)) {
          skipped += 1;
          continue;
        }

        emitStatus({
          phase: "capturing",
          targetDate,
          requested: symbols.length,
          captured,
          skipped,
          failed,
          currentSymbol: symbol,
          message: `Updating ${symbol} market surface…`,
        });

        await captureSymbol(symbol, targetDate, args.accessToken);
        captured += 1;
      } catch (error) {
        failed += 1;
        console.warn(`[WheelDesk] Automatic surface capture failed for ${symbol}`, error);
      }
    }

    const status: AutomaticSurfaceCaptureStatus = {
      phase: failed ? "delayed" : "complete",
      targetDate,
      requested: symbols.length,
      captured,
      skipped,
      failed,
      message: failed
        ? `${failed} tracked market${failed === 1 ? "" : "s"} could not refresh. Existing surfaces remain available.`
        : captured
          ? `Surface sync complete. ${captured} updated, ${skipped} already current.`
          : `All ${skipped} tracked market surface${skipped === 1 ? " is" : "s are"} current.`,
      completedAt: new Date().toISOString(),
    };
    emitStatus(status);
    return status;
  } catch (error) {
    const status: AutomaticSurfaceCaptureStatus = {
      phase: "delayed",
      targetDate,
      requested: symbols.length,
      captured,
      skipped,
      failed: Math.max(1, failed),
      message: error instanceof Error ? error.message : "Automatic surface capture could not complete.",
      completedAt: new Date().toISOString(),
    };
    emitStatus(status);
    return status;
  }
}
