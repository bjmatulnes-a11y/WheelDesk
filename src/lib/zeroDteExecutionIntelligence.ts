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
  ageCandles: number;
  status:
    | "LOCKED"
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
  estimatedCredit: number | null;
  maxRiskDollars: number | null;
  mapPhase: SessionMapManagerState["phase"];
  mapCenter: number;
  railBreached: SessionMapManagerState["railBreached"];
  reasons: string[];
  blockers: string[];
};

export type ExecutionPremiumSample = {
  timestamp: string;
  spot: number;
  strategy: ExecutionStrategy;
  setupKey: string;
  credit: number;
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
  currentCredit: number | null;
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
  centerDistance: number;
  edge: "upper" | "lower" | "center";
  peakDetected: boolean;
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
  tradeSelection: ZeroDteTradeSelection;
  mapState: SessionMapManagerState;
  memory: ZeroDteExecutionMemory;
  candidateOverride?: ExecutionCandidate | null;
  positionOverride?: ExecutionPositionMemory | null;
  tracking?: ExecutionCandidateTracking | null;
  portfolio?: ZeroDtePortfolioRead | null;
  priceAction?: ZeroDtePriceActionContext | null;
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
      ? buildExecutionCandidate(tradeSelection, mapState)
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
  const currentCredit = legs.length
    ? calculateStrategyCredit(spxRows, legs)
    : null;

  const relevantSamples = setupKey
    ? memory.samples.filter((sample) => sample.setupKey === setupKey)
    : [];
  const openingCredit = relevantSamples[0]?.credit ?? currentCredit;
  const peakCredit = relevantSamples.length
    ? Math.max(...relevantSamples.map((sample) => sample.credit), currentCredit ?? 0)
    : currentCredit;
  const currentTimestamp = Date.parse(generatedAt);
  const previousSample =
    [...relevantSamples]
      .reverse()
      .find((sample) => Date.parse(sample.timestamp) < currentTimestamp) ?? null;
  const elapsedMinutes = previousSample
    ? (currentTimestamp - Date.parse(previousSample.timestamp)) / 60_000
    : null;
  const premiumVelocityPerMinute =
    currentCredit !== null &&
    previousSample &&
    elapsedMinutes !== null &&
    elapsedMinutes > 0
      ? (currentCredit - previousSample.credit) / elapsedMinutes
      : null;
  const premiumExpansionPct =
    currentCredit !== null && openingCredit && openingCredit > 0
      ? ((currentCredit - openingCredit) / openingCredit) * 100
      : null;
  const premiumFromPeakPct =
    currentCredit !== null && peakCredit && peakCredit > 0
      ? ((currentCredit - peakCredit) / peakCredit) * 100
      : null;
  const peakDetected = Boolean(
    currentCredit !== null &&
      peakCredit !== null &&
      relevantSamples.length >= 2 &&
      peakCredit - currentCredit >= Math.max(0.1, peakCredit * 0.04) &&
      (premiumVelocityPerMinute ?? 0) < 0,
  );

  const shortDistance = candidateShortDistance(
    candidate,
    recommendation.spxPrice,
    recommendation.expectedMove,
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
    premiumExpansionPct,
    premiumVelocityPerMinute,
    peakDetected,
    strikeFlow,
    recommendation,
    timeRegime,
    priceAction: args.priceAction ?? null,
    shortDistance,
    portfolioContribution,
    tracking: args.tracking ?? null,
  });

  const exitRead = buildExitRead({
    position,
    candidate,
    mapState,
    currentCredit,
    premiumVelocityPerMinute,
    peakDetected,
    recommendation,
    strikeFlow,
    generatedAt,
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
        ? "BUYBACK NOW — the position thesis has failed or defined risk is accelerating."
        : "BUYBACK READY — sufficient premium has been harvested and the exit stack is aligned.";
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
    action = `SELL READY — ${candidate?.label ?? "strategy"} has cleared the map, premium, and flow gates.`;
  } else if (entryRead.armed) {
    lifecycle = "ARMED";
    action = `ARMED — ${candidate?.label ?? "strategy"} is valid, but the execution trigger is still building.`;
  }

  const entryCredit = position?.entryCredit ?? null;
  const capturedPremiumPct =
    position && currentCredit !== null && position.entryCredit > 0
      ? ((position.entryCredit - currentCredit) / position.entryCredit) * 100
      : null;
  const livePnlDollars =
    position && currentCredit !== null
      ? (position.entryCredit - currentCredit) * 100 * position.quantity
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
  const warnings = unique(
    position
      ? [...exitRead.warnings, ...entryRead.blockers]
      : entryRead.blockers,
  ).slice(0, 10);

  const components: ExecutionScoreComponent[] = position
    ? exitRead.components
    : entryRead.components;

  return {
    tradeDate,
    generatedAt,
    lifecycle,
    strategy,
    strategyLabel: position?.label ?? candidate?.label ?? "No Trade",
    setupKey,
    candidate,
    currentCredit,
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
    centerDistance,
    edge,
    peakDetected,
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
  let maxRiskDollars: number | null = ranking?.maxRiskDollars ?? null;

  if (strategy === "iron-fly") {
    const ironFly =
      selection.ironFly ??
      (selection.mapContext
        ? {
            center: selection.mapContext.controllingCenter,
            lowerWing: selection.mapContext.controllingLowerWing,
            upperWing: selection.mapContext.controllingUpperWing,
            wingWidth: Math.abs(
              selection.mapContext.controllingUpperWing -
                selection.mapContext.controllingCenter,
            ),
          }
        : null);

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
    maxRiskDollars,
    mapPhase: mapState.phase,
    mapCenter: controlling.center,
    railBreached: mapState.railBreached,
    reasons,
    blockers,
  };
}

export function calculateStrategyCredit(
  rows: ZeroDteChainRow[],
  legs: ExecutionLeg[],
): number | null {
  if (!legs.length) return null;

  let credit = 0;
  for (const leg of legs) {
    const mid = optionMid(rows, leg.strike, leg.optionType);
    if (mid === null) return null;
    credit += leg.action === "sell" ? mid : -mid;
  }

  return Number.isFinite(credit) && credit >= 0 ? credit : null;
}

function buildEntryRead(args: {
  candidate: ExecutionCandidate | null;
  mapState: SessionMapManagerState;
  currentCredit: number | null;
  premiumExpansionPct: number | null;
  premiumVelocityPerMinute: number | null;
  peakDetected: boolean;
  strikeFlow: ZeroDteStrikeFlowRead | null;
  recommendation: ZeroDteRecommendation;
  timeRegime: ZeroDteTimeRegimeRead;
  priceAction: ZeroDtePriceActionContext | null;
  shortDistance: { points: number | null; expectedMovePct: number | null };
  portfolioContribution: CandidatePortfolioContribution | null;
  tracking: ExecutionCandidateTracking | null;
}) {
  const {
    candidate,
    mapState,
    currentCredit,
    premiumExpansionPct,
    premiumVelocityPerMinute,
    peakDetected,
    strikeFlow,
    recommendation,
    timeRegime,
    priceAction,
    shortDistance,
    portfolioContribution,
    tracking,
  } = args;
  const blockers = [...(candidate?.blockers ?? [])];
  const reasons = [...(candidate?.reasons ?? []), ...timeRegime.reasons];

  if (!candidate) blockers.push("No executable tracked strategy candidate is available.");
  if (candidate && !candidate.eligible) blockers.push("The strategy orchestrator marked this candidate ineligible.");
  if (candidate && currentCredit === null) blockers.push("Live mids cannot price every strategy leg.");
  if (!timeRegime.entryAllowed) blockers.push(`${timeRegime.label} does not permit new risk.`);
  if (tracking?.status === "STRUCTURE_INVALID") {
    blockers.push(tracking.lastReplacementReason ?? "The tracked candidate is structurally invalid.");
  }

  if (candidate?.strategy === "iron-fly") {
    if (mapState.phase === "TRANSITION") blockers.push("Iron Fly entry is blocked during map transition.");
    if (mapState.railBreached !== "NONE") blockers.push("Iron Fly entry is blocked outside the controlling rails.");
  }

  if (candidate?.strategy === "put-credit-spread") {
    if (mapState.phase === "TRANSITION" && mapState.railBreached !== "UPPER") {
      blockers.push("Put spread requires confirmed upward migration during transition.");
    }
    if (strikeFlow?.putWall.state === "breaking") {
      blockers.push("Put wall is breaking; bullish premium selling is blocked.");
    }
    if (recommendation.dealerPressure <= -35) {
      blockers.push("Dealer pressure is too bearish for a put credit spread.");
    }
  }

  if (candidate?.strategy === "call-credit-spread") {
    if (mapState.phase === "TRANSITION" && mapState.railBreached !== "LOWER") {
      blockers.push("Call spread requires confirmed downward migration during transition.");
    }
    if (strikeFlow?.callWall.state === "attacked") {
      blockers.push("Call wall is being attacked; bearish premium selling is blocked.");
    }
    if (recommendation.dealerPressure >= 35) {
      blockers.push("Dealer pressure is too bullish for a call credit spread.");
    }
  }

  if (portfolioContribution?.blockers.length) {
    blockers.push(...portfolioContribution.blockers);
  }

  const isCreditSpread =
    candidate?.strategy === "put-credit-spread" ||
    candidate?.strategy === "call-credit-spread";
  if (
    isCreditSpread &&
    shortDistance.expectedMovePct !== null &&
    shortDistance.expectedMovePct < timeRegime.minimumDistanceExpectedMovePct
  ) {
    blockers.push(
      `Short-strike distance is below the ${Math.round(
        timeRegime.minimumDistanceExpectedMovePct * 100,
      )}% expected-move floor for ${timeRegime.label.toLowerCase()}.`,
    );
  }
  if (tracking && tracking.ageCandles < 1) {
    blockers.push(
      "The tracked candidate must remain valid through at least one completed candle.",
    );
  }

  const distanceScore = scoreShortDistance(
    candidate,
    shortDistance.expectedMovePct,
    timeRegime.minimumDistanceExpectedMovePct,
  );
  const structureScore = scoreStructure(candidate, mapState);
  const dealerFlowScore = scoreDealerFlow(
    candidate?.strategy ?? null,
    recommendation,
    strikeFlow,
  );
  const exhaustionScore = candidate
    ? scorePriceExhaustion({
        strategy: candidate.strategy,
        priceAction,
        peakDetected,
        premiumVelocityPerMinute,
      })
    : 0;
  const premiumScore = scorePremiumExhaustion({
    premiumExpansionPct,
    premiumVelocityPerMinute,
    peakDetected,
    exhaustionScore,
    requiresPeakRollover: timeRegime.requiresPeakRollover,
  });
  const portfolioScore = portfolioContribution?.score ?? 72;
  const weights = timeRegime.weights;
  const entryScore = clamp(
    distanceScore * (weights.distance / 100) +
      structureScore * (weights.structure / 100) +
      dealerFlowScore * (weights.dealerFlow / 100) +
      premiumScore * (weights.premiumExhaustion / 100) +
      portfolioScore * (weights.portfolio / 100),
    0,
    100,
  );

  if (shortDistance.points !== null) {
    reasons.push(
      `Short strike is ${shortDistance.points.toFixed(1)} points from SPX (${Math.round((shortDistance.expectedMovePct ?? 0) * 100)}% of expected move).`,
    );
  }
  if (premiumExpansionPct !== null) {
    reasons.push(
      `Live credit is ${premiumExpansionPct >= 0 ? "+" : ""}${premiumExpansionPct.toFixed(1)}% versus this locked setup's tracked open.`,
    );
  } else {
    reasons.push("Building the premium baseline for this locked strategy and strike set.");
  }
  if (peakDetected) reasons.push("Premium rollover is confirmed after a tracked setup peak.");
  if (tracking?.lockedAt) {
    reasons.push(`Candidate has been locked for ${tracking.ageCandles} candle${tracking.ageCandles === 1 ? "" : "s"}.`);
  }
  if (portfolioContribution) reasons.push(...portfolioContribution.reasons);

  const hardBlocked = unique(blockers).length > 0;
  const stableThroughClose = !tracking || tracking.ageCandles >= 1;
  const regimeTriggerReady = (() => {
    if (!stableThroughClose) return false;
    if (timeRegime.requiresPeakRollover) {
      return peakDetected && exhaustionScore >= 60;
    }
    if (timeRegime.regime === "OPENING_OPPORTUNITY") {
      return true;
    }
    if (timeRegime.regime === "SELECTIVE_CONTINUATION") {
      return (
        peakDetected ||
        (premiumExpansionPct ?? 0) >= 4 ||
        ((candidate?.score ?? 0) >= 90 && (tracking?.ageCandles ?? 0) >= 2)
      );
    }
    return false;
  })();

  return {
    entryScore: Math.round(entryScore),
    armed: Boolean(
      candidate &&
        !hardBlocked &&
        entryScore >= timeRegime.minimumEntryScore - 12,
    ),
    sellReady: Boolean(
      candidate &&
        !hardBlocked &&
        entryScore >= timeRegime.minimumEntryScore &&
        regimeTriggerReady,
    ),
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
        reason: `${mapState.phase} · rail ${mapState.railBreached}`,
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
        label: "Premium / exhaustion",
        value: premiumScore * (weights.premiumExhaustion / 100),
        max: weights.premiumExhaustion,
        reason: peakDetected
          ? "Premium peak rollover detected"
          : `${timeRegime.label} trigger is still building`,
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
  premiumVelocityPerMinute: number | null;
  peakDetected: boolean;
  recommendation: ZeroDteRecommendation;
  strikeFlow: ZeroDteStrikeFlowRead | null;
  generatedAt: string;
}) {
  const {
    position,
    candidate,
    mapState,
    currentCredit,
    premiumVelocityPerMinute,
    peakDetected,
    recommendation,
    strikeFlow,
    generatedAt,
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
  const capturedPct =
    currentCredit !== null && position.entryCredit > 0
      ? ((position.entryCredit - currentCredit) / position.entryCredit) * 100
      : 0;
  const adversePct =
    currentCredit !== null && position.entryCredit > 0
      ? ((currentCredit - position.entryCredit) / position.entryCredit) * 100
      : 0;

  let mapFailure = false;
  let wallFailure = false;

  if (position.strategy === "iron-fly") {
    mapFailure =
      mapState.phase === "TRANSITION" ||
      mapState.railBreached !== "NONE" ||
      Math.abs(currentMap.center - position.entryMapCenter) >= 15;
    if (mapFailure) warnings.push("The symmetric Iron Fly map is no longer controlling price.");
  }

  if (position.strategy === "put-credit-spread") {
    wallFailure = strikeFlow?.putWall.state === "breaking";
    mapFailure =
      mapState.railBreached === "LOWER" ||
      currentMap.center <= position.entryMapCenter - 10 ||
      recommendation.dealerPressure <= -35;
    if (wallFailure) warnings.push("Put wall is breaking beneath the open put spread.");
    if (mapFailure) warnings.push("Bullish map alignment has failed or reversed.");
  }

  if (position.strategy === "call-credit-spread") {
    wallFailure = strikeFlow?.callWall.state === "attacked";
    mapFailure =
      mapState.railBreached === "UPPER" ||
      currentMap.center >= position.entryMapCenter + 10 ||
      recommendation.dealerPressure >= 35;
    if (wallFailure) warnings.push("Call wall is being attacked above the open call spread.");
    if (mapFailure) warnings.push("Bearish map alignment has failed or reversed.");
  }

  const strategyRotated = Boolean(
    candidate &&
      candidate.strategy !== position.strategy &&
      candidate.score >= position.entryScore + 12,
  );
  if (strategyRotated) warnings.push(`Strategy leadership rotated to ${candidate?.label}.`);

  if (capturedPct >= 15) reasons.push(`${capturedPct.toFixed(1)}% of entry premium has been harvested.`);
  if (peakDetected) reasons.push("Live debit is rolling down from its tracked peak.");
  if ((premiumVelocityPerMinute ?? 0) < -0.05) reasons.push("Close debit is contracting with favorable velocity.");
  if (ageMinutes >= 30) reasons.push(`Position has been open ${Math.round(ageMinutes)} minutes.`);

  const profitComponent = clamp((capturedPct / 40) * 58, 0, 58);
  const velocityComponent =
    premiumVelocityPerMinute === null
      ? 0
      : clamp(-premiumVelocityPerMinute * 35, 0, 14);
  const timeComponent = clamp((ageMinutes / 45) * 10, 0, 10);
  const rotationComponent = strategyRotated ? 10 : 0;
  const invalidationComponent = mapFailure || wallFailure ? 25 : 0;
  let exitScore = clamp(
    profitComponent +
      velocityComponent +
      timeComponent +
      rotationComponent +
      invalidationComponent,
    0,
    100,
  );

  if (capturedPct >= 50) {
    exitScore = Math.max(exitScore, 85);
    reasons.push("At least half of the entry premium has been harvested.");
  } else if (capturedPct >= 35) {
    exitScore = Math.max(exitScore, 76);
  }

  const emergencyExit = Boolean(
    wallFailure ||
      mapFailure ||
      adversePct >= 35 ||
      (position.maxRiskDollars !== null &&
        currentCredit !== null &&
        (currentCredit - position.entryCredit) * 100 >=
          position.maxRiskDollars * 0.35),
  );
  if (emergencyExit) {
    exitScore = 100;
    warnings.push("Emergency exit gate is active.");
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
        max: 58,
        reason: `${capturedPct.toFixed(1)}% captured`,
      },
      {
        key: "velocity",
        label: "Debit contraction",
        value: velocityComponent,
        max: 14,
        reason: `${premiumVelocityPerMinute?.toFixed(3) ?? "—"} credit/min`,
      },
      {
        key: "time",
        label: "Time in trade",
        value: timeComponent,
        max: 10,
        reason: `${Math.round(ageMinutes)} minutes open`,
      },
      {
        key: "rotation",
        label: "Strategy rotation",
        value: rotationComponent,
        max: 10,
        reason: strategyRotated ? "A different strategy now leads" : "Original strategy still leads",
      },
      {
        key: "invalidation",
        label: "Map / wall invalidation",
        value: invalidationComponent,
        max: 25,
        reason: mapFailure || wallFailure ? "Trade thesis invalidated" : "Trade thesis remains intact",
      },
    ] satisfies ExecutionScoreComponent[],
  };
}

