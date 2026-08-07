import { getZeroDteSessionClock } from "./zeroDteSessionClock";
export type ZeroDteTimeRegime =
  | "PREMARKET"
  | "OPENING_OPPORTUNITY"
  | "SELECTIVE_CONTINUATION"
  | "EXHAUSTION"
  | "FINAL_ENTRY"
  | "CLOSED";

export type ZeroDteTimeRegimeRead = {
  regime: ZeroDteTimeRegime;
  label: string;
  centralTime: string;
  minutesFromOpen: number;
  entryAllowed: boolean;
  newRiskPreferred: boolean;
  requiresPeakRollover: boolean;
  minimumEntryScore: number;
  minimumDistanceExpectedMovePct: number;
  sizeMultiplier: number;
  weights: {
    distance: number;
    structure: number;
    dealerFlow: number;
    premiumExhaustion: number;
    portfolio: number;
  };
  reasons: string[];
};

export type ZeroDtePriceActionContext = {
  open: number;
  last: number;
  previous: number;
  recentHigh: number;
  recentLow: number;
  changeFromOpen: number;
  changeFromOpenPct: number;
  distanceFromHigh: number;
  distanceFromLow: number;
  lastCandleChange: number;
  lastThreeChange: number;
  candlesSinceHigh: number;
  candlesSinceLow: number;
};

type CandleLike = {
  open: number;
  high: number;
  low: number;
  close: number;
};

const CENTRAL_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function classifyZeroDteTimeRegime(args: {
  generatedAt: string;
  hasEnteredToday: boolean;
}): ZeroDteTimeRegimeRead {
  const date = new Date(args.generatedAt);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const clockMinutes = hour * 60 + minute;
  const open = 8 * 60 + 30;
  const minutesFromOpen = clockMinutes - open;
  const centralTime = CENTRAL_TIME.format(date);
  const sessionClock = getZeroDteSessionClock(args.generatedAt);

  if (!sessionClock.isTradingWeekday) {
    return makeRead({
      regime: "CLOSED",
      label: "Market closed",
      centralTime,
      minutesFromOpen,
      entryAllowed: false,
      newRiskPreferred: false,
      requiresPeakRollover: false,
      minimumEntryScore: 100,
      minimumDistanceExpectedMovePct: 1,
      sizeMultiplier: 0,
      weights: [30, 25, 20, 15, 10],
      reasons: ["SPX 0DTE entries are disabled on weekends."],
    });
  }

  if (clockMinutes < open) {
    return makeRead({
      regime: "PREMARKET",
      label: "Premarket",
      centralTime,
      minutesFromOpen,
      entryAllowed: false,
      newRiskPreferred: false,
      requiresPeakRollover: false,
      minimumEntryScore: 100,
      minimumDistanceExpectedMovePct: 1,
      sizeMultiplier: 0,
      weights: [30, 25, 20, 15, 10],
      reasons: ["The regular SPX cash session has not opened."],
    });
  }

  if (clockMinutes < 10 * 60 + 30) {
    return makeRead({
      regime: "OPENING_OPPORTUNITY",
      label: "Opening opportunity",
      centralTime,
      minutesFromOpen,
      entryAllowed: true,
      newRiskPreferred: true,
      requiresPeakRollover: true,
      minimumEntryScore: 78,
      minimumDistanceExpectedMovePct: 0.75,
      sizeMultiplier: 1,
      weights: [30, 25, 20, 15, 10],
      reasons: [
        "8:30–10:30 CT is the primary probability window, but entry still requires a confirmed local premium crest.",
        "Short-strike distance and controlling structure receive the highest weight after the exhaustion trigger is proven.",
      ],
    });
  }

  if (clockMinutes < 12 * 60) {
    return makeRead({
      regime: "SELECTIVE_CONTINUATION",
      label: "Selective continuation",
      centralTime,
      minutesFromOpen,
      entryAllowed: true,
      newRiskPreferred: !args.hasEnteredToday,
      requiresPeakRollover: true,
      minimumEntryScore: 82,
      minimumDistanceExpectedMovePct: 0.65,
      sizeMultiplier: args.hasEnteredToday ? 0.65 : 0.8,
      weights: [20, 25, 20, 20, 15],
      reasons: [
        "10:30–12:00 CT requires a fresh premium expansion followed by closed-minute rollover confirmation.",
        args.hasEnteredToday
          ? "Existing positions reduce the preferred size of additional risk."
          : "No position has been entered, so one selective continuation setup remains available.",
      ],
    });
  }

  if (clockMinutes < 14 * 60 + 30) {
    return makeRead({
      regime: "EXHAUSTION",
      label: "Exhaustion mode",
      centralTime,
      minutesFromOpen,
      entryAllowed: true,
      newRiskPreferred: !args.hasEnteredToday,
      requiresPeakRollover: true,
      minimumEntryScore: args.hasEnteredToday ? 88 : 84,
      minimumDistanceExpectedMovePct: 0.35,
      sizeMultiplier: args.hasEnteredToday ? 0.4 : 0.6,
      weights: [5, 25, 20, 35, 15],
      reasons: [
        "After noon, entries must be centered on exhaustion and premium rollover.",
        args.hasEnteredToday
          ? "Portfolio improvement is required before adding another spread."
          : "Because no trade has been entered, a confirmed exhaustion setup may still qualify.",
      ],
    });
  }

  if (clockMinutes < 15 * 60) {
    return makeRead({
      regime: "FINAL_ENTRY",
      label: "Final-entry restriction",
      centralTime,
      minutesFromOpen,
      entryAllowed: !args.hasEnteredToday,
      newRiskPreferred: false,
      requiresPeakRollover: true,
      minimumEntryScore: 92,
      minimumDistanceExpectedMovePct: 0.25,
      sizeMultiplier: 0.25,
      weights: [5, 25, 20, 40, 10],
      reasons: [
        args.hasEnteredToday
          ? "New risk is blocked after 2:30 PM CT because the portfolio already has session exposure."
          : "A first trade may qualify only with exceptional exhaustion confirmation.",
      ],
    });
  }

  return makeRead({
    regime: "CLOSED",
    label: "Session closed",
    centralTime,
    minutesFromOpen,
    entryAllowed: false,
    newRiskPreferred: false,
    requiresPeakRollover: false,
    minimumEntryScore: 100,
    minimumDistanceExpectedMovePct: 1,
    sizeMultiplier: 0,
    weights: [30, 25, 20, 15, 10],
    reasons: ["The SPX cash session is closed."],
  });
}

