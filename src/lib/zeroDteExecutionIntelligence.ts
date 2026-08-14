import type { SessionMapManagerState } from "./session/mapEngine";
import { getControllingMarketMap } from "./session/mapEngine";
import type { ZeroDteChainRow, ZeroDteRecommendation } from "./zeroDteOiIntelligence";
import type { ZeroDteStrikeFlowRead } from "./zeroDteStrikeFlow";
import {
  classifyZeroDteTimeRegime,
  scorePriceExhaustion,
  type ZeroDtePriceActionContext,
  type ZeroDteTimeRegimeRead,
} from "./zeroDteTimeRegime";
import type {
  CandidatePortfolioContribution,
  ZeroDtePortfolioRead,
} from "./zeroDtePortfolioEngine";
import type {
  ZeroDteStrategyRanking,
  ZeroDteTradeSelection,
} from "./zeroDteTradeSelector";
import {
  buildPremiumCrestRead,
  type ZeroDtePremiumCrestRead,
} from "./zeroDtePremiumCrestEngine";
import {
  absoluteDistanceFloorPoints,
  eventRiskScoreAdjustment,
  eventRiskSizeMultiplier,
  volContextScoreAdjustment,
  volContextSizeMultiplier,
  type ZeroDteRiskPolicy,
  type ZeroDteVolContext,
} from "./zeroDteRiskPolicy";
import { isOpeningMapCaptureOnTime } from "./zeroDteOpeningMap";
import type { ZeroDteLeastResistancePath } from "./zeroDteLeastResistancePath";
import { leastResistanceThreatensShort } from "./zeroDteLeastResistancePath";
import { buildZeroDteRemainingMove } from "./zeroDteRemainingMove";
import { minimumDistanceExpectedMovePctForRiskMode } from "./zeroDteCreditSpreadSelector";

export type ExecutionLifecycle =
  | "WAIT"
  | "ARMED"
  | "SELL_READY"
  | "POSITION_OPEN"
  | "HOLD"
  | "BUYBACK_READY"
  | "EXITED"
  | "COOLDOWN";

export type ExecutionStrategy =
  | "iron-fly"
  | "put-credit-spread"
  | "call-credit-spread";

export type ExecutionLeg = {
  optionType: "call" | "put";
  action: "sell" | "buy";
  strike: number;
};

export type ExecutionCandidateTracking = {
  strategy: ExecutionStrategy;
  candidate: ExecutionCandidate | null;
  scannerCandidate: ExecutionCandidate | null;
  lockedAt: string | null;
  lockedCandleTime: number | null;
  lockedCredit: number | null;
  ageCandles: number;
  status:
    | "LOCKED"
    | "WATCH_LOCKED"
    | "CHALLENGER_BUILDING"
    | "REPLACED"
    | "STRUCTURE_INVALID"
    | "NO_CANDIDATE";
  challengerSetupKey: string | null;
  challengerStartedCandleTime: number | null;
  lastReplacementReason: string | null;
};

export type ExecutionCandidate = {
  strategy: ExecutionStrategy;
  label: string;
  setupKey: string;
  score: number;
  eligible: boolean;
  legs: ExecutionLeg[];
  /** Mid-based package mark used for the premium signal. */
  estimatedCredit: number | null;
  sellableCredit?: number | null;
  buybackDebit?: number | null;
  shortDeltaAbs?: number | null;
  /** Frozen discovery thesis for credit spreads; protects fade waivers from later semantic drift. */
  spreadMode?: "trend" | "exhaustion-fade" | null;
  maxRiskDollars: number | null;
  mapPhase: SessionMapManagerState["phase"];
  mapCenter: number;
  railBreached: SessionMapManagerState["railBreached"];
  reasons: string[];
  blockers: string[];
};

export type ExecutionCandidateBook = Record<
  ExecutionStrategy,
  ExecutionCandidate[]
>;

export type ExecutionPremiumTapePoint = {
  timestamp: string;
  spot: number;
  strategy: ExecutionStrategy;
  setupKey: string;
  credit: number;
};

export type ExecutionPremiumSample = {
  timestamp: string;
  spot: number;
  strategy: ExecutionStrategy;
  setupKey: string;
  credit: number;
  sellableCredit?: number | null;
  buybackDebit?: number | null;
  entryScore: number;
  exitScore: number;
  mapPhase: SessionMapManagerState["phase"];
  mapCenter: number;
  railBreached: SessionMapManagerState["railBreached"];
  lifecycle: ExecutionLifecycle;
  timeRegime: ZeroDteTimeRegimeRead["regime"];
  shortDistancePoints: number | null;
  shortDistanceExpectedMovePct: number | null;
  candidateAgeCandles: number;
  trackedSince: string | null;
  dealerPressure?: number | null;
  strikeFlowState?: string | null;
};

export type ExecutionShortLegEntry = {
  optionType: "call" | "put";
  strike: number;
  sellPrice: number | null;
  source: "actual" | "live-bid" | "unknown";
};

export type ExecutionShortLegQuoteRead = {
  optionType: "call" | "put";
  strike: number;
  bid: number | null;
  ask: number | null;
  mid: number | null;
};

export type ExecutionShortLegRiskRead = ExecutionShortLegEntry & {
  currentAsk: number | null;
  multiple: number | null;
};

export type ExecutionPositionMemory = {
  id: string;
  strategy: ExecutionStrategy;
  label: string;
  setupKey: string;
  legs: ExecutionLeg[];
  openedAt: string;
  entryCredit: number;
  quantity: number;
  maxRiskDollars: number | null;
  entryScore: number;
  entryMapPhase: SessionMapManagerState["phase"];
  entryMapCenter: number;
  entryRailBreached: SessionMapManagerState["railBreached"];
  entryReasons: string[];
  entryTimeRegime: ZeroDteTimeRegimeRead["regime"];
  side: "upper" | "lower" | "center";
  setupSource?: "engine" | "manual";
  engineClearedAtEntry?: boolean;
  overrideReason?: string | null;
  signalTime?: string | null;
  signalCredit?: number | null;
  entryMarkCredit?: number | null;
  entrySellableCredit?: number | null;
  entryShortDeltaAbs?: number | null;
  entryTouchRiskProxyPct?: number | null;
  entryRangeConsumptionPct?: number | null;
  entryEventRisk?: "NORMAL" | "HIGH" | null;
  entryShortLegs?: ExecutionShortLegEntry[];
};

export type ExecutionClosedTrade = ExecutionPositionMemory & {
  closedAt: string;
  exitDebit: number;
  exitScore: number;
  exitReason: string | null;
  emergencyExit: boolean;
  pnlDollars: number;
  durationMinutes: number;
};

export type ZeroDteExecutionMemory = {
  tradeDate: string;
  tradeDayId: string | null;
  samples: ExecutionPremiumSample[];
  positions: ExecutionPositionMemory[];
  /** Backward-compatible primary position. New Layer 6D code should use positions. */
  position: ExecutionPositionMemory | null;
  closedTrades: ExecutionClosedTrade[];
  cooldownUntil: string | null;
};

export type ExecutionScoreComponent = {
  key: string;
  label: string;
  value: number;
  max: number;
  reason: string;
};

export type ZeroDteExecutionRead = {
  tradeDate: string;
  generatedAt: string;
  lifecycle: ExecutionLifecycle;
  strategy: ExecutionStrategy | null;
  strategyLabel: string;
  setupKey: string | null;
  candidate: ExecutionCandidate | null;
  /** Mid package mark used for premium crest analytics. */
  currentCredit: number | null;
  currentSellableCredit: number | null;
  currentBuybackDebit: number | null;
  quoteStatus: "LIVE" | "DEGRADED" | "WAITING_FOR_QUOTES";
  shortLegQuotes: ExecutionShortLegQuoteRead[];
  shortLegRisk: ExecutionShortLegRiskRead[];
  worstShortLegMultiple: number | null;
  shortDeltaAbs: number | null;
  touchRiskProxyPct: number | null;
  remainingMovePoints: number;
  leastResistancePath: ZeroDteLeastResistancePath | null;
  recommendedSizeMultiplier: number;
  volContext: ZeroDteVolContext | null;
  eventRisk: "NORMAL" | "HIGH";
  openingCredit: number | null;
  peakCredit: number | null;
  entryCredit: number | null;
  premiumExpansionPct: number | null;
  premiumFromPeakPct: number | null;
  premiumVelocityPerMinute: number | null;
  capturedPremiumPct: number | null;
  entryScore: number;
  exitScore: number;
  confidence: number;
  maxRiskDollars: number | null;
  livePnlDollars: number | null;
  maxAdverseExcursionDollars: number;
  maxFavorableExcursionDollars: number;
  profitGivebackPct: number | null;
  centerDistance: number;
  edge: "upper" | "lower" | "center";
  peakDetected: boolean;
  premiumCrest: ZeroDtePremiumCrestRead;
  priceRejectionScore: number;
  priceRejectionReady: boolean;
  premiumSampleCount: number;
  premiumTapeStartedAt: string | null;
  emergencyExit: boolean;
  action: string;
  reasons: string[];
  warnings: string[];
  entryReasons: string[];
  exitReasons: string[];
  components: ExecutionScoreComponent[];
  position: ExecutionPositionMemory | null;
  closedTrades: ExecutionClosedTrade[];
  mapPhase: SessionMapManagerState["phase"];
  mapCenter: number;
  railBreached: SessionMapManagerState["railBreached"];
  timeRegime: ZeroDteTimeRegimeRead;
  shortDistancePoints: number | null;
  shortDistanceExpectedMovePct: number | null;
  candidateAgeCandles: number;
  trackedSince: string | null;
  scannerSetupKey: string | null;
  scannerScore: number | null;
  trackingStatus: ExecutionCandidateTracking["status"] | null;
  portfolioContributionScore: number;
  /** Qualified-signal conviction floor after the exhaustion trigger is proven. */
  minimumEntryScore: number;
  /** Higher conviction tier; useful for distinguishing A+ signals without suppressing qualified B/A signals. */
  aPlusEntryScore: number;
  signalGrade: "A+" | "A" | "B" | "WATCH";
  entryScoreGap: number;
  regimeTriggerReady: boolean;
  entryHardBlocked: boolean;
};

