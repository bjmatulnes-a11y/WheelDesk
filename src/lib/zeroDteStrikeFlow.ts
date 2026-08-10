import type { ZeroDteChainRow, ZeroDteRecommendation } from "./zeroDteOiIntelligence";
import {
  flowConfirmationWindowMinutes,
  flowContextWindowMinutes,
  getZeroDteSessionClock,
  type ZeroDteCashSessionStatus,
} from "./zeroDteSessionClock";

export type StrikeFlowActivity = "quiet" | "building" | "active" | "extreme";
export type WallFlowState =
  | "quiet"
  | "defended"
  | "attacked"
  | "absorbed"
  | "breaking"
  | "unclear";
export type StrikeFlowMapDirection =
  | "UPPER_ACCEPTED"
  | "LOWER_ACCEPTED"
  | "UPPER_REJECTED"
  | "LOWER_REJECTED"
  | "MIXED"
  | "BUILDING"
  | "UNAVAILABLE";

export type ZeroDteStrikeFlowRow = {
  strike: number;
  callVolume: number;
  putVolume: number;

  /** Backward-compatible aliases for the official completed 1-minute delta. */
  callVolumeDelta: number;
  putVolumeDelta: number;
  totalVolumeDelta: number;

  callVolumeDelta1m: number;
  putVolumeDelta1m: number;
  totalVolumeDelta1m: number;
  callVolumeDelta5m: number;
  putVolumeDelta5m: number;
  totalVolumeDelta5m: number;
  callVolumeDeltaConfirmation: number;
  putVolumeDeltaConfirmation: number;
  totalVolumeDeltaConfirmation: number;
  callVolumeDelta15m: number;
  putVolumeDelta15m: number;
  totalVolumeDelta15m: number;
  callVolumeSinceOpen: number;
  putVolumeSinceOpen: number;
  totalVolumeSinceOpen: number;
  totalVolumeAcceleration: number;
  localFlowPercentile: number;

  callOpenInterest: number;
  putOpenInterest: number;
  callVolumeOiRatio: number | null;
  putVolumeOiRatio: number | null;
  deltaBias: "call" | "put" | "balanced";
  activity: StrikeFlowActivity;
  distanceFromSpot: number;
};

export type ZeroDteWallFlowRead = {
  strike: number | null;
  state: WallFlowState;
  /** Backward-compatible alias for official completed 1-minute delta. */
  volumeDelta: number;
  volumeDelta1m: number;
  volumeDelta5m: number;
  volumeDeltaConfirmation: number;
  volumeDelta15m: number;
  acceleration: number;
  localFlowPercentile: number;
  volumeOiRatio: number | null;
  message: string;
};

export type ZeroDteStrikeFlowRead = {
  tradeDate: string;
  generatedAt: string;
  sessionStatus: ZeroDteCashSessionStatus;
  officialThrough: string | null;
  closedMinuteKey: string | null;
  confirmationWindowMinutes: number;
  contextWindowMinutes: number;
  confirmationReady: boolean;

  previousGeneratedAt: string | null;
  elapsedMinutes: number | null;
  previousSpxPrice: number | null;
  currentSpxPrice: number;
  priceChange: number | null;
  priceChange1m: number | null;
  priceChange5m: number | null;
  priceChangeConfirmation: number | null;
  priceChange15m: number | null;

  hasPriorSnapshot: boolean;
  hasClosedMinute: boolean;

  /** Backward-compatible aliases for official completed 1-minute totals. */
  totalCallVolumeDelta: number;
  totalPutVolumeDelta: number;
  netVolumeDelta: number;

  totalCallVolumeDelta1m: number;
  totalPutVolumeDelta1m: number;
  netVolumeDelta1m: number;
  totalCallVolumeDelta5m: number;
  totalPutVolumeDelta5m: number;
  netVolumeDelta5m: number;
  totalCallVolumeDeltaConfirmation: number;
  totalPutVolumeDeltaConfirmation: number;
  netVolumeDeltaConfirmation: number;
  totalCallVolumeDelta15m: number;
  totalPutVolumeDelta15m: number;
  netVolumeDelta15m: number;
  totalCallVolumeSinceOpen: number;
  totalPutVolumeSinceOpen: number;
  netVolumeSinceOpen: number;

  mapDirection: StrikeFlowMapDirection;
  mapConfirmationScore: number;
  mapMessage: string;

  callWall: ZeroDteWallFlowRead;
  putWall: ZeroDteWallFlowRead;
  rows: ZeroDteStrikeFlowRow[];
  notes: string[];
};

