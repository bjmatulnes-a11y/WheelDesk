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
import { ExecutionCockpit } from "./execution/ExecutionCockpit";

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
  forecast: true,
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
  ["forecast", "Forecast Band"],
  ["heatmap", "OI Heatmap"],
];

export default function SpxCommandChart() {
  const chartHostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineSeriesRef = useRef<Array<ISeriesApi<"Line">>>([]);

  const [candles, setCandles] = useState<Candle[]>([]);
  const [harvest, setHarvest] = useState<HarvestResponse | null>(null);
  const [frequency, setFrequency] = useState<1 | 5>(1);
  const [overlays, setOverlays] = useState(DEFAULT_OVERLAYS);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recommendation = harvest?.recommendation;
  const spxRows = harvest?.spx?.rows ?? [];
  const lastCandle = candles.at(-1);
  const currentPrice = recommendation?.spxPrice ?? harvest?.spx?.price ?? lastCandle?.close ?? 0;

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
    }

    chart.timeScale().fitContent();
  }, [analytics, candles, overlays, recommendation]);

  function toggleOverlay(key: OverlayKey) {
    setOverlays((current) => ({ ...current, [key]: !current[key] }));
  }

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
            <LegendItem color="#20c997" text="Forecast" />
          </div>
        </div>

        <aside style={styles.sideRail}>
          <div
            style={{
              ...styles.signalCard,
              ...(commandRead?.zone === "HARVEST"
                ? styles.signalHarvest
                : commandRead?.zone === "WATCH"
                  ? styles.signalWatch
                  : styles.signalAvoid),
            }}
          >
            <div style={styles.signalLabel}>Execution State</div>
            <div style={styles.signalValue}>{commandRead?.zone ?? "WAIT"}</div>
            <div style={styles.scoreValue}>
              {commandRead?.harvestScore ?? 0}
            </div>
            <div style={styles.signalNote}>Harvest score</div>
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
                commandRead
                  ? `${commandRead.distanceToCenter.toFixed(1)} pts`
                  : "—"
              }
            />
            <RailRow
              label="SPX Rows"
              value={String(spxRows.length)}
            />
            <RailRow
              label="Expiration"
              value={harvest?.spx?.expirationDate ?? "—"}
            />
            <RailRow
              label="Feed"
              value={harvest?.provider?.toUpperCase() ?? "SCHWAB"}
            />
          </div>

          <div style={styles.railCard}>
            <div style={styles.railTitle}>Premium Monitor</div>
            <RailRow
              label="ATM Straddle"
              value={
                recommendation?.expectedMove
                  ? recommendation.expectedMove.toFixed(2)
                  : "—"
              }
            />
            <RailRow
              label="Lower Wing"
              value={recommendation?.lowerWing?.toFixed(0) ?? "—"}
            />
            <RailRow
              label="Upper Wing"
              value={recommendation?.upperWing?.toFixed(0) ?? "—"}
            />
            <div style={styles.placeholderGraph}>
              <span>Premium stream attaches in WebSocket phase</span>
            </div>
          </div>
        </aside>
      </div>

      {overlays.heatmap ? (
        <div style={styles.heatmapCard}>
          <div style={styles.heatmapHeader}>
            <div>
              <div style={styles.railTitle}>SPX OI / Gamma Heatmap</div>
              <div style={styles.heatmapNote}>
                Structural strike concentrations around current spot.
              </div>
            </div>
            <div style={styles.timeStamp}>
              Updated{" "}
              {lastRefresh
                ? new Date(lastRefresh).toLocaleTimeString()
                : "—"}
            </div>
          </div>

          <div style={styles.heatRows}>
            {heatRows.map((row) => {
              const maxScore = Math.max(...heatRows.map((item) => item.score), 1);
              const pct = Math.max(4, (row.score / maxScore) * 100);
              const isSpot =
                Math.abs(row.strike - currentPrice) <= 2.5;
              return (
                <div key={row.strike} style={styles.heatRow}>
                  <div style={styles.heatStrike}>
                    {row.strike.toFixed(0)}
                    {isSpot ? <span style={styles.spotBadge}>SPOT</span> : null}
                  </div>
                  <div style={styles.heatTrack}>
                    <div
                      style={{
                        ...styles.heatFill,
                        width: `${pct}%`,
                      }}
                    />
                  </div>
                  <div style={styles.heatValue}>
                    {formatCompact(row.totalOi)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {harvest?.tradeDate &&
      harvest.generatedAt &&
      recommendation &&
      harvest.spx?.rows?.length ? (
        <ExecutionCockpit
          tradeDate={harvest.tradeDate}
          generatedAt={harvest.generatedAt}
          recommendation={recommendation}
          rows={harvest.spx.rows}
        />
      ) : null}
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
};
