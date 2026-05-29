"use client";

import { useEffect, useMemo, useState } from "react";
import { getOptionChain, getPriceSeries } from "../../lib/data-provider";
import { buildOptionSurfaceSnapshot } from "../../lib/oi-surface-snapshot-builder";
import { listPortfolioProfiles } from "../../lib/portfolio-store";
import { readPreferences } from "../../lib/wheeldesk-storage";
import { SUPPORTED_TICKERS } from "../../lib/types";
import { WheelDeskSideNav } from "../../components/WheelDeskSideNav";
import AuthGate from "../../components/auth/AuthGate";
import { getSupabaseAuthClient } from "../../lib/auth/supabase-auth-client";

const TODAY = new Date().toISOString().slice(0, 10);
const HARVEST_TICKERS_KEY = "wheelDesk.dashboardHarvestTickers";
const MAX_NORMAL_TICKERS = 10;
const FOUNDER_SEED = ["SOFI", "AMD", "NVDA", "SPY", "QQQ", "AAPL", "MSFT", "PLTR"];

async function getDashboardAuthHeaders(includeJson = false): Promise<Record<string, string>> {
  const headers: Record<string, string> = includeJson ? { "Content-Type": "application/json" } : {};

  const { data } = await getSupabaseAuthClient().auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("Login session is not ready yet. Refresh the dashboard or sign in again.");
  }

  headers.Authorization = `Bearer ${token}`;
  return headers;
}

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

type DashboardNewsPulse = {
  symbol: string;
  status: "quiet" | "active" | "elevated" | "shock" | string;
  count24h: number;
  countWindow?: number;
  materiality: number;
  sentiment: number | null;
  latestHeadline: string | null;
  latestPublishedAt: string | null;
  forecastImpact: "none" | "watch" | "confidence_down" | "shock_risk" | string;
};

type CalendarItem = {
  date: string;
  title: string;
  impact?: string;
  type?: string;
};

type Entitlement = {
  plan: "founder" | "core" | "research" | string;
  maxTickers: number;
  maxReplacementsPerDay: number;
  maxValidationHistoryDays?: number;
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
  asset_type?: string | null;
  data_priority?: number | null;
};

type ForecastDbRow = {
  id?: string;
  symbol?: string;
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

type ForecastHarvestRunResult = {
  ok?: boolean;
  runId?: string | null;
  captureSession?: string;
  requested?: number;
  captured?: number;
  failed?: number;
  items?: Array<{
    symbol: string;
    status: string;
    surfaceStatus?: string;
    forecastStatus?: string;
    saveStatus?: string;
    forecastId?: string | null;
    surfaceDate?: string | null;
    expiration?: string | null;
    rowCount?: number;
    message?: string;
  }>;
  error?: string;
};

type NNReadiness = {
  captured?: number;
  waiting?: number;
  partial?: number;
  matured?: number;
  collecting?: number;
  active?: number;
  neuralStatus?: string;
  horizonCounts?: Record<string, number>;
};

type CentralCommandRow = {
  symbol: string;
  name?: string | null;
  assetType?: string | null;
  forecast: ForecastDbRow | null;
  surfaceDate?: string | null;
  surfaceRows?: number | null;
  surfaceChains?: number | null;
  status: "ready" | "surface-only" | "needs-harvest";
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
    headers: await getDashboardAuthHeaders(true),
    body: JSON.stringify(surfaceSnapshot),
  });

  const result = await response.json().catch(() => null);

  if (!response.ok || !result?.ok) {
    throw new Error(result?.error ?? `Supabase save failed: ${response.status}`);
  }

  return result;
}

async function fetchDashboardNewsPulse(symbols: string[]): Promise<DashboardNewsPulse[]> {
  const normalized = uniqueTickers(symbols).slice(0, 50);
  if (!normalized.length) return [];

  try {
    const response = await fetch(`/api/news/pulse?symbols=${encodeURIComponent(normalized.join(","))}&hours=24`, {
      cache: "no-store",
      headers: await getDashboardAuthHeaders(false),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload?.ok || !Array.isArray(payload.pulses)) {
      return normalized.map((symbol) => quietNewsPulse(symbol));
    }

    const rows = payload.pulses.map(normalizeNewsPulse).filter(Boolean) as DashboardNewsPulse[];
    const seen = new Set(rows.map((row) => row.symbol));
    const missing = normalized.filter((symbol) => !seen.has(symbol)).map((symbol) => quietNewsPulse(symbol));

    return [...rows, ...missing].sort((a, b) => newsPulseRank(b) - newsPulseRank(a) || a.symbol.localeCompare(b.symbol));
  } catch {
    return normalized.map((symbol) => quietNewsPulse(symbol));
  }
}

function normalizeNewsPulse(value: any): DashboardNewsPulse | null {
  const symbol = normalizeTickerInput(value?.symbol);
  if (!symbol) return null;

  const rawStatus = String(value?.status ?? "quiet").toLowerCase();
  const status = ["shock", "elevated", "active", "quiet"].includes(rawStatus) ? rawStatus : "quiet";

  const rawImpact = String(value?.forecastImpact ?? value?.forecast_impact ?? "none").toLowerCase();
  const forecastImpact = ["shock_risk", "confidence_down", "watch", "none"].includes(rawImpact) ? rawImpact : "none";

  return {
    symbol,
    status,
    count24h: safeNum(value?.count24h ?? value?.count_24h, 0),
    countWindow: safeNum(value?.countWindow ?? value?.count_window, 0),
    materiality: safeNum(value?.materiality, 0),
    sentiment: value?.sentiment === null || value?.sentiment === undefined ? null : safeNum(value.sentiment, 0),
    latestHeadline: value?.latestHeadline ?? value?.latest_headline ?? null,
    latestPublishedAt: value?.latestPublishedAt ?? value?.latest_published_at ?? null,
    forecastImpact,
  };
}

function quietNewsPulse(symbol: string): DashboardNewsPulse {
  return {
    symbol,
    status: "quiet",
    count24h: 0,
    countWindow: 0,
    materiality: 0,
    sentiment: null,
    latestHeadline: null,
    latestPublishedAt: null,
    forecastImpact: "none",
  };
}

function newsPulseRank(pulse: DashboardNewsPulse): number {
  if (pulse.status === "shock") return 4;
  if (pulse.status === "elevated") return 3;
  if (pulse.status === "active") return 2;
  return 1;
}

function newsPulseLabel(status: string): string {
  if (status === "shock") return "Shock risk";
  if (status === "elevated") return "Elevated";
  if (status === "active") return "Active";
  return "Quiet";
}

function newsImpactLabel(impact: string): string {
  if (impact === "shock_risk") return "Shock risk";
  if (impact === "confidence_down") return "Confidence down";
  if (impact === "watch") return "Watch divergence";
  return "None";
}

function newsPulseColor(status: string): string {
  if (status === "shock") return colors.red;
  if (status === "elevated") return colors.amber;
  if (status === "active") return colors.cyan;
  return colors.muted;
}

function formatNewsAge(value?: string | null): string {
  if (!value) return "—";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "—";

  const deltaMinutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 48) return `${deltaHours}h ago`;
  const deltaDays = Math.round(deltaHours / 24);
  return `${deltaDays}d ago`;
}