export type StrikeFlowSnapshot = {
  tradeDate: string;
  generatedAt: string;
  expiration: string | null;
  spxPrice: number;
  rows: Array<{
    strike: number;
    optionType: "call" | "put";
    volume: number;
    openInterest: number;
  }>;
};

type StrikeFlowHistoryState = {
  version: 3;
  tradeDate: string;
  expiration: string | null;
  live: StrikeFlowSnapshot | null;
  sessionOpenBaseline: StrikeFlowSnapshot | null;
  minuteCloses: StrikeFlowSnapshot[];
};

type FlowReferences = {
  latest: StrikeFlowSnapshot | null;
  prior1m: StrikeFlowSnapshot | null;
  prior5m: StrikeFlowSnapshot | null;
  priorConfirmation: StrikeFlowSnapshot | null;
  prior15m: StrikeFlowSnapshot | null;
  priorPrevious1m: StrikeFlowSnapshot | null;
  sessionOpen: StrikeFlowSnapshot | null;
  confirmationWindowMinutes: number;
  contextWindowMinutes: number;
  sessionStatus: ZeroDteCashSessionStatus;
  completedMinuteCount: number;
};

const STORAGE_PREFIX = "wheeldesk.zeroDte.strikeFlow.v3";
const MAX_MINUTE_CLOSES = 40;

export function updateZeroDteStrikeFlow(args: {
  tradeDate: string;
  generatedAt: string;
  expiration?: string | null;
  spxPrice: number;
  rows: ZeroDteChainRow[];
  recommendation: ZeroDteRecommendation;
}): ZeroDteStrikeFlowRead {
  const current = toSnapshot(args);
  const history = updateHistoryState(current);
  const references = buildReferences(history, current.generatedAt);
  const read = buildReadFromReferences(
    references.latest ?? current,
    references,
    args.recommendation,
  );
  writeHistory(history);
  return read;
}

/**
 * Deterministic two-snapshot builder retained for system diagnostics/tests.
 * In the live application, updateZeroDteStrikeFlow() uses completed minute buckets.
 */
export function buildZeroDteStrikeFlowRead(
  current: StrikeFlowSnapshot,
  previous: StrikeFlowSnapshot | null,
  recommendation: ZeroDteRecommendation,
): ZeroDteStrikeFlowRead {
  const elapsed = previous
    ? Math.max(1, Math.round((Date.parse(current.generatedAt) - Date.parse(previous.generatedAt)) / 60_000))
    : 1;
  const clock = getZeroDteSessionClock(current.generatedAt);
  const references: FlowReferences = {
    latest: current,
    prior1m: previous,
    prior5m: previous,
    priorConfirmation: previous,
    prior15m: previous,
    priorPrevious1m: null,
    sessionOpen: previous,
    confirmationWindowMinutes: Math.max(1, Math.min(5, elapsed)),
    contextWindowMinutes: Math.max(5, Math.min(15, elapsed)),
    sessionStatus: clock.sessionStatus,
    completedMinuteCount: previous ? 1 : 0,
  };
  return buildReadFromReferences(current, references, recommendation);
}

function updateHistoryState(current: StrikeFlowSnapshot): StrikeFlowHistoryState {
  const clock = getZeroDteSessionClock(current.generatedAt);
  const existing = readHistory(current.tradeDate, current.expiration);
  let state: StrikeFlowHistoryState =
    existing &&
    existing.tradeDate === current.tradeDate &&
    existing.expiration === current.expiration
      ? existing
      : {
          version: 3,
          tradeDate: current.tradeDate,
          expiration: current.expiration,
          live: null,
          sessionOpenBaseline: null,
          minuteCloses: [],
        };

  if (
    clock.sessionStatus === "OPEN" &&
    !state.sessionOpenBaseline &&
    clock.minuteIndex >= 0 &&
    clock.minuteIndex <= 1
  ) {
    // "Since open" is only truthful if we actually observed the cash open. A
    // browser first opened at 11:15 CT must not relabel 11:15 as session open.
    state = { ...state, sessionOpenBaseline: current };
  }

  const previousLive = state.live;
  if (!previousLive) {
    return { ...state, live: current };
  }

  const previousTime = Date.parse(previousLive.generatedAt);
  const currentTime = Date.parse(current.generatedAt);
  if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime) || currentTime <= previousTime) {
    return state;
  }

  const previousClock = getZeroDteSessionClock(previousLive.generatedAt);
  const currentClock = getZeroDteSessionClock(current.generatedAt);
  let minuteCloses = state.minuteCloses;

  if (
    currentClock.epochMinute > previousClock.epochMinute &&
    previousClock.sessionStatus === "OPEN"
  ) {
    const priorClose = minuteCloses.at(-1);
    if (!priorClose || minuteKey(priorClose.generatedAt) !== minuteKey(previousLive.generatedAt)) {
      minuteCloses = [...minuteCloses, previousLive].slice(-MAX_MINUTE_CLOSES);
    }
  }

  return {
    ...state,
    live: current,
    minuteCloses,
  };
}