export function emptyExecutionMemory(tradeDate: string): ZeroDteExecutionMemory {
  return {
    tradeDate,
    tradeDayId: null,
    samples: [],
    positions: [],
    position: null,
    closedTrades: [],
    cooldownUntil: null,
  };
}

export function buildZeroDteExecutionRead(args: {
  tradeDate: string;
  generatedAt: string;
  recommendation: ZeroDteRecommendation;
  spxRows: ZeroDteChainRow[];
  strikeFlow: ZeroDteStrikeFlowRead | null;
  tradeSelection?: ZeroDteTradeSelection | null;
  mapState: SessionMapManagerState;
  memory: ZeroDteExecutionMemory;
  candidateOverride?: ExecutionCandidate | null;
  positionOverride?: ExecutionPositionMemory | null;
  tracking?: ExecutionCandidateTracking | null;
  portfolio?: ZeroDtePortfolioRead | null;
  priceAction?: ZeroDtePriceActionContext | null;
  premiumTape?: ExecutionPremiumTapePoint[];
  riskPolicy?: ZeroDteRiskPolicy | null;
  volContext?: ZeroDteVolContext | null;
  dailyLossBlocked?: boolean;
  entryBlockers?: string[];
  leaderCandidate?: ExecutionCandidate | null;
  leastResistancePath?: ZeroDteLeastResistancePath | null;
}): ZeroDteExecutionRead {
  const {
    tradeDate,
    generatedAt,
    recommendation,
    spxRows,
    strikeFlow,
    tradeSelection,
    mapState,
    memory,
  } = args;

  const controlling = getControllingMarketMap(mapState);
  const candidate =
    args.candidateOverride === undefined
      ? tradeSelection
        ? buildExecutionCandidate(tradeSelection, mapState)
        : null
      : args.candidateOverride;
  const positions = memory.positions ?? (memory.position ? [memory.position] : []);
  const position =
    args.positionOverride === undefined ? memory.position : args.positionOverride;
  const hasEnteredToday = positions.length > 0 || memory.closedTrades.length > 0;
  const timeRegime = classifyZeroDteTimeRegime({
    generatedAt,
    hasEnteredToday,
  });
  const strategy = position?.strategy ?? candidate?.strategy ?? null;
  const setupKey = position?.setupKey ?? candidate?.setupKey ?? null;
  const legs = position?.legs ?? candidate?.legs ?? [];
  const packageQuote = legs.length
    ? calculateStrategyPackageQuote(spxRows, legs)
    : null;
  const currentCredit = packageQuote?.markCredit ?? null;
  const currentSellableCredit = packageQuote?.sellableCredit ?? null;
  const currentBuybackDebit = packageQuote?.buybackDebit ?? null;
  const shortLegQuotes = buildShortLegQuoteReads(spxRows, legs);
  const quoteStatus = strategyQuoteStatus(spxRows, legs);
  const shortLegRisk = buildShortLegRiskReads(position, shortLegQuotes);
  const worstShortLegMultiple = shortLegRisk.reduce<number | null>(
    (worst, leg) =>
      leg.multiple === null
        ? worst
        : worst === null
          ? leg.multiple
          : Math.max(worst, leg.multiple),
    null,
  );
  const shortDeltaAbs =
    strategy === "put-credit-spread" || strategy === "call-credit-spread"
      ? findShortDeltaAbs(spxRows, legs)
      : null;
  const touchRiskProxyPct =
    shortDeltaAbs !== null ? Math.min(100, shortDeltaAbs * 200) : null;
  const remainingMove = buildZeroDteRemainingMove({
    generatedAt,
    spot: recommendation.spxPrice,
    liveExpectedMove: recommendation.expectedMove,
    strikeStep: 5,
  });
  const leastResistancePath = args.leastResistancePath ?? null;

  const premiumWindowStart = position?.openedAt ?? args.tracking?.lockedAt ?? null;
  const premiumWindowStartMs = premiumWindowStart
    ? Date.parse(premiumWindowStart)
    : null;
  const relevantSamples = setupKey
    ? mergePremiumSeries(
        memory.samples.filter((sample) => sample.setupKey === setupKey),
        (args.premiumTape ?? []).filter((sample) => sample.setupKey === setupKey),
      ).filter((sample) =>
        premiumWindowStartMs === null || !Number.isFinite(premiumWindowStartMs)
          ? true
          : Date.parse(sample.timestamp) >= premiumWindowStartMs,
      )
    : [];
  const openingCredit = relevantSamples[0]?.credit ?? currentCredit;
  const sessionPeakCredit = relevantSamples.length
    ? Math.max(...relevantSamples.map((sample) => sample.credit), currentCredit ?? 0)
    : currentCredit;
  const premiumCrest = buildPremiumCrestRead({
    samples: relevantSamples,
    generatedAt,
    currentCredit,
  });
  const currentTimestamp = Date.parse(generatedAt);
  const previousSample =
    [...relevantSamples]
      .reverse()
      .find((sample) => Date.parse(sample.timestamp) < currentTimestamp) ?? null;
  const elapsedMinutes = previousSample
    ? (currentTimestamp - Date.parse(previousSample.timestamp)) / 60_000
    : null;
  const rawPremiumVelocityPerMinute =
    currentCredit !== null &&
    previousSample &&
    elapsedMinutes !== null &&
    elapsedMinutes > 0
      ? (currentCredit - previousSample.credit) / elapsedMinutes
      : null;
  const premiumVelocityPerMinute =
    premiumCrest.threeMinuteSlope ?? rawPremiumVelocityPerMinute;
  const premiumExpansionPct =
    currentCredit !== null && openingCredit && openingCredit > 0
      ? ((currentCredit - openingCredit) / openingCredit) * 100
      : null;
  const peakCredit = premiumCrest.localPeakCredit ?? sessionPeakCredit;
  const premiumFromPeakPct =
    currentCredit !== null && peakCredit && peakCredit > 0
      ? ((currentCredit - peakCredit) / peakCredit) * 100
      : null;
  const peakDetected = premiumCrest.rolloverConfirmed;

  const shortDistance = position
    ? strategyShortDistance(
        position.strategy,
        position.legs,
        recommendation.spxPrice,
        remainingMove.expectedMoveRemaining,
      )
    : candidateShortDistance(
        candidate,
        recommendation.spxPrice,
        remainingMove.expectedMoveRemaining,
      );
  const portfolioContribution = candidate?.strategy
    ? args.portfolio?.candidateContribution[candidate.strategy] ?? null
    : null;
  const centerDistance = Math.abs(recommendation.spxPrice - controlling.center);
  const edge = classifyEdge(
    recommendation.spxPrice,
    controlling.center,
    controlling.lowerWing,
    controlling.upperWing,
  );

  const entryRead = buildEntryRead({
    candidate,
    mapState,
    currentCredit,
    currentSellableCredit,
    premiumExpansionPct,
    premiumCrest,
    strikeFlow,
    recommendation,
    timeRegime,
    priceAction: args.priceAction ?? null,
    shortDistance,
    portfolioContribution,
    tracking: args.tracking ?? null,
    riskPolicy: args.riskPolicy ?? null,
    volContext: args.volContext ?? null,
    dailyLossBlocked: Boolean(args.dailyLossBlocked),
    externalBlockers: args.entryBlockers ?? [],
    shortDeltaAbs,
    expectedMoveRemaining: remainingMove.expectedMoveRemaining,
  });

  const managementDebitForPnl = position ? currentBuybackDebit ?? currentCredit : null;
  const livePnlDollars =
    position && managementDebitForPnl !== null
      ? (position.entryCredit - managementDebitForPnl) * 100 * position.quantity
      : null;
  const pnlHistory = position
    ? memory.samples
        .filter(
          (sample) =>
            sample.setupKey === position.setupKey &&
            Date.parse(sample.timestamp) >= Date.parse(position.openedAt) &&
            sample.buybackDebit !== null &&
            sample.buybackDebit !== undefined,
        )
        .map(
          (sample) =>
            (position.entryCredit - Number(sample.buybackDebit)) *
            100 *
            position.quantity,
        )
        .filter(Number.isFinite)
    : [];
  if (livePnlDollars !== null && Number.isFinite(livePnlDollars)) {
    pnlHistory.push(livePnlDollars);
  }
  const maxFavorableExcursionDollars = pnlHistory.length
    ? Math.max(0, ...pnlHistory)
    : 0;
  const maxAdverseExcursionDollars = pnlHistory.length
    ? Math.max(0, ...pnlHistory.map((value) => -value))
    : 0;
  const profitGivebackPct =
    livePnlDollars !== null && maxFavorableExcursionDollars > 0
      ? Math.max(
          0,
          ((maxFavorableExcursionDollars - livePnlDollars) /
            maxFavorableExcursionDollars) *
            100,
        )
      : null;

  const exitRead = buildExitRead({
    position,
    candidate,
    mapState,
    currentCredit,
    currentBuybackDebit,
    premiumVelocityPerMinute,
    peakDetected,
    recommendation,
    strikeFlow,
    generatedAt,
    timeRegime,
    leaderCandidate: args.leaderCandidate ?? candidate,
    memory,
    leastResistancePath,
    expectedMoveRemaining: remainingMove.expectedMoveRemaining,
    shortLegRisk,
    livePnlDollars,
    maxFavorableExcursionDollars,
    maxAdverseExcursionDollars,
    profitGivebackPct,
  });

  const cooldownActive = Boolean(
    memory.cooldownUntil &&
      Date.parse(memory.cooldownUntil) > Date.parse(generatedAt),
  );
  const lastClosed = memory.closedTrades[0] ?? null;
  const justExited = Boolean(
    lastClosed &&
      Date.parse(generatedAt) - Date.parse(lastClosed.closedAt) <= 90_000,
  );

  let lifecycle: ExecutionLifecycle = "WAIT";
  let action = "WAIT — no map-aligned strategy has cleared the execution gate.";

  if (position) {
    const ageMinutes = Math.max(
      0,
      (Date.parse(generatedAt) - Date.parse(position.openedAt)) / 60_000,
    );
    if (exitRead.emergencyExit || exitRead.exitScore >= 80) {
      lifecycle = "BUYBACK_READY";
      action = exitRead.emergencyExit
        ? "BUYBACK NOW — a short leg has reached the deterministic 3× entry-premium stop."
        : "BUYBACK READY — take-profit / peak-profit protection has cleared the exit gate.";
    } else if (quoteStatus !== "LIVE") {
      lifecycle = ageMinutes <= 1.5 ? "POSITION_OPEN" : "HOLD";
      action =
        quoteStatus === "WAITING_FOR_QUOTES"
          ? "TRACKING — position is recorded; waiting for exact live leg quotes before package P/L / buyback management is available."
          : "TRACKING — live position remains recorded, but one or more leg quotes are incomplete; management is using only the quote components that remain valid.";
    } else if (ageMinutes <= 1.5) {
      lifecycle = "POSITION_OPEN";
      action = "POSITION OPEN — confirm the fill, map state, and live debit before managing.";
    } else {
      lifecycle = "HOLD";
      action = "HOLD — the position remains valid and the buyback threshold has not been reached.";
    }
  } else if (justExited) {
    lifecycle = "EXITED";
    action = "EXITED — trade memory was closed successfully.";
  } else if (cooldownActive) {
    lifecycle = "COOLDOWN";
    action = "COOLDOWN — require a fresh structure and premium setup before another entry.";
  } else if (entryRead.sellReady) {
    lifecycle = "SELL_READY";
    action = `SELL READY [${entryRead.signalGrade}] — ${candidate?.label ?? "strategy"} has cleared hard safety, premium exhaustion, completed price rejection, and the qualified-signal conviction floor.`;
  } else if (entryRead.armed) {
    lifecycle = "ARMED";
    action = premiumCrest.rolloverConfirmed
      ? entryRead.priceRejectionReady
        ? `ARMED — ${candidate?.label ?? "strategy"} crest and price rejection are confirmed; conviction is ${entryRead.entryScore}/${entryRead.minimumEntryScore} signal floor (${entryRead.aPlusEntryScore} A+).`
        : `ARMED — ${candidate?.label ?? "strategy"} crest is confirmed; strategy-specific price rejection is still building.`
      : premiumCrest.rolloverStarted
        ? `ARMED — ${candidate?.label ?? "strategy"} has begun a closed-minute premium rollover; waiting for confirmation.`
        : `ARMED — ${candidate?.label ?? "strategy"} premium has expanded into the local crest zone; wait for confirmed rollover.`;
  } else if (candidate && premiumCrest.missed) {
    action = `WAIT — the ${candidate.label} crest was missed. Do not chase lower premium; wait for a fresh expansion cycle.`;
  } else if (candidate && !entryRead.hardBlocked) {
    action = `WAIT — ${candidate.label} is being tracked, but ${premiumCrest.status.replaceAll("_", " ").toLowerCase()} has not completed the execution trigger.`;
  }

  const entryCredit = position?.entryCredit ?? null;
  const managementDebit = position ? currentBuybackDebit ?? currentCredit : currentCredit;
  const capturedPremiumPct =
    position && managementDebit !== null && position.entryCredit > 0
      ? ((position.entryCredit - managementDebit) / position.entryCredit) * 100
      : null;
  const maxRiskDollars =
    position?.maxRiskDollars ?? candidate?.maxRiskDollars ?? null;
  const entryScore = position?.entryScore ?? entryRead.entryScore;
  const exitScore = position ? exitRead.exitScore : 0;
  const confidence = position ? exitScore : entryScore;

  const reasons = unique(
    position
      ? [...exitRead.reasons, ...entryRead.reasons]
      : entryRead.reasons,
  ).slice(0, 10);
  const positionQuoteWarnings = position
    ? [
        ...(quoteStatus === "WAITING_FOR_QUOTES"
          ? ["Exact live quotes are not available for all position legs. The position remains tracked; package P/L and debit-based exits wait for valid quotes."]
          : quoteStatus === "DEGRADED"
            ? ["One or more position leg quotes are incomplete. The position remains tracked and will resume full package management when exact bid/ask quotes recover."]
            : []),
        ...(shortLegRisk.some((leg) => leg.sellPrice === null)
          ? ["At least one short leg has no stored entry sale premium, so its 3× stop cannot arm until a valid baseline is supplied on a new position / backfill."]
          : []),
      ]
    : [];
  const warnings = unique(
    position
      ? [...exitRead.warnings, ...positionQuoteWarnings, ...entryRead.blockers]
      : entryRead.blockers,
  ).slice(0, 10);

  const components: ExecutionScoreComponent[] = position
    ? exitRead.components
    : candidate
      ? entryRead.components
      : [];

  return {
    tradeDate,
    generatedAt,
    lifecycle,
    strategy,
    strategyLabel: position?.label ?? candidate?.label ?? "No Trade",
    setupKey,
    candidate,
    currentCredit,
    currentSellableCredit,
    currentBuybackDebit,
    quoteStatus,
    shortLegQuotes,
    shortLegRisk,
    worstShortLegMultiple,
    shortDeltaAbs,
    touchRiskProxyPct,
    remainingMovePoints: remainingMove.expectedMoveRemaining,
    leastResistancePath,
    recommendedSizeMultiplier:
      timeRegime.sizeMultiplier *
      (args.riskPolicy ? eventRiskSizeMultiplier(args.riskPolicy) : 1) *
      volContextSizeMultiplier(args.volContext ?? null),
    volContext: args.volContext ?? null,
    eventRisk: args.riskPolicy?.eventRisk ?? "NORMAL",
    openingCredit,
    peakCredit,
    entryCredit,
    premiumExpansionPct,
    premiumFromPeakPct,
    premiumVelocityPerMinute,
    capturedPremiumPct,
    entryScore,
    exitScore,
    confidence,
    maxRiskDollars,
    livePnlDollars,
    maxAdverseExcursionDollars,
    maxFavorableExcursionDollars,
    profitGivebackPct,
    centerDistance,
    edge,
    peakDetected,
    premiumCrest,
    priceRejectionScore: entryRead.priceRejectionScore,
    priceRejectionReady: entryRead.priceRejectionReady,
    premiumSampleCount: relevantSamples.length,
    premiumTapeStartedAt: relevantSamples[0]?.timestamp ?? null,
    emergencyExit: exitRead.emergencyExit,
    action,
    reasons,
    warnings,
    entryReasons: entryRead.reasons,
    exitReasons: exitRead.reasons,
    components,
    position,
    closedTrades: memory.closedTrades,
    mapPhase: mapState.phase,
    mapCenter: controlling.center,
    railBreached: mapState.railBreached,
    timeRegime,
    shortDistancePoints: shortDistance.points,
    shortDistanceExpectedMovePct: shortDistance.expectedMovePct,
    candidateAgeCandles: args.tracking?.ageCandles ?? 0,
    trackedSince: args.tracking?.lockedAt ?? null,
    scannerSetupKey: args.tracking?.scannerCandidate?.setupKey ?? null,
    scannerScore: args.tracking?.scannerCandidate?.score ?? null,
    trackingStatus: args.tracking?.status ?? null,
    portfolioContributionScore: portfolioContribution?.score ?? 70,
    minimumEntryScore: entryRead.minimumEntryScore,
    aPlusEntryScore: entryRead.aPlusEntryScore,
    signalGrade: entryRead.signalGrade,
    entryScoreGap: Math.max(0, Math.round(entryRead.minimumEntryScore - entryRead.entryScore)),
    regimeTriggerReady: entryRead.regimeTriggerReady,
    entryHardBlocked: entryRead.hardBlocked,
  };
}

export function sampleFromRead(
  read: ZeroDteExecutionRead,
  spot: number,
): ExecutionPremiumSample | null {
  if (
    !read.strategy ||
    !read.setupKey ||
    read.currentCredit === null ||
    !Number.isFinite(read.currentCredit)
  ) {
    return null;
  }

  return {
    timestamp: read.generatedAt,
    spot,
    strategy: read.strategy,
    setupKey: read.setupKey,
    credit: read.currentCredit,
    sellableCredit: read.currentSellableCredit,
    buybackDebit: read.currentBuybackDebit,
    entryScore: read.entryScore,
    exitScore: read.exitScore,
    mapPhase: read.mapPhase,
    mapCenter: read.mapCenter,
    railBreached: read.railBreached,
    lifecycle: read.lifecycle,
    timeRegime: read.timeRegime.regime,
    shortDistancePoints: read.shortDistancePoints,
    shortDistanceExpectedMovePct: read.shortDistanceExpectedMovePct,
    candidateAgeCandles: read.candidateAgeCandles,
    trackedSince: read.trackedSince,
  };
}

export function buildExecutionCandidate(
  selection: ZeroDteTradeSelection,
  mapState: SessionMapManagerState,
  strategyOverride?: ExecutionStrategy | null,
): ExecutionCandidate | null {
  const strategy =
    strategyOverride ?? normalizeExecutionStrategy(selection.tradeType);
  if (!strategy) return null;

  const ranking = findRanking(selection.strategyRankings, strategy);
  const controlling = getControllingMarketMap(mapState);
  let legs: ExecutionLeg[] = [];
  let estimatedCredit: number | null = ranking?.estimatedCredit ?? null;
  let sellableCredit: number | null = null;
  let buybackDebit: number | null = null;
  let shortDeltaAbs: number | null = null;
  let spreadMode: "trend" | "exhaustion-fade" | null = null;
  let maxRiskDollars: number | null = ranking?.maxRiskDollars ?? null;

  if (strategy === "iron-fly") {
    // The IF is the opening thesis. Its exact center and wings stay fixed for
    // the trade date even if the active directional map later migrates.
    const ironFly = {
      center: mapState.opening.center,
      lowerWing: mapState.opening.lowerWing,
      upperWing: mapState.opening.upperWing,
      wingWidth: Math.abs(
        mapState.opening.upperWing - mapState.opening.center,
      ),
    };

    if (ironFly) {
      legs = [
        { optionType: "put", action: "buy", strike: ironFly.lowerWing },
        { optionType: "put", action: "sell", strike: ironFly.center },
        { optionType: "call", action: "sell", strike: ironFly.center },
        { optionType: "call", action: "buy", strike: ironFly.upperWing },
      ];
      if (maxRiskDollars === null && estimatedCredit !== null) {
        maxRiskDollars = Math.max(
          0,
          Math.max(
            ironFly.center - ironFly.lowerWing,
            ironFly.upperWing - ironFly.center,
          ) *
            100 -
            estimatedCredit * 100,
        );
      }
    }
  }

  if (strategy === "put-credit-spread") {
    const spread = selection.creditSpreadBook.put;
    if (spread.shortStrike !== null && spread.longStrike !== null) {
      legs = [
        { optionType: "put", action: "sell", strike: spread.shortStrike },
        { optionType: "put", action: "buy", strike: spread.longStrike },
      ];
      estimatedCredit ??= spread.estimatedCredit;
      sellableCredit = spread.sellableCredit;
      buybackDebit = spread.buybackDebit;
      shortDeltaAbs = spread.shortDeltaAbs;
      spreadMode =
        spread.candidates.find(
          (row) =>
            row.strike === spread.shortStrike &&
            row.longStrike === spread.longStrike,
        )?.thesis ?? spread.thesis ?? "trend";
      maxRiskDollars ??= spread.maxLossDollars;
    }
  }

  if (strategy === "call-credit-spread") {
    const spread = selection.creditSpreadBook.call;
    if (spread.shortStrike !== null && spread.longStrike !== null) {
      legs = [
        { optionType: "call", action: "sell", strike: spread.shortStrike },
        { optionType: "call", action: "buy", strike: spread.longStrike },
      ];
      estimatedCredit ??= spread.estimatedCredit;
      sellableCredit = spread.sellableCredit;
      buybackDebit = spread.buybackDebit;
      shortDeltaAbs = spread.shortDeltaAbs;
      spreadMode =
        spread.candidates.find(
          (row) =>
            row.strike === spread.shortStrike &&
            row.longStrike === spread.longStrike,
        )?.thesis ?? spread.thesis ?? "trend";
      maxRiskDollars ??= spread.maxLossDollars;
    }
  }

  if (!legs.length) return null;

  const blockers = unique(ranking?.blockers ?? []);
  const reasons = unique([
    ...(ranking?.reasons ?? []),
    ...selection.reasons,
  ]).slice(0, 10);

  return {
    strategy,
    label: ranking?.label ?? selection.label,
    setupKey: makeExecutionSetupKey(strategy, legs),
    score: ranking?.score ?? selection.confidence,
    eligible: ranking?.eligible ?? selection.tradeType !== "no-trade",
    legs,
    estimatedCredit,
    sellableCredit,
    buybackDebit,
    shortDeltaAbs,
    spreadMode,
    maxRiskDollars,
    mapPhase: mapState.phase,
    mapCenter: strategy === "iron-fly" ? mapState.opening.center : controlling.center,
    railBreached: mapState.railBreached,
    reasons,
    blockers,
  };
}

