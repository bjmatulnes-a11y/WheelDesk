import type { CreditSpreadRiskMode } from "./zeroDteCreditSpreadSelector";

export type ZeroDteEventRisk = "NORMAL" | "HIGH";

export type ZeroDteRiskPolicy = {
  riskMode: CreditSpreadRiskMode;
  maxRiskPerTradeDollars: number | null;
  grossRiskBudgetDollars: number;
  dailyLossLimitDollars: number | null;
  minSellableCredit: number;
  minWidth: number;
  maxWidth: number;
  shortDeltaMax: number;
  minimumAbsoluteDistancePoints: number;
  minimumAbsoluteDistanceSpotPct: number;
  eventRisk: ZeroDteEventRisk;
  strictZeroDte: true;
};

export type ZeroDteVolContext = {
  openingExpectedMove: number | null;
  directionalMovePoints: number | null;
  directionalMoveConsumptionPct: number | null;
  sessionRangePoints: number | null;
  rangeConsumptionPct: number | null;
  regime: "UNAVAILABLE" | "COLD" | "NORMAL" | "HOT" | "EXTREME";
};

const STORAGE_KEY = "wheeldesk:zero-dte:risk-policy:v1";

export const DEFAULT_ZERO_DTE_RISK_POLICY: ZeroDteRiskPolicy = {
  riskMode: "balanced",
  maxRiskPerTradeDollars: 750,
  grossRiskBudgetDollars: 5000,
  dailyLossLimitDollars: null,
  minSellableCredit: 0.25,
  minWidth: 5,
  maxWidth: 50,
  shortDeltaMax: 0.2,
  minimumAbsoluteDistancePoints: 15,
  minimumAbsoluteDistanceSpotPct: 0.0022,
  eventRisk: "NORMAL",
  strictZeroDte: true,
};

export function loadZeroDteRiskPolicy(): ZeroDteRiskPolicy {
  if (typeof window === "undefined") return DEFAULT_ZERO_DTE_RISK_POLICY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ZERO_DTE_RISK_POLICY;
    return normalizeZeroDteRiskPolicy(JSON.parse(raw));
  } catch {
    return DEFAULT_ZERO_DTE_RISK_POLICY;
  }
}

export function saveZeroDteRiskPolicy(policy: ZeroDteRiskPolicy) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(policy));
  } catch {
    // Risk policy remains active in React state when localStorage is blocked.
  }
}

export function normalizeZeroDteRiskPolicy(
  value: Partial<ZeroDteRiskPolicy> | null | undefined,
): ZeroDteRiskPolicy {
  const riskMode =
    value?.riskMode === "conservative" ||
    value?.riskMode === "aggressive" ||
    value?.riskMode === "balanced"
      ? value.riskMode
      : DEFAULT_ZERO_DTE_RISK_POLICY.riskMode;

  const minWidth = positive(
    value?.minWidth,
    DEFAULT_ZERO_DTE_RISK_POLICY.minWidth,
    5,
  );
  const maxWidth = Math.max(
    minWidth,
    positive(value?.maxWidth, DEFAULT_ZERO_DTE_RISK_POLICY.maxWidth, 5),
  );

  return {
    riskMode,
    maxRiskPerTradeDollars: nullablePositive(
      value?.maxRiskPerTradeDollars,
      DEFAULT_ZERO_DTE_RISK_POLICY.maxRiskPerTradeDollars,
    ),
    grossRiskBudgetDollars: positive(
      value?.grossRiskBudgetDollars,
      DEFAULT_ZERO_DTE_RISK_POLICY.grossRiskBudgetDollars,
      500,
    ),
    dailyLossLimitDollars: nullablePositive(value?.dailyLossLimitDollars, null),
    minSellableCredit: nonNegative(
      value?.minSellableCredit,
      DEFAULT_ZERO_DTE_RISK_POLICY.minSellableCredit,
    ),
    minWidth,
    maxWidth,
    shortDeltaMax: clamp(
      finite(value?.shortDeltaMax) ?? deltaMaxForMode(riskMode),
      0.05,
      0.45,
    ),
    minimumAbsoluteDistancePoints: positive(
      value?.minimumAbsoluteDistancePoints,
      DEFAULT_ZERO_DTE_RISK_POLICY.minimumAbsoluteDistancePoints,
      1,
    ),
    minimumAbsoluteDistanceSpotPct: clamp(
      finite(value?.minimumAbsoluteDistanceSpotPct) ??
        DEFAULT_ZERO_DTE_RISK_POLICY.minimumAbsoluteDistanceSpotPct,
      0,
      0.02,
    ),
    eventRisk: value?.eventRisk === "HIGH" ? "HIGH" : "NORMAL",
    strictZeroDte: true,
  };
}