function buildReferences(
  history: StrikeFlowHistoryState,
  generatedAt: string,
): FlowReferences {
  const clock = getZeroDteSessionClock(generatedAt);
  const latest = history.minuteCloses.at(-1) ?? null;
  const confirmationWindowMinutes = flowConfirmationWindowMinutes(clock);
  const contextWindowMinutes = flowContextWindowMinutes(clock);

  return {
    latest,
    prior1m: referenceAtOrBefore(history, latest, 1),
    prior5m: referenceAtOrBefore(history, latest, 5),
    priorConfirmation: referenceAtOrBefore(
      history,
      latest,
      confirmationWindowMinutes,
    ),
    prior15m: referenceAtOrBefore(history, latest, 15),
    priorPrevious1m: referenceAtOrBefore(history, history.minuteCloses.at(-2) ?? null, 1),
    sessionOpen: history.sessionOpenBaseline,
    confirmationWindowMinutes,
    contextWindowMinutes,
    sessionStatus: clock.sessionStatus,
    completedMinuteCount: history.minuteCloses.length,
  };
}

function referenceAtOrBefore(
  history: StrikeFlowHistoryState,
  latest: StrikeFlowSnapshot | null,
  minutes: number,
) {
  if (!latest) return null;
  const target = Date.parse(latest.generatedAt) - minutes * 60_000;
  const candidate = [...history.minuteCloses]
    .reverse()
    .find((snapshot) => Date.parse(snapshot.generatedAt) <= target);
  // A missing 5m/15m reference is not "since open." Those are different
  // measurements and since-open already has its own explicit baseline. Also
  // reject an arbitrarily old snapshot after tab sleep/network gaps; otherwise
  // a 10-minute hole could be mislabeled as a 3m/5m confirmation window.
  if (!candidate) return null;
  const ageMinutes =
    (Date.parse(latest.generatedAt) - Date.parse(candidate.generatedAt)) / 60_000;
  return Number.isFinite(ageMinutes) && ageMinutes <= minutes + 1.5
    ? candidate
    : null;
}

