"use client";

import { useEffect, useMemo, useState } from "react";
import { WheelDeskSideNav } from "../../../components/WheelDeskSideNav";
import type { CandleRecord, OptionSurfaceSnapshot } from "../../../lib/wheeldesk-storage";
import {
  buildTraderEdgeSummary,
  latestSurfaceByTicker,
  type TraderEdgeSummary,
} from "../../../lib/trader-edge-engine";
import {
  buildWallMigrationSummary,
  findPriorSurfaceForTicker,
  type WallMigrationSummary,
} from "../../../lib/oi-wall-migration-engine";
import { buildOIIntelligenceView } from "../../../lib/oi-intelligence-view";
import { buildFlowIntelligenceView } from "../../../lib/flow-intelligence-view";
import { getPriceSeries } from "../../../lib/data-provider";

const DEFAULT_WATCHLIST = ["SOFI", "AAPL", "AMD", "NVDA", "MSFT", "MU", "PLTR", "SPY", "QQQ"];

type TriageStatus = "action" | "watch" | "avoid" | "stale" | "missing" | "review";

type WatchlistRow = {
  ticker: string;
  surface: OptionSurfaceSnapshot | null;
  allSurfaces: OptionSurfaceSnapshot[];
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
};

const colors = {
  bg: "#020b14",
  panel: "rgba(7, 21, 35, 0.78)",
  panel2: "#071523",
  border: "#20384d",
  text: "#e5f6ff",
  muted: "#9fb4c7",
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
    .replace(/[^A-Z0-9.\-]/g, "");
}

function uniqueTickers(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeTicker).filter(Boolean))).slice(0, 50);
}

function parseTickerList(value: string): string[] {
  return uniqueTickers(value.split(/[\s,;|]+/));
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
  const candidates = [
    payload?.snapshots,
    payload?.surfaces,
    payload?.data,
    payload?.items,
    payload?.surfaceSnapshots,
  ];

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
    "/api/supabase/surface-snapshot?mode=list",
    "/api/supabase/surface-snapshot",
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      const payload = await response.json().catch(() => null);

      if (!response.ok) continue;

      const snapshots = extractSnapshots(payload);
      if (snapshots.length) return snapshots;
    } catch {
      // Try next shape.
    }
  }

  return [];
}

