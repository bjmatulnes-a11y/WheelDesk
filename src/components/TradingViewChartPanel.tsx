"use client";

import { useEffect, useRef } from "react";
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
import { PrevailingLevels } from "../lib/oi-prevailing-levels";
import { DailyStructureDrift } from "../lib/daily-structure-compare";
import { ExpirationSummary } from "../lib/types";
import { OIProjectionReport } from "../lib/oi-projection-engine";
import { type OIImpliedPathResult, type OIPathDisplayMode } from "../lib/oi-implied-path-engine";

type Candle = {
  time?: string;
  date?: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

type Props = {
  title: string;
  candles: Candle[];
  prevailingLevels?: PrevailingLevels | null;
  summary?: ExpirationSummary | null;
  structureDrift?: DailyStructureDrift | null;
  projectionReport?: OIProjectionReport | null;
  enhancedOIPath?: OIImpliedPathResult | null;
  oiPathMode?: OIPathDisplayMode;

  showPrevailing?: boolean;
  showPrior?: boolean;
  showSelectedChain?: boolean;
  showOIPath?: boolean;
    
  height?: number;
};

function toChartTime(candle: Candle): UTCTimestamp {
  const raw = candle.time ?? candle.date;
  const d = raw ? new Date(raw) : new Date();
  return Math.floor(d.getTime() / 1000) as UTCTimestamp;
}

function fmt(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return value.toFixed(2);
}

function formatOiCount(level?: { openInterest?: number | null; totalOi?: number | null; oi?: number | null } | null): string {
  const value = level?.openInterest ?? level?.totalOi ?? level?.oi;
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString() : "N/A";
}

function dateToChartTime(date: string): UTCTimestamp {
  return Math.floor(new Date(`${date}T00:00:00`).getTime() / 1000) as UTCTimestamp;
}
export function TradingViewChartPanel({
  title,
  candles,
  prevailingLevels,
  summary,
  structureDrift,
  projectionReport,
  enhancedOIPath,
  oiPathMode = "standard",
  showPrevailing = true,
  showPrior = false,
  showSelectedChain = false,
  showOIPath = false,  
  height = 520
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const oiPathSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const oiPathUpperBandSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const oiPathLowerBandSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const oiPathBullishSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const oiPathBearishSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  const clearPriceLines = () => {
    const series = seriesRef.current;
    if (!series) return;

    for (const line of priceLinesRef.current) {
      try {
        series.removePriceLine(line);
      } catch {
        // no-op: line may already be removed during hot reload
      }
    }

    priceLinesRef.current = [];
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#111827"
      },
      grid: {
        vertLines: { color: "#f3f4f6" },
        horzLines: { color: "#e5e7eb" }
      },
      rightPriceScale: {
        visible: true,
        borderColor: "#d1d5db"
      },
      leftPriceScale: {
        visible: false
      },
      timeScale: {
        borderColor: "#d1d5db",
        timeVisible: false,
        secondsVisible: false
      },
      crosshair: {
        mode: 1
      }
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#16a34a",
      downColor: "#dc2626",
      borderUpColor: "#16a34a",
      borderDownColor: "#dc2626",
      wickUpColor: "#16a34a",
      wickDownColor: "#dc2626",
      priceLineVisible: false
    });
    const oiPathSeries = chart.addSeries(LineSeries, {
      color: "rgba(124,58,237,0.85)",
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: true,
      title: "Base OI Path"
    });

    const oiPathUpperBandSeries = chart.addSeries(LineSeries, {
      color: "rgba(124,58,237,0.14)",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
      title: "OI Path Upper Band"
    });

    const oiPathLowerBandSeries = chart.addSeries(LineSeries, {
      color: "rgba(124,58,237,0.14)",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
      title: "OI Path Lower Band"
    });

    const oiPathBullishSeries = chart.addSeries(LineSeries, {
      color: "rgba(22,163,74,0.62)",
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      title: "Bullish Unlock Path"
    });

    const oiPathBearishSeries = chart.addSeries(LineSeries, {
      color: "rgba(220,38,38,0.62)",
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      title: "Bearish Failure Path"
    });

oiPathSeriesRef.current = oiPathSeries;
    oiPathUpperBandSeriesRef.current = oiPathUpperBandSeries;
    oiPathLowerBandSeriesRef.current = oiPathLowerBandSeries;
    oiPathBullishSeriesRef.current = oiPathBullishSeries;
    oiPathBearishSeriesRef.current = oiPathBearishSeries;
    chartRef.current = chart;
    seriesRef.current = candleSeries;

    const resize = () => {
      if (!containerRef.current) return;
      chart.applyOptions({
        width: containerRef.current.clientWidth
      });
    };

    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(containerRef.current);

    return () => {
      clearPriceLines();
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      oiPathSeriesRef.current = null;
      oiPathUpperBandSeriesRef.current = null;
      oiPathLowerBandSeriesRef.current = null;
      oiPathBullishSeriesRef.current = null;
      oiPathBearishSeriesRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;

    clearPriceLines();

    const data = candles.map((c) => ({
      time: toChartTime(c),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close
    }));
    series.setData(data);
    chart.timeScale().fitContent();
    series.setData(data);
    chart.timeScale().fitContent();
    const oiPathSeries = oiPathSeriesRef.current;
    const oiPathUpperBandSeries = oiPathUpperBandSeriesRef.current;
    const oiPathLowerBandSeries = oiPathLowerBandSeriesRef.current;
    const oiPathBullishSeries = oiPathBullishSeriesRef.current;
    const oiPathBearishSeries = oiPathBearishSeriesRef.current;

    const makePathData = (points: { date: string; value: number }[], lastTime: UTCTimestamp, anchorValue: number) => [
      { time: lastTime, value: anchorValue },
      ...points
        .filter((p) => p.date && Number.isFinite(p.value))
        .map((p) => ({ time: dateToChartTime(p.date), value: p.value }))
    ].sort((a, b) => Number(a.time) - Number(b.time));

    const makeStandalonePathData = (points: { date: string; value: number }[]) => points
      .filter((p) => p.date && Number.isFinite(p.value))
      .map((p) => ({ time: dateToChartTime(p.date), value: p.value }))
      .sort((a, b) => Number(a.time) - Number(b.time));

if (oiPathSeries) {
  if (showOIPath && candles.length) {
    const lastCandle = candles[candles.length - 1];
    const lastTime = toChartTime(lastCandle);
    const lastClose = lastCandle.close;

    if (enhancedOIPath?.basePath?.length) {
      oiPathSeries.setData(makePathData(enhancedOIPath.basePath, lastTime, lastClose));

      const showBands = oiPathMode === "standard" || oiPathMode === "full";
      const showScenarios = oiPathMode === "full";
      const firstUpper = enhancedOIPath.upperBand?.[0]?.value ?? lastClose;
      const firstLower = enhancedOIPath.lowerBand?.[0]?.value ?? lastClose;

      oiPathUpperBandSeries?.setData(showBands ? makePathData(enhancedOIPath.upperBand, lastTime, lastClose) : []);
      oiPathLowerBandSeries?.setData(showBands ? makePathData(enhancedOIPath.lowerBand, lastTime, lastClose) : []);
      oiPathBullishSeries?.setData(showScenarios ? makeStandalonePathData(enhancedOIPath.bullishUnlockPath) : []);
      oiPathBearishSeries?.setData(showScenarios ? makeStandalonePathData(enhancedOIPath.bearishFailurePath) : []);
    } else if (projectionReport?.points?.length) {
      const oiPathData = [
        { time: lastTime, value: lastClose },
        ...projectionReport.points
          .filter((p) => Number.isFinite(p.adjustedCenter))
          .map((p) => ({ time: dateToChartTime(p.expiration), value: p.adjustedCenter }))
      ].sort((a, b) => Number(a.time) - Number(b.time));

      oiPathSeries.setData(oiPathData);
      oiPathUpperBandSeries?.setData([]);
      oiPathLowerBandSeries?.setData([]);
      oiPathBullishSeries?.setData([]);
      oiPathBearishSeries?.setData([]);
    }
  } else {
    oiPathSeries.setData([]);
    oiPathUpperBandSeries?.setData([]);
    oiPathLowerBandSeries?.setData([]);
    oiPathBullishSeries?.setData([]);
    oiPathBearishSeries?.setData([]);
  }
}

    const addLine = (args: {
      price?: number | null;
      color: string;
      title: string;
      dashed?: boolean;
      axisLabelVisible?: boolean;
      width?: 1 | 2 | 3 | 4;
    }) => {
      if (args.price == null || !Number.isFinite(args.price)) return;

      const line = series.createPriceLine({
        price: args.price,
        color: args.color,
        lineWidth: args.width ?? 2,
        lineStyle: args.dashed ? LineStyle.Dashed : LineStyle.Solid,
        axisLabelVisible: args.axisLabelVisible ?? true,
        title: args.title
      });

      priceLinesRef.current.push(line);
    };

    if (showPrevailing) {
      addLine({
        price: prevailingLevels?.resistance?.strike,
        color: "#dc2626",
        title: prevailingLevels?.resistance
          ? `Resistance · Call OI ${formatOiCount(prevailingLevels.resistance)}`
          : "Resistance"
      });

      addLine({
        price: prevailingLevels?.support?.strike,
        color: "#2563eb",
        title: prevailingLevels?.support
          ? `Support · Put OI ${formatOiCount(prevailingLevels.support)}`
          : "Support"
      });

      addLine({
        price: prevailingLevels?.magnet?.strike,
        color: "#7c3aed",
        title: "OI Magnet",
        dashed: true
      });
    }

    if (showOIPath && enhancedOIPath) {
      addLine({
        price: enhancedOIPath.invalidAbove,
        color: "rgba(22,163,74,0.65)",
        title: enhancedOIPath.invalidAbove != null ? `Bullish unlock only above ${enhancedOIPath.invalidAbove.toFixed(2)}` : "Bullish unlock only above",
        dashed: true,
        axisLabelVisible: true,
        width: 1
      });

      addLine({
        price: enhancedOIPath.invalidBelow,
        color: "rgba(220,38,38,0.65)",
        title: enhancedOIPath.invalidBelow != null ? `Bearish failure only below ${enhancedOIPath.invalidBelow.toFixed(2)}` : "Bearish failure only below",
        dashed: true,
        axisLabelVisible: true,
        width: 1
      });
    }

    if (showSelectedChain && summary) {
      addLine({
        price: summary.callWall,
        color: "#ef4444",
        title: `Chain Call Wall ${summary.callWall.toFixed(2)}`,
        dashed: true,
        axisLabelVisible: true,
        width: 1
      });

      addLine({
        price: summary.putWall,
        color: "#3b82f6",
        title: `Chain Put Wall ${summary.putWall.toFixed(2)}`,
        dashed: true,
        axisLabelVisible: true,
        width: 1
      });

      addLine({
        price: summary.upperRange,
        color: "rgba(239,68,68,0.55)",
        title: `Chain Upper ${summary.upperRange.toFixed(2)}`,
        dashed: true,
        axisLabelVisible: false,
        width: 1
      });

      addLine({
        price: summary.lowerRange,
        color: "rgba(37,99,235,0.55)",
        title: `Chain Lower ${summary.lowerRange.toFixed(2)}`,
        dashed: true,
        axisLabelVisible: false,
        width: 1
      });

      addLine({
        price: summary.combinedCenter,
        color: "rgba(124,58,237,0.55)",
        title: `Chain Center ${summary.combinedCenter.toFixed(2)}`,
        dashed: true,
        axisLabelVisible: false,
        width: 1
      });
    }

    if (showPrior && structureDrift?.prior) {
      addLine({
        price: structureDrift.prior.resistance,
        color: "rgba(220,38,38,0.45)",
        title: "",
        dashed: true,
        axisLabelVisible: false,
        width: 1
      });

      addLine({
        price: structureDrift.prior.support,
        color: "rgba(37,99,235,0.45)",
        title: "",
        dashed: true,
        axisLabelVisible: false,
        width: 1
      });

      addLine({
        price: structureDrift.prior.magnet,
        color: "rgba(124,58,237,0.45)",
        title: "",
        dashed: true,
        axisLabelVisible: false,
        width: 1
      });
    }
  }, [
    candles,
    prevailingLevels,
    summary,
    structureDrift,
    showPrevailing,
    showPrior,
    showSelectedChain,
    showOIPath,
    enhancedOIPath,
    oiPathMode
  ]);

  return (
    <section style={{ border: "1px solid #1f2937", borderRadius: 8, background: "#fff", padding: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <div>
          <h3 style={{ margin: 0 }}>{title}</h3>

          {showPrevailing ? (
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              OI Magnet {fmt(prevailingLevels?.magnet?.strike)} · Support {fmt(prevailingLevels?.support?.strike)} · Resistance{" "}
              {fmt(prevailingLevels?.resistance?.strike)}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              Prevailing structure hidden
            </div>
          )}
        </div>

        <div style={{ fontSize: 12, color: "#6b7280", textAlign: "right" }}>
          OI Structure Chart
          {showOIPath && enhancedOIPath ? <div>{enhancedOIPath.regime.replace(/_/g, " ")} · {enhancedOIPath.confidence} confidence · {oiPathMode}</div> : null}
        </div>
      </div>

      <div ref={containerRef} style={{ width: "100%", height, marginTop: 8 }} />

      {showOIPath && enhancedOIPath ? (
        <div
          style={{
            marginTop: 8,
            border: "1px solid #ede9fe",
            borderRadius: 6,
            background: "#faf5ff",
            padding: "0.45rem 0.6rem",
            fontSize: 12,
            color: "#4b5563",
            display: "flex",
            gap: "0.8rem",
            flexWrap: "wrap"
          }}
        >
          <span><strong style={{ color: "#7c3aed" }}>Purple</strong> = active base path while structure holds.</span>
          <span><strong style={{ color: "#16a34a" }}>Green</strong> = conditional only above bullish unlock.</span>
          <span><strong style={{ color: "#dc2626" }}>Red</strong> = conditional only below bearish failure.</span>
          <span>Active scenario: <strong>{enhancedOIPath.activeScenario.replace(/_/g, " ")}</strong>.</span>
          <span>CC: <strong>{enhancedOIPath.tradePermissions.coveredCalls}</strong></span>
          <span>CSP: <strong>{enhancedOIPath.tradePermissions.cashSecuredPuts}</strong></span>
          <span>Mode: <strong>{oiPathMode}</strong>. Horizon: <strong>{enhancedOIPath.horizonSessions} sessions</strong>.</span>
        </div>
      ) : null}
    </section>
  );
}