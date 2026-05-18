"use client";

import { useEffect, useMemo, useState } from "react";
import AuthGate from "../../components/auth/AuthGate";
import { WheelDeskSideNav } from "../../components/WheelDeskSideNav";
import { buildTraderEdgeSummary, type TraderEdgeSummary } from "../../lib/trader-edge-engine";
import { buildWallMigrationSummary, type WallMigrationSummary } from "../../lib/oi-wall-migration-engine";
import { SUPPORTED_TICKERS } from "../../lib/types";
import type { OptionSurfaceSnapshot } from "../../lib/wheeldesk-storage";

const WATCHLIST_KEY = "wheelDesk.watchlistIntelligence.tickers";
const DEFAULT_TICKERS = ["SOFI", "NVDA", "AMD", "AAPL", "SPY", "QQQ"];

type LoadState = "idle" | "loading" | "ready" | "error";

type WatchlistRow = {
  ticker: string;
  surface: OptionSurfaceSnapshot | null;
  priorSurface: OptionSurfaceSnapshot | null;
  edge: TraderEdgeSummary | null;
  migration: WallMigrationSummary | null;
  readiness: number;
  readinessLabel: string;
  setup: string;
  changed: string;
  nextAction: string;
  freshness: string;
  dataNotes: string[];
};

function normalizeTicker(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
}

function safeDate(value: unknown): string {
  return String(value ?? "").slice(0, 10);
}


function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatMove(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function uniqueTickers(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeTicker).filter(Boolean))).sort();
}

function readWatchlist(): string[] {
  if (typeof window === "undefined") return DEFAULT_TICKERS;

  try {
    const raw = window.localStorage.getItem(WATCHLIST_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      const tickers = uniqueTickers(parsed.map(String));
      if (tickers.length) return tickers;
    }
  } catch {
    // Keep the page resilient if localStorage has bad data.
  }

  return DEFAULT_TICKERS;
}

function writeWatchlist(tickers: string[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(uniqueTickers(tickers)));
}

function readinessLabel(score: number): string {
  if (score >= 78) return "Action watch";
  if (score >= 66) return "Worth reviewing";
  if (score >= 54) return "Monitor";
  if (score >= 42) return "Low conviction";
  return "Needs data";
}

