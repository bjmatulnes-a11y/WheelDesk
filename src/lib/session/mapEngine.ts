import type {
  ZeroDteChainRow,
  ZeroDteRecommendation,
} from "../zeroDteOiIntelligence";
import {
  classifyStrikeFlowAtLevels,
  type StrikeFlowMapDirection,
  type ZeroDteStrikeFlowRead,
} from "../zeroDteStrikeFlow";
import {
  getZeroDteSessionClock,
  type ZeroDteCashSessionStatus,
} from "../zeroDteSessionClock";
import {
  buildMarketStructureRead,
  type MarketStructureRead,
} from "./marketStructureEngine";
import {
  isOpeningMapCaptureOnTime,
  loadOpeningMap,
  type ZeroDteOpeningMap,
} from "../zeroDteOpeningMap";

export type SessionMapState = "OPENING" | "TRANSITION" | "ACTIVE";
export type MapFlowConfirmation =
  | "CONFIRMED"
  | "REJECTED"
  | "BUILDING"
  | "UNAVAILABLE";
export type MapMigrationConfirmationMode =
  | "FLOW_CONFIRMED"
  | "DISPLACEMENT_CONFIRMED"
  | "NONE";

export type StrikeBaseline = {
  strike: number;
  callOi: number;
  putOi: number;
  callGamma: number;
  putGamma: number;
  callVolume: number;
  putVolume: number;
  totalScore: number;
};

export type MarketMapSnapshot = {
  tradeDate: string;
  capturedAt: string;
  source: "open-map" | "first-live-fallback" | "live";
  spot: number;
  center: number;
  lowerWing: number;
  upperWing: number;
  callWall: number | null;
  putWall: number | null;
  pin: number | null;
  expectedMove: number;
  confidence: number;
  dealerPressure: number;
  spxPressure: number;
  spyPressure: number;
  structure: MarketStructureRead;
  strikes: Record<string, StrikeBaseline>;
};

export type MapTransitionEvent = {
  timestamp: string;
  from: SessionMapState;
  to: SessionMapState;
  reason: string;
  center: number;
  lowerWing: number;
  upperWing: number;
};

export type SessionMapManagerState = {
  tradeDate: string;
  phase: SessionMapState;
  sessionStatus: ZeroDteCashSessionStatus;
  opening: MarketMapSnapshot;
  candidate: MarketMapSnapshot | null;
  active: MarketMapSnapshot;
  /** Confirmed map that remains authoritative while a replacement is unconfirmed. */
  transitionFrom: MarketMapSnapshot | null;
  transitionFromPhase: "OPENING" | "ACTIVE" | null;
  latest: MarketMapSnapshot;
  previousLive: MarketMapSnapshot | null;

  /** Completed one-minute confirmations, not five-second refreshes. */
  confirmationCount: number;
  confirmationRequired: number;
  lastConfirmationMinuteKey: string | null;

  railBreached: "UPPER" | "LOWER" | "NONE";
  railBreachStartedAt: string | null;
  outsideMinutes: number;

  migrationScore: number;
  /** Independent proof required before a replacement can enter TRANSITION. */
  migrationConfirmationMode: MapMigrationConfirmationMode;
  flowConfirmation: MapFlowConfirmation;
  flowDirection: StrikeFlowMapDirection | null;
  /** Flow evidence evaluated specifically at the confirmed controlling map levels. */
  flowScore: number | null;
  flowMessage: string | null;

  reasons: string[];
  events: MapTransitionEvent[];
};

export type ExistingOpenMapLike = Partial<{
  tradeDate: string;
  generatedAt: string;
  capturedAt: string;
  lockedAt: string;
  version: number;
  spxPrice: number;
  spot: number;
  suggestedCenter: number;
  center: number;
  lowerWing: number;
  upperWing: number;
  callWall: number | null;
  putWall: number | null;
  pin: number | null;
  strongestPin: number | null;
  expectedMove: number;
  confidenceScore: number;
  confidence: number;
  dealerPressure: number;
  spxDealerPressure: number;
  spyDealerPressure: number;
  spxPressure: number;
  spyPressure: number;
  rows: ZeroDteChainRow[];
  structure: MarketStructureRead;
  gravity: number;
  pinScore: number;
}>;

