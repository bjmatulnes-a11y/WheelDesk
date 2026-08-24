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
import {
  AUTO_SURFACE_CAPTURE_EVENT,
  expectedSurfaceDate,
  readAutomaticSurfaceCaptureStatus,
  runAutomaticSurfaceCapture,
  type AutomaticSurfaceCaptureStatus,
} from "../../lib/automatic-surface-capture";

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
  base_exp?: number | string | null;
  upper_exp?: number | string | null;
  lower_exp?: number | string | null;
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

type SchwabConnectionStatus = {
  ok?: boolean;
  connected: boolean;
  accessExpiresAt?: string | null;
  refreshExpiresAt?: string | null;
  updatedAt?: string | null;
  error?: string;
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

function forecastFieldLabel(forecast?: ForecastDbRow | null): string {
  const exp = dateOnly(forecast?.expiration);
  const hasExpBand = toNumber(forecast?.lower_exp) != null && toNumber(forecast?.upper_exp) != null;
  return exp && hasExpBand ? `${exp} / EXP` : "30D";
}

function forecastFieldLower(forecast?: ForecastDbRow | null): number | null {
  const exp = dateOnly(forecast?.expiration);
  const expLower = toNumber(forecast?.lower_exp);
  return exp && expLower != null ? expLower : toNumber(forecast?.lower_30d);
}

function forecastFieldUpper(forecast?: ForecastDbRow | null): number | null {
  const exp = dateOnly(forecast?.expiration);
  const expUpper = toNumber(forecast?.upper_exp);
  return exp && expUpper != null ? expUpper : toNumber(forecast?.upper_30d);
}

function forecastFieldBase(forecast?: ForecastDbRow | null): number | null {
  const exp = dateOnly(forecast?.expiration);
  const expBase = toNumber(forecast?.base_exp);
  return exp && expBase != null ? expBase : toNumber(forecast?.base_30d);
}

function forecastFieldBaseLabel(forecast?: ForecastDbRow | null): string {
  const base = forecastFieldBase(forecast);
  return base != null ? safeMoney(base) : "—";
}

function forecastFieldRangeLabel(forecast?: ForecastDbRow | null): string {
  const lower = forecastFieldLower(forecast);
  const upper = forecastFieldUpper(forecast);
  return lower != null && upper != null ? `${safeMoney(lower)} – ${safeMoney(upper)}` : "—";
}

function extractSurfaceArray(payload: any): any[] {
  const candidates = [payload?.snapshots, payload?.surfaces, payload?.data, payload?.items, payload?.surfaceSnapshots];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return payload?.snapshot || payload?.surface ? [payload.snapshot ?? payload.surface] : [];
}

function normalizeSurfaceTicker(surface: any): string {
  return normalizeTickerInput(surface?.ticker ?? surface?.symbol ?? surface?.underlyingSymbol ?? surface?.metadata?.originalSnapshot?.ticker);
}

function surfaceRowCount(surface: any): number {
  const chains = Array.isArray(surface?.chains) ? surface.chains : Array.isArray(surface?.optionChains) ? surface.optionChains : [];
  const rowCount = chains.reduce((sum: number, chain: any) => {
    const rows = Array.isArray(chain?.rows) ? chain.rows : Array.isArray(chain?.chainRows) ? chain.chainRows : [];
    const calls = Array.isArray(chain?.calls) ? chain.calls : [];
    const puts = Array.isArray(chain?.puts) ? chain.puts : [];
    return sum + Math.max(rows.length, calls.length + puts.length);
  }, 0);

  return Number(surface?.rowCount ?? surface?.row_count ?? surface?.chainRowCount ?? surface?.chain_row_count ?? rowCount ?? 0);
}

function surfaceChainCount(surface: any): number {
  const chains = Array.isArray(surface?.chains) ? surface.chains : Array.isArray(surface?.optionChains) ? surface.optionChains : [];
  return Number(surface?.chainCount ?? surface?.chain_count ?? chains.length ?? 0);
}

function surfaceMeta(payload: any): Pick<CentralCommandRow, "surfaceDate" | "surfaceRows" | "surfaceChains"> {
  const surfaces = extractSurfaceArray(payload);
  const latest = surfaces
    .map((surface) => ({
      surfaceDate: dateOnly(surface?.snapshotDate ?? surface?.snapshot_date ?? surface?.date ?? surface?.asOfDate),
      surfaceRows: surfaceRowCount(surface),
      surfaceChains: surfaceChainCount(surface),
    }))
    .filter((item) => item.surfaceDate)
    .sort((a, b) => b.surfaceDate.localeCompare(a.surfaceDate))[0];

  return latest ?? { surfaceDate: null, surfaceRows: null, surfaceChains: null };
}

async function fetchAllSurfaceMetaMap(symbols: string[]): Promise<Map<string, Pick<CentralCommandRow, "surfaceDate" | "surfaceRows" | "surfaceChains">>> {
  const wanted = new Set(symbols.map(normalizeTickerInput).filter(Boolean));
  const map = new Map<string, Pick<CentralCommandRow, "surfaceDate" | "surfaceRows" | "surfaceChains">>();

  if (!wanted.size) return map;

  try {
    const response = await fetch(`/api/supabase/surface-snapshot?mode=list&limit=500`, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) return map;

    for (const surface of extractSurfaceArray(payload)) {
      const symbol = normalizeSurfaceTicker(surface);
      if (!wanted.has(symbol)) continue;

      const meta = surfaceMeta({ snapshots: [surface] });
      const current = map.get(symbol);
      if (!current?.surfaceDate || (meta.surfaceDate && meta.surfaceDate >= current.surfaceDate)) {
        map.set(symbol, meta);
      }
    }
  } catch {
    // Fall back to per-symbol reads below.
  }

  return map;
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
    // Dashboard readiness only needs the latest snapshot date. Do not hydrate
    // hundreds/thousands of option_chain_rows just to decide whether a ticker
    // is current. The full surface remains available to Chart Room/research.
    const response = await fetch(
      `/api/supabase/surface-snapshot?ticker=${encodeURIComponent(symbol)}&latest=1&metadata=1`,
      { cache: "no-store" },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) return { surfaceDate: null, surfaceRows: null, surfaceChains: null };
    const metadata = payload?.metadata;
    return {
      surfaceDate: dateOnly(metadata?.snapshotDate ?? metadata?.snapshot_date),
      surfaceRows: null,
      surfaceChains: null,
    };
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
  if (row.status === "ready") return "Forecast current";
  if (row.status === "surface-only") return "Surface current";
  return "Surface updating";
}

function commandStatusColor(row: CentralCommandRow): string {
  if (row.status === "ready") return colors.green;
  if (row.status === "surface-only") return colors.amber;
  return colors.red;
}

function displayPlanName(plan?: string | null): string {
  if (plan === "research") return "Command";
  if (plan === "core") return "WheelDesk";
  if (plan === "founder") return "Founder · Legacy";
  return plan ? plan : "WheelDesk";
}

function marketSessionLabel(now = new Date()): { label: string; color: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const minutes = hour * 60 + minute;
  const weekdayOpen = !["Sat", "Sun"].includes(weekday);

  if (weekdayOpen && minutes >= 9 * 60 + 30 && minutes < 16 * 60) {
    return { label: "OPEN", color: colors.green };
  }
  if (weekdayOpen && minutes >= 4 * 60 && minutes < 9 * 60 + 30) {
    return { label: "PREMARKET", color: colors.amber };
  }
  if (weekdayOpen && minutes >= 16 * 60 && minutes < 20 * 60) {
    return { label: "AFTER HOURS", color: colors.amber };
  }
  return { label: "CLOSED", color: colors.muted };
}

function newsPulseForSymbol(rows: DashboardNewsPulse[], symbol: string): DashboardNewsPulse | null {
  return rows.find((row) => row.symbol === symbol) ?? null;
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
  const [portfolioUpdatedAt, setPortfolioUpdatedAt] = useState<string | null>(null);
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
  const [autoSurfaceStatus, setAutoSurfaceStatus] = useState<AutomaticSurfaceCaptureStatus | null>(null);
  const [schwabConnection, setSchwabConnection] = useState<SchwabConnectionStatus | null>(null);
  const [clockTick, setClockTick] = useState(0);

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

    const refreshPortfolio = () => {
      try {
        const next = listPortfolioProfiles() as any[];
        setProfiles(next);
        const latest = next.reduce((value, profile) => {
          const stamp = typeof profile?.updatedAt === "string" ? profile.updatedAt : null;
          return stamp && (!value || stamp > value) ? stamp : value;
        }, null as string | null);
        setPortfolioUpdatedAt(latest ?? new Date().toISOString());
      } catch {
        setProfiles([]);
        setPortfolioUpdatedAt(null);
      }
    };

    refreshPortfolio();
    const onVisible = () => { if (document.visibilityState === "visible") refreshPortfolio(); };
    window.addEventListener("focus", refreshPortfolio);
    window.addEventListener("storage", refreshPortfolio);
    window.addEventListener("wheeldesk:portfolio-updated", refreshPortfolio as EventListener);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.removeEventListener("focus", refreshPortfolio);
      window.removeEventListener("storage", refreshPortfolio);
      window.removeEventListener("wheeldesk:portfolio-updated", refreshPortfolio as EventListener);
      document.removeEventListener("visibilitychange", onVisible);
    };
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

  useEffect(() => {
    setAutoSurfaceStatus(readAutomaticSurfaceCaptureStatus());

    const handleAutoSurface = (event: Event) => {
      const detail = (event as CustomEvent<AutomaticSurfaceCaptureStatus>).detail;
      if (!detail) return;
      setAutoSurfaceStatus(detail);

      if (detail.phase === "complete" || detail.phase === "delayed") {
        void refreshCentralCommandHub();
      }
    };

    window.addEventListener(AUTO_SURFACE_CAPTURE_EVENT, handleAutoSurface as EventListener);

    const clock = window.setInterval(() => setClockTick((value) => value + 1), 60_000);

    void getDashboardAuthHeaders()
      .then((headers) => fetch("/api/brokers/schwab/status", { headers, cache: "no-store" }))
      .then((response) => response.json())
      .then((payload) => setSchwabConnection(payload as SchwabConnectionStatus))
      .catch(() => setSchwabConnection({ connected: false, error: "Status unavailable" }));

    return () => {
      window.removeEventListener(AUTO_SURFACE_CAPTURE_EVENT, handleAutoSurface as EventListener);
      window.clearInterval(clock);
    };
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
        setCentralStatus("No tracked markets yet. Add a ticker from the WheelDesk universe.");
        setCentralLoadedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
        await loadDashboardNewsPulse([]);
        return;
      }

      // Read the same per-ticker latest surface endpoint used by Control Center / Chart Room.
      // The earlier bulk mode=list shortcut could miss tickers depending on row limits and
      // created the confusing dashboard state where Chart Room had a surface but Dashboard
      // showed none.
      const pairs = await Promise.all(symbols.map(async (symbol) => {
        const slot = slots.find((item) => normalizeTickerInput(item.symbol) === symbol);
        const forecast = await fetchLatestForecast(symbol);
        const meta = await fetchLatestSurfaceMeta(symbol);

        const targetSurfaceDate = expectedSurfaceDate();
        const surfaceCurrent = Boolean(meta.surfaceDate && meta.surfaceDate >= targetSurfaceDate);
        const forecastDate = dateOnly(forecast?.snapshot_date ?? forecast?.generated_at);
        const forecastCurrent = Boolean(forecast && meta.surfaceDate && forecastDate && forecastDate >= meta.surfaceDate);

        // Dashboard readiness is surface-first. A stale surface or an orphaned forecast
        // cannot make a tracked market look current. Automatic capture will refresh
        // stale surfaces in the background while the authenticated session is active.
        const status: CentralCommandRow["status"] = surfaceCurrent
          ? (forecastCurrent ? "ready" : "surface-only")
          : "needs-harvest";

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
      setCentralStatus(`Loaded ${symbols.length} tracked market${symbols.length === 1 ? "" : "s"}. Surface capture runs automatically while your WheelDesk session is active.`);
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

      const { data } = await getSupabaseAuthClient().auth.getSession();
      if (data.session) {
        void runAutomaticSurfaceCapture({
          accessToken: data.session.access_token,
          userId: data.session.user.id,
          force: true,
        });
      }
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
  const marketSession = useMemo(() => marketSessionLabel(), [clockTick]);
  const planName = displayPlanName(centralEntitlement?.plan);
  const currentMarkets = centralReady + centralSurfaceOnly;
  const newsAttention = newsElevated + newsShock;
  const topNews = [...newsPulses].sort((a, b) => newsPulseRank(b) - newsPulseRank(a))[0] ?? null;
  const hasCommandAccess = centralEntitlement?.plan !== "core";

  const dataStatus = (() => {
    if (autoSurfaceStatus?.phase === "capturing" || autoSurfaceStatus?.phase === "checking") {
      return { label: "UPDATING", color: colors.amber };
    }
    if (autoSurfaceStatus?.phase === "delayed") {
      return { label: "DELAYED", color: colors.red };
    }
    if (centralNeedsHarvest > 0) {
      return { label: "SYNCING", color: colors.amber };
    }
    return { label: "CURRENT", color: colors.green };
  })();

  return (
    <AuthGate>
      <div className="wheeldesk-shell" style={styles.app}>
        <WheelDeskSideNav active="dashboard" />

        <main className="wheeldesk-page" style={styles.main}>
          <header style={styles.header}>
            <div>
              <div style={styles.eyebrow}>WHEELDESK · {planName}</div>
              <h1 style={styles.title}>Dashboard</h1>
            </div>

            <div style={styles.statusStrip}>
              <div style={styles.statusPill}>
                <span style={styles.statusKey}>MARKET</span>
                <strong style={{ ...styles.statusValue, color: marketSession.color }}>{marketSession.label}</strong>
              </div>
              <div style={styles.statusPill}>
                <span style={styles.statusKey}>DATA</span>
                <strong style={{ ...styles.statusValue, color: dataStatus.color }}>{dataStatus.label}</strong>
              </div>
              <div style={styles.statusPill}>
                <span style={styles.statusKey}>COMMAND DATA</span>
                <strong style={{ ...styles.statusValue, color: schwabConnection?.connected ? colors.green : colors.amber }}>
                  {schwabConnection?.connected ? "SCHWAB" : schwabConnection ? "OFFLINE" : "CHECKING"}
                </strong>
              </div>
            </div>
          </header>

          <section style={styles.overviewSection}>
            <div style={styles.sectionHeader}>
              <div>
                <div style={styles.eyebrow}>Desk overview</div>
                <h2 style={styles.sectionTitle}>What deserves attention now</h2>
              </div>
              <span style={styles.sectionHint}>
                {centralLoadedAt ? `Updated ${centralLoadedAt}` : "Loading desk state…"}
              </span>
            </div>

            <div style={styles.overviewGrid}>
              <a href={hasCommandAccess ? "/zero-dte/chart" : "/pricing"} style={styles.overviewCard}>
                <div style={styles.cardEyebrow}>0DTE COMMAND</div>
                <div style={styles.cardMetric}>SPX</div>
                <div style={styles.cardTitle}>{hasCommandAccess ? "Session intelligence" : "Command access"}</div>
                <div style={styles.cardCopy}>
                  {hasCommandAccess
                    ? "Open the live structure, readiness, premium and execution desk."
                    : "WheelDesk Command is the active intraday decision layer."}
                </div>
                <span style={styles.cardLink}>{hasCommandAccess ? "Open Command →" : "View Command →"}</span>
              </a>

              <a href="/portfolio" style={styles.overviewCard}>
                <div style={styles.cardEyebrow}>PORTFOLIO</div>
                <div style={styles.cardMetric}>{safeInt(totals.positions, "0")}</div>
                <div style={styles.cardTitle}>Open positions</div>
                <div style={styles.cardCopy}>
                  Day P/L {safeMoney(totals.dayPnL)} · Theta {safeFixed(totals.theta, 2, "0.00")}
                </div>
                <span style={styles.cardLink}>Open Portfolio →</span>
              </a>

              <a href="/watchlist" style={styles.overviewCard}>
                <div style={styles.cardEyebrow}>TRACKED MARKETS</div>
                <div style={styles.cardMetric}>{safeInt(centralUsedSlots, "0")}</div>
                <div style={styles.cardTitle}>{currentMarkets} current · {centralNeedsHarvest} syncing</div>
                <div style={styles.cardCopy}>
                  Surface capture stays current automatically while your WheelDesk session is active.
                </div>
                <span style={styles.cardLink}>Open Watchlist →</span>
              </a>

              <a href="/news" style={styles.overviewCard}>
                <div style={styles.cardEyebrow}>NEWS RISK</div>
                <div style={{ ...styles.cardMetric, color: newsAttention ? colors.amber : colors.green }}>{newsAttention}</div>
                <div style={styles.cardTitle}>{newsAttention ? "Elevated / shock" : "No elevated risk"}</div>
                <div style={styles.cardCopy}>
                  {topNews?.latestHeadline ?? `${newsQuiet} quiet · ${newsActive} active across tracked markets.`}
                </div>
                <span style={styles.cardLink}>Open News →</span>
              </a>
            </div>
          </section>

          <div style={styles.twoColGrid}>
            <section style={styles.panelCard}>
              <div style={styles.panelHeader}>
                <div>
                  <div style={styles.eyebrow}>Portfolio</div>
                  <h2 style={styles.panelTitle}>Risk snapshot</h2>
                </div>
                <a href="/portfolio" style={styles.panelLink}>Full portfolio →</a>
              </div>

              <div style={styles.metricGrid}>
                <div style={styles.metric}><span style={styles.metricLabel}>Open P/L</span><strong style={styles.metricValue}>{safeMoney(totals.openPnL)}</strong></div>
                <div style={styles.metric}><span style={styles.metricLabel}>Day P/L</span><strong style={styles.metricValue}>{safeMoney(totals.dayPnL)}</strong></div>
                <div style={styles.metric}><span style={styles.metricLabel}>Delta</span><strong style={styles.metricValue}>{safeFixed(totals.delta, 2, "0.00")}</strong></div>
                <div style={styles.metric}><span style={styles.metricLabel}>Theta</span><strong style={styles.metricValue}>{safeFixed(totals.theta, 2, "0.00")}</strong></div>
                <div style={styles.metric}><span style={styles.metricLabel}>Short calls</span><strong style={styles.metricValue}>{safeInt(totals.shortCalls, "0")}</strong></div>
                <div style={styles.metric}><span style={styles.metricLabel}>Short puts</span><strong style={styles.metricValue}>{safeInt(totals.shortPuts, "0")}</strong></div>
              </div>

              <div style={styles.panelFootnote}>
                {portfolioUpdatedAt ? `Portfolio saved ${new Date(portfolioUpdatedAt).toLocaleString()}` : "No saved portfolio positions yet."}
              </div>
            </section>

            <section style={styles.panelCard}>
              <div style={styles.panelHeader}>
                <div>
                  <div style={styles.eyebrow}>Connections</div>
                  <h2 style={styles.panelTitle}>Data & trading</h2>
                </div>
              </div>

              <div style={styles.connectionList}>
                <div style={styles.connectionRow}>
                  <div style={styles.connectionIdentity}>
                    <span style={{ ...styles.connectionDot, background: dataStatus.color }} />
                    <div>
                      <div style={styles.connectionName}>WheelDesk surface feed</div>
                      <div style={styles.connectionMeta}>Yahoo option surfaces · automatic tracked-market capture</div>
                    </div>
                  </div>
                  <strong style={{ ...styles.connectionState, color: dataStatus.color }}>{dataStatus.label}</strong>
                </div>

                <div style={styles.connectionRow}>
                  <div style={styles.connectionIdentity}>
                    <span style={{ ...styles.connectionDot, background: schwabConnection?.connected ? colors.green : colors.amber }} />
                    <div>
                      <div style={styles.connectionName}>Schwab Trader API</div>
                      <div style={styles.connectionMeta}>SPX Command feed · live options and price history</div>
                    </div>
                  </div>
                  <strong style={{ ...styles.connectionState, color: schwabConnection?.connected ? colors.green : colors.amber }}>
                    {schwabConnection?.connected ? "Connected" : schwabConnection ? "Needs attention" : "Checking"}
                  </strong>
                </div>

                <div style={styles.connectionRow}>
                  <div style={styles.connectionIdentity}>
                    <span style={{ ...styles.connectionDot, background: colors.muted2 }} />
                    <div>
                      <div style={styles.connectionName}>Trading account</div>
                      <div style={styles.connectionMeta}>Personal Schwab / E*TRADE / other broker adapters</div>
                    </div>
                  </div>
                  <strong style={{ ...styles.connectionState, color: colors.muted }}>Not linked</strong>
                </div>
              </div>

              <div style={styles.panelFootnote}>
                Schwab authorization is stored per WheelDesk user. Each account uses its own broker token/session; high-frequency 0DTE reads reuse the server-side session instead of re-reading credentials from Supabase every tick.
              </div>
            </section>
          </div>

          <section style={styles.trackedPanel}>
            <div style={styles.trackedHeader}>
              <div>
                <div style={styles.eyebrow}>Tracked markets</div>
                <h2 style={styles.panelTitle}>Your WheelDesk universe</h2>
                <p style={styles.commandSubtitle}>
                  Symbols evaluated across Watchlist, Control Center, Validation and research. Surface acquisition is automatic.
                </p>
              </div>
              <div style={styles.trackedCount}>
                <strong>{centralUsedSlots}</strong>
                <span>/ {centralMaxSlots || "?"} tracked</span>
              </div>
            </div>

            <div style={styles.trackedControls}>
              <label style={styles.label}>
                Add market
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
                  placeholder="SOFI, AMD, NVDA…"
                  style={styles.input}
                  list="dashboard-central-universe"
                />
                <datalist id="dashboard-central-universe">
                  {centralUniverse.map((ticker) => (
                    <option key={ticker.symbol} value={ticker.symbol}>{ticker.name ?? ticker.symbol}</option>
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
                {centralSaving ? "Saving…" : "Add market"}
              </button>
            </div>

            <div style={styles.trackedStatusRow}>
              <span>{centralStatus}</span>
              <span>{centralReplacementsLeft} replacements left today</span>
            </div>

            <div style={styles.trackedTableWrap}>
              <table style={styles.trackedTable}>
                <thead>
                  <tr>
                    <th style={styles.th}>Market</th>
                    <th style={styles.th}>Surface</th>
                    <th style={styles.th}>Forecast</th>
                    <th style={styles.th}>News</th>
                    <th style={styles.th}>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {centralRows.length ? centralRows.map((row) => {
                    const pulse = newsPulseForSymbol(newsRows, row.symbol);
                    return (
                      <tr key={row.symbol}>
                        <td style={styles.td}>
                          <strong>{row.symbol}</strong>
                          <div style={styles.centralSlotName}>{row.name ?? row.assetType ?? "WheelDesk market"}</div>
                        </td>
                        <td style={styles.td}>
                          <strong style={{ color: row.status === "needs-harvest" ? colors.amber : colors.green }}>
                            {row.status === "needs-harvest" ? "Updating" : "Current"}
                          </strong>
                          <div style={styles.centralSlotName}>{row.surfaceDate ?? `Target ${expectedSurfaceDate()}`}</div>
                        </td>
                        <td style={styles.td}>
                          <strong style={{ color: commandStatusColor(row) }}>{commandStatus(row)}</strong>
                          <div style={styles.centralSlotName}>
                            {row.forecast && row.status === "ready" ? `${row.forecast.bias ?? "N/A"} · ${formatPercent(row.forecast.confidence)}` : "—"}
                          </div>
                        </td>
                        <td style={styles.td}>
                          <span style={{ ...styles.newsStatusPill, color: pulse ? newsPulseColor(pulse.status) : colors.muted, borderColor: pulse ? newsPulseColor(pulse.status) : colors.border }}>
                            {pulse ? newsPulseLabel(pulse.status) : "Quiet"}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <div style={styles.rowActions}>
                            <a href={`/control-center?ticker=${encodeURIComponent(row.symbol)}`} style={styles.inlineAction}>Control</a>
                            <a href={`/control-center/chart?ticker=${encodeURIComponent(row.symbol)}`} style={styles.inlineAction}>Chart</a>
                            <button type="button" onClick={() => removeCentralTicker(row.symbol)} style={styles.textButton} disabled={centralSaving}>Remove</button>
                          </div>
                        </td>
                      </tr>
                    );
                  }) : (
                    <tr>
                      <td style={styles.td} colSpan={5}>No tracked markets yet. Add a symbol above to begin.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section style={styles.dataNote}>
            <div style={styles.dataNoteTop}>
              <div>
                <div style={styles.eyebrow}>Data operations</div>
                <strong>Automatic surface capture</strong>
              </div>
              <span style={{ ...styles.automaticBadge, color: dataStatus.color, borderColor: dataStatus.color }}>{dataStatus.label}</span>
            </div>
            <p style={styles.commandSubtitle}>
              {autoSurfaceStatus?.message ?? "WheelDesk checks tracked-market freshness after authenticated access and captures missing surfaces automatically."}
            </p>
            <p style={styles.panelFootnote}>
              Surface capture no longer requires a user action. Forecast generation remains a separate model event until its premarket / midday / close schedule is finalized.
            </p>
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
  statusStrip: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    flexWrap: "wrap",
  },
  statusPill: {
    display: "grid",
    gap: 2,
    minWidth: 88,
    padding: "0.38rem 0.55rem",
    border: `1px solid ${colors.border}`,
    borderRadius: 8,
    background: "rgba(3, 12, 21, 0.6)",
  },
  statusKey: { color: colors.muted2, fontSize: 9, fontWeight: 900, letterSpacing: 0.8 },
  statusValue: { fontSize: 11, fontWeight: 950, letterSpacing: 0.25 },
  overviewSection: {
    marginTop: "1rem",
    border: `1px solid ${colors.border}`,
    borderRadius: 16,
    background: "linear-gradient(135deg, rgba(8, 26, 42, 0.94), rgba(5, 13, 24, 0.96))",
    padding: "1rem",
  },
  sectionHeader: { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "end", marginBottom: "0.8rem" },
  sectionTitle: { margin: "0.2rem 0 0", fontSize: 24, letterSpacing: "-0.04em" },
  sectionHint: { color: colors.muted, fontSize: 12 },
  overviewGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
    gap: 10,
  },
  overviewCard: {
    minHeight: 172,
    display: "flex",
    flexDirection: "column",
    gap: 5,
    padding: "0.9rem",
    border: `1px solid ${colors.borderSoft}`,
    borderRadius: 12,
    background: "rgba(5, 15, 25, 0.82)",
    color: colors.text,
    textDecoration: "none",
  },
  cardEyebrow: { color: colors.cyan, fontSize: 10, fontWeight: 950, letterSpacing: 1 },
  cardMetric: { marginTop: 4, fontSize: 30, lineHeight: 1, fontWeight: 950, letterSpacing: "-0.05em" },
  cardTitle: { color: colors.text, fontSize: 14, fontWeight: 900 },
  cardCopy: { color: colors.muted, fontSize: 12, lineHeight: 1.4, flex: 1, overflow: "hidden" },
  cardLink: { color: colors.cyan, fontSize: 12, fontWeight: 900, marginTop: 6 },
  twoColGrid: {
    marginTop: "0.8rem",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 390px), 1fr))",
    gap: 10,
  },
  panelCard: {
    border: `1px solid ${colors.border}`,
    borderRadius: 14,
    background: colors.panel2,
    padding: "0.9rem",
  },
  panelHeader: { display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12, marginBottom: "0.75rem" },
  panelTitle: { margin: "0.18rem 0 0", fontSize: 20, letterSpacing: "-0.035em" },
  panelLink: { color: colors.cyan, textDecoration: "none", fontWeight: 900, fontSize: 12 },
  metricGrid: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 },
  metric: { display: "grid", gap: 4, padding: "0.65rem", border: `1px solid ${colors.borderSoft}`, borderRadius: 9, background: colors.row },
  metricLabel: { color: colors.muted2, fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: 0.5 },
  metricValue: { color: colors.text, fontSize: 17, fontWeight: 950, fontVariantNumeric: "tabular-nums" },
  panelFootnote: { marginTop: "0.7rem", color: colors.muted2, fontSize: 11, lineHeight: 1.45 },
  connectionList: { display: "grid", gap: 8 },
  connectionRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "0.72rem", border: `1px solid ${colors.borderSoft}`, borderRadius: 9, background: colors.row },
  connectionIdentity: { display: "flex", alignItems: "center", gap: 10, minWidth: 0 },
  connectionDot: { width: 8, height: 8, borderRadius: 999, flex: "0 0 auto" },
  connectionName: { color: colors.text, fontWeight: 900, fontSize: 13 },
  connectionMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  connectionState: { fontSize: 11, fontWeight: 950, whiteSpace: "nowrap" },
  trackedPanel: { marginTop: "0.8rem", border: `1px solid ${colors.border}`, borderRadius: 14, background: colors.panel2, padding: "0.9rem" },
  trackedHeader: { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" },
  trackedCount: { display: "flex", gap: 4, alignItems: "baseline", color: colors.muted, whiteSpace: "nowrap" },
  trackedControls: { marginTop: "0.8rem", display: "grid", gridTemplateColumns: "minmax(180px, 1.3fr) minmax(150px, 0.8fr) auto", gap: 8, alignItems: "end" },
  trackedStatusRow: { marginTop: "0.65rem", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", color: colors.muted2, fontSize: 11 },
  trackedTableWrap: { marginTop: "0.65rem", overflowX: "auto", border: `1px solid ${colors.borderSoft}`, borderRadius: 9 },
  trackedTable: { width: "100%", minWidth: 760, borderCollapse: "collapse", fontSize: 12 },
  rowActions: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
  dataNote: { marginTop: "0.8rem", border: `1px solid ${colors.borderSoft}`, borderRadius: 12, background: "rgba(7, 17, 27, 0.72)", padding: "0.8rem" },
  dataNoteTop: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 },
  automaticBadge: { border: `1px solid ${colors.green}`, borderRadius: 999, padding: "0.18rem 0.5rem", fontSize: 10, fontWeight: 950, letterSpacing: 0.5 },
}; 