export function buildExecutionCandidateBooks(
  selection: ZeroDteTradeSelection,
  mapState: SessionMapManagerState,
): ExecutionCandidateBook {
  const ironFly = buildExecutionCandidate(selection, mapState, "iron-fly");

  return {
    "iron-fly": ironFly ? [ironFly] : [],
    "put-credit-spread": buildSpreadExecutionCandidateBook(
      selection,
      mapState,
      "put-credit-spread",
    ),
    "call-credit-spread": buildSpreadExecutionCandidateBook(
      selection,
      mapState,
      "call-credit-spread",
    ),
  };
}

function buildSpreadExecutionCandidateBook(
  selection: ZeroDteTradeSelection,
  mapState: SessionMapManagerState,
  strategy: Extract<
    ExecutionStrategy,
    "put-credit-spread" | "call-credit-spread"
  >,
): ExecutionCandidate[] {
  const side = strategy === "put-credit-spread" ? "put" : "call";
  const spread =
    side === "put"
      ? selection.creditSpreadBook.put
      : selection.creditSpreadBook.call;
  const ranking = findRanking(selection.strategyRankings, strategy);
  const controlling = getControllingMarketMap(mapState);
  const wall = side === "put" ? controlling.putWall : controlling.callWall;
  const topRawScore = spread.candidates[0]?.score ?? spread.score;
  const sideBlockers = (ranking?.blockers ?? []).filter(
    (blocker) =>
      !blocker.includes("No executable live spread candidate") &&
      !blocker.includes("short strike sits inside the controlling wall"),
  );
  const candidateRows = spread.candidates.length
    ? spread.candidates
    : spread.shortStrike !== null &&
        spread.longStrike !== null &&
        spread.estimatedCredit !== null &&
        spread.maxLossDollars !== null
      ? [
          {
            thesis: spread.thesis ?? ("trend" as const),
            strike: spread.shortStrike,
            longStrike: spread.longStrike,
            score: spread.score,
            confidence: spread.confidence,
            estimatedCredit: spread.estimatedCredit,
            sellableCredit: spread.sellableCredit ?? spread.estimatedCredit,
            buybackDebit: spread.buybackDebit ?? spread.estimatedCredit,
            shortDeltaAbs: spread.shortDeltaAbs,
            maxLossDollars: spread.maxLossDollars,
            reasons: spread.reasons,
            warnings: spread.warnings,
          },
        ]
      : [];

  return candidateRows.slice(0, 12).map((row) => {
    const legs: ExecutionLeg[] = [
      {
        optionType: side,
        action: "sell",
        strike: row.strike,
      },
      {
        optionType: side,
        action: "buy",
        strike: row.longStrike,
      },
    ];
    const blockers = [...sideBlockers];
    const shortInsideWall =
      wall !== null &&
      (side === "put" ? row.strike > wall : row.strike < wall);
    if (shortInsideWall) {
      blockers.push("The short strike sits inside the controlling wall.");
    }

    const score = clamp(
      (ranking?.score ?? row.confidence) + (row.score - topRawScore) * 0.65,
    );
    const eligible =
      Number.isFinite(row.estimatedCredit) &&
      row.estimatedCredit > 0 &&
      !shortInsideWall &&
      blockers.length === 0 &&
      score >= 35;

    return {
      strategy,
      label:
        side === "put"
          ? `Put Credit ${row.strike.toFixed(0)} / ${row.longStrike.toFixed(0)}`
          : `Call Credit ${row.strike.toFixed(0)} / ${row.longStrike.toFixed(0)}`,
      setupKey: makeExecutionSetupKey(strategy, legs),
      score: Math.round(score),
      eligible,
      legs,
      estimatedCredit: row.estimatedCredit,
      sellableCredit: row.sellableCredit,
      buybackDebit: row.buybackDebit,
      shortDeltaAbs: row.shortDeltaAbs,
      spreadMode: row.thesis ?? "trend",
      maxRiskDollars: row.maxLossDollars,
      mapPhase: mapState.phase,
      mapCenter: controlling.center,
      railBreached: mapState.railBreached,
      reasons: unique([
        ...(row.reasons ?? []),
        ...(ranking?.reasons ?? []),
      ]).slice(0, 10),
      blockers: unique(blockers),
    };
  });
}

export function repriceExecutionCandidate(
  candidate: ExecutionCandidate,
  rows: ZeroDteChainRow[],
): ExecutionCandidate {
  const quote = calculateStrategyPackageQuote(rows, candidate.legs);
  if (!quote || quote.markCredit === null) return candidate;
  const riskCredit = quote.sellableCredit ?? quote.markCredit;

  return {
    ...candidate,
    estimatedCredit: quote.markCredit,
    sellableCredit: quote.sellableCredit,
    buybackDebit: quote.buybackDebit,
    shortDeltaAbs:
      candidate.strategy === "put-credit-spread" ||
      candidate.strategy === "call-credit-spread"
        ? findShortDeltaAbs(rows, candidate.legs)
        : null,
    maxRiskDollars: calculateDefinedRiskDollars(
      candidate.strategy,
      candidate.legs,
      riskCredit,
    ),
  };
}

function calculateDefinedRiskDollars(
  strategy: ExecutionStrategy,
  legs: ExecutionLeg[],
  credit: number,
) {
  if (strategy === "iron-fly") {
    const center = legs.find((leg) => leg.action === "sell")?.strike ?? null;
    const longPut = legs.find(
      (leg) => leg.action === "buy" && leg.optionType === "put",
    )?.strike ?? null;
    const longCall = legs.find(
      (leg) => leg.action === "buy" && leg.optionType === "call",
    )?.strike ?? null;
    if (center === null || longPut === null || longCall === null) return null;
    const width = Math.max(center - longPut, longCall - center);
    return Math.max(0, width - credit) * 100;
  }

  const shortStrike = legs.find((leg) => leg.action === "sell")?.strike ?? null;
  const longStrike = legs.find((leg) => leg.action === "buy")?.strike ?? null;
  if (shortStrike === null || longStrike === null) return null;
  return Math.max(0, Math.abs(shortStrike - longStrike) - credit) * 100;
}

export type StrategyPackageQuote = {
  markCredit: number | null;
  sellableCredit: number | null;
  buybackDebit: number | null;
};

export function calculateStrategyPackageQuote(
  rows: ZeroDteChainRow[],
  legs: ExecutionLeg[],
): StrategyPackageQuote | null {
  if (!legs.length) return null;

  let markCredit = 0;
  let sellableCredit = 0;
  let buybackDebit = 0;

  for (const leg of legs) {
    const quote = optionQuote(rows, leg.strike, leg.optionType);
    if (!quote || quote.mid === null) return null;
    markCredit += leg.action === "sell" ? quote.mid : -quote.mid;

    // A 0DTE mark is considered current only when both sides of every leg have
    // a live market. Never let a mark/last-only row create a premium-tape spike.
    if (quote.bid === null || quote.ask === null) return null;
    sellableCredit += leg.action === "sell" ? quote.bid : -quote.ask;
    // Closing reverses every leg: buy shorts at ask, sell longs at bid.
    buybackDebit += leg.action === "sell" ? quote.ask : -quote.bid;
  }

  return {
    markCredit: Number.isFinite(markCredit) && markCredit >= 0 ? roundCredit(markCredit) : null,
    sellableCredit:
      Number.isFinite(sellableCredit) && sellableCredit >= 0
        ? roundCredit(sellableCredit)
        : null,
    buybackDebit:
      Number.isFinite(buybackDebit) && buybackDebit >= 0
        ? roundCredit(buybackDebit)
        : null,
  };
}

export function calculateStrategyCredit(
  rows: ZeroDteChainRow[],
  legs: ExecutionLeg[],
): number | null {
  return calculateStrategyPackageQuote(rows, legs)?.markCredit ?? null;
}

