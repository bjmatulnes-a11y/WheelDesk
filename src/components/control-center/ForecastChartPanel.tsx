"use client";

import { useEffect, useRef, type ReactNode } from "react";
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
};

type LinePoint = { time?: unknown; date?: unknown; value?: unknown; price?: unknown; adjustedCenter?: unknown; expiration?: unknown };
type ChartLinePoint = { time: UTCTimestamp; value: number };

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
  valueKey: "baseTarget" | "upperBand" | "lowerBand"
): ChartLinePoint[] {
  if (!forecast?.horizons?.length) return [];

  const rows: ChartLinePoint[] = [{ time: lastTime, value: lastClose }];

  const horizons = [...forecast.horizons]
    .filter((horizon) => Number.isFinite(Number(horizon.sessions)))
    .sort((a, b) => Number(a.sessions) - Number(b.sessions));

  for (const horizon of horizons) {
    const value = toNumber(horizon[valueKey]);
    if (value == null) continue;
    rows.push({ time: addBusinessDays(lastTime, Math.max(1, Number(horizon.sessions))), value });
  }

  return uniqueAscending(rows);
}

function keyFieldHorizons(forecast: OIFieldForecastResult | null | undefined) {
  if (!forecast?.horizons?.length) return [];
  const preferred = new Set(["1D", "5D", "14D", "30D"]);
  const rows = forecast.horizons.filter((horizon) => preferred.has(String(horizon.key)) || String(horizon.key).startsWith("EXP"));
  return rows.length ? rows.slice(0, 5) : forecast.horizons.slice(0, 4);
}

function wheelHorizon(forecast: OIFieldForecastResult | null | undefined) {
  if (!forecast?.horizons?.length) return null;
  return (
    forecast.horizons.find((horizon) => String(horizon.key) === "30D") ??
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
  headerAction
}: ForecastChartPanelProps) {
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
  const priceLinesRef = useRef<IPriceLine[]>([]);

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
      color: "rgba(34,211,238,0.95)",
      lineWidth: 3,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const fieldUpper = chart.addSeries(LineSeries, {
      color: "rgba(34,197,94,0.58)",
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const fieldLower = chart.addSeries(LineSeries, {
      color: "rgba(251,113,133,0.58)",
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
    };
  }, [chartHeight]);

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleRef.current;
    if (!chart || !candleSeries) return;

    clearPriceLines();

    const allCandleData = normalizeCandles(candles ?? []);
    const candleData = structureFocus && fieldForecast ? allCandleData.slice(-90) : allCandleData;

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
      return;
    }

    const showPath = Boolean(path);
    const showIvSurface = Boolean(ivSurface);
    const showEdge = Boolean(edge);
    const showMatrix = Boolean(matrix);
    const showFlowOverlay = Boolean(flowOverlay);
    const showFieldForecast = Boolean(fieldForecast?.horizons?.length);

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

    const fieldBaseData = showFieldForecast ? makeFieldForecastPath(fieldForecast, lastTime, lastClose, "baseTarget") : [];
    const fieldUpperData = showFieldForecast ? makeFieldForecastPath(fieldForecast, lastTime, lastClose, "upperBand") : [];
    const fieldLowerData = showFieldForecast ? makeFieldForecastPath(fieldForecast, lastTime, lastClose, "lowerBand") : [];
    const wheel = wheelHorizon(fieldForecast);
    const wheelFloor = toNumber(wheel?.lowerBand ?? null);
    const fieldTimes = fieldBaseData.length ? fieldBaseData.map((point) => point.time) : [];

    fieldBaseRef.current?.setData(fieldBaseData);
    fieldUpperRef.current?.setData(fieldUpperData);
    fieldLowerRef.current?.setData(fieldLowerData);
    fieldWheelRef.current?.setData(showFieldForecast && wheelFloor != null ? horizontalBand(fieldTimes, wheelFloor) : []);

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
      for (const horizonRow of keyFieldHorizons(fieldForecast)) {
        const target = toNumber(horizonRow.baseTarget);
        const label = String(horizonRow.label ?? horizonRow.key ?? "H");
        const color = horizonRow.bias === "bearish" ? "#fb7185" : horizonRow.bias === "bullish" ? "#22c55e" : "#22d3ee";
        addPriceLine({ price: target, color, title: `Field ${label} ${fmt(target)}`, dashed: true, width: label.startsWith("EXP") || label === "30D" ? 2 : 1 });
      }

      const band = activeFieldBand(fieldForecast);
      addPriceLine({ price: band.upper, color: "#22c55e", title: `Field upper band ${fmt(band.upper)}`, dashed: true, width: 2 });
      addPriceLine({ price: band.lower, color: "#fb7185", title: `Field lower band ${fmt(band.lower)}`, dashed: true, width: 2 });
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

    chart.timeScale().fitContent();
    chart.timeScale().scrollToPosition(8, false);
  }, [candles, edge, edgeLabelMode, path, matrix, ivSurface, flowOverlay, fieldForecast, structureFocus]);

  const lastClose = candles?.length ? toNumber(candles[candles.length - 1]?.close) : null;
  const horizon = Number(ivSurface?.horizonDays ?? path?.horizonDays ?? path?.horizonSessions ?? 14);
  const expectedMove = ivSurface?.expectedMove;

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
              OI Field v2: {fieldForecast.baseBias.toUpperCase()} · confidence {fieldForecast.confidenceScore} · {structureFocus ? "structure-focused zoom" : "full chart view"}
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
          {headerAction ? <div>{headerAction}</div> : null}
        </div>
      </div>

      <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", border: "1px solid rgba(148, 163, 184, 0.12)", background: "#07111f" }}>
        {isLoading ? (
          <div style={{ position: "absolute", top: 10, left: 12, zIndex: 3, color: colors.teal, fontSize: 12, fontWeight: 900, background: "rgba(7,17,31,0.78)", border: "1px solid rgba(34,211,238,0.22)", borderRadius: 999, padding: "0.25rem 0.55rem" }}>
            Loading candles…
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
        {fieldForecast ? <span><strong style={{ color: colors.teal }}>Thick cyan</strong> OI Field v2 base path</span> : null}
        {fieldForecast ? <span><strong style={{ color: colors.green }}>Green/red dashed</strong> field forecast band</span> : null}
        {fieldForecast ? <span><strong style={{ color: "#10b981" }}>Dotted green</strong> wheel support floor</span> : null}
        {path ? <span><strong style={{ color: colors.text }}>Dashed white</strong> legacy base path</span> : null}
        {path ? <span><strong style={{ color: colors.green }}>Green</strong> bullish unlock</span> : null}
        {path ? <span><strong style={{ color: colors.red }}>Red</strong> bearish failure</span> : null}
        {ivSurface ? <span><strong style={{ color: colors.teal }}>Cyan</strong> matched IV band</span> : null}
        {edge || path || matrix ? <span><strong style={{ color: colors.amber }}>Amber</strong> magnet</span> : null}
        {edge || path ? <span><strong style={{ color: "#d946ef" }}>Purple</strong> OI walls</span> : null}
        {flowOverlay ? <span><strong style={{ color: "#22d3ee" }}>Cyan/Pink</strong> flow strike clusters</span> : null}
        {path ? <span>Regime: <strong style={{ color: colors.text }}>{pathRegime(path)}</strong></span> : null}
        {!path && !ivSurface && !edge && !matrix && !flowOverlay && !fieldForecast ? <span>Candles only</span> : null}
      </div>
    </section>
  );
}
