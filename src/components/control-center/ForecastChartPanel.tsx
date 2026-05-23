"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  LineSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp
} from "lightweight-charts";
import { type CandleRecord } from "../../lib/wheeldesk-storage";
import { type IVSurfaceSummary } from "../../lib/iv-surface-engine";
import { type OIFieldForecastResult } from "../../lib/oi-field-engine-v2";
import { colors, cardStyle } from "./styles";

type ChartMode = "field-v2" | "classic" | "both" | "candles";
type ForecastAxisMode = "compact" | "full" | "expiration";

type ForecastChartPanelProps = {
  ticker: string;
  candles: CandleRecord[];
  edge?: any;
  edgeLabelMode?: "control" | "oi";
  path?: any;
  matrix?: any;
  ivSurface?: IVSurfaceSummary | null;
  flowOverlay?: any;
  fieldForecast?: OIFieldForecastResult | null;
  structureFocus?: boolean;
  isLoading?: boolean;
  chartHeight?: number;
  headerAction?: ReactNode;
  defaultChartMode?: ChartMode;
  defaultForecastAxisMode?: ForecastAxisMode;
  defaultForecastDivergence?: boolean;
  surfaceDate?: string | null;
  expiration?: string | null;
  captureSession?: string | null;
};

type LinePoint = { time?: unknown; date?: unknown; value?: unknown; price?: unknown; adjustedCenter?: unknown; expiration?: unknown };
type ChartLinePoint = { time: UTCTimestamp; value: number };

type CapturedForecastRow = {
  id?: string;
  symbol?: string;
  generated_at?: string;
  snapshot_date?: string;
  expiration?: string | null;
  spot?: number | string | null;
  source?: string | null;
  capture_session?: string | null;
  base_1d?: number | string | null;
  base_3d?: number | string | null;
  base_5d?: number | string | null;
  base_10d?: number | string | null;
  base_14d?: number | string | null;
  base_30d?: number | string | null;
  upper_1d?: number | string | null;
  upper_3d?: number | string | null;
  upper_5d?: number | string | null;
  upper_10d?: number | string | null;
  upper_14d?: number | string | null;
  upper_30d?: number | string | null;
  lower_1d?: number | string | null;
  lower_3d?: number | string | null;
  lower_5d?: number | string | null;
  lower_10d?: number | string | null;
  lower_14d?: number | string | null;
  lower_30d?: number | string | null;
};

type DivergenceReadout = {
  status: "pending" | "tracking" | "diverging_bullish" | "diverging_bearish" | "broken_upper" | "broken_lower" | "reverting";
  label: string;
  tone: string;
  actualClose: number | null;
  forecastBase: number | null;
  forecastUpper: number | null;
  forecastLower: number | null;
  divergence: number | null;
  divergencePct: number | null;
  normalizedDivergence: number | null;
  elapsedSessions: number | null;
};

type CandleSeriesData = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
};

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmt(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  return value.toFixed(2);
}