const key = (tradeDate: string) =>
  `wheeldesk:session-map-manager:v6:${tradeDate}`;
const legacyKeys = (tradeDate: string) => [
  `wheeldesk:open-map:${tradeDate}`,
  `wheeldesk:opening-map:${tradeDate}`,
  `wheeldesk:zero-dte:open-map:${tradeDate}`,
];

export function buildLiveMapSnapshot(args: {
  tradeDate: string;
  generatedAt: string;
  recommendation: ZeroDteRecommendation;
  rows: ZeroDteChainRow[];
}): MarketMapSnapshot {
  const { tradeDate, generatedAt, recommendation, rows } = args;

  return {
    tradeDate,
    capturedAt: generatedAt,
    source: "live",
    spot: recommendation.spxPrice,
    center: recommendation.suggestedCenter,
    lowerWing: recommendation.lowerWing,
    upperWing: recommendation.upperWing,
    callWall: recommendation.spx.callWall,
    putWall: recommendation.spx.putWall,
    pin: recommendation.spx.strongestPin,
    expectedMove: recommendation.expectedMove,
    confidence: recommendation.confidenceScore,
    dealerPressure: recommendation.dealerPressure,
    spxPressure: recommendation.spxDealerPressure,
    spyPressure: recommendation.spyDealerPressure,
    structure: buildMarketStructureRead({
      spot: recommendation.spxPrice,
      rows,
      callWall: recommendation.spx.callWall,
      putWall: recommendation.spx.putWall,
      pin: recommendation.spx.strongestPin,
      expectedMove: recommendation.expectedMove,
    }),
    strikes: buildStrikeBaseline(rows),
  };
}

export function initializeSessionMapManager(
  live: MarketMapSnapshot,
  explicitOpeningMap?: ZeroDteOpeningMap | null,
  options: { loadStored?: boolean } = {},
): SessionMapManagerState {
  const stored = options.loadStored === false
    ? null
    : loadSessionMapManager(live.tradeDate);
  if (stored) {
    const hydrated = hydrateStoredSessionMapManager(stored, live);
    return hydrated;
  }

  const existingOpenMapCandidate =
    explicitOpeningMap ??
    loadOpeningMap(live.tradeDate) ??
    loadExistingOpenMap(live.tradeDate);
  const existingOpenMapLike =
    existingOpenMapCandidate as ExistingOpenMapLike | null;
  const existingOpenMapTimestamp = existingOpenMapLike
    ? String(
        existingOpenMapLike.lockedAt ??
          existingOpenMapLike.capturedAt ??
          existingOpenMapLike.generatedAt ??
          "",
      )
    : "";
  const existingOpenMap =
    existingOpenMapCandidate &&
    isOpeningMapCaptureOnTime(existingOpenMapTimestamp)
      ? existingOpenMapCandidate
      : null;
  const opening = existingOpenMap
    ? normalizeExistingOpenMap(existingOpenMap, live)
    : { ...live, source: "first-live-fallback" as const };
  const clock = getZeroDteSessionClock(live.capturedAt);

  const initial: SessionMapManagerState = {
    tradeDate: live.tradeDate,
    phase: "OPENING",
    sessionStatus: clock.sessionStatus,
    opening,
    candidate: null,
    active: opening,
    transitionFrom: null,
    transitionFromPhase: null,
    latest: live,
    previousLive: null,
    confirmationCount: 0,
    confirmationRequired: 2,
    lastConfirmationMinuteKey: null,
    railBreached: "NONE",
    railBreachStartedAt: null,
    outsideMinutes: 0,
    migrationScore: 0,
    migrationConfirmationMode: "NONE",
    flowConfirmation: "UNAVAILABLE",
    flowDirection: null,
    flowScore: null,
    flowMessage: null,
    reasons: [
      existingOpenMap
        ? "Opening thesis loaded from the saved Opening Map."
        : existingOpenMapCandidate
          ? "A saved Opening Map existed but failed the cash-open timing gate; the first valid live snapshot is labeled as a fallback and cannot authorize the opening Iron Fly."
          : "Saved Opening Map was unavailable; the first valid live snapshot is labeled as a fallback rather than a verified cash-open map.",
    ],
    events: [],
  };

  return initial;
}

