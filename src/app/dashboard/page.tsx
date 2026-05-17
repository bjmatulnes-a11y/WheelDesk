"use client";

import { useEffect, useMemo, useState } from "react";
import { getOptionChain, getPriceSeries } from "../../lib/data-provider";
import { buildOptionSurfaceSnapshot } from "../../lib/oi-surface-snapshot-builder";
import { listPortfolioProfiles } from "../../lib/portfolio-store";
import { readPreferences } from "../../lib/wheeldesk-storage";
import { SUPPORTED_TICKERS } from "../../lib/types";
import { WheelDeskSideNav } from "../../components/WheelDeskSideNav";
import AuthGate from "../../components/auth/AuthGate";

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

type FlatPosition = {
  id: string;
  profileName: string;
  ticker: string;
  instrument: string;
  instrumentType: string;
  side: string;
  qty: number;
  expiration?: string;
  strike?: number;
  tradePrice?: number;
  mark?: number;
  delta?: number;
  theta?: number;
  openPnL?: number;
  dayPnL?: number;
  bpEffect?: number;
  dte?: number | null;
  raw: any;
};

type TickerGroup = {
  ticker: string;
  positions: FlatPosition[];
  qty: number;
  delta: number;
  theta: number;
  openPnL: number;
  dayPnL: number;
  bpEffect: number;
  shortCalls: number;
  shortPuts: number;
  stockShares: number;
};

type NewsItem = {
  ticker?: string;
  title: string;
  source?: string;
  publishedAt?: string;
  url?: string;
  impact?: string;
};

type CalendarItem = {
  date: string;
  title: string;
  impact?: string;
  type?: string;
};

const colors = {
  page: "#06101b",
  panel: "#0b1724",
  panel2: "#08131f",
  panel3: "#102235",
  border: "#24384d",
  borderSoft: "#1a2b3d",
  text: "#f8fafc",
  muted: "#a8c2dc",
  muted2: "#6d8aa5",
  cyan: "#26e6ff",
  cyanSoft: "#0d3a49",
  green: "#38ff7d",
  red: "#ff5f7c",
  amber: "#ffb547",
  purple: "#ca7cff",
  row: "#050b12",
  rowAlt: "#08131f",
  header: "#0b1724",
};

const navItems = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Scanner", href: "/dashboard/scanner" },
  { label: "Positions", href: "/portfolio" },
  { label: "Wheel", href: "/dashboard/wheel" },
  { label: "Control Center", href: "/control-center" },
  { label: "Validation", href: "/dashboard/validation" },
];

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

function safeNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function nullableNum(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function safeInt(value: unknown, fallback = "N/A"): string {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n).toLocaleString() : fallback;
}

function safeMoney(value: unknown, fallback = "$0"): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;

  const abs = Math.abs(n);
  const body = abs.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  return n < 0 ? `($${body})` : `$${body}`;
}

function safeFixed(value: unknown, digits = 2, fallback = "N/A"): string {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : fallback;
}

function countRows(snapshot: any): number {
  return (snapshot?.chains ?? []).reduce((sum: number, chain: any) => {
    return sum + ((chain?.rows ?? []).length || 0);
  }, 0);
}

function statusColor(status: HarvestStatus): string {
  switch (status) {
    case "saved":
      return colors.green;
    case "failed":
      return colors.red;
    case "fetching":
    case "saving":
      return colors.amber;
    case "pending":
      return colors.cyan;
    case "skipped":
      return colors.muted2;
    default:
      return colors.text;
  }
}

function pickFirst(obj: any, keys: string[], fallback?: unknown): unknown {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== null && value !== undefined && value !== "") return value;
  }

  return fallback;
}

function getTickerFromPosition(position: any): string {
  return normalizeTickerInput(
    pickFirst(position, ["ticker", "symbol", "underlying", "underlyingSymbol", "instrument"], "UNKNOWN")
  );
}

function getInstrumentType(position: any): string {
  return String(
    pickFirst(position, ["instrumentType", "type", "assetType", "kind"], "stock")
  ).toLowerCase();
}

function getSide(position: any): string {
  return String(pickFirst(position, ["side", "direction"], "long")).toLowerCase();
}

function getQty(position: any): number {
  return safeNum(pickFirst(position, ["qty", "quantity", "contracts", "shares"], 0));
}

function getMark(position: any): number | undefined {
  return nullableNum(pickFirst(position, ["mark", "markPrice", "last", "lastPrice", "currentPrice"]));
}