async function fetchSupabaseSurfacesForTicker(ticker: string): Promise<OptionSurfaceSnapshot[]> {
  const response = await fetch(`/api/supabase/surface-snapshot?ticker=${encodeURIComponent(ticker)}`, {
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error ?? `Supabase surface request failed: ${response.status}`);
  }

  return extractSnapshots(payload);
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

function fmt(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return value.toFixed(digits);
}

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function pct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${value.toFixed(1)}%`;
}

function daysOld(snapshotDate?: string): number | null {
  if (!snapshotDate) return null;
  const today = new Date();
  const snap = new Date(`${snapshotDate}T00:00:00`);
  const diff = today.getTime() - snap.getTime();
  if (!Number.isFinite(diff)) return null;
  return Math.max(0, Math.floor(diff / 86_400_000));
}

function rowStatus(args: {
  surface: OptionSurfaceSnapshot | null;
  summary: TraderEdgeSummary | null;
  oiAnomalies: number;
}): Pick<WatchlistRow, "status" | "priority" | "statusLabel" | "reason"> {
  const { surface, summary, oiAnomalies } = args;

  if (!surface || !summary) {
    return {
      status: "missing",
      priority: 20,
      statusLabel: "Missing surface",
      reason: "No Supabase OI surface found. Run Dashboard Harvest.",
    };
  }

  const staleDays = daysOld(surface.snapshotDate);
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

function Score({ value, invert = false }: { value: number | null | undefined; invert?: boolean }) {
  const n = Number(value);
  const color = !Number.isFinite(n)
    ? colors.muted
    : invert
      ? n >= 75
        ? colors.red
        : n >= 55
          ? colors.amber
          : colors.green
      : n >= 70
        ? colors.green
        : n >= 55
          ? colors.amber
          : colors.red;

  return <strong style={{ color }}>{Number.isFinite(n) ? n.toFixed(0) : "N/A"}</strong>;
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
    <span
      style={{
        border: `1px solid ${tone.border}`,
        background: tone.bg,
        color: tone.color,
        borderRadius: 999,
        padding: "0.22rem 0.5rem",
        fontWeight: 900,
        whiteSpace: "nowrap",
      }}
    >
      {row.statusLabel}
    </span>
  );
}

export default function WatchlistCommandPage() {
  const [mounted, setMounted] = useState(false);
  const [tickerInput, setTickerInput] = useState(DEFAULT_WATCHLIST.join(", "));
  const [allSurfaces, setAllSurfaces] = useState<OptionSurfaceSnapshot[]>([]);
  const [candlesByTicker, setCandlesByTicker] = useState<Record<string, CandleRecord[]>>({});
  const [rows, setRows] = useState<WatchlistRow[]>([]);
  const [filter, setFilter] = useState<TriageStatus | "all">("all");
  const [status, setStatus] = useState("Loading Supabase surfaces...");
  const [loading, setLoading] = useState(false);

  const requestedTickers = useMemo(() => parseTickerList(tickerInput), [tickerInput]);

  async function loadWatchlist() {
    setLoading(true);
    setStatus("Loading Supabase surfaces...");

    try {
      const listSnapshots = await fetchSupabaseSurfaceList();
      let snapshots = listSnapshots;

      const tickers =
        requestedTickers.length > 0
          ? requestedTickers
          : uniqueTickers(listSnapshots.map((surface) => String(surface.ticker ?? "")));

      if (tickers.length > 0) {
        const perTicker = await Promise.all(
          tickers.map(async (ticker) => {
            try {
              return await fetchSupabaseSurfacesForTicker(ticker);
            } catch {
              return [];
            }
          })
        );

        snapshots = [...listSnapshots, ...perTicker.flat()];
      }

      const deduped = Array.from(
        new Map(snapshots.map((surface) => [`${surface.ticker}_${surface.snapshotDate}`, surface])).values()
      );

      const latest = latestSurfaceByTicker(deduped);
      const latestTickers = uniqueTickers([
        ...tickers,
        ...latest.map((surface) => String(surface.ticker ?? "")),
      ]);

      const candlePairs = await Promise.all(
        latestTickers.map(async (ticker) => [ticker, await fetchCandles(ticker)] as const)
      );

      const candleMap = Object.fromEntries(candlePairs);
      const nextRows: WatchlistRow[] = latestTickers.map((ticker) => {
        const surface = latest.find((item) => String(item.ticker ?? "").toUpperCase() === ticker) ?? null;
        const priorSurface = surface ? findPriorSurfaceForTicker(deduped, ticker, surface.snapshotDate) : null;
        const candles = candleMap[ticker] ?? [];
        const summary = surface ? buildTraderEdgeSummary({ ticker, surface, candles }) : null;
        const migration = surface ? buildWallMigrationSummary({ currentSurface: surface, priorSurface }) : null;
        const oi = surface ? buildOIIntelligenceView({ surface, currentPrice: Number((surface as any)?.price?.close ?? (surface as any)?.spot ?? 0) }) : null;
        const flow = surface ? buildFlowIntelligenceView({ surface, currentPrice: Number((surface as any)?.price?.close ?? (surface as any)?.spot ?? 0) }) : null;
        const statusInfo = rowStatus({
          surface,
          summary,
          oiAnomalies: oi?.report?.anomalies?.length ?? 0,
        });

        return {
          ticker,
          surface,
          allSurfaces: deduped.filter((item) => String(item.ticker ?? "").toUpperCase() === ticker),
          summary,
          migration,
          oiRows: oi?.rows?.length ?? 0,
          oiAnomalies: oi?.report?.anomalies?.length ?? 0,
          flowBias: String(flow?.bias ?? "N/A").toUpperCase(),
          flowConfidence: Number(flow?.confidence ?? 0),
          ...statusInfo,
        };
      });

      setAllSurfaces(deduped);
      setCandlesByTicker(candleMap);
      setRows(nextRows.sort((a, b) => b.priority - a.priority || (b.summary?.edgeScore ?? 0) - (a.summary?.edgeScore ?? 0)));
      setStatus(`Loaded ${deduped.length} Supabase surface(s) across ${latestTickers.length} ticker(s).`);
    } catch (error: any) {
      setStatus(error?.message ?? "Failed to load Supabase watchlist data.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setMounted(true);
    loadWatchlist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleRows = useMemo(() => {
    return rows.filter((row) => filter === "all" || row.status === filter);
  }, [rows, filter]);

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

  const best = visibleRows[0] ?? null;

  return (
    <main
      style={{
        display: "flex",
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(34, 211, 238, 0.12), transparent 28%), #020b14",
      }}
    >
      <WheelDeskSideNav active="scanner" />

      <div style={styles.page}>
        <header style={styles.header}>
          <div>
            <div style={styles.eyebrow}>WheelDesk</div>
            <h1 style={styles.title}>Watchlist Command</h1>
            <p style={styles.subtitle}>
              Supabase-driven triage for your tracked names. This page answers what deserves attention before you open the Control Center.
            </p>
          </div>

          <div style={styles.actions}>
            <a href="/dashboard" style={styles.topLink}>Dashboard Harvest</a>
            <a href="/control-center" style={styles.topLink}>Control Center</a>
            <button type="button" onClick={loadWatchlist} style={styles.topButton} disabled={loading}>
              {loading ? "Loading..." : "Reload Supabase"}
            </button>
          </div>
        </header>

        <section style={styles.panel}>
          <div style={styles.watchlistGrid}>
            <label style={styles.label}>
              Watchlist tickers
              <input
                value={tickerInput}
                onChange={(event) => setTickerInput(event.target.value)}
                placeholder="SOFI, AAPL, AMD, NVDA"
                style={styles.input}
              />
            </label>

            <button type="button" onClick={loadWatchlist} style={styles.primaryButton} disabled={loading}>
              Run Watchlist Triage
            </button>

            <div style={styles.statusText}>{status}</div>
          </div>
        </section>

        <section style={styles.statsGrid}>
          <StatCard label="Tracked" value={counts.all} help="watchlist names" />
          <StatCard label="Action" value={counts.action} help="cleanest candidates" tone={colors.green} />
          <StatCard label="Watch" value={counts.watch} help="needs confirmation" tone={colors.amber} />
          <StatCard label="Avoid" value={counts.avoid} help="trap risk" tone={colors.red} />
          <StatCard label="Stale/Missing" value={counts.stale + counts.missing} help="refresh required" tone="#94a3b8" />
          <StatCard label="Supabase" value={allSurfaces.length} help="surface snapshots loaded" />
        </section>

        {best ? (
          <section style={styles.commandPanel}>
            <div>
              <div style={styles.eyebrow}>Top Priority</div>
              <h2 style={{ margin: "0.25rem 0", color: colors.text }}>{best.ticker} · {best.statusLabel}</h2>
              <p style={{ color: colors.muted, margin: 0 }}>{best.reason}</p>
            </div>
            <div style={styles.priorityMetrics}>
              <StatCard label="Edge" value={fmt(best.summary?.edgeScore)} help={best.summary?.actionBucket ?? "N/A"} tone={colors.teal} />
              <StatCard label="Trap" value={fmt(best.summary?.trapRisk)} help="lower is better" tone={best.summary && best.summary.trapRisk >= 70 ? colors.red : colors.green} />
              <StatCard label="Freshness" value={`${daysOld(best.surface?.snapshotDate) ?? "N/A"}d`} help={best.surface?.snapshotDate ?? "no surface"} tone={colors.amber} />
              <a href={`/control-center?ticker=${encodeURIComponent(best.ticker)}`} style={styles.primaryLink}>Open Control Center</a>
            </div>
          </section>
        ) : null}

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
              style={{
                ...styles.filterButton,
                ...(filter === key ? styles.filterButtonActive : {}),
              }}
            >
              {label} ({count})
            </button>
          ))}
        </section>

        <section style={styles.tablePanel}>
          <div style={styles.tableHeader}>
            <div>
              <h3 style={{ margin: 0, color: colors.text }}>Ticker Triage</h3>
              <p style={{ margin: "0.35rem 0 0", color: colors.muted, fontSize: 13 }}>
                Rows are ranked by action priority, Trader Edge, trap risk, freshness, OI anomalies, and flow pressure.
              </p>
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {[
                    "Ticker",
                    "Status",
                    "Best Action",
                    "Edge",
                    "Wheel",
                    "CSP",
                    "CC",
                    "Trap",
                    "Support",
                    "Magnet",
                    "Resistance",
                    "Flow",
                    "OI",
                    "Migration",
                    "Fresh",
                    "Data",
                    "Open",
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
                        <td style={{ ...styles.td, minWidth: 280 }}>
                          <strong style={{ color: colors.text }}>{summary?.actionBucket ?? "No surface"}</strong>
                          <div style={{ color: colors.muted, marginTop: 3 }}>{row.reason}</div>
                        </td>
                        <td style={styles.td}><Score value={summary?.edgeScore} /></td>
                        <td style={styles.td}><Score value={summary?.wheelScore} /></td>
                        <td style={styles.td}><Score value={summary?.cspScore} /></td>
                        <td style={styles.td}><Score value={summary?.coveredCallScore} /></td>
                        <td style={styles.td}><Score value={summary?.trapRisk} invert /></td>
                        <td style={styles.td}>{money(summary?.support)}<br /><small>{pct(summary?.supportCushionPct)}</small></td>
                        <td style={styles.td}>{money(summary?.magnet)}</td>
                        <td style={styles.td}>{money(summary?.resistance)}<br /><small>{pct(summary?.resistanceCushionPct)}</small></td>
                        <td style={styles.td}>
                          <strong style={{ color: row.flowBias === "BULLISH" ? colors.green : row.flowBias === "BEARISH" ? colors.red : colors.amber }}>
                            {row.flowBias}
                          </strong>
                          <br />
                          <small>{fmt(row.flowConfidence)} / 100</small>
                        </td>
                        <td style={styles.td}>
                          {row.oiRows.toLocaleString()} rows
                          <br />
                          <small>{row.oiAnomalies} anomalies</small>
                        </td>
                        <td style={styles.td}>
                          {row.migration?.label ?? "No prior"}
                          <br />
                          <small>{fmt(row.migration?.migrationScore)} score</small>
                        </td>
                        <td style={styles.td}>
                          {row.surface ? `${daysOld(row.surface.snapshotDate) ?? "N/A"}d` : "N/A"}
                          <br />
                          <small>{row.surface?.snapshotDate ?? "missing"}</small>
                        </td>
                        <td style={styles.td}><Score value={summary?.dataQualityScore} /></td>
                        <td style={styles.td}>
                          <a href={`/control-center?ticker=${encodeURIComponent(row.ticker)}`} style={styles.inlineLink}>Control</a>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td style={styles.td} colSpan={17}>
                      No rows match the selected filter. Add tickers, run Dashboard Harvest, or reload Supabase.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section style={styles.notePanel}>
          <strong>Page role:</strong> Watchlist Command is not a broad market scanner. It is a morning triage desk for your saved Supabase surfaces.
          Use Dashboard Harvest to create/update surfaces, Watchlist Command to prioritize names, and Control Center for the actual trade map.
        </section>
      </div>
    </main>
  );
}

const styles: Record<string, any> = {
  page: {
    flex: 1,
    minWidth: 0,
    padding: "1.1rem 1.4rem 2rem",
    display: "grid",
    gap: "1rem",
    alignContent: "start",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: "1rem",
    alignItems: "center",
    flexWrap: "wrap",
  },
  eyebrow: {
    color: colors.teal,
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
  },
  title: {
    margin: 0,
    color: colors.text,
    letterSpacing: "-0.04em",
    fontSize: 30,
  },
  subtitle: {
    margin: "0.35rem 0 0",
    color: colors.muted,
    fontSize: 13,
  },
  actions: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },
  topLink: {
    border: "1px solid #22d3ee55",
    borderRadius: 10,
    padding: "0.55rem 0.75rem",
    textDecoration: "none",
    color: "#67e8f9",
    background: "#071523",
    fontWeight: 900,
  },
  topButton: {
    border: `1px solid ${colors.border}`,
    borderRadius: 10,
    padding: "0.55rem 0.75rem",
    color: colors.text,
    background: "#071523",
    fontWeight: 900,
    cursor: "pointer",
  },
  panel: {
    border: `1px solid ${colors.border}`,
    borderRadius: 12,
    background: colors.panel,
    padding: "0.9rem",
  },
  watchlistGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
    gap: "0.85rem",
    alignItems: "end",
  },
  label: {
    display: "grid",
    gap: 4,
    color: colors.muted,
    fontSize: 12,
    fontWeight: 900,
  },
  input: {
    width: "100%",
    border: `1px solid ${colors.border}`,
    borderRadius: 10,
    background: "#020b14",
    color: colors.text,
    padding: "0.55rem 0.65rem",
  },
  primaryButton: {
    border: "1px solid #22d3ee77",
    borderRadius: 10,
    background: "#06313f",
    color: "#67e8f9",
    padding: "0.58rem 0.8rem",
    fontWeight: 950,
    cursor: "pointer",
  },
  statusText: {
    color: colors.muted,
    fontSize: 12,
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
    gap: "0.75rem",
  },
  statCard: {
    border: `1px solid ${colors.border}`,
    borderRadius: 12,
    background: colors.panel,
    padding: "0.75rem",
    minHeight: 80,
  },
  statLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
  },
  statValue: {
    fontSize: 24,
    fontWeight: 950,
    marginTop: 5,
  },
  statHelp: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 4,
  },
  commandPanel: {
    border: `1px solid ${colors.border}`,
    borderRadius: 12,
    background: colors.panel,
    padding: "1rem",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
    gap: "1rem",
    alignItems: "center",
  },
  priorityMetrics: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
    gap: "0.75rem",
    alignItems: "stretch",
  },
  primaryLink: {
    border: "1px solid #22d3ee77",
    borderRadius: 12,
    background: "#06313f",
    color: "#67e8f9",
    textDecoration: "none",
    fontWeight: 950,
    display: "grid",
    placeItems: "center",
    padding: "0.75rem",
  },
  filterPanel: {
    border: `1px solid ${colors.border}`,
    borderRadius: 12,
    background: colors.panel,
    padding: "0.65rem",
    display: "flex",
    gap: "0.5rem",
    flexWrap: "wrap",
  },
  filterButton: {
    border: `1px solid ${colors.border}`,
    borderRadius: 999,
    background: "#071523",
    color: colors.muted,
    padding: "0.35rem 0.65rem",
    cursor: "pointer",
    fontWeight: 900,
  },
  filterButtonActive: {
    border: "1px solid #22d3ee77",
    color: "#67e8f9",
    background: "#06313f",
  },
  tablePanel: {
    border: `1px solid ${colors.border}`,
    borderRadius: 12,
    background: colors.panel,
    overflow: "hidden",
  },
  tableHeader: {
    padding: "0.9rem",
    borderBottom: `1px solid ${colors.border}`,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 12,
  },
  th: {
    textAlign: "left",
    padding: 8,
    borderBottom: `1px solid ${colors.border}`,
    color: colors.muted,
    background: "#071523",
    whiteSpace: "nowrap",
  },
  tr: {
    borderBottom: `1px solid ${colors.border}`,
  },
  td: {
    padding: 8,
    color: colors.text,
    verticalAlign: "top",
    whiteSpace: "nowrap",
  },
  tdTicker: {
    padding: 8,
    color: colors.text,
    fontSize: 14,
    fontWeight: 950,
  },
  inlineLink: {
    color: colors.teal,
    fontWeight: 900,
  },
  notePanel: {
    border: `1px solid ${colors.border}`,
    borderRadius: 12,
    background: colors.panel,
    padding: "0.85rem",
    color: colors.muted,
    fontSize: 13,
    lineHeight: 1.45,
  },
};