export function updateSessionMapManager(
  previous: SessionMapManagerState,
  live: MarketMapSnapshot,
  strikeFlow: ZeroDteStrikeFlowRead | null = null,
): SessionMapManagerState {
  const clock = getZeroDteSessionClock(live.capturedAt);
  // During TRANSITION the last confirmed map remains authoritative. Never
  // compare a second/third migration back to the original Opening Map.
  const reference =
    previous.phase === "TRANSITION"
      ? previous.transitionFrom ?? previous.active ?? previous.opening
      : previous.phase === "ACTIVE"
        ? previous.active
        : previous.opening;
  const referencePhase: "OPENING" | "ACTIVE" =
    previous.phase === "TRANSITION"
      ? previous.transitionFromPhase ?? (reference === previous.opening ? "OPENING" : "ACTIVE")
      : previous.phase === "ACTIVE"
        ? "ACTIVE"
        : "OPENING";
  const railBreached =
    live.spot > reference.upperWing
      ? "UPPER"
      : live.spot < reference.lowerWing
        ? "LOWER"
        : "NONE";

  const breachStartedAt = nextBreachStartedAt({
    previous,
    live,
    railBreached,
  });
  const outsideMinutes =
    railBreached === "NONE" || !breachStartedAt
      ? 0
      : Math.max(
          0,
          (Date.parse(live.capturedAt) - Date.parse(breachStartedAt)) / 60_000,
        );

  const centerShift = Math.abs(live.center - reference.center);
  const callWallShift = distance(live.callWall, reference.callWall);
  const putWallShift = distance(live.putWall, reference.putWall);
  const pinShift = distance(live.pin, reference.pin);
  const structuralShift =
    centerShift >= 10 ||
    callWallShift >= 10 ||
    putWallShift >= 10 ||
    pinShift >= 10;

  const pressureConfirms =
    railBreached === "UPPER"
      ? live.dealerPressure >= reference.dealerPressure + 8 ||
        live.dealerPressure > 20
      : railBreached === "LOWER"
        ? live.dealerPressure <= reference.dealerPressure - 8 ||
          live.dealerPressure < -20
        : false;

  const structuralConfidence = live.structure?.structuralConfidence ?? 0;
  const majorDisplacement =
    Math.abs(live.spot - reference.center) >=
    Math.max(25, live.expectedMove * 0.75);
  const confidenceConfirms =
    live.confidence >= 48 ||
    structuralConfidence >= 60 ||
    majorDisplacement;

  // Migration evidence must be measured at the confirmed map's levels, not at
  // whichever walls the new recommendation is proposing. Candidate-wall flow
  // is useful context, but it cannot prove that the old controlling wall failed.
  const flowAgeMinutes =
    strikeFlow?.officialThrough
      ? Math.max(
          0,
          (Date.parse(live.capturedAt) - Date.parse(strikeFlow.officialThrough)) /
            60_000,
        )
      : Number.POSITIVE_INFINITY;
  const flowContinuous = Boolean(
    strikeFlow?.hasClosedMinute &&
      flowAgeMinutes <= 2 &&
      (strikeFlow.elapsedMinutes === null || strikeFlow.elapsedMinutes <= 2),
  );
  const controllingFlow = strikeFlow && flowContinuous
    ? classifyStrikeFlowAtLevels({
        read: strikeFlow,
        callWall: reference.callWall,
        putWall: reference.putWall,
      })
    : null;
  const flowDirection = controllingFlow?.mapDirection ?? null;
  const flowConfirms =
    railBreached === "UPPER"
      ? flowDirection === "UPPER_ACCEPTED" ||
        controllingFlow?.callWall.state === "attacked" ||
        controllingFlow?.putWall.state === "absorbed"
      : railBreached === "LOWER"
        ? flowDirection === "LOWER_ACCEPTED" ||
          controllingFlow?.putWall.state === "breaking" ||
          controllingFlow?.callWall.state === "defended"
        : false;
  const flowRejects =
    railBreached === "UPPER"
      ? flowDirection === "UPPER_REJECTED" ||
        controllingFlow?.callWall.state === "defended"
      : railBreached === "LOWER"
        ? flowDirection === "LOWER_REJECTED" ||
          controllingFlow?.putWall.state === "absorbed"
        : false;
  const flowConfirmation: MapFlowConfirmation = !flowContinuous
    ? "UNAVAILABLE"
    : flowConfirms
      ? "CONFIRMED"
      : flowRejects
        ? "REJECTED"
        : "BUILDING";

  const migrationScore = clampScore(
    (railBreached !== "NONE" ? 25 : 0) +
      (structuralShift ? 20 : 0) +
      (structuralConfidence >= 60 ? 15 : live.confidence >= 48 ? 10 : 0) +
      (majorDisplacement ? 15 : 0) +
      (pressureConfirms ? 10 : 0) +
      (flowConfirms ? 20 : 0) -
      (flowRejects ? 25 : 0),
  );

  // Do not let correlated descendants of the same chain topology manufacture
  // conviction. A replacement map needs one independent confirmation family:
  // either completed flow at the *confirmed* map's levels, or a genuinely large
  // price displacement backed by directional dealer pressure. Structural score
  // and recommendation confidence alone can never authorize migration.
  const migrationConfirmationMode: MapMigrationConfirmationMode = flowConfirms
    ? "FLOW_CONFIRMED"
    : majorDisplacement && pressureConfirms
      ? "DISPLACEMENT_CONFIRMED"
      : "NONE";

  const transitionSignal =
    railBreached !== "NONE" &&
    structuralShift &&
    confidenceConfirms &&
    migrationScore >= 55 &&
    migrationConfirmationMode !== "NONE" &&
    !flowRejects;

  const closedMinuteKey = strikeFlow?.closedMinuteKey ?? null;
  const isNewClosedMinute =
    Boolean(closedMinuteKey) &&
    closedMinuteKey !== previous.lastConfirmationMinuteKey;
  const isNewLive = previous.latest.capturedAt !== live.capturedAt;

  let next: SessionMapManagerState = {
    ...previous,
    sessionStatus: clock.sessionStatus,
    previousLive: isNewLive ? previous.latest : previous.previousLive,
    latest: live,
    railBreached,
    railBreachStartedAt: breachStartedAt,
    outsideMinutes,
    migrationScore,
    migrationConfirmationMode,
    flowConfirmation,
    flowDirection,
    flowScore: controllingFlow?.mapConfirmationScore ?? null,
    flowMessage: controllingFlow?.mapMessage ?? null,
  };

  if (clock.sessionStatus !== "OPEN") {
    next = {
      ...next,
      reasons: [
        clock.sessionStatus === "CLOSED"
          ? "Cash session closed. The map is frozen at the last confirmed state for end-of-day review."
          : "Cash session has not opened. No candidate or active-map transition is permitted.",
        railBreached === "NONE"
          ? "Price is inside the controlling rails."
          : `${railBreached.toLowerCase()} rail is outside the controlling map, but no after-hours confirmation is counted.`,
      ],
    };
    return next;
  }

  if (!transitionSignal) {
    const missing = buildMissingEvidence({
      railBreached,
      structuralShift,
      confidenceConfirms,
      flowRejects,
      migrationConfirmationMode,
      strikeFlow: flowContinuous ? strikeFlow : null,
      migrationScore,
    });
    if (strikeFlow?.hasClosedMinute && !flowContinuous) {
      missing.push(
        `Completed-minute flow is stale or gapped (${Number.isFinite(flowAgeMinutes) ? flowAgeMinutes.toFixed(1) : "unknown"} min old); it cannot confirm migration.`,
      );
    }

    if (previous.phase === "TRANSITION" && isNewClosedMinute) {
      const confirmationCount = Math.max(0, previous.confirmationCount - 1);
      const reverting = confirmationCount === 0;
      next = {
        ...next,
        phase: reverting ? referencePhase : "TRANSITION",
        candidate: reverting ? null : previous.candidate,
        transitionFrom: reverting ? null : previous.transitionFrom ?? reference,
        transitionFromPhase: reverting ? null : previous.transitionFromPhase ?? referencePhase,
        confirmationCount,
        lastConfirmationMinuteKey: closedMinuteKey,
        reasons: [
          reverting
            ? `Candidate failed confirmation; restored the last confirmed ${referencePhase.toLowerCase()} map.`
            : "Candidate lost a completed-candle confirmation.",
          ...missing,
        ],
      };
    } else {
      next = {
        ...next,
        reasons:
          railBreached === "NONE"
            ? ["Price and live structure remain inside the controlling map."]
            : missing,
      };
    }

    return next;
  }

  if (!flowContinuous || !closedMinuteKey) {
    next = {
      ...next,
      reasons: [
        `${railBreached.toLowerCase()} rail breach and structural migration detected.`,
        "Waiting for the first completed one-minute strike-flow read before opening a candidate map.",
      ],
    };
    return next;
  }

  const candidateStable =
    !previous.candidate ||
    (Math.abs(live.center - previous.candidate.center) <= 10 &&
      distance(live.callWall, previous.candidate.callWall) <= 15 &&
      distance(live.putWall, previous.candidate.putWall) <= 15);

  const confirmationCount = isNewClosedMinute
    ? candidateStable
      ? Math.min(previous.confirmationRequired, previous.confirmationCount + 1)
      : 1
    : previous.confirmationCount;

  const candidate =
    candidateStable && previous.candidate
      ? {
          ...live,
          capturedAt: previous.candidate.capturedAt,
        }
      : live;

  const reasons = [
    `${railBreached.toLowerCase()} controlling rail breached for ${outsideMinutes.toFixed(1)} minutes.`,
    `Center shifted ${signed(live.center - reference.center)} points; wall/pin structure shifted materially.`,
    `Layer 3 structural confidence ${structuralConfidence}%${
      live.confidence !== structuralConfidence
        ? `; general recommendation confidence ${live.confidence}%`
        : ""
    }.`,
    migrationConfirmationMode === "FLOW_CONFIRMED"
      ? `Completed-minute strike flow confirms failure of the controlling map (${controllingFlow?.mapDirection ?? "UNAVAILABLE"}, score ${controllingFlow?.mapConfirmationScore ?? 0}).`
      : "Major price displacement plus directional dealer pressure independently confirm the replacement while completed-minute flow continues building.",
    `Closed-candle confirmation ${confirmationCount}/${previous.confirmationRequired}.`,
  ];

  if (confirmationCount >= previous.confirmationRequired) {
    const event: MapTransitionEvent = {
      timestamp: live.capturedAt,
      from: previous.phase,
      to: "ACTIVE",
      reason: reasons.join(" "),
      center: live.center,
      lowerWing: live.lowerWing,
      upperWing: live.upperWing,
    };

    next = {
      ...next,
      phase: "ACTIVE",
      active: live,
      candidate: null,
      transitionFrom: null,
      transitionFromPhase: null,
      confirmationCount: 0,
      lastConfirmationMinuteKey: closedMinuteKey,
      reasons: ["Replacement map is ACTIVE.", ...reasons.slice(0, 4)],
      events: [...previous.events, event].slice(-40),
    };
  } else {
    const enteringTransition = previous.phase !== "TRANSITION";
    next = {
      ...next,
      phase: "TRANSITION",
      candidate,
      transitionFrom: enteringTransition
        ? reference
        : previous.transitionFrom ?? reference,
      transitionFromPhase: enteringTransition
        ? referencePhase
        : previous.transitionFromPhase ?? referencePhase,
      confirmationCount,
      lastConfirmationMinuteKey: isNewClosedMinute
        ? closedMinuteKey
        : previous.lastConfirmationMinuteKey,
      reasons,
      events: enteringTransition
        ? [
            ...previous.events,
            {
              timestamp: live.capturedAt,
              from: previous.phase,
              to: "TRANSITION",
              reason: reasons.join(" "),
              center: live.center,
              lowerWing: live.lowerWing,
              upperWing: live.upperWing,
            } satisfies MapTransitionEvent,
          ].slice(-40)
        : previous.events,
    };
  }

  return next;
}

