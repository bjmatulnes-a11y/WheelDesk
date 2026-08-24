"use client";

import { authenticatedApiHeaders } from "../lib/auth/authenticated-api";

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
  calculateStrategyPackageQuote,
  emptyExecutionMemory,
  repriceExecutionCandidate,
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
  openManualExecutionPositionDb,
  persistExecutionSample,
  persistExecutionSamples,
} from "../lib/zeroDteExecutionRepository";
import { ZeroDteExecutionIntelligencePanel } from "./ZeroDteExecutionIntelligencePanel";
import { buildZeroDteLeastResistancePath } from "../lib/zeroDteLeastResistancePath";
import { buildPremiumCrestRead } from "../lib/zeroDtePremiumCrestEngine";
import {
  isOpeningMapCaptureOnTime,
  lockOpeningMap,
  type ZeroDteOpeningMap,
} from "../lib/zeroDteOpeningMap";
import { updateZeroDteStrikeFlow, type ZeroDteStrikeFlowRead } from "../lib/zeroDteStrikeFlow";
import { buildZeroDteTradeSelection, type ZeroDteTradeSelection } from "../lib/zeroDteTradeSelector";
import { orchestrateZeroDteStrategySelection } from "../lib/zeroDteStrategyOrchestrator";
import { ZeroDteTradeSelectionPanel } from "./ZeroDteTradeSelectionPanel";
import { ZeroDteMoodPanel } from "./ZeroDteMoodPanel";
import { ZeroDteStrikeFlowPanel } from "./ZeroDteStrikeFlowPanel";
import { ZeroDteEsOrderFlowPanel } from "./ZeroDteEsOrderFlowPanel";
import { ExecutionTradeDock } from "./execution/ExecutionTradeDock";
import {
  useExecutionSignalPaint,
  type ExecutionSignalPaintFilter,
} from "../lib/execution/useExecutionSignalPaint";
import { useStableExecutionCandidates } from "../lib/execution/useStableExecutionCandidates";
import { useExecutionPremiumTape } from "../lib/execution/useExecutionPremiumTape";
import { useExecutionSignalFunnel } from "../lib/execution/useExecutionSignalFunnel";
import { buildZeroDtePortfolioRead } from "../lib/zeroDtePortfolioEngine";
import { buildZeroDtePriceActionContext } from "../lib/zeroDteTimeRegime";
import {
  absoluteDistanceFloorPoints,
  buildZeroDteVolContext,
  loadZeroDteRiskPolicy,
  saveZeroDteRiskPolicy,
  type ZeroDteRiskPolicy,
} from "../lib/zeroDteRiskPolicy";
import { ZeroDteRiskPolicyPanel } from "./ZeroDteRiskPolicyPanel";
import { ZeroDteShadowTradePanel } from "./ZeroDteShadowTradePanel";
import {
  closeZeroDteShadowTrade,
  loadZeroDteShadowTrades,
  openZeroDteShadowTrade,
  sampleZeroDteShadowTrades,
} from "../lib/zeroDteShadowRepository";
import {
  currentShadowShortLegRead,
  evaluateZeroDteShadowExit,
  shadowTradeToExecutionPosition,
  type ZeroDteShadowTrade,
} from "../lib/zeroDteShadowTrade";
import {
  evaluateZeroDteAdaptiveManagement,
  type AdaptiveAuctionContext,
} from "../lib/zeroDteAdaptiveManagement";

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

type HarvestQualityCheck = {
  label: string;
  status: "ok" | "warn" | "fail";
  message: string;
};

type ExpirationListResponse = {
  ok: boolean;
  tradeDate: string;
  expirations: Array<{
    date: string;
    daysFromTradeDate: number;
  }>;
  error?: string;
};

type SchwabConnectionStatus = {
  ok: boolean;
  connected: boolean;
  needsReconnect?: boolean;
  accessExpiresAt?: string | null;
  refreshExpiresAt?: string | null;
  updatedAt?: string | null;
  error?: string;
};