function buildReadFromReferences(
  current: StrikeFlowSnapshot,
  refs: FlowReferences,
  recommendation: ZeroDteRecommendation,
): ZeroDteStrikeFlowRead {
  const latest = refs.latest ?? current;
  const currentMap = aggregate(latest.rows);
  const oneMap = aggregate(refs.prior1m?.rows ?? []);
  const fiveMap = aggregate(refs.prior5m?.rows ?? []);
  const confirmationMap = aggregate(refs.priorConfirmation?.rows ?? []);
  const fifteenMap = aggregate(refs.prior15m?.rows ?? []);
  const previousOneMap = aggregate(refs.priorPrevious1m?.rows ?? []);
  const openMap = aggregate(refs.sessionOpen?.rows ?? []);
  const strikes = [...currentMap.keys()].sort((a, b) => a - b);

  const raw = strikes.map((strike) => {
    const now = currentMap.get(strike) ?? emptyAggregate();
    const one = oneMap.get(strike) ?? null;
    const five = fiveMap.get(strike) ?? null;
    const confirmation = confirmationMap.get(strike) ?? null;
    const fifteen = fifteenMap.get(strike) ?? null;
    const previousOne = previousOneMap.get(strike) ?? null;
    const open = openMap.get(strike) ?? null;

    // Missing coverage is unknown, not zero. A strike that enters Schwab's
    // observation window must establish a baseline before it can contribute
    // delta-volume flow; otherwise cumulative day volume becomes fake 1m flow.
    const callVolumeDelta1m = one ? positiveDelta(now.callVolume, one.callVolume) : 0;
    const putVolumeDelta1m = one ? positiveDelta(now.putVolume, one.putVolume) : 0;
    const callVolumeDelta5m = five ? positiveDelta(now.callVolume, five.callVolume) : 0;
    const putVolumeDelta5m = five ? positiveDelta(now.putVolume, five.putVolume) : 0;
    const callVolumeDeltaConfirmation = confirmation
      ? positiveDelta(now.callVolume, confirmation.callVolume)
      : 0;
    const putVolumeDeltaConfirmation = confirmation
      ? positiveDelta(now.putVolume, confirmation.putVolume)
      : 0;
    const callVolumeDelta15m = fifteen ? positiveDelta(now.callVolume, fifteen.callVolume) : 0;
    const putVolumeDelta15m = fifteen ? positiveDelta(now.putVolume, fifteen.putVolume) : 0;
    const callVolumeSinceOpen = open ? positiveDelta(now.callVolume, open.callVolume) : 0;
    const putVolumeSinceOpen = open ? positiveDelta(now.putVolume, open.putVolume) : 0;
    const previousCall1m = one && previousOne
      ? positiveDelta(one.callVolume, previousOne.callVolume)
      : 0;
    const previousPut1m = one && previousOne
      ? positiveDelta(one.putVolume, previousOne.putVolume)
      : 0;

    return {
      strike,
      callVolume: now.callVolume,
      putVolume: now.putVolume,
      callVolumeDelta1m,
      putVolumeDelta1m,
      totalVolumeDelta1m: callVolumeDelta1m + putVolumeDelta1m,
      callVolumeDelta5m,
      putVolumeDelta5m,
      totalVolumeDelta5m: callVolumeDelta5m + putVolumeDelta5m,
      callVolumeDeltaConfirmation,
      putVolumeDeltaConfirmation,
      totalVolumeDeltaConfirmation:
        callVolumeDeltaConfirmation + putVolumeDeltaConfirmation,
      callVolumeDelta15m,
      putVolumeDelta15m,
      totalVolumeDelta15m: callVolumeDelta15m + putVolumeDelta15m,
      callVolumeSinceOpen,
      putVolumeSinceOpen,
      totalVolumeSinceOpen: callVolumeSinceOpen + putVolumeSinceOpen,
      totalVolumeAcceleration:
        callVolumeDelta1m + putVolumeDelta1m - previousCall1m - previousPut1m,
      callOpenInterest: now.callOpenInterest,
      putOpenInterest: now.putOpenInterest,
    };
  });

  const percentileValues = raw.map((row) => row.totalVolumeDelta1m);
  const rows: ZeroDteStrikeFlowRow[] = raw.map((row) => {
    const localFlowPercentile = percentileRank(
      percentileValues,
      row.totalVolumeDelta1m,
    );
    const imbalance = row.callVolumeDelta1m - row.putVolumeDelta1m;
    const biasThreshold = Math.max(10, row.totalVolumeDelta1m * 0.15);
    const activity: StrikeFlowActivity =
      !refs.prior1m || row.totalVolumeDelta1m <= 0
        ? "quiet"
        : localFlowPercentile >= 97 && row.totalVolumeDelta1m >= 25
          ? "extreme"
          : localFlowPercentile >= 85 && row.totalVolumeDelta1m >= 10
            ? "active"
            : localFlowPercentile >= 65 && row.totalVolumeDelta1m >= 5
              ? "building"
              : "quiet";

    return {
      ...row,
      callVolumeDelta: row.callVolumeDelta1m,
      putVolumeDelta: row.putVolumeDelta1m,
      totalVolumeDelta: row.totalVolumeDelta1m,
      localFlowPercentile,
      callVolumeOiRatio: ratio(row.callVolume, row.callOpenInterest),
      putVolumeOiRatio: ratio(row.putVolume, row.putOpenInterest),
      deltaBias:
        imbalance > biasThreshold
          ? "call"
          : imbalance < -biasThreshold
            ? "put"
            : "balanced",
      activity,
      distanceFromSpot: row.strike - latest.spxPrice,
    };
  });

  const priceChange1m = priceDelta(latest, refs.prior1m);
  const priceChange5m = priceDelta(latest, refs.prior5m);
  const priceChangeConfirmation = priceDelta(
    latest,
    refs.priorConfirmation,
  );
  const priceChange15m = priceDelta(latest, refs.prior15m);
  const confirmationReady = Boolean(
    refs.latest &&
      refs.prior1m &&
      refs.priorConfirmation &&
      refs.completedMinuteCount >= refs.confirmationWindowMinutes,
  );

  const callWall = classifyCallWall({
    strike: recommendation.spx.callWall,
    rows,
    previousPrice: refs.prior1m?.spxPrice ?? null,
    confirmationPrice:
      refs.priorConfirmation?.spxPrice ?? refs.prior1m?.spxPrice ?? null,
    currentPrice: latest.spxPrice,
    confirmationReady,
  });
  const putWall = classifyPutWall({
    strike: recommendation.spx.putWall,
    rows,
    previousPrice: refs.prior1m?.spxPrice ?? null,
    confirmationPrice:
      refs.priorConfirmation?.spxPrice ?? refs.prior1m?.spxPrice ?? null,
    currentPrice: latest.spxPrice,
    confirmationReady,
  });

  const totals = sumTotals(rows);
  const mapRead = buildMapDirection({
    callWall,
    putWall,
    priceChange1m,
    priceChangeConfirmation,
    confirmationReady,
  });

  const hasClosedMinute = Boolean(refs.latest);
  const hasPriorSnapshot = Boolean(refs.latest && refs.prior1m);
  const notes = buildNotes({
    latest: refs.latest,
    refs,
    confirmationReady,
  });

  return {
    tradeDate: current.tradeDate,
    generatedAt: current.generatedAt,
    sessionStatus: refs.sessionStatus,
    officialThrough: refs.latest?.generatedAt ?? null,
    closedMinuteKey: refs.latest ? minuteKey(refs.latest.generatedAt) : null,
    confirmationWindowMinutes: refs.confirmationWindowMinutes,
    contextWindowMinutes: refs.contextWindowMinutes,
    confirmationReady,

    previousGeneratedAt: refs.prior1m?.generatedAt ?? null,
    elapsedMinutes:
      refs.latest && refs.prior1m
        ? elapsedMinutes(refs.latest, refs.prior1m)
        : null,
    previousSpxPrice: refs.prior1m?.spxPrice ?? null,
    currentSpxPrice: latest.spxPrice,
    priceChange: priceChange1m,
    priceChange1m,
    priceChange5m,
    priceChangeConfirmation,
    priceChange15m,

    hasPriorSnapshot,
    hasClosedMinute,

    totalCallVolumeDelta: totals.call1m,
    totalPutVolumeDelta: totals.put1m,
    netVolumeDelta: totals.call1m - totals.put1m,
    totalCallVolumeDelta1m: totals.call1m,
    totalPutVolumeDelta1m: totals.put1m,
    netVolumeDelta1m: totals.call1m - totals.put1m,
    totalCallVolumeDelta5m: totals.call5m,
    totalPutVolumeDelta5m: totals.put5m,
    netVolumeDelta5m: totals.call5m - totals.put5m,
    totalCallVolumeDeltaConfirmation: totals.callConfirm,
    totalPutVolumeDeltaConfirmation: totals.putConfirm,
    netVolumeDeltaConfirmation: totals.callConfirm - totals.putConfirm,
    totalCallVolumeDelta15m: totals.call15m,
    totalPutVolumeDelta15m: totals.put15m,
    netVolumeDelta15m: totals.call15m - totals.put15m,
    totalCallVolumeSinceOpen: totals.callOpen,
    totalPutVolumeSinceOpen: totals.putOpen,
    netVolumeSinceOpen: totals.callOpen - totals.putOpen,

    mapDirection: mapRead.direction,
    mapConfirmationScore: mapRead.score,
    mapMessage: mapRead.message,

    callWall,
    putWall,
    rows,
    notes,
  };
}