export function getControllingMarketMap(
  state: SessionMapManagerState,
): MarketMapSnapshot {
  if (state.phase === "ACTIVE") return state.active;
  if (state.phase === "TRANSITION") {
    return state.transitionFrom ?? state.active ?? state.opening;
  }
  return state.opening;
}

function nextBreachStartedAt(args: {
  previous: SessionMapManagerState;
  live: MarketMapSnapshot;
  railBreached: "UPPER" | "LOWER" | "NONE";
}) {
  if (args.railBreached === "NONE") return null;
  if (
    args.previous.railBreached === args.railBreached &&
    args.previous.railBreachStartedAt
  ) {
    return args.previous.railBreachStartedAt;
  }
  return args.live.capturedAt;
}

function buildMissingEvidence(args: {
  railBreached: SessionMapManagerState["railBreached"];
  structuralShift: boolean;
  confidenceConfirms: boolean;
  flowRejects: boolean;
  migrationConfirmationMode: MapMigrationConfirmationMode;
  strikeFlow: ZeroDteStrikeFlowRead | null;
  migrationScore: number;
}) {
  const reasons: string[] = [];
  if (args.railBreached === "NONE") {
    reasons.push("Price remains inside the controlling rails.");
  } else {
    reasons.push(`${args.railBreached.toLowerCase()} controlling rail is breached.`);
  }
  if (!args.structuralShift) {
    reasons.push("Center, walls and pin have not migrated far enough to establish a replacement structure.");
  }
  if (!args.confidenceConfirms) {
    reasons.push("Neither structural confidence nor displacement is strong enough to validate migration.");
  }
  if (args.migrationConfirmationMode === "NONE" && !args.flowRejects) {
    reasons.push(
      "Independent migration proof is missing: require completed flow at the confirmed map levels, or major price displacement plus directional dealer pressure.",
    );
  }
  if (!args.strikeFlow?.hasClosedMinute) {
    reasons.push("Completed one-minute delta-volume flow is not available yet.");
  } else if (args.flowRejects) {
    reasons.push(`Strike flow rejects migration: ${args.strikeFlow.mapMessage}`);
  } else if (!args.strikeFlow.confirmationReady) {
    reasons.push(`Rolling ${args.strikeFlow.confirmationWindowMinutes}-minute flow confirmation is still building.`);
  } else {
    reasons.push(`Strike-flow state is ${args.strikeFlow.mapDirection}; migration score ${args.migrationScore}/100.`);
  }
  return reasons;
}