export function buildZeroDtePriceActionContext(
  candles: CandleLike[],
): ZeroDtePriceActionContext | null {
  if (!candles.length) return null;
  const first = candles[0];
  const last = candles.at(-1)!;
  const previous = candles.at(-2) ?? last;
  const recent = candles.slice(-30);
  const recentHigh = Math.max(...recent.map((candle) => candle.high));
  const recentLow = Math.min(...recent.map((candle) => candle.low));
  let highIndex = -1;
  let lowIndex = -1;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    if (highIndex < 0 && recent[index].high === recentHigh) highIndex = index;
    if (lowIndex < 0 && recent[index].low === recentLow) lowIndex = index;
    if (highIndex >= 0 && lowIndex >= 0) break;
  }
  const thirdBack = candles.at(-4) ?? first;

  return {
    open: first.open,
    last: last.close,
    previous: previous.close,
    recentHigh,
    recentLow,
    changeFromOpen: last.close - first.open,
    changeFromOpenPct:
      first.open > 0 ? ((last.close - first.open) / first.open) * 100 : 0,
    distanceFromHigh: recentHigh - last.close,
    distanceFromLow: last.close - recentLow,
    lastCandleChange: last.close - previous.close,
    lastThreeChange: last.close - thirdBack.close,
    candlesSinceHigh: highIndex < 0 ? recent.length : recent.length - 1 - highIndex,
    candlesSinceLow: lowIndex < 0 ? recent.length : recent.length - 1 - lowIndex,
  };
}

export function scorePriceExhaustion(args: {
  strategy: "iron-fly" | "put-credit-spread" | "call-credit-spread";
  priceAction: ZeroDtePriceActionContext | null;
  referenceCenter?: number | null;
}): number {
  const { strategy, priceAction } = args;
  if (!priceAction) return 0;

  if (strategy === "iron-fly") {
    const center =
      args.referenceCenter !== null &&
      args.referenceCenter !== undefined &&
      Number.isFinite(args.referenceCenter)
        ? Number(args.referenceCenter)
        : priceAction.open;
    const currentDistance = Math.abs(priceAction.last - center);
    const previousDistance = Math.abs(priceAction.previous - center);
    const movingTowardCenter = currentDistance < previousDistance;
    const threeBarTowardCenter =
      priceAction.last >= center
        ? priceAction.lastThreeChange < 0
        : priceAction.lastThreeChange > 0;
    const relevantRetracement =
      priceAction.last >= center
        ? priceAction.distanceFromHigh
        : priceAction.distanceFromLow;
    const relevantExtremeAge =
      priceAction.last >= center
        ? priceAction.candlesSinceHigh
        : priceAction.candlesSinceLow;

    let score = 22;
    if (movingTowardCenter) score += 30;
    if (threeBarTowardCenter) score += 22;
    if (relevantExtremeAge >= 1) score += 14;
    score += Math.min(12, relevantRetracement * 2);
    return clamp(score);
  }

  const isPut = strategy === "put-credit-spread";
  const oneBarReversal = isPut
    ? priceAction.lastCandleChange > 0
    : priceAction.lastCandleChange < 0;
  const threeBarReversal = isPut
    ? priceAction.lastThreeChange > 0
    : priceAction.lastThreeChange < 0;
  const distanceFromThreatExtreme = isPut
    ? priceAction.distanceFromLow
    : priceAction.distanceFromHigh;
  const candlesSinceThreatExtreme = isPut
    ? priceAction.candlesSinceLow
    : priceAction.candlesSinceHigh;

  let score = 18;
  if (oneBarReversal) score += 28;
  if (threeBarReversal) score += 22;
  if (candlesSinceThreatExtreme >= 1) score += 18;
  score += Math.min(18, distanceFromThreatExtreme * 2.5);
  return clamp(score);
}

function makeRead(args: {
  regime: ZeroDteTimeRegime;
  label: string;
  centralTime: string;
  minutesFromOpen: number;
  entryAllowed: boolean;
  newRiskPreferred: boolean;
  requiresPeakRollover: boolean;
  minimumEntryScore: number;
  minimumDistanceExpectedMovePct: number;
  sizeMultiplier: number;
  weights: [number, number, number, number, number];
  reasons: string[];
}): ZeroDteTimeRegimeRead {
  return {
    ...args,
    weights: {
      distance: args.weights[0],
      structure: args.weights[1],
      dealerFlow: args.weights[2],
      premiumExhaustion: args.weights[3],
      portfolio: args.weights[4],
    },
  };
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}
