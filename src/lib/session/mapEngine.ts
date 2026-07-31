import type { ZeroDteChainRow, ZeroDteRecommendation } from "../zeroDteOiIntelligence";

export type SessionMapState = "OPENING" | "TRANSITION" | "ACTIVE";

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
  opening: MarketMapSnapshot;
  candidate: MarketMapSnapshot | null;
  active: MarketMapSnapshot;
  confirmationCount: number;
  confirmationRequired: number;
  railBreached: "UPPER" | "LOWER" | "NONE";
  outsideMinutes: number;
  reasons: string[];
  events: MapTransitionEvent[];
};

export type ExistingOpenMapLike = Partial<{
  tradeDate: string;
  generatedAt: string;
  capturedAt: string;
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
  rows: ZeroDteChainRow[];
}>;

const key = (tradeDate: string) => `wheeldesk:session-map-manager:${tradeDate}`;
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
    strikes: buildStrikeBaseline(rows),
  };
}

export function initializeSessionMapManager(
  live: MarketMapSnapshot,
): SessionMapManagerState {
  const stored = loadSessionMapManager(live.tradeDate);
  if (stored) return stored;

  const existingOpenMap = loadExistingOpenMap(live.tradeDate);
  const opening = existingOpenMap
    ? normalizeExistingOpenMap(existingOpenMap, live)
    : { ...live, source: "first-live-fallback" as const };

  const initial: SessionMapManagerState = {
    tradeDate: live.tradeDate,
    phase: "OPENING",
    opening,
    candidate: null,
    active: opening,
    confirmationCount: 0,
    confirmationRequired: 5,
    railBreached: "NONE",
    outsideMinutes: 0,
    reasons: [
      existingOpenMap
        ? "Opening baseline loaded from the saved Open Map build."
        : "Saved Open Map was unavailable; first valid live snapshot is the fallback baseline.",
    ],
    events: [],
  };

  saveSessionMapManager(initial);
  return initial;
}

export function updateSessionMapManager(
  previous: SessionMapManagerState,
  live: MarketMapSnapshot,
): SessionMapManagerState {
  const opening = previous.opening;
  const reference = previous.phase === "ACTIVE" ? previous.active : opening;

  const railBreached =
    live.spot > reference.upperWing
      ? "UPPER"
      : live.spot < reference.lowerWing
        ? "LOWER"
        : "NONE";

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

  const confidenceConfirms = live.confidence >= 48;
  const candidateStable =
    !previous.candidate ||
    (Math.abs(live.center - previous.candidate.center) <= 10 &&
      distance(live.callWall, previous.candidate.callWall) <= 15 &&
      distance(live.putWall, previous.candidate.putWall) <= 15);

  const transitionSignal =
    railBreached !== "NONE" &&
    structuralShift &&
    confidenceConfirms &&
    (pressureConfirms || Math.abs(live.spot - reference.center) >= Math.max(20, live.expectedMove * 0.45));

  const elapsedMinutes = previous.candidate
    ? Math.max(
        0,
        (Date.parse(live.capturedAt) - Date.parse(previous.candidate.capturedAt)) /
          60_000,
      )
    : 0;

  let next: SessionMapManagerState = {
    ...previous,
    railBreached,
    outsideMinutes:
      railBreached === "NONE"
        ? 0
        : Math.max(previous.outsideMinutes, elapsedMinutes),
  };

  if (!transitionSignal) {
    if (previous.phase === "TRANSITION") {
      next = {
        ...next,
        phase: previous.confirmationCount >= 3 ? "TRANSITION" : "OPENING",
        candidate:
          previous.confirmationCount >= 3 ? previous.candidate : null,
        confirmationCount: Math.max(0, previous.confirmationCount - 1),
        reasons: [
          "Candidate map lost one confirmation because price or structure moved back inside the controlling rails.",
        ],
      };
    } else {
      next = {
        ...next,
        reasons: ["Current structure remains inside the controlling map."],
      };
    }

    saveSessionMapManager(next);
    return next;
  }

  const confirmationCount = candidateStable
    ? Math.min(previous.confirmationRequired, previous.confirmationCount + 1)
    : 1;

  const candidate = candidateStable && previous.candidate
    ? {
        ...live,
        capturedAt: previous.candidate.capturedAt,
      }
    : live;

  const reasons = [
    `${railBreached.toLowerCase()} controlling rail breached.`,
    `Center shifted ${signed(live.center - reference.center)} points.`,
    `Wall/pin structure shifted materially.`,
    pressureConfirms
      ? "Dealer pressure confirms the direction of migration."
      : "Price displacement is large enough to keep the candidate active without full pressure confirmation.",
    `Candidate confirmation ${confirmationCount}/${previous.confirmationRequired}.`,
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
      confirmationCount: 0,
      reasons: [
        "A replacement map is now active.",
        ...reasons.slice(0, 4),
      ],
      events: [...previous.events, event].slice(-40),
    };
  } else {
    const enteringTransition = previous.phase !== "TRANSITION";
    next = {
      ...next,
      phase: "TRANSITION",
      candidate,
      confirmationCount,
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
            },
          ].slice(-40)
        : previous.events,
    };
  }

  saveSessionMapManager(next);
  return next;
}

export function loadSessionMapManager(
  tradeDate: string,
): SessionMapManagerState | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key(tradeDate)) ?? "null");
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
      const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
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
      raw.generatedAt ?? raw.capturedAt ?? fallback.capturedAt,
    source: "open-map",
    spot: number(raw.spxPrice ?? raw.spot, fallback.spot),
    center,
    lowerWing,
    upperWing,
    callWall: nullable(raw.callWall, fallback.callWall),
    putWall: nullable(raw.putWall, fallback.putWall),
    pin: nullable(raw.pin ?? raw.strongestPin, fallback.pin),
    expectedMove: number(raw.expectedMove, fallback.expectedMove),
    confidence: number(raw.confidenceScore ?? raw.confidence, fallback.confidence),
    dealerPressure: number(raw.dealerPressure, fallback.dealerPressure),
    spxPressure: number(raw.spxDealerPressure, fallback.spxPressure),
    spyPressure: number(raw.spyDealerPressure, fallback.spyPressure),
    strikes:
      raw.rows?.length
        ? buildStrikeBaseline(raw.rows)
        : fallback.strikes,
  };
}

function buildStrikeBaseline(
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
      existing.putGamma +
      (existing.callVolume + existing.putVolume) * 0.18;

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