function hydrateStoredSessionMapManager(
  stored: SessionMapManagerState,
  live: MarketMapSnapshot,
): SessionMapManagerState {
  const opening = hydrateSnapshot(stored.opening, live);
  const active = hydrateSnapshot(stored.active, opening);
  const candidate = stored.candidate
    ? hydrateSnapshot(stored.candidate, live)
    : null;
  const clock = getZeroDteSessionClock(live.capturedAt);

  return {
    ...stored,
    opening,
    active,
    latest: hydrateSnapshot(stored.latest, live),
    previousLive: stored.previousLive
      ? hydrateSnapshot(stored.previousLive, live)
      : null,
    candidate,
    transitionFrom: stored.transitionFrom
      ? hydrateSnapshot(stored.transitionFrom, active)
      : null,
    transitionFromPhase: stored.transitionFromPhase ?? null,
    sessionStatus: stored.sessionStatus ?? clock.sessionStatus,
    confirmationRequired: 2,
    lastConfirmationMinuteKey: stored.lastConfirmationMinuteKey ?? null,
    railBreachStartedAt: stored.railBreachStartedAt ?? null,
    migrationScore: stored.migrationScore ?? 0,
    migrationConfirmationMode: stored.migrationConfirmationMode ?? "NONE",
    flowConfirmation: stored.flowConfirmation ?? "UNAVAILABLE",
    flowDirection: stored.flowDirection ?? null,
    flowScore: stored.flowScore ?? null,
    flowMessage: stored.flowMessage ?? null,
    reasons: Array.isArray(stored.reasons) ? stored.reasons : [],
    events: Array.isArray(stored.events) ? stored.events : [],
  };
}