type HarvestResponse = {
  tradeDate: string;
  generatedAt: string;
  manualExpiration?: string | null;
  researchMode?: boolean;
  status: "ok" | "partial" | "error";
  spx?: HarvestSymbol;
  spy?: HarvestSymbol;
  recommendation?: ZeroDteRecommendation;
  mood?: ZeroDteMoodRead;
  tradeSelection?: ZeroDteTradeSelection;
  errors?: string[];
  qualityChecks?: HarvestQualityCheck[];
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
  const strategyUserPinnedRef = useRef(false);
  const loadSequenceRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const loadRequestKeyRef = useRef<string | null>(null);
  const structuralAnchorsRef = useRef<Record<string, {
    tradeDate: string;
    expirationDate: string;
    spxSpot: number;
    spySpot: number | null;
  }>>({});

  const [candles, setCandles] = useState<Candle[]>([]);
  const [signalCandles, setSignalCandles] = useState<Candle[]>([]);
  const [harvest, setHarvest] = useState<HarvestResponse | null>(null);
  const [frequency, setFrequency] = useState<1 | 5>(1);
  const [selectedExpiration, setSelectedExpiration] = useState("auto");
  const [expirationOptions, setExpirationOptions] = useState<
    ExpirationListResponse["expirations"]
  >([]);
  const [expirationError, setExpirationError] = useState<string | null>(null);
  const [overlays, setOverlays] = useState(DEFAULT_OVERLAYS);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [freshnessNow, setFreshnessNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [executionMemory, setExecutionMemory] = useState<ZeroDteExecutionMemory | null>(null);
  const [executionDbError, setExecutionDbError] = useState<string | null>(null);
  const executionSampleKeyRef = useRef<string | null>(null);
  const scannerSelectionCacheRef = useRef<{
    bucket: number;
    tradeDate: string | null;
    expirationKey: string;
    policyKey: string;
    selection: ZeroDteTradeSelection | null;
  } | null>(null);
  const [openingMap, setOpeningMap] = useState<ZeroDteOpeningMap | null>(null);
  const [strikeFlow, setStrikeFlow] = useState<ZeroDteStrikeFlowRead | null>(null);
  const [selectedExecutionStrategy, setSelectedExecutionStrategy] =
    useState<ExecutionStrategy>("iron-fly");
  const [executionBusy, setExecutionBusy] = useState(false);
  const [railExpanded, setRailExpanded] = useState({
    execution: true,
    score: true,
    structure: true,
  });

  const toggleRailSection = (key: keyof typeof railExpanded) => {
    setRailExpanded((current) => ({ ...current, [key]: !current[key] }));
  };
  const [signalPaintFilter, setSignalPaintFilter] =
    useState<ExecutionSignalPaintFilter>("all");
  const [riskPolicy, setRiskPolicy] = useState<ZeroDteRiskPolicy>(() =>
    loadZeroDteRiskPolicy(),
  );
  const [shadowTrades, setShadowTrades] = useState<ZeroDteShadowTrade[]>([]);
  const [shadowError, setShadowError] = useState<string | null>(null);
  const shadowOpeningSignalIdsRef = useRef<Set<string>>(new Set());
  const shadowSampleKeyRef = useRef<string | null>(null);
  const liveAuctionManagementRef = useRef<AdaptiveAuctionContext | null>(null);
  const [premiumBaselineReadySetupKeys, setPremiumBaselineReadySetupKeys] =
    useState<string[]>([]);
  const [schwabConnection, setSchwabConnection] =
    useState<SchwabConnectionStatus | null>(null);
  const [schwabStatusLoading, setSchwabStatusLoading] = useState(true);
  const [schwabConnectBusy, setSchwabConnectBusy] = useState(false);

  useEffect(() => {
    saveZeroDteRiskPolicy(riskPolicy);
  }, [riskPolicy]);

  useEffect(() => {
    const timer = window.setInterval(() => setFreshnessNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadSchwabStatus = async () => {
      try {
        const response = await fetch("/api/brokers/schwab/status", {
          headers: await authenticatedApiHeaders(),
          cache: "no-store",
        });
        const json = (await response.json()) as SchwabConnectionStatus;
        if (cancelled) return;
        setSchwabConnection(json);
      } catch (statusError) {
        if (cancelled) return;
        setSchwabConnection({
          ok: false,
          connected: false,
          error:
            statusError instanceof Error
              ? statusError.message
              : "Unable to read Schwab connection status.",
        });
      } finally {
        if (!cancelled) setSchwabStatusLoading(false);
      }
    };

    void loadSchwabStatus();
    const timer = window.setInterval(() => void loadSchwabStatus(), 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const connectSchwab = useCallback(async () => {
    if (schwabConnectBusy) return;
    setSchwabConnectBusy(true);
    try {
      const response = await fetch("/api/brokers/schwab/connect", {
        headers: await authenticatedApiHeaders(),
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        authorizeUrl?: string;
        error?: string;
      };
      if (!response.ok || !payload.ok || !payload.authorizeUrl) {
        throw new Error(payload.error || "Unable to start Schwab authorization.");
      }
      window.location.assign(payload.authorizeUrl);
    } catch (connectError) {
      setSchwabConnection({
        ok: false,
        connected: false,
        error:
          connectError instanceof Error
            ? connectError.message
            : "Unable to start Schwab authorization.",
      });
      setSchwabConnectBusy(false);
    }
  }, [schwabConnectBusy]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/zero-dte/expirations?days=14", {
          headers: await authenticatedApiHeaders(),
          cache: "no-store",
        });

        const json = (await response.json()) as ExpirationListResponse;
        if (!response.ok || !json.ok) {
          throw new Error(json.error || "SPX expiration list failed.");
        }
        if (!cancelled) {
          setExpirationOptions(json.expirations ?? []);
          setExpirationError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setExpirationOptions([]);
          setExpirationError(
            loadError instanceof Error
              ? loadError.message
              : "SPX expiration list failed.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!harvest?.tradeDate) {
      setShadowTrades([]);
      return;
    }
    shadowOpeningSignalIdsRef.current = new Set();
    shadowSampleKeyRef.current = null;
    let cancelled = false;
    loadZeroDteShadowTrades(harvest.tradeDate)
      .then((trades) => {
        if (!cancelled) {
          setShadowTrades(trades);
          setShadowError(null);
        }
      })
      .catch((shadowLoadError) => {
        if (!cancelled) {
          setShadowError(
            shadowLoadError instanceof Error
              ? shadowLoadError.message
              : "Shadow-trade history load failed.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [harvest?.tradeDate]);

  const recommendation = harvest?.recommendation;
  const spxRows = harvest?.spx?.rows ?? [];
  const manualChainResearch = harvest?.researchMode === true;
  const lastCandle = candles.at(-1);
  const currentPrice = recommendation?.spxPrice ?? harvest?.spx?.price ?? lastCandle?.close ?? 0;
  const handleLiveAuctionManagementRead = useCallback(
    (read: AdaptiveAuctionContext | null) => {
      liveAuctionManagementRef.current = read;
    },
    [],
  );
  const displaySessionCandles = useMemo(() => {
    const scoped = selectCashSessionCandles(candles, harvest?.tradeDate);
    return scoped.length ? scoped : candles;
  }, [candles, harvest?.tradeDate]);
  const officialSignalCandles = useMemo(() => {
    const scoped = selectCompletedCashSessionCandles(
      signalCandles,
      harvest?.tradeDate,
      harvest?.generatedAt,
    );
    return scoped;
  }, [harvest?.generatedAt, harvest?.tradeDate, signalCandles]);

  const mapManager = useSessionMapManager({
    tradeDate: harvest?.tradeDate,
    generatedAt: harvest?.generatedAt,
    recommendation,
    rows: spxRows,
    openingMap: manualChainResearch ? null : openingMap,
    strikeFlow,
    scopeKey: manualChainResearch
      ? `research:${harvest?.spx?.expirationDate ?? selectedExpiration}`
      : `live:${harvest?.spx?.expirationDate ?? "0dte"}`,
    persist: !manualChainResearch,
  });

  const controllingMap = mapManager.state
    ? getControllingMarketMap(mapManager.state)
    : null;

  const decisionLeastResistancePath = useMemo(() => {
    if (!recommendation || !harvest?.generatedAt) return null;
    return buildZeroDteLeastResistancePath({
      recommendation,
      generatedAt: harvest.generatedAt,
      candleFrequencyMinutes: 1,
      structuralMap: controllingMap,
    });
  }, [controllingMap, harvest?.generatedAt, recommendation]);

  useEffect(() => {
    if (
      !harvest?.tradeDate ||
      !harvest.generatedAt ||
      !recommendation ||
      !harvest.spx?.rows.length
    ) {
      return;
    }

    if (harvest.researchMode) {
      // A manually selected future expiration is research-only. Do not let a
      // weekend / future-chain inspection overwrite the real session Opening Map.
      setOpeningMap(null);
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
  }, [
    harvest?.generatedAt,
    harvest?.researchMode,
    harvest?.spx,
    harvest?.tradeDate,
    recommendation,
  ]);

  useEffect(() => {
    if (manualChainResearch || !openingMap || !isOpeningMapCaptureOnTime(openingMap.lockedAt)) {
      return;
    }

    // Once a verified Opening Map exists, make its SPX spot the canonical
    // structural anchor for the rest of the live session. Preserve the SPY
    // anchor already learned from the corresponding harvest.
    const existing = structuralAnchorsRef.current.live ?? null;
    structuralAnchorsRef.current.live = {
      tradeDate: openingMap.tradeDate,
      expirationDate: openingMap.tradeDate,
      spxSpot: openingMap.spot,
      spySpot:
        existing?.tradeDate === openingMap.tradeDate
          ? existing.spySpot
          : null,
    };
  }, [manualChainResearch, openingMap]);

  const baseTradeSelection = useMemo(() => {
    if (!recommendation || !spxRows.length) return harvest?.tradeSelection ?? null;

    // Keep raw option collection / exact-leg repricing at 5 seconds, but the
    // expensive strike optimizer only needs to reconsider the book every 30s.
    // Map/flow orchestration below still updates from the live 5s state.
    const generatedMs = Date.parse(harvest?.generatedAt ?? "");
    const bucket = Number.isFinite(generatedMs)
      ? Math.floor(generatedMs / 30_000)
      : 0;
    const policyKey = [
      riskPolicy.riskMode,
      riskPolicy.maxWidth,
      riskPolicy.minWidth,
      riskPolicy.maxRiskPerTradeDollars ?? "off",
      riskPolicy.minSellableCredit,
      riskPolicy.shortDeltaMax,
      riskPolicy.minimumAbsoluteDistancePoints,
      riskPolicy.minimumAbsoluteDistanceSpotPct,
    ].join(":");
    const expirationKey = `${harvest?.researchMode ? "research" : "live"}:${harvest?.spx?.expirationDate ?? "none"}`;
    const cached = scannerSelectionCacheRef.current;
    if (
      cached &&
      cached.bucket === bucket &&
      cached.tradeDate === (harvest?.tradeDate ?? null) &&
      cached.expirationKey === expirationKey &&
      cached.policyKey === policyKey
    ) {
      return cached.selection;
    }

    const selection = buildZeroDteTradeSelection({
      recommendation,
      spxRows,
      mood: harvest?.mood ?? null,
      maxWidth: riskPolicy.maxWidth,
      minWidth: riskPolicy.minWidth,
      maxRiskDollars: riskPolicy.maxRiskPerTradeDollars,
      minCredit: riskPolicy.minSellableCredit,
      riskMode: riskPolicy.riskMode,
      shortDeltaMax: riskPolicy.shortDeltaMax,
      minAbsoluteDistancePoints: absoluteDistanceFloorPoints(
        riskPolicy,
        recommendation.spxPrice,
      ),
      generatedAt: harvest?.generatedAt ?? null,
      leastResistancePath: decisionLeastResistancePath,
      strikeFlow,
    });
    scannerSelectionCacheRef.current = {
      bucket,
      tradeDate: harvest?.tradeDate ?? null,
      expirationKey,
      policyKey,
      selection,
    };
    return selection;
  }, [
    decisionLeastResistancePath,
    harvest?.generatedAt,
    harvest?.mood,
    harvest?.tradeDate,
    harvest?.tradeSelection,
    recommendation,
    riskPolicy,
    spxRows,
    strikeFlow,
  ]);

  const mapAwareTradeSelection = useMemo(() => {
    if (!baseTradeSelection || !recommendation) return baseTradeSelection;
    return orchestrateZeroDteStrategySelection({
      baseSelection: baseTradeSelection,
      recommendation,
      spxRows,
      mapState: mapManager.state,
      strikeFlow,
      leastResistancePath: decisionLeastResistancePath,
    });
  }, [
    baseTradeSelection,
    decisionLeastResistancePath,
    mapManager.state,
    recommendation,
    spxRows,
    strikeFlow,
  ]);

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
    tradeDate: manualChainResearch ? undefined : harvest?.tradeDate,
    generatedAt: harvest?.generatedAt,
    frequencyMinutes: 1,
    candles: officialSignalCandles,
    mapState: mapManager.state,
    scannerCandidates: scannerExecutionCandidates,
    scannerCandidateBooks: scannerExecutionCandidateBooks ?? undefined,
    openSetupKeys: (executionMemory?.positions ?? []).map(
      (position) => position.setupKey,
    ),
    premiumBaselineReadySetupKeys,
  });
  const executionCandidates = useMemo<
    Partial<Record<ExecutionStrategy, ExecutionCandidate | null>>
  >(() => {
    const output: Partial<
      Record<ExecutionStrategy, ExecutionCandidate | null>
    > = {};
    for (const strategy of [
      "iron-fly",
      "put-credit-spread",
      "call-credit-spread",
    ] as ExecutionStrategy[]) {
      const candidate = manualChainResearch
        ? scannerExecutionCandidates[strategy] ?? null
        : stableCandidateTracker.candidates[strategy] ?? null;
      output[strategy] = candidate
        ? repriceExecutionCandidate(candidate, spxRows)
        : null;
    }
    return output;
  }, [
    manualChainResearch,
    scannerExecutionCandidates,
    spxRows,
    stableCandidateTracker.candidates,
  ]);

  const premiumTape = useExecutionPremiumTape({
    tradeDate: harvest?.tradeDate,
    generatedAt: harvest?.generatedAt,
    spot: currentPrice,
    rows: spxRows,
    tracks: manualChainResearch ? null : stableCandidateTracker.tracks,
    positions: manualChainResearch ? [] : executionMemory?.positions ?? [],
    scopeKey: manualChainResearch
      ? `research:${harvest?.spx?.expirationDate ?? selectedExpiration}`
      : `live:${harvest?.spx?.expirationDate ?? "0dte"}`,
    enabled: !manualChainResearch,
  });

  useEffect(() => {
    if (!harvest?.generatedAt || manualChainResearch) {
      setPremiumBaselineReadySetupKeys([]);
      return;
    }
    const ready = (
      ["iron-fly", "put-credit-spread", "call-credit-spread"] as ExecutionStrategy[]
    ).flatMap((strategy) => {
      const candidate = stableCandidateTracker.tracks[strategy]?.candidate ?? null;
      if (!candidate?.setupKey) return [];
      const samples = premiumTape.points.filter(
        (point) => point.setupKey === candidate.setupKey,
      );
      const currentCredit =
        calculateStrategyPackageQuote(spxRows, candidate.legs)?.markCredit ?? null;
      const crest = buildPremiumCrestRead({
        samples,
        generatedAt: harvest.generatedAt,
        currentCredit,
      });
      return crest.completedMinuteCount >= 3 ? [candidate.setupKey] : [];
    });
    const next = [...new Set(ready)].sort();
    setPremiumBaselineReadySetupKeys((current) =>
      current.join("|") === next.join("|") ? current : next,
    );
  }, [
    harvest?.generatedAt,
    manualChainResearch,
    premiumTape.points,
    spxRows,
    stableCandidateTracker.tracks,
  ]);

  const priceAction = useMemo(
    () => buildZeroDtePriceActionContext(officialSignalCandles),
    [officialSignalCandles],
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
    strategyUserPinnedRef.current = false;
    setSelectedExecutionStrategy(recommendedExecutionCandidate.strategy);
  }, [harvest?.tradeDate, recommendedExecutionCandidate]);

  useEffect(() => {
    if (manualChainResearch || strategyUserPinnedRef.current) return;
    if (executionCandidates[selectedExecutionStrategy]) return;

    const fallback = Object.values(executionCandidates)
      .filter((candidate): candidate is ExecutionCandidate => Boolean(candidate))
      .sort((a, b) => b.score - a.score)[0] ?? null;

    if (!fallback || fallback.strategy === selectedExecutionStrategy) return;
    setSelectedExecutionStrategy(fallback.strategy);
  }, [executionCandidates, manualChainResearch, selectedExecutionStrategy]);

  const handleExecutionStrategyChange = useCallback(
    (strategy: ExecutionStrategy) => {
      strategyUserPinnedRef.current = true;
      setSelectedExecutionStrategy(strategy);
    },
    [],
  );

  const analytics = useMemo(() => {
    // EMAs may warm from prior history, but only the current cash-session
    // points are displayed. VWAP always resets at the current cash open.
    const sessionTimes = new Set(displaySessionCandles.map((candle) => candle.time));
    const filterSession = (values: Array<{ time: number; value: number }>) =>
      values.filter((value) => sessionTimes.has(value.time));
    const ema9 = filterSession(calculateEma(candles, 9));
    const ema20 = filterSession(calculateEma(candles, 20));
    const ema50 = filterSession(calculateEma(candles, 50));
    const vwap = calculateVwap(displaySessionCandles);

    return { ema9, ema20, ema50, vwap };
  }, [candles, displaySessionCandles]);

  const heatRows = useMemo(() => {
    if (!recommendation) return [];
    const spot = recommendation.spxPrice;
    return [...recommendation.spxChainMap]
      .filter((row) => Math.abs(row.strike - spot) <= Math.max(recommendation.expectedMove * 1.4, 80))
      .sort((a, b) => b.score - a.score)
      .slice(0, 14)
      .sort((a, b) => b.strike - a.strike);
  }, [recommendation]);

  // Display and decision logic share one canonical 1-minute LRP derived from
  // the confirmed controlling map. Changing chart candle frequency must not
  // silently change the path used by execution.
  const leastResistancePath = decisionLeastResistancePath;

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
    const requestKey = [
      frequency,
      selectedExpiration,
      riskPolicy.riskMode,
      riskPolicy.maxWidth,
      riskPolicy.minSellableCredit,
      riskPolicy.maxRiskPerTradeDollars ?? "none",
    ].join("|");
    const activeController = loadAbortRef.current;
    if (activeController && !activeController.signal.aborted) {
      // The five-second timer must not repeatedly kill the same slow provider
      // request. A genuinely changed request (expiry/frequency/policy) still
      // supersedes and aborts the old one immediately.
      if (loadRequestKeyRef.current === requestKey) return;
      activeController.abort();
    }

    const sequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = sequence;
    const controller = new AbortController();
    loadAbortRef.current = controller;
    loadRequestKeyRef.current = requestKey;

    try {
      const authHeaders = await authenticatedApiHeaders();
      const displayHistoryRequest = fetch(
        `/api/brokers/schwab/price-history?symbol=${encodeURIComponent("$SPX")}&frequency=${frequency}`,
        { headers: authHeaders, cache: "no-store", signal: controller.signal },
      );
      const signalHistoryRequest =
        frequency === 1
          ? null
          : fetch(
              `/api/brokers/schwab/price-history?symbol=${encodeURIComponent("$SPX")}&frequency=1`,
              { headers: authHeaders, cache: "no-store", signal: controller.signal },
            );
      const harvestParams = new URLSearchParams({
        strict: "1",
        selection: "0",
        riskMode: riskPolicy.riskMode,
        maxWidth: String(riskPolicy.maxWidth),
        minCredit: String(riskPolicy.minSellableCredit),
      });
      if (riskPolicy.maxRiskPerTradeDollars !== null) {
        harvestParams.set("maxRisk", String(riskPolicy.maxRiskPerTradeDollars));
      }
      if (selectedExpiration !== "auto") {
        harvestParams.set("expiration", selectedExpiration);
      }
      const anchorScope =
        selectedExpiration === "auto"
          ? "live"
          : `expiration:${selectedExpiration}`;
      const structuralAnchor = structuralAnchorsRef.current[anchorScope] ?? null;
      if (structuralAnchor) {
        harvestParams.set("anchorTradeDate", structuralAnchor.tradeDate);
        harvestParams.set("spxAnchor", String(structuralAnchor.spxSpot));
        if (structuralAnchor.spySpot !== null) {
          harvestParams.set("spyAnchor", String(structuralAnchor.spySpot));
        }
      }

      const [historyResponse, harvestResponse, signalHistoryResponse] =
        await Promise.all([
          displayHistoryRequest,
          fetch(`/api/zero-dte/harvest-schwab?${harvestParams.toString()}`, {
            headers: authHeaders,
            cache: "no-store",
            signal: controller.signal,
          }),
          signalHistoryRequest,
        ]);

      const historyJson = (await historyResponse.json()) as PriceHistoryResponse;
      const harvestJson = (await harvestResponse.json()) as HarvestResponse;
      const signalHistoryJson = signalHistoryResponse
        ? ((await signalHistoryResponse.json()) as PriceHistoryResponse)
        : historyJson;

      if (!historyResponse.ok || !historyJson.ok) {
        throw new Error(historyJson.error || "SPX price history failed.");
      }

      if (!harvestResponse.ok && !harvestJson.recommendation) {
        throw new Error(
          harvestJson.errors?.join(" ") || "Schwab 0DTE harvest failed.",
        );
      }
      if (harvestJson.researchMode) {
        if (
          !harvestJson.manualExpiration ||
          harvestJson.spx?.expirationDate !== harvestJson.manualExpiration
        ) {
          throw new Error(
            `Manual SPX chain ${harvestJson.manualExpiration ?? "unknown"} was not returned by Schwab.`,
          );
        }
      } else if (
        !harvestJson.spx?.isZeroDte ||
        harvestJson.spx.expirationDate !== harvestJson.tradeDate
      ) {
        throw new Error(
          `Strict 0DTE gate blocked SPX expiration ${harvestJson.spx?.expirationDate ?? "none"}; expected ${harvestJson.tradeDate}.`,
        );
      }
      if (
        signalHistoryResponse &&
        (!signalHistoryResponse.ok || !signalHistoryJson.ok)
      ) {
        throw new Error(
          signalHistoryJson.error || "SPX one-minute signal history failed.",
        );
      }

      if (sequence !== loadSequenceRef.current || controller.signal.aborted) {
        return;
      }

      const displayCandles = normalizeCandles(historyJson.candles ?? []);
      const oneMinuteCandles = normalizeCandles(
        signalHistoryJson.candles ?? [],
      );
      setCandles(displayCandles);
      setSignalCandles(oneMinuteCandles);
      setHarvest(harvestJson);
      setError(null);
      if (harvestJson.spx?.price && harvestJson.spx.expirationDate) {
        const anchorScope = harvestJson.researchMode
          ? `expiration:${harvestJson.spx.expirationDate}`
          : "live";
        const currentAnchor = structuralAnchorsRef.current[anchorScope] ?? null;
        if (
          !currentAnchor ||
          currentAnchor.tradeDate !== harvestJson.tradeDate ||
          currentAnchor.expirationDate !== harvestJson.spx.expirationDate
        ) {
          structuralAnchorsRef.current[anchorScope] = {
            tradeDate: harvestJson.tradeDate,
            expirationDate: harvestJson.spx.expirationDate,
            spxSpot: harvestJson.spx.price,
            spySpot: harvestJson.spy?.price ?? null,
          };
        }
      }
      setLastRefresh(new Date().toISOString());
      setFreshnessNow(Date.now());
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
      if (loadAbortRef.current === controller) {
        loadAbortRef.current = null;
        loadRequestKeyRef.current = null;
      }
      if (sequence === loadSequenceRef.current) setLoading(false);
    }
  }, [frequency, riskPolicy, selectedExpiration]);

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
      localization: {
        locale: "en-US",
        timeFormatter: formatCentralChartTime,
      },
      timeScale: {
        borderColor: "#223548",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: 9,
        tickMarkFormatter: (time: Time) => formatCentralChartTime(time),
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
    if (!chart || !candleSeries || !displaySessionCandles.length) return;

    candleSeries.setData(
      displaySessionCandles.map((candle) => ({
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

    const visibleTimes = displaySessionCandles.map((item) => item.time);
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
          "rgba(192,132,252,.58)",
          1,
          LineStyle.Dotted,
        );
        addLine(
          leastResistancePath.points.map((point) => ({ time: point.time, value: point.center })),
          "#c084fc",
          3,
          LineStyle.Solid,
        );
        addLine(
          leastResistancePath.points.map((point) => ({ time: point.time, value: point.trough })),
          "rgba(192,132,252,.58)",
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
          // Candidate structure is diagnostic only during TRANSITION. The
          // confirmed controlling map remains authoritative until activation.
          const structure = controllingMap?.structure ?? null;

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
  }, [analytics, controllingMap, displaySessionCandles, leastResistancePath, mapManager.state, overlays, recommendation]);

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

  const realizedPnlDollars = useMemo(
    () =>
      (executionMemory?.closedTrades ?? []).reduce(
        (sum, trade) => sum + (Number.isFinite(trade.pnlDollars) ? trade.pnlDollars : 0),
        0,
      ),
    [executionMemory?.closedTrades],
  );
  const openPnlDollars = useMemo(
    () =>
      (executionMemory?.positions ?? []).reduce((sum, position) => {
        const debit = calculateStrategyPackageQuote(spxRows, position.legs)?.buybackDebit;
        if (debit === null || debit === undefined || !Number.isFinite(debit)) return sum;
        return sum + (position.entryCredit - debit) * 100 * position.quantity;
      }, 0),
    [executionMemory?.positions, spxRows],
  );
  const dailyLossBlocked = Boolean(
    riskPolicy.dailyLossLimitDollars !== null &&
      realizedPnlDollars + openPnlDollars <= -riskPolicy.dailyLossLimitDollars,
  );
  const entryDataHealthBlockers = useMemo(() => {
    const blockers: string[] = [];
    if (manualChainResearch) {
      blockers.push("Manual future-expiration research chain is isolated from live execution.");
      return blockers;
    }
    if (error) blockers.push(`Live refresh failed: ${error}`);
    const failedQualityChecks = (harvest?.qualityChecks ?? []).filter(
      (check) => check.status === "fail",
    );
    for (const check of failedQualityChecks) {
      blockers.push(`Data quality failed — ${check.label}: ${check.message}`);
    }
    const generatedMs = Date.parse(harvest?.generatedAt ?? "");
    if (!Number.isFinite(generatedMs)) {
      blockers.push("Live chain timestamp is unavailable.");
    } else {
      const ageSeconds = Math.max(0, (freshnessNow - generatedMs) / 1000);
      if (ageSeconds > 20) {
        blockers.push(`Live chain is stale (${ageSeconds.toFixed(0)}s old); new entries are disabled until a fresh harvest arrives.`);
      }
    }
    return blockers;
  }, [error, freshnessNow, harvest?.generatedAt, harvest?.qualityChecks, manualChainResearch]);
  const volContext = useMemo(() => {
    if (
      !openingMap ||
      !isOpeningMapCaptureOnTime(openingMap.lockedAt) ||
      !recommendation ||
      !displaySessionCandles.length
    ) return null;
    const sessionHigh = Math.max(...displaySessionCandles.map((candle) => candle.high));
    const sessionLow = Math.min(...displaySessionCandles.map((candle) => candle.low));
    return buildZeroDteVolContext({
      openingSpot: openingMap.spot,
      openingExpectedMove: openingMap.expectedMove,
      currentSpot: recommendation.spxPrice,
      sessionHigh,
      sessionLow,
    });
  }, [displaySessionCandles, openingMap, recommendation]);

  const leaderCandidate = useMemo(() =>
    Object.values(executionCandidates)
      .filter((candidate): candidate is ExecutionCandidate => Boolean(candidate))
      .sort((a, b) => b.score - a.score)[0] ?? null,
  [executionCandidates]);

  const executionReadMemory = useMemo(() => {
    // Research must never inherit the live account/position memory simply
    // because the live DB read completed first. Its analytics get a sealed,
    // empty execution ledger for the selected research trade date.
    if (manualChainResearch && harvest?.tradeDate) {
      return emptyExecutionMemory(harvest.tradeDate);
    }
    if (executionMemory) return executionMemory;
    return null;
  }, [executionMemory, harvest?.tradeDate, manualChainResearch]);

  const portfolioRead = useMemo(() => {
    if (!executionReadMemory || !recommendation || !mapManager.state) return null;
    return buildZeroDtePortfolioRead({
      memory: executionReadMemory,
      rows: spxRows,
      recommendation,
      mapState: mapManager.state,
      candidates: executionCandidates,
      mood: harvest?.mood ?? null,
      riskBudgetDollars: riskPolicy.grossRiskBudgetDollars,
    });
  }, [
    decisionLeastResistancePath,
    executionCandidates,
    executionReadMemory,
    harvest?.mood,
    mapManager.state,
    recommendation,
    riskPolicy.grossRiskBudgetDollars,
    spxRows,
  ]);

  const entryExecutionRead: ZeroDteExecutionRead | null = useMemo(() => {
    if (
      !recommendation ||
      !harvest?.tradeDate ||
      !harvest.generatedAt ||
      !mapManager.state ||
      !executionReadMemory
    ) {
      return null;
    }

    return buildZeroDteExecutionRead({
      tradeDate: harvest.tradeDate,
      generatedAt: harvest.generatedAt,
      recommendation,
      spxRows,
      strikeFlow,
      tradeSelection: null,
      mapState: mapManager.state,
      memory: executionReadMemory,
      candidateOverride:
        executionCandidates[selectedExecutionStrategy] ?? null,
      positionOverride: null,
      tracking: manualChainResearch
        ? null
        : stableCandidateTracker.tracks[selectedExecutionStrategy],
      portfolio: portfolioRead,
      priceAction,
      premiumTape: premiumTape.points,
      riskPolicy,
      volContext,
      dailyLossBlocked,
      entryBlockers: entryDataHealthBlockers,
      leaderCandidate,
      leastResistancePath: decisionLeastResistancePath,
    });
  }, [
    decisionLeastResistancePath,
    manualChainResearch,
    executionCandidates,
    executionReadMemory,
    harvest?.generatedAt,
    harvest?.tradeDate,
    mapAwareTradeSelection,
    mapManager.state,
    portfolioRead,
    premiumTape.points,
    priceAction,
    recommendation,
    riskPolicy,
    volContext,
    dailyLossBlocked,
    entryDataHealthBlockers,
    leaderCandidate,
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
      manualChainResearch ||
      !recommendation ||
      !tradeDate ||
      !generatedAt ||
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
          tradeSelection: null,
          mapState,
          memory: executionMemory,
          candidateOverride: null,
          positionOverride: position,
          tracking: null,
          portfolio: portfolioRead,
          priceAction,
          premiumTape: premiumTape.points,
          riskPolicy,
          volContext,
          dailyLossBlocked,
          entryBlockers: entryDataHealthBlockers,
          leaderCandidate,
          leastResistancePath: decisionLeastResistancePath,
        }),
      ]),
    );
  }, [
    decisionLeastResistancePath,
    manualChainResearch,
    executionCandidates,
    executionMemory,
    harvest?.generatedAt,
    harvest?.tradeDate,
    mapAwareTradeSelection,
    mapManager.state,
    portfolioRead,
    premiumTape.points,
    priceAction,
    recommendation,
    riskPolicy,
    volContext,
    dailyLossBlocked,
    entryDataHealthBlockers,
    leaderCandidate,
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
      manualChainResearch ||
      !recommendation ||
      !tradeDate ||
      !generatedAt ||
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
          tradeSelection: null,
          mapState,
          memory: executionMemory,
          candidateOverride: candidate,
          positionOverride: null,
          tracking: stableCandidateTracker.tracks[strategy],
          portfolio: portfolioRead,
          priceAction,
          premiumTape: premiumTape.points,
          riskPolicy,
          volContext,
          dailyLossBlocked,
          entryBlockers: entryDataHealthBlockers,
          leaderCandidate,
          leastResistancePath: decisionLeastResistancePath,
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
    decisionLeastResistancePath,
    manualChainResearch,
    executionCandidates,
    executionMemory,
    harvest?.generatedAt,
    harvest?.tradeDate,
    mapAwareTradeSelection,
    mapManager.state,
    portfolioRead,
    positionExecutionReads,
    premiumTape.points,
    priceAction,
    recommendation,
    riskPolicy,
    volContext,
    dailyLossBlocked,
    entryDataHealthBlockers,
    leaderCandidate,
    spxRows,
    stableCandidateTracker.tracks,
    strikeFlow,
  ]);

  const signalPaint = useExecutionSignalPaint({
    tradeDate: harvest?.tradeDate,
    frequencyMinutes: 1,
    candles: officialSignalCandles,
    reads: executionReadsForPaint,
  });

  const signalFunnel = useExecutionSignalFunnel({
    tradeDate: manualChainResearch ? null : harvest?.tradeDate,
    reads: executionReadsForPaint,
    signals: signalPaint.signals,
    shadowTrades,
  });

  const shadowExecutionReads = useMemo(() => {
    const tradeDate = harvest?.tradeDate;
    const generatedAt = harvest?.generatedAt;
    const mapState = mapManager.state;
    if (
      manualChainResearch ||
      !tradeDate ||
      !generatedAt ||
      !recommendation ||
      !mapState ||
      !executionMemory
    ) {
      return {} as Record<string, ZeroDteExecutionRead>;
    }

    const output: Record<string, ZeroDteExecutionRead> = {};
    for (const shadow of shadowTrades) {
      if (shadow.state !== "open" && shadow.adaptiveState !== "open") continue;
      const position = shadowTradeToExecutionPosition(shadow);
      output[shadow.id] = buildZeroDteExecutionRead({
        tradeDate,
        generatedAt,
        recommendation,
        spxRows,
        strikeFlow,
        tradeSelection: null,
        mapState,
        memory: executionMemory,
        candidateOverride: null,
        positionOverride: position,
        tracking: null,
        portfolio: portfolioRead,
        priceAction,
        premiumTape: premiumTape.points,
        riskPolicy,
        volContext,
        dailyLossBlocked,
        entryBlockers: entryDataHealthBlockers,
        leaderCandidate,
        leastResistancePath: decisionLeastResistancePath,
      });
    }
    return output;
  }, [
    dailyLossBlocked,
    entryDataHealthBlockers,
    decisionLeastResistancePath,
    manualChainResearch,
    executionMemory,
    harvest?.generatedAt,
    harvest?.tradeDate,
    leaderCandidate,
    mapAwareTradeSelection,
    mapManager.state,
    portfolioRead,
    premiumTape.points,
    priceAction,
    recommendation,
    riskPolicy,
    shadowTrades,
    spxRows,
    strikeFlow,
    volContext,
  ]);

  useEffect(() => {
    const sellSignals = signalPaint.signals.filter(
      (signal) => signal.kind === "SELL",
    );
    if (!sellSignals.length) return;

    const existingSignalIds = new Set(shadowTrades.map((trade) => trade.signalId));
    for (const signalId of existingSignalIds) {
      shadowOpeningSignalIdsRef.current.delete(signalId);
    }
    const pending = sellSignals.filter(
      (signal) =>
        !existingSignalIds.has(signal.id) &&
        !shadowOpeningSignalIdsRef.current.has(signal.id),
    );
    if (!pending.length) return;

    for (const signal of pending) {
      shadowOpeningSignalIdsRef.current.add(signal.id);
    }

    Promise.allSettled(
      pending.map((signal) =>
        openZeroDteShadowTrade({
          signal,
          spxRows,
        }),
      ),
    ).then((results) => {
      const opened: ZeroDteShadowTrade[] = [];
      const failures: string[] = [];

      results.forEach((result, index) => {
        const signal = pending[index];
        if (!signal) return;
        if (result.status === "fulfilled" && result.value) {
          opened.push(result.value);
          return;
        }

        // A transient API/DB/quote failure must not blacklist a valid SELL
        // signal for the rest of the session. Release only failed/null attempts
        // so the next live refresh can retry them.
        shadowOpeningSignalIdsRef.current.delete(signal.id);
        if (result.status === "rejected") {
          failures.push(
            result.reason instanceof Error
              ? result.reason.message
              : "Shadow trade creation failed.",
          );
        } else {
          failures.push(
            `${signal.label}: exact-leg quotes were not complete enough to paper-enter; retrying while the SELL signal remains valid.`,
          );
        }
      });

      if (opened.length) {
        setShadowTrades((current) => {
          const byId = new Map(current.map((trade) => [trade.id, trade]));
          for (const trade of opened) byId.set(trade.id, trade);
          return [...byId.values()];
        });
      }
      setShadowError(failures.length ? failures.join(" ") : null);
    });
  }, [shadowTrades, signalPaint.signals, spxRows]);

  useEffect(() => {
    if (
      !harvest?.tradeDate ||
      !harvest.generatedAt ||
      !recommendation ||
      !shadowTrades.some(
        (trade) => trade.state === "open" || trade.adaptiveState === "open",
      )
    ) {
      return;
    }

    const sampleKey = `${harvest.tradeDate}:${harvest.generatedAt}`;
    if (shadowSampleKeyRef.current === sampleKey) return;
    shadowSampleKeyRef.current = sampleKey;

    const openItems: Array<{
      tradeId: string;
      read: ZeroDteExecutionRead;
      currentShortBuybackPrice: number | null;
      currentShortLegMultiple: number | null;
      adaptiveDecision: ReturnType<typeof evaluateZeroDteAdaptiveManagement> | null;
    }> = shadowTrades.flatMap((trade) => {
      if (trade.state !== "open" && trade.adaptiveState !== "open") return [];
      const read = shadowExecutionReads[trade.id];
      if (!read) return [];
      const shortRead = currentShadowShortLegRead(spxRows, trade.entryShortLegs);
      const adaptiveDecision =
        trade.adaptiveState === "open"
          ? evaluateZeroDteAdaptiveManagement({
              trade,
              read,
              spot: recommendation.spxPrice,
              auction: liveAuctionManagementRef.current,
            })
          : null;
      return [{ tradeId: trade.id, read, adaptiveDecision, ...shortRead }];
    });
    if (!openItems.length) return;

    sampleZeroDteShadowTrades({
      tradeDate: harvest.tradeDate,
      generatedAt: harvest.generatedAt,
      spot: recommendation.spxPrice,
      items: openItems,
    })
      .then(async (updated) => {
        if (updated.length) {
          setShadowTrades((current) => {
            const byId = new Map(current.map((trade) => [trade.id, trade]));
            for (const trade of updated) byId.set(trade.id, trade);
            return [...byId.values()];
          });
        }

        const updatedById = new Map(updated.map((trade) => [trade.id, trade]));
        const exits = openItems.flatMap(({ tradeId, read }) => {
          const sampledTrade = updatedById.get(tradeId);
          if (!sampledTrade || sampledTrade.state !== "open") return [];
          if (read.timeRegime.regime === "CLOSED") {
            return [{ tradeId, read, reason: "SESSION_CLOSE" }];
          }
          const decision = evaluateZeroDteShadowExit(sampledTrade);
          return decision.shouldExit && decision.reason
            ? [{ tradeId, read, reason: decision.reason }]
            : [];
        });
        if (!exits.length) return;

        const closed = await Promise.all(
          exits.map(({ tradeId, read, reason }) =>
            closeZeroDteShadowTrade({
              tradeId,
              tradeDate: harvest.tradeDate,
              generatedAt: harvest.generatedAt,
              read,
              reason,
            }),
          ),
        );
        const validClosed = closed.filter(
          (trade): trade is ZeroDteShadowTrade => Boolean(trade),
        );
        if (validClosed.length) {
          setShadowTrades((current) => {
            const byId = new Map(current.map((trade) => [trade.id, trade]));
            for (const trade of validClosed) byId.set(trade.id, trade);
            return [...byId.values()];
          });
        }
        setShadowError(null);
      })
      .catch((shadowSampleError) => {
        setShadowError(
          shadowSampleError instanceof Error
            ? shadowSampleError.message
            : "Shadow trade sampling failed.",
        );
      });
  }, [
    harvest?.generatedAt,
    harvest?.tradeDate,
    recommendation,
    shadowExecutionReads,
    shadowTrades,
    spxRows,
  ]);

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
        time: alignToDisplayCandle(signal.candleTime, frequency) as UTCTimestamp,
        position: signal.kind === "SELL" ? "aboveBar" : "belowBar",
        color: signal.kind === "SELL" ? "#16c784" : "#ea3943",
        shape: signal.kind === "SELL" ? "arrowDown" : "arrowUp",
        text: `${signal.kind} · ${shortStrategyLabel(signal.strategy)} · ${Math.round(
          signal.confidence,
        )}`,
      })),
    );
  }, [frequency, visibleExecutionSignals]);

  useEffect(() => {
    if (
      !executionReadsForPaint.length ||
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
            {manualChainResearch ? (
              <span style={styles.researchPill}>
                MANUAL CHAIN · {formatExpirationShort(harvest?.spx?.expirationDate)}
              </span>
            ) : null}
          </div>
          <div style={styles.subTitle}>
            Broker-authorized SPX candles with WheelDesk structure overlays.
          </div>
        </div>

        <div style={styles.actions}>
          <button
            type="button"
            onClick={() => void connectSchwab()}
            disabled={schwabConnectBusy}
            style={
              schwabConnection?.connected
                ? styles.schwabConnectedButton
                : styles.schwabConnectButton
            }
            title={
              schwabConnection?.connected
                ? "Schwab is connected. Click to re-authorize the broker connection."
                : schwabConnection?.needsReconnect
                  ? "Schwab authorization has expired. Click to reconnect."
                  : schwabConnection?.error
                    ? `${schwabConnection.error} Click to connect Schwab.`
                    : "Authorize WheelDesk with Schwab."
            }
          >
            <span
              style={{
                ...styles.schwabStatusDot,
                background: schwabConnection?.connected ? "#16c784" : "#f59e0b",
                boxShadow: schwabConnection?.connected
                  ? "0 0 10px rgba(22,199,132,.75)"
                  : "0 0 10px rgba(245,158,11,.55)",
              }}
            />
            {schwabConnectBusy
              ? "OPENING SCHWAB…"
              : schwabStatusLoading
                ? "CHECKING SCHWAB"
                : schwabConnection?.connected
                  ? "SCHWAB CONNECTED"
                  : schwabConnection?.needsReconnect
                    ? "RECONNECT SCHWAB"
                    : "CONNECT SCHWAB"}
          </button>

          <select
            value={selectedExpiration}
            onChange={(event) => setSelectedExpiration(event.target.value)}
            style={styles.select}
            title="SPX expiration chain"
          >
            <option value="auto">AUTO · 0DTE</option>
            {expirationOptions.map((expiration) => (
              <option key={expiration.date} value={expiration.date}>
                {formatExpirationChoice(expiration.date, expiration.daysFromTradeDate)}
              </option>
            ))}
          </select>

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
            {visibleExecutionSignals.length} confirmed · immediate after qualified trigger
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

      {!manualChainResearch ? (
        <div style={styles.signalFunnel}>
          <div style={styles.signalFunnelHeader}>
            <div>
              <strong>Today's Signal Funnel</strong>
              <span>Unique setup keys · highest stage reached</span>
            </div>
            <em>SELL → Shadow gap {signalFunnel.losses.shadowOpen}</em>
          </div>
          <div style={styles.signalFunnelGrid}>
            {[
              ["Observed", signalFunnel.counts.OBSERVED],
              ["3-Bar Base", signalFunnel.counts.BASELINE],
              ["Expanded", signalFunnel.counts.EXPANDED],
              ["Rollover", signalFunnel.counts.ROLLOVER],
              ["Rejection", signalFunnel.counts.REJECTION],
              ["Score", signalFunnel.counts.SCORE],
              ["SELL", signalFunnel.counts.SELL],
              ["Shadow", signalFunnel.counts.SHADOW],
            ].map(([label, value]) => (
              <div key={String(label)} style={styles.signalFunnelCell}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <div style={styles.signalFunnelLosses}>
            <span>Baseline wait {signalFunnel.losses.baseline}</span>
            <span>No expansion {signalFunnel.losses.expansion}</span>
            <span>No rollover {signalFunnel.losses.rollover}</span>
            <span>No rejection {signalFunnel.losses.rejection}</span>
            <span>Score short {signalFunnel.losses.score}</span>
            <span>Final gate {signalFunnel.losses.finalGate}</span>
          </div>
        </div>
      ) : null}

      {error ? <div style={styles.error}>{error}</div> : null}
      {expirationError ? (
        <div style={styles.qualityWarning}>
          Expiration list: {expirationError}
        </div>
      ) : null}
      {manualChainResearch ? (
        <div style={styles.researchBanner}>
          Manual SPX chain {harvest?.spx?.expirationDate ?? selectedExpiration} · research only.
          Scanner, OI, dealer, and structure analytics remain active; execution, signal paint, and Shadow Lab entries are disabled.
        </div>
      ) : null}
      {(harvest?.qualityChecks ?? []).some((check) => check.status === "fail") ? (
        <div style={styles.error}>
          {(harvest?.qualityChecks ?? [])
            .filter((check) => check.status === "fail")
            .map((check) => `${check.label}: ${check.message}`)
            .join(" ")}
        </div>
      ) : null}
      {(harvest?.qualityChecks ?? []).some((check) => check.status === "warn") ? (
        <div style={styles.qualityWarning}>
          {(harvest?.qualityChecks ?? [])
            .filter((check) => check.status === "warn")
            .map((check) => `${check.label}: ${check.message}`)
            .join(" ")}
        </div>
      ) : null}

      <div style={styles.commandGrid}>
        <div style={styles.chartPanel}>
          <div ref={chartHostRef} style={styles.chartHost} />

          <ZeroDteEsOrderFlowPanel
            enabled={!manualChainResearch}
            spxPrice={currentPrice > 0 ? currentPrice : null}
            onManagementRead={handleLiveAuctionManagementRead}
          />

          <div style={styles.legend}>
            <LegendItem color="#ff8a34" text="Call Wall" />
            <LegendItem color="#2f80ed" text="Put Wall" />
            <LegendItem color="#f4f7fb" text="Pin" />
            <LegendItem color="#ffd400" text="IF Center" />
            <LegendItem color="#c084fc" text="Least-resistance path / envelope" />
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
            <div style={styles.collapsibleHeader}>
              <div style={styles.signalLabel}>Execution Engine</div>
              <button
                type="button"
                onClick={() => toggleRailSection("execution")}
                style={styles.collapseButton}
              >
                {railExpanded.execution ? "−" : "+"}
              </button>
            </div>

            <div style={styles.executionSummaryRow}>
              <div style={styles.executionAction}>
                {manualChainResearch
                  ? "RESEARCH"
                  : liveExecutionRead?.lifecycle.replaceAll("_", " ") ?? "WAIT"}
              </div>
              {!railExpanded.execution ? (
                <strong style={styles.collapsedScore}>{liveExecutionRead?.confidence ?? 0}</strong>
              ) : null}
            </div>

            {railExpanded.execution ? (
              <>
                <div style={styles.scoreValue}>{liveExecutionRead?.confidence ?? 0}</div>
                <div style={styles.signalNote}>
                  {liveExecutionRead?.position ? "Exit Readiness" : "Entry Readiness"}
                </div>
                <div style={styles.reasonList}>
                  {(manualChainResearch
                    ? ["Manual future-expiration chain selected. Live execution and shadow-entry generation are disabled."]
                    : liveExecutionRead?.reasons ?? ["Building live execution context"])
                    .slice(0, 4)
                    .map((reason) => (
                      <div key={reason} style={styles.reasonItem}>
                        <span style={styles.reasonDot} />
                        {reason}
                      </div>
                    ))}
                </div>
              </>
            ) : null}
          </div>

          <ExecutionTradeDock
            read={entryExecutionRead}
            portfolio={portfolioRead}
            positionReads={manualChainResearch ? {} : positionExecutionReads}
            executionPositions={manualChainResearch ? [] : executionMemory?.positions ?? []}
            candidates={executionCandidates}
            tracks={manualChainResearch ? null : stableCandidateTracker.tracks}
            riskPolicy={riskPolicy}
            selectedStrategy={selectedExecutionStrategy}
            onStrategyChange={handleExecutionStrategyChange}
            readOnly={manualChainResearch}
            readOnlyReason={
              manualChainResearch
                ? `Manual future-expiration chain ${harvest?.spx?.expirationDate ?? selectedExpiration}. Analytics and what-if evaluation remain active; live entry and Shadow entry are disabled.`
                : null
            }
            entryLocked={entryDataHealthBlockers.length > 0}
            entryLockedReason={entryDataHealthBlockers[0] ?? null}
            busy={executionBusy}
            error={manualChainResearch ? null : executionDbError}
            evaluateCandidate={(candidate) => {
              if (
                !harvest?.tradeDate ||
                !harvest.generatedAt ||
                !recommendation ||
                !mapManager.state ||
                !executionReadMemory
              ) {
                return null;
              }
              const evaluatedCandidates = {
                ...executionCandidates,
                [candidate.strategy]: candidate,
              };
              const evaluatedPortfolio = buildZeroDtePortfolioRead({
                memory: executionReadMemory,
                rows: spxRows,
                recommendation,
                mapState: mapManager.state,
                candidates: evaluatedCandidates,
                mood: harvest.mood ?? null,
                riskBudgetDollars: riskPolicy.grossRiskBudgetDollars,
              });
              return buildZeroDteExecutionRead({
                tradeDate: harvest.tradeDate,
                generatedAt: harvest.generatedAt,
                recommendation,
                spxRows,
                strikeFlow,
                tradeSelection: null,
                mapState: mapManager.state,
                memory: executionReadMemory,
                candidateOverride: candidate,
                positionOverride: null,
                tracking: null,
                portfolio: evaluatedPortfolio,
                priceAction,
                premiumTape: premiumTape.points,
                riskPolicy,
                volContext,
                dailyLossBlocked,
                entryBlockers: entryDataHealthBlockers,
                leaderCandidate,
                leastResistancePath: decisionLeastResistancePath,
              });
            }}
            onOpen={async ({
              candidate,
              entryCredit,
              quantity,
              setupSource,
              engineClearedAtEntry,
              overrideReason,
              entryShortLegs,
            }) => {
              if (manualChainResearch) {
                setExecutionDbError("Research chain is read-only. Live position entry is disabled.");
                return;
              }
              if (
                setupSource !== "manual" &&
                entryDataHealthBlockers.length > 0
              ) {
                setExecutionDbError(
                  `New engine entry is locked by the live-data safety gate: ${entryDataHealthBlockers.join(" ")}`,
                );
                return;
              }
              if (!harvest?.tradeDate || !harvest.spx?.expirationDate) {
                setExecutionDbError(
                  "The live trade date / expiration is not available yet.",
                );
                return;
              }
              if (setupSource !== "manual" && !executionMemory) {
                setExecutionDbError(
                  "Live execution persistence is still initializing. Try the engine entry again after the next refresh.",
                );
                return;
              }
              if (
                setupSource !== "manual" &&
                (!recommendation ||
                  !openingMap ||
                  !mapManager.state)
              ) {
                setExecutionDbError(
                  "Live session context is still building. Try the engine entry again after the next refresh.",
                );
                return;
              }

              const resolvedEntryShortLegs = entryShortLegs.map((entry) => {
                if (entry.sellPrice !== null && entry.sellPrice > 0) return entry;
                const row = spxRows.find(
                  (item) =>
                    item.optionType === entry.optionType &&
                    Math.abs(item.strike - entry.strike) < 0.01,
                );
                const liveBid =
                  row && Number.isFinite(row.bid) && Number(row.bid) > 0
                    ? Number(row.bid)
                    : null;
                return liveBid === null
                  ? entry
                  : { ...entry, sellPrice: liveBid, source: "live-bid" as const };
              });

              setExecutionBusy(true);
              try {
                if (setupSource === "manual") {
                  const memory = await openManualExecutionPositionDb({
                    tradeDate: harvest.tradeDate,
                    expirationDate: harvest.spx.expirationDate,
                    entryTime: new Date().toISOString(),
                    entryCredit,
                    contracts: quantity,
                    candidate,
                    overrideReason: overrideReason ?? "Manual actual position",
                    entryMarkCredit: null,
                    entrySellableCredit: null,
                    entryShortDeltaAbs: null,
                    entryTouchRiskProxyPct: null,
                    entryRangeConsumptionPct: volContext?.rangeConsumptionPct ?? null,
                    entryEventRisk: riskPolicy.eventRisk,
                    entryShortLegs: resolvedEntryShortLegs,
                  });
                  setExecutionMemory(memory);
                  setSelectedExecutionStrategy(candidate.strategy);
                  setExecutionDbError(null);
                  return;
                }

                // From this point forward we are on the engine-entry path.
                // Re-assert the engine-only context so TypeScript can narrow
                // these values after the manual branch returns.
                if (
                  !recommendation ||
                  !openingMap ||
                  !mapManager.state ||
                  !executionMemory
                ) {
                  throw new Error(
                    "Live session context is still building. Try the engine entry again after the next refresh.",
                  );
                }

                const openCandidates = {
                  ...executionCandidates,
                  [candidate.strategy]: candidate,
                };
                const openPortfolio = buildZeroDtePortfolioRead({
                  memory: executionMemory,
                  rows: spxRows,
                  recommendation,
                  mapState: mapManager.state,
                  candidates: openCandidates,
                  mood: harvest.mood ?? null,
                  riskBudgetDollars: riskPolicy.grossRiskBudgetDollars,
                });
                const openRead = buildZeroDteExecutionRead({
                  tradeDate: harvest.tradeDate,
                  generatedAt:
                    harvest.generatedAt ?? new Date().toISOString(),
                  recommendation,
                  spxRows,
                  strikeFlow,
                  tradeSelection: null,
                  mapState: mapManager.state,
                  memory: executionMemory,
                  candidateOverride: candidate,
                  positionOverride: null,
                  tracking: stableCandidateTracker.tracks[candidate.strategy],
                  portfolio: openPortfolio,
                  priceAction,
                  premiumTape: premiumTape.points,
                  riskPolicy,
                  volContext,
                  dailyLossBlocked,
                  entryBlockers: entryDataHealthBlockers,
                  leaderCandidate,
                  leastResistancePath: decisionLeastResistancePath,
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
                  setupSource,
                  engineClearedAtEntry,
                  overrideReason,
                  signalTime: engineClearedAtEntry ? openRead.generatedAt : null,
                  signalCredit: engineClearedAtEntry ? openRead.currentCredit : null,
                  entryMarkCredit: openRead.currentCredit,
                  entrySellableCredit: openRead.currentSellableCredit,
                  entryShortDeltaAbs: openRead.shortDeltaAbs,
                  entryTouchRiskProxyPct: openRead.touchRiskProxyPct,
                  entryRangeConsumptionPct: openRead.volContext?.rangeConsumptionPct ?? null,
                  entryEventRisk: riskPolicy.eventRisk,
                  entryShortLegs: resolvedEntryShortLegs,
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
            <div style={styles.collapsibleHeader}>
              <div style={styles.railTitle}>{liveExecutionRead?.position ? "Exit Score" : "Entry Score"}</div>
              <button type="button" onClick={() => toggleRailSection("score")} style={styles.collapseButton}>
                {railExpanded.score ? "−" : "+"}
              </button>
            </div>
            {railExpanded.score ? (
              <div style={styles.breakdownList}>
                {(liveExecutionRead?.components ?? []).map((component) => (
                  <div key={component.key} style={styles.breakdownRow}>
                    <div style={styles.breakdownHeader}>
                      <span>{component.label}</span>
                      <strong>{component.value.toFixed(1)}/{component.max}</strong>
                    </div>
                    <div style={styles.breakdownTrack}>
                      <div
                        style={{
                          ...styles.breakdownFill,
                          width: `${Math.max(0, Math.min(100, (component.value / component.max) * 100))}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div style={styles.railCard}>
            <div style={styles.collapsibleHeader}>
              <div style={styles.railTitle}>Structure Read</div>
              <button type="button" onClick={() => toggleRailSection("structure")} style={styles.collapseButton}>
                {railExpanded.structure ? "−" : "+"}
              </button>
            </div>
            {railExpanded.structure ? (
              <>
                <RailRow label="Bias" value={recommendation?.pressureBias?.toUpperCase() ?? "—"} />
                <RailRow
                  label="Center Distance"
                  value={liveExecutionRead ? `${liveExecutionRead.centerDistance.toFixed(1)} pts` : "—"}
                />
                <RailRow label="SPX Rows" value={String(spxRows.length)} />
                <RailRow label="Expiration" value={harvest?.spx?.expirationDate ?? "—"} />
                <RailRow label="Feed" value={harvest?.provider?.toUpperCase() ?? "SCHWAB"} />
              </>
            ) : null}
          </div>
        </aside>
      </div>

      <ZeroDteRiskPolicyPanel
        policy={riskPolicy}
        onChange={setRiskPolicy}
        realizedPnlDollars={realizedPnlDollars}
        dailyLossBlocked={dailyLossBlocked}
        volContext={volContext}
      />

      <ZeroDteShadowTradePanel trades={shadowTrades} error={shadowError} />

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
          liveTape={premiumTape.points}
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

function selectCashSessionCandles(
  candles: Candle[],
  tradeDate: string | null | undefined,
) {
  if (!tradeDate) return candles;
  return candles.filter((candle) => {
    const parts = centralDateTimeParts(candle.time);
    if (!parts || parts.date !== tradeDate) return false;
    return parts.minutes >= 8 * 60 + 30 && parts.minutes <= 15 * 60;
  });
}

const CENTRAL_CHART_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  hour: "numeric",
  minute: "2-digit",
  hour12: false,
});

function formatCentralChartTime(time: Time) {
  const date = chartTimeToDate(time);
  return date ? CENTRAL_CHART_TIME_FORMATTER.format(date) : "";
}

function chartTimeToDate(time: Time) {
  if (typeof time === "number") {
    return new Date(Number(time) * 1000);
  }

  if (typeof time === "string") {
    const parsed = Date.parse(time);
    return Number.isFinite(parsed) ? new Date(parsed) : null;
  }

  if (
    time &&
    typeof time === "object" &&
    "year" in time &&
    "month" in time &&
    "day" in time
  ) {
    return new Date(Date.UTC(time.year, time.month - 1, time.day, 12, 0, 0));
  }

  return null;
}

function selectCompletedCashSessionCandles(
  candles: Candle[],
  tradeDate?: string,
  generatedAt?: string,
) {
  if (!tradeDate || !generatedAt) return [] as Candle[];
  const generatedMs = Date.parse(generatedAt);
  if (!Number.isFinite(generatedMs)) return [] as Candle[];
  return selectCashSessionCandles(candles, tradeDate).filter(
    (candle) => candle.time * 1000 + 60_000 <= generatedMs,
  );
}

function centralDateTimeParts(time: number) {
  const seconds = time > 10_000_000_000 ? Math.floor(time / 1000) : Math.floor(time);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(seconds * 1000))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + minute,
  };
}

function alignToDisplayCandle(time: number, frequencyMinutes: 1 | 5) {
  const intervalSeconds = frequencyMinutes * 60;
  return Math.floor(time / intervalSeconds) * intervalSeconds;
}

function normalizeCandles(candles: Candle[]) {
  const byTime = new Map<number, Candle>();

  for (const candle of candles) {
    if (
      !Number.isFinite(candle.time) ||
      !Number.isFinite(candle.open) ||
      !Number.isFinite(candle.high) ||
      !Number.isFinite(candle.low) ||
      !Number.isFinite(candle.close)
    ) {
      continue;
    }

    byTime.set(candle.time, candle);
  }

  return [...byTime.values()].sort((a, b) => a.time - b.time);
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

function formatExpirationChoice(date: string, daysFromTradeDate: number) {
  const short = formatExpirationShort(date);
  if (daysFromTradeDate <= 0) return `${short} · 0DTE`;
  return `${short} · +${daysFromTradeDate}d`;
}

function formatExpirationShort(date: string | null | undefined) {
  if (!date) return "—";
  const match = date.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return match ? `${match[1]}/${match[2]}` : date;
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
  researchPill: {
    display: "inline-flex",
    alignItems: "center",
    border: "1px solid #8b5cf6",
    background: "rgba(139,92,246,.12)",
    color: "#c4b5fd",
    borderRadius: 999,
    padding: "5px 9px",
    fontSize: 10,
    fontWeight: 850,
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
    flexWrap: "wrap",
  },
  schwabConnectButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    background: "rgba(23,125,220,.12)",
    color: "#9bd7ff",
    border: "1px solid rgba(85,214,255,.42)",
    borderRadius: 9,
    padding: "9px 11px",
    fontSize: 10,
    fontWeight: 850,
    textDecoration: "none",
    letterSpacing: 0.35,
  },
  schwabConnectedButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    background: "rgba(22,199,132,.1)",
    color: "#7ff2bd",
    border: "1px solid #1f6b50",
    borderRadius: 9,
    padding: "9px 11px",
    fontSize: 10,
    fontWeight: 850,
    textDecoration: "none",
    letterSpacing: 0.35,
  },
  schwabStatusDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    flex: "0 0 auto",
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
  researchBanner: {
    marginTop: 10,
    border: "1px solid rgba(139,92,246,.45)",
    background: "rgba(76,29,149,.16)",
    color: "#d8ccff",
    borderRadius: 9,
    padding: "9px 11px",
    fontSize: 11,
    lineHeight: 1.45,
  },
  researchDock: {
    display: "grid",
    gap: 6,
    border: "1px solid rgba(139,92,246,.38)",
    background: "rgba(76,29,149,.12)",
    color: "#c4b5fd",
    borderRadius: 11,
    padding: 12,
    fontSize: 11,
    lineHeight: 1.45,
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
  signalFunnel: {
    display: "grid",
    gap: 8,
    marginBottom: 12,
    background: "#08131d",
    border: "1px solid #19344a",
    borderRadius: 10,
    padding: "9px 10px",
  },
  signalFunnelHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    color: "#dce9f4",
    fontSize: 10,
  },
  signalFunnelGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(82px, 1fr))",
    gap: 6,
  },
  signalFunnelCell: {
    display: "grid",
    gap: 2,
    border: "1px solid #173047",
    borderRadius: 8,
    padding: "6px 8px",
    color: "#7991a5",
    fontSize: 9,
  },
  signalFunnelLosses: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    color: "#7890a4",
    fontSize: 9,
  },
  qualityWarning: {
    background: "rgba(245,197,66,.07)",
    border: "1px solid rgba(245,197,66,.32)",
    color: "#f7d56a",
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    fontSize: 11,
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
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: 10,
    maxHeight: 610,
    overflowY: "auto",
    overflowX: "hidden",
    scrollbarGutter: "stable",
    paddingRight: 6,
  },
  collapsibleHeader: {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  collapseButton: {
    flex: "0 0 auto",
    width: 24,
    height: 24,
    borderRadius: 6,
    border: "1px solid #31506a",
    background: "#07131d",
    color: "#7dd3fc",
    fontSize: 17,
    fontWeight: 900,
    lineHeight: "20px",
    cursor: "pointer",
    padding: 0,
  },
  executionSummaryRow: {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  collapsedScore: {
    color: "#dbeafe",
    fontSize: 16,
    fontWeight: 900,
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
    flex: "0 0 auto",
    minHeight: "max-content",
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
    flex: "0 0 auto",
    minHeight: "max-content",
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