export function classifyStrikeFlowAtLevels(args: {
  read: ZeroDteStrikeFlowRead;
  callWall: number | null;
  putWall: number | null;
}) {
  const confirmationPrice =
    args.read.priceChangeConfirmation === null
      ? args.read.previousSpxPrice
      : args.read.currentSpxPrice - args.read.priceChangeConfirmation;
  const callWall = classifyCallWall({
    strike: args.callWall,
    rows: args.read.rows,
    previousPrice: args.read.previousSpxPrice,
    confirmationPrice,
    currentPrice: args.read.currentSpxPrice,
    confirmationReady: args.read.confirmationReady,
  });
  const putWall = classifyPutWall({
    strike: args.putWall,
    rows: args.read.rows,
    previousPrice: args.read.previousSpxPrice,
    confirmationPrice,
    currentPrice: args.read.currentSpxPrice,
    confirmationReady: args.read.confirmationReady,
  });
  const map = buildMapDirection({
    callWall,
    putWall,
    priceChange1m: args.read.priceChange1m,
    priceChangeConfirmation: args.read.priceChangeConfirmation,
    confirmationReady: args.read.confirmationReady,
  });
  return { callWall, putWall, mapDirection: map.direction, mapConfirmationScore: map.score, mapMessage: map.message };
}

