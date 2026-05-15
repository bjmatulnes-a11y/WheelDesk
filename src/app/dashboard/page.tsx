"use client";

import { useEffect, useMemo, useState } from "react";
import { getOptionChain, getPriceSeries } from "../../lib/data-provider";
import { buildOptionSurfaceSnapshot } from "../../lib/oi-surface-snapshot-builder";
import { listPortfolioProfiles } from "../../lib/portfolio-store";
import { type PortfolioProfile } from "../../lib/portfolio-types";
import { readPreferences } from "../../lib/wheeldesk-storage";
import { SUPPORTED_TICKERS, type SupportedTicker } from "../../lib/types";

const TODAY = new Date().toISOString().slice(0, 10);
const HARVEST_TICKERS_KEY = "wheelDesk.dashboardHarvestTickers";
const MAX_NORMAL_TICKERS = 10;

type HarvestStatus = "idle" | "pending" | "fetching" | "saving" | "saved" | "failed" | "skipped";

type HarvestItem = {
  ticker: string;
  status: HarvestStatus;
  message?: string;
  chainCount?: number;
  rowCount?: number;
  surfaceKey?: string;
  snapshotDate?: string;
  startedAt?: string;
  completedAt?: string;
  premium?: boolean;
};

type NewsItem = {
  ticker: string;
  title: string;
  source: string;
  url?: string;
  publishedAt?: string;
};

type CalendarItem = {
  date: string;
  label: string;
  impact: "low" | "medium" | "high";
};

function normalizeTickerInput(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function parseTickerList(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map(normalizeTickerInput)
    .filter(Boolean);
}

function uniqueTickers(tickers: string[]): string[] {
  return Array.from(new Set(tickers.map(normalizeTickerInput).filter(Boolean)));
}

function isPremiumTicker(ticker: string): boolean {
  const normalized = normalizeTickerInput(ticker);
  return normalized === "^SPX" || normalized === "SPX" || normalized === "SPXW";
}

function countRows(snapshot: any): number {
  return (snapshot?.chains ?? []).reduce((sum: number, chain: any) => sum + ((chain?.rows ?? []).length || 0), 0);
}

function safeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeInt(value: unknown, fallback = "N/A"): string {
  const n = safeNumber(value);
  return n === null ? fallback : Math.round(n).toLocaleString();
}

function safeMoney(value: unknown, fallback = "N/A"): string {
  const n = safeNumber(value);
  return n === null ? fallback : `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function safePct(value: unknown, fallback = "N/A"): string {
  const n = safeNumber(value);
  return n === null ? fallback : `${n.toFixed(2)}%`;
}

function statusColor(status: HarvestStatus): string {
  switch (status) {
    case "saved":
      return "#27ff79";
    case "failed":
      return "#ff4d4d";
    case "fetching":
    case "saving":
      return "#ffd166";
    case "pending":
      return "#7dd3fc";
    case "skipped":
      return "#9ca3af";
    default:
      return "#cbd5e1";
  }
}

function summarizePortfolio(profile?: PortfolioProfile) {
  const positions = ((profile as any)?.positions ?? []) as any[];

  let stockShares = 0;
  let shortCalls = 0;
  let shortPuts = 0;
  let longOptions = 0;
  let openPremiumProxy = 0;
  let plOpen = 0;
  let plDay = 0;
  let theta = 0;
  let delta = 0;
  let bpEffect = 0;

  for (const position of positions) {
    const qty = safeNumber(position?.qty) ?? safeNumber(position?.quantity) ?? 0;
    const side = String(position?.side ?? "").toLowerCase();
    const instrumentType = String(position?.instrumentType ?? position?.type ?? "").toLowerCase();
    const mark = safeNumber(position?.mark) ?? safeNumber(position?.markPrice) ?? safeNumber(position?.entryPrice) ?? 0;
    const entry = safeNumber(position?.entryPrice) ?? safeNumber(position?.tradePrice) ?? mark;
    const multiplier = instrumentType === "stock" ? 1 : 100;
    const signedQty = side === "short" ? -qty : qty;

    if (instrumentType === "stock" || instrumentType === "equity") stockShares += signedQty;
    if (instrumentType === "call" && side === "short") shortCalls += qty;
    if (instrumentType === "put" && side === "short") shortPuts += qty;
    if ((instrumentType === "call" || instrumentType === "put") && side === "long") longOptions += qty;

    const pl = (mark - entry) * signedQty * multiplier;
    if (Number.isFinite(pl)) plOpen += pl;

    const rowDay = safeNumber(position?.plDay ?? position?.dayPnl ?? position?.pnlDay);
    if (rowDay !== null) plDay += rowDay;

    const rowTheta = safeNumber(position?.theta);
    if (rowTheta !== null) theta += rowTheta * qty * (instrumentType === "stock" ? 1 : 100);

    const rowDelta = safeNumber(position?.delta);
    if (rowDelta !== null) delta += rowDelta * qty * (instrumentType === "stock" ? 1 : 100) * (side === "short" ? -1 : 1);

    const rowBp = safeNumber(position?.bpEffect ?? position?.buyingPowerEffect);
    if (rowBp !== null) bpEffect += rowBp;

    if ((instrumentType === "call" || instrumentType === "put") && side === "short") {
      openPremiumProxy += Number.isFinite(mark) ? mark * qty * 100 : 0;
    }
  }

  return {
    positionCount: positions.length,
    stockShares,
    shortCalls,
    shortPuts,
    longOptions,
    openPremiumProxy,
    plOpen,
    plDay,
    theta,
    delta,
    bpEffect,
  };
}

async function saveSurfaceToSupabase(surfaceSnapshot: any) {
  const response = await fetch("/api/supabase/surface-snapshot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(surfaceSnapshot),
  });

  const result = await response.json().catch(() => null);

  if (!response.ok || !result?.ok) {
    throw new Error(result?.error ?? `Supabase save failed: ${response.status}`);
  }

  return result;
}

async function fetchNewsForTickers(tickers: string[]): Promise<NewsItem[]> {
  // Placeholder integration point. Keep this function so the UI is wired for real news
  // without fake holder/placeholder cards. Next step: point this to a news API route.
  return tickers.slice(0, 6).map((ticker) => ({
    ticker,
    title: `News feed pending provider integration for ${ticker}`,
    source: "WheelDesk",
    publishedAt: TODAY,
  }));
}

function defaultCalendar(): CalendarItem[] {
  return [
    { date: TODAY, label: "Market calendar integration pending", impact: "medium" },
    { date: "Weekly", label: "OPEX / earnings / macro events will populate here", impact: "high" },
  ];
}

export default function DashboardPage() {
  const [mounted, setMounted] = useState(false);
  const [snapshotDate, setSnapshotDate] = useState(TODAY);
  const [tickerInput, setTickerInput] = useState("");
  const [tickers, setTickers] = useState<string[]>(["AAPL", "SOFI", "MU"]);
  const [queue, setQueue] = useState<HarvestItem[]>([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("READY");
  const [harvestOpen, setHarvestOpen] = useState(false);
  const [profiles, setProfiles] = useState<PortfolioProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [news, setNews] = useState<NewsItem[]>([]);
  const [calendarItems, setCalendarItems] = useState<CalendarItem[]>(defaultCalendar());

  useEffect(() => {
    setMounted(true);

    try {
      const savedTickers = JSON.parse(localStorage.getItem(HARVEST_TICKERS_KEY) || "[]");
      if (Array.isArray(savedTickers) && savedTickers.length) {
        setTickers(uniqueTickers(savedTickers).slice(0, MAX_NORMAL_TICKERS));
      }
    } catch {
      // UI state only. Ignore corrupt localStorage.
    }

    const loadedProfiles = listPortfolioProfiles();
    setProfiles(loadedProfiles);
    setSelectedProfileId(loadedProfiles[0]?.id ?? "");
  }, []);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(HARVEST_TICKERS_KEY, JSON.stringify(tickers));
  }, [mounted, tickers]);

  useEffect(() => {
    let cancelled = false;

    fetchNewsForTickers(tickers).then((items) => {
      if (!cancelled) setNews(items);
    });

    setCalendarItems(defaultCalendar());

    return () => {
      cancelled = true;
    };
  }, [tickers]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId),
    [profiles, selectedProfileId]
  );

  const portfolioSummary = useMemo(() => summarizePortfolio(selectedProfile), [selectedProfile]);
  const normalTickers = useMemo(() => tickers.filter((ticker) => !isPremiumTicker(ticker)), [tickers]);
  const premiumTickers = useMemo(() => tickers.filter(isPremiumTicker), [tickers]);
  const canAddMoreNormal = normalTickers.length < MAX_NORMAL_TICKERS;

  function addTickersFromInput() {
    const parsed = parseTickerList(tickerInput);
    if (!parsed.length) return;

    const next = uniqueTickers([...tickers, ...parsed]);
    const normal = next.filter((ticker) => !isPremiumTicker(ticker)).slice(0, MAX_NORMAL_TICKERS);
    const premium = next.filter(isPremiumTicker);

    setTickers(uniqueTickers([...normal, ...premium]));
    setTickerInput("");
  }

  function removeTicker(ticker: string) {
    setTickers((current) => current.filter((item) => item !== ticker));
  }

  function clearQueue() {
    if (running) return;
    setQueue([]);
    setStatus("QUEUE CLEARED");
  }

  function buildQueue(targetTickers: string[]) {
    const nextQueue = targetTickers.map((ticker) => ({
      ticker,
      status: "pending" as HarvestStatus,
      premium: isPremiumTicker(ticker),
      message: "Waiting",
    }));

    setQueue(nextQueue);
    return nextQueue;
  }

  function updateQueueItem(ticker: string, patch: Partial<HarvestItem>) {
    setQueue((current) =>
      current.map((item) => (item.ticker === ticker ? { ...item, ...patch } : item))
    );
  }

  async function getBestPrice(ticker: string): Promise<number> {
    try {
      const series = await getPriceSeries(ticker as SupportedTicker, "daily");
      const close = safeNumber(series.at(-1)?.close);
      return close ?? 0;
    } catch {
      return 0;
    }
  }

  async function harvestTicker(ticker: string) {
    const normalizedTicker = normalizeTickerInput(ticker);
    const startedAt = new Date().toISOString();

    updateQueueItem(normalizedTicker, {
      status: "fetching",
      startedAt,
      message: "Fetching option chain",
    });

    const snapshot = await getOptionChain(normalizedTicker as SupportedTicker, snapshotDate);
    const rowCount = countRows(snapshot);
    const chainCount = snapshot?.chains?.length ?? 0;

    if (!chainCount || !rowCount) {
      updateQueueItem(normalizedTicker, {
        status: "failed",
        chainCount,
        rowCount,
        message: "No chains or rows returned",
        completedAt: new Date().toISOString(),
      });
      return;
    }

    updateQueueItem(normalizedTicker, {
      status: "saving",
      chainCount,
      rowCount,
      snapshotDate: snapshot.snapshotDate ?? snapshotDate,
      message: `Saving ${safeInt(rowCount)} rows directly to Supabase`,
    });

    const preferences = readPreferences();
    const price = await getBestPrice(normalizedTicker);
    const finalSnapshotDate = snapshotDate || snapshot.snapshotDate || TODAY;

    const surfaceSnapshot = buildOptionSurfaceSnapshot({
      ticker: normalizedTicker,
      snapshotTimeZone: preferences.snapshotTimeZone,
      chains: snapshot.chains.map((chain: any) => ({
        ticker: normalizedTicker,
        snapshotDate: finalSnapshotDate,
        expiration: chain.expiration,
        rows: chain.rows ?? [],
        summary: chain.summary ?? {},
        chainKind: chain.chainKind,
        dteAtCapture: chain.dteAtCapture,
      })),
      dailyStructure: {
        ticker: normalizedTicker,
        snapshotDate: finalSnapshotDate,
        spot: price,
        source: "dashboard_harvest",
        chainCount,
        rowCount,
      },
      price: {
        date: finalSnapshotDate,
        close: price,
      },
    });

    const saveResult = await saveSurfaceToSupabase(surfaceSnapshot);

    updateQueueItem(normalizedTicker, {
      status: "saved",
      chainCount: saveResult?.result?.chainCount ?? chainCount,
      rowCount,
      surfaceKey: surfaceSnapshot.surfaceKey,
      snapshotDate: surfaceSnapshot.snapshotDate,
      message: `Saved ${safeInt(rowCount)} rows / ${safeInt(chainCount)} chains to Supabase`,
      completedAt: new Date().toISOString(),
    });
  }

  async function runHarvest(targets: string[]) {
    if (running) return;

    const uniqueTargets = uniqueTickers(targets);
    if (!uniqueTargets.length) {
      setStatus("NO TICKERS SELECTED");
      return;
    }

    setRunning(true);
    setStatus(`HARVEST RUNNING: ${uniqueTargets.length} TICKER(S)`);
    setHarvestOpen(true);
    buildQueue(uniqueTargets);

    for (const ticker of uniqueTargets) {
      try {
        await harvestTicker(ticker);
      } catch (error) {
        console.error("[WheelDesk] Harvest failed:", ticker, error);

        updateQueueItem(ticker, {
          status: "failed",
          message: error instanceof Error ? error.message : "Harvest failed",
          completedAt: new Date().toISOString(),
        });
      }
    }

    setRunning(false);
    setStatus(`HARVEST COMPLETE: ${uniqueTargets.length} TICKER(S) PROCESSED`);
  }

  const savedCount = queue.filter((item) => item.status === "saved").length;
  const failedCount = queue.filter((item) => item.status === "failed").length;
  const totalRows = queue.reduce((sum, item) => sum + (item.rowCount ?? 0), 0);

  return (
    <main className="wd-root">
      <style jsx>{dashboardCss}</style>

      <header className="wd-topbar">
        <div>
          <div className="wd-eyebrow">WheelDesk</div>
          <h1>Portfolio Statement</h1>
        </div>

        <div className="wd-top-actions">
          <span className="wd-status">ACCOUNT STATUS: <strong>OK TO TRADE</strong></span>
          <a className="wd-link-button" href="/control-center">Open Control Center</a>
        </div>
      </header>

      <section className="wd-panel wd-portfolio-panel">
        <div className="wd-panel-titlebar">
          <div>Equities and Equity Options</div>
          <div className="wd-muted">Updated {new Date().toLocaleString()}</div>
        </div>

        <div className="wd-portfolio-controls">
          <label>
            Portfolio
            <select value={selectedProfileId} onChange={(event) => setSelectedProfileId(event.target.value)}>
              {profiles.length ? (
                profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)
              ) : (
                <option value="">No saved portfolio</option>
              )}
            </select>
          </label>
        </div>

        <div className="wd-table-wrap">
          <table className="wd-statement-table">
            <thead>
              <tr>
                <th>Instrument</th>
                <th>Qty</th>
                <th>Days</th>
                <th>Trade Price</th>
                <th>Mark</th>
                <th>Delta</th>
                <th>Theta</th>
                <th>P/L Open</th>
                <th>P/L Day</th>
                <th>BP Effect</th>
              </tr>
            </thead>
            <tbody>
              {((selectedProfile as any)?.positions ?? []).length ? (
                ((selectedProfile as any)?.positions ?? []).map((position: any, index: number) => (
                  <tr key={position.id ?? `${position.symbol}-${index}`}>
                    <td>
                      <strong>{position.symbol ?? position.ticker ?? "UNKNOWN"}</strong>
                      <div className="wd-muted-small">{position.instrumentType ?? position.type ?? "position"}</div>
                    </td>
                    <td>{safeInt(position.qty ?? position.quantity)}</td>
                    <td>{safeInt(position.days ?? position.dte)}</td>
                    <td>{safeMoney(position.entryPrice ?? position.tradePrice)}</td>
                    <td>{safeMoney(position.mark ?? position.markPrice)}</td>
                    <td>{safeInt(position.delta)}</td>
                    <td>{safeMoney(position.theta)}</td>
                    <td>{safeMoney(position.plOpen ?? position.openPnl)}</td>
                    <td>{safeMoney(position.plDay ?? position.dayPnl)}</td>
                    <td>{safeMoney(position.bpEffect ?? position.buyingPowerEffect)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10} className="wd-empty-row">No positions loaded. Build the portfolio on the Portfolio page.</td>
                </tr>
              )}
              <tr className="wd-totals-row">
                <td>Overall Totals</td>
                <td>{safeInt(portfolioSummary.stockShares)}</td>
                <td></td>
                <td></td>
                <td></td>
                <td>{safeInt(portfolioSummary.delta)}</td>
                <td>{safeMoney(portfolioSummary.theta)}</td>
                <td>{safeMoney(portfolioSummary.plOpen)}</td>
                <td>{safeMoney(portfolioSummary.plDay)}</td>
                <td>{safeMoney(portfolioSummary.bpEffect)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="wd-account-strip">
          <span>POSITIONS: <strong>{safeInt(portfolioSummary.positionCount)}</strong></span>
          <span>SHORT CALLS: <strong>{safeInt(portfolioSummary.shortCalls)}</strong></span>
          <span>SHORT PUTS: <strong>{safeInt(portfolioSummary.shortPuts)}</strong></span>
          <span>OPEN PREMIUM PROXY: <strong>{safeMoney(portfolioSummary.openPremiumProxy)}</strong></span>
        </div>
      </section>

      <section className="wd-panel wd-harvest-panel">
        <button type="button" className="wd-collapse" onClick={() => setHarvestOpen((open) => !open)}>
          <span>{harvestOpen ? "▾" : "▸"} Snapshot Harvest</span>
          <span>{status}</span>
        </button>

        {harvestOpen ? (
          <div className="wd-harvest-body">
            <div className="wd-harvest-controls">
              <label>
                Add tickers
                <input
                  value={tickerInput}
                  onChange={(event) => setTickerInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addTickersFromInput();
                    }
                  }}
                  placeholder="AAPL, SOFI, MU"
                  list="dashboard-supported-tickers"
                />
                <datalist id="dashboard-supported-tickers">
                  {SUPPORTED_TICKERS.map((ticker) => <option key={ticker} value={ticker} />)}
                  <option value="^SPX" />
                  <option value="SPY" />
                  <option value="QQQ" />
                </datalist>
              </label>

              <label>
                Snapshot date
                <input type="date" value={snapshotDate} onChange={(event) => setSnapshotDate(event.target.value)} />
              </label>

              <button type="button" onClick={addTickersFromInput} disabled={!tickerInput.trim()}>Add</button>
              <button type="button" className="wd-primary" onClick={() => runHarvest(normalTickers)} disabled={running || !normalTickers.length}>Run 10 Tickers</button>
              <button type="button" onClick={() => runHarvest(premiumTickers)} disabled={running || !premiumTickers.length}>Run Premium</button>
              <button type="button" onClick={clearQueue} disabled={running}>Clear</button>
            </div>

            <div className="wd-chip-row">
              <span className="wd-muted-small">Normal tickers: {normalTickers.length}/{MAX_NORMAL_TICKERS}</span>
              {tickers.map((ticker) => (
                <span key={ticker} className={isPremiumTicker(ticker) ? "wd-chip premium" : "wd-chip"}>
                  {ticker}{isPremiumTicker(ticker) ? " premium" : ""}
                  <button type="button" onClick={() => removeTicker(ticker)}>×</button>
                </span>
              ))}
              {!canAddMoreNormal ? <span className="wd-warning">normal ticker limit reached</span> : null}
            </div>

            <div className="wd-harvest-summary">
              <Metric label="Saved" value={String(savedCount)} />
              <Metric label="Failed" value={String(failedCount)} />
              <Metric label="Rows" value={safeInt(totalRows)} />
              <Metric label="Queue" value={String(queue.length)} />
            </div>

            <div className="wd-table-wrap compact">
              <table className="wd-statement-table compact">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Status</th>
                    <th>Chains</th>
                    <th>Rows</th>
                    <th>Snapshot</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.length ? queue.map((item) => (
                    <tr key={item.ticker}>
                      <td><strong>{item.ticker}</strong>{item.premium ? <span className="wd-premium-note"> premium</span> : null}</td>
                      <td style={{ color: statusColor(item.status), fontWeight: 800 }}>{item.status}</td>
                      <td>{safeInt(item.chainCount)}</td>
                      <td>{safeInt(item.rowCount)}</td>
                      <td>{item.snapshotDate ?? "N/A"}</td>
                      <td>{item.message ?? ""}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={6} className="wd-empty-row">No harvest run yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>

      <section className="wd-bottom-grid">
        <section className="wd-panel">
          <div className="wd-panel-titlebar">
            <div>News</div>
            <div className="wd-muted">provider integration pending</div>
          </div>
          <div className="wd-news-list">
            {news.map((item, index) => (
              <div key={`${item.ticker}-${index}`} className="wd-news-item">
                <strong>{item.ticker}</strong>
                <span>{item.title}</span>
                <small>{item.source} · {item.publishedAt ?? ""}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="wd-panel">
          <div className="wd-panel-titlebar">
            <div>Market Calendar</div>
            <div className="wd-muted">macro / earnings / OPEX</div>
          </div>
          <div className="wd-news-list">
            {calendarItems.map((item, index) => (
              <div key={`${item.date}-${index}`} className={`wd-calendar-item ${item.impact}`}>
                <strong>{item.date}</strong>
                <span>{item.label}</span>
                <small>{item.impact.toUpperCase()} IMPACT</small>
              </div>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="wd-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const dashboardCss = `
  .wd-root {
    min-height: 100vh;
    background: #050505;
    color: #f3f4f6;
    padding: 0;
    font-family: Arial, Helvetica, sans-serif;
  }

  .wd-topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 14px;
    background: #2e2e2e;
    border-bottom: 1px solid #4b5563;
  }

  .wd-eyebrow {
    color: #9ca3af;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  h1 {
    margin: 0;
    font-size: 17px;
    font-weight: 800;
  }

  .wd-top-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .wd-status strong {
    color: #00ff66;
  }

  .wd-link-button,
  button {
    background: #111827;
    color: #f9fafb;
    border: 1px solid #6b7280;
    border-radius: 2px;
    padding: 5px 9px;
    font-weight: 700;
    cursor: pointer;
    text-decoration: none;
  }

  button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .wd-primary {
    background: #065f46;
    border-color: #10b981;
  }

  .wd-panel {
    margin: 0;
    border-bottom: 1px solid #303030;
    background: #070707;
  }

  .wd-portfolio-panel {
    width: 100%;
  }

  .wd-panel-titlebar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #333;
    color: #f9fafb;
    padding: 5px 8px;
    border-top: 1px solid #555;
    border-bottom: 1px solid #222;
    font-size: 12px;
    font-weight: 800;
  }

  .wd-muted { color: #9ca3af; font-weight: 500; }
  .wd-muted-small { color: #9ca3af; font-size: 11px; }
  .wd-warning { color: #fbbf24; font-size: 12px; }

  .wd-portfolio-controls {
    padding: 6px 8px;
    background: #0b0b0b;
  }

  label {
    display: inline-grid;
    gap: 3px;
    color: #d1d5db;
    font-size: 12px;
  }

  input, select {
    background: #111;
    color: #fff;
    border: 1px solid #555;
    padding: 4px 6px;
    min-height: 24px;
  }

  .wd-table-wrap {
    width: 100%;
    overflow-x: auto;
  }

  .wd-statement-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    color: #e5e7eb;
  }

  .wd-statement-table th {
    background: #1b1b1b;
    color: #9ca3af;
    font-weight: 700;
    text-align: right;
    padding: 4px 7px;
    border-right: 1px solid #333;
  }

  .wd-statement-table th:first-child,
  .wd-statement-table td:first-child {
    text-align: left;
  }

  .wd-statement-table td {
    text-align: right;
    padding: 4px 7px;
    border-right: 1px solid #252525;
    border-bottom: 1px solid #181818;
    white-space: nowrap;
  }

  .wd-statement-table tbody tr:nth-child(odd) td { background: #0b0b0b; }
  .wd-statement-table tbody tr:nth-child(even) td { background: #151515; }
  .wd-statement-table tbody tr:hover td { background: #242424; }

  .wd-totals-row td {
    background: #020202 !important;
    color: #fff;
    font-weight: 800;
    border-top: 1px solid #555;
  }

  .wd-empty-row {
    color: #9ca3af;
    text-align: center !important;
    padding: 16px !important;
  }

  .wd-account-strip {
    display: flex;
    justify-content: flex-end;
    gap: 18px;
    padding: 7px 10px 14px;
    color: #d1d5db;
    background: #020202;
    font-size: 12px;
  }

  .wd-account-strip strong { color: #00ff66; }

  .wd-collapse {
    width: 100%;
    display: flex;
    justify-content: space-between;
    background: #333;
    border: 0;
    border-top: 1px solid #555;
    border-bottom: 1px solid #222;
    border-radius: 0;
    color: #f9fafb;
    text-align: left;
    padding: 6px 8px;
  }

  .wd-harvest-body {
    padding: 8px;
  }

  .wd-harvest-controls {
    display: grid;
    grid-template-columns: 2fr 170px repeat(4, auto);
    gap: 8px;
    align-items: end;
  }

  .wd-chip-row {
    display: flex;
    align-items: center;
    gap: 7px;
    flex-wrap: wrap;
    margin: 8px 0;
  }

  .wd-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: #1f2937;
    color: #f9fafb;
    border: 1px solid #4b5563;
    padding: 3px 7px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 800;
  }

  .wd-chip.premium {
    color: #fde68a;
    border-color: #92400e;
    background: #451a03;
  }

  .wd-chip button {
    border: 0;
    background: transparent;
    padding: 0;
  }

  .wd-premium-note { color: #fbbf24; margin-left: 6px; }

  .wd-harvest-summary {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
    margin: 8px 0;
  }

  .wd-metric {
    background: #111;
    border: 1px solid #333;
    padding: 7px;
  }

  .wd-metric span {
    display: block;
    color: #9ca3af;
    font-size: 11px;
  }

  .wd-metric strong {
    display: block;
    color: #fff;
    font-size: 18px;
    margin-top: 3px;
  }

  .compact .wd-statement-table,
  .wd-statement-table.compact {
    font-size: 11px;
  }

  .wd-bottom-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    border-top: 1px solid #333;
  }

  .wd-news-list {
    display: grid;
    gap: 1px;
    background: #111;
  }

  .wd-news-item,
  .wd-calendar-item {
    display: grid;
    grid-template-columns: 90px 1fr 220px;
    gap: 8px;
    padding: 7px 8px;
    background: #070707;
    border-bottom: 1px solid #181818;
    font-size: 12px;
  }

  .wd-calendar-item.high strong { color: #ff4d4d; }
  .wd-calendar-item.medium strong { color: #ffd166; }
  .wd-calendar-item.low strong { color: #7dd3fc; }

  small { color: #9ca3af; }

  @media (max-width: 900px) {
    .wd-topbar,
    .wd-account-strip {
      align-items: flex-start;
      flex-direction: column;
    }

    .wd-harvest-controls {
      grid-template-columns: 1fr;
    }

    .wd-bottom-grid {
      grid-template-columns: 1fr;
    }

    .wd-news-item,
    .wd-calendar-item {
      grid-template-columns: 1fr;
    }
  }
`;