export function deltaMaxForMode(mode: CreditSpreadRiskMode) {
  if (mode === "conservative") return 0.12;
  if (mode === "aggressive") return 0.25;
  return 0.2;
}

export function absoluteDistanceFloorPoints(
  policy: ZeroDteRiskPolicy,
  spot: number,
) {
  return Math.max(
    policy.minimumAbsoluteDistancePoints,
    Math.max(0, spot) * policy.minimumAbsoluteDistanceSpotPct,
  );
}

export function eventRiskScoreAdjustment(policy: ZeroDteRiskPolicy) {
  return policy.eventRisk === "HIGH" ? 6 : 0;
}

export function eventRiskSizeMultiplier(policy: ZeroDteRiskPolicy) {
  return policy.eventRisk === "HIGH" ? 0.5 : 1;
}

export function volContextScoreAdjustment(context: ZeroDteVolContext | null) {
  if (!context?.rangeConsumptionPct) return 0;
  if (context.rangeConsumptionPct >= 150) return 6;
  if (context.rangeConsumptionPct >= 110) return 4;
  return 0;
}

export function volContextSizeMultiplier(context: ZeroDteVolContext | null) {
  if (!context?.rangeConsumptionPct) return 1;
  if (context.rangeConsumptionPct >= 150) return 0.6;
  if (context.rangeConsumptionPct >= 110) return 0.75;
  return 1;
}

export function buildZeroDteVolContext(args: {
  openingSpot?: number | null;
  openingExpectedMove?: number | null;
  currentSpot?: number | null;
  sessionHigh?: number | null;
  sessionLow?: number | null;
}): ZeroDteVolContext {
  const openingExpectedMove = positiveOrNull(args.openingExpectedMove);
  const openingSpot = positiveOrNull(args.openingSpot);
  const currentSpot = positiveOrNull(args.currentSpot);
  const sessionHigh = positiveOrNull(args.sessionHigh);
  const sessionLow = positiveOrNull(args.sessionLow);

  const directionalMovePoints =
    openingSpot !== null && currentSpot !== null
      ? Math.abs(currentSpot - openingSpot)
      : null;
  const sessionRangePoints =
    sessionHigh !== null && sessionLow !== null && sessionHigh >= sessionLow
      ? sessionHigh - sessionLow
      : null;
  const directionalMoveConsumptionPct =
    directionalMovePoints !== null && openingExpectedMove !== null
      ? (directionalMovePoints / openingExpectedMove) * 100
      : null;
  const rangeConsumptionPct =
    sessionRangePoints !== null && openingExpectedMove !== null
      ? (sessionRangePoints / openingExpectedMove) * 100
      : null;

  const regime =
    rangeConsumptionPct === null
      ? "UNAVAILABLE"
      : rangeConsumptionPct < 45
        ? "COLD"
        : rangeConsumptionPct < 110
          ? "NORMAL"
          : rangeConsumptionPct < 150
            ? "HOT"
            : "EXTREME";

  return {
    openingExpectedMove,
    directionalMovePoints,
    directionalMoveConsumptionPct,
    sessionRangePoints,
    rangeConsumptionPct,
    regime,
  };
}

function finite(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function positiveOrNull(value: unknown) {
  const numeric = finite(value);
  return numeric !== null && numeric > 0 ? numeric : null;
}

function positive(value: unknown, fallback: number, minimum: number) {
  const numeric = finite(value);
  return numeric !== null && numeric >= minimum ? numeric : fallback;
}

function nonNegative(value: unknown, fallback: number) {
  const numeric = finite(value);
  return numeric !== null && numeric >= 0 ? numeric : fallback;
}

function nullablePositive(value: unknown, fallback: number | null) {
  if (value === null || value === undefined || value === "") return fallback;
  const numeric = finite(value);
  return numeric !== null && numeric > 0 ? numeric : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