function mergePremiumSeries(
  persisted: Array<Pick<ExecutionPremiumSample, "timestamp" | "credit">>,
  live: ExecutionPremiumTapePoint[],
) {
  const byTimestamp = new Map<string, { timestamp: string; credit: number }>();
  for (const sample of persisted) {
    if (!Number.isFinite(sample.credit)) continue;
    byTimestamp.set(sample.timestamp, {
      timestamp: sample.timestamp,
      credit: sample.credit,
    });
  }
  for (const sample of live) {
    if (!Number.isFinite(sample.credit)) continue;
    byTimestamp.set(sample.timestamp, {
      timestamp: sample.timestamp,
      credit: sample.credit,
    });
  }
  return [...byTimestamp.values()].sort(
    (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp),
  );
}

function buildEntryRead(args: {
  candidate: ExecutionCandidate | null;
  mapState: SessionMapManagerState;
  currentCredit: number | null;
  currentSellableCredit: number | null;
  premiumExpansionPct: number | null;
  premiumCrest: ZeroDtePremiumCrestRead;
  strikeFlow: ZeroDteStrikeFlowRead | null;
  recommendation: ZeroDteRecommendation;
  timeRegime: ZeroDteTimeRegimeRead;
  priceAction: ZeroDtePriceActionContext | null;
  shortDistance: { points: number | null; expectedMovePct: number | null };
  portfolioContribution: CandidatePortfolioContribution | null;
  tracking: ExecutionCandidateTracking | null;
  riskPolicy: ZeroDteRiskPolicy | null;
  volContext: ZeroDteVolContext | null;
  dailyLossBlocked: boolean;
  externalBlockers: string[];
  shortDeltaAbs: number | null;
  expectedMoveRemaining: number;
}) {
  const {
    candidate,
    mapState,
    currentCredit,
    currentSellableCredit,
    premiumExpansionPct,
    premiumCrest,
    strikeFlow,
    recommendation,
    timeRegime,
    priceAction,
    shortDistance,
    portfolioContribution,
    tracking,
    riskPolicy,
    volContext,
    dailyLossBlocked,
    externalBlockers,
    shortDeltaAbs,
    expectedMoveRemaining,
  } = args;
  // Candidate discovery blockers are snapshots from the scanner. Once an exact
  // setup is locked, live execution gates below become authoritative so stale
  // scanner blockers cannot permanently suppress a later valid signal.
  const blockers: string[] = [...externalBlockers];
  const reasons = [...(candidate?.reasons ?? []), ...timeRegime.reasons];

  const controllingForEntry = getControllingMarketMap(mapState);
  const openingHalfWidth = Math.max(
    1,
    Math.abs(mapState.opening.upperWing - mapState.opening.center),
  );
  const centerDisplacement =
    recommendation.spxPrice - mapState.opening.center;
  const centerStretchRatio =
    Math.abs(centerDisplacement) / openingHalfWidth;
  const ironFlyFadeCandidate =
    candidate?.strategy === "iron-fly" && centerStretchRatio >= 0.45;
  const putFadeCandidate =
    candidate?.strategy === "put-credit-spread" &&
    candidate.spreadMode === "exhaustion-fade" &&
    recommendation.spxPrice < controllingForEntry.center;
  const callFadeCandidate =
    candidate?.strategy === "call-credit-spread" &&
    candidate.spreadMode === "exhaustion-fade" &&
    recommendation.spxPrice > controllingForEntry.center;
  const exhaustionFadeCandidate =
    ironFlyFadeCandidate || putFadeCandidate || callFadeCandidate;

  if (!candidate) blockers.push("No tracked strategy candidate is available.");
  if (candidate && currentCredit === null) blockers.push("Live bid/ask markets cannot price every strategy leg.");
  if (candidate && riskPolicy) {
    if (
      currentSellableCredit === null ||
      currentSellableCredit < riskPolicy.minSellableCredit
    ) {
      blockers.push(
        `Conservative sellable credit is below the $${riskPolicy.minSellableCredit.toFixed(2)} risk-policy floor.`,
      );
    }
    if (
      riskPolicy.maxRiskPerTradeDollars !== null &&
      (candidate.maxRiskDollars === null ||
        candidate.maxRiskDollars > riskPolicy.maxRiskPerTradeDollars)
    ) {
      blockers.push(
        `Defined risk per 1× exceeds the $${Math.round(riskPolicy.maxRiskPerTradeDollars).toLocaleString()} risk-policy limit.`,
      );
    }
  }
  if (
    candidate &&
    getControllingMarketMap(mapState).structure.structuralConfidence < 30
  ) {
    blockers.push("Current controlling structure confidence is below 30%.");
  }
  if (!timeRegime.entryAllowed) blockers.push(`${timeRegime.label} does not permit new risk.`);
  if (dailyLossBlocked) blockers.push("Daily loss circuit breaker is active using realized plus executable open P&L; no new positions are permitted.");
  if (tracking?.status === "STRUCTURE_INVALID") {
    blockers.push(tracking.lastReplacementReason ?? "The tracked candidate is structurally invalid.");
  }

  if (candidate?.strategy === "iron-fly") {
    if (mapState.phase === "TRANSITION") {
      blockers.push("Iron Fly fade is blocked during map transition because the old center is being replaced.");
    }
    if (mapState.phase === "ACTIVE") {
      blockers.push(
        "No new Iron Fly may be opened from the original center after the Opening Map has been formally replaced.",
      );
    }
    if (!isOpeningMapCaptureOnTime(mapState.opening.capturedAt)) {
      blockers.push("Iron Fly is disabled because the Opening Map was captured after the valid opening window.");
    }
    if (!ironFlyFadeCandidate && timeRegime.regime !== "OPENING_OPPORTUNITY") {
      blockers.push(
        "A near-center Iron Fly remains opening-only; later IF entries require a true displacement/exhaustion setup.",
      );
    }
    if (ironFlyFadeCandidate && mapState.railBreached !== "NONE") {
      reasons.push(
        "Rail breach is extension evidence for this IF fade; it is not an entry waiver—premium rollover and price rejection remain mandatory.",
      );
    }
  }

  if (candidate?.strategy === "put-credit-spread") {
    if (mapState.phase === "TRANSITION" && mapState.railBreached !== "UPPER") {
      blockers.push("Put spread requires confirmed upward migration during transition.");
    }
    if (strikeFlow?.putWall.state === "breaking") {
      blockers.push("Put wall is breaking; bullish premium selling is blocked.");
    }
    if (recommendation.dealerPressure <= -35 && !putFadeCandidate) {
      blockers.push("Dealer pressure is too bearish for a trend-aligned put credit spread.");
    } else if (recommendation.dealerPressure <= -35 && putFadeCandidate) {
      reasons.push(
        "Bearish dealer pressure is treated as downside premium inflation for this put-fade candidate; crest confirmation must prove exhaustion.",
      );
    }
  }

  if (candidate?.strategy === "call-credit-spread") {
    if (mapState.phase === "TRANSITION" && mapState.railBreached !== "LOWER") {
      blockers.push("Call spread requires confirmed downward migration during transition.");
    }
    if (strikeFlow?.callWall.state === "attacked") {
      blockers.push("Call wall is being attacked; bearish premium selling is blocked.");
    }
    if (recommendation.dealerPressure >= 35 && !callFadeCandidate) {
      blockers.push("Dealer pressure is too bullish for a trend-aligned call credit spread.");
    } else if (recommendation.dealerPressure >= 35 && callFadeCandidate) {
      reasons.push(
        "Bullish dealer pressure is treated as upside premium inflation for this call-fade candidate; crest confirmation must prove exhaustion.",
      );
    }
  }

  if (candidate) {
    const controlling = getControllingMarketMap(mapState);
    const shortStrike = candidate.legs.find((leg) => leg.action === "sell")?.strike ?? null;
    if (candidate.strategy === "put-credit-spread" && shortStrike !== null) {
      if (controlling.putWall !== null && shortStrike > controlling.putWall) {
        blockers.push("The tracked put short is inside the current controlling put wall.");
      }
    }
    if (candidate.strategy === "call-credit-spread" && shortStrike !== null) {
      if (controlling.callWall !== null && shortStrike < controlling.callWall) {
        blockers.push("The tracked call short is inside the current controlling call wall.");
      }
    }
  }

  if (portfolioContribution?.blockers.length) {
    blockers.push(...portfolioContribution.blockers);
  }

  const isCreditSpread =
    candidate?.strategy === "put-credit-spread" ||
    candidate?.strategy === "call-credit-spread";
  if (isCreditSpread) {
    const riskModeExpectedMoveFloor = riskPolicy
      ? minimumDistanceExpectedMovePctForRiskMode(riskPolicy.riskMode)
      : 0;
    const effectiveExpectedMoveFloor = Math.max(
      timeRegime.minimumDistanceExpectedMovePct,
      riskModeExpectedMoveFloor,
    );
    const deltaLimit = riskPolicy?.shortDeltaMax ?? 0.20;
    const absoluteFloor = riskPolicy
      ? absoluteDistanceFloorPoints(riskPolicy, recommendation.spxPrice)
      : Math.max(15, recommendation.spxPrice * 0.0022);

    if (!(expectedMoveRemaining > 0) || shortDistance.expectedMovePct === null) {
      blockers.push("Remaining expected move is unavailable; short-strike geometry cannot be verified.");
    } else if (
      shortDistance.expectedMovePct < effectiveExpectedMoveFloor &&
      !exhaustionFadeCandidate
    ) {
      blockers.push(
        `Short-strike distance is below the ${Math.round(
          effectiveExpectedMoveFloor * 100,
        )}% expected-move floor required by the trend-aligned mode.`,
      );
    }

    if (
      (shortDistance.points === null || shortDistance.points < absoluteFloor) &&
      !exhaustionFadeCandidate
    ) {
      blockers.push(`Short strike is inside the absolute ${absoluteFloor.toFixed(1)}-point trend-mode safety floor.`);
    }

    if (shortDeltaAbs === null) {
      blockers.push("Short-option delta is unavailable; quote/Greek integrity cannot be verified.");
    } else if (shortDeltaAbs > deltaLimit && !exhaustionFadeCandidate) {
      blockers.push(`Short delta ${shortDeltaAbs.toFixed(2)} exceeds the ${deltaLimit.toFixed(2)} trend-mode limit.`);
    }

    if (
      exhaustionFadeCandidate &&
      ((shortDistance.expectedMovePct ?? 999) < effectiveExpectedMoveFloor ||
        (shortDistance.points ?? 999) < absoluteFloor ||
        (shortDeltaAbs ?? 0) > deltaLimit)
    ) {
      reasons.push(
        "Fade mode is intentionally inside a conventional distance/delta preference; defined risk, premium crest, and completed price rejection—not 2Δ-as-POP—control entry.",
      );
    }
  }
  if (candidate && tracking && tracking.ageCandles < 1) {
    blockers.push(
      "The tracked candidate must remain valid through at least one completed candle.",
    );
  }

  const distanceScore = scoreShortDistance(
    candidate,
    shortDistance.expectedMovePct,
    isCreditSpread
      ? Math.max(
          timeRegime.minimumDistanceExpectedMovePct,
          riskPolicy
            ? minimumDistanceExpectedMovePctForRiskMode(riskPolicy.riskMode)
            : 0,
        )
      : timeRegime.minimumDistanceExpectedMovePct,
  );
  const structureScore = scoreStructure(
    candidate,
    mapState,
    exhaustionFadeCandidate,
    centerStretchRatio,
  );
  const dealerFlowScore = scoreDealerFlow(
    candidate?.strategy ?? null,
    recommendation,
    strikeFlow,
    exhaustionFadeCandidate,
  );
  const priceRejectionScore = candidate
    ? scorePriceExhaustion({
        strategy: candidate.strategy,
        priceAction,
        referenceCenter:
          candidate.strategy === "iron-fly" ? mapState.opening.center : undefined,
      })
    : 0;
  const priceRejectionThreshold =
    candidate?.strategy === "iron-fly" ? 52 : 58;
  const priceRejectionReady = priceRejectionScore >= priceRejectionThreshold;
  const premiumScore = candidate ? premiumCrest.score : 0;
  const portfolioScore = candidate
    ? portfolioContribution?.score ?? 72
    : 0;
  const weights = timeRegime.weights;
  const entryScore = candidate
    ? clamp(
        distanceScore * (weights.distance / 100) +
          structureScore * (weights.structure / 100) +
          dealerFlowScore * (weights.dealerFlow / 100) +
          premiumScore * (weights.premiumExhaustion / 100) +
          portfolioScore * (weights.portfolio / 100),
        0,
        100,
      )
    : 0;

  if (shortDistance.points !== null) {
    reasons.push(
      `Short strike is ${shortDistance.points.toFixed(1)} points from SPX (${Math.round((shortDistance.expectedMovePct ?? 0) * 100)}% of expected move).`,
    );
  }
  if (candidate && premiumExpansionPct !== null) {
    reasons.push(
      `Live credit is ${premiumExpansionPct >= 0 ? "+" : ""}${premiumExpansionPct.toFixed(1)}% versus this locked setup's tracked open.`,
    );
  } else if (candidate) {
    reasons.push("Building the premium baseline for this locked strategy and strike set.");
  }
  if (candidate) {
    reasons.push(...premiumCrest.reasons);
    reasons.push(
      `Price-rejection confirmation is ${priceRejectionScore.toFixed(0)}/${priceRejectionThreshold} for this strategy.`,
    );
  }
  if (candidate && tracking?.lockedAt) {
    reasons.push(`Candidate has been locked for ${tracking.ageCandles} candle${tracking.ageCandles === 1 ? "" : "s"}.`);
  }
  if (portfolioContribution) reasons.push(...portfolioContribution.reasons);
  if (exhaustionFadeCandidate) {
    reasons.push(
      `EXHAUSTION FADE thesis active: center displacement ${Math.abs(centerDisplacement).toFixed(1)} points (${Math.round(centerStretchRatio * 100)}% of Opening Map half-width). SELL_READY still requires confirmed premium rollover + completed 1m price rejection.`,
    );
  }

  const convictionAdjustment =
    (riskPolicy ? eventRiskScoreAdjustment(riskPolicy) : 0) +
    volContextScoreAdjustment(volContext);
  const minimumEntryScore = Math.min(
    100,
    timeRegime.signalEntryScore + convictionAdjustment,
  );
  const aPlusEntryScore = Math.min(
    100,
    Math.max(
      minimumEntryScore,
      timeRegime.minimumEntryScore + convictionAdjustment,
    ),
  );
  const roundedEntryScore = Math.round(entryScore);
  const signalGrade = gradeQualifiedSignal(
    roundedEntryScore,
    minimumEntryScore,
    aPlusEntryScore,
  );
  if (riskPolicy?.eventRisk === "HIGH") {
    reasons.push("High event-risk mode raises both the qualified-signal and A+ conviction floors by 6 points and halves preferred size.");
  }
  if (volContext?.regime === "HOT" || volContext?.regime === "EXTREME") {
    reasons.push(`Session range has consumed ${Math.round(volContext.rangeConsumptionPct ?? 0)}% of opening implied move; both conviction tiers and size are tightened.`);
  }
  if (candidate) {
    reasons.push(
      `Conviction tiers: qualified signal ${minimumEntryScore}, A+ ${aPlusEntryScore}; current ${roundedEntryScore} (${signalGrade}).`,
    );
  }

  const hardBlocked = unique(blockers).length > 0;
  const stableThroughClose = !tracking || tracking.ageCandles >= 1;
  const regimeTriggerReady = Boolean(
    stableThroughClose &&
      premiumCrest.signalEligible &&
      priceRejectionReady,
  );

  return {
    entryScore: roundedEntryScore,
    armed: Boolean(
      candidate &&
        !hardBlocked &&
        premiumCrest.armed &&
        entryScore >= minimumEntryScore - 8,
    ),
    sellReady: Boolean(
      candidate &&
        !hardBlocked &&
        entryScore >= minimumEntryScore &&
        regimeTriggerReady,
    ),
    hardBlocked,
    regimeTriggerReady,
    priceRejectionScore,
    priceRejectionReady,
    minimumEntryScore,
    aPlusEntryScore,
    signalGrade,
    reasons: unique(reasons),
    blockers: unique(blockers),
    components: [
      {
        key: "distance",
        label: "Short-strike safety",
        value: distanceScore * (weights.distance / 100),
        max: weights.distance,
        reason: shortDistance.expectedMovePct === null
          ? "No short-strike distance is available"
          : `${Math.round(shortDistance.expectedMovePct * 100)}% of expected move`,
      },
      {
        key: "structure",
        label: "Map / structure",
        value: structureScore * (weights.structure / 100),
        max: weights.structure,
        reason: `${mapState.phase} · structural confidence ${getControllingMarketMap(mapState).structure.structuralConfidence}% · rail ${mapState.railBreached}`,
      },
      {
        key: "dealer-flow",
        label: "Dealer / flow",
        value: dealerFlowScore * (weights.dealerFlow / 100),
        max: weights.dealerFlow,
        reason: `${recommendation.dealerPressure.toFixed(0)} dealer pressure`,
      },
      {
        key: "premium-exhaustion",
        label: "Premium crest",
        value: premiumScore * (weights.premiumExhaustion / 100),
        max: weights.premiumExhaustion,
        reason: `${premiumCrest.status.replaceAll("_", " ")} · ${premiumCrest.completedMinuteCount} closed 1m bars`,
      },
      {
        key: "portfolio",
        label: "Portfolio contribution",
        value: portfolioScore * (weights.portfolio / 100),
        max: weights.portfolio,
        reason: portfolioContribution
          ? `Contribution score ${portfolioContribution.score}`
          : "First-position baseline",
      },
    ] satisfies ExecutionScoreComponent[],
  };
}