function dateOnly(value: unknown): string {
  const raw = String(value ?? "").trim();
  return raw ? raw.slice(0, 10) : "";
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatPercent(value: unknown): string {
  const n = toNumber(value);
  return n == null ? "N/A" : `${n.toFixed(0)}%`;
}

function extractSurfaceArray(payload: any): any[] {
  const candidates = [payload?.snapshots, payload?.surfaces, payload?.data, payload?.items, payload?.surfaceSnapshots];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return payload?.snapshot || payload?.surface ? [payload.snapshot ?? payload.surface] : [];
}

function surfaceMeta(payload: any): Pick<CentralCommandRow, "surfaceDate" | "surfaceRows" | "surfaceChains"> {
  const surfaces = extractSurfaceArray(payload);
  const latest = surfaces
    .map((surface) => {
      const chains = Array.isArray(surface?.chains) ? surface.chains : Array.isArray(surface?.optionChains) ? surface.optionChains : [];
      const rowCount = chains.reduce((sum: number, chain: any) => sum + (Array.isArray(chain?.rows) ? chain.rows.length : 0), 0);
      return {
        surfaceDate: dateOnly(surface?.snapshotDate ?? surface?.snapshot_date ?? surface?.date ?? surface?.asOfDate),
        surfaceRows: Number(surface?.rowCount ?? surface?.row_count ?? rowCount ?? 0),
        surfaceChains: Number(surface?.chainCount ?? surface?.chain_count ?? chains.length ?? 0),
      };
    })
    .filter((item) => item.surfaceDate)
    .sort((a, b) => b.surfaceDate.localeCompare(a.surfaceDate))[0];

  return latest ?? { surfaceDate: null, surfaceRows: null, surfaceChains: null };
}

async function fetchLatestForecast(symbol: string): Promise<ForecastDbRow | null> {
  try {
    const response = await fetch(`/api/forecasts/oi-field?symbol=${encodeURIComponent(symbol)}&limit=1`, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) return null;
    return Array.isArray(payload?.forecasts) ? payload.forecasts[0] ?? null : null;
  } catch {
    return null;
  }
}

async function fetchLatestSurfaceMeta(symbol: string): Promise<Pick<CentralCommandRow, "surfaceDate" | "surfaceRows" | "surfaceChains">> {
  try {
    const response = await fetch(`/api/supabase/surface-snapshot?ticker=${encodeURIComponent(symbol)}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) return { surfaceDate: null, surfaceRows: null, surfaceChains: null };
    return surfaceMeta(payload);
  } catch {
    return { surfaceDate: null, surfaceRows: null, surfaceChains: null };
  }
}

async function fetchNNReadiness(): Promise<NNReadiness | null> {
  try {
    const response = await fetch("/api/forecast-harvest/readiness", { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) return null;
    return payload as NNReadiness;
  } catch {
    return null;
  }
}

function readinessLabel(value?: string | null): string {
  const normalized = String(value ?? "collecting").replace(/_/g, " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function commandStatus(row: CentralCommandRow): string {
  if (row.status === "ready") return "Forecast ready";
  if (row.status === "surface-only") return "Surface captured";
  return "Needs harvest";
}

function commandStatusColor(row: CentralCommandRow): string {
  if (row.status === "ready") return colors.green;
  if (row.status === "surface-only") return colors.amber;
  return colors.red;
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
  const [newsPulses, setNewsPulses] = useState<DashboardNewsPulse[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsHarvesting, setNewsHarvesting] = useState(false);
  const [newsStatus, setNewsStatus] = useState("News Pulse idle.");
  const [centralTickers, setCentralTickers] = useState<SavedTicker[]>([]);
  const [centralEntitlement, setCentralEntitlement] = useState<Entitlement | null>(null);
  const [centralUniverse, setCentralUniverse] = useState<UniverseTicker[]>([]);
  const [centralTickerInput, setCentralTickerInput] = useState("");
  const [centralReplaceSymbol, setCentralReplaceSymbol] = useState("");
  const [centralRows, setCentralRows] = useState<CentralCommandRow[]>([]);
  const [centralStatus, setCentralStatus] = useState("Loading central ticker slots...");
  const [centralLoading, setCentralLoading] = useState(false);
  const [centralSaving, setCentralSaving] = useState(false);
  const [centralReplacementsUsed, setCentralReplacementsUsed] = useState(0);
  const [centralLoadedAt, setCentralLoadedAt] = useState<string | null>(null);
  const [forecastHarvestRunning, setForecastHarvestRunning] = useState(false);
  const [forecastHarvestResult, setForecastHarvestResult] = useState<ForecastHarvestRunResult | null>(null);
  const [forecastHarvestStatus, setForecastHarvestStatus] = useState("Forecast harvest idle.");
  const [captureSession, setCaptureSession] = useState("auto");
  const [nnReadiness, setNnReadiness] = useState<NNReadiness | null>(null);

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
    refreshCentralCommandHub();
    loadCentralUniverse();
    loadNNReadiness();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadCentralUniverse(query = "") {
    try {
      const response = await fetch(`/api/ticker-universe?limit=80${query ? `&q=${encodeURIComponent(query)}` : ""}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (response.ok && Array.isArray(payload?.tickers)) setCentralUniverse(payload.tickers);
    } catch {
      // Helpful, but not required for the dashboard to render.
    }
  }

  async function loadDashboardNewsPulse(symbolsOverride?: string[]) {
    const symbols = uniqueTickers(symbolsOverride ?? centralTickers.map((slot) => slot.symbol));

    if (!symbols.length) {
      setNewsPulses([]);
      setNewsStatus("No locked ticker slots yet. News Pulse will activate after tickers are added.");
      return;
    }

    setNewsLoading(true);
    setNewsStatus(`Loading News Pulse for ${symbols.length} locked ticker(s)...`);

    try {
      const pulses = await fetchDashboardNewsPulse(symbols);
      setNewsPulses(pulses);

      const activeCount = pulses.filter((pulse) => pulse.status !== "quiet").length;
      const materialCount = pulses.filter((pulse) => safeNum(pulse.materiality) > 0 || pulse.count24h > 0).length;
      setNewsStatus(activeCount || materialCount
        ? `${activeCount} active ticker(s), ${materialCount} with material news context.`
        : "No material ticker news found for locked tickers.");
    } catch (error: any) {
      setNewsStatus(error?.message ?? "Could not load News Pulse.");
      setNewsPulses(symbols.map((symbol) => quietNewsPulse(symbol)));
    } finally {
      setNewsLoading(false);
    }
  }

  async function runDashboardNewsHarvest() {
    const symbols = uniqueTickers(centralTickers.map((slot) => slot.symbol));

    if (!symbols.length) {
      setNewsStatus("No locked ticker slots yet. News harvest will activate after tickers are added.");
      return;
    }

    setNewsHarvesting(true);
    setNewsStatus(`Running live news harvest for ${symbols.length} locked ticker(s)...`);

    try {
      const response = await fetch("/api/news/harvest", {
        method: "POST",
        cache: "no-store",
        headers: {
          ...(await getDashboardAuthHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          symbols,
          hours: 168,
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? `News harvest failed: ${response.status}`);
      }

      setNewsStatus(`News harvest complete: inserted ${safeInt(payload.totalInserted, "0")} headline link(s), failed ${safeInt(payload.totalFailed, "0")}.`);
      await loadDashboardNewsPulse(symbols);
    } catch (error: any) {
      setNewsStatus(error?.message ?? "Could not run News Harvest.");
    } finally {
      setNewsHarvesting(false);
    }
  }


  async function loadCentralWatchlist(): Promise<SavedTicker[]> {
    const response = await fetch("/api/user-watchlist", {
      cache: "no-store",
      headers: await getDashboardAuthHeaders(),
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error ?? "Could not load central ticker slots.");
    }

    const items = Array.isArray(payload.tickers) ? payload.tickers : [];
    setCentralTickers(items);
    setCentralEntitlement(payload.entitlement ?? null);
    setCentralReplacementsUsed(Number(payload.replacementsUsedToday ?? 0));
    return items;
  }

  async function refreshCentralCommandHub(tickersOverride?: SavedTicker[]) {
    setCentralLoading(true);
    setCentralStatus("Loading central ticker slots, latest surfaces, and OI Field forecasts...");

    try {
      const slots = tickersOverride ?? (centralTickers.length ? centralTickers : await loadCentralWatchlist());
      const symbols = slots.map((slot) => normalizeTickerInput(slot.symbol)).filter(Boolean);

      if (!symbols.length) {
        setCentralRows([]);
        setCentralStatus("No central ticker slots yet. Seed founder defaults or add tickers from the universe.");
        setCentralLoadedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
        await loadDashboardNewsPulse([]);
        return;
      }

      const pairs = await Promise.all(symbols.map(async (symbol) => {
        const slot = slots.find((item) => normalizeTickerInput(item.symbol) === symbol);
        const [forecast, meta] = await Promise.all([fetchLatestForecast(symbol), fetchLatestSurfaceMeta(symbol)]);
        const status: CentralCommandRow["status"] = forecast ? "ready" : meta.surfaceDate ? "surface-only" : "needs-harvest";
        return {
          symbol,
          name: slot?.ticker_universe?.name,
          assetType: slot?.ticker_universe?.asset_type,
          forecast,
          ...meta,
          status,
        } satisfies CentralCommandRow;
      }));

      const statusRank: Record<CentralCommandRow["status"], number> = { ready: 3, "surface-only": 2, "needs-harvest": 1 };
      const sorted = pairs.sort((a, b) => statusRank[b.status] - statusRank[a.status] || a.symbol.localeCompare(b.symbol));

      setCentralRows(sorted);
      setCentralLoadedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      setCentralStatus(`Loaded ${symbols.length} central ticker slot(s): ${sorted.filter((row) => row.status === "ready").length} forecast-ready, ${sorted.filter((row) => row.status === "surface-only").length} surface-only.`);
      await loadDashboardNewsPulse(symbols);
    } catch (error: any) {
      setCentralStatus(error?.message ?? "Could not load central ticker command hub.");
      setCentralRows([]);
    } finally {
      setCentralLoading(false);
    }
  }

  async function loadNNReadiness() {
    const readiness = await fetchNNReadiness();
    if (readiness) setNnReadiness(readiness);
  }

  function effectiveCaptureSession() {
    if (captureSession !== "auto") return captureSession;

    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).formatToParts(new Date());
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
    const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
    const minutes = hour * 60 + minute;
    if (minutes < 9 * 60 + 30) return "premarket";
    if (minutes < 15 * 60 + 45) return "midday";
    return "close";
  }

  async function runForecastHarvest() {
    const symbols = centralSymbols.length ? centralSymbols : centralTickers.map((slot) => normalizeTickerInput(slot.symbol)).filter(Boolean);
    if (!symbols.length || forecastHarvestRunning) return;

    setForecastHarvestRunning(true);
    const session = effectiveCaptureSession();
    setForecastHarvestStatus(`Running forecast harvest for ${symbols.length} ticker(s) using ${session} session...`);

    try {
      const response = await fetch("/api/forecast-harvest/run", {
        method: "POST",
        headers: await getDashboardAuthHeaders(true),
        body: JSON.stringify({ symbols, captureSession: session, notes: { source: "dashboard_command_hub" } }),
      });
      const payload = (await response.json().catch(() => null)) as ForecastHarvestRunResult | null;

      if (!response.ok || !payload?.ok) throw new Error(payload?.error ?? `Forecast harvest failed: ${response.status}`);

      setForecastHarvestResult(payload);
      setForecastHarvestStatus(`Forecast harvest complete: ${payload.captured ?? 0}/${payload.requested ?? symbols.length} captured · ${payload.failed ?? 0} failed · session ${payload.captureSession ?? session}.`);
      await Promise.all([refreshCentralCommandHub(), loadNNReadiness()]);
    } catch (error: any) {
      setForecastHarvestStatus(error?.message ?? "Forecast harvest failed.");
    } finally {
      setForecastHarvestRunning(false);
    }
  }

  async function runFullOIHarvest() {
    const symbols = centralSymbols.length ? centralSymbols : centralTickers.map((slot) => normalizeTickerInput(slot.symbol)).filter(Boolean);
    if (!symbols.length || running || forecastHarvestRunning) return;

    setHarvestOpen(true);
    setForecastHarvestResult(null);
    setForecastHarvestStatus("Full OI harvest started: capturing surfaces first...");

    await runHarvest(symbols);

    setForecastHarvestStatus("Surface harvest complete. Generating baseline OI Field forecasts from saved surfaces...");
    await runForecastHarvest();
  }

  async function addCentralTicker(symbolOverride?: string, replaceOverride?: string) {
    const symbol = normalizeTickerInput(symbolOverride ?? centralTickerInput).replace(/[^A-Z0-9.\-^]/g, "");
    const replaceSymbol = normalizeTickerInput(replaceOverride ?? centralReplaceSymbol).replace(/[^A-Z0-9.\-^]/g, "");
    if (!symbol) return;

    setCentralSaving(true);
    setCentralStatus(`Saving ${symbol} to central ticker slots...`);

    try {
      const response = await fetch("/api/user-watchlist", {
        method: "POST",
        headers: await getDashboardAuthHeaders(true),
        body: JSON.stringify({ symbol, replaceSymbol: replaceSymbol || undefined }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? `Could not add ${symbol}.`);
      }

      setCentralTickerInput("");
      setCentralReplaceSymbol("");
      const slots = await loadCentralWatchlist();
      await refreshCentralCommandHub(slots);
    } catch (error: any) {
      setCentralStatus(error?.message ?? `Could not add ${symbol}.`);
    } finally {
      setCentralSaving(false);
    }
  }

  async function removeCentralTicker(symbol: string) {
    const normalized = normalizeTickerInput(symbol);
    if (!normalized) return;

    setCentralSaving(true);
    setCentralStatus(`Removing ${normalized} from central ticker slots...`);

    try {
      const response = await fetch(`/api/user-watchlist?symbol=${encodeURIComponent(normalized)}`, {
        method: "DELETE",
        headers: await getDashboardAuthHeaders(),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? `Could not remove ${normalized}.`);
      }

      const slots = await loadCentralWatchlist();
      await refreshCentralCommandHub(slots);
    } catch (error: any) {
      setCentralStatus(error?.message ?? `Could not remove ${normalized}.`);
    } finally {
      setCentralSaving(false);
    }
  }

  async function seedCentralFounderDefaults() {
    setCentralSaving(true);
    setCentralStatus("Seeding founder defaults into central ticker slots...");

    try {
      for (const symbol of FOUNDER_SEED) {
        await fetch("/api/user-watchlist", {
          method: "POST",
          headers: await getDashboardAuthHeaders(true),
          body: JSON.stringify({ symbol }),
        });
      }
      const slots = await loadCentralWatchlist();
      await refreshCentralCommandHub(slots);
    } finally {
      setCentralSaving(false);
    }
  }

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
    await refreshCentralCommandHub();
  }

  const savedCount = queue.filter((item) => item.status === "saved").length;
  const failedCount = queue.filter((item) => item.status === "failed").length;
  const totalRows = queue.reduce((sum, item) => sum + (item.rowCount ?? 0), 0);
  const centralUsedSlots = centralTickers.length;
  const centralMaxSlots = Number(centralEntitlement?.maxTickers ?? 0);
  const centralReplacementsLeft = Math.max(0, Number(centralEntitlement?.maxReplacementsPerDay ?? 0) - centralReplacementsUsed);
  const centralReady = centralRows.filter((row) => row.status === "ready").length;
  const centralSurfaceOnly = centralRows.filter((row) => row.status === "surface-only").length;
  const centralNeedsHarvest = centralRows.filter((row) => row.status === "needs-harvest").length;
  const centralTop = centralRows.find((row) => row.forecast) ?? centralRows[0] ?? null;
  const centralSymbols = centralTickers.map((slot) => normalizeTickerInput(slot.symbol)).filter(Boolean);
  const newsQuiet = newsPulses.filter((pulse) => pulse.status === "quiet").length;
  const newsActive = newsPulses.filter((pulse) => pulse.status === "active").length;
  const newsElevated = newsPulses.filter((pulse) => pulse.status === "elevated").length;
  const newsShock = newsPulses.filter((pulse) => pulse.status === "shock").length;
  const newsRows = newsPulses.length ? newsPulses : centralSymbols.map((symbol) => quietNewsPulse(symbol));

  return (
    <AuthGate>
    <div className="wheeldesk-shell" style={styles.app}>
  <WheelDeskSideNav active="dashboard" />

 

      <main className="wheeldesk-page" style={styles.main}>
        <header style={styles.header}>
          <div>
            <div style={styles.eyebrow}>WHEELDESK</div>
            <h1 style={styles.title}>Dashboard</h1>
          </div>

          <div style={styles.headerRight}>
            <span>ACCOUNT STATUS:</span>
            <strong style={{ color: colors.green }}>OK TO TRADE</strong>
            <a href="/control-center" style={styles.controlButton}>
              Open Control Center
            </a>
          </div>
        </header>

        <section style={styles.commandHub}>
          <div style={styles.commandHeader}>
            <div>
              <div style={styles.eyebrow}>Central Ticker Universe</div>
              <h2 style={styles.commandTitle}>Dashboard Command Hub</h2>
              <p style={styles.commandSubtitle}>
                Manage the tickers that WheelDesk tracks for your account. Shared OI surfaces, OI Field forecasts, and future validation receipts should flow from this central universe into Control Center, Chart Room, Validation, and Watchlist Command.
              </p>
            </div>

            <div style={styles.commandStatusBox}>
              <span>{centralLoadedAt ? `Updated ${centralLoadedAt}` : "Loading"}</span>
              <strong>{centralUsedSlots}/{centralMaxSlots || "?"}</strong>
              <small>{centralEntitlement?.plan ?? "founder"} ticker slots</small>
            </div>
          </div>

          <div style={styles.commandStats}>
            <div style={styles.commandStat}><span>Forecast Ready</span><strong style={{ color: colors.green }}>{centralReady}</strong></div>
            <div style={styles.commandStat}><span>Surface Only</span><strong style={{ color: colors.amber }}>{centralSurfaceOnly}</strong></div>
            <div style={styles.commandStat}><span>Needs Harvest</span><strong style={{ color: colors.red }}>{centralNeedsHarvest}</strong></div>
            <div style={styles.commandStat}><span>Replacements Left</span><strong style={{ color: colors.cyan }}>{centralReplacementsLeft}</strong></div>
            <div style={styles.commandStat}><span>Forecasts Captured</span><strong style={{ color: colors.cyan }}>{safeInt(nnReadiness?.captured ?? 0)}</strong></div>
            <div style={styles.commandStat}><span>Neural Status</span><strong style={{ color: colors.amber }}>{readinessLabel(nnReadiness?.neuralStatus)}</strong></div>
          </div>

          <div style={styles.commandControls}>
            <label style={styles.label}>
              Add from universe
              <input
                value={centralTickerInput}
                onChange={(event) => {
                  const value = event.target.value.toUpperCase();
                  setCentralTickerInput(value);
                  loadCentralUniverse(value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addCentralTicker();
                  }
                }}
                placeholder="AMD, SOFI, NVDA..."
                style={styles.input}
                list="dashboard-central-universe"
              />
              <datalist id="dashboard-central-universe">
                {centralUniverse.map((ticker) => (
                  <option key={ticker.symbol} value={ticker.symbol}>
                    {ticker.name ?? ticker.symbol}
                  </option>
                ))}
              </datalist>
            </label>

            <label style={styles.label}>
              Replace if full
              <select value={centralReplaceSymbol} onChange={(event) => setCentralReplaceSymbol(event.target.value)} style={styles.input}>
                <option value="">Do not replace</option>
                {centralTickers.map((ticker) => (
                  <option key={ticker.symbol} value={ticker.symbol}>{ticker.symbol}</option>
                ))}
              </select>
            </label>

            <button type="button" onClick={() => addCentralTicker()} disabled={centralSaving || centralLoading || !centralTickerInput.trim()} style={styles.primaryButton}>
              {centralSaving ? "Saving..." : "Add Slot"}
            </button>

            <button type="button" onClick={seedCentralFounderDefaults} disabled={centralSaving || centralLoading || centralTickers.length > 0} style={styles.button}>
              Seed Founder Defaults
            </button>

            <button type="button" onClick={() => refreshCentralCommandHub()} disabled={centralSaving || centralLoading} style={styles.button}>
              {centralLoading ? "Refreshing..." : "Refresh Hub"}
            </button>

            <label style={styles.label}>
              Forecast session
              <select value={captureSession} onChange={(event) => setCaptureSession(event.target.value)} style={styles.input}>
                <option value="auto">Auto session</option>
                <option value="premarket">Premarket</option>
                <option value="midday">Midday</option>
                <option value="close">Close</option>
                <option value="manual">Manual</option>
              </select>
            </label>

            <button type="button" onClick={() => runHarvest(centralSymbols)} disabled={running || !centralSymbols.length} style={styles.button}>
              {running ? "Harvesting..." : "Surface Harvest"}
            </button>

            <button type="button" onClick={runForecastHarvest} disabled={forecastHarvestRunning || !centralSymbols.length} style={styles.button}>
              {forecastHarvestRunning ? "Forecasting..." : "Forecast Harvest"}
            </button>

            <button type="button" onClick={runFullOIHarvest} disabled={running || forecastHarvestRunning || !centralSymbols.length} style={styles.primaryButton}>
              {running || forecastHarvestRunning ? "Running..." : "Run Full OI Harvest"}
            </button>
          </div>

          <div style={styles.commandMessage}>{centralStatus}</div>
          <div style={styles.commandMessage}>
            <strong style={{ color: colors.cyan }}>Forecast harvest:</strong> {forecastHarvestStatus}
            {forecastHarvestResult?.items?.length ? (
              <span style={{ display: "block", marginTop: 6, color: colors.muted }}>
                {forecastHarvestResult.items.slice(0, 6).map((item) => `${item.symbol}: surface ${item.surfaceStatus ?? "—"} / forecast ${item.forecastStatus ?? item.status} / save ${item.saveStatus ?? "—"}`).join(" · ")}
                {forecastHarvestResult.items.length > 6 ? ` · +${forecastHarvestResult.items.length - 6} more` : ""}
              </span>
            ) : null}
          </div>

          {centralTop ? (
            <div style={styles.commandTop}>
              <div>
                <div style={styles.eyebrow}>Start here</div>
                <h3 style={styles.commandTopTitle}>{centralTop.symbol} · {commandStatus(centralTop)}</h3>
                <p style={styles.commandSubtitle}>
                  {centralTop.forecast
                    ? `Bias ${centralTop.forecast.bias ?? "N/A"} · 30D base ${safeMoney(centralTop.forecast.base_30d)} · field ${safeMoney(centralTop.forecast.lower_30d)}–${safeMoney(centralTop.forecast.upper_30d)} · confidence ${formatPercent(centralTop.forecast.confidence)}.`
                    : centralTop.surfaceDate
                      ? `Surface captured on ${centralTop.surfaceDate}. Open Control Center and click Capture Forecast to create the OI Field receipt.`
                      : "No surface exists yet. Harvest this ticker before using it in the daily read."}
                </p>
              </div>
              <div style={styles.commandTopActions}>
                <a href={`/control-center?ticker=${encodeURIComponent(centralTop.symbol)}`} style={styles.controlButton}>Open Control</a>
                <a href={`/control-center/chart?ticker=${encodeURIComponent(centralTop.symbol)}`} style={styles.controlButton}>Chart Room</a>
                <a href="/watchlist" style={styles.controlButton}>Full Watchlist</a>
              </div>
            </div>
          ) : null}

          <div style={styles.centralSlotGrid}>
            {centralRows.length ? centralRows.map((row) => (
              <div key={row.symbol} style={styles.centralSlotCard}>
                <div style={styles.centralSlotTop}>
                  <strong>{row.symbol}</strong>
                  <span style={{ color: commandStatusColor(row), fontWeight: 900 }}>{commandStatus(row)}</span>
                </div>
                <small style={styles.centralSlotName}>{row.name ?? row.assetType ?? "WheelDesk universe"}</small>
                <div style={styles.centralForecastGrid}>
                  <span>30D Base <strong>{safeMoney(row.forecast?.base_30d, "N/A")}</strong></span>
                  <span>Lower <strong>{safeMoney(row.forecast?.lower_30d, "N/A")}</strong></span>
                  <span>Upper <strong>{safeMoney(row.forecast?.upper_30d, "N/A")}</strong></span>
                  <span>Trap <strong>{formatPercent(row.forecast?.trap_probability)}</strong></span>
                </div>
                <div style={styles.centralSlotFoot}>
                  <span>Surface {row.surfaceDate ?? "none"}</span>
                  <span>{row.surfaceRows ? `${safeInt(row.surfaceRows)} rows` : "no rows"}</span>
                </div>
                <div style={styles.centralSlotActions}>
                  <a href={`/control-center?ticker=${encodeURIComponent(row.symbol)}`} style={styles.inlineAction}>{row.forecast ? "Control" : "Capture"}</a>
                  <a href={`/dashboard/validation?ticker=${encodeURIComponent(row.symbol)}`} style={styles.inlineAction}>Validate</a>
                  <button type="button" onClick={() => removeCentralTicker(row.symbol)} style={styles.textButton} disabled={centralSaving}>Remove</button>
                </div>
              </div>
            )) : (
              <div style={styles.emptyCentral}>
                No central ticker slots yet. Seed founder defaults or add a ticker from the universe.
              </div>
            )}
          </div>
        </section>

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
          <button type="button" style={styles.detailsSummaryButton} onClick={() => setHarvestOpen((value) => !value)}>
            <span style={styles.harvestTitle}>
              <span style={styles.harvestToggle}>{harvestOpen ? "−" : "+"}</span>
              Visible OI Harvest Flow
            </span>
            <span style={{ color: running ? colors.amber : colors.text }}>{status}</span>
          </button>

          {harvestOpen ? (
            <div style={styles.harvestBody}>
              <p style={styles.commandSubtitle}>
                Surface Harvest visibly walks each locked ticker through Yahoo option-chain fetch, Supabase save, and saved-state confirmation. Run Full OI Harvest then generates the baseline OI implied-path forecast from the saved surface while NN remains in collecting mode.
              </p>

              <div style={styles.harvestControls}>
                <button type="button" onClick={() => runHarvest(centralSymbols)} disabled={running || !centralSymbols.length} style={styles.button}>
                  {running ? "Harvesting surfaces..." : "Run Surface Harvest"}
                </button>
                <button type="button" onClick={runForecastHarvest} disabled={forecastHarvestRunning || !centralSymbols.length} style={styles.button}>
                  {forecastHarvestRunning ? "Generating forecasts..." : "Run Forecast Harvest"}
                </button>
                <button type="button" onClick={runFullOIHarvest} disabled={running || forecastHarvestRunning || !centralSymbols.length} style={styles.primaryButton}>
                  Run Full OI Harvest
                </button>
              </div>

              <div style={styles.queueStats}>
                <span>Surface saved: <strong>{savedCount}</strong></span>
                <span>Surface failed: <strong>{failedCount}</strong></span>
                <span>Rows: <strong>{safeInt(totalRows)}</strong></span>
                <span>Tracked slots: <strong>{centralUsedSlots}/{centralMaxSlots || "?"}</strong></span>
                <span>Session: <strong>{captureSession === "auto" ? `Auto → ${effectiveCaptureSession()}` : captureSession}</strong></span>
              </div>

              <table style={styles.harvestTable}>
                <thead>
                  <tr>
                    <th style={styles.th}>Ticker</th>
                    <th style={styles.th}>Surface Fetch</th>
                    <th style={styles.th}>Supabase Save</th>
                    <th style={styles.thRight}>Chains</th>
                    <th style={styles.thRight}>Rows</th>
                    <th style={styles.th}>Snapshot</th>
                    <th style={styles.th}>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {(queue.length ? queue : centralSymbols.map((symbol) => ({ ticker: symbol, status: "pending" as HarvestStatus, message: "Waiting" }))).map((item) => (
                    <tr key={item.ticker}>
                      <td style={styles.td}><strong>{item.ticker}</strong></td>
                      <td style={styles.td}>{item.status === "fetching" ? "Fetching Yahoo API..." : item.status === "pending" ? "Waiting" : item.status === "failed" ? "Failed" : "Fetched"}</td>
                      <td style={styles.td}>{item.status === "saving" ? "Saving..." : item.status === "saved" ? "Saved" : item.status === "failed" ? "Failed" : "—"}</td>
                      <td style={styles.tdRight}>{item.chainCount ?? "—"}</td>
                      <td style={styles.tdRight}>{item.rowCount ?? "—"}</td>
                      <td style={styles.td}>{item.snapshotDate ?? "—"}</td>
                      <td style={styles.td}>{item.message ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {forecastHarvestResult?.items?.length ? (
                <table style={styles.harvestTable}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Ticker</th>
                      <th style={styles.th}>Surface</th>
                      <th style={styles.th}>Forecast</th>
                      <th style={styles.th}>Save</th>
                      <th style={styles.th}>Expiration</th>
                      <th style={styles.thRight}>Rows</th>
                      <th style={styles.th}>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecastHarvestResult.items.map((item) => (
                      <tr key={`${item.symbol}-${item.expiration ?? "forecast"}`}>
                        <td style={styles.td}><strong>{item.symbol}</strong></td>
                        <td style={styles.td}>{item.surfaceStatus ?? "—"}</td>
                        <td style={styles.td}>{item.forecastStatus ?? item.status}</td>
                        <td style={styles.td}>{item.saveStatus ?? "—"}</td>
                        <td style={styles.td}>{item.expiration ?? "—"}</td>
                        <td style={styles.tdRight}>{item.rowCount ?? "—"}</td>
                        <td style={styles.td}>{item.message ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          ) : null}
        </section>

        <section style={styles.newsPanel}>
          <div style={styles.newsHeader}>
            <div>
              <strong>News Pulse</strong>
              <span>Ticker-scoped headlines from the locked universe. 24h pulse + latest cached headlines help explain forecast divergence.</span>
            </div>
            <div style={styles.newsHeaderActions}>
              <span>{newsHarvesting ? "Harvesting live news..." : newsLoading ? "Refreshing cache..." : newsStatus}</span>
              <button
                type="button"
                onClick={() => loadDashboardNewsPulse(centralSymbols)}
                disabled={newsLoading || newsHarvesting || !centralSymbols.length}
                style={styles.newsButton}
              >
                Refresh Cache
              </button>
              <button
                type="button"
                onClick={runDashboardNewsHarvest}
                disabled={newsLoading || newsHarvesting || !centralSymbols.length}
                style={{ ...styles.newsButton, borderColor: colors.green, color: colors.green }}
              >
                Run News Harvest
              </button>
              <a href="/news" style={styles.newsButton}>Open News</a>
            </div>
          </div>

          <div style={styles.newsSummaryGrid}>
            <div style={styles.newsStatCard}><span>Quiet</span><strong>{newsQuiet}</strong></div>
            <div style={styles.newsStatCard}><span>Active</span><strong style={{ color: colors.cyan }}>{newsActive}</strong></div>
            <div style={styles.newsStatCard}><span>Elevated</span><strong style={{ color: colors.amber }}>{newsElevated}</strong></div>
            <div style={styles.newsStatCard}><span>Shock Risk</span><strong style={{ color: colors.red }}>{newsShock}</strong></div>
          </div>

          {centralSymbols.length ? (
            <div style={styles.newsTableWrap}>
              <div style={styles.newsTableHeader}>
                <span>Ticker</span>
                <span>Pulse</span>
                <span>24h</span>
                <span>Materiality</span>
                <span>Sentiment</span>
                <span>Forecast impact</span>
                <span>Latest headline</span>
                <span>Age</span>
                <span>Open</span>
              </div>

              {newsRows.map((pulse) => (
                <div key={pulse.symbol} style={styles.newsPulseRow}>
                  <strong style={styles.newsTicker}>{pulse.symbol}</strong>
                  <span style={{ ...styles.newsStatusPill, color: newsPulseColor(pulse.status), borderColor: newsPulseColor(pulse.status) }}>
                    {newsPulseLabel(pulse.status)}
                  </span>
                  <span>{safeInt(pulse.count24h, "0")}</span>
                  <span>{safeInt(pulse.materiality, "0")}</span>
                  <span>{pulse.sentiment === null ? "—" : pulse.sentiment > 0 ? `+${pulse.sentiment}` : pulse.sentiment}</span>
                  <span>{newsImpactLabel(pulse.forecastImpact)}</span>
                  <span style={styles.newsHeadline}>{pulse.latestHeadline ?? "No recent material ticker news detected."}</span>
                  <span>{formatNewsAge(pulse.latestPublishedAt)}</span>
                  <span style={styles.newsActions}>
                    <a href={`/news?symbol=${encodeURIComponent(pulse.symbol)}`} style={styles.inlineAction}>News</a>
                    <a href={`/control-center/chart?ticker=${encodeURIComponent(pulse.symbol)}`} style={styles.inlineAction}>Chart</a>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div style={styles.emptyNewsState}>
              No locked ticker slots yet. Add tickers in the Dashboard Command Hub to activate ticker-scoped News Pulse.
            </div>
          )}
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
  commandHub: {
    border: "1px solid rgba(38, 230, 255, 0.25)",
    background: "linear-gradient(135deg, rgba(8, 34, 53, 0.94), rgba(5, 13, 24, 0.96))",
    borderRadius: 18,
    padding: "1rem",
    display: "grid",
    gap: "0.95rem",
    boxShadow: "0 20px 60px rgba(0,0,0,0.22)",
  },
  commandHeader: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(140px, 220px)",
    gap: "1rem",
    alignItems: "center",
  },
  commandTitle: {
    color: colors.text,
    margin: "0.25rem 0 0",
    fontSize: 28,
    letterSpacing: "-0.04em",
  },
  commandSubtitle: {
    color: colors.muted,
    margin: "0.45rem 0 0",
    lineHeight: 1.45,
    fontSize: 13,
  },
  commandStatusBox: {
    border: `1px solid ${colors.border}`,
    borderRadius: 14,
    background: "rgba(2, 11, 20, 0.55)",
    padding: "0.75rem",
    display: "grid",
    gap: 3,
    textAlign: "center",
    color: colors.muted,
  },
  commandStats: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
    gap: "0.65rem",
  },
  commandStat: {
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: 12,
    background: "rgba(2, 11, 20, 0.45)",
    padding: "0.65rem",
    display: "grid",
    gap: 4,
  },
  commandControls: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
    gap: "0.7rem",
    alignItems: "end",
  },
  commandMessage: {
    border: `1px solid ${colors.borderSoft}`,
    background: "rgba(2, 11, 20, 0.45)",
    borderRadius: 12,
    color: colors.muted,
    padding: "0.65rem 0.75rem",
    fontSize: 13,
    lineHeight: 1.4,
  },
  commandTop: {
    border: "1px solid rgba(38, 230, 255, 0.3)",
    background: "rgba(13, 58, 73, 0.32)",
    borderRadius: 14,
    padding: "0.85rem",
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: "0.8rem",
    alignItems: "center",
  },
  commandTopTitle: {
    margin: "0.25rem 0 0",
    color: colors.text,
    fontSize: 20,
    letterSpacing: "-0.03em",
  },
  commandTopActions: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  centralSlotGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
    gap: "0.75rem",
  },
  centralSlotCard: {
    border: `1px solid ${colors.border}`,
    borderRadius: 14,
    background: "rgba(7, 21, 35, 0.78)",
    padding: "0.75rem",
    minHeight: 172,
    display: "grid",
    gap: "0.45rem",
  },
  centralSlotTop: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, color: colors.text },
  centralSlotName: { color: colors.muted, minHeight: 18 },
  centralForecastGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "0.45rem",
    color: colors.muted,
    fontSize: 12,
  },
  centralSlotFoot: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    color: colors.muted2,
    fontSize: 12,
    borderTop: `1px solid ${colors.borderSoft}`,
    paddingTop: "0.45rem",
  },
  centralSlotActions: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" },
  inlineAction: { color: colors.cyan, textDecoration: "none", fontWeight: 900, fontSize: 12 },
  textButton: {
    border: "none",
    background: "transparent",
    color: colors.red,
    fontWeight: 900,
    cursor: "pointer",
    padding: 0,
    fontSize: 12,
  },
  emptyCentral: {
    border: `1px dashed ${colors.border}`,
    borderRadius: 14,
    padding: "1rem",
    color: colors.muted,
    background: "rgba(2, 11, 20, 0.45)",
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
    border: `1px solid ${colors.border}`,
    borderRadius: 10,
    overflow: "hidden",
  },
  newsHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "1rem",
    background: "#0f2433",
    color: "#fff",
    padding: "0.55rem 0.65rem",
    borderBottom: `1px solid ${colors.borderSoft}`,
  },
  newsHeaderActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: 8,
    color: colors.muted,
    fontSize: 12,
  },
  newsButton: {
    border: `1px solid ${colors.cyan}`,
    background: "#0b3442",
    color: colors.cyan,
    padding: "0.42rem 0.6rem",
    borderRadius: 7,
    fontWeight: 900,
    cursor: "pointer",
    textDecoration: "none",
  },
  newsSummaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 160px), 1fr))",
    gap: 8,
    padding: "0.65rem",
    borderBottom: `1px solid ${colors.borderSoft}`,
  },
  newsStatCard: {
    display: "grid",
    gap: 4,
    background: "#07111b",
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: 8,
    padding: "0.55rem 0.65rem",
    color: colors.muted,
    fontSize: 12,
    fontWeight: 800,
  },
  newsTableWrap: {
    padding: "0.4rem 0.65rem 0.65rem",
    overflowX: "auto",
  },
  newsTableHeader: {
    minWidth: 1180,
    display: "grid",
    gridTemplateColumns: "0.6fr 0.9fr 0.45fr 0.75fr 0.75fr 1fr 2.4fr 0.7fr 0.7fr",
    gap: 8,
    color: colors.muted,
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    borderBottom: `1px solid ${colors.borderSoft}`,
    padding: "0.45rem 0.25rem",
  },
  newsPulseRow: {
    minWidth: 1180,
    display: "grid",
    gridTemplateColumns: "0.6fr 0.9fr 0.45fr 0.75fr 0.75fr 1fr 2.4fr 0.7fr 0.7fr",
    gap: 8,
    alignItems: "center",
    color: colors.text,
    borderBottom: `1px solid ${colors.borderSoft}`,
    padding: "0.5rem 0.25rem",
    fontSize: 12,
  },
  newsTicker: {
    color: colors.text,
    fontWeight: 950,
  },
  newsStatusPill: {
    display: "inline-flex",
    width: "fit-content",
    border: `1px solid ${colors.border}`,
    borderRadius: 999,
    padding: "0.16rem 0.45rem",
    fontSize: 11,
    fontWeight: 900,
  },
  newsHeadline: {
    color: colors.muted,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  newsActions: {
    display: "inline-flex",
    gap: 8,
    alignItems: "center",
  },
  emptyNewsState: {
    padding: "0.85rem",
    color: colors.muted,
    fontSize: 13,
  },
}; 