function classifyCallWall(args: {
  strike: number | null;
  rows: ZeroDteStrikeFlowRow[];
  previousPrice: number | null;
  confirmationPrice: number | null;
  currentPrice: number;
  confirmationReady: boolean;
}): ZeroDteWallFlowRead {
  const row = nearest(args.strike, args.rows);
  if (!args.strike || !row) {
    return wallRead(
      args.strike,
      "unclear",
      "call",
      null,
      "No call-wall flow row is available.",
    );
  }
  if (args.previousPrice === null) {
    return wallRead(
      args.strike,
      "quiet",
      "call",
      row,
      "Waiting for the first completed one-minute comparison.",
    );
  }

  const active = row.activity === "active" || row.activity === "extreme";
  const confirmed =
    args.confirmationReady && row.totalVolumeDeltaConfirmation > 0;
  const crossed =
    args.currentPrice > args.strike + 3 &&
    (args.confirmationPrice == null || args.confirmationPrice <= args.currentPrice);
  const rejected =
    args.currentPrice < args.strike &&
    args.currentPrice < args.previousPrice &&
    Math.abs(args.currentPrice - args.strike) <= 10;

  if (active && confirmed && crossed) {
    return wallRead(
      args.strike,
      "attacked",
      "call",
      row,
      "Call-wall activity is elevated and price is accepted above the wall on completed-minute flow.",
    );
  }
  if (active && confirmed && rejected) {
    return wallRead(
      args.strike,
      "defended",
      "call",
      row,
      "Call-wall activity is elevated and price rejected below the wall.",
    );
  }
  if (active) {
    return wallRead(
      args.strike,
      "unclear",
      "call",
      row,
      "One-minute call-wall flow is active; rolling confirmation is still building.",
    );
  }
  return wallRead(
    args.strike,
    "quiet",
    "call",
    row,
    "No meaningful completed-minute call-wall volume acceleration.",
  );
}

function classifyPutWall(args: {
  strike: number | null;
  rows: ZeroDteStrikeFlowRow[];
  previousPrice: number | null;
  confirmationPrice: number | null;
  currentPrice: number;
  confirmationReady: boolean;
}): ZeroDteWallFlowRead {
  const row = nearest(args.strike, args.rows);
  if (!args.strike || !row) {
    return wallRead(
      args.strike,
      "unclear",
      "put",
      null,
      "No put-wall flow row is available.",
    );
  }
  if (args.previousPrice === null) {
    return wallRead(
      args.strike,
      "quiet",
      "put",
      row,
      "Waiting for the first completed one-minute comparison.",
    );
  }

  const active = row.activity === "active" || row.activity === "extreme";
  const confirmed =
    args.confirmationReady && row.totalVolumeDeltaConfirmation > 0;
  const crossed =
    args.currentPrice < args.strike - 3 &&
    (args.confirmationPrice == null || args.confirmationPrice >= args.currentPrice);
  const bounced =
    args.currentPrice > args.strike &&
    args.currentPrice > args.previousPrice &&
    Math.abs(args.currentPrice - args.strike) <= 10;

  if (active && confirmed && crossed) {
    return wallRead(
      args.strike,
      "breaking",
      "put",
      row,
      "Put-wall activity is elevated and price is accepted below the wall on completed-minute flow.",
    );
  }
  if (active && confirmed && bounced) {
    return wallRead(
      args.strike,
      "absorbed",
      "put",
      row,
      "Put-wall activity is elevated and price reclaimed above the wall.",
    );
  }
  if (active) {
    return wallRead(
      args.strike,
      "unclear",
      "put",
      row,
      "One-minute put-wall flow is active; rolling confirmation is still building.",
    );
  }
  return wallRead(
    args.strike,
    "quiet",
    "put",
    row,
    "No meaningful completed-minute put-wall volume acceleration.",
  );
}

