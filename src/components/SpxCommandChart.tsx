"use client";

import {
  CandlestickSeries,
  ColorType,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ZeroDteChainRow, ZeroDteRecommendation } from "../lib/zeroDteOiIntelligence";
import { PremiumHistoryPanel } from "./execution/PremiumHistoryPanel";
import { AdvancedStrikeHeatmap } from "./AdvancedStrikeHeatmap";
import { DealerAnalyticsPanel } from "./DealerAnalyticsPanel";
import { MapEnginePanel } from "./MapEnginePanel";
import { useSessionMapManager } from "../lib/session/useSessionMapManager";
import { buildExecutionRead } from "../lib/execution/engine";
import { appendPremiumPoint, estimateIronFlyCredit } from "../lib/execution/premium";
import { loadPremiumHistory, savePremiumHistory } from "../lib/execution/storage";
import type { ExecutionRead, PremiumPoint } from "../lib/execution/types";
import { buildZeroDteLeastResistancePath } from "../lib/zeroDteLeastResistancePath";

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type PriceHistoryResponse = {
  ok: boolean;
  provider?: string;
  symbol?: string;
  previousClose?: number | null;
  candles?: Candle[];
  error?: string;
};

type HarvestSymbol = {
  symbol: "SPX" | "SPY";
  providerSymbol?: string;
  price: number;
  expirationDate: string;
  isZeroDte?: boolean;
  rows: ZeroDteChainRow[];
  source: "schwab" | "yahoo";
};

type HarvestResponse = {
  tradeDate: string;
  generatedAt: string;
  status: "ok" | "partial" | "error";
  spx?: HarvestSymbol;
  spy?: HarvestSymbol;
  recommendation?: ZeroDteRecommendation;
  errors?: string[];
  provider?: string;
};

type OverlayKey =
  | "vwap"
  | "ema9"
  | "ema20"
  | "ema50"
  | "walls"
  | "pin"
  | "center"
  | "expectedMove"
  | "forecast"
  | "leastResistance"
  | "structure"
  | "heatmap";

const DEFAULT_OVERLAYS: Record<OverlayKey, boolean> = {
  vwap: true,
  ema9: true,
  ema20: true,
  ema50: false,
  walls: true,
  pin: true,
  center: true,
  expectedMove: true,
  forecast: false,
  leastResistance: true,
  structure: true,
  heatmap: true,
};

const OVERLAY_LABELS: Array<[OverlayKey, string]> = [
  ["vwap", "VWAP"],
  ["ema9", "EMA 9"],
  ["ema20", "EMA 20"],
  ["ema50", "EMA 50"],
  ["walls", "Put / Call Walls"],
  ["pin", "Pin"],
  ["center", "IF Center"],
  ["expectedMove", "Expected Move"],
  ["forecast", "Legacy Forecast Band"],
  ["leastResistance", "Least Resistance Path"],
  ["structure", "Structure Levels"],
  ["heatmap", "OI Heatmap"],
];