function pct(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${value.toFixed(1)}%`;
}

function dateToTime(value: unknown): UTCTimestamp | null {
  if (!value) return null;

  if (typeof value === "number") {
    const millis = value > 1_000_000_000_000 ? value : value * 1000;
    const t = Math.floor(millis / 1000);
    return Number.isFinite(t) ? (t as UTCTimestamp) : null;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const t = Math.floor(new Date(`${raw}T00:00:00Z`).getTime() / 1000);
    return Number.isFinite(t) ? (t as UTCTimestamp) : null;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;

  const t = Math.floor(parsed.getTime() / 1000);
  return Number.isFinite(t) ? (t as UTCTimestamp) : null;
}

function candleToTime(candle: CandleRecord): UTCTimestamp | null {
  return dateToTime(candle.date);
}

function normalizeCandles(candles: CandleRecord[]): CandleSeriesData[] {
  const byTime = new Map<number, CandleSeriesData>();

  for (const candle of candles ?? []) {
    const time = candleToTime(candle);
    const close = toNumber(candle.close);
    const open = toNumber(candle.open ?? candle.close);
    const high = toNumber(candle.high ?? candle.close);
    const low = toNumber(candle.low ?? candle.close);

    if (time == null || open == null || high == null || low == null || close == null) continue;

    byTime.set(Number(time), {
      time,
      open,
      high: Math.max(high, open, close),
      low: Math.min(low, open, close),
      close
    });
  }

  return Array.from(byTime.values()).sort((a, b) => Number(a.time) - Number(b.time));
}

function pointToTime(point: LinePoint): UTCTimestamp | null {
  return dateToTime(point.date ?? point.time ?? point.expiration);
}

function pointToValue(point: LinePoint): number | null {
  return toNumber(point.value ?? point.price ?? point.adjustedCenter);
}

function uniqueAscending(rows: ChartLinePoint[]): ChartLinePoint[] {
  const byTime = new Map<number, ChartLinePoint>();

  for (const row of rows) {
    const time = Number(row.time);
    const value = Number(row.value);
    if (!Number.isFinite(time) || !Number.isFinite(value)) continue;
    byTime.set(time, { time: time as UTCTimestamp, value });
  }

  return Array.from(byTime.values()).sort((a, b) => Number(a.time) - Number(b.time));
}

function makeAnchoredPath(points: LinePoint[] | undefined, lastTime: UTCTimestamp, lastClose: number): ChartLinePoint[] {
  if (!Array.isArray(points) || points.length === 0) return [];

  const futureRows: ChartLinePoint[] = [];

  for (const point of points) {
    const time = pointToTime(point);
    const value = pointToValue(point);
    if (time == null || value == null) continue;
    if (Number(time) <= Number(lastTime)) continue;
    futureRows.push({ time, value });
  }

  if (!futureRows.length) return [];

  return uniqueAscending([{ time: lastTime, value: lastClose }, ...futureRows]);
}

function makeStandalonePath(points: LinePoint[] | undefined, lastTime?: UTCTimestamp): ChartLinePoint[] {
  const rows: ChartLinePoint[] = [];

  for (const point of points ?? []) {
    const time = pointToTime(point);
    const value = pointToValue(point);
    if (time == null || value == null) continue;
    if (lastTime != null && Number(time) <= Number(lastTime)) continue;
    rows.push({ time, value });
  }

  return uniqueAscending(rows);
}

function addBusinessDays(baseTime: UTCTimestamp, businessDays: number): UTCTimestamp {
  const d = new Date(Number(baseTime) * 1000);
  let added = 0;
  while (added < businessDays) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return Math.floor(d.getTime() / 1000) as UTCTimestamp;
}

function businessDaysBetween(startTime: UTCTimestamp, endTime: UTCTimestamp): number {
  const start = new Date(Number(startTime) * 1000);
  const end = new Date(Number(endTime) * 1000);
  if (end.getTime() <= start.getTime()) return 0;

  let count = 0;
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endDate = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));

  while (d < endDate) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }

  return count;
}

function capturedAnchorTime(row: CapturedForecastRow | null | undefined): UTCTimestamp | null {
  return dateToTime(row?.generated_at ?? row?.snapshot_date);
}

function capturedAnchorPrice(row: CapturedForecastRow | null | undefined, fallback: number): number {
  return toNumber(row?.spot) ?? fallback;
}

function capturedHorizonRows(row: CapturedForecastRow | null | undefined, side: "base" | "upper" | "lower") {
  if (!row) return [];
  const keys = [
    [1, `${side}_1d`],
    [3, `${side}_3d`],
    [5, `${side}_5d`],
    [10, `${side}_10d`],
    [14, `${side}_14d`],
    [30, `${side}_30d`],
  ] as const;

  const rows: Array<{ sessions: number; value: number }> = [];

  for (const [sessions, key] of keys) {
    const value = toNumber((row as any)[key]);
    if (value !== null) {
      rows.push({ sessions: Number(sessions), value });
    }
  }

  return rows.sort((a, b) => a.sessions - b.sessions);
}

function capturedForecastAt(row: CapturedForecastRow | null | undefined, sessions: number, side: "base" | "upper" | "lower"): number | null {
  const rows = capturedHorizonRows(row, side);
  if (!rows.length) return null;
  if (sessions <= rows[0].sessions) return rows[0].value;

  for (let i = 1; i < rows.length; i += 1) {
    const prev = rows[i - 1];
    const next = rows[i];
    if (sessions <= next.sessions) {
      const span = Math.max(1, next.sessions - prev.sessions);
      const t = (sessions - prev.sessions) / span;
      return prev.value + (next.value - prev.value) * t;
    }
  }

  return rows[rows.length - 1].value;
}

function makeCapturedForecastPath(
  row: CapturedForecastRow | null | undefined,
  lastTime: UTCTimestamp,
  lastClose: number,
  side: "base" | "upper" | "lower"
): ChartLinePoint[] {
  if (!row) return [];

  const anchorTime = capturedAnchorTime(row) ?? lastTime;
  const anchorValue = side === "base" ? capturedAnchorPrice(row, lastClose) : capturedForecastAt(row, 1, side);
  if (anchorValue == null) return [];

  const points: ChartLinePoint[] = [{ time: anchorTime, value: anchorValue }];

  for (const item of capturedHorizonRows(row, side)) {
    points.push({ time: addBusinessDays(anchorTime, item.sessions), value: item.value });
  }

  return uniqueAscending(points);
}

function capturedDivergenceReadout(row: CapturedForecastRow | null | undefined, candleData: CandleSeriesData[]): DivergenceReadout | null {
  if (!row || !candleData.length) return null;

  const anchorTime = capturedAnchorTime(row);
  if (!anchorTime) return null;

  const afterAnchor = candleData.filter((candle) => Number(candle.time) >= Number(anchorTime));
  const latest = afterAnchor.length ? afterAnchor[afterAnchor.length - 1] : candleData[candleData.length - 1];
  if (!latest) return null;

  const elapsedSessions = businessDaysBetween(anchorTime, latest.time);
  const forecastBase = capturedForecastAt(row, elapsedSessions || 1, "base");
  const forecastUpper = capturedForecastAt(row, elapsedSessions || 1, "upper");
  const forecastLower = capturedForecastAt(row, elapsedSessions || 1, "lower");
  const actualClose = latest.close;

  if (forecastBase == null || actualClose == null) {
    return {
      status: "pending",
      label: "Waiting for comparable candles",
      tone: "#94a3b8",
      actualClose: actualClose ?? null,
      forecastBase,
      forecastUpper,
      forecastLower,
      divergence: null,
      divergencePct: null,
      normalizedDivergence: null,
      elapsedSessions,
    };
  }

  const divergence = actualClose - forecastBase;
  const divergencePct = forecastBase !== 0 ? (divergence / forecastBase) * 100 : null;
  const width = forecastUpper != null && forecastLower != null ? Math.max(0.01, forecastUpper - forecastLower) : null;
  const normalizedDivergence = width != null ? divergence / width : null;

  let status: DivergenceReadout["status"] = "tracking";
  let label = "Tracking forecast";
  let tone = "#67e8f9";

  if (forecastUpper != null && actualClose > forecastUpper) {
    status = "broken_upper";
    label = "Broken upper field";
    tone = "#22c55e";
  } else if (forecastLower != null && actualClose < forecastLower) {
    status = "broken_lower";
    label = "Broken lower field";
    tone = "#fb7185";
  } else if (normalizedDivergence != null && normalizedDivergence > 0.22) {
    status = "diverging_bullish";
    label = "Diverging bullish";
    tone = "#22c55e";
  } else if (normalizedDivergence != null && normalizedDivergence < -0.22) {
    status = "diverging_bearish";
    label = "Diverging bearish";
    tone = "#fb7185";
  }

  return {
    status,
    label,
    tone,
    actualClose,
    forecastBase,
    forecastUpper,
    forecastLower,
    divergence,
    divergencePct,
    normalizedDivergence,
    elapsedSessions,
  };
}

function futureTimesFromPath(path: any, lastTime: UTCTimestamp, horizonDays: number): UTCTimestamp[] {
  const rows = [
    ...(path?.basePath ?? []),
    ...(path?.upperBand ?? []),
    ...(path?.lowerBand ?? []),
    ...(path?.bullishUnlockPath ?? []),
    ...(path?.bearishFailurePath ?? [])
  ];

  const times = rows
    .map((point) => pointToTime(point))
    .filter((time): time is UTCTimestamp => time != null && Number(time) > Number(lastTime));

  const unique = Array.from(new Set(times.map(Number)))
    .sort((a, b) => a - b)
    .map((time) => time as UTCTimestamp);

  if (unique.length) return [lastTime, ...unique];

  const h = Math.max(5, Math.min(45, Math.round(horizonDays || 14)));
  const generated: UTCTimestamp[] = [lastTime];
  for (let i = 1; i <= h; i += 1) generated.push(addBusinessDays(lastTime, i));
  return generated;
}

function makeFieldForecastPath(
  forecast: OIFieldForecastResult | null | undefined,
  lastTime: UTCTimestamp,
  lastClose: number,
  valueKey: "baseTarget" | "upperBand" | "lowerBand",
  terminalSessions: number
): ChartLinePoint[] {
  if (!forecast?.horizons?.length) return [];

  const rows: ChartLinePoint[] = [{ time: lastTime, value: lastClose }];

  const horizons = visibleFieldHorizonsForTerminal(forecast, terminalSessions)
    .filter((horizon) => Number.isFinite(Number(horizon.sessions)))
    .sort((a, b) => Number(a.sessions) - Number(b.sessions));

  for (const horizon of horizons) {
    const sessions = Math.max(1, Number(horizon.sessions));
    const value = toNumber(horizon[valueKey]);
    if (value == null) continue;
    rows.push({ time: addBusinessDays(lastTime, sessions), value });
  }

  return uniqueAscending(rows);
}

function keyFieldHorizons(forecast: OIFieldForecastResult | null | undefined) {
  if (!forecast?.horizons?.length) return [];
  const terminal = fieldTerminalSessions(forecast);
  const preferred = new Set(terminal < 30 ? ["1D", "5D", "14D", "EXP"] : ["1D", "5D", "14D", "30D"]);
  const rows = visibleFieldHorizons(forecast).filter((horizon) => preferred.has(String(horizon.key)) || String(horizon.key).startsWith("EXP"));
  return rows.length ? rows.slice(0, 5) : visibleFieldHorizons(forecast).slice(0, 4);
}

function expirationHorizon(forecast: OIFieldForecastResult | null | undefined) {
  if (!forecast?.horizons?.length) return null;
  return forecast.horizons.find((horizon) => String(horizon.key).startsWith("EXP")) ?? null;
}

function forecastAxisLabel(mode: ForecastAxisMode): string {
  switch (mode) {
    case "compact": return "Compact 14D";
    case "full": return "Full 30D";
    case "expiration": return "To EXP";
  }
}

function fieldTerminalSessionsForAxis(forecast: OIFieldForecastResult | null | undefined, axisMode: ForecastAxisMode): number {
  const exp = expirationHorizon(forecast);
  const expSessions = toNumber(exp?.sessions);

  if (axisMode === "compact") {
    if (expSessions != null && expSessions > 0 && expSessions < 14) return Math.max(1, Math.round(expSessions));
    return 14;
  }

  if (axisMode === "expiration") {
    if (expSessions != null && expSessions > 0) return Math.max(1, Math.min(60, Math.round(expSessions)));
    return 30;
  }

  if (expSessions != null && expSessions > 0 && expSessions <= 30) return Math.max(1, Math.round(expSessions));
  return 30;
}

function visibleFieldHorizonsForTerminal(forecast: OIFieldForecastResult | null | undefined, terminalSessions: number) {
  if (!forecast?.horizons?.length) return [];

  const terminal = Math.max(1, Math.round(terminalSessions));
  const exp = expirationHorizon(forecast);
  const expSessions = toNumber(exp?.sessions);

  const rows = forecast.horizons
    .filter((horizon) => {
      const sessions = toNumber(horizon.sessions);
      if (sessions == null) return false;
      if (String(horizon.key).startsWith("EXP")) return expSessions != null && Math.round(expSessions) <= terminal;
      return sessions <= terminal;
    })
    .sort((a, b) => Number(a.sessions) - Number(b.sessions));

  const hasTerminal = rows.some((row) => Math.round(Number(row.sessions)) === terminal);
  if (hasTerminal) return rows;

  // Make the displayed path terminate at the requested lane boundary when the
  // forecast model has a matching standard horizon available. This avoids a
  // misleading 30D label being plotted only a few bars forward.
  const terminalKey = `${terminal}D`;
  const terminalRow = forecast.horizons.find((horizon) => String(horizon.key) === terminalKey);
  return terminalRow ? [...rows, terminalRow].sort((a, b) => Number(a.sessions) - Number(b.sessions)) : rows;
}

function fieldTerminalHorizonForAxis(forecast: OIFieldForecastResult | null | undefined, axisMode: ForecastAxisMode) {
  if (!forecast?.horizons?.length) return null;
  const terminal = fieldTerminalSessionsForAxis(forecast, axisMode);
  const visible = visibleFieldHorizonsForTerminal(forecast, terminal);
  return (
    visible.find((horizon) => Math.round(Number(horizon.sessions)) === terminal) ??
    visible[visible.length - 1] ??
    null
  );
}

function activeFieldBandForAxis(forecast: OIFieldForecastResult | null | undefined, axisMode: ForecastAxisMode) {
  const horizon = fieldTerminalHorizonForAxis(forecast, axisMode);
  if (!horizon) return { lower: null as number | null, upper: null as number | null };
  return { lower: toNumber(horizon.lowerBand), upper: toNumber(horizon.upperBand) };
}

function visibleRangeStart(candleData: CandleSeriesData[], lookbackBars: number): UTCTimestamp | null {
  if (!candleData.length) return null;
  const index = Math.max(0, candleData.length - Math.max(10, lookbackBars));
  return candleData[index]?.time ?? candleData[0]?.time ?? null;
}

function fieldTerminalSessions(forecast: OIFieldForecastResult | null | undefined): number {
  const exp = expirationHorizon(forecast);
  const expSessions = toNumber(exp?.sessions);

  // If the selected chain expires before 30 trading sessions, the chain expiration
  // becomes the terminal forecast point. Otherwise, keep the primary WheelDesk
  // field map visually anchored to the 30D premium-seller horizon.
  if (expSessions != null && expSessions > 0 && expSessions <= 30) return Math.max(1, Math.round(expSessions));
  return 30;
}

function visibleFieldHorizons(forecast: OIFieldForecastResult | null | undefined) {
  if (!forecast?.horizons?.length) return [];

  const terminal = fieldTerminalSessions(forecast);
  const exp = expirationHorizon(forecast);
  const expSessions = toNumber(exp?.sessions);

  const rows = forecast.horizons
    .filter((horizon) => {
      const sessions = toNumber(horizon.sessions);
      if (sessions == null) return false;
      if (String(horizon.key).startsWith("EXP")) return expSessions != null && expSessions <= terminal;
      return sessions <= terminal;
    })
    .sort((a, b) => Number(a.sessions) - Number(b.sessions));

  if (rows.some((row) => String(row.key) === "30D") || terminal < 30) return rows;

  const thirty = forecast.horizons.find((horizon) => String(horizon.key) === "30D");
  return thirty ? [...rows, thirty].sort((a, b) => Number(a.sessions) - Number(b.sessions)) : rows;
}

function wheelHorizon(forecast: OIFieldForecastResult | null | undefined) {
  if (!forecast?.horizons?.length) return null;
  const terminal = fieldTerminalSessions(forecast);
  return (
    forecast.horizons.find((horizon) => String(horizon.key) === "30D" && terminal >= 30) ??
    expirationHorizon(forecast) ??
    forecast.horizons.find((horizon) => String(horizon.bucket) === "wheel") ??
    forecast.horizons.find((horizon) => String(horizon.bucket) === "expiration") ??
    forecast.horizons[forecast.horizons.length - 1]
  );
}

function activeFieldBand(forecast: OIFieldForecastResult | null | undefined) {
  const horizon = wheelHorizon(forecast);
  if (!horizon) return { lower: null as number | null, upper: null as number | null };
  return { lower: toNumber(horizon.lowerBand), upper: toNumber(horizon.upperBand) };
}

function horizontalBand(times: UTCTimestamp[], value?: number | null): ChartLinePoint[] {
  if (value == null || !Number.isFinite(value)) return [];
  return uniqueAscending(times.map((time) => ({ time, value })));
}

function last<T>(rows: T[]): T | null {
  return rows.length ? rows[rows.length - 1] : null;
}

function pathRegime(path: any): string {
  const value = String(path?.activeScenario ?? path?.regime ?? "base");
  return value.replace(/_/g, " ");
}

function modeLabel(mode: ChartMode): string {
  switch (mode) {
    case "field-v2": return "OI Field v2";
    case "classic": return "Classic OI";
    case "both": return "Both";
    case "candles": return "Candles";
  }
}

function isNear(a?: number | null, b?: number | null): boolean {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= Math.max(0.01, Math.abs(a) * 0.0015);
}

function horizonByKey(forecast: OIFieldForecastResult | null | undefined, key: string) {
  return forecast?.horizons?.find((horizon) => String(horizon.key) === key) ?? null;
}

export default function ForecastChartPanel({
  ticker,
  candles,
  edge,
  edgeLabelMode = "control",
  path,
  matrix,
  ivSurface,
  flowOverlay,
  fieldForecast,
  structureFocus = false,
  isLoading = false,
  chartHeight = 470,
  headerAction,
  defaultChartMode,
  defaultForecastAxisMode,
  defaultForecastDivergence,
  surfaceDate,
  expiration,
  captureSession
}: ForecastChartPanelProps) {
  const [chartMode, setChartMode] = useState<ChartMode>(defaultChartMode ?? "field-v2");
  const [forecastAxisMode, setForecastAxisMode] = useState<ForecastAxisMode>(
    defaultForecastAxisMode ?? (chartHeight >= 620 ? "full" : "compact")
  );
  const [forecastDivergenceEnabled, setForecastDivergenceEnabled] = useState(defaultForecastDivergence ?? chartHeight >= 620);
  const [capturedForecast, setCapturedForecast] = useState<CapturedForecastRow | null>(null);
  const [capturedForecastStatus, setCapturedForecastStatus] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const baseRef = useRef<ISeriesApi<"Line"> | null>(null);
  const upperRef = useRef<ISeriesApi<"Line"> | null>(null);
  const lowerRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bullRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bearRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ivUpperRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ivLowerRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ivHalfUpperRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ivHalfLowerRef = useRef<ISeriesApi<"Line"> | null>(null);
  const fieldBaseRef = useRef<ISeriesApi<"Line"> | null>(null);
  const fieldUpperRef = useRef<ISeriesApi<"Line"> | null>(null);
  const fieldLowerRef = useRef<ISeriesApi<"Line"> | null>(null);
  const fieldWheelRef = useRef<ISeriesApi<"Line"> | null>(null);
  const divergenceBaseRef = useRef<ISeriesApi<"Line"> | null>(null);
  const divergenceUpperRef = useRef<ISeriesApi<"Line"> | null>(null);
  const divergenceLowerRef = useRef<ISeriesApi<"Line"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);

  useEffect(() => {
    let cancelled = false;
    const symbol = String(ticker ?? "").trim().toUpperCase();
    if (!symbol || !forecastDivergenceEnabled) {
      setCapturedForecast(null);
      setCapturedForecastStatus("");
      return;
    }

    async function loadCapturedForecast() {
      try {
        setCapturedForecastStatus("Loading captured forecast…");
        const params = new URLSearchParams({ symbol });
        if (surfaceDate) params.set("snapshotDate", String(surfaceDate).slice(0, 10));
        if (expiration) params.set("expiration", String(expiration).slice(0, 10));
        if (captureSession) params.set("captureSession", String(captureSession));

        const response = await fetch(`/api/forecasts/oi-field/latest?${params.toString()}`, { cache: "no-store" });
        const payload = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok || !payload?.ok) throw new Error(payload?.error ?? `Latest forecast request failed: ${response.status}`);

        setCapturedForecast(payload.forecast ?? null);

        if (!payload.forecast) {
          setCapturedForecastStatus(
            payload.matchStatus === "missing_exact"
              ? "No captured forecast for selected surface/expiration"
              : "No captured forecast yet"
          );
        } else if (payload.matchStatus === "fallback_latest") {
          const fallback = payload.fallback;
          setCapturedForecastStatus(
            `Forecast mismatch: showing latest ${fallback?.snapshotDate ?? "surface"}${fallback?.expiration ? ` / ${fallback.expiration}` : ""}`
          );
        } else {
          setCapturedForecastStatus("Captured forecast matched to selected context");
        }
      } catch (error) {
        if (!cancelled) {
          setCapturedForecast(null);
          setCapturedForecastStatus(error instanceof Error ? error.message : "Could not load captured forecast.");
        }
      }
    }

    loadCapturedForecast();

    return () => {
      cancelled = true;
    };
  }, [ticker, surfaceDate, expiration, captureSession, forecastDivergenceEnabled]);

  const clearPriceLines = () => {
    const series = candleRef.current;
    if (!series) return;

    for (const line of priceLinesRef.current) {
      try {
        series.removePriceLine(line);
      } catch {
        // hot reload may already have removed the line
      }
    }

    priceLinesRef.current = [];
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      height: chartHeight,
      layout: {
        background: { type: ColorType.Solid, color: "#07111f" },
        textColor: "#b8c7dc"
      },
      grid: {
        vertLines: { color: "rgba(148,163,184,0.12)" },
        horzLines: { color: "rgba(148,163,184,0.12)" }
      },
      rightPriceScale: {
        visible: true,
        borderColor: "rgba(148,163,184,0.22)",
        scaleMargins: { top: 0.12, bottom: 0.16 }
      },
      leftPriceScale: { visible: false },
      timeScale: {
        borderColor: "rgba(148,163,184,0.22)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 10,
        barSpacing: 8,
        fixLeftEdge: false,
        fixRightEdge: false
      },
      crosshair: { mode: 1 },
      handleScroll: true,
      handleScale: true
    });

    const candlesSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      priceLineVisible: false,
      lastValueVisible: false
    });

    const baseSeries = chart.addSeries(LineSeries, {
      color: "rgba(226,232,240,0.95)",
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const upperSeries = chart.addSeries(LineSeries, {
      color: "rgba(34,211,238,0.35)",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const lowerSeries = chart.addSeries(LineSeries, {
      color: "rgba(34,211,238,0.35)",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const bullSeries = chart.addSeries(LineSeries, {
      color: "rgba(34,197,94,0.9)",
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const bearSeries = chart.addSeries(LineSeries, {
      color: "rgba(251,113,133,0.9)",
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const ivUpper = chart.addSeries(LineSeries, {
      color: "rgba(34,211,238,0.95)",
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const ivLower = chart.addSeries(LineSeries, {
      color: "rgba(34,211,238,0.95)",
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const ivHalfUpper = chart.addSeries(LineSeries, {
      color: "rgba(125,211,252,0.32)",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const ivHalfLower = chart.addSeries(LineSeries, {
      color: "rgba(125,211,252,0.32)",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
    });


    const fieldBase = chart.addSeries(LineSeries, {
      color: "rgba(103,232,249,0.98)",
      lineWidth: 4,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const fieldUpper = chart.addSeries(LineSeries, {
      color: "rgba(34,197,94,0.75)",
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const fieldLower = chart.addSeries(LineSeries, {
      color: "rgba(251,113,133,0.75)",
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const fieldWheel = chart.addSeries(LineSeries, {
      color: "rgba(16,185,129,0.72)",
      lineWidth: 2,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const divergenceBase = chart.addSeries(LineSeries, {
      color: "rgba(250,250,250,0.95)",
      lineWidth: 3,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const divergenceUpper = chart.addSeries(LineSeries, {
      color: "rgba(34,197,94,0.42)",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const divergenceLower = chart.addSeries(LineSeries, {
      color: "rgba(251,113,133,0.42)",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    chartRef.current = chart;
    candleRef.current = candlesSeries;
    baseRef.current = baseSeries;
    upperRef.current = upperSeries;
    lowerRef.current = lowerSeries;
    bullRef.current = bullSeries;
    bearRef.current = bearSeries;
    ivUpperRef.current = ivUpper;
    ivLowerRef.current = ivLower;
    ivHalfUpperRef.current = ivHalfUpper;
    ivHalfLowerRef.current = ivHalfLower;
    fieldBaseRef.current = fieldBase;
    fieldUpperRef.current = fieldUpper;
    fieldLowerRef.current = fieldLower;
    fieldWheelRef.current = fieldWheel;
    divergenceBaseRef.current = divergenceBase;
    divergenceUpperRef.current = divergenceUpper;
    divergenceLowerRef.current = divergenceLower;

    const resize = () => {
      if (!containerRef.current) return;
      chart.applyOptions({ width: containerRef.current.clientWidth });
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    return () => {
      clearPriceLines();
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      baseRef.current = null;
      upperRef.current = null;
      lowerRef.current = null;
      bullRef.current = null;
      bearRef.current = null;
      ivUpperRef.current = null;
      ivLowerRef.current = null;
      ivHalfUpperRef.current = null;
      ivHalfLowerRef.current = null;
      fieldBaseRef.current = null;
      fieldUpperRef.current = null;
      fieldLowerRef.current = null;
      fieldWheelRef.current = null;
      divergenceBaseRef.current = null;
      divergenceUpperRef.current = null;
      divergenceLowerRef.current = null;
    };
  }, [chartHeight]);

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleRef.current;
    if (!chart || !candleSeries) return;

    clearPriceLines();

    const allCandleData = normalizeCandles(candles ?? []);
    const rawFieldForecast = Boolean(fieldForecast?.horizons?.length);
    const fieldDrivenWindow = rawFieldForecast && chartMode !== "classic" && chartMode !== "candles";
    const lookbackBars = forecastAxisMode === "compact" ? 45 : forecastAxisMode === "full" ? 60 : 75;
    const candleData = fieldDrivenWindow
      ? allCandleData.slice(-lookbackBars)
      : structureFocus && fieldForecast
        ? allCandleData.slice(-90)
        : allCandleData;

    candleSeries.setData(candleData);

    const latest = last(candleData);
    const lastTime = latest?.time;
    const lastClose = latest?.close;

    if (!latest || lastTime == null || lastClose == null) {
      baseRef.current?.setData([]);
      upperRef.current?.setData([]);
      lowerRef.current?.setData([]);
      bullRef.current?.setData([]);
      bearRef.current?.setData([]);
      ivUpperRef.current?.setData([]);
      ivLowerRef.current?.setData([]);
      ivHalfUpperRef.current?.setData([]);
      ivHalfLowerRef.current?.setData([]);
      fieldBaseRef.current?.setData([]);
      fieldUpperRef.current?.setData([]);
      fieldLowerRef.current?.setData([]);
      fieldWheelRef.current?.setData([]);
      divergenceBaseRef.current?.setData([]);
      divergenceUpperRef.current?.setData([]);
      divergenceLowerRef.current?.setData([]);
      return;
    }

    const effectiveMode: ChartMode = chartMode === "field-v2" && !rawFieldForecast ? "classic" : chartMode;
    const showFieldForecast = rawFieldForecast && (effectiveMode === "field-v2" || effectiveMode === "both");
    const showClassic = effectiveMode === "classic" || effectiveMode === "both";
    const showPath = Boolean(path) && showClassic;
    const showIvSurface = Boolean(ivSurface) && showClassic;
    const showEdge = Boolean(edge) && showClassic;
    const showMatrix = Boolean(matrix) && showClassic;
    const showFlowOverlay = Boolean(flowOverlay) && showClassic;
    const showFieldRails = showFieldForecast && Boolean(path);
    const showCapturedDivergence = forecastDivergenceEnabled && Boolean(capturedForecast) && effectiveMode !== "candles";

    const baseData = showPath ? makeAnchoredPath(path?.basePath, lastTime, lastClose) : [];
    const upperData = showPath ? makeAnchoredPath(path?.upperBand, lastTime, lastClose) : [];
    const lowerData = showPath ? makeAnchoredPath(path?.lowerBand, lastTime, lastClose) : [];
    const bullData = showPath ? makeStandalonePath(path?.bullishUnlockPath, lastTime) : [];
    const bearData = showPath ? makeStandalonePath(path?.bearishFailurePath, lastTime) : [];

    baseRef.current?.setData(baseData);
    upperRef.current?.setData(upperData);
    lowerRef.current?.setData(lowerData);
    bullRef.current?.setData(bullData);
    bearRef.current?.setData(bearData);

    const terminalSessions = fieldTerminalSessionsForAxis(fieldForecast, forecastAxisMode);
    const fieldBaseData = showFieldForecast ? makeFieldForecastPath(fieldForecast, lastTime, lastClose, "baseTarget", terminalSessions) : [];
    const fieldUpperData = showFieldForecast ? makeFieldForecastPath(fieldForecast, lastTime, lastClose, "upperBand", terminalSessions) : [];
    const fieldLowerData = showFieldForecast ? makeFieldForecastPath(fieldForecast, lastTime, lastClose, "lowerBand", terminalSessions) : [];
    const wheel = fieldTerminalHorizonForAxis(fieldForecast, forecastAxisMode) ?? wheelHorizon(fieldForecast);
    const wheelFloor = toNumber(wheel?.lowerBand ?? null);
    const fieldTimes = fieldBaseData.length ? fieldBaseData.map((point) => point.time) : [];

    fieldBaseRef.current?.setData(fieldBaseData);
    fieldUpperRef.current?.setData(fieldUpperData);
    fieldLowerRef.current?.setData(fieldLowerData);
    fieldWheelRef.current?.setData(showFieldForecast && wheelFloor != null ? horizontalBand(fieldTimes, wheelFloor) : []);

    const divergenceBaseData = showCapturedDivergence ? makeCapturedForecastPath(capturedForecast, lastTime, lastClose, "base") : [];
    const divergenceUpperData = showCapturedDivergence ? makeCapturedForecastPath(capturedForecast, lastTime, lastClose, "upper") : [];
    const divergenceLowerData = showCapturedDivergence ? makeCapturedForecastPath(capturedForecast, lastTime, lastClose, "lower") : [];
    divergenceBaseRef.current?.setData(divergenceBaseData);
    divergenceUpperRef.current?.setData(divergenceUpperData);
    divergenceLowerRef.current?.setData(divergenceLowerData);

    const horizon = Number(ivSurface?.horizonDays ?? path?.horizonDays ?? path?.horizonSessions ?? 14);
    const times = showIvSurface ? futureTimesFromPath(path, lastTime, horizon) : [];
    const em = showIvSurface ? ivSurface?.expectedMove : null;

    ivUpperRef.current?.setData(showIvSurface ? horizontalBand(times, em?.upperOneSigma) : []);
    ivLowerRef.current?.setData(showIvSurface ? horizontalBand(times, em?.lowerOneSigma) : []);
    ivHalfUpperRef.current?.setData(showIvSurface ? horizontalBand(times, em?.upperHalfSigma) : []);
    ivHalfLowerRef.current?.setData(showIvSurface ? horizontalBand(times, em?.lowerHalfSigma) : []);

    const addPriceLine = ({
      price,
      color,
      title,
      dashed = true,
      width = 1
    }: {
      price?: number | null;
      color: string;
      title: string;
      dashed?: boolean;
      width?: 1 | 2 | 3 | 4;
    }) => {
      if (price == null || !Number.isFinite(price)) return;
      const line = candleSeries.createPriceLine({
        price,
        color,
        lineWidth: width,
        lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid,
        axisLabelVisible: true,
        title
      });
      priceLinesRef.current.push(line);
    };

    if (showEdge) {
      if (edgeLabelMode === "oi") {
        addPriceLine({ price: edge?.magnet, color: "#fbbf24", title: `Active center ${fmt(edge?.magnet)}` });
        addPriceLine({ price: edge?.resistance, color: "#d946ef", title: `Active call wall ${fmt(edge?.resistance)}` });
        addPriceLine({ price: edge?.support, color: "#d946ef", title: `Active put wall ${fmt(edge?.support)}` });
      } else {
        addPriceLine({ price: edge?.magnet, color: "#fbbf24", title: `Control magnet ${fmt(edge?.magnet)}` });
        addPriceLine({ price: edge?.resistance, color: "#22c55e", title: `Resistance ${fmt(edge?.resistance)}` });
        addPriceLine({ price: edge?.support, color: "#fb7185", title: `Support ${fmt(edge?.support)}` });
      }
    }

    if (showPath) {
      addPriceLine({ price: path?.magnet, color: "#fbbf24", title: `Magnet ${fmt(path?.magnet)}` });
      addPriceLine({ price: path?.callWall ?? path?.invalidAbove, color: "#d946ef", title: `Call wall ${fmt(path?.callWall ?? path?.invalidAbove)}` });
      addPriceLine({ price: path?.putWall ?? path?.invalidBelow, color: "#d946ef", title: `Put wall ${fmt(path?.putWall ?? path?.invalidBelow)}` });
      addPriceLine({ price: path?.invalidAbove, color: "#22c55e", title: `▲ Bullish trigger ${fmt(path?.invalidAbove)}`, width: 2 });
      addPriceLine({ price: path?.invalidBelow, color: "#fb7185", title: `▼ Bearish trigger ${fmt(path?.invalidBelow)}`, width: 2 });
    }

    if (showMatrix) {
      addPriceLine({ price: matrix?.expectedValueTarget, color: "#fbbf24", title: `Matrix target ${fmt(matrix?.expectedValueTarget)}` });
      addPriceLine({ price: matrix?.bullishUnlock, color: "#22c55e", title: `▲ Bullish trigger ${fmt(matrix?.bullishUnlock)}`, width: 2 });
      addPriceLine({ price: matrix?.bearishFailure, color: "#fb7185", title: `▼ Bearish trigger ${fmt(matrix?.bearishFailure)}`, width: 2 });
    }

    if (showFieldForecast) {
      const band = activeFieldBandForAxis(fieldForecast, forecastAxisMode);
      const terminal = fieldTerminalHorizonForAxis(fieldForecast, forecastAxisMode) ?? wheelHorizon(fieldForecast);
      const terminalLabel = String(terminal?.label ?? terminal?.key ?? forecastAxisLabel(forecastAxisMode));
      const terminalTarget = toNumber(terminal?.baseTarget);

      addPriceLine({ price: band.upper, color: "#22c55e", title: `Field upper ${fmt(band.upper)}`, dashed: true, width: 2 });
      addPriceLine({ price: terminalTarget, color: "#67e8f9", title: `Field base ${terminalLabel} ${fmt(terminalTarget)}`, dashed: false, width: 2 });
      addPriceLine({ price: band.lower, color: "#fb7185", title: `Field lower ${fmt(band.lower)}`, dashed: true, width: 2 });

      if (showFieldRails) {
        const upperRail = toNumber(path?.invalidAbove ?? path?.callWall);
        const lowerRail = toNumber(path?.invalidBelow ?? path?.putWall);
        addPriceLine({ price: upperRail, color: "#22c55e", title: `Upper rail ${fmt(upperRail)}`, dashed: true, width: 2 });
        addPriceLine({ price: lowerRail, color: "#fb7185", title: `Lower rail ${fmt(lowerRail)}`, dashed: true, width: 2 });
      }
    }

    if (showCapturedDivergence) {
      const divReadout = capturedDivergenceReadout(capturedForecast, candleData);
      addPriceLine({ price: divReadout?.forecastBase, color: "#f8fafc", title: `Captured base ${fmt(divReadout?.forecastBase)}`, dashed: false, width: 2 });
      addPriceLine({ price: divReadout?.forecastUpper, color: "#22c55e", title: `Captured upper ${fmt(divReadout?.forecastUpper)}`, dashed: true, width: 1 });
      addPriceLine({ price: divReadout?.forecastLower, color: "#fb7185", title: `Captured lower ${fmt(divReadout?.forecastLower)}`, dashed: true, width: 1 });
    }

    if (showIvSurface) {
      addPriceLine({ price: em?.upperOneSigma, color: "#22d3ee", title: `▲ ${horizon || 14}D IV upper ${fmt(em?.upperOneSigma)}`, width: 2 });
      addPriceLine({ price: em?.lowerOneSigma, color: "#22d3ee", title: `▼ ${horizon || 14}D IV lower ${fmt(em?.lowerOneSigma)}`, width: 2 });
    }

    if (showFlowOverlay) {
      const levels = Array.isArray(flowOverlay?.chartLevels) ? flowOverlay.chartLevels : [];
      for (const level of levels.slice(0, 6)) {
        const side = String(level?.side ?? "");
        const pressure = Number(level?.pressureScore ?? 0);
        const strike = Number(level?.strike);
        const label = side === "put" ? "Put flow" : side === "call" ? "Call flow" : "Flow";
        const color = side === "put" ? "#fb7185" : side === "call" ? "#22d3ee" : "#fbbf24";
        const width = pressure >= 70 ? 2 : 1;

        addPriceLine({
          price: strike,
          color,
          title: `${label} ${fmt(strike)} · ${Math.round(pressure)}`,
          width: width as 1 | 2,
          dashed: pressure < 70
        });
      }
    }

    if (showFieldForecast && fieldBaseData.length) {
      const forecastEnd = addBusinessDays(lastTime, Math.max(terminalSessions + 2, 6));
      const start = visibleRangeStart(candleData, lookbackBars);
      try {
        if (start != null) chart.timeScale().setVisibleRange({ from: start, to: forecastEnd });
        else chart.timeScale().fitContent();
      } catch {
        chart.timeScale().fitContent();
      }
    } else {
      chart.timeScale().fitContent();
      chart.timeScale().scrollToPosition(8, false);
    }
  }, [candles, edge, edgeLabelMode, path, matrix, ivSurface, flowOverlay, fieldForecast, structureFocus, chartMode, forecastAxisMode, capturedForecast, forecastDivergenceEnabled]);

  const lastClose = candles?.length ? toNumber(candles[candles.length - 1]?.close) : null;
  const horizon = Number(ivSurface?.horizonDays ?? path?.horizonDays ?? path?.horizonSessions ?? 14);
  const expectedMove = ivSurface?.expectedMove;
  const terminal = fieldTerminalHorizonForAxis(fieldForecast, forecastAxisMode) ?? wheelHorizon(fieldForecast);
  const terminalSessions = fieldTerminalSessionsForAxis(fieldForecast, forecastAxisMode);
  const lookbackBars = forecastAxisMode === "compact" ? 45 : forecastAxisMode === "full" ? 60 : 75;
  const oneDay = horizonByKey(fieldForecast, "1D");
  const fiveDay = horizonByKey(fieldForecast, "5D");
  const fourteenDay = horizonByKey(fieldForecast, "14D");
  const thirtyDay = horizonByKey(fieldForecast, "30D");
  const fieldBand = activeFieldBandForAxis(fieldForecast, forecastAxisMode);
  const effectiveModeLabel = modeLabel(chartMode === "field-v2" && !fieldForecast ? "classic" : chartMode);
  const divergenceReadout = forecastDivergenceEnabled ? capturedDivergenceReadout(capturedForecast, normalizeCandles(candles ?? [])) : null;

  return (
    <section style={{ ...cardStyle, padding: "0.85rem", minHeight: chartHeight + 90, position: "relative" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", marginBottom: "0.45rem" }}>
        <div>
          <h2 style={{ margin: 0, color: colors.text, fontSize: 20, fontWeight: 950 }}>{ticker} Forecast Cone</h2>
          <div style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
            {fieldForecast ? "OI Field v2 horizon path + active structure band" : `Live candlestick chart + OI path + matched IV band over ${horizon || 14} sessions`}
          </div>
          {expectedMove ? (
            <div style={{ color: colors.teal, fontSize: 12, fontWeight: 900, marginTop: 6 }}>
              {horizon || 14}D IV band: {fmt(expectedMove.lowerOneSigma)}–{fmt(expectedMove.upperOneSigma)} · 1σ ±{fmt(expectedMove.oneSigma)} ({pct(expectedMove.expectedMovePct)}) · ATM IV {ivSurface?.atmIv != null ? pct(ivSurface.atmIv * 100) : "N/A"}
            </div>
          ) : null}
          {fieldForecast ? (
            <div style={{ color: colors.amber, fontSize: 12, fontWeight: 900, marginTop: 6 }}>
              OI Field v2: {fieldForecast.baseBias.toUpperCase()} · confidence {fieldForecast.confidenceScore} · {forecastAxisLabel(forecastAxisMode)} lane
            </div>
          ) : null}
        </div>

        <div style={{ display: "grid", gap: "0.6rem", justifyItems: "end", textAlign: "right", minWidth: 130 }}>
          <div>
            <div style={{ color: colors.green, fontSize: 24, fontWeight: 950, lineHeight: 1 }}>{fmt(lastClose)}</div>
            <div style={{ color: colors.muted, fontSize: 11, marginTop: 3 }}>Last candle close</div>
            {ivSurface ? (
              <div
                style={{
                  color:
                    ivSurface.skewBias === "bearish"
                      ? colors.red
                      : ivSurface.skewBias === "bullish"
                        ? colors.green
                        : colors.teal,
                  fontSize: 12,
                  fontWeight: 900,
                  marginTop: 8,
                }}
              >
                Skew: {String(ivSurface.skewBias ?? "unknown").toUpperCase()}
              </div>
            ) : null}
          </div>
          <div style={{ display: "grid", gap: "0.45rem", justifyItems: "end" }}>
            {headerAction ? <div>{headerAction}</div> : null}
            <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", justifyContent: "flex-end" }} aria-label="Chart mode">
              {(["field-v2", "classic", "both", "candles"] as ChartMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setChartMode(mode)}
                  style={{
                    border: chartMode === mode ? "1px solid rgba(34,211,238,0.65)" : "1px solid rgba(148,163,184,0.22)",
                    background: chartMode === mode ? "rgba(34,211,238,0.16)" : "rgba(15,23,42,0.72)",
                    color: chartMode === mode ? colors.teal : colors.muted,
                    borderRadius: 999,
                    padding: "0.28rem 0.5rem",
                    fontSize: 10,
                    fontWeight: 950,
                    cursor: "pointer",
                  }}
                >
                  {modeLabel(mode)}
                </button>
              ))}
            </div>
            {fieldForecast ? (
              <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", justifyContent: "flex-end" }} aria-label="Forecast time axis">
                {(["compact", "full", "expiration"] as ForecastAxisMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setForecastAxisMode(mode)}
                    style={{
                      border: forecastAxisMode === mode ? "1px solid rgba(251,191,36,0.68)" : "1px solid rgba(148,163,184,0.22)",
                      background: forecastAxisMode === mode ? "rgba(251,191,36,0.13)" : "rgba(15,23,42,0.72)",
                      color: forecastAxisMode === mode ? colors.amber : colors.muted,
                      borderRadius: 999,
                      padding: "0.25rem 0.48rem",
                      fontSize: 10,
                      fontWeight: 950,
                      cursor: "pointer",
                    }}
                    title="Controls how much forward forecast lane is shown on the time axis."
                  >
                    {forecastAxisLabel(mode)}
                  </button>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setForecastDivergenceEnabled((value) => !value)}
              style={{
                border: forecastDivergenceEnabled ? "1px solid rgba(248,250,252,0.7)" : "1px solid rgba(148,163,184,0.22)",
                background: forecastDivergenceEnabled ? "rgba(248,250,252,0.12)" : "rgba(15,23,42,0.72)",
                color: forecastDivergenceEnabled ? "#f8fafc" : colors.muted,
                borderRadius: 999,
                padding: "0.25rem 0.48rem",
                fontSize: 10,
                fontWeight: 950,
                cursor: "pointer",
              }}
              title={capturedForecastStatus || "Overlay the latest captured forecast and compare actual price against it."}
            >
              Forecast Divergence
            </button>
          </div>
        </div>
      </div>

      <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", border: "1px solid rgba(148, 163, 184, 0.12)", background: "#07111f" }}>
        {isLoading ? (
          <div style={{ position: "absolute", top: 10, left: 12, zIndex: 3, color: colors.teal, fontSize: 12, fontWeight: 900, background: "rgba(7,17,31,0.78)", border: "1px solid rgba(34,211,238,0.22)", borderRadius: 999, padding: "0.25rem 0.55rem" }}>
            Loading candles…
          </div>
        ) : null}

        {fieldForecast && chartMode !== "candles" ? (
          <div
            style={{
              position: "absolute",
              top: 10,
              left: 12,
              zIndex: 3,
              display: "grid",
              gap: 4,
              minWidth: 250,
              maxWidth: 390,
              background: "rgba(7,17,31,0.82)",
              border: "1px solid rgba(34,211,238,0.22)",
              borderRadius: 12,
              padding: "0.55rem 0.65rem",
              boxShadow: "0 18px 42px rgba(0,0,0,0.28)",
              pointerEvents: "none",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center" }}>
              <strong style={{ color: colors.teal, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>{effectiveModeLabel}</strong>
              <span style={{ color: fieldForecast.baseBias === "bearish" ? colors.red : fieldForecast.baseBias === "bullish" ? colors.green : colors.amber, fontSize: 11, fontWeight: 950 }}>
                {fieldForecast.baseBias.toUpperCase()} · {fieldForecast.confidenceScore}
              </span>
            </div>
            <div style={{ color: colors.text, fontSize: 12, fontWeight: 850 }}>
              Base {String(terminal?.label ?? terminal?.key ?? forecastAxisLabel(forecastAxisMode))}: <span style={{ color: colors.teal }}>{fmt(toNumber(terminal?.baseTarget))}</span> · Field range <span style={{ color: colors.red }}>{fmt(fieldBand.lower)}</span>–<span style={{ color: colors.green }}>{fmt(fieldBand.upper)}</span>
            </div>
            <div style={{ color: colors.amber, fontSize: 11, fontWeight: 900 }}>
              Forecast lane: {lookbackBars} bars back → +{terminalSessions} trading bars forward
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", color: colors.muted, fontSize: 11, fontWeight: 850 }}>
              {oneDay ? <span>1D {fmt(toNumber(oneDay.baseTarget))}</span> : null}
              {fiveDay ? <span>5D {fmt(toNumber(fiveDay.baseTarget))}</span> : null}
              {fourteenDay ? <span>14D {fmt(toNumber(fourteenDay.baseTarget))}</span> : null}
              {thirtyDay ? <span>30D {fmt(toNumber(thirtyDay.baseTarget))}</span> : null}
            </div>
            {forecastDivergenceEnabled && divergenceReadout ? (
              <div style={{ borderTop: "1px solid rgba(148,163,184,0.16)", marginTop: 4, paddingTop: 5, display: "grid", gap: 3 }}>
                <strong style={{ color: divergenceReadout.tone, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  {divergenceReadout.label}
                </strong>
                <span style={{ color: colors.muted, fontSize: 11, fontWeight: 850 }}>
                  Actual {fmt(divergenceReadout.actualClose)} vs captured base {fmt(divergenceReadout.forecastBase)} · Δ {fmt(divergenceReadout.divergence)} ({divergenceReadout.divergencePct == null ? "N/A" : `${divergenceReadout.divergencePct.toFixed(1)}%`}) · +{divergenceReadout.elapsedSessions ?? 0}D
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        <div ref={containerRef} style={{ width: "100%", height: chartHeight }} />

        {!isLoading && (!candles || candles.length === 0) ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: colors.muted,
              fontWeight: 800,
              background: "rgba(7, 17, 31, 0.72)",
              pointerEvents: "none"
            }}
          >
            No candle data loaded for {ticker}. Open Dashboard/Scanner to fetch candles, then return to Control Center.
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", color: colors.muted, fontSize: 11, marginTop: "0.65rem", alignItems: "center" }}>
        <span>Mode: <strong style={{ color: colors.text }}>{effectiveModeLabel}</strong></span>
        {fieldForecast ? <span>Forecast axis: <strong style={{ color: colors.amber }}>{forecastAxisLabel(forecastAxisMode)}</strong> · {lookbackBars} back / +{terminalSessions} forward</span> : null}
        {fieldForecast && chartMode !== "classic" && chartMode !== "candles" ? <span><strong style={{ color: colors.teal }}>Thick cyan</strong> OI Field v2 base path to {String(terminal?.label ?? terminal?.key ?? "30D")}</span> : null}
        {fieldForecast && chartMode !== "classic" && chartMode !== "candles" ? <span><strong style={{ color: colors.green }}>Green/red dashed</strong> upper/lower field band</span> : null}
        {fieldForecast && chartMode !== "classic" && chartMode !== "candles" ? <span><strong style={{ color: "#10b981" }}>Dotted green</strong> wheel support floor</span> : null}
        {path && (chartMode === "classic" || chartMode === "both") ? <span><strong style={{ color: colors.text }}>Dashed white</strong> legacy base path</span> : null}
        {ivSurface && (chartMode === "classic" || chartMode === "both") ? <span><strong style={{ color: colors.teal }}>Cyan</strong> matched IV band</span> : null}
        {forecastDivergenceEnabled ? <span>Forecast divergence: <strong style={{ color: divergenceReadout?.tone ?? colors.text }}>{divergenceReadout?.label ?? (capturedForecastStatus || "No captured forecast")}</strong></span> : null}
        {forecastDivergenceEnabled && capturedForecast?.generated_at ? <span>Captured: <strong style={{ color: colors.text }}>{new Date(capturedForecast.generated_at).toLocaleString()}</strong></span> : null}
        {forecastDivergenceEnabled && (surfaceDate || expiration) ? <span>Requested context: <strong style={{ color: colors.text }}>{surfaceDate || "any surface"}</strong> / <strong style={{ color: colors.text }}>{expiration || "any expiration"}</strong></span> : null}
        {edge || path || matrix ? <span>Regime: <strong style={{ color: colors.text }}>{path ? pathRegime(path) : fieldForecast?.regime ?? "mixed"}</strong></span> : null}
      </div>
    </section>
  );
}