function getTradePrice(position: any): number | undefined {
  return nullableNum(pickFirst(position, ["tradePrice", "entryPrice", "avgPrice", "costBasisPerShare", "price"]));
}

function getStrike(position: any): number | undefined {
  return nullableNum(pickFirst(position, ["strike", "strikePrice"]));
}

function getExpiration(position: any): string | undefined {
  const value = pickFirst(position, ["expiration", "expirationDate", "expiry", "exp"]);
  if (!value) return undefined;
  return String(value).slice(0, 10);
}

function computeDte(expiration?: string): number | null {
  if (!expiration) return null;

  const exp = new Date(`${expiration}T00:00:00Z`);
  const now = new Date(`${TODAY}T00:00:00Z`);

  if (Number.isNaN(exp.getTime())) return null;

  return Math.max(0, Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
}

function isOptionType(type: string): boolean {
  const t = type.toLowerCase();
  return t.includes("call") || t.includes("put") || t.includes("option");
}

function isCall(position: FlatPosition): boolean {
  const t = position.instrumentType.toLowerCase();
  const rawType = String(pickFirst(position.raw, ["optionType", "putCall", "right"], "")).toLowerCase();
  return t.includes("call") || rawType === "call" || rawType === "c";
}

function isPut(position: FlatPosition): boolean {
  const t = position.instrumentType.toLowerCase();
  const rawType = String(pickFirst(position.raw, ["optionType", "putCall", "right"], "")).toLowerCase();
  return t.includes("put") || rawType === "put" || rawType === "p";
}

function estimateBpEffect(position: FlatPosition): number {
  const qty = Math.abs(position.qty);
  const mark = safeNum(position.mark, safeNum(position.tradePrice, 0));
  const strike = safeNum(position.strike, mark);
  const side = position.side.toLowerCase();

  if (!isOptionType(position.instrumentType)) {
    return Math.abs(position.qty * mark);
  }

  if (isPut(position) && side === "short") {
    return Math.abs(strike * qty * 100);
  }

  if (isCall(position) && side === "short") {
    return Math.max(0, Math.abs(mark * qty * 100));
  }

  return Math.abs(mark * qty * 100);
}

function flattenPortfolioPositions(profiles: any[]): FlatPosition[] {
  const rows: FlatPosition[] = [];

  for (const profile of profiles ?? []) {
    const positions = profile?.positions ?? [];

    positions.forEach((position: any, index: number) => {
      const ticker = getTickerFromPosition(position);
      const instrumentType = getInstrumentType(position);
      const side = getSide(position);
      const qty = getQty(position);
      const expiration = getExpiration(position);
      const strike = getStrike(position);
      const mark = getMark(position);
      const tradePrice = getTradePrice(position);
      const dte = isOptionType(instrumentType) ? computeDte(expiration) : null;
      const delta = nullableNum(pickFirst(position, ["delta"]));
      const theta = nullableNum(pickFirst(position, ["theta"]));
      const openPnL = nullableNum(pickFirst(position, ["openPnL", "pnlOpen", "pnl", "plOpen"]));
      const dayPnL = nullableNum(pickFirst(position, ["dayPnL", "pnlDay", "plDay"]));

      const row: FlatPosition = {
        id: String(position?.id ?? `${profile?.id ?? profile?.name ?? "profile"}-${ticker}-${index}`),
        profileName: String(profile?.name ?? "Portfolio"),
        ticker,
        instrument: buildInstrumentLabel({ ticker, instrumentType, side, expiration, strike, raw: position }),
        instrumentType,
        side,
        qty,
        expiration,
        strike,
        tradePrice,
        mark,
        delta,
        theta,
        openPnL,
        dayPnL,
        dte,
        raw: position,
        bpEffect: 0,
      };

      row.bpEffect = nullableNum(pickFirst(position, ["bpEffect", "buyingPowerEffect"])) ?? estimateBpEffect(row);
      rows.push(row);
    });
  }

  return rows;
}

function buildInstrumentLabel(args: {
  ticker: string;
  instrumentType: string;
  side: string;
  expiration?: string;
  strike?: number;
  raw: any;
}): string {
  const rawInstrument = pickFirst(args.raw, ["instrument", "description", "name"]);
  if (rawInstrument) return String(rawInstrument);

  if (!isOptionType(args.instrumentType)) return args.ticker;

  const right = args.instrumentType.includes("put") ? "PUT" : args.instrumentType.includes("call") ? "CALL" : "OPT";
  const strike = args.strike != null ? safeFixed(args.strike, 2) : "";
  const exp = args.expiration ?? "NO EXP";

  return `${args.ticker} ${exp} ${strike} ${right}`.trim();
}

function groupPositionsByTicker(positions: FlatPosition[]): TickerGroup[] {
  const map = new Map<string, TickerGroup>();

  for (const position of positions) {
    const existing =
      map.get(position.ticker) ??
      ({
        ticker: position.ticker,
        positions: [],
        qty: 0,
        delta: 0,
        theta: 0,
        openPnL: 0,
        dayPnL: 0,
        bpEffect: 0,
        shortCalls: 0,
        shortPuts: 0,
        stockShares: 0,
      } satisfies TickerGroup);

    existing.positions.push(position);
    existing.qty += position.qty;
    existing.delta += safeNum(position.delta);
    existing.theta += safeNum(position.theta);
    existing.openPnL += safeNum(position.openPnL);
    existing.dayPnL += safeNum(position.dayPnL);
    existing.bpEffect += safeNum(position.bpEffect);

    if (!isOptionType(position.instrumentType)) existing.stockShares += position.qty;
    if (position.side === "short" && isCall(position)) existing.shortCalls += Math.abs(position.qty);
    if (position.side === "short" && isPut(position)) existing.shortPuts += Math.abs(position.qty);

    map.set(position.ticker, existing);
  }

  return Array.from(map.values()).sort((a, b) => a.ticker.localeCompare(b.ticker));
}

function aggregateTotals(groups: TickerGroup[]) {
  return groups.reduce(
    (total, group) => {
      total.positions += group.positions.length;
      total.stockShares += group.stockShares;
      total.shortCalls += group.shortCalls;
      total.shortPuts += group.shortPuts;
      total.delta += group.delta;
      total.theta += group.theta;
      total.openPnL += group.openPnL;
      total.dayPnL += group.dayPnL;
      total.bpEffect += group.bpEffect;
      return total;
    },
    {
      positions: 0,
      stockShares: 0,
      shortCalls: 0,
      shortPuts: 0,
      delta: 0,
      theta: 0,
      openPnL: 0,
      dayPnL: 0,
      bpEffect: 0,
    }
  );
}

async function saveSurfaceToSupabase(surfaceSnapshot: any) {
  const response = await fetch("/api/supabase/surface-snapshot", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(surfaceSnapshot),
  });

  const result = await response.json().catch(() => null);

  if (!response.ok || !result?.ok) {
    throw new Error(result?.error ?? `Supabase save failed: ${response.status}`);
  }

  return result;
}