export default function SpxCommandChart() {
  const chartHostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineSeriesRef = useRef<Array<ISeriesApi<"Line">>>([]);
  const hasInitialFitRef = useRef(false);

  const [candles, setCandles] = useState<Candle[]>([]);
  const [harvest, setHarvest] = useState<HarvestResponse | null>(null);
  const [frequency, setFrequency] = useState<1 | 5>(1);
  const [overlays, setOverlays] = useState(DEFAULT_OVERLAYS);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [premiumHistory, setPremiumHistory] = useState<PremiumPoint[]>([]);

  const recommendation = harvest?.recommendation;
  const spxRows = harvest?.spx?.rows ?? [];
  const lastCandle = candles.at(-1);
  const currentPrice = recommendation?.spxPrice ?? harvest?.spx?.price ?? lastCandle?.close ?? 0;

  const mapManager = useSessionMapManager({
    tradeDate: harvest?.tradeDate,
    generatedAt: harvest?.generatedAt,
    recommendation,
    rows: spxRows,
  });

  const controllingMap =
    mapManager.state?.phase === "ACTIVE"
      ? mapManager.state.active
      : mapManager.state?.opening;

  const analytics = useMemo(() => {
    const ema9 = calculateEma(candles, 9);
    const ema20 = calculateEma(candles, 20);
    const ema50 = calculateEma(candles, 50);
    const vwap = calculateVwap(candles);

    return { ema9, ema20, ema50, vwap };
  }, [candles]);

  const heatRows = useMemo(() => {
    if (!recommendation) return [];
    const spot = recommendation.spxPrice;
    return [...recommendation.spxChainMap]
      .filter((row) => Math.abs(row.strike - spot) <= Math.max(recommendation.expectedMove * 1.4, 80))
      .sort((a, b) => b.score - a.score)
      .slice(0, 14)
      .sort((a, b) => b.strike - a.strike);
  }, [recommendation]);

  const leastResistancePath = useMemo(() => {
    if (!recommendation || !lastCandle) return null;
    return buildZeroDteLeastResistancePath({
      recommendation,
      lastCandleTime: lastCandle.time,
      candleFrequencyMinutes: frequency,
    });
  }, [frequency, lastCandle, recommendation]);

  const commandRead = useMemo(() => {
    if (!recommendation) return null;

    const distanceToCenter = Math.abs(
      recommendation.spxPrice - recommendation.suggestedCenter,
    );
    const normalizedDistance =
      recommendation.expectedMove > 0
        ? distanceToCenter / recommendation.expectedMove
        : 1;

    const harvestScore = clamp(
      Math.round(
        recommendation.confidenceScore * 0.55 +
          recommendation.alignmentScore * 0.25 +
          (100 - Math.abs(recommendation.dealerPressure)) * 0.2 -
          normalizedDistance * 18,
      ),
      0,
      100,
    );

    const zone =
      harvestScore >= 78
        ? "HARVEST"
        : harvestScore >= 58
          ? "WATCH"
          : "AVOID";

    return {
      harvestScore,
      zone,
      distanceToCenter,
      pressure: recommendation.dealerPressure,
      pressureBias: recommendation.pressureBias,
    };
  }, [recommendation]);

  const load = useCallback(async () => {
    try {
      setError(null);

      const [historyResponse, harvestResponse] = await Promise.all([
        fetch(
          `/api/brokers/schwab/price-history?symbol=${encodeURIComponent("$SPX")}&frequency=${frequency}`,
          { cache: "no-store" },
        ),
        fetch("/api/zero-dte/harvest-schwab", { cache: "no-store" }),
      ]);

      const historyJson = (await historyResponse.json()) as PriceHistoryResponse;
      const harvestJson = (await harvestResponse.json()) as HarvestResponse;

      if (!historyResponse.ok || !historyJson.ok) {
        throw new Error(historyJson.error || "SPX price history failed.");
      }

      if (!harvestResponse.ok && !harvestJson.recommendation) {
        throw new Error(
          harvestJson.errors?.join(" ") || "Schwab 0DTE harvest failed.",
        );
      }

      setCandles(historyJson.candles ?? []);
      setHarvest(harvestJson);
      setLastRefresh(new Date().toISOString());
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "SPX command chart failed.",
      );
    } finally {
      setLoading(false);
    }
  }, [frequency]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    hasInitialFitRef.current = false;
  }, [frequency]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(load, 5000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, load]);

  useEffect(() => {
    const host = chartHostRef.current;
    if (!host) return;

    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#071018" },
        textColor: "#a8b5c7",
        panes: {
          separatorColor: "#152536",
          separatorHoverColor: "#1d3449",
          enableResize: true,
        },
      },
      grid: {
        vertLines: { color: "rgba(81, 112, 137, 0.12)" },
        horzLines: { color: "rgba(81, 112, 137, 0.12)" },
      },
      rightPriceScale: {
        borderColor: "#223548",
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: "#223548",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: 9,
      },
      crosshair: {
        vertLine: { color: "#5d7185", labelBackgroundColor: "#223548" },
        horzLine: { color: "#5d7185", labelBackgroundColor: "#223548" },
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#16c784",
      downColor: "#ea3943",
      borderUpColor: "#16c784",
      borderDownColor: "#ea3943",
      wickUpColor: "#16c784",
      wickDownColor: "#ea3943",
      priceLineVisible: true,
      lastValueVisible: true,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      lineSeriesRef.current = [];
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    if (!chart || !candleSeries || !candles.length) return;

    candleSeries.setData(
      candles.map((candle) => ({
        time: candle.time as UTCTimestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
    );

    for (const series of lineSeriesRef.current) {
      chart.removeSeries(series);
    }
    lineSeriesRef.current = [];

    const addLine = (
      values: Array<{ time: number; value: number }>,
      color: string,
      width: 1 | 2 | 3 = 2,
      style = LineStyle.Solid,
    ) => {
      if (!values.length) return;
      const series = chart.addSeries(LineSeries, {
        color,
        lineWidth: width,
        lineStyle: style,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      series.setData(
        values.map((value) => ({
          time: value.time as UTCTimestamp,
          value: value.value,
        })),
      );
      lineSeriesRef.current.push(series);
    };

    if (overlays.vwap) addLine(analytics.vwap, "#00b7ff", 2);
    if (overlays.ema9) addLine(analytics.ema9, "#f5c542", 2);
    if (overlays.ema20) addLine(analytics.ema20, "#b487ff", 2);
    if (overlays.ema50) addLine(analytics.ema50, "#ff7ab6", 2);

    const visibleTimes = candles.map((item) => item.time);
    const horizontal = (
      value: number | null | undefined,
      color: string,
      width: 1 | 2 | 3 = 2,
      style = LineStyle.Solid,
    ) => {
      if (!Number.isFinite(value) || !visibleTimes.length) return;
      addLine(
        visibleTimes.map((time) => ({ time, value: Number(value) })),
        color,
        width,
        style,
      );
    };

    if (recommendation) {
      if (overlays.walls) {
        horizontal(recommendation.spx.callWall, "#ff8a34", 2);
        horizontal(recommendation.spx.putWall, "#2f80ed", 2);
      }

      if (overlays.pin) {
        horizontal(recommendation.spx.strongestPin, "#f4f7fb", 2, LineStyle.Dashed);
      }

      if (overlays.center) {
        horizontal(recommendation.suggestedCenter, "#ffd400", 3);
      }

      if (overlays.expectedMove) {
        horizontal(
          recommendation.spxPrice + recommendation.expectedMove,
          "#7f8fa4",
          1,
          LineStyle.Dashed,
        );
        horizontal(
          recommendation.spxPrice - recommendation.expectedMove,
          "#7f8fa4",
          1,
          LineStyle.Dashed,
        );
      }

      if (overlays.forecast) {
        const upper = recommendation.suggestedCenter + recommendation.expectedMove * 0.5;
        const lower = recommendation.suggestedCenter - recommendation.expectedMove * 0.5;
        horizontal(upper, "#20c997", 1, LineStyle.Dotted);
        horizontal(lower, "#20c997", 1, LineStyle.Dotted);
      }

      if (overlays.leastResistance && leastResistancePath) {
        addLine(
          leastResistancePath.points.map((point) => ({ time: point.time, value: point.crest })),
          "rgba(32,201,151,.72)",
          1,
          LineStyle.Dotted,
        );
        addLine(
          leastResistancePath.points.map((point) => ({ time: point.time, value: point.center })),
          "#20c997",
          3,
          LineStyle.Solid,
        );
        addLine(
          leastResistancePath.points.map((point) => ({ time: point.time, value: point.trough })),
          "rgba(32,201,151,.72)",
          1,
          LineStyle.Dotted,
        );
      }

      if (mapManager.state) {
        const opening = mapManager.state.opening;
        horizontal(opening.center, "rgba(255,212,0,.42)", 1, LineStyle.Dashed);
        horizontal(opening.lowerWing, "rgba(127,143,164,.36)", 1, LineStyle.Dashed);
        horizontal(opening.upperWing, "rgba(127,143,164,.36)", 1, LineStyle.Dashed);

        if (mapManager.state.phase === "TRANSITION" && mapManager.state.candidate) {
          horizontal(mapManager.state.candidate.center, "#f5c542", 2, LineStyle.Dotted);
          horizontal(mapManager.state.candidate.lowerWing, "#b89a36", 1, LineStyle.Dotted);
          horizontal(mapManager.state.candidate.upperWing, "#b89a36", 1, LineStyle.Dotted);
        }

        if (mapManager.state.phase === "ACTIVE") {
          horizontal(mapManager.state.active.center, "#71e0b4", 3);
          horizontal(mapManager.state.active.lowerWing, "#2f9a78", 1);
          horizontal(mapManager.state.active.upperWing, "#2f9a78", 1);
        }

        if (overlays.structure) {
          const structure =
            (mapManager.state.phase === "ACTIVE"
              ? mapManager.state.active?.structure
              : mapManager.state.phase === "TRANSITION" && mapManager.state.candidate
                ? mapManager.state.candidate.structure
                : mapManager.state.opening?.structure) ?? null;

          if (structure) {
            horizontal(structure?.gammaFlip ?? null, "#ff5fa2", 2, LineStyle.Dashed);
            horizontal(structure?.zeroGamma ?? null, "#bc7cff", 1, LineStyle.Dotted);
            horizontal(structure?.dealerNeutral ?? null, "#55d6ff", 2, LineStyle.Dashed);
            horizontal(structure?.maxPain ?? null, "#d8e2eb", 1, LineStyle.Dotted);
          }
        }
      }
    }

    if (!hasInitialFitRef.current) {
      chart.timeScale().fitContent();
      hasInitialFitRef.current = true;
    }
  }, [analytics, candles, leastResistancePath, mapManager.state, overlays, recommendation]);

  function toggleOverlay(key: OverlayKey) {
    setOverlays((current) => ({ ...current, [key]: !current[key] }));
  }

  function resetChartView() {
    chartRef.current?.timeScale().fitContent();
    hasInitialFitRef.current = true;
  }

  const simulatedCredit = useMemo(() => {
    if (!recommendation || !spxRows.length) return null;
    return estimateIronFlyCredit(spxRows, {
      lowerWing: recommendation.lowerWing,
      shortPut: recommendation.suggestedCenter,
      shortCall: recommendation.suggestedCenter,
      upperWing: recommendation.upperWing,
    });
  }, [recommendation, spxRows]);

  useEffect(() => {
    if (!harvest?.tradeDate) return;
    setPremiumHistory(loadPremiumHistory(harvest.tradeDate));
  }, [harvest?.tradeDate]);

  useEffect(() => {
    if (!harvest?.tradeDate || !harvest.generatedAt) return;
    setPremiumHistory((current) => {
      const next = appendPremiumPoint(current, harvest.generatedAt, simulatedCredit);
      savePremiumHistory(harvest.tradeDate, next);
      return next;
    });
  }, [harvest?.generatedAt, harvest?.tradeDate, simulatedCredit]);

  const liveExecutionRead: ExecutionRead | null = useMemo(() => {
    if (!recommendation || !harvest?.generatedAt) return null;

    return buildExecutionRead({
      recommendation,
      rows: spxRows,
      generatedAt: harvest.generatedAt,
      premiumHistory,
      position: null,
    });
  }, [harvest?.generatedAt, premiumHistory, recommendation, spxRows]);

  return (
    <section style={styles.shell}>
      <div style={styles.topBar}>
        <div>
          <div style={styles.eyebrow}>Schwab Live Market Intelligence</div>
          <div style={styles.titleRow}>
            <h2 style={styles.title}>SPX Command Chart</h2>
            <span style={styles.livePill}>
              <span style={styles.liveDot} />
              REST LIVE · 5s
            </span>
          </div>
          <div style={styles.subTitle}>
            Broker-authorized SPX candles with WheelDesk structure overlays.
          </div>
        </div>

        <div style={styles.actions}>
          <select
            value={frequency}
            onChange={(event) => setFrequency(Number(event.target.value) as 1 | 5)}
            style={styles.select}
          >
            <option value={1}>1 minute</option>
            <option value={5}>5 minute</option>
          </select>

          <label style={styles.autoLabel}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
            />
            Auto
          </label>

          <button onClick={resetChartView} style={styles.secondaryButton}>
            Reset View
          </button>

          <button onClick={load} style={styles.refreshButton}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      <div style={styles.metricGrid}>
        <MetricCard label="SPX" value={currentPrice ? currentPrice.toFixed(2) : "—"} />
        <MetricCard
          label="IF Center"
          value={recommendation?.suggestedCenter?.toFixed(0) ?? "—"}
        />
        <MetricCard
          label="Put Wall"
          value={recommendation?.spx.putWall?.toFixed(0) ?? "—"}
        />
        <MetricCard
          label="Call Wall"
          value={recommendation?.spx.callWall?.toFixed(0) ?? "—"}
        />
        <MetricCard
          label="Pin"
          value={recommendation?.spx.strongestPin?.toFixed(0) ?? "—"}
        />
        <MetricCard
          label="Dealer Pressure"
          value={
            recommendation
              ? `${recommendation.dealerPressure > 0 ? "+" : ""}${recommendation.dealerPressure}`
              : "—"
          }
        />
        <MetricCard
          label="Confidence"
          value={
            recommendation ? `${recommendation.confidenceScore}%` : "—"
          }
        />
        <MetricCard
          label="Expected Move"
          value={recommendation?.expectedMove?.toFixed(1) ?? "—"}
        />
        <MetricCard
          label="Path Bias"
          value={leastResistancePath ? `${leastResistancePath.direction} · ${leastResistancePath.confidence}%` : "—"}
        />
      </div>

      <div style={styles.overlayBar}>
        {OVERLAY_LABELS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => toggleOverlay(key)}
            style={{
              ...styles.overlayButton,
              ...(overlays[key] ? styles.overlayButtonActive : {}),
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <div style={styles.error}>{error}</div> : null}

      <div style={styles.commandGrid}>
        <div style={styles.chartPanel}>
          <div ref={chartHostRef} style={styles.chartHost} />

          <div style={styles.legend}>
            <LegendItem color="#ff8a34" text="Call Wall" />
            <LegendItem color="#2f80ed" text="Put Wall" />
            <LegendItem color="#f4f7fb" text="Pin" />
            <LegendItem color="#ffd400" text="IF Center" />
            <LegendItem color="#20c997" text="Least-resistance center / crest / trough" />
          </div>
        </div>

        <aside style={styles.sideRail}>
          <div
            style={{
              ...styles.executionCard,
              ...(liveExecutionRead?.zone === "harvest"
                ? styles.executionHarvest
                : liveExecutionRead?.zone === "watch"
                  ? styles.executionWatch
                  : liveExecutionRead?.zone === "manage"
                    ? styles.executionManage
                    : styles.executionAvoid),
            }}
          >
            <div style={styles.signalLabel}>Execution Engine</div>
            <div style={styles.executionAction}>
              {liveExecutionRead?.action ?? "WAIT"}
            </div>
            <div style={styles.scoreValue}>
              {liveExecutionRead?.confidence ?? 0}
            </div>
            <div style={styles.signalNote}>Confidence</div>

            <div style={styles.reasonList}>
              {(liveExecutionRead?.reasons ?? ["Building live execution context"])
                .slice(0, 4)
                .map((reason) => (
                  <div key={reason} style={styles.reasonItem}>
                    <span style={styles.reasonDot} />
                    {reason}
                  </div>
                ))}
            </div>
          </div>

          <div style={styles.railCard}>
            <div style={styles.railTitle}>Live Iron Fly</div>
            <RailRow
              label="Center"
              value={recommendation?.suggestedCenter?.toFixed(0) ?? "—"}
            />
            <RailRow
              label="Wings"
              value={
                recommendation
                  ? `${recommendation.lowerWing.toFixed(0)} / ${recommendation.upperWing.toFixed(0)}`
                  : "—"
              }
            />
            <RailRow
              label="Current Credit"
              value={
                liveExecutionRead?.currentCredit == null
                  ? "—"
                  : liveExecutionRead.currentCredit.toFixed(2)
              }
            />
            <RailRow
              label="Peak Credit"
              value={
                liveExecutionRead?.peakCredit == null
                  ? "—"
                  : liveExecutionRead.peakCredit.toFixed(2)
              }
            />
            <RailRow
              label="Velocity"
              value={
                liveExecutionRead
                  ? `${liveExecutionRead.premiumVelocityPerMinute >= 0 ? "+" : ""}${liveExecutionRead.premiumVelocityPerMinute.toFixed(3)}/m`
                  : "—"
              }
            />
            <RailRow
              label="Off Peak"
              value={
                liveExecutionRead?.creditOffPeakPct == null
                  ? "—"
                  : `${liveExecutionRead.creditOffPeakPct.toFixed(1)}%`
              }
            />
          </div>

          <div style={styles.railCard}>
            <div style={styles.railTitle}>Harvest Score</div>
            <div style={styles.breakdownList}>
              {(liveExecutionRead?.components ?? []).map((component) => (
                <div key={component.key} style={styles.breakdownRow}>
                  <div style={styles.breakdownHeader}>
                    <span>{component.label}</span>
                    <strong>
                      {component.score.toFixed(1)}/{component.max}
                    </strong>
                  </div>
                  <div style={styles.breakdownTrack}>
                    <div
                      style={{
                        ...styles.breakdownFill,
                        width: `${Math.max(
                          0,
                          Math.min(100, (component.score / component.max) * 100),
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={styles.railCard}>
            <div style={styles.railTitle}>Structure Read</div>
            <RailRow
              label="Bias"
              value={recommendation?.pressureBias?.toUpperCase() ?? "—"}
            />
            <RailRow
              label="Center Distance"
              value={
                liveExecutionRead
                  ? `${liveExecutionRead.centerDistance.toFixed(1)} pts`
                  : "—"
              }
            />
            <RailRow label="SPX Rows" value={String(spxRows.length)} />
            <RailRow
              label="Expiration"
              value={harvest?.spx?.expirationDate ?? "—"}
            />
            <RailRow
              label="Feed"
              value={harvest?.provider?.toUpperCase() ?? "SCHWAB"}
            />
          </div>
        </aside>
      </div>

      {mapManager.state ? (
        <MapEnginePanel
          state={mapManager.state}
          onReset={mapManager.reset}
        />
      ) : null}

      {recommendation && harvest?.tradeDate ? (
        <DealerAnalyticsPanel
          tradeDate={harvest.tradeDate}
          generatedAt={harvest.generatedAt}
          spot={currentPrice}
          pressure={recommendation.dealerPressure}
          spxPressure={recommendation.spxDealerPressure}
          spyPressure={recommendation.spyDealerPressure}
          pressureBias={recommendation.pressureBias}
          source={recommendation.dealerPressureSource}
          support={recommendation.spx.putWall}
          resistance={recommendation.spx.callWall}
          pin={recommendation.spx.strongestPin}
          center={recommendation.suggestedCenter}
          expectedMove={recommendation.expectedMove}
          confidence={recommendation.confidenceScore}
          mapState={mapManager.state?.phase ?? "OPENING"}
          openingPressure={mapManager.state?.opening.dealerPressure ?? null}
          controllingPressure={controllingMap?.dealerPressure ?? null}
        />
      ) : null}

      {overlays.heatmap && recommendation && harvest?.tradeDate ? (
        <AdvancedStrikeHeatmap
          tradeDate={harvest.tradeDate}
          generatedAt={harvest.generatedAt}
          spot={currentPrice}
          center={recommendation.suggestedCenter}
          callWall={recommendation.spx.callWall}
          putWall={recommendation.spx.putWall}
          pin={recommendation.spx.strongestPin}
          expectedMove={recommendation.expectedMove}
          rows={spxRows}
          openingBaseline={mapManager.state?.opening.strikes ?? null}
          mapState={mapManager.state?.phase ?? "OPENING"}
        />
      ) : null}

      <div style={styles.premiumSection}>
        <PremiumHistoryPanel
          history={premiumHistory}
          read={liveExecutionRead}
        />
      </div>
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.metricCard}>
      <div style={styles.metricLabel}>{label}</div>
      <div style={styles.metricValue}>{value}</div>
    </div>
  );
}

function RailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.railRow}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LegendItem({ color, text }: { color: string; text: string }) {
  return (
    <span style={styles.legendItem}>
      <span style={{ ...styles.legendSwatch, background: color }} />
      {text}
    </span>
  );
}

function calculateEma(candles: Candle[], period: number) {
  if (!candles.length) return [];
  const multiplier = 2 / (period + 1);
  let previous = candles[0].close;

  return candles.map((candle, index) => {
    const value =
      index === 0
        ? candle.close
        : candle.close * multiplier + previous * (1 - multiplier);
    previous = value;
    return { time: candle.time, value };
  });
}

function calculateVwap(candles: Candle[]) {
  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;

  return candles.map((candle) => {
    const typical = (candle.high + candle.low + candle.close) / 3;
    const volume = Math.max(candle.volume, 1);
    cumulativePriceVolume += typical * volume;
    cumulativeVolume += volume;

    return {
      time: candle.time,
      value: cumulativePriceVolume / cumulativeVolume,
    };
  });
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    background: "#050b10",
    color: "#eef5fb",
    border: "1px solid #162536",
    borderRadius: 18,
    padding: 18,
    boxShadow: "0 24px 80px rgba(0,0,0,.32)",
  },
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    alignItems: "flex-start",
    flexWrap: "wrap",
  },
  eyebrow: {
    color: "#55d6ff",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginTop: 4,
  },
  title: {
    fontSize: 28,
    margin: 0,
  },
  livePill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    border: "1px solid #1f6b50",
    background: "rgba(22,199,132,.1)",
    color: "#7ff2bd",
    borderRadius: 999,
    padding: "5px 9px",
    fontSize: 10,
    fontWeight: 800,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "#16c784",
    boxShadow: "0 0 12px #16c784",
  },
  subTitle: {
    color: "#7f91a5",
    marginTop: 5,
    fontSize: 13,
  },
  actions: {
    display: "flex",
    gap: 8,
    alignItems: "center",
  },
  select: {
    background: "#0c1721",
    color: "#eaf3fb",
    border: "1px solid #25394b",
    borderRadius: 9,
    padding: "9px 10px",
  },
  autoLabel: {
    display: "flex",
    gap: 7,
    alignItems: "center",
    color: "#a9b8c7",
    fontSize: 12,
  },
  secondaryButton: {
    background: "#0c1721",
    color: "#dce8f2",
    border: "1px solid #25394b",
    borderRadius: 9,
    padding: "10px 12px",
    fontWeight: 750,
    cursor: "pointer",
  },
  refreshButton: {
    background: "#177ddc",
    color: "white",
    border: 0,
    borderRadius: 9,
    padding: "10px 14px",
    fontWeight: 800,
    cursor: "pointer",
  },
  metricGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(125px, 1fr))",
    gap: 9,
    marginTop: 17,
  },
  metricCard: {
    background: "#0a141d",
    border: "1px solid #16283a",
    borderRadius: 11,
    padding: "10px 12px",
  },
  metricLabel: {
    color: "#708399",
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.9,
    fontWeight: 800,
  },
  metricValue: {
    fontSize: 19,
    fontWeight: 850,
    marginTop: 4,
  },
  overlayBar: {
    display: "flex",
    flexWrap: "wrap",
    gap: 7,
    marginTop: 13,
    marginBottom: 12,
  },
  overlayButton: {
    border: "1px solid #26394b",
    color: "#8295aa",
    background: "#0a131c",
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 11,
    cursor: "pointer",
  },
  overlayButtonActive: {
    color: "#eaf7ff",
    background: "#12324a",
    borderColor: "#2d709e",
  },
  error: {
    background: "rgba(234,57,67,.1)",
    border: "1px solid rgba(234,57,67,.38)",
    color: "#ff9aa1",
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  commandGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 265px",
    gap: 12,
  },
  chartPanel: {
    position: "relative",
    minWidth: 0,
    background: "#071018",
    border: "1px solid #152536",
    borderRadius: 13,
    overflow: "hidden",
  },
  chartHost: {
    width: "100%",
    height: 610,
  },
  legend: {
    position: "absolute",
    left: 12,
    bottom: 10,
    display: "flex",
    gap: 11,
    flexWrap: "wrap",
    background: "rgba(4,10,15,.82)",
    border: "1px solid #1b2c3d",
    borderRadius: 8,
    padding: "6px 8px",
    fontSize: 10,
    color: "#b6c2cf",
    pointerEvents: "none",
  },
  legendItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
  },
  legendSwatch: {
    width: 11,
    height: 3,
    borderRadius: 2,
  },
  sideRail: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  signalCard: {
    borderRadius: 13,
    padding: 16,
    textAlign: "center",
    border: "1px solid #26394b",
  },
  signalHarvest: {
    background: "linear-gradient(160deg, rgba(22,199,132,.24), rgba(4,33,24,.8))",
    borderColor: "rgba(22,199,132,.55)",
  },
  signalWatch: {
    background: "linear-gradient(160deg, rgba(245,197,66,.22), rgba(38,31,8,.85))",
    borderColor: "rgba(245,197,66,.5)",
  },
  signalAvoid: {
    background: "linear-gradient(160deg, rgba(234,57,67,.22), rgba(42,9,12,.85))",
    borderColor: "rgba(234,57,67,.5)",
  },
  signalLabel: {
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
    opacity: 0.76,
  },
  signalValue: {
    fontSize: 25,
    fontWeight: 900,
    marginTop: 4,
  },
  scoreValue: {
    fontSize: 58,
    fontWeight: 950,
    lineHeight: 1,
    marginTop: 7,
  },
  signalNote: {
    fontSize: 11,
    opacity: 0.7,
    marginTop: 5,
  },
  railCard: {
    background: "#0a141d",
    border: "1px solid #16283a",
    borderRadius: 13,
    padding: 13,
  },
  railTitle: {
    fontWeight: 850,
    fontSize: 13,
    marginBottom: 8,
  },
  railRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    borderTop: "1px solid #152536",
    padding: "8px 0",
    fontSize: 11,
    color: "#8294a7",
  },
  placeholderGraph: {
    height: 64,
    borderRadius: 8,
    marginTop: 8,
    display: "grid",
    placeItems: "center",
    textAlign: "center",
    padding: 8,
    color: "#5f7387",
    fontSize: 10,
    border: "1px dashed #294056",
    background:
      "linear-gradient(135deg, transparent 35%, rgba(39,97,139,.22) 36%, transparent 37%, transparent 62%, rgba(39,97,139,.18) 63%, transparent 64%)",
  },
  heatmapCard: {
    marginTop: 12,
    background: "#08121a",
    border: "1px solid #16283a",
    borderRadius: 13,
    padding: 14,
  },
  heatmapHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    alignItems: "flex-start",
  },
  heatmapNote: {
    color: "#708399",
    fontSize: 11,
  },
  timeStamp: {
    color: "#60758b",
    fontSize: 10,
  },
  heatRows: {
    display: "grid",
    gap: 5,
    marginTop: 12,
  },
  heatRow: {
    display: "grid",
    gridTemplateColumns: "90px minmax(0,1fr) 70px",
    gap: 10,
    alignItems: "center",
  },
  heatStrike: {
    fontSize: 11,
    color: "#b9c5d1",
    display: "flex",
    alignItems: "center",
    gap: 5,
  },
  spotBadge: {
    fontSize: 7,
    color: "#06100b",
    background: "#16c784",
    borderRadius: 4,
    padding: "2px 4px",
    fontWeight: 900,
  },
  heatTrack: {
    height: 8,
    borderRadius: 999,
    background: "#122231",
    overflow: "hidden",
  },
  heatFill: {
    height: "100%",
    borderRadius: 999,
    background: "linear-gradient(90deg, #194e70, #18b6ed, #a9f1ff)",
  },
  heatValue: {
    textAlign: "right",
    color: "#6f8295",
    fontSize: 10,
  },
  executionCard: {
    borderRadius: 13,
    padding: 16,
    textAlign: "center",
    border: "1px solid #26394b",
  },
  executionHarvest: {
    background: "linear-gradient(160deg, rgba(22,199,132,.24), rgba(4,33,24,.8))",
    borderColor: "rgba(22,199,132,.55)",
  },
  executionWatch: {
    background: "linear-gradient(160deg, rgba(245,197,66,.22), rgba(38,31,8,.85))",
    borderColor: "rgba(245,197,66,.5)",
  },
  executionManage: {
    background: "linear-gradient(160deg, rgba(66,165,245,.22), rgba(8,27,43,.85))",
    borderColor: "rgba(66,165,245,.5)",
  },
  executionAvoid: {
    background: "linear-gradient(160deg, rgba(234,57,67,.22), rgba(42,9,12,.85))",
    borderColor: "rgba(234,57,67,.5)",
  },
  executionAction: {
    fontSize: 28,
    fontWeight: 950,
    marginTop: 5,
  },
  reasonList: {
    display: "grid",
    gap: 7,
    marginTop: 14,
    textAlign: "left",
  },
  reasonItem: {
    display: "flex",
    gap: 7,
    alignItems: "flex-start",
    fontSize: 10,
    color: "#d4dde5",
    lineHeight: 1.35,
  },
  reasonDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#55d6ff",
    marginTop: 4,
    flex: "0 0 auto",
  },
  breakdownList: {
    display: "grid",
    gap: 10,
  },
  breakdownRow: {
    display: "grid",
    gap: 4,
  },
  breakdownHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    color: "#8ea2b5",
    fontSize: 9,
  },
  breakdownTrack: {
    height: 6,
    borderRadius: 999,
    background: "#122333",
    overflow: "hidden",
  },
  breakdownFill: {
    height: "100%",
    borderRadius: 999,
    background: "linear-gradient(90deg,#196e9c,#20c997)",
  },
  premiumSection: {
    marginTop: 12,
  },

};