function hydrateSnapshot(
  snapshot: MarketMapSnapshot | null | undefined,
  fallback: MarketMapSnapshot,
): MarketMapSnapshot {
  if (!snapshot) return fallback;
  return {
    ...fallback,
    ...snapshot,
    structure: snapshot.structure ?? fallback.structure,
    strikes:
      snapshot.strikes && Object.keys(snapshot.strikes).length
        ? snapshot.strikes
        : fallback.strikes,
  };
}

export function loadSessionMapManager(
  tradeDate: string,
): SessionMapManagerState | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(key(tradeDate)) ?? "null",
    );
    return parsed?.tradeDate === tradeDate ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSessionMapManager(state: SessionMapManagerState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(state.tradeDate), JSON.stringify(state));
  } catch {
    // Session manager can continue in memory.
  }
}

export function resetSessionMapManager(tradeDate: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key(tradeDate));
}

function loadExistingOpenMap(tradeDate: string): ExistingOpenMapLike | null {
  if (typeof window === "undefined") return null;
  for (const storageKey of legacyKeys(tradeDate)) {
    try {
      const parsed = JSON.parse(
        window.localStorage.getItem(storageKey) ?? "null",
      );
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // Try the next legacy key.
    }
  }
  return null;
}

function normalizeExistingOpenMap(
  raw: ExistingOpenMapLike,
  fallback: MarketMapSnapshot,
): MarketMapSnapshot {
  const center = number(raw.suggestedCenter ?? raw.center, fallback.center);
  const lowerWing = number(raw.lowerWing, center - 50);
  const upperWing = number(raw.upperWing, center + 50);

  return {
    tradeDate: raw.tradeDate ?? fallback.tradeDate,
    capturedAt:
      raw.generatedAt ?? raw.capturedAt ?? raw.lockedAt ?? fallback.capturedAt,
    source: "open-map",
    spot: number(raw.spxPrice ?? raw.spot, fallback.spot),
    center,
    lowerWing,
    upperWing,
    callWall: nullable(raw.callWall, fallback.callWall),
    putWall: nullable(raw.putWall, fallback.putWall),
    pin: nullable(raw.pin ?? raw.strongestPin, fallback.pin),
    expectedMove: number(raw.expectedMove, fallback.expectedMove),
    confidence: number(
      raw.confidenceScore ?? raw.confidence,
      fallback.confidence,
    ),
    dealerPressure: number(raw.dealerPressure, fallback.dealerPressure),
    spxPressure: number(
      raw.spxDealerPressure ?? raw.spxPressure,
      fallback.spxPressure,
    ),
    spyPressure: number(
      raw.spyDealerPressure ?? raw.spyPressure,
      fallback.spyPressure,
    ),
    structure:
      "structure" in raw && raw.structure
        ? (raw.structure as MarketStructureRead)
        : raw.rows?.length
          ? buildMarketStructureRead({
              spot: number(raw.spxPrice ?? raw.spot, fallback.spot),
              rows: raw.rows,
              callWall: nullable(raw.callWall, fallback.callWall),
              putWall: nullable(raw.putWall, fallback.putWall),
              pin: nullable(raw.pin ?? raw.strongestPin, fallback.pin),
              expectedMove: number(raw.expectedMove, fallback.expectedMove),
            })
          : fallback.structure,
    strikes: raw.rows?.length ? buildStrikeBaseline(raw.rows) : fallback.strikes,
  };
}

