"use client";

import {
  CandlestickSeries,
  ColorType,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ZeroDteChainRow, ZeroDteRecommendation } from "../lib/zeroDteOiIntelligence";
import type { ZeroDteMoodRead } from "../lib/zeroDteMoodEngine";
import { PremiumHistoryPanel } from "./execution/PremiumHistoryPanel";
import { AdvancedStrikeHeatmap } from "./AdvancedStrikeHeatmap";
import { DealerAnalyticsPanel } from "./DealerAnalyticsPanel";
import { MapEnginePanel } from "./MapEnginePanel";
import { useSessionMapManager } from "../lib/session/useSessionMapManager";
import { getControllingMarketMap } from "../lib/session/mapEngine";
import {
  buildExecutionCandidate,
  buildExecutionCandidateBooks,
  buildZeroDteExecutionRead,
  emptyExecutionMemory,
  sampleFromRead,
  type ExecutionCandidate,
  type ExecutionStrategy,
  type ZeroDteExecutionMemory,
  type ZeroDteExecutionRead,
} from "../lib/zeroDteExecutionIntelligence";
import {
  closeExecutionPositionDb,
  loadExecutionMemoryDb,
  openExecutionPositionDb,
  persistExecutionSample,
  persistExecutionSamples,
} from "../lib/zeroDteExecutionRepository";
import { ZeroDteExecutionIntelligencePanel } from "./ZeroDteExecutionIntelligencePanel";
import { buildZeroDteLeastResistancePath } from "../lib/zeroDteLeastResistancePath";
import { lockOpeningMap, type ZeroDteOpeningMap } from "../lib/zeroDteOpeningMap";
import { updateZeroDteStrikeFlow, type ZeroDteStrikeFlowRead } from "../lib/zeroDteStrikeFlow";
import { buildZeroDteTradeSelection, type ZeroDteTradeSelection } from "../lib/zeroDteTradeSelector";
import { orchestrateZeroDteStrategySelection } from "../lib/zeroDteStrategyOrchestrator";
import { ZeroDteTradeSelectionPanel } from "./ZeroDteTradeSelectionPanel";
import { ZeroDteMoodPanel } from "./ZeroDteMoodPanel";
import { ZeroDteStrikeFlowPanel } from "./ZeroDteStrikeFlowPanel";
import { ExecutionTradeDock } from "./execution/ExecutionTradeDock";
import {
  useExecutionSignalPaint,
  type ExecutionSignalPaintFilter,
} from "../lib/execution/useExecutionSignalPaint";
import { useStableExecutionCandidates } from "../lib/execution/useStableExecutionCandidates";
import { buildZeroDtePortfolioRead } from "../lib/zeroDtePortfolioEngine";
import { buildZeroDtePriceActionContext } from "../lib/zeroDteTimeRegime";

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
  mood?: ZeroDteMoodRead;
  tradeSelection?: ZeroDteTradeSelection;
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
  ema9: false,
  ema20: false,
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
  const signalMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const hasInitialFitRef = useRef(false);
  const strategyInitializedForDateRef = useRef<string | null>(null);
  const loadSequenceRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);

  const [candles, setCandles] = useState<Candle[]>([]);
  const [harvest, setHarvest] = useState<HarvestResponse | null>(null);
  const [frequency, setFrequency] = useState<1 | 5>(1);
  const [overlays, setOverlays] = useState(DEFAULT_OVERLAYS);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [executionMemory, setExecutionMemory] = useState<ZeroDteExecutionMemory | null>(null);
  const [executionDbError, setExecutionDbError] = useState<string | null>(null);
  const executionSampleKeyRef = useRef<string | null>(null);
  const [openingMap, setOpeningMap] = useState<ZeroDteOpeningMap | null>(null);
  const [strikeFlow, setStrikeFlow] = useState<ZeroDteStrikeFlowRead | null>(null);
  const [selectedExecutionStrategy, setSelectedExecutionStrategy] =
    useState<ExecutionStrategy>("iron-fly");
  const [executionBusy, setExecutionBusy] = useState(false);
  const [signalPaintFilter, setSignalPaintFilter] =
    useState<ExecutionSignalPaintFilter>("all");

  const recommendation = harvest?.recommendation;
  const spxRows = harvest?.spx?.rows ?? [];
  const lastCandle = candles.at(-1);
  const currentPrice = recommendation?.spxPrice ?? harvest?.spx?.price ?? lastCandle?.close ?? 0;

  const mapManager = useSessionMapManager({
    tradeDate: harvest?.tradeDate,
    generatedAt: harvest?.generatedAt,
    recommendation,
    rows: spxRows,
    openingMap,
    strikeFlow,
  });

  const controllingMap = mapManager.state
    ? getControllingMarketMap(mapManager.state)
    : null;

  useEffect(() => {
    if (
      !harvest?.tradeDate ||
      !harvest.generatedAt ||
      !recommendation ||
      !harvest.spx?.rows.length
    ) {
      return;
    }

    const locked = lockOpeningMap(
      harvest.tradeDate,
      harvest.generatedAt,
      recommendation,
      harvest.spx.rows,
    );
    setOpeningMap(locked);
    setStrikeFlow(
      updateZeroDteStrikeFlow({
        tradeDate: harvest.tradeDate,
        generatedAt: harvest.generatedAt,
        expiration: harvest.spx.expirationDate,
        spxPrice: harvest.spx.price,
        rows: harvest.spx.rows,
        recommendation,
      }),
    );
  }, [harvest?.generatedAt, harvest?.spx, harvest?.tradeDate, recommendation]);

  const baseTradeSelection = useMemo(() => {
    if (!recommendation || !spxRows.length) return harvest?.tradeSelection ?? null;
    return buildZeroDteTradeSelection({
      recommendation,
      spxRows,
      mood: harvest?.mood ?? null,
      maxWidth: 50,
      minWidth: 5,
      riskMode: "balanced",
      strikeFlow,
    });
  }, [harvest?.mood, harvest?.tradeSelection, recommendation, spxRows, strikeFlow]);

  const mapAwareTradeSelection = useMemo(() => {
    if (!baseTradeSelection || !recommendation) return baseTradeSelection;
    return orchestrateZeroDteStrategySelection({
      baseSelection: baseTradeSelection,
      recommendation,
      spxRows,
      mapState: mapManager.state,
      strikeFlow,
    });
  }, [baseTradeSelection, mapManager.state, recommendation, spxRows, strikeFlow]);

  const scannerExecutionCandidateBooks = useMemo(() => {
    if (!mapAwareTradeSelection || !mapManager.state) return null;
    return buildExecutionCandidateBooks(
      mapAwareTradeSelection,
      mapManager.state,
    );
  }, [mapAwareTradeSelection, mapManager.state]);

  const scannerExecutionCandidates = useMemo<
    Partial<Record<ExecutionStrategy, ExecutionCandidate | null>>
  >(() => {
    if (!scannerExecutionCandidateBooks) return {};
    return {
      "iron-fly": scannerExecutionCandidateBooks["iron-fly"][0] ?? null,
      "put-credit-spread":
        scannerExecutionCandidateBooks["put-credit-spread"][0] ?? null,
      "call-credit-spread":
        scannerExecutionCandidateBooks["call-credit-spread"][0] ?? null,
    };
  }, [scannerExecutionCandidateBooks]);

  const stableCandidateTracker = useStableExecutionCandidates({
    tradeDate: harvest?.tradeDate,
    generatedAt: harvest?.generatedAt,
    frequencyMinutes: frequency,
    candles,
    mapState: mapManager.state,
    scannerCandidates: scannerExecutionCandidates,
    scannerCandidateBooks: scannerExecutionCandidateBooks ?? undefined,
    openSetupKeys: (executionMemory?.positions ?? []).map(
      (position) => position.setupKey,
    ),
  });
  const executionCandidates = stableCandidateTracker.candidates;

  const priceAction = useMemo(
    () => buildZeroDtePriceActionContext(candles),
    [candles],
  );

  const recommendedExecutionCandidate = useMemo(() => {
    if (!mapAwareTradeSelection || !mapManager.state) return null;
    const strategy = mapAwareTradeSelection.tradeType as ExecutionStrategy;
    const candidateFromBook =
      scannerExecutionCandidateBooks?.[strategy]?.[0] ?? null;
    return (
      candidateFromBook ??
      buildExecutionCandidate(mapAwareTradeSelection, mapManager.state)
    );
  }, [
    mapAwareTradeSelection,
    mapManager.state,
    scannerExecutionCandidateBooks,
  ]);

  useEffect(() => {
    const tradeDate = harvest?.tradeDate;
    if (!tradeDate || !recommendedExecutionCandidate) return;
    if (strategyInitializedForDateRef.current === tradeDate) return;
    strategyInitializedForDateRef.current = tradeDate;
    setSelectedExecutionStrategy(recommendedExecutionCandidate.strategy);
  }, [harvest?.tradeDate, recommendedExecutionCandidate]);

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
    const sequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = sequence;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;

    try {
      setError(null);

      const [historyResponse, harvestResponse] = await Promise.all([
        fetch(
          `/api/brokers/schwab/price-history?symbol=${encodeURIComponent("$SPX")}&frequency=${frequency}`,
          { cache: "no-store", signal: controller.signal },
        ),
        fetch("/api/zero-dte/harvest-schwab", {
          cache: "no-store",
          signal: controller.signal,
        }),
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

      if (sequence !== loadSequenceRef.current || controller.signal.aborted) {
        return;
      }

      setCandles(historyJson.candles ?? []);
      setHarvest(harvestJson);
      setLastRefresh(new Date().toISOString());
    } catch (loadError) {
      if (controller.signal.aborted || sequence !== loadSequenceRef.current) {
        return;
      }
      setError(
        loadError instanceof Error
          ? loadError.message
          : "SPX command chart failed.",
      );
    } finally {
      if (sequence === loadSequenceRef.current) setLoading(false);
    }
  }, [frequency]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(
    () => () => {
      loadAbortRef.current?.abort();
    },
    [],
  );

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
    signalMarkersRef.current = createSeriesMarkers(candleSeries, []);

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      signalMarkersRef.current = null;
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
        horizontal(controllingMap?.callWall ?? recommendation.spx.callWall, "#ff8a34", 2);
        horizontal(controllingMap?.putWall ?? recommendation.spx.putWall, "#2f80ed", 2);
      }

      if (overlays.pin) {
        horizontal(controllingMap?.pin ?? recommendation.spx.strongestPin, "#f4f7fb", 2, LineStyle.Dashed);
      }

      if (overlays.center) {
        horizontal(controllingMap?.center ?? recommendation.suggestedCenter, "#ffd400", 3);
      }

      if (overlays.expectedMove) {
        horizontal(
          (controllingMap?.spot ?? recommendation.spxPrice) + (controllingMap?.expectedMove ?? recommendation.expectedMove),
          "#7f8fa4",
          1,
          LineStyle.Dashed,
        );
        horizontal(
          (controllingMap?.spot ?? recommendation.spxPrice) - (controllingMap?.expectedMove ?? recommendation.expectedMove),
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
  }, [analytics, candles, controllingMap, leastResistancePath, mapManager.state, overlays, recommendation]);

  function toggleOverlay(key: OverlayKey) {
    setOverlays((current) => ({ ...current, [key]: !current[key] }));
  }

  function resetChartView() {
    chartRef.current?.timeScale().fitContent();
    hasInitialFitRef.current = true;
  }

  useEffect(() => {
    if (!harvest?.tradeDate) return;
    executionSampleKeyRef.current = null;
    let cancelled = false;

    void loadExecutionMemoryDb(harvest.tradeDate)
      .then((memory) => {
        if (cancelled) return;
        setExecutionMemory(memory);
        setExecutionDbError(null);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setExecutionMemory(emptyExecutionMemory(harvest.tradeDate));
        setExecutionDbError(
          loadError instanceof Error
            ? loadError.message
            : "Execution memory load failed.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [harvest?.tradeDate]);

  const portfolioRead = useMemo(() => {
    if (!executionMemory || !recommendation || !mapManager.state) return null;
    return buildZeroDtePortfolioRead({
      memory: executionMemory,
      rows: spxRows,
      recommendation,
      mapState: mapManager.state,
      candidates: executionCandidates,
      mood: harvest?.mood ?? null,
    });
  }, [executionCandidates, executionMemory, harvest?.mood, mapManager.state, recommendation, spxRows]);

  const entryExecutionRead: ZeroDteExecutionRead | null = useMemo(() => {
    if (
      !recommendation ||
      !harvest?.tradeDate ||
      !harvest.generatedAt ||
      !mapAwareTradeSelection ||
      !mapManager.state ||
      !executionMemory
    ) {
      return null;
    }

    return buildZeroDteExecutionRead({
      tradeDate: harvest.tradeDate,
      generatedAt: harvest.generatedAt,
      recommendation,
      spxRows,
      strikeFlow,
      tradeSelection: mapAwareTradeSelection,
      mapState: mapManager.state,
      memory: executionMemory,
      candidateOverride:
        executionCandidates[selectedExecutionStrategy] ?? null,
      positionOverride: null,
      tracking: stableCandidateTracker.tracks[selectedExecutionStrategy],
      portfolio: portfolioRead,
      priceAction,
    });
  }, [
    executionCandidates,
    executionMemory,
    harvest?.generatedAt,
    harvest?.tradeDate,
    mapAwareTradeSelection,
    mapManager.state,
    portfolioRead,
    priceAction,
    recommendation,
    selectedExecutionStrategy,
    spxRows,
    stableCandidateTracker.tracks,
    strikeFlow,
  ]);

  const positionExecutionReads = useMemo(() => {
    const tradeDate = harvest?.tradeDate;
    const generatedAt = harvest?.generatedAt;
    const mapState = mapManager.state;
    if (
      !recommendation ||
      !tradeDate ||
      !generatedAt ||
      !mapAwareTradeSelection ||
      !mapState ||
      !executionMemory
    ) {
      return {} as Record<string, ZeroDteExecutionRead>;
    }

    return Object.fromEntries(
      (executionMemory.positions ?? []).map((position) => [
        position.id,
        buildZeroDteExecutionRead({
          tradeDate,
          generatedAt,
          recommendation,
          spxRows,
          strikeFlow,
          tradeSelection: mapAwareTradeSelection,
          mapState,
          memory: executionMemory,
          candidateOverride: executionCandidates[position.strategy] ?? null,
          positionOverride: position,
          tracking: stableCandidateTracker.tracks[position.strategy],
          portfolio: portfolioRead,
          priceAction,
        }),
      ]),
    );
  }, [
    executionCandidates,
    executionMemory,
    harvest?.generatedAt,
    harvest?.tradeDate,
    mapAwareTradeSelection,
    mapManager.state,
    portfolioRead,
    priceAction,
    recommendation,
    spxRows,
    stableCandidateTracker.tracks,
    strikeFlow,
  ]);

  const liveExecutionRead = useMemo(() => {
    const positionReads = Object.values(positionExecutionReads);
    if (!positionReads.length) return entryExecutionRead;
    return [...positionReads].sort((a, b) => {
      if (a.emergencyExit !== b.emergencyExit) return a.emergencyExit ? -1 : 1;
      return b.exitScore - a.exitScore;
    })[0] ?? entryExecutionRead;
  }, [entryExecutionRead, positionExecutionReads]);

  const executionReadsForPaint = useMemo(() => {
    const tradeDate = harvest?.tradeDate;
    const generatedAt = harvest?.generatedAt;
    const mapState = mapManager.state;
    if (
      !recommendation ||
      !tradeDate ||
      !generatedAt ||
      !mapAwareTradeSelection ||
      !mapState ||
      !executionMemory
    ) {
      return [] as ZeroDteExecutionRead[];
    }

    const entryReads = ([
      "iron-fly",
      "put-credit-spread",
      "call-credit-spread",
    ] as ExecutionStrategy[]).flatMap((strategy) => {
      const candidate = executionCandidates[strategy] ?? null;
      if (!candidate) return [];
      return [
        buildZeroDteExecutionRead({
          tradeDate,
          generatedAt,
          recommendation,
          spxRows,
          strikeFlow,
          tradeSelection: mapAwareTradeSelection,
          mapState,
          memory: executionMemory,
          candidateOverride: candidate,
          positionOverride: null,
          tracking: stableCandidateTracker.tracks[strategy],
          portfolio: portfolioRead,
          priceAction,
        }),
      ];
    });

    const readsBySetup = new Map<string, ZeroDteExecutionRead>();
    for (const read of entryReads) {
      if (read.setupKey) readsBySetup.set(read.setupKey, read);
    }
    for (const read of Object.values(positionExecutionReads)) {
      if (read.setupKey) readsBySetup.set(read.setupKey, read);
    }
    return [...readsBySetup.values()];
  }, [
    executionCandidates,
    executionMemory,
    harvest?.generatedAt,
    harvest?.tradeDate,
    mapAwareTradeSelection,
    mapManager.state,
    portfolioRead,
    positionExecutionReads,
    priceAction,
    recommendation,
    spxRows,
    stableCandidateTracker.tracks,
    strikeFlow,
  ]);

  const signalPaint = useExecutionSignalPaint({
    tradeDate: harvest?.tradeDate,
    frequencyMinutes: frequency,
    candles,
    reads: executionReadsForPaint,
  });

  const visibleExecutionSignals = useMemo(() => {
    if (signalPaintFilter === "off") return [];
    if (signalPaintFilter === "all") return signalPaint.signals;
    return signalPaint.signals.filter(
      (signal) => signal.strategy === signalPaintFilter,
    );
  }, [signalPaint.signals, signalPaintFilter]);

  useEffect(() => {
    const markerApi = signalMarkersRef.current;
    if (!markerApi) return;

    markerApi.setMarkers(
      visibleExecutionSignals.map((signal) => ({
        time: signal.candleTime as UTCTimestamp,
        position: signal.kind === "SELL" ? "aboveBar" : "belowBar",
        color: signal.kind === "SELL" ? "#16c784" : "#ea3943",
        shape: signal.kind === "SELL" ? "arrowDown" : "arrowUp",
        text: `${signal.kind} · ${shortStrategyLabel(signal.strategy)} · ${Math.round(
          signal.confidence,
        )}`,
      })),
    );
  }, [visibleExecutionSignals]);

  useEffect(() => {
    if (
      !executionReadsForPaint.length ||
      !openingMap ||
      !recommendation ||
      !harvest?.tradeDate ||
      !harvest.generatedAt ||
      !harvest.spx?.expirationDate
    ) {
      return;
    }

    const items = executionReadsForPaint.flatMap((read) => {
      const sample = sampleFromRead(read, recommendation.spxPrice);
      return sample ? [{ read, sample }] : [];
    });
    if (!items.length) return;
    const sampleKey = items
      .map(({ sample }) => {
        const bucket = Math.floor(Date.parse(sample.timestamp) / 30_000);
        return `${bucket}:${sample.setupKey}:${sample.lifecycle}`;
      })
      .sort()
      .join("|");
    if (executionSampleKeyRef.current === sampleKey) return;
    executionSampleKeyRef.current = sampleKey;
    let cancelled = false;

    void persistExecutionSamples({
      tradeDate: harvest.tradeDate,
      expirationDate: harvest.spx.expirationDate,
      generatedAt: harvest.generatedAt,
      openingMap,
      openingPlan: null,
      recommendation,
      strikeFlow,
      items,
    })
      .then((memory) => {
        if (cancelled) return;
        setExecutionMemory(memory);
        setExecutionDbError(null);
      })
      .catch((persistError) => {
        if (cancelled) return;
        executionSampleKeyRef.current = null;
        setExecutionDbError(
          persistError instanceof Error
            ? persistError.message
            : "Execution memory sync failed.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [
    executionReadsForPaint,
    harvest?.generatedAt,
    harvest?.spx?.expirationDate,
    harvest?.tradeDate,
    openingMap,
    recommendation,
    strikeFlow,
  ]);


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
          label="Controlling Center"
          value={controllingMap?.center?.toFixed(0) ?? recommendation?.suggestedCenter?.toFixed(0) ?? "—"}
        />
        <MetricCard
          label="Put Wall"
          value={controllingMap?.putWall?.toFixed(0) ?? recommendation?.spx.putWall?.toFixed(0) ?? "—"}
        />
        <MetricCard
          label="Call Wall"
          value={controllingMap?.callWall?.toFixed(0) ?? recommendation?.spx.callWall?.toFixed(0) ?? "—"}
        />
        <MetricCard
          label="Pin"
          value={controllingMap?.pin?.toFixed(0) ?? recommendation?.spx.strongestPin?.toFixed(0) ?? "—"}
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

      <div style={styles.signalPaintBar}>
        <div style={styles.signalPaintTitle}>
          <strong>Execution Paint</strong>
          <span>Candle-close confirmed only</span>
        </div>
        <select
          value={signalPaintFilter}
          onChange={(event) =>
            setSignalPaintFilter(
              event.target.value as ExecutionSignalPaintFilter,
            )
          }
          style={styles.signalPaintSelect}
        >
          <option value="all">All Strategies</option>
          <option value="put-credit-spread">Put Credit</option>
          <option value="call-credit-spread">Call Credit</option>
          <option value="iron-fly">Iron Fly</option>
          <option value="off">Off</option>
        </select>
        <div style={styles.signalPaintCount}>
          <span style={{ color: "#16c784" }}>GREEN = SELL</span>
          <span style={{ color: "#ea3943" }}>RED = BUY</span>
          <span>
            {visibleExecutionSignals.length} confirmed · {signalPaint.pendingCount} pending
          </span>
        </div>
        <button
          type="button"
          onClick={signalPaint.clearToday}
          style={styles.signalClearButton}
        >
          Clear Today
        </button>
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
              ...(liveExecutionRead?.lifecycle === "SELL_READY" ||
              liveExecutionRead?.lifecycle === "BUYBACK_READY" ||
              liveExecutionRead?.lifecycle === "EXITED"
                ? styles.executionHarvest
                : liveExecutionRead?.lifecycle === "ARMED"
                  ? styles.executionWatch
                  : liveExecutionRead?.position
                    ? styles.executionManage
                    : styles.executionAvoid),
            }}
          >
            <div style={styles.signalLabel}>Execution Engine</div>
            <div style={styles.executionAction}>
              {liveExecutionRead?.lifecycle.replaceAll("_", " ") ?? "WAIT"}
            </div>
            <div style={styles.scoreValue}>
              {liveExecutionRead?.confidence ?? 0}
            </div>
            <div style={styles.signalNote}>
              {liveExecutionRead?.position ? "Exit Readiness" : "Entry Readiness"}
            </div>

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

          <ExecutionTradeDock
            read={entryExecutionRead}
            portfolio={portfolioRead}
            positionReads={positionExecutionReads}
            candidates={executionCandidates}
            tracks={stableCandidateTracker.tracks}
            selectedStrategy={selectedExecutionStrategy}
            onStrategyChange={setSelectedExecutionStrategy}
            busy={executionBusy}
            error={executionDbError}
            onOpen={async ({ candidate, entryCredit, quantity }) => {
              if (
                !harvest?.tradeDate ||
                !harvest.spx?.expirationDate ||
                !recommendation ||
                !openingMap ||
                !mapAwareTradeSelection ||
                !mapManager.state ||
                !executionMemory
              ) {
                setExecutionDbError(
                  "Live session context is still building. Try the entry again after the next refresh.",
                );
                return;
              }

              setExecutionBusy(true);
              try {
                const openRead = buildZeroDteExecutionRead({
                  tradeDate: harvest.tradeDate,
                  generatedAt:
                    harvest.generatedAt ?? new Date().toISOString(),
                  recommendation,
                  spxRows,
                  strikeFlow,
                  tradeSelection: mapAwareTradeSelection,
                  mapState: mapManager.state,
                  memory: executionMemory,
                  candidateOverride: candidate,
                  positionOverride: null,
                  tracking: stableCandidateTracker.tracks[candidate.strategy],
                  portfolio: portfolioRead,
                  priceAction,
                });

                if (!executionMemory.tradeDayId) {
                  const bootstrapSample = sampleFromRead(
                    openRead,
                    recommendation.spxPrice,
                  );
                  if (!bootstrapSample) {
                    throw new Error(
                      "The selected legs do not have a complete live mark yet.",
                    );
                  }

                  const initialized = await persistExecutionSample({
                    tradeDate: harvest.tradeDate,
                    expirationDate: harvest.spx.expirationDate,
                    generatedAt: openRead.generatedAt,
                    openingMap,
                    openingPlan: null,
                    recommendation,
                    strikeFlow,
                    read: openRead,
                    sample: bootstrapSample,
                  });
                  setExecutionMemory(initialized);
                }

                const memory = await openExecutionPositionDb({
                  tradeDate: harvest.tradeDate,
                  entryTime: new Date().toISOString(),
                  entryCredit,
                  contracts: quantity,
                  read: openRead,
                  candidate,
                });
                setExecutionMemory(memory);
                setSelectedExecutionStrategy(candidate.strategy);
                setExecutionDbError(null);
              } catch (openError) {
                setExecutionDbError(
                  openError instanceof Error
                    ? openError.message
                    : "Could not open execution position.",
                );
              } finally {
                setExecutionBusy(false);
              }
            }}
            onClose={async (positionId, exitDebit) => {
              const positionRead = positionExecutionReads[positionId];
              if (!harvest?.tradeDate || !positionRead) return;
              setExecutionBusy(true);
              try {
                const memory = await closeExecutionPositionDb({
                  tradeDate: harvest.tradeDate,
                  positionId,
                  exitTime: new Date().toISOString(),
                  exitDebit,
                  exitScore: positionRead.exitScore,
                  reason: positionRead.action,
                  emergencyExit: positionRead.emergencyExit,
                });
                setExecutionMemory(memory);
                setExecutionDbError(null);
              } catch (closeError) {
                setExecutionDbError(
                  closeError instanceof Error
                    ? closeError.message
                    : "Could not close execution position.",
                );
              } finally {
                setExecutionBusy(false);
              }
            }}
          />

          <div style={styles.railCard}>
            <div style={styles.railTitle}>{liveExecutionRead?.position ? "Exit Score" : "Entry Score"}</div>
            <div style={styles.breakdownList}>
              {(liveExecutionRead?.components ?? []).map((component) => (
                <div key={component.key} style={styles.breakdownRow}>
                  <div style={styles.breakdownHeader}>
                    <span>{component.label}</span>
                    <strong>
                      {component.value.toFixed(1)}/{component.max}
                    </strong>
                  </div>
                  <div style={styles.breakdownTrack}>
                    <div
                      style={{
                        ...styles.breakdownFill,
                        width: `${Math.max(
                          0,
                          Math.min(100, (component.value / component.max) * 100),
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
          strikeFlow={strikeFlow}
          onReset={mapManager.reset}
        />
      ) : null}

      <ZeroDteStrikeFlowPanel flow={strikeFlow} />

      {executionDbError ? <div style={styles.error}>Execution DB: {executionDbError}</div> : null}

      <ZeroDteExecutionIntelligencePanel
        read={liveExecutionRead}
        readOnly
        onReset={async () => {
          if (!harvest?.tradeDate) return;
          try {
            const memory = await loadExecutionMemoryDb(harvest.tradeDate);
            setExecutionMemory(memory);
            setExecutionDbError(null);
          } catch (reloadError) {
            setExecutionDbError(
              reloadError instanceof Error
                ? reloadError.message
                : "Execution memory reload failed.",
            );
          }
        }}
      />

      <ZeroDteMoodPanel mood={harvest?.mood ?? null} />

      {mapAwareTradeSelection ? (
        <ZeroDteTradeSelectionPanel
          mood={harvest?.mood ?? null}
          tradeSelection={mapAwareTradeSelection}
          strikeFlow={strikeFlow}
          tracking={stableCandidateTracker.tracks}
          sessionStatus={mapManager.state?.sessionStatus ?? "PREOPEN"}
          openSetupKeys={(executionMemory?.positions ?? []).map(
            (position) => position.setupKey,
          )}
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
          support={controllingMap?.putWall ?? recommendation.spx.putWall}
          resistance={controllingMap?.callWall ?? recommendation.spx.callWall}
          pin={controllingMap?.pin ?? recommendation.spx.strongestPin}
          center={controllingMap?.center ?? recommendation.suggestedCenter}
          expectedMove={controllingMap?.expectedMove ?? recommendation.expectedMove}
          recommendationConfidence={recommendation.confidenceScore}
          structuralConfidence={
            controllingMap?.structure.structuralConfidence ??
            recommendation.confidenceScore
          }
          mapState={mapManager.state?.phase ?? "OPENING"}
          sessionStatus={mapManager.state?.sessionStatus ?? "PREOPEN"}
          openingPressure={mapManager.state?.opening.dealerPressure ?? null}
          controllingPressure={controllingMap?.dealerPressure ?? null}
        />
      ) : null}

      {overlays.heatmap && recommendation && harvest?.tradeDate ? (
        <AdvancedStrikeHeatmap
          tradeDate={harvest.tradeDate}
          generatedAt={harvest.generatedAt}
          spot={currentPrice}
          center={controllingMap?.center ?? recommendation.suggestedCenter}
          callWall={controllingMap?.callWall ?? recommendation.spx.callWall}
          putWall={controllingMap?.putWall ?? recommendation.spx.putWall}
          pin={controllingMap?.pin ?? recommendation.spx.strongestPin}
          expectedMove={controllingMap?.expectedMove ?? recommendation.expectedMove}
          rows={spxRows}
          openingBaseline={mapManager.state?.opening.strikes ?? null}
          mapState={mapManager.state?.phase ?? "OPENING"}
        />
      ) : null}

      <div style={styles.premiumSection}>
        <PremiumHistoryPanel
          history={executionMemory?.samples ?? []}
          read={liveExecutionRead}
          availableReads={executionReadsForPaint}
          preferredSetupKey={entryExecutionRead?.setupKey ?? liveExecutionRead?.setupKey ?? null}
        />
      </div>
    </section>
  );
}

function shortStrategyLabel(strategy: ExecutionStrategy) {
  if (strategy === "put-credit-spread") return "PUT";
  if (strategy === "call-credit-spread") return "CALL";
  return "IF";
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
  signalPaintBar: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 9,
    marginBottom: 12,
    background: "#08131d",
    border: "1px solid #19344a",
    borderRadius: 10,
    padding: "8px 10px",
  },
  signalPaintTitle: {
    display: "grid",
    gap: 1,
    minWidth: 145,
    color: "#dce9f4",
    fontSize: 11,
  },
  signalPaintSelect: {
    background: "#071018",
    color: "#eaf3fb",
    border: "1px solid #2a4356",
    borderRadius: 8,
    padding: "7px 9px",
    fontSize: 10,
  },
  signalPaintCount: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    color: "#7890a4",
    fontSize: 9,
    marginLeft: "auto",
  },
  signalClearButton: {
    background: "#0c1721",
    color: "#b9c7d4",
    border: "1px solid #2a4356",
    borderRadius: 8,
    padding: "7px 9px",
    fontSize: 9,
    cursor: "pointer",
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
    gridTemplateColumns: "minmax(0, 1fr) 325px",
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
    maxHeight: 610,
    overflowY: "auto",
    paddingRight: 3,
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
