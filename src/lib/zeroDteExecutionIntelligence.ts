import type { SessionMapManagerState } from "./session/mapEngine";
import { getControllingMarketMap } from "./session/mapEngine";
import type { ZeroDteChainRow, ZeroDteRecommendation } from "./zeroDteOiIntelligence";
import type { ZeroDteStrikeFlowRead } from "./zeroDteStrikeFlow";
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
};

export function emptyExecutionMemory(tradeDate: string): ZeroDteExecutionMemory {
  return {
    tradeDate,
    tradeDayId: null,
    samples: [],
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
  const candidate = buildExecutionCandidate(tradeSelection, mapState);
  const position = memory.position;
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
  };
}

export function buildExecutionCandidate(
  selection: ZeroDteTradeSelection,
  mapState: SessionMapManagerState,
): ExecutionCandidate | null {
  const strategy = normalizeExecutionStrategy(selection.tradeType);
  if (!strategy) return null;

  const ranking = findRanking(selection.strategyRankings, strategy);
  const controlling = getControllingMarketMap(mapState);
  let legs: ExecutionLeg[] = [];
  let estimatedCredit: number | null = ranking?.estimatedCredit ?? null;
  let maxRiskDollars: number | null = ranking?.maxRiskDollars ?? null;

  if (strategy === "iron-fly" && selection.ironFly) {
    legs = [
      { optionType: "put", action: "buy", strike: selection.ironFly.lowerWing },
      { optionType: "put", action: "sell", strike: selection.ironFly.center },
      { optionType: "call", action: "sell", strike: selection.ironFly.center },
      { optionType: "call", action: "buy", strike: selection.ironFly.upperWing },
    ];
    if (maxRiskDollars === null && estimatedCredit !== null) {
      maxRiskDollars = Math.max(
        0,
        Math.max(
          selection.ironFly.center - selection.ironFly.lowerWing,
          selection.ironFly.upperWing - selection.ironFly.center,
        ) *
          100 -
          estimatedCredit * 100,
      );
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
    setupKey: makeSetupKey(strategy, legs),
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
  } = args;
  const blockers = [...(candidate?.blockers ?? [])];
  const reasons = [...(candidate?.reasons ?? [])];

  if (!candidate) blockers.push("No executable strategy candidate is currently selected.");
  if (candidate && !candidate.eligible) blockers.push("The strategy orchestrator marked this candidate ineligible.");
  if (candidate && currentCredit === null) blockers.push("Live mids cannot price every strategy leg.");

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

  const strategyScore = candidate?.score ?? 0;
  const premiumScore =
    premiumExpansionPct === null
      ? 45
      : clamp(45 + premiumExpansionPct * 2.5, 0, 100);
  const triggerScore = peakDetected
    ? 100
    : premiumVelocityPerMinute !== null && premiumVelocityPerMinute < 0
      ? 72
      : 42;
  const mapScore =
    mapState.phase === "ACTIVE"
      ? 92
      : mapState.phase === "OPENING"
        ? 76
        : clamp(
            (mapState.confirmationCount /
              Math.max(mapState.confirmationRequired, 1)) *
              100,
            0,
            100,
          );

  const entryScore = clamp(
    strategyScore * 0.62 +
      premiumScore * 0.18 +
      triggerScore * 0.1 +
      mapScore * 0.1,
    0,
    100,
  );

  if (premiumExpansionPct !== null) {
    reasons.push(
      `Live credit is ${premiumExpansionPct >= 0 ? "+" : ""}${premiumExpansionPct.toFixed(1)}% versus this setup's tracked open.`,
    );
  } else {
    reasons.push("Building the live premium baseline for this exact strategy and strike set.");
  }
  if (peakDetected) reasons.push("Premium rollover is confirmed after a tracked setup peak.");

  const hardBlocked = unique(blockers).length > 0;
  const premiumReady =
    peakDetected ||
    (premiumExpansionPct ?? 0) >= 5 ||
    strategyScore >= 90;

  return {
    entryScore: Math.round(entryScore),
    armed: Boolean(candidate && !hardBlocked && entryScore >= 65),
    sellReady: Boolean(
      candidate &&
        !hardBlocked &&
        entryScore >= 82 &&
        premiumReady,
    ),
    reasons: unique(reasons),
    blockers: unique(blockers),
    components: [
      {
        key: "strategy",
        label: "Strategy alignment",
        value: strategyScore,
        max: 100,
        reason: `${candidate?.label ?? "No trade"} ranking score`,
      },
      {
        key: "premium",
        label: "Premium expansion",
        value: premiumScore,
        max: 100,
        reason: premiumExpansionPct === null
          ? "Building premium history"
          : `${premiumExpansionPct.toFixed(1)}% versus tracked open`,
      },
      {
        key: "trigger",
        label: "Peak / rollover trigger",
        value: triggerScore,
        max: 100,
        reason: peakDetected
          ? "Premium peak rollover detected"
          : "Premium rollover not yet confirmed",
      },
      {
        key: "map",
        label: "Map confirmation",
        value: mapScore,
        max: 100,
        reason: `${mapState.phase} · ${mapState.confirmationCount}/${mapState.confirmationRequired} confirmations`,
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

function makeSetupKey(strategy: ExecutionStrategy, legs: ExecutionLeg[]) {
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
