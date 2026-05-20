"use client";

import { useEffect, useMemo, useState } from "react";
import AuthGate from "../../components/auth/AuthGate";
import { WheelDeskSideNav } from "../../components/WheelDeskSideNav";
import type { CandleRecord, OptionSurfaceSnapshot } from "../../lib/wheeldesk-storage";
import {
  buildTraderEdgeSummary,
  latestSurfaceByTicker,
  type TraderEdgeSummary,
} from "../../lib/trader-edge-engine";
import {
  buildWallMigrationSummary,
  findPriorSurfaceForTicker,
  type WallMigrationSummary,
} from "../../lib/oi-wall-migration-engine";
import { buildOIIntelligenceView } from "../../lib/oi-intelligence-view";
import { buildFlowIntelligenceView } from "../../lib/flow-intelligence-view";
import { getPriceSeries } from "../../lib/data-provider";
import { getSupabaseAuthClient } from "../../lib/auth/supabase-auth-client";

const FOUNDER_SEED = ["SOFI", "AMD", "NVDA", "SPY", "QQQ", "AAPL", "MSFT", "PLTR"];

async function getWatchlistAuthHeaders(includeJson = false): Promise<Record<string, string>> {
  const headers: Record<string, string> = includeJson ? { "Content-Type": "application/json" } : {};

  const { data } = await getSupabaseAuthClient().auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("Login session is not ready yet. Refresh the watchlist or sign in again.");
  }

  headers.Authorization = `Bearer ${token}`;
  return headers;
}

type TriageStatus = "action" | "watch" | "avoid" | "stale" | "missing" | "review";

type Entitlement = {
  plan: "founder" | "core" | "research";
  maxTickers: number;
  maxReplacementsPerDay: number;
  maxValidationHistoryDays: number;
};

type SavedTicker = {
  id: string;
  symbol: string;
  slot_index?: number | null;
  source?: string | null;
  created_at?: string;
  ticker_universe?: {
    name?: string | null;
    asset_type?: string | null;
    data_priority?: number | null;
  } | null;
};

type UniverseTicker = {
  symbol: string;
  name?: string | null;
  asset_type?: string;
  data_priority?: number;
};

type ForecastDbRow = {
  id: string;
  symbol: string;
  generated_at?: string;
  snapshot_date?: string;
  expiration?: string | null;
  spot?: number | string | null;
  bias?: string | null;
  confidence?: number | string | null;
  base_30d?: number | string | null;
  upper_30d?: number | string | null;
  lower_30d?: number | string | null;
  expected_move_lower?: number | string | null;
  expected_move_upper?: number | string | null;
  trap_probability?: number | string | null;
  wheel_support_hold_probability?: number | string | null;
  posture?: string | null;
};

type WatchlistRow = {
  ticker: string;
  savedTicker: SavedTicker;
  surface: OptionSurfaceSnapshot | null;
  forecast: ForecastDbRow | null;
  summary: TraderEdgeSummary | null;
  migration: WallMigrationSummary | null;
  oiRows: number;
  oiAnomalies: number;
  flowBias: string;
  flowConfidence: number;
  status: TriageStatus;
  priority: number;
  statusLabel: string;
  reason: string;
  changeText: string;
  dataNotes: string[];
};

const colors = {
  bg: "#020b14",
  panel: "rgba(7, 21, 35, 0.82)",
  panel2: "rgba(6, 16, 27, 0.92)",
  border: "#20384d",
  borderSoft: "rgba(80, 120, 153, 0.28)",
  text: "#e5f6ff",
  white: "#f8fbff",
  muted: "#9fb4c7",
  dim: "#7791a8",
  teal: "#22d3ee",
  green: "#22c55e",
  red: "#fb7185",
  amber: "#f59e0b",
  purple: "#c084fc",
};

function normalizeTicker(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.\-]/g, "")
    .slice(0, 12);
}

function dateOnly(value: unknown): string {
  const raw = String(value ?? "").trim();
  return raw ? raw.slice(0, 10) : "";
}