function buildMapDirection(args: {
  callWall: ZeroDteWallFlowRead;
  putWall: ZeroDteWallFlowRead;
  priceChange1m: number | null;
  priceChangeConfirmation: number | null;
  confirmationReady: boolean;
}): { direction: StrikeFlowMapDirection; score: number; message: string } {
  if (!args.confirmationReady) {
    return {
      direction: "BUILDING",
      score: 25,
      message: "Completed one-minute flow is available; rolling confirmation is still building.",
    };
  }

  const upScore =
    (args.callWall.state === "attacked" ? 45 : 0) +
    (args.putWall.state === "absorbed" ? 35 : 0) +
    ((args.priceChange1m ?? 0) > 0 ? 8 : 0) +
    ((args.priceChangeConfirmation ?? 0) > 0 ? 12 : 0);
  const downScore =
    (args.putWall.state === "breaking" ? 45 : 0) +
    (args.callWall.state === "defended" ? 35 : 0) +
    ((args.priceChange1m ?? 0) < 0 ? 8 : 0) +
    ((args.priceChangeConfirmation ?? 0) < 0 ? 12 : 0);

  if (upScore >= 55 && upScore >= downScore + 15) {
    return {
      direction: "UPPER_ACCEPTED",
      score: Math.min(100, upScore),
      message: "Rolling strike-volume flow and price response support upper-map acceptance.",
    };
  }
  if (downScore >= 55 && downScore >= upScore + 15) {
    return {
      direction: "LOWER_ACCEPTED",
      score: Math.min(100, downScore),
      message: "Rolling strike-volume flow and price response support lower-map acceptance.",
    };
  }
  if (args.callWall.state === "defended") {
    return {
      direction: "UPPER_REJECTED",
      score: Math.min(100, downScore),
      message: "Call-wall flow is rejecting the upper migration.",
    };
  }
  if (args.putWall.state === "absorbed") {
    return {
      direction: "LOWER_REJECTED",
      score: Math.min(100, upScore),
      message: "Put-wall flow is rejecting the lower migration.",
    };
  }
  return {
    direction: "MIXED",
    score: Math.max(upScore, downScore),
    message: "Completed-minute strike flow is mixed or not concentrated enough to confirm migration.",
  };
}

function wallRead(
  strike: number | null,
  state: WallFlowState,
  side: "call" | "put",
  row: ZeroDteStrikeFlowRow | null,
  message: string,
): ZeroDteWallFlowRead {
  const volumeDelta1m = row
    ? side === "call"
      ? row.callVolumeDelta1m
      : row.putVolumeDelta1m
    : 0;
  const volumeDelta5m = row
    ? side === "call"
      ? row.callVolumeDelta5m
      : row.putVolumeDelta5m
    : 0;
  const volumeDeltaConfirmation = row
    ? side === "call"
      ? row.callVolumeDeltaConfirmation
      : row.putVolumeDeltaConfirmation
    : 0;
  const volumeDelta15m = row
    ? side === "call"
      ? row.callVolumeDelta15m
      : row.putVolumeDelta15m
    : 0;
  const volumeOiRatio = row
    ? side === "call"
      ? row.callVolumeOiRatio
      : row.putVolumeOiRatio
    : null;

  return {
    strike,
    state,
    volumeDelta: volumeDelta1m,
    volumeDelta1m,
    volumeDelta5m,
    volumeDeltaConfirmation,
    volumeDelta15m,
    acceleration: row?.totalVolumeAcceleration ?? 0,
    localFlowPercentile: row?.localFlowPercentile ?? 0,
    volumeOiRatio,
    message,
  };
}

function buildNotes(args: {
  latest: StrikeFlowSnapshot | null;
  refs: FlowReferences;
  confirmationReady: boolean;
}) {
  if (!args.latest) {
    return [
      "Collecting five-second Schwab snapshots. The first official delta prints after a one-minute candle closes.",
      "OI defines the structural map; completed-minute delta volume confirms acceptance, defense, absorption, or break.",
    ];
  }

  const notes = [
    `Official flow is closed through ${args.latest.generatedAt}.`,
    `Primary trigger: completed 1-minute delta volume. Confirmation: rolling ${args.refs.confirmationWindowMinutes}-minute flow. Context: ${args.refs.contextWindowMinutes}-minute and since-open flow.`,
    "Five-second harvests collect data only; they do not directly confirm a map transition.",
    "Delta volume identifies where activity occurred. Price and premium response determine whether the level was accepted or rejected.",
  ];
  if (!args.confirmationReady) {
    notes.push("The rolling confirmation window is still building.");
  }
  if (args.refs.sessionStatus === "CLOSED") {
    notes.push("The cash session is closed. The last completed-minute flow is frozen for end-of-day review.");
  }
  return notes;
}