function buildExitRead(args: {
  position: ExecutionPositionMemory | null;
  candidate: ExecutionCandidate | null;
  mapState: SessionMapManagerState;
  currentCredit: number | null;
  currentBuybackDebit: number | null;
  premiumVelocityPerMinute: number | null;
  peakDetected: boolean;
  recommendation: ZeroDteRecommendation;
  strikeFlow: ZeroDteStrikeFlowRead | null;
  generatedAt: string;
  timeRegime: ZeroDteTimeRegimeRead;
  leaderCandidate: ExecutionCandidate | null;
  memory: ZeroDteExecutionMemory;
  leastResistancePath: ZeroDteLeastResistancePath | null;
  expectedMoveRemaining: number;
  shortLegRisk: ExecutionShortLegRiskRead[];
  livePnlDollars: number | null;
  maxFavorableExcursionDollars: number;
  maxAdverseExcursionDollars: number;
  profitGivebackPct: number | null;
}) {
  const {
    position,
    candidate,
    mapState,
    currentCredit,
    currentBuybackDebit,
    premiumVelocityPerMinute,
    peakDetected,
    recommendation,
    strikeFlow,
    generatedAt,
    timeRegime,
    leaderCandidate,
    memory,
    leastResistancePath,
    expectedMoveRemaining,
    shortLegRisk,
    livePnlDollars,
    maxFavorableExcursionDollars,
    maxAdverseExcursionDollars,
    profitGivebackPct,
  } = args;

  if (!position) {
    return {
      exitScore: 0,
      emergencyExit: false,
      reasons: [] as string[],
      warnings: [] as string[],
      components: [] as ExecutionScoreComponent[],
    };
  }

  const reasons: string[] = [];
  const warnings: string[] = [];
  const currentMap = getControllingMarketMap(mapState);
  const ageMinutes = Math.max(
    0,
    (Date.parse(generatedAt) - Date.parse(position.openedAt)) / 60_000,
  );
  const managementDebit = currentBuybackDebit ?? currentCredit;
  const capturedPct =
    managementDebit !== null && position.entryCredit > 0
      ? ((position.entryCredit - managementDebit) / position.entryCredit) * 100
      : 0;
  const adversePct =
    managementDebit !== null && position.entryCredit > 0
      ? ((managementDebit - position.entryCredit) / position.entryCredit) * 100
      : 0;

  let mapFailure = false;
  let wallFailure = false;
  let hardThreat = false;
  const shortStrike = position.legs.find((leg) => leg.action === "sell")?.strike ?? null;
  const spot = recommendation.spxPrice;
  const shortDistancePoints = shortStrike === null
    ? null
    : position.strategy === "put-credit-spread"
      ? spot - shortStrike
      : position.strategy === "call-credit-spread"
        ? shortStrike - spot
        : Math.abs(spot - shortStrike);
  const shortItm = Boolean(
    shortStrike !== null &&
      ((position.strategy === "put-credit-spread" && spot <= shortStrike) ||
        (position.strategy === "call-credit-spread" && spot >= shortStrike)),
  );
  const pathThreat = leastResistanceThreatensShort({
    path: leastResistancePath,
    strategy: position.strategy,
    shortStrike,
  });
  if (pathThreat && leastResistancePath) {
    warnings.push(
      `Least-resistance cone reaches the short strike before the ${leastResistancePath.horizonMinutes}-minute horizon; thesis is weakening early.`,
    );
    reasons.push(
      `Forward path ${leastResistancePath.direction} ${leastResistancePath.confidence}% projects ${leastResistancePath.terminalTrough.toFixed(0)}–${leastResistancePath.terminalCrest.toFixed(0)} at horizon.`,
    );
  }

  if (position.strategy === "iron-fly") {
    mapFailure =
      mapState.phase === "TRANSITION" ||
      Math.abs(currentMap.center - position.entryMapCenter) >= 15;
    hardThreat =
      mapState.phase === "TRANSITION" &&
      Math.abs(currentMap.center - position.entryMapCenter) >= 15;
    if (mapFailure) {
      warnings.push(
        "The Iron Fly reversion center is being replaced or has migrated materially.",
      );
    } else if (mapState.railBreached !== "NONE") {
      warnings.push(
        "Price remains outside a rail, but rail displacement alone does not invalidate an exhaustion-fade Iron Fly.",
      );
    }
  }

  if (position.strategy === "put-credit-spread") {
    wallFailure = strikeFlow?.putWall.state === "breaking";
    mapFailure =
      mapState.railBreached === "LOWER" ||
      currentMap.center <= position.entryMapCenter - Math.max(15, Math.abs(position.entryMapCenter - (shortStrike ?? position.entryMapCenter)) * 0.35) ||
      recommendation.dealerPressure <= -35;
    hardThreat =
      shortItm ||
      (mapState.railBreached === "LOWER" &&
        shortDistancePoints !== null &&
        shortDistancePoints <= Math.max(15, expectedMoveRemaining * 0.35));
    if (wallFailure) warnings.push("Put wall is breaking beneath the open put spread.");
    if (mapFailure) warnings.push("Bullish map alignment is weakening or reversed.");
  }

  if (position.strategy === "call-credit-spread") {
    wallFailure = strikeFlow?.callWall.state === "attacked";
    mapFailure =
      mapState.railBreached === "UPPER" ||
      currentMap.center >= position.entryMapCenter + Math.max(15, Math.abs((shortStrike ?? position.entryMapCenter) - position.entryMapCenter) * 0.35) ||
      recommendation.dealerPressure >= 35;
    hardThreat =
      shortItm ||
      (mapState.railBreached === "UPPER" &&
        shortDistancePoints !== null &&
        shortDistancePoints <= Math.max(15, expectedMoveRemaining * 0.35));
    if (wallFailure) warnings.push("Call wall is being attacked above the open call spread.");
    if (mapFailure) warnings.push("Bearish map alignment is weakening or reversed.");
  }

  const priorSample = memory.samples
    .filter((sample) => sample.setupKey === position.setupKey)
    .at(-1) ?? null;
  const structuralCenterThreshold = Math.max(
    15,
    Math.abs((shortStrike ?? position.entryMapCenter) - position.entryMapCenter) * 0.35,
  );
  const priorStructuralFailure = Boolean(
    priorSample &&
      (position.strategy === "put-credit-spread"
        ? priorSample.railBreached === "LOWER" ||
          priorSample.mapCenter <= position.entryMapCenter - structuralCenterThreshold ||
          (priorSample.dealerPressure ?? 0) <= -35 ||
          priorSample.strikeFlowState === "breaking"
        : position.strategy === "call-credit-spread"
          ? priorSample.railBreached === "UPPER" ||
            priorSample.mapCenter >= position.entryMapCenter + structuralCenterThreshold ||
            (priorSample.dealerPressure ?? 0) >= 35 ||
            priorSample.strikeFlowState === "attacked"
          : Math.abs(priorSample.mapCenter - position.entryMapCenter) >= 15),
  );
  const confirmedStructuralFailure = Boolean(
    (mapFailure || wallFailure) && priorStructuralFailure,
  );

  const strategyRotated = Boolean(
    leaderCandidate &&
      leaderCandidate.strategy !== position.strategy &&
      leaderCandidate.score >= position.entryScore + 12,
  );
  if (strategyRotated) warnings.push(`Strategy leadership rotated to ${leaderCandidate?.label}.`);

  if (capturedPct >= 15) reasons.push(`${capturedPct.toFixed(1)}% of entry premium has been harvested.`);
  if (peakDetected) reasons.push("Live debit is rolling down from its tracked peak.");
  if ((premiumVelocityPerMinute ?? 0) < -0.05) reasons.push("Close debit is contracting with favorable velocity.");
  if (ageMinutes >= 30) reasons.push(`Position has been open ${Math.round(ageMinutes)} minutes.`);
  if (shortItm && position.strategy !== "iron-fly") {
    warnings.push("The credit-spread short strike is at or through spot; terminal 0DTE risk is active.");
  }
  const terminalThreat = Boolean(
    timeRegime.regime === "FINAL_ENTRY" &&
      shortDistancePoints !== null &&
      shortDistancePoints <= Math.max(15, expectedMoveRemaining * 0.35),
  );
  if (terminalThreat) warnings.push("Late-session gamma risk is elevated because spot is approaching the short strike.");

  // BUY management is profit-led. Structural/path reads remain advisory inputs,
  // but they are not allowed to manufacture repeated small-loss exits.
  const profitComponent = clamp((capturedPct / 50) * 70, 0, 70);
  const currentProfitDollars = Math.max(0, livePnlDollars ?? 0);
  const perContractProfit = currentProfitDollars / Math.max(1, position.quantity);
  const dollarProfitComponent = clamp((perContractProfit / 500) * 15, 0, 15);
  const velocityComponent =
    premiumVelocityPerMinute === null
      ? 0
      : clamp(-premiumVelocityPerMinute * 25, 0, 8);
  const timeComponent = clamp((ageMinutes / 60) * 4, 0, 4);
  const rotationComponent = strategyRotated && capturedPct > 0 ? 4 : 0;
  const invalidationComponent = capturedPct > 0
    ? hardThreat
      ? 6
      : confirmedStructuralFailure
        ? 4
        : mapFailure || wallFailure || pathThreat
          ? 2
          : 0
    : 0;
  let exitScore = clamp(
    profitComponent +
      dollarProfitComponent +
      velocityComponent +
      timeComponent +
      rotationComponent +
      invalidationComponent,
    0,
    100,
  );

  if (currentProfitDollars >= 250 * Math.max(1, position.quantity)) {
    reasons.push(`Open profit is $${currentProfitDollars.toFixed(0)}; profit preservation now carries additional BUY weight.`);
  }

  const threeXShort = shortLegRisk.find(
    (leg) => leg.multiple !== null && leg.multiple >= 3,
  ) ?? null;
  const meaningfulMfeFloor = 100 * Math.max(1, position.quantity);
  const retainedProfitFloor = 50 * Math.max(1, position.quantity);
  const profitProtection = Boolean(
    maxFavorableExcursionDollars >= meaningfulMfeFloor &&
      currentProfitDollars >= retainedProfitFloor &&
      (profitGivebackPct ?? 0) >= 35,
  );

  if (threeXShort) {
    reasons.push(
      `${threeXShort.strike.toFixed(0)} ${threeXShort.optionType.toUpperCase()} short is ${threeXShort.multiple?.toFixed(2)}× its entry sale premium; the 3× short-leg stop is active.`,
    );
    exitScore = 100;
  }
  if (profitProtection) {
    reasons.push(
      `Profit protection is active: MFE $${maxFavorableExcursionDollars.toFixed(0)}, current $${currentProfitDollars.toFixed(0)}, giveback ${Math.round(profitGivebackPct ?? 0)}%.`,
    );
    exitScore = 100;
  }
  if (capturedPct >= 50) {
    reasons.push("At least half of the entry premium has been harvested — take-profit gate is active.");
    exitScore = 100;
  }

  // Structural/map wobble remains advisory. The only deterministic loss stop is
  // the user's short-premium rule: any short leg reaching 3× its own entry sale
  // premium marks the whole package BUYBACK_READY immediately.
  const emergencyExit = Boolean(threeXShort);
  if (shortItm && position.strategy !== "iron-fly") {
    warnings.push("Short strike is at/through spot, but this is advisory only; no small-loss emergency exit is generated.");
  }

  return {
    exitScore: Math.round(exitScore),
    emergencyExit,
    reasons: unique(reasons),
    warnings: unique(warnings),
    components: [
      {
        key: "capture",
        label: "Premium captured",
        value: profitComponent,
        max: 70,
        reason: `${capturedPct.toFixed(1)}% captured`,
      },
      {
        key: "profit-dollars",
        label: "Open profit",
        value: dollarProfitComponent,
        max: 15,
        reason: `$${currentProfitDollars.toFixed(0)} open profit`,
      },
      {
        key: "mfe-protection",
        label: "Peak-profit protection",
        value: profitProtection ? 15 : 0,
        max: 15,
        reason: maxFavorableExcursionDollars > 0
          ? `MFE $${maxFavorableExcursionDollars.toFixed(0)} · MAE $${maxAdverseExcursionDollars.toFixed(0)} · giveback ${Math.round(profitGivebackPct ?? 0)}%`
          : "No meaningful favorable excursion yet",
      },
      {
        key: "velocity",
        label: "Debit contraction",
        value: velocityComponent,
        max: 8,
        reason: `${premiumVelocityPerMinute?.toFixed(3) ?? "—"} credit/min`,
      },
      {
        key: "time",
        label: "Time in trade",
        value: timeComponent,
        max: 4,
        reason: `${Math.round(ageMinutes)} minutes open`,
      },
      {
        key: "rotation",
        label: "Strategy rotation",
        value: rotationComponent,
        max: 4,
        reason: strategyRotated ? "A different strategy now leads" : "Original strategy still leads",
      },
      {
        key: "invalidation",
        label: "Map / wall invalidation",
        value: invalidationComponent,
        max: 6,
        reason: hardThreat
          ? "Hard short-strike / rail threat"
          : confirmedStructuralFailure
            ? "Structural failure confirmed"
            : mapFailure || wallFailure
              ? "Thesis weakening; awaiting confirmation"
              : pathThreat
                ? "Least-resistance cone reaches the short strike"
                : "Trade thesis remains intact",
      },
    ] satisfies ExecutionScoreComponent[],
  };
}