function dteFromExpiration(expiration?: string, snapshotDate?: string): number | null {
  if (!expiration || !snapshotDate) return null;
  const start = new Date(`${snapshotDate}T00:00:00Z`).getTime();
  const end = new Date(`${expiration}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function expirationOf(chain: any): string {
  return dateOnly(chain?.expiration ?? chain?.expirationDate ?? chain?.expiry ?? chain?.date);
}

function surfaceDateOf(raw: any): string {
  return dateOnly(raw?.snapshotDate ?? raw?.snapshot_date ?? raw?.date ?? raw?.asOfDate);
}

function normalizeSurfaceSnapshot(raw: any): OptionSurfaceSnapshot | null {
  if (!raw) return null;

  const ticker = normalizeTicker(raw.ticker ?? raw.symbol);
  const snapshotDate = surfaceDateOf(raw);
  const rawChains = raw.chains ?? raw.optionChains ?? raw.surface?.chains ?? [];

  if (!ticker || !snapshotDate || !Array.isArray(rawChains)) return null;

  const chains = rawChains
    .map((chain: any) => {
      const expiration = expirationOf(chain);
      if (!expiration) return null;

      return {
        ...chain,
        expiration,
        rows: Array.isArray(chain?.rows)
          ? chain.rows
          : Array.isArray(chain?.optionRows)
            ? chain.optionRows
            : Array.isArray(chain?.chainRows)
              ? chain.chainRows
              : [],
        summary: chain?.summary ?? chain?.chainSummary ?? {},
        dteAtCapture:
          chain?.dteAtCapture ??
          chain?.dte ??
          dteFromExpiration(expiration, snapshotDate) ??
          null,
      };
    })
    .filter(Boolean);

  return {
    ...raw,
    ticker,
    snapshotDate,
    surfaceKey: raw.surfaceKey ?? raw.surface_key ?? `${ticker}_${snapshotDate}`,
    chains,
    dailyStructure: raw.dailyStructure ?? raw.daily_structure ?? raw.structure ?? null,
    price: raw.price ?? {
      date: snapshotDate,
      close: Number(raw.spot ?? raw.dailyStructure?.spot ?? raw.daily_structure?.spot ?? 0),
    },
  } as OptionSurfaceSnapshot;
}

function extractSnapshots(payload: any): OptionSurfaceSnapshot[] {
  const candidates = [payload?.snapshots, payload?.surfaces, payload?.data, payload?.items, payload?.surfaceSnapshots];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate
        .map(normalizeSurfaceSnapshot)
        .filter((snapshot): snapshot is OptionSurfaceSnapshot => Boolean(snapshot));
    }
  }

  const single = payload?.snapshot ?? payload?.surface ?? payload;
  const normalized = normalizeSurfaceSnapshot(single);
  return normalized ? [normalized] : [];
}

async function fetchSupabaseSurfaceList(): Promise<OptionSurfaceSnapshot[]> {
  const urls = [
    "/api/supabase/surface-snapshot?mode=list&limit=750",
    "/api/supabase/surface-snapshot?mode=list",
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) continue;
      const snapshots = extractSnapshots(payload);
      if (snapshots.length) return snapshots;
    } catch {
      // Try the next supported API shape.
    }
  }

  return [];
}

async function fetchSupabaseSurfacesForTicker(ticker: string): Promise<OptionSurfaceSnapshot[]> {
  const response = await fetch(`/api/supabase/surface-snapshot?ticker=${encodeURIComponent(ticker)}`, {
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) return [];
  return extractSnapshots(payload);
}

async function fetchForecastForTicker(ticker: string): Promise<ForecastDbRow | null> {
  try {
    const response = await fetch(`/api/forecasts/oi-field?symbol=${encodeURIComponent(ticker)}&limit=1`, {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) return null;
    return Array.isArray(payload?.forecasts) ? payload.forecasts[0] ?? null : null;
  } catch {
    return null;
  }
}

async function fetchCandles(ticker: string): Promise<CandleRecord[]> {
  try {
    const rows = await getPriceSeries(ticker as any, "daily" as any);
    return (rows as any[])
      .map((row) => ({
        date: String(row?.date ?? row?.time ?? row?.timestamp ?? "").slice(0, 10),
        open: Number(row?.open ?? row?.close),
        high: Number(row?.high ?? row?.close),
        low: Number(row?.low ?? row?.close),
        close: Number(row?.close),
        volume: Number(row?.volume ?? 0),
      }))
      .filter((row) => row.date && Number.isFinite(row.close))
      .slice(-180) as CandleRecord[];
  } catch {
    return [];
  }
}

function num(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fmt(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return value.toFixed(digits);
}

function money(value: number | string | null | undefined): string {
  const n = num(value);
  if (n == null) return "N/A";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function pct(value: number | string | null | undefined): string {
  const n = num(value);
  if (n == null) return "N/A";
  return `${n.toFixed(1)}%`;
}

function signed(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function daysOld(snapshotDate?: string): number | null {
  if (!snapshotDate) return null;
  const today = new Date();
  const snap = new Date(`${snapshotDate}T00:00:00`);
  const diff = today.getTime() - snap.getTime();
  if (!Number.isFinite(diff)) return null;
  return Math.max(0, Math.floor(diff / 86_400_000));
}

function buildChangeText(migration: WallMigrationSummary | null): string {
  if (!migration) return "No prior comparison yet.";
  if ((migration as any).hasPrior === false) return "First saved surface. Need another snapshot for wall migration.";

  const support = signed((migration as any).supportChange);
  const magnet = signed((migration as any).magnetChange);
  const resistance = signed((migration as any).resistanceChange);
  const label = String((migration as any).label ?? "Wall migration");

  return `${label}: support ${support}, magnet ${magnet}, resistance ${resistance}.`;
}

function rowStatus(args: {
  surface: OptionSurfaceSnapshot | null;
  summary: TraderEdgeSummary | null;
  oiAnomalies: number;
  forecast: ForecastDbRow | null;
}): Pick<WatchlistRow, "status" | "priority" | "statusLabel" | "reason"> {
  const { surface, summary, oiAnomalies, forecast } = args;

  if (!surface && !forecast) {
    return {
      status: "missing",
      priority: 20,
      statusLabel: "Missing data",
      reason: "No shared surface or OI Field forecast found yet. Harvest this ticker before trusting it.",
    };
  }

  if (!surface && forecast) {
    return {
      status: "review",
      priority: 48,
      statusLabel: "Forecast only",
      reason: "Latest OI forecast exists, but no current surface was found for full triage.",
    };
  }

  if (!summary) {
    return {
      status: "review",
      priority: 45,
      statusLabel: "Needs review",
      reason: "Surface exists but the Trader Edge calculation did not complete.",
    };
  }

  const staleDays = daysOld(surface?.snapshotDate);
  if ((staleDays ?? 999) > 7) {
    return {
      status: "stale",
      priority: 35,
      statusLabel: "Stale data",
      reason: `${staleDays} days old. Refresh before trusting setup quality.`,
    };
  }

  if (summary.actionBucket === "Premium trap / avoid" || summary.trapRisk >= 75) {
    return {
      status: "avoid",
      priority: 85,
      statusLabel: "Avoid / trap",
      reason: "Trap risk dominates. Do not chase obvious premium.",
    };
  }

  if (
    summary.dataQualityScore >= 70 &&
    summary.edgeScore >= 65 &&
    summary.trapRisk < 65 &&
    ["Best CSP setup", "Best covered-call setup", "Wheel candidate"].includes(summary.actionBucket)
  ) {
    return {
      status: "action",
      priority: 100,
      statusLabel: "Action candidate",
      reason: summary.bestAction,
    };
  }

  if (summary.actionBucket === "Compression coil" || summary.actionBucket === "Conflict / wait" || summary.edgeScore >= 55) {
    return {
      status: "watch",
      priority: 70,
      statusLabel: "Watch",
      reason: summary.bestAction,
    };
  }

  if (summary.dataQualityScore < 70 || oiAnomalies > 3) {
    return {
      status: "review",
      priority: 55,
      statusLabel: "Review",
      reason: "Data quality or OI anomalies require review before action.",
    };
  }

  return {
    status: "review",
    priority: 50,
    statusLabel: "Low edge",
    reason: "No immediate setup. Keep on watchlist.",
  };
}

function statusTone(status: TriageStatus) {
  if (status === "action") return { color: colors.green, bg: "rgba(34, 197, 94, 0.1)", border: "rgba(34, 197, 94, 0.45)" };
  if (status === "avoid") return { color: colors.red, bg: "rgba(251, 113, 133, 0.1)", border: "rgba(251, 113, 133, 0.45)" };
  if (status === "watch") return { color: colors.amber, bg: "rgba(245, 158, 11, 0.1)", border: "rgba(245, 158, 11, 0.45)" };
  if (status === "stale" || status === "missing") return { color: "#94a3b8", bg: "rgba(148, 163, 184, 0.08)", border: "rgba(148, 163, 184, 0.35)" };
  return { color: colors.teal, bg: "rgba(34, 211, 238, 0.08)", border: "rgba(34, 211, 238, 0.35)" };
}

function metricTone(value: number | null | undefined, invert = false): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return colors.muted;
  if (invert) return n >= 75 ? colors.red : n >= 55 ? colors.amber : colors.green;
  return n >= 70 ? colors.green : n >= 55 ? colors.amber : colors.red;
}

function Score({ value, invert = false }: { value: number | null | undefined; invert?: boolean }) {
  const n = Number(value);
  return <strong style={{ color: metricTone(value, invert) }}>{Number.isFinite(n) ? n.toFixed(0) : "N/A"}</strong>;
}

function StatCard({ label, value, help, tone = colors.teal }: { label: string; value: string | number; help: string; tone?: string }) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statLabel}>{label}</div>
      <div style={{ ...styles.statValue, color: tone }}>{value}</div>
      <div style={styles.statHelp}>{help}</div>
    </div>
  );
}

function ActionBadge({ row }: { row: WatchlistRow }) {
  const tone = statusTone(row.status);
  return (
    <span style={{ border: `1px solid ${tone.border}`, background: tone.bg, color: tone.color, borderRadius: 999, padding: "0.22rem 0.5rem", fontWeight: 900, whiteSpace: "nowrap" }}>
      {row.statusLabel}
    </span>
  );
}

function buildDailyRead(counts: Record<TriageStatus | "all", number>, best: WatchlistRow | null): string {
  if (!counts.all) return "No saved tickers yet. Add symbols from the central WheelDesk universe to start the daily loop.";
  const parts = [
    `${counts.action} action candidate${counts.action === 1 ? "" : "s"}`,
    `${counts.watch} watch-only`,
    `${counts.avoid} avoid/trap`,
    `${counts.stale + counts.missing} stale or missing`,
  ];
  const lead = best ? `Start with ${best.ticker}: ${best.statusLabel.toLowerCase()}.` : "No top priority yet.";
  return `${lead} ${parts.join(" · ")}.`;
}

export default function WatchlistCommandPage() {
  const [savedTickers, setSavedTickers] = useState<SavedTicker[]>([]);
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [replacementsUsedToday, setReplacementsUsedToday] = useState(0);
  const [universe, setUniverse] = useState<UniverseTicker[]>([]);
  const [tickerInput, setTickerInput] = useState("");
  const [replaceSymbol, setReplaceSymbol] = useState("");
  const [allSurfaces, setAllSurfaces] = useState<OptionSurfaceSnapshot[]>([]);
  const [rows, setRows] = useState<WatchlistRow[]>([]);
  const [filter, setFilter] = useState<TriageStatus | "all">("all");
  const [status, setStatus] = useState("Loading central watchlist...");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);

  async function loadUniverse(query = "") {
    try {
      const response = await fetch(`/api/ticker-universe?limit=80${query ? `&q=${encodeURIComponent(query)}` : ""}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (response.ok && Array.isArray(payload?.tickers)) setUniverse(payload.tickers);
    } catch {
      // Universe search is helpful, but it should not break the page.
    }
  }

  async function loadSavedWatchlist(): Promise<SavedTicker[]> {
    const response = await fetch("/api/user-watchlist", {
      cache: "no-store",
      headers: await getWatchlistAuthHeaders(),
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error ?? "Could not load your central watchlist.");
    }

    const tickers = Array.isArray(payload.tickers) ? payload.tickers : [];
    setSavedTickers(tickers);
    setEntitlement(payload.entitlement ?? null);
    setReplacementsUsedToday(Number(payload.replacementsUsedToday ?? 0));
    return tickers;
  }

  async function addTicker(symbolOverride?: string, replaceOverride?: string) {
    const symbol = normalizeTicker(symbolOverride ?? tickerInput);
    const replacement = normalizeTicker(replaceOverride ?? replaceSymbol);
    if (!symbol) return;

    setSaving(true);
    setStatus(`Saving ${symbol} to your central watchlist...`);

    try {
      const response = await fetch("/api/user-watchlist", {
        method: "POST",
        headers: await getWatchlistAuthHeaders(true),
        body: JSON.stringify({ symbol, replaceSymbol: replacement || undefined }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? `Could not add ${symbol}.`);
      }

      setTickerInput("");
      setReplaceSymbol("");
      const tickers = await loadSavedWatchlist();
      await loadWatchlist(tickers);
    } catch (error: any) {
      setStatus(error?.message ?? `Could not add ${symbol}.`);
    } finally {
      setSaving(false);
    }
  }

  async function removeTicker(symbol: string) {
    const normalized = normalizeTicker(symbol);
    if (!normalized) return;

    setSaving(true);
    setStatus(`Removing ${normalized} from your central watchlist...`);

    try {
      const response = await fetch(`/api/user-watchlist?symbol=${encodeURIComponent(normalized)}`, {
        method: "DELETE",
        headers: await getWatchlistAuthHeaders(),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? `Could not remove ${normalized}.`);
      }

      const tickers = await loadSavedWatchlist();
      await loadWatchlist(tickers);
    } catch (error: any) {
      setStatus(error?.message ?? `Could not remove ${normalized}.`);
    } finally {
      setSaving(false);
    }
  }

  async function seedFounderDefaults() {
    setSaving(true);
    setStatus("Seeding founder defaults into your central watchlist...");

    try {
      for (const symbol of FOUNDER_SEED) {
        await fetch("/api/user-watchlist", {
          method: "POST",
          headers: await getWatchlistAuthHeaders(true),
          body: JSON.stringify({ symbol }),
        });
      }
      const tickers = await loadSavedWatchlist();
      await loadWatchlist(tickers);
    } finally {
      setSaving(false);
    }
  }

  async function loadWatchlist(tickersOverride?: SavedTicker[]) {
    setLoading(true);
    setStatus("Loading shared OI surfaces, forecasts, and candles...");

    try {
      const saved = tickersOverride ?? savedTickers;
      const symbols = saved.map((row) => normalizeTicker(row.symbol)).filter(Boolean);

      if (!symbols.length) {
        setRows([]);
        setAllSurfaces([]);
        setLastLoadedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
        setStatus("No central watchlist tickers yet. Add tickers from the WheelDesk universe.");
        return;
      }

      const listSnapshots = await fetchSupabaseSurfaceList();
      const perTicker = await Promise.all(symbols.map((ticker) => fetchSupabaseSurfacesForTicker(ticker)));
      const snapshots = [...listSnapshots, ...perTicker.flat()];

      const deduped = Array.from(
        new Map(
          snapshots.map((surface) => [
            `${normalizeTicker((surface as any).ticker)}_${dateOnly((surface as any).snapshotDate)}_${String((surface as any).surfaceKey ?? "")}`,
            surface,
          ]),
        ).values(),
      );

      const latest = latestSurfaceByTicker(deduped);
      const candlePairs = await Promise.all(symbols.map(async (ticker) => [ticker, await fetchCandles(ticker)] as const));
      const forecastPairs = await Promise.all(symbols.map(async (ticker) => [ticker, await fetchForecastForTicker(ticker)] as const));
      const candleMap = Object.fromEntries(candlePairs);
      const forecastMap = Object.fromEntries(forecastPairs);

      const nextRows: WatchlistRow[] = saved.map((savedTicker) => {
        const ticker = normalizeTicker(savedTicker.symbol);
        const surface = latest.find((item) => normalizeTicker((item as any).ticker) === ticker) ?? null;
        const priorSurface = surface ? findPriorSurfaceForTicker(deduped, ticker, (surface as any).snapshotDate) : null;
        const forecast = forecastMap[ticker] ?? null;
        const candles = candleMap[ticker] ?? [];
        let summary: TraderEdgeSummary | null = null;
        let migration: WallMigrationSummary | null = null;
        let oiRows = 0;
        let oiAnomalies = 0;
        let flowBias = "N/A";
        let flowConfidence = 0;
        const dataNotes: string[] = [];

        if (surface) {
          try {
            summary = buildTraderEdgeSummary({ ticker, surface, candles });
          } catch (error) {
            dataNotes.push(error instanceof Error ? error.message : "Trader Edge calculation failed.");
          }

          try {
            migration = buildWallMigrationSummary({ currentSurface: surface, priorSurface });
          } catch (error) {
            dataNotes.push(error instanceof Error ? error.message : "Wall migration calculation failed.");
          }

          try {
            const currentPrice = Number((surface as any)?.price?.close ?? (surface as any)?.spot ?? 0);
            const oi = buildOIIntelligenceView({ surface, currentPrice });
            oiRows = oi?.rows?.length ?? 0;
            oiAnomalies = oi?.report?.anomalies?.length ?? 0;
          } catch (error) {
            dataNotes.push(error instanceof Error ? error.message : "OI intelligence calculation failed.");
          }

          try {
            const currentPrice = Number((surface as any)?.price?.close ?? (surface as any)?.spot ?? 0);
            const flow = buildFlowIntelligenceView({ surface, currentPrice });
            flowBias = String((flow as any)?.bias ?? "N/A").toUpperCase();
            flowConfidence = Number((flow as any)?.confidence ?? 0);
          } catch (error) {
            dataNotes.push(error instanceof Error ? error.message : "Flow intelligence calculation failed.");
          }
        } else {
          dataNotes.push("No saved Supabase OI surface found for this ticker.");
        }

        if (forecast) {
          dataNotes.push(`Latest OI Field forecast: ${dateOnly(forecast.snapshot_date ?? forecast.generated_at)}.`);
        } else {
          dataNotes.push("No OI Field forecast receipt stored yet.");
        }

        if (summary?.dataQualityNotes?.length) dataNotes.push(...summary.dataQualityNotes.slice(0, 2));
        if ((migration as any)?.dataQualityNotes?.length) dataNotes.push(...(migration as any).dataQualityNotes.slice(0, 2));

        const statusInfo = rowStatus({ surface, summary, oiAnomalies, forecast });

        return {
          ticker,
          savedTicker,
          surface,
          forecast,
          summary,
          migration,
          oiRows,
          oiAnomalies,
          flowBias,
          flowConfidence,
          changeText: buildChangeText(migration),
          dataNotes: Array.from(new Set(dataNotes)).slice(0, 5),
          ...statusInfo,
        };
      });

      const sortedRows = nextRows.sort((a, b) => {
        const slotA = Number(a.savedTicker.slot_index ?? 999);
        const slotB = Number(b.savedTicker.slot_index ?? 999);
        return b.priority - a.priority || (b.summary?.edgeScore ?? 0) - (a.summary?.edgeScore ?? 0) || slotA - slotB;
      });

      setAllSurfaces(deduped);
      setRows(sortedRows);
      setLastLoadedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      setStatus(
        deduped.length
          ? `Loaded ${deduped.length} shared surface(s), ${forecastPairs.filter(([, forecast]) => forecast).length} forecast receipt(s), and ${symbols.length} central ticker slot(s).`
          : `Loaded ${symbols.length} central ticker slot(s), but no Supabase OI surfaces returned yet.`,
      );
    } catch (error: any) {
      setStatus(error?.message ?? "Failed to load central watchlist data.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function boot() {
      await loadUniverse();
      try {
        const tickers = await loadSavedWatchlist();
        await loadWatchlist(tickers);
      } catch (error: any) {
        setStatus(error?.message ?? "Could not initialize Watchlist Command.");
      }
    }

    boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleRows = useMemo(() => rows.filter((row) => filter === "all" || row.status === filter), [rows, filter]);

  const counts = useMemo(() => {
    return {
      all: rows.length,
      action: rows.filter((row) => row.status === "action").length,
      watch: rows.filter((row) => row.status === "watch").length,
      avoid: rows.filter((row) => row.status === "avoid").length,
      stale: rows.filter((row) => row.status === "stale").length,
      missing: rows.filter((row) => row.status === "missing").length,
      review: rows.filter((row) => row.status === "review").length,
    };
  }, [rows]);

  const best = visibleRows[0] ?? rows[0] ?? null;
  const dailyRead = buildDailyRead(counts, best);
  const topThree = rows.filter((row) => row.surface || row.forecast).slice(0, 3);
  const usedSlots = savedTickers.length;
  const maxSlots = entitlement?.maxTickers ?? 0;
  const replacementsLeft = Math.max(0, (entitlement?.maxReplacementsPerDay ?? 0) - replacementsUsedToday);
  const atLimit = Boolean(maxSlots && usedSlots >= maxSlots);

  return (
    <AuthGate>
      <main
        className="wheeldesk-shell"
        style={{
          display: "flex",
          minHeight: "100vh",
          background:
            "radial-gradient(circle at top left, rgba(34, 211, 238, 0.13), transparent 28%), radial-gradient(circle at top right, rgba(192, 132, 252, 0.08), transparent 24%), #020b14",
        }}
      >
        <WheelDeskSideNav active="watchlist" />

        <div className="wheeldesk-page" style={styles.page}>
          <header style={styles.header}>
            <div style={styles.headerCopy}>
              <div style={styles.eyebrow}>Central Ticker Universe</div>
              <h1 style={styles.title}>Watchlist Command</h1>
              <p style={styles.subtitle}>
                Your saved ticker slots now come from the central WheelDesk universe. Surfaces, OI Field forecasts, and future validation receipts are shared once per ticker instead of pulled separately per user.
              </p>
            </div>

            <div style={styles.actions}>
              <a href="/dashboard" style={styles.topLink}>Dashboard Harvest</a>
              <a href="/control-center" style={styles.topLink}>Control Center</a>
              <button type="button" onClick={() => loadWatchlist()} style={styles.topButton} disabled={loading || saving}>
                {loading ? "Loading..." : "Reload"}
              </button>
            </div>
          </header>

          <section style={styles.morningPanel}>
            <div>
              <div style={styles.eyebrow}>Morning Read</div>
              <h2 style={styles.morningTitle}>{dailyRead}</h2>
              <p style={styles.morningText}>
                This is the first step toward the neural forecast dataset: fixed ticker universe, shared OI forecasts, and consistent receipts by symbol/date/horizon.
              </p>
            </div>
            <div style={styles.morningMeta}>
              <span>{lastLoadedAt ? `Last refresh ${lastLoadedAt}` : "Loading initial read"}</span>
              <strong>{usedSlots}/{maxSlots || "?"}</strong>
              <small>{entitlement?.plan ?? "founder"} ticker slots</small>
            </div>
          </section>

          <section style={styles.panel}>
            <div style={styles.watchlistGrid}>
              <label style={styles.label}>
                Add ticker from WheelDesk universe
                <input
                  value={tickerInput}
                  onChange={(event) => {
                    const value = event.target.value.toUpperCase();
                    setTickerInput(value);
                    loadUniverse(value);
                  }}
                  list="wheeldesk-universe-symbols"
                  placeholder="AMD, SOFI, NVDA..."
                  style={styles.input}
                />
                <datalist id="wheeldesk-universe-symbols">
                  {universe.map((ticker) => (
                    <option key={ticker.symbol} value={ticker.symbol}>
                      {ticker.name ?? ticker.symbol}
                    </option>
                  ))}
                </datalist>
              </label>

              <label style={styles.label}>
                Replace existing ticker if at limit
                <select value={replaceSymbol} onChange={(event) => setReplaceSymbol(event.target.value)} style={styles.input}>
                  <option value="">Do not replace</option>
                  {savedTickers.map((ticker) => (
                    <option key={ticker.symbol} value={ticker.symbol}>{ticker.symbol}</option>
                  ))}
                </select>
              </label>

              <button type="button" onClick={() => addTicker()} style={styles.primaryButton} disabled={loading || saving || !tickerInput.trim()}>
                {saving ? "Saving..." : atLimit && !replaceSymbol ? "Limit Reached" : "Add Ticker"}
              </button>

              <button type="button" onClick={seedFounderDefaults} style={styles.secondaryButton} disabled={loading || saving || usedSlots > 0}>
                Seed Founder Defaults
              </button>

              <div style={styles.statusText}>
                {status}
                <br />
                Replacements left today: <strong>{replacementsLeft}</strong>
              </div>
            </div>

            {savedTickers.length ? (
              <div style={styles.slotStrip}>
                {savedTickers.map((ticker) => (
                  <span key={ticker.symbol} style={styles.slotPill}>
                    <strong>{ticker.symbol}</strong>
                    <button type="button" onClick={() => removeTicker(ticker.symbol)} style={styles.removeButton} disabled={saving}>×</button>
                  </span>
                ))}
              </div>
            ) : null}
          </section>

          <section style={styles.statsGrid}>
            <StatCard label="Slots" value={`${usedSlots}/${maxSlots || "?"}`} help="central ticker limit" />
            <StatCard label="Action" value={counts.action} help="clean candidates" tone={colors.green} />
            <StatCard label="Watch" value={counts.watch} help="needs confirmation" tone={colors.amber} />
            <StatCard label="Avoid" value={counts.avoid} help="trap risk" tone={colors.red} />
            <StatCard label="Surfaces" value={allSurfaces.length} help="shared OI snapshots" tone={colors.teal} />
            <StatCard label="Forecasts" value={rows.filter((row) => row.forecast).length} help="OI Field receipts" tone={colors.purple} />
          </section>

          {best ? (
            <section style={styles.commandPanel}>
              <div>
                <div style={styles.eyebrow}>Top Priority</div>
                <h2 style={{ margin: "0.25rem 0", color: colors.white }}>{best.ticker} · {best.statusLabel}</h2>
                <p style={{ color: colors.muted, margin: 0, lineHeight: 1.45 }}>{best.reason}</p>
                <p style={{ color: colors.dim, margin: "0.6rem 0 0", lineHeight: 1.4 }}>{best.changeText}</p>
              </div>
              <div style={styles.priorityMetrics}>
                <StatCard label="Edge" value={fmt(best.summary?.edgeScore)} help={best.summary?.actionBucket ?? "N/A"} tone={colors.teal} />
                <StatCard label="Wheel" value={fmt(best.summary?.wheelScore)} help="wheel fit" tone={colors.green} />
                <StatCard label="Trap" value={fmt(best.summary?.trapRisk)} help="lower is better" tone={best.summary && best.summary.trapRisk >= 70 ? colors.red : colors.green} />
                <StatCard label="30D Base" value={money(best.forecast?.base_30d)} help="latest OI Field" tone={colors.purple} />
                <a href={`/control-center?ticker=${encodeURIComponent(best.ticker)}`} style={styles.primaryLink}>Open Control Center</a>
              </div>
            </section>
          ) : null}

          <section style={styles.topGrid}>
            {(topThree.length ? topThree : rows.slice(0, 3)).map((row) => (
              <article key={row.ticker} style={styles.spotlightCard}>
                <div style={styles.spotlightTop}>
                  <strong>{row.ticker}</strong>
                  <ActionBadge row={row} />
                </div>
                <div style={styles.spotlightScore}>
                  <span style={{ color: metricTone(row.summary?.edgeScore) }}>{fmt(row.summary?.edgeScore)}</span>
                  <small>edge</small>
                </div>
                <h3 style={styles.spotlightTitle}>{row.summary?.actionBucket ?? row.statusLabel}</h3>
                <p style={styles.spotlightText}>{row.forecast ? `30D field: ${money(row.forecast.lower_30d)} – ${money(row.forecast.upper_30d)} · base ${money(row.forecast.base_30d)}` : row.changeText}</p>
                <a href={`/control-center?ticker=${encodeURIComponent(row.ticker)}`} style={styles.inlineLink}>Deep dive →</a>
              </article>
            ))}
          </section>

          <section style={styles.filterPanel}>
            {([
              ["all", "All", counts.all],
              ["action", "Action", counts.action],
              ["watch", "Watch", counts.watch],
              ["avoid", "Avoid", counts.avoid],
              ["review", "Review", counts.review],
              ["stale", "Stale", counts.stale],
              ["missing", "Missing", counts.missing],
            ] as const).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                style={{ ...styles.filterButton, ...(filter === key ? styles.filterButtonActive : {}) }}
              >
                {label} ({count})
              </button>
            ))}
          </section>

          <section style={styles.tablePanel}>
            <div style={styles.tableHeader}>
              <div>
                <h3 style={{ margin: 0, color: colors.white }}>Central Ticker Triage</h3>
                <p style={{ margin: "0.35rem 0 0", color: colors.muted, fontSize: 13 }}>
                  Ranked by action priority, Trader Edge, OI Field forecast coverage, trap risk, freshness, wall migration, and flow pressure.
                </p>
              </div>
            </div>

            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {[
                      "Ticker", "Status", "Best Action", "Edge", "Wheel", "Trap", "Support", "Magnet", "Resistance", "30D Base", "30D Field", "Flow", "OI", "Changed", "Fresh", "Data", "Open",
                    ].map((header) => (
                      <th key={header} style={styles.th}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.length ? (
                    visibleRows.map((row) => {
                      const summary = row.summary;
                      return (
                        <tr key={row.ticker} style={styles.tr}>
                          <td style={styles.tdTicker}>{row.ticker}</td>
                          <td style={styles.td}><ActionBadge row={row} /></td>
                          <td style={{ ...styles.td, minWidth: 280, whiteSpace: "normal" }}>
                            <strong style={{ color: colors.white }}>{summary?.actionBucket ?? row.statusLabel}</strong>
                            <div style={{ color: colors.muted, marginTop: 3 }}>{row.reason}</div>
                          </td>
                          <td style={styles.td}><Score value={summary?.edgeScore} /></td>
                          <td style={styles.td}><Score value={summary?.wheelScore} /></td>
                          <td style={styles.td}><Score value={summary?.trapRisk} invert /></td>
                          <td style={styles.td}>{money(summary?.support)}<br /><small>{pct(summary?.supportCushionPct)}</small></td>
                          <td style={styles.td}>{money(summary?.magnet)}</td>
                          <td style={styles.td}>{money(summary?.resistance)}<br /><small>{pct(summary?.resistanceCushionPct)}</small></td>
                          <td style={styles.td}>{money(row.forecast?.base_30d)}<br /><small>{row.forecast?.bias ?? "no bias"}</small></td>
                          <td style={styles.td}>{money(row.forecast?.lower_30d)} – {money(row.forecast?.upper_30d)}<br /><small>conf {fmt(num(row.forecast?.confidence), 0)}</small></td>
                          <td style={styles.td}>
                            <strong style={{ color: row.flowBias === "BULLISH" ? colors.green : row.flowBias === "BEARISH" ? colors.red : colors.amber }}>{row.flowBias}</strong>
                            <br />
                            <small>{fmt(row.flowConfidence)} / 100</small>
                          </td>
                          <td style={styles.td}>{row.oiRows.toLocaleString()} rows<br /><small>{row.oiAnomalies} anomalies</small></td>
                          <td style={{ ...styles.td, minWidth: 240, whiteSpace: "normal" }}>{row.changeText}</td>
                          <td style={styles.td}>{daysOld(row.surface?.snapshotDate) ?? "N/A"}d<br /><small>{row.surface?.snapshotDate ?? "no surface"}</small></td>
                          <td style={styles.td}><Score value={summary?.dataQualityScore} /></td>
                          <td style={styles.td}>
                            <a href={`/control-center?ticker=${encodeURIComponent(row.ticker)}`} style={styles.inlineLink}>Control</a>
                            <br />
                            <a href={`/dashboard/validation?ticker=${encodeURIComponent(row.ticker)}`} style={styles.inlineLink}>Validate</a>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td style={styles.td} colSpan={17}>No rows match the selected filter. Add tickers from the central universe or seed founder defaults.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section style={styles.bottomGrid}>
            <article style={styles.notePanel}>
              <div style={styles.eyebrow}>What changed?</div>
              <h3 style={styles.noteTitle}>Wall migration</h3>
              <div style={styles.noteList}>
                {rows.slice(0, 8).map((row) => (
                  <div key={row.ticker} style={styles.noteItem}>
                    <strong>{row.ticker}</strong>
                    <span>{row.changeText}</span>
                  </div>
                ))}
              </div>
            </article>

            <article style={styles.notePanel}>
              <div style={styles.eyebrow}>Forecast coverage</div>
              <h3 style={styles.noteTitle}>OI Field receipts</h3>
              <div style={styles.noteList}>
                {rows.slice(0, 8).map((row) => (
                  <div key={row.ticker} style={styles.noteItem}>
                    <strong>{row.ticker}</strong>
                    <span>{row.forecast ? `Base 30D ${money(row.forecast.base_30d)} · field ${money(row.forecast.lower_30d)}–${money(row.forecast.upper_30d)}` : "No stored OI Field forecast yet."}</span>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section style={styles.footerNote}>
            <strong>Architecture shift:</strong> Watchlist now reads from central user ticker slots. The expensive market data and OI Field forecasts should be stored once per ticker/snapshot, then shared across subscribers. This is the bridge to validation receipts and later neural forecast training.
          </section>
        </div>
      </main>
    </AuthGate>
  );
}

const styles: Record<string, any> = {
  page: { flex: 1, minWidth: 0, padding: "1.1rem 1.4rem 2rem", display: "grid", gap: "1rem", alignContent: "start" },
  header: { display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center", flexWrap: "wrap" },
  headerCopy: { maxWidth: 820 },
  eyebrow: { color: colors.teal, fontSize: 11, fontWeight: 950, letterSpacing: "0.14em", textTransform: "uppercase" },
  title: { margin: 0, color: colors.white, letterSpacing: "-0.05em", fontSize: "clamp(28px, 4vw, 46px)", lineHeight: 0.96 },
  subtitle: { margin: "0.55rem 0 0", color: colors.muted, fontSize: 14, lineHeight: 1.45 },
  actions: { display: "flex", gap: 8, flexWrap: "wrap" },
  topLink: { border: "1px solid #22d3ee55", borderRadius: 10, padding: "0.55rem 0.75rem", textDecoration: "none", color: "#67e8f9", background: "#071523", fontWeight: 900 },
  topButton: { border: `1px solid ${colors.border}`, borderRadius: 10, padding: "0.55rem 0.75rem", color: colors.text, background: "#071523", fontWeight: 900, cursor: "pointer" },
  morningPanel: { border: "1px solid rgba(34, 211, 238, 0.28)", borderRadius: 18, background: "linear-gradient(135deg, rgba(8, 47, 62, 0.72), rgba(7, 21, 35, 0.82))", padding: "1rem", display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(150px, 220px)", gap: "1rem", alignItems: "center" },
  morningTitle: { margin: "0.3rem 0 0", color: colors.white, fontSize: "clamp(20px, 3vw, 30px)", letterSpacing: "-0.04em", lineHeight: 1.08 },
  morningText: { margin: "0.65rem 0 0", color: "#b8cce0", lineHeight: 1.45 },
  morningMeta: { border: `1px solid ${colors.borderSoft}`, borderRadius: 16, background: "rgba(2, 11, 20, 0.58)", padding: "0.9rem", display: "grid", gap: 3, textAlign: "center", color: colors.muted },
  panel: { border: `1px solid ${colors.border}`, borderRadius: 14, background: colors.panel, padding: "0.9rem" },
  watchlistGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: "0.85rem", alignItems: "end" },
  label: { display: "grid", gap: 5, color: colors.muted, fontSize: 12, fontWeight: 900 },
  input: { width: "100%", minWidth: 0, border: `1px solid ${colors.border}`, borderRadius: 11, background: "#020b14", color: colors.text, padding: "0.62rem 0.72rem" },
  primaryButton: { border: "1px solid #22d3ee77", borderRadius: 11, background: "#06313f", color: "#67e8f9", padding: "0.64rem 0.9rem", fontWeight: 950, cursor: "pointer" },
  secondaryButton: { border: `1px solid ${colors.border}`, borderRadius: 11, background: "#071523", color: colors.text, padding: "0.64rem 0.9rem", fontWeight: 900, cursor: "pointer" },
  statusText: { color: colors.muted, fontSize: 12, lineHeight: 1.35 },
  slotStrip: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: "0.85rem" },
  slotPill: { display: "inline-flex", alignItems: "center", gap: 8, border: `1px solid ${colors.borderSoft}`, background: "rgba(2, 11, 20, 0.5)", color: colors.text, borderRadius: 999, padding: "0.35rem 0.45rem 0.35rem 0.65rem" },
  removeButton: { border: "1px solid rgba(251, 113, 133, 0.45)", background: "rgba(251, 113, 133, 0.1)", color: colors.red, borderRadius: 999, width: 22, height: 22, cursor: "pointer" },
  statsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "0.75rem" },
  statCard: { border: `1px solid ${colors.border}`, borderRadius: 14, background: colors.panel, padding: "0.75rem", minHeight: 80 },
  statLabel: { color: colors.muted, fontSize: 11, fontWeight: 900, textTransform: "uppercase" },
  statValue: { fontSize: 24, fontWeight: 950, marginTop: 5 },
  statHelp: { color: colors.muted, fontSize: 11, marginTop: 4 },
  commandPanel: { border: `1px solid ${colors.border}`, borderRadius: 16, background: colors.panel, padding: "1rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 330px), 1fr))", gap: "1rem", alignItems: "center" },
  priorityMetrics: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "0.75rem", alignItems: "stretch" },
  primaryLink: { border: "1px solid #22d3ee77", borderRadius: 14, background: "#06313f", color: "#67e8f9", textDecoration: "none", fontWeight: 950, display: "grid", placeItems: "center", padding: "0.75rem" },
  topGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 250px), 1fr))", gap: "0.85rem" },
  spotlightCard: { border: `1px solid ${colors.border}`, borderRadius: 16, background: colors.panel, padding: "0.9rem", minHeight: 190 },
  spotlightTop: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, color: colors.white, fontWeight: 950, fontSize: 18 },
  spotlightScore: { display: "flex", gap: 8, alignItems: "baseline", marginTop: 14 },
  spotlightTitle: { margin: "0.55rem 0 0.35rem", color: "#67e8f9", letterSpacing: "-0.03em" },
  spotlightText: { color: colors.muted, lineHeight: 1.42, margin: "0 0 0.7rem" },
  filterPanel: { border: `1px solid ${colors.border}`, borderRadius: 14, background: colors.panel, padding: "0.65rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" },
  filterButton: { border: `1px solid ${colors.border}`, borderRadius: 999, background: "#071523", color: colors.muted, padding: "0.38rem 0.7rem", cursor: "pointer", fontWeight: 900 },
  filterButtonActive: { border: "1px solid #22d3ee77", color: "#67e8f9", background: "#06313f" },
  tablePanel: { border: `1px solid ${colors.border}`, borderRadius: 14, background: colors.panel, overflow: "hidden" },
  tableHeader: { padding: "0.9rem", borderBottom: `1px solid ${colors.border}` },
  table: { width: "100%", minWidth: 1500, borderCollapse: "collapse", fontSize: 12 },
  th: { textAlign: "left", padding: 8, borderBottom: `1px solid ${colors.border}`, color: colors.muted, background: "#071523", whiteSpace: "nowrap" },
  tr: { borderBottom: `1px solid ${colors.border}` },
  td: { padding: 8, color: colors.text, verticalAlign: "top", whiteSpace: "nowrap" },
  tdTicker: { padding: 8, color: colors.white, fontSize: 14, fontWeight: 950 },
  inlineLink: { color: colors.teal, fontWeight: 900, textDecoration: "none" },
  bottomGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: "0.85rem" },
  notePanel: { border: `1px solid ${colors.border}`, borderRadius: 14, background: colors.panel, padding: "0.9rem", color: colors.muted, fontSize: 13, lineHeight: 1.45 },
  noteTitle: { margin: "0.35rem 0 0.75rem", color: colors.white, letterSpacing: "-0.03em" },
  noteList: { display: "grid", gap: 8 },
  noteItem: { display: "grid", gridTemplateColumns: "64px minmax(0, 1fr)", gap: 10, padding: "0.55rem", border: `1px solid ${colors.borderSoft}`, borderRadius: 12, background: "rgba(2, 11, 20, 0.45)" },
  footerNote: { border: `1px solid ${colors.border}`, borderRadius: 14, background: colors.panel2, padding: "0.85rem", color: colors.muted, fontSize: 13, lineHeight: 1.45 },
};