function candidateShortDistance(
  candidate: ExecutionCandidate | null,
  spot: number,
  expectedMove: number,
) {
  const shortStrike = candidate?.legs.find((leg) => leg.action === "sell")?.strike;
  if (shortStrike == null || !candidate) {
    return { points: null, expectedMovePct: null };
  }
  const points =
    candidate.strategy === "put-credit-spread"
      ? spot - shortStrike
      : candidate.strategy === "call-credit-spread"
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
    return candidate.railBreached === "NONE" ? 70 : 10;
  }
  if (distanceExpectedMovePct === null) return 35;
  return clamp((distanceExpectedMovePct / Math.max(minimumPct, 0.1)) * 82);
}

function scoreStructure(
  candidate: ExecutionCandidate | null,
  mapState: SessionMapManagerState,
) {
  if (!candidate) return 0;
  let score = candidate.score * 0.55;
  score += mapState.phase === "ACTIVE" ? 35 : mapState.phase === "OPENING" ? 25 : 15;
  if (candidate.strategy === "put-credit-spread" && mapState.railBreached === "UPPER") score += 10;
  if (candidate.strategy === "call-credit-spread" && mapState.railBreached === "LOWER") score += 10;
  if (candidate.strategy === "iron-fly" && mapState.railBreached !== "NONE") score -= 35;
  return clamp(score);
}