export function buildStrikeBaseline(
  rows: ZeroDteChainRow[],
): Record<string, StrikeBaseline> {
  const map = new Map<number, StrikeBaseline>();

  for (const row of rows) {
    const strike = Math.round(row.strike / 5) * 5;
    const existing =
      map.get(strike) ??
      ({
        strike,
        callOi: 0,
        putOi: 0,
        callGamma: 0,
        putGamma: 0,
        callVolume: 0,
        putVolume: 0,
        totalScore: 0,
      } satisfies StrikeBaseline);

    const oi = safe(row.openInterest);
    const gamma = Math.abs(safe(row.gamma)) * Math.max(oi, 1) * 1000;
    const volume = safe(row.volume);

    if (row.optionType === "call") {
      existing.callOi += oi;
      existing.callGamma += gamma;
      existing.callVolume += volume;
    } else {
      existing.putOi += oi;
      existing.putGamma += gamma;
      existing.putVolume += volume;
    }

    existing.totalScore =
      existing.callOi +
      existing.putOi +
      existing.callGamma +
      existing.putGamma;

    map.set(strike, existing);
  }

  return Object.fromEntries(
    [...map.entries()].map(([strike, value]) => [String(strike), value]),
  );
}

function distance(a: number | null, b: number | null) {
  if (a == null || b == null) return 0;
  return Math.abs(a - b);
}

function number(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullable(value: unknown, fallback: number | null) {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safe(value: number | null | undefined) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function signed(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(0)}`;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