function sumTotals(rows: ZeroDteStrikeFlowRow[]) {
  return rows.reduce(
    (sum, row) => ({
      call1m: sum.call1m + row.callVolumeDelta1m,
      put1m: sum.put1m + row.putVolumeDelta1m,
      call5m: sum.call5m + row.callVolumeDelta5m,
      put5m: sum.put5m + row.putVolumeDelta5m,
      callConfirm:
        sum.callConfirm + row.callVolumeDeltaConfirmation,
      putConfirm:
        sum.putConfirm + row.putVolumeDeltaConfirmation,
      call15m: sum.call15m + row.callVolumeDelta15m,
      put15m: sum.put15m + row.putVolumeDelta15m,
      callOpen: sum.callOpen + row.callVolumeSinceOpen,
      putOpen: sum.putOpen + row.putVolumeSinceOpen,
    }),
    {
      call1m: 0,
      put1m: 0,
      call5m: 0,
      put5m: 0,
      callConfirm: 0,
      putConfirm: 0,
      call15m: 0,
      put15m: 0,
      callOpen: 0,
      putOpen: 0,
    },
  );
}

function toSnapshot(args: {
  tradeDate: string;
  generatedAt: string;
  expiration?: string | null;
  spxPrice: number;
  rows: ZeroDteChainRow[];
}): StrikeFlowSnapshot {
  return {
    tradeDate: args.tradeDate,
    generatedAt: args.generatedAt,
    expiration: args.expiration ?? null,
    spxPrice: args.spxPrice,
    rows: args.rows.map((row) => ({
      strike: row.strike,
      optionType: row.optionType,
      volume: finite(row.volume),
      openInterest: finite(row.openInterest),
    })),
  };
}

function aggregate(rows: StrikeFlowSnapshot["rows"]) {
  const map = new Map<number, ReturnType<typeof emptyAggregate>>();
  for (const row of rows) {
    const strike = Math.round(row.strike / 5) * 5;
    const value = map.get(strike) ?? emptyAggregate();
    if (row.optionType === "call") {
      value.callVolume += row.volume;
      value.callOpenInterest += row.openInterest;
    } else {
      value.putVolume += row.volume;
      value.putOpenInterest += row.openInterest;
    }
    map.set(strike, value);
  }
  return map;
}

function emptyAggregate() {
  return {
    callVolume: 0,
    putVolume: 0,
    callOpenInterest: 0,
    putOpenInterest: 0,
  };
}

function nearest(strike: number | null, rows: ZeroDteStrikeFlowRow[]) {
  if (!strike || !rows.length) return null;
  return (
    [...rows].sort(
      (a, b) =>
        Math.abs(a.strike - strike) - Math.abs(b.strike - strike),
    )[0] ?? null
  );
}

function ratio(volume: number, openInterest: number) {
  return openInterest > 0 ? volume / openInterest : volume > 0 ? null : 0;
}

function positiveDelta(now: number, before: number) {
  if (now < before) return 0;
  return Math.max(0, now - before);
}

function priceDelta(
  current: StrikeFlowSnapshot,
  previous: StrikeFlowSnapshot | null,
) {
  return previous ? current.spxPrice - previous.spxPrice : null;
}

function elapsedMinutes(
  current: StrikeFlowSnapshot,
  previous: StrikeFlowSnapshot,
) {
  return Math.max(
    0,
    (Date.parse(current.generatedAt) - Date.parse(previous.generatedAt)) /
      60_000,
  );
}

function percentileRank(values: number[], value: number) {
  if (!values.length || value <= 0) return 0;
  const belowOrEqual = values.filter((item) => item <= value).length;
  return Math.round((belowOrEqual / values.length) * 100);
}

function minuteKey(generatedAt: string) {
  const timestamp = Date.parse(generatedAt);
  return Number.isFinite(timestamp)
    ? String(Math.floor(timestamp / 60_000))
    : generatedAt.slice(0, 16);
}

function finite(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function storageKey(tradeDate: string, expiration: string | null) {
  return `${STORAGE_PREFIX}.${tradeDate}.${expiration ?? "none"}`;
}

function readHistory(
  tradeDate: string,
  expiration: string | null,
): StrikeFlowHistoryState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(tradeDate, expiration));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StrikeFlowHistoryState>;
    if (parsed.version !== 3 || !Array.isArray(parsed.minuteCloses)) return null;
    return parsed as StrikeFlowHistoryState;
  } catch {
    return null;
  }
}

function writeHistory(state: StrikeFlowHistoryState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      storageKey(state.tradeDate, state.expiration),
      JSON.stringify(state),
    );
  } catch {
    // Flow is an enhancement. A storage failure must not block the harvest.
  }
}