function scoreDealerFlow(
  strategy: ExecutionStrategy | null,
  recommendation: ZeroDteRecommendation,
  strikeFlow: ZeroDteStrikeFlowRead | null,
) {
  if (!strategy) return 0;
  if (strategy === "put-credit-spread") {
    let score = clamp(50 + recommendation.dealerPressure * 0.9);
    if (strikeFlow?.putWall.state === "absorbed") score += 20;
    if (strikeFlow?.putWall.state === "breaking") score -= 45;
    return clamp(score);
  }
  if (strategy === "call-credit-spread") {
    let score = clamp(50 - recommendation.dealerPressure * 0.9);
    if (strikeFlow?.callWall.state === "defended") score += 20;
    if (strikeFlow?.callWall.state === "attacked") score -= 45;
    return clamp(score);
  }
  return clamp(100 - Math.abs(recommendation.dealerPressure) * 1.7);
}

function scorePremiumExhaustion(args: {
  premiumExpansionPct: number | null;
  premiumVelocityPerMinute: number | null;
  peakDetected: boolean;
  exhaustionScore: number;
  requiresPeakRollover: boolean;
}) {
  const expansion = args.premiumExpansionPct ?? 0;
  let score = clamp(40 + expansion * 2.2);
  if (args.peakDetected) score = Math.max(score, 90);
  if ((args.premiumVelocityPerMinute ?? 0) < 0) score += 8;
  if (args.requiresPeakRollover) {
    score = score * 0.55 + args.exhaustionScore * 0.45;
    if (!args.peakDetected) score = Math.min(score, 58);
  }
  return clamp(score);
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

function optionMid(
  rows: ZeroDteChainRow[],
  strike: number,
  optionType: "call" | "put",
): number | null {
  const row = rows.find(
    (item) =>
      item.optionType === optionType && Math.abs(item.strike - strike) < 0.01,
  );
  if (!row) return null;
  if (Number.isFinite(row.mid) && Number(row.mid) > 0) return Number(row.mid);
  if (
    Number.isFinite(row.bid) &&
    Number.isFinite(row.ask) &&
    Number(row.bid) >= 0 &&
    Number(row.ask) > 0
  ) {
    return (Number(row.bid) + Number(row.ask)) / 2;
  }
  if (Number.isFinite(row.last) && Number(row.last) > 0) return Number(row.last);
  return null;
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

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function unique(items: string[]) {
  return [...new Set(items.filter(Boolean))];
}