function candidateShortDistance(
  candidate: ExecutionCandidate | null,
  spot: number,
  expectedMove: number,
) {
  if (!candidate) return { points: null, expectedMovePct: null };
  return strategyShortDistance(
    candidate.strategy,
    candidate.legs,
    spot,
    expectedMove,
  );
}

function strategyShortDistance(
  strategy: ExecutionStrategy,
  legs: ExecutionLeg[],
  spot: number,
  expectedMove: number,
) {
  const shortStrike = legs.find((leg) => leg.action === "sell")?.strike;
  if (shortStrike == null) return { points: null, expectedMovePct: null };
  const points =
    strategy === "put-credit-spread"
      ? spot - shortStrike
      : strategy === "call-credit-spread"
        ? shortStrike - spot
        : Math.abs(spot - shortStrike);
  return {
    points,
    expectedMovePct: expectedMove > 0 ? points / expectedMove : null,
  };
}

function scoreShortDistance(
  candidate: ExecutionCandidate | null,
  distanceExpectedMovePct: number | null,
  minimumPct: number,
) {
  if (!candidate) return 0;
  if (candidate.strategy === "iron-fly") {
    // For an IF fade, center displacement is the opportunity.  Rail breach is
    // not scored as safety by itself; center validity is handled separately.
    return candidate.railBreached === "NONE" ? 62 : 78;
  }
  if (distanceExpectedMovePct === null) return 35;
  return clamp((distanceExpectedMovePct / Math.max(minimumPct, 0.1)) * 82);
}