function buildReadiness(edge: TraderEdgeSummary | null, migration: WallMigrationSummary | null): number {
  if (!edge) return 0;

  const migrationScore = migration?.migrationScore ?? 50;
  const score =
    edge.edgeScore * 0.34 +
    edge.wheelScore * 0.2 +
    edge.dataQualityScore * 0.16 +
    migrationScore * 0.16 +
    (100 - edge.trapRisk) * 0.14;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildChangedText(migration: WallMigrationSummary | null): string {
  if (!migration) return "No saved surface comparison yet.";
  if (!migration.hasPrior) return "First saved surface. Need another snapshot for yesterday comparison.";

  const support = migration.supportChange == null ? "support unchanged/unknown" : `support ${formatMove(migration.supportChange)}`;
  const resistance = migration.resistanceChange == null ? "resistance unchanged/unknown" : `resistance ${formatMove(migration.resistanceChange)}`;
  const magnet = migration.magnetChange == null ? "magnet unchanged/unknown" : `magnet ${formatMove(migration.magnetChange)}`;

  return `${migration.label}: ${support}, ${resistance}, ${magnet}.`;
}

function buildSetup(edge: TraderEdgeSummary | null, migration: WallMigrationSummary | null): string {
  if (!edge) return "No surface saved";
  if (edge.actionBucket === "Premium trap / avoid") return "Trap watch";
  if (edge.actionBucket === "Best CSP setup") return "CSP candidate";
  if (edge.actionBucket === "Best covered-call setup") return "CC candidate";
  if (edge.actionBucket === "Compression coil") return "Compression coil";
  if (edge.actionBucket === "Wheel candidate") return "Wheel candidate";
  if (migration?.migrationBias === "bullish") return "Bullish migration";
  if (migration?.migrationBias === "bearish") return "Defensive migration";
  return edge.actionBucket;
}

function groupSurfacesByTicker(surfaces: OptionSurfaceSnapshot[]): Map<string, OptionSurfaceSnapshot[]> {
  const grouped = new Map<string, OptionSurfaceSnapshot[]>();

  for (const surface of surfaces) {
    const ticker = normalizeTicker(String(surface?.ticker ?? ""));
    if (!ticker) continue;
    const list = grouped.get(ticker) ?? [];
    list.push(surface);
    grouped.set(ticker, list);
  }

  for (const [ticker, list] of grouped.entries()) {
    grouped.set(
      ticker,
      list.sort((a, b) => safeDate(b.snapshotDate).localeCompare(safeDate(a.snapshotDate)))
    );
  }

  return grouped;
}

function buildWatchlistRows(tickers: string[], surfaces: OptionSurfaceSnapshot[]): WatchlistRow[] {
  const grouped = groupSurfacesByTicker(surfaces);

  return tickers.map((ticker) => {
    const surfaceList = grouped.get(ticker) ?? [];
    const surface = surfaceList[0] ?? null;
    const priorSurface = surfaceList.find((item) => safeDate(item.snapshotDate) < safeDate(surface?.snapshotDate)) ?? null;

    let edge: TraderEdgeSummary | null = null;
    let migration: WallMigrationSummary | null = null;
    const notes: string[] = [];

    if (surface) {
      try {
        edge = buildTraderEdgeSummary({ ticker, surface });
      } catch (error) {
        notes.push(error instanceof Error ? error.message : "Trader edge calculation failed.");
      }

      try {
        migration = buildWallMigrationSummary({ currentSurface: surface, priorSurface });
      } catch (error) {
        notes.push(error instanceof Error ? error.message : "Wall migration calculation failed.");
      }
    } else {
      notes.push("No saved Supabase OI surface found. Load/save this ticker from Scanner or Control Center.");
    }

    if (edge?.dataQualityNotes?.length) notes.push(...edge.dataQualityNotes.slice(0, 2));
    if (migration?.dataQualityNotes?.length) notes.push(...migration.dataQualityNotes.slice(0, 2));

    const readiness = buildReadiness(edge, migration);

    return {
      ticker,
      surface,
      priorSurface,
      edge,
      migration,
      readiness,
      readinessLabel: readinessLabel(readiness),
      setup: buildSetup(edge, migration),
      changed: buildChangedText(migration),
      nextAction: edge?.bestAction ?? "Capture a surface snapshot before using this ticker in the daily loop.",
      freshness: edge?.freshnessLabel ?? "No data",
      dataNotes: Array.from(new Set(notes)).slice(0, 4),
    };
  });
}

function scoreTone(score: number): string {
  if (score >= 78) return "wd-watch-score hot";
  if (score >= 66) return "wd-watch-score warm";
  if (score >= 54) return "wd-watch-score neutral";
  return "wd-watch-score cold";
}

export default function WatchlistPage() {
  const [tickers, setTickers] = useState<string[]>(DEFAULT_TICKERS);
  const [tickerInput, setTickerInput] = useState("");
  const [surfaces, setSurfaces] = useState<OptionSurfaceSnapshot[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState("");
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);

  useEffect(() => {
    setTickers(readWatchlist());
  }, []);

  const loadSurfaces = async () => {
    setLoadState("loading");
    setError("");

    try {
      const response = await fetch("/api/supabase/surface-snapshot?mode=list&limit=500", {
        cache: "no-store",
      });
      const payload = await response.json();

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "Unable to load saved Supabase surfaces.");
      }

      const nextSurfaces = Array.isArray(payload.snapshots) ? payload.snapshots : [];
      setSurfaces(nextSurfaces);
      setLoadState("ready");
      setLastLoadedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    } catch (loadError) {
      setLoadState("error");
      setError(loadError instanceof Error ? loadError.message : "Unknown watchlist load error.");
    }
  };

  useEffect(() => {
    loadSurfaces();
  }, []);

  const rows = useMemo(() => buildWatchlistRows(tickers, surfaces), [tickers, surfaces]);
  const rankedRows = useMemo(() => [...rows].sort((a, b) => b.readiness - a.readiness), [rows]);
  const topRows = rankedRows.filter((row) => row.surface).slice(0, 3);
  const availableTickers = useMemo(() => uniqueTickers(surfaces.map((surface) => String(surface.ticker ?? ""))), [surfaces]);
  const savedSurfaceCount = surfaces.length;

  const addTicker = (value = tickerInput) => {
    const nextTicker = normalizeTicker(value);
    if (!nextTicker) return;

    const next = uniqueTickers([...tickers, nextTicker]);
    setTickers(next);
    writeWatchlist(next);
    setTickerInput("");
  };

  const removeTicker = (ticker: string) => {
    const next = tickers.filter((item) => item !== ticker);
    setTickers(next);
    writeWatchlist(next);
  };

  const resetDefaults = () => {
    const next = uniqueTickers(DEFAULT_TICKERS);
    setTickers(next);
    writeWatchlist(next);
  };

  return (
    <AuthGate>
      <main className="wheeldesk-shell" style={{ display: "flex", minHeight: "100vh", background: "#020b14" }}>
        <WheelDeskSideNav active="scanner" />

        <section className="wheeldesk-page wd-watch-page">
          <header className="wd-watch-hero">
            <div>
              <div className="wd-watch-kicker">Daily Edge Loop</div>
              <h1>Watchlist Intelligence</h1>
              <p>
                Your morning control board: saved tickers, current OI structure, what changed since the prior snapshot,
                trade readiness, and the next action to review.
              </p>
            </div>

            <div className="wd-watch-hero-card">
              <span>Saved surfaces</span>
              <strong>{savedSurfaceCount}</strong>
              <small>{lastLoadedAt ? `Last refresh ${lastLoadedAt}` : loadState === "loading" ? "Loading…" : "Not loaded"}</small>
              <button type="button" onClick={loadSurfaces} disabled={loadState === "loading"}>
                {loadState === "loading" ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </header>

          {error && <div className="wd-watch-alert">{error}</div>}

          <section className="wd-watch-grid wd-watch-grid-top">
            <article className="wd-watch-panel wd-watch-wide">
              <div className="wd-watch-panel-head">
                <div>
                  <span className="wd-watch-kicker">Sticky loop</span>
                  <h2>What deserves attention today?</h2>
                </div>
                <span className="wd-watch-pill">Ranked by readiness</span>
              </div>

              <div className="wd-watch-brief-grid">
                {(topRows.length ? topRows : rankedRows.slice(0, 3)).map((row) => (
                  <div className="wd-watch-brief-card" key={row.ticker}>
                    <div className="wd-watch-brief-top">
                      <strong>{row.ticker}</strong>
                      <span className={scoreTone(row.readiness)}>{row.readiness}</span>
                    </div>
                    <h3>{row.setup}</h3>
                    <p>{row.changed}</p>
                    <small>{row.edge?.triggerNotes?.[0] ?? row.nextAction}</small>
                  </div>
                ))}
              </div>
            </article>

            <article className="wd-watch-panel">
              <span className="wd-watch-kicker">Manage list</span>
              <h2>Add tickers</h2>
              <div className="wd-watch-add-row">
                <input
                  value={tickerInput}
                  onChange={(event) => setTickerInput(event.target.value.toUpperCase())}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") addTicker();
                  }}
                  placeholder="NVDA"
                  aria-label="Add ticker"
                />
                <button type="button" onClick={() => addTicker()}>
                  Add
                </button>
              </div>
              <div className="wd-watch-suggestions">
                {[...SUPPORTED_TICKERS, ...availableTickers].slice(0, 18).map((ticker) => (
                  <button key={ticker} type="button" onClick={() => addTicker(String(ticker))}>
                    {String(ticker).toUpperCase()}
                  </button>
                ))}
              </div>
              <button className="wd-watch-reset" type="button" onClick={resetDefaults}>
                Reset default watchlist
              </button>
            </article>
          </section>

          <section className="wd-watch-panel wd-watch-table-panel">
            <div className="wd-watch-panel-head">
              <div>
                <span className="wd-watch-kicker">What changed since yesterday?</span>
                <h2>Watchlist control read</h2>
              </div>
              <span className="wd-watch-pill">{tickers.length} tickers</span>
            </div>

            <div className="wd-watch-table-wrap">
              <table className="wd-watch-table">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Readiness</th>
                    <th>Setup</th>
                    <th>Spot</th>
                    <th>Support</th>
                    <th>Resistance</th>
                    <th>Magnet</th>
                    <th>Change</th>
                    <th>Action</th>
                    <th>Data</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.ticker}>
                      <td>
                        <strong className="wd-watch-ticker">{row.ticker}</strong>
                        <small>{safeDate(row.surface?.snapshotDate) || "No snapshot"}</small>
                      </td>
                      <td>
                        <span className={scoreTone(row.readiness)}>{row.readiness}</span>
                        <small>{row.readinessLabel}</small>
                      </td>
                      <td>{row.setup}</td>
                      <td>{formatNumber(row.edge?.analysisPrice)}</td>
                      <td>
                        {formatNumber(row.edge?.support)}
                        <small>{formatMove(row.migration?.supportChange)}</small>
                      </td>
                      <td>
                        {formatNumber(row.edge?.resistance)}
                        <small>{formatMove(row.migration?.resistanceChange)}</small>
                      </td>
                      <td>
                        {formatNumber(row.edge?.magnet)}
                        <small>{formatMove(row.migration?.magnetChange)}</small>
                      </td>
                      <td>
                        <span>{row.changed}</span>
                        <small>{row.migration?.interpretation ?? "Need at least two saved surfaces."}</small>
                      </td>
                      <td>{row.nextAction}</td>
                      <td>
                        <span>{row.freshness}</span>
                        <small>DQ {row.edge?.dataQualityScore ?? 0}</small>
                      </td>
                      <td>
                        <button className="wd-watch-remove" type="button" onClick={() => removeTicker(row.ticker)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="wd-watch-grid">
            <article className="wd-watch-panel">
              <span className="wd-watch-kicker">Receipts needed</span>
              <h2>Data quality notes</h2>
              <div className="wd-watch-notes">
                {rows.flatMap((row) =>
                  row.dataNotes.length
                    ? row.dataNotes.map((note) => ({ ticker: row.ticker, note }))
                    : [{ ticker: row.ticker, note: "No major data-quality note." }]
                ).slice(0, 10).map((item, index) => (
                  <div className="wd-watch-note" key={`${item.ticker}-${index}`}>
                    <strong>{item.ticker}</strong>
                    <span>{item.note}</span>
                  </div>
                ))}
              </div>
            </article>

            <article className="wd-watch-panel">
              <span className="wd-watch-kicker">Why this is sticky</span>
              <h2>Daily return reason</h2>
              <p className="wd-watch-copy">
                This page should become the user&apos;s first stop every morning: what changed, where the pressure moved,
                which tickers deserve time, and which setups should be ignored until the evidence improves.
              </p>
              <div className="wd-watch-loop">
                <span>Open</span>
                <span>Compare</span>
                <span>Rank</span>
                <span>Act</span>
                <span>Validate</span>
              </div>
            </article>

            <article className="wd-watch-panel">
              <span className="wd-watch-kicker">Surface coverage</span>
              <h2>Stored tickers</h2>
              <div className="wd-watch-surface-cloud">
                {availableTickers.length ? availableTickers.map((ticker) => <span key={ticker}>{ticker}</span>) : <p>No Supabase surfaces loaded yet.</p>}
              </div>
            </article>
          </section>
        </section>
      </main>
    </AuthGate>
  );
}