async function tryFetchNews(tickers: string[]): Promise<NewsItem[]> {
  if (!tickers.length) return [];

  try {
    const response = await fetch(`/api/news?tickers=${encodeURIComponent(tickers.join(","))}`, {
      cache: "no-store",
    });

    if (!response.ok) return [];

    const data = await response.json();
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data?.news)) return data.news;

    return [];
  } catch {
    return [];
  }
}

async function tryFetchMarketCalendar(): Promise<CalendarItem[]> {
  try {
    const response = await fetch("/api/market-calendar", {
      cache: "no-store",
    });

    if (!response.ok) return [];

    const data = await response.json();
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data?.events)) return data.events;

    return [];
  } catch {
    return [];
  }
}

export default function DashboardPage() {
  const [mounted, setMounted] = useState(false);
  const [snapshotDate, setSnapshotDate] = useState(TODAY);
  const [tickerInput, setTickerInput] = useState("");
  const [tickers, setTickers] = useState<string[]>(["AAPL", "SOFI", "MU", "^SPX"]);
  const [queue, setQueue] = useState<HarvestItem[]>([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("READY");
  const [harvestOpen, setHarvestOpen] = useState(false);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [expandedTickers, setExpandedTickers] = useState<Record<string, boolean>>({});
  const [news, setNews] = useState<NewsItem[]>([]);
  const [calendar, setCalendar] = useState<CalendarItem[]>([]);
  const [newsStatus, setNewsStatus] = useState("provider integration pending");

  useEffect(() => {
    setMounted(true);

    try {
      const savedTickers = JSON.parse(localStorage.getItem(HARVEST_TICKERS_KEY) || "[]");
      if (Array.isArray(savedTickers) && savedTickers.length) {
        setTickers(uniqueTickers(savedTickers));
      }
    } catch {
      // local UI state only
    }

    try {
      setProfiles(listPortfolioProfiles() as any[]);
    } catch {
      setProfiles([]);
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(HARVEST_TICKERS_KEY, JSON.stringify(tickers));
  }, [mounted, tickers]);

  useEffect(() => {
    let cancelled = false;

    async function loadNews() {
      const activeTickers = tickers.slice(0, 10);
      const [newsItems, calendarItems] = await Promise.all([
        tryFetchNews(activeTickers),
        tryFetchMarketCalendar(),
      ]);

      if (cancelled) return;

      setNews(newsItems);
      setCalendar(calendarItems);
      setNewsStatus(newsItems.length || calendarItems.length ? "LIVE" : "provider integration pending");
    }

    loadNews();

    return () => {
      cancelled = true;
    };
  }, [tickers]);

  const positions = useMemo(() => flattenPortfolioPositions(profiles), [profiles]);
  const groups = useMemo(() => groupPositionsByTicker(positions), [positions]);
  const totals = useMemo(() => aggregateTotals(groups), [groups]);

  const normalTickers = useMemo(() => tickers.filter((ticker) => !isPremiumTicker(ticker)).slice(0, MAX_NORMAL_TICKERS), [tickers]);
  const premiumTickers = useMemo(() => tickers.filter(isPremiumTicker), [tickers]);

  function toggleTicker(ticker: string) {
    setExpandedTickers((prev) => ({ ...prev, [ticker]: !prev[ticker] }));
  }

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
      current.map((item) =>
        item.ticker === ticker
          ? {
              ...item,
              ...patch,
            }
          : item
      )
    );
  }

  async function getBestPrice(ticker: string): Promise<number> {
    try {
      const series = await getPriceSeries(ticker as any, "daily");
      const close = Number(series.at(-1)?.close);
      return Number.isFinite(close) ? close : 0;
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

    const snapshot = await getOptionChain(normalizedTicker as any, snapshotDate);
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
    } as any);

    const saveResult = await saveSurfaceToSupabase(surfaceSnapshot);

    updateQueueItem(normalizedTicker, {
      status: "saved",
      chainCount,
      rowCount,
      surfaceKey: surfaceSnapshot.surfaceKey,
      snapshotDate: surfaceSnapshot.snapshotDate,
      message: `Saved ${safeInt(rowCount)} rows / ${safeInt(chainCount)} chains`,
      completedAt: new Date().toISOString(),
    });

    return saveResult;
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
    setStatus("READY");
  }

  const savedCount = queue.filter((item) => item.status === "saved").length;
  const failedCount = queue.filter((item) => item.status === "failed").length;
  const totalRows = queue.reduce((sum, item) => sum + (item.rowCount ?? 0), 0);

  return (
    <AuthGate>
    <div className="wheeldesk-shell" style={styles.app}>
  <WheelDeskSideNav active="dashboard" />

 

      <main className="wheeldesk-page" style={styles.main}>
        <header style={styles.header}>
          <div>
            <div style={styles.eyebrow}>WHEELDESK</div>
            <h1 style={styles.title}>Portfolio Statement</h1>
          </div>

          <div style={styles.headerRight}>
            <span>ACCOUNT STATUS:</span>
            <strong style={{ color: colors.green }}>OK TO TRADE</strong>
            <a href="/control-center" style={styles.controlButton}>
              Open Control Center
            </a>
          </div>
        </header>

        <section style={styles.portfolioPanel}>
          <div style={styles.panelStrip}>
            <span>Equities and Equity Options</span>
            <span>Updated {new Date().toLocaleString()}</span>
          </div>

          <table style={styles.statementTable}>
            <thead>
              <tr>
                <th style={{ ...styles.th, width: "26%" }}>Instrument</th>
                <th style={styles.thRight}>Qty</th>
                <th style={styles.thRight}>Days</th>
                <th style={styles.thRight}>Trade Price</th>
                <th style={styles.thRight}>Mark</th>
                <th style={styles.thRight}>Delta</th>
                <th style={styles.thRight}>Theta</th>
                <th style={styles.thRight}>P/L Open</th>
                <th style={styles.thRight}>P/L Day</th>
                <th style={styles.thRight}>BP Effect</th>
              </tr>
            </thead>

            <tbody>
              {groups.length ? (
                groups.map((group) => {
                  const open = expandedTickers[group.ticker] ?? true;

                  return (
                    <TickerRows
                      key={group.ticker}
                      group={group}
                      open={open}
                      toggle={() => toggleTicker(group.ticker)}
                    />
                  );
                })
              ) : (
                <tr>
                  <td style={styles.td} colSpan={10}>
                    No portfolio positions found. Build positions in the Portfolio page.
                  </td>
                </tr>
              )}

              <tr>
                <td style={styles.totalCell}>Overall Totals</td>
                <td style={styles.tdRight}>{safeInt(totals.stockShares)}</td>
                <td style={styles.tdRight}>N/A</td>
                <td style={styles.tdRight}></td>
                <td style={styles.tdRight}></td>
                <td style={styles.tdRight}>{safeFixed(totals.delta, 2)}</td>
                <td style={styles.tdRight}>{safeFixed(totals.theta, 2)}</td>
                <td style={styles.tdRight}>{safeMoney(totals.openPnL)}</td>
                <td style={styles.tdRight}>{safeMoney(totals.dayPnL)}</td>
                <td style={styles.tdRight}>{safeMoney(totals.bpEffect)}</td>
              </tr>
            </tbody>
          </table>

          <div style={styles.summaryBar}>
            <span>POSITIONS: <strong>{safeInt(totals.positions)}</strong></span>
            <span>SHORT CALLS: <strong style={{ color: colors.green }}>{safeInt(totals.shortCalls)}</strong></span>
            <span>SHORT PUTS: <strong style={{ color: colors.green }}>{safeInt(totals.shortPuts)}</strong></span>
            <span>BP EFFECT: <strong style={{ color: colors.green }}>{safeMoney(totals.bpEffect)}</strong></span>
          </div>
        </section>

        <section style={styles.harvestDetails}>
          <button
            type="button"
            onClick={() => setHarvestOpen((open) => !open)}
            style={styles.detailsSummaryButton}
            aria-expanded={harvestOpen}
          >
            <span style={styles.harvestTitle}>
              <span style={styles.harvestToggle}>{harvestOpen ? "−" : "+"}</span>
              Snapshot Harvest
            </span>
            <span style={{ color: running ? colors.amber : colors.text }}>{status}</span>
          </button>

          {harvestOpen ? (
            <section style={styles.harvestBody}>
            <div style={styles.harvestControls}>
              <label style={styles.label}>
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
                  style={styles.input}
                  list="dashboard-supported-tickers"
                />
                <datalist id="dashboard-supported-tickers">
                  {SUPPORTED_TICKERS.map((ticker) => (
                    <option key={ticker} value={ticker} />
                  ))}
                  <option value="^SPX" />
                  <option value="SPY" />
                  <option value="QQQ" />
                </datalist>
              </label>

              <label style={styles.label}>
                Snapshot date
                <input
                  type="date"
                  value={snapshotDate}
                  onChange={(event) => setSnapshotDate(event.target.value)}
                  style={styles.input}
                />
              </label>

              <button type="button" onClick={addTickersFromInput} disabled={!tickerInput.trim()} style={styles.button}>
                Add
              </button>

              <button
                type="button"
                onClick={() => runHarvest(normalTickers)}
                disabled={running || !normalTickers.length}
                style={styles.primaryButton}
              >
                Run 10-Ticker Harvest
              </button>

              <button
                type="button"
                onClick={() => runHarvest(premiumTickers)}
                disabled={running || !premiumTickers.length}
                style={styles.button}
              >
                Run Premium
              </button>
            </div>

            <div style={styles.chipRow}>
              {tickers.map((ticker) => (
                <span key={ticker} style={isPremiumTicker(ticker) ? styles.chipPremium : styles.chip}>
                  {ticker}
                  <button type="button" onClick={() => removeTicker(ticker)} style={styles.chipX}>
                    ×
                  </button>
                </span>
              ))}
            </div>

            <div style={styles.queueStats}>
              <span>Saved: <strong>{savedCount}</strong></span>
              <span>Failed: <strong>{failedCount}</strong></span>
              <span>Rows: <strong>{safeInt(totalRows)}</strong></span>
              <span>Normal: <strong>{normalTickers.length}/{MAX_NORMAL_TICKERS}</strong></span>
            </div>

            <table style={styles.harvestTable}>
              <thead>
                <tr>
                  <th style={styles.th}>Ticker</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.thRight}>Chains</th>
                  <th style={styles.thRight}>Rows</th>
                  <th style={styles.th}>Snapshot</th>
                  <th style={styles.th}>Message</th>
                </tr>
              </thead>
              <tbody>
                {queue.length ? (
                  queue.map((item) => (
                    <tr key={item.ticker}>
                      <td style={styles.td}>{item.ticker}</td>
                      <td style={{ ...styles.td, color: statusColor(item.status), fontWeight: 900 }}>{item.status}</td>
                      <td style={styles.tdRight}>{safeInt(item.chainCount)}</td>
                      <td style={styles.tdRight}>{safeInt(item.rowCount)}</td>
                      <td style={styles.td}>{item.snapshotDate ?? "N/A"}</td>
                      <td style={styles.td}>{item.message ?? ""}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td style={styles.td} colSpan={6}>No harvest run yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
            </section>
          ) : null}
        </section>

        <section style={styles.newsPanel}>
          <div style={styles.newsHeader}>
            <strong>News</strong>
            <span>{newsStatus}</span>
            <strong>Market Calendar</strong>
            <span>macro / earnings / OPEX</span>
          </div>

          <div style={styles.newsGrid}>
            <div>
              {news.length ? (
                news.map((item, index) => (
                  <a key={`${item.title}-${index}`} href={item.url ?? "#"} style={styles.newsRow}>
                    <strong>{item.ticker ?? "MARKET"}</strong>
                    <span>{item.title}</span>
                    <small>{item.source ?? "source"} {item.publishedAt ? `• ${item.publishedAt}` : ""}</small>
                  </a>
                ))
              ) : (
                tickers.slice(0, 6).map((ticker) => (
                  <div key={ticker} style={styles.newsRow}>
                    <strong>{ticker}</strong>
                    <span>News feed pending provider integration for {ticker}</span>
                    <small>WheelDesk • {TODAY}</small>
                  </div>
                ))
              )}
            </div>

            <div>
              {calendar.length ? (
                calendar.map((event, index) => (
                  <div key={`${event.date}-${event.title}-${index}`} style={styles.newsRow}>
                    <strong style={{ color: event.impact === "high" ? colors.red : colors.amber }}>{event.date}</strong>
                    <span>{event.title}</span>
                    <small>{event.type ?? "calendar"} {event.impact ? `• ${event.impact} impact` : ""}</small>
                  </div>
                ))
              ) : (
                <>
                  <div style={styles.newsRow}>
                    <strong style={{ color: colors.amber }}>{TODAY}</strong>
                    <span>Market calendar integration pending</span>
                    <small>medium impact</small>
                  </div>
                  <div style={styles.newsRow}>
                    <strong style={{ color: colors.red }}>Weekly</strong>
                    <span>OPEX / earnings / macro events will populate here</span>
                    <small>high impact</small>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  
    </AuthGate>
  );
}

function TickerRows({ group, open, toggle }: { group: TickerGroup; open: boolean; toggle: () => void }) {
  return (
    <>
      <tr style={styles.groupRow}>
        <td style={styles.groupCell}>
          <button type="button" onClick={toggle} style={styles.disclosure}>
            {open ? "▾" : "▸"}
          </button>
          <strong>{group.ticker}</strong>
        </td>
        <td style={styles.groupNum}>{safeInt(group.qty)}</td>
        <td style={styles.groupNum}>N/A</td>
        <td style={styles.groupNum}></td>
        <td style={styles.groupNum}></td>
        <td style={styles.groupNum}>{safeFixed(group.delta, 2)}</td>
        <td style={styles.groupNum}>{safeFixed(group.theta, 2)}</td>
        <td style={styles.groupNum}>{safeMoney(group.openPnL)}</td>
        <td style={styles.groupNum}>{safeMoney(group.dayPnL)}</td>
        <td style={styles.groupNum}>{safeMoney(group.bpEffect)}</td>
      </tr>

      {open
        ? group.positions.map((position) => (
            <tr key={position.id} style={styles.positionRow}>
              <td style={styles.childCell}>
                <div>{position.instrument}</div>
                <small>{position.profileName} • {position.side} {position.instrumentType}</small>
              </td>
              <td style={styles.tdRight}>{safeInt(position.qty)}</td>
              <td style={styles.tdRight}>{position.dte == null ? "N/A" : safeInt(position.dte)}</td>
              <td style={styles.tdRight}>{position.tradePrice == null ? "" : safeMoney(position.tradePrice)}</td>
              <td style={styles.tdRight}>{position.mark == null ? "" : safeMoney(position.mark)}</td>
              <td style={styles.tdRight}>{safeFixed(position.delta, 2)}</td>
              <td style={styles.tdRight}>{safeFixed(position.theta, 2)}</td>
              <td style={styles.tdRight}>{safeMoney(position.openPnL)}</td>
              <td style={styles.tdRight}>{safeMoney(position.dayPnL)}</td>
              <td style={styles.tdRight}>{safeMoney(position.bpEffect)}</td>
            </tr>
          ))
        : null}
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  app: {
    minHeight: "100vh",
    background: "#050d17",
    color: colors.text,
    display: "flex",
    gridTemplateColumns: "244px minmax(0, 1fr)",
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  sidebar: {
    background: "linear-gradient(180deg, #0c1b2a 0%, #07111d 100%)",
    borderRight: `1px solid ${colors.border}`,
    padding: "1rem 0.85rem",
    position: "sticky",
    top: 0,
    height: "100vh",
  },
  brandRow: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    marginBottom: "1.8rem",
  },
  logo: {
    width: 34,
    height: 34,
    borderRadius: 999,
    display: "grid",
    placeItems: "center",
    background: colors.cyanSoft,
    color: colors.cyan,
    border: `1px solid ${colors.cyan}`,
    fontWeight: 900,
  },
  brand: {
    fontWeight: 950,
    fontSize: 22,
    letterSpacing: -0.4,
  },
  brandSub: {
    color: colors.muted,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  nav: {
    display: "grid",
    gap: 8,
  },
  navItem: {
    color: "#d8e7f5",
    textDecoration: "none",
    padding: "0.82rem 0.85rem",
    borderRadius: 9,
    fontWeight: 800,
    fontSize: 15,
    letterSpacing: -0.1,
  },
  navItemActive: {
    color: colors.cyan,
    background: "#0b3442",
    border: `1px solid #16586a`,
  },
  sidebarCard: {
    marginTop: "2.7rem",
    border: `1px solid ${colors.border}`,
    borderRadius: 12,
    padding: "0.8rem",
    background: "#0a1624",
  },
  sidebarCardTitle: {
    color: colors.green,
    fontWeight: 900,
    marginBottom: 8,
  },
  sidebarCardText: {
    color: "#b9cce0",
    fontSize: 12,
    lineHeight: 1.35,
  },
  main: {
    flex:1,
    minWidth: 0,
    background: "#050d17",
    color: "#e5f2ff",
    padding: "16px",
    
  },
  header: {
    minHeight: 72,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: "linear-gradient(180deg, #0b1724 0%, #07111d 100%)",
    margin: "-1rem -1.1rem 0",
    padding: "0.8rem 1.1rem",
    borderBottom: `1px solid ${colors.border}`,
  },
  eyebrow: {
    color: colors.muted,
    letterSpacing: 1.2,
    fontSize: 12,
    fontWeight: 900,
  },
  title: {
    margin: 0,
    fontSize: 22,
    lineHeight: 1,
    textShadow: "0 1px 0 #000",
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 16,
  },
  controlButton: {
    marginLeft: 8,
    color: "#fff",
    textDecoration: "none",
    border: `1px solid ${colors.muted}`,
    background: "#101827",
    padding: "0.45rem 0.65rem",
    fontWeight: 900,
  },
  portfolioPanel: {
    background: colors.row,
    borderLeft: `1px solid ${colors.borderSoft}`,
    borderRight: `1px solid ${colors.borderSoft}`,
  },
  panelStrip: {
    display: "flex",
    justifyContent: "space-between",
    background: "#0f2433",
    color: "#e5e7eb",
    borderTop: `1px solid ${colors.border}`,
    borderBottom: `1px solid ${colors.borderSoft}`,
    padding: "0.25rem 0.4rem",
    fontWeight: 900,
    fontSize: 13,
  },
  statementTable: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 12,
  },
  th: {
    color: "#9fb6ca",
    background: "#0b1724",
    borderBottom: `1px solid ${colors.borderSoft}`,
    borderRight: `1px solid ${colors.borderSoft}`,
    padding: "0.28rem 0.35rem",
    textAlign: "left",
    fontWeight: 500,
  },
  thRight: {
    color: "#9fb6ca",
    background: "#0b1724",
    borderBottom: `1px solid ${colors.borderSoft}`,
    borderRight: `1px solid ${colors.borderSoft}`,
    padding: "0.28rem 0.35rem",
    textAlign: "right",
    fontWeight: 500,
  },
  td: {
    background: "#050b12",
    color: "#fff",
    borderBottom: `1px solid ${colors.borderSoft}`,
    borderRight: `1px solid ${colors.borderSoft}`,
    padding: "0.25rem 0.35rem",
  },
  tdRight: {
    background: "#050b12",
    color: "#fff",
    borderBottom: `1px solid ${colors.borderSoft}`,
    borderRight: `1px solid ${colors.borderSoft}`,
    padding: "0.25rem 0.35rem",
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  },
  groupRow: {
    background: "#08131f",
  },
  groupCell: {
    color: "#fff",
    borderBottom: `1px solid ${colors.borderSoft}`,
    borderRight: `1px solid ${colors.borderSoft}`,
    padding: "0.25rem 0.35rem",
    background: "#08131f",
  },
  groupNum: {
    color: "#fff",
    borderBottom: `1px solid ${colors.borderSoft}`,
    borderRight: `1px solid ${colors.borderSoft}`,
    padding: "0.25rem 0.35rem",
    background: "#08131f",
    textAlign: "right",
    fontWeight: 900,
    fontVariantNumeric: "tabular-nums",
  },
  disclosure: {
    marginRight: 6,
    background: "transparent",
    border: 0,
    color: "#fff",
    cursor: "pointer",
    fontWeight: 900,
  },
  positionRow: {
    background: "#050b12",
  },
  childCell: {
    color: "#fff",
    borderBottom: `1px solid ${colors.borderSoft}`,
    borderRight: `1px solid ${colors.borderSoft}`,
    padding: "0.25rem 0.35rem 0.25rem 1.4rem",
    background: "#050b12",
  },
  totalCell: {
    color: "#fff",
    background: "#08131f",
    borderTop: `1px solid ${colors.border}`,
    borderRight: `1px solid ${colors.borderSoft}`,
    padding: "0.3rem 0.35rem",
    fontWeight: 900,
  },
  summaryBar: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "1.4rem",
    color: "#fff",
    background: colors.row,
    padding: "0.45rem 0.5rem",
    borderTop: "1px solid #1f1f1f",
    fontSize: 12,
  },
  harvestDetails: {
    marginTop: "1rem",
    background: "#0b1118",
    border: `1px solid ${colors.border}`,
  },
  detailsSummaryButton: {
    width: "100%",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    cursor: "pointer",
    padding: "0.58rem 0.7rem",
    background: "#0f2433",
    color: "#fff",
    border: 0,
    fontWeight: 900,
    textAlign: "left",
    fontFamily: "inherit",
    fontSize: 14,
  },
  harvestTitle: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  },
  harvestToggle: {
    width: 18,
    height: 18,
    borderRadius: 4,
    border: `1px solid ${colors.cyan}`,
    color: colors.cyan,
    display: "inline-grid",
    placeItems: "center",
    lineHeight: 1,
    fontWeight: 950,
  },
  harvestBody: {
    padding: "0.85rem",
    background: "#07111b",
  },
  harvestControls: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
    gap: "0.7rem",
    alignItems: "end",
  },
  label: {
    display: "grid",
    gap: 4,
    color: "#dce9f5",
    fontSize: 12,
    fontWeight: 800,
  },
  input: {
    background: "#050b12",
    border: `1px solid ${colors.border}`,
    color: colors.text,
    padding: "0.45rem",
    borderRadius: 6,
  },
  button: {
    border: `1px solid ${colors.border}`,
    background: "#101827",
    color: "#fff",
    padding: "0.5rem 0.7rem",
    borderRadius: 7,
    fontWeight: 900,
    cursor: "pointer",
  },
  primaryButton: {
    border: `1px solid ${colors.cyan}`,
    background: "#0b3442",
    color: colors.cyan,
    padding: "0.5rem 0.7rem",
    borderRadius: 7,
    fontWeight: 900,
    cursor: "pointer",
  },
  chipRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginTop: "0.8rem",
  },
  chip: {
    background: "#13202d",
    color: colors.text,
    border: `1px solid ${colors.border}`,
    borderRadius: 999,
    padding: "0.25rem 0.5rem",
    fontWeight: 900,
  },
  chipPremium: {
    background: "#32230c",
    color: colors.amber,
    border: `1px solid ${colors.amber}`,
    borderRadius: 999,
    padding: "0.25rem 0.5rem",
    fontWeight: 900,
  },
  chipX: {
    marginLeft: 8,
    background: "transparent",
    border: 0,
    color: "inherit",
    cursor: "pointer",
    fontWeight: 900,
  },
  queueStats: {
    marginTop: "0.8rem",
    display: "flex",
    gap: "1rem",
    color: colors.muted,
  },
  harvestTable: {
    width: "100%",
    borderCollapse: "collapse",
    marginTop: "0.7rem",
    fontSize: 12,
  },
  newsPanel: {
    marginTop: "0.8rem",
    background: colors.row,
    borderTop: `1px solid ${colors.border}`,
  },
  newsHeader: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
    gap: "1rem",
    background: "#0f2433",
    color: "#fff",
    padding: "0.35rem 0.5rem",
  },
  newsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
    gap: 0,
  },
  newsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
    color: "#fff",
    textDecoration: "none",
    borderBottom: `1px solid ${colors.borderSoft}`,
    padding: "0.45rem 0.35rem",
    fontSize: 12,
  },
}; 