function scoreStructure(
  candidate: ExecutionCandidate | null,
  mapState: SessionMapManagerState,
  exhaustionFadeCandidate = false,
  centerStretchRatio = 0,
) {
  if (!candidate) return 0;
  const controlling = getControllingMarketMap(mapState);
  const structure = controlling.structure;
  const phaseAdjustment =
    mapState.phase === "ACTIVE" ? 5 : mapState.phase === "OPENING" ? 2 : -6;

  if (candidate.strategy === "iron-fly") {
    const twoSided =
      structure.structuralConfidence * 0.55 +
      structure.callWallStrength * 0.15 +
      structure.putWallStrength * 0.15 +
      structure.pinProbability * 0.15;
    const railAdjustment =
      mapState.phase === "TRANSITION"
        ? -35
        : exhaustionFadeCandidate && mapState.railBreached !== "NONE"
          ? 8
          : mapState.railBreached === "NONE"
            ? 4
            : -8;
    const stretchAdjustment =
      exhaustionFadeCandidate ? clamp(centerStretchRatio * 18, 0, 18) : 0;
    return clamp(twoSided + phaseAdjustment + railAdjustment + stretchAdjustment);
  }

  const wallStrength =
    candidate.strategy === "put-credit-spread"
      ? structure.putWallStrength
      : structure.callWallStrength;
  let score =
    structure.structuralConfidence * 0.75 + wallStrength * 0.25 + phaseAdjustment;
  if (candidate.strategy === "put-credit-spread" && mapState.railBreached === "UPPER") {
    score += 5;
  }
  if (candidate.strategy === "call-credit-spread" && mapState.railBreached === "LOWER") {
    score += 5;
  }
  return clamp(score);
}

function scoreDealerFlow(
  strategy: ExecutionStrategy | null,
  recommendation: ZeroDteRecommendation,
  strikeFlow: ZeroDteStrikeFlowRead | null,
  exhaustionFadeCandidate = false,
) {
  if (!strategy) return 0;
  if (strategy === "put-credit-spread") {
    let score = exhaustionFadeCandidate
      ? clamp(50 - recommendation.dealerPressure * 0.9)
      : clamp(50 + recommendation.dealerPressure * 0.9);
    if (strikeFlow?.putWall.state === "absorbed") score += 20;
    if (strikeFlow?.putWall.state === "breaking") score -= 45;
    return clamp(score);
  }
  if (strategy === "call-credit-spread") {
    let score = exhaustionFadeCandidate
      ? clamp(50 + recommendation.dealerPressure * 0.9)
      : clamp(50 - recommendation.dealerPressure * 0.9);
    if (strikeFlow?.callWall.state === "defended") score += 20;
    if (strikeFlow?.callWall.state === "attacked") score -= 45;
    return clamp(score);
  }
  return exhaustionFadeCandidate
    ? clamp(52 + Math.min(42, Math.abs(recommendation.dealerPressure) * 0.75))
    : clamp(100 - Math.abs(recommendation.dealerPressure) * 1.7);
}

function findRanking(
  rankings: ZeroDteStrategyRanking[] | undefined,
  strategy: ExecutionStrategy,
) {
  return rankings?.find((ranking) => ranking.tradeType === strategy) ?? null;
}

function normalizeExecutionStrategy(
  tradeType: ZeroDteTradeSelection["tradeType"],
): ExecutionStrategy | null {
  if (
    tradeType === "iron-fly" ||
    tradeType === "put-credit-spread" ||
    tradeType === "call-credit-spread"
  ) {
    return tradeType;
  }
  return null;
}

export function makeExecutionSetupKey(
  strategy: ExecutionStrategy,
  legs: ExecutionLeg[],
) {
  return `${strategy}:${legs
    .map((leg) => `${leg.action[0]}${leg.optionType[0]}${leg.strike.toFixed(2)}`)
    .join("-")}`;
}

function buildShortLegQuoteReads(
  rows: ZeroDteChainRow[],
  legs: ExecutionLeg[],
): ExecutionShortLegQuoteRead[] {
  return legs
    .filter((leg) => leg.action === "sell")
    .map((leg) => {
      const quote = optionQuote(rows, leg.strike, leg.optionType);
      return {
        optionType: leg.optionType,
        strike: leg.strike,
        bid: quote?.bid ?? null,
        ask: quote?.ask ?? null,
        mid: quote?.mid ?? null,
      };
    });
}

function buildShortLegRiskReads(
  position: ExecutionPositionMemory | null,
  quotes: ExecutionShortLegQuoteRead[],
): ExecutionShortLegRiskRead[] {
  if (!position) return [];
  const entries = position.entryShortLegs ?? [];
  return position.legs
    .filter((leg) => leg.action === "sell")
    .map((leg) => {
      const entry = entries.find(
        (item) =>
          item.optionType === leg.optionType &&
          Math.abs(item.strike - leg.strike) < 0.01,
      );
      const quote = quotes.find(
        (item) =>
          item.optionType === leg.optionType &&
          Math.abs(item.strike - leg.strike) < 0.01,
      );
      const sellPrice = entry?.sellPrice ?? null;
      const currentAsk = quote?.ask ?? null;
      const multiple =
        sellPrice !== null && sellPrice > 0 && currentAsk !== null
          ? currentAsk / sellPrice
          : null;
      return {
        optionType: leg.optionType,
        strike: leg.strike,
        sellPrice,
        source: entry?.source ?? "unknown",
        currentAsk,
        multiple,
      };
    });
}

function strategyQuoteStatus(
  rows: ZeroDteChainRow[],
  legs: ExecutionLeg[],
): "LIVE" | "DEGRADED" | "WAITING_FOR_QUOTES" {
  if (!legs.length) return "WAITING_FOR_QUOTES";
  let complete = 0;
  let present = 0;
  for (const leg of legs) {
    const quote = optionQuote(rows, leg.strike, leg.optionType);
    if (!quote) continue;
    present += 1;
    if (quote.bid !== null && quote.ask !== null && quote.mid !== null) {
      complete += 1;
    }
  }
  if (complete === legs.length) return "LIVE";
  return present > 0 ? "DEGRADED" : "WAITING_FOR_QUOTES";
}

function optionQuote(
  rows: ZeroDteChainRow[],
  strike: number,
  optionType: "call" | "put",
) {
  const row = rows.find(
    (item) =>
      item.optionType === optionType && Math.abs(item.strike - strike) < 0.01,
  );
  if (!row) return null;
  const bid = Number.isFinite(row.bid) && Number(row.bid) >= 0 ? Number(row.bid) : null;
  const ask = Number.isFinite(row.ask) && Number(row.ask) > 0 ? Number(row.ask) : null;
  const suppliedMid = Number.isFinite(row.mid) && Number(row.mid) > 0 ? Number(row.mid) : null;
  const mid = suppliedMid ?? (bid !== null && ask !== null && ask >= bid ? (bid + ask) / 2 : null);
  return { bid, ask, mid };
}

function optionMid(
  rows: ZeroDteChainRow[],
  strike: number,
  optionType: "call" | "put",
): number | null {
  return optionQuote(rows, strike, optionType)?.mid ?? null;
}

function findShortDeltaAbs(rows: ZeroDteChainRow[], legs: ExecutionLeg[]) {
  const short = legs.find((leg) => leg.action === "sell");
  if (!short) return null;
  const row = rows.find(
    (item) =>
      item.optionType === short.optionType && Math.abs(item.strike - short.strike) < 0.01,
  );
  return row && Number.isFinite(row.delta) ? Math.abs(Number(row.delta)) : null;
}

function roundCredit(value: number) {
  return Math.round(value * 100) / 100;
}

function classifyEdge(
  spot: number,
  center: number,
  lowerWing: number,
  upperWing: number,
): "upper" | "lower" | "center" {
  const upperDistance = upperWing - center;
  const lowerDistance = center - lowerWing;
  if (spot >= center + upperDistance * 0.55) return "upper";
  if (spot <= center - lowerDistance * 0.55) return "lower";
  return "center";
}

function gradeQualifiedSignal(
  score: number,
  signalFloor: number,
  aPlusFloor: number,
): "A+" | "A" | "B" | "WATCH" {
  if (score < signalFloor) return "WATCH";
  if (score >= aPlusFloor) return "A+";
  const span = Math.max(1, aPlusFloor - signalFloor);
  return score >= signalFloor + Math.max(2, Math.ceil(span * 0.5)) ? "A" : "B";
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function unique(items: string[]) {
  return [...new Set(items.filter(Boolean))];
}
