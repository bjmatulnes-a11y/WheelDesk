import type { SpxOiMapRow, ZeroDteRecommendation } from "./zeroDteOiIntelligence";
import type { ZeroDteFlowStateRead } from "./zeroDteFlowState";
import { buildZeroDteRemainingMove } from "./zeroDteRemainingMove";

export type ZeroDtePathPoint = {
  time: number;
  center: number;
  crest: number;
  trough: number;
};

export type ZeroDteLeastResistancePath = {
  points: ZeroDtePathPoint[];
  horizonMinutes: number;
  stepMinutes: number;
  direction: "UP" | "DOWN" | "NEUTRAL";
  confidence: number;
  routeSeparationScore: number;
  flowSource: "engine" | "fallback";
  expectedMoveRemaining: number;
  expectedMoveSource: "LIVE_STRADDLE" | "TIME_AWARE_FLOOR";
  terminalCenter: number;
  terminalCrest: number;
  terminalTrough: number;
  terminalConeWidth: number;
  explanation: string[];
};

export function buildZeroDteLeastResistancePath(args: {
  recommendation: ZeroDteRecommendation;
  generatedAt: string;
  candleFrequencyMinutes: number;
  structuralMap?: {
    center: number;
    lowerWing: number;
    upperWing: number;
    callWall: number | null;
    putWall: number | null;
    pin: number | null;
  } | null;
}): ZeroDteLeastResistancePath | null {
  const { recommendation } = args;
  const spot = recommendation.spxPrice;
  const rows = recommendation.spxChainMap;
  const generatedMs = Date.parse(args.generatedAt);
  if (!Number.isFinite(spot) || !rows.length || !Number.isFinite(generatedMs)) {
    return null;
  }

  const flow = recommendation.dealerPressureRead?.flowState ?? null;
  const structuralMap = args.structuralMap ?? {
    center: recommendation.suggestedCenter,
    lowerWing: recommendation.lowerWing,
    upperWing: recommendation.upperWing,
    callWall: recommendation.spx.callWall,
    putWall: recommendation.spx.putWall,
    pin: recommendation.spx.strongestPin,
  };
  const flowSource: ZeroDteLeastResistancePath["flowSource"] = flow ? "engine" : "fallback";
  const stepMinutes = args.candleFrequencyMinutes === 1 ? 5 : 10;
  const baseHorizonMinutes = args.candleFrequencyMinutes === 1 ? 75 : 120;
  const strikeStep = inferStrikeStep(rows);
  const remaining = buildZeroDteRemainingMove({
    generatedAt: args.generatedAt,
    spot,
    liveExpectedMove: recommendation.expectedMove,
    strikeStep,
  });

  if (remaining.minutesRemaining <= stepMinutes) return null;
  const horizonMinutes = Math.min(baseHorizonMinutes, remaining.minutesRemaining);
  const steps = Math.floor(horizonMinutes / stepMinutes);
  if (steps < 2) return null;

  const expectedMove = remaining.expectedMoveRemaining;
  const radius = Math.max(expectedMove * 1.25, strikeStep * 6);
  const prices = buildPriceGrid(spot - radius, spot + radius, strikeStep);
  const maxScore = Math.max(
    1,
    rows.reduce((max, row) => Math.max(max, row.score || 0), 0),
  );

  const field = prices.map((price) =>
    terrainCost({
      price,
      spot,
      rows,
      recommendation,
      structuralMap,
      flow,
      expectedMove,
      strikeStep,
      maxScore,
    }),
  );

  const startIndex = nearestIndex(prices, spot);
  const maxTravelPerStep = travelLimit(flow, strikeStep);
  const maxIndexJump = Math.max(1, Math.round(maxTravelPerStep / strikeStep));
  const viscosity = flow?.viscosityScore ?? 50;
  const transitionWeight = 0.45 + viscosity / 85;
  const directionPush = directionalPush(flow, recommendation.dealerPressure);

  let previous = prices.map((_, index) =>
    index === startIndex ? 0 : Number.POSITIVE_INFINITY,
  );
  const parents: number[][] = [];

  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    const next = prices.map(() => Number.POSITIVE_INFINITY);
    const stepParents = prices.map(() => -1);

    for (let target = 0; target < prices.length; target += 1) {
      const targetPrice = prices[target];
      const driftReward =
        ((targetPrice - spot) / expectedMove) * directionPush * progress * 8;
      const timeCost = field[target] - driftReward;
      const fromStart = Math.max(0, target - maxIndexJump);
      const fromEnd = Math.min(prices.length - 1, target + maxIndexJump);

      for (let source = fromStart; source <= fromEnd; source += 1) {
        if (!Number.isFinite(previous[source])) continue;
        const movementPoints = Math.abs(target - source) * strikeStep;
        const normalizedMovement = movementPoints / 5;
        const reversalPenalty =
          normalizedMovement * normalizedMovement * transitionWeight;
        const candidate = previous[source] + timeCost + reversalPenalty;
        if (candidate < next[target]) {
          next[target] = candidate;
          stepParents[target] = source;
        }
      }
    }

    previous = next;
    parents.push(stepParents);
  }

  const finiteTerminal = previous
    .map((value, index) => ({ value, index }))
    .filter((item) => Number.isFinite(item.value));
  if (!finiteTerminal.length) return null;

  const rankedTerminal = [...finiteTerminal].sort((a, b) => a.value - b.value);
  const bestTerminal = rankedTerminal[0];
  if (!bestTerminal) return null;
  let endIndex = bestTerminal.index;
  const bestDirectionSign = Math.sign(prices[bestTerminal.index] - spot);
  const competingTerminal =
    rankedTerminal.find((item) => {
      if (item.index === bestTerminal.index) return false;
      const sign = Math.sign(prices[item.index] - spot);
      return sign !== bestDirectionSign || Math.abs(item.index - bestTerminal.index) >= 2;
    }) ?? rankedTerminal[1] ?? null;
  const routeCostGap = competingTerminal
    ? Math.max(0, competingTerminal.value - bestTerminal.value)
    : 0;
  const routeCostScale = Math.max(10, Math.abs(bestTerminal.value) / Math.max(steps, 1) * 0.35);
  const routeSeparationScore = clamp(
    Math.round((routeCostGap / routeCostScale) * 100),
    0,
    100,
  );
  const pathIndexes = new Array<number>(steps + 1);
  pathIndexes[steps] = endIndex;
  for (let step = steps - 1; step >= 0; step -= 1) {
    endIndex =
      parents[step][endIndex] >= 0 ? parents[step][endIndex] : endIndex;
    pathIndexes[step] = endIndex;
  }
  pathIndexes[0] = startIndex;

  const anchorTime = Math.floor(generatedMs / 1000);
  const points = pathIndexes.map((priceIndex, step) => {
    const center = prices[priceIndex];
    const bounds = localPathBounds({
      prices,
      field,
      centerIndex: priceIndex,
      expectedMove,
      flow,
      progress: step / steps,
    });
    return {
      time: anchorTime + step * stepMinutes * 60,
      center: round(center),
      crest: round(bounds.crest),
      trough: round(bounds.trough),
    };
  });

  const terminal = points.at(-1);
  if (!terminal) return null;
  const direction =
    terminal.center > spot + strikeStep
      ? "UP"
      : terminal.center < spot - strikeStep
        ? "DOWN"
        : "NEUTRAL";
  const inputConfidence = clamp(
    Math.round(
      recommendation.confidenceScore * 0.55 +
        (flow?.confidenceScore ?? 50) * 0.3 +
        recommendation.alignmentScore * 0.15,
    ),
    0,
    100,
  );
  // Confidence must reflect whether the winning route actually separates from
  // competing terminal routes; high-quality inputs alone cannot make an
  // ambiguous path "high confidence."
  const rawConfidence = clamp(
    Math.round(inputConfidence * 0.65 + routeSeparationScore * 0.35),
    0,
    100,
  );
  const confidence =
    flowSource === "fallback" ? Math.min(55, rawConfidence) : rawConfidence;

  return {
    points,
    horizonMinutes: steps * stepMinutes,
    stepMinutes,
    direction,
    confidence,
    routeSeparationScore,
    flowSource,
    expectedMoveRemaining: expectedMove,
    expectedMoveSource: remaining.source,
    terminalCenter: terminal.center,
    terminalCrest: terminal.crest,
    terminalTrough: terminal.trough,
    terminalConeWidth: round(Math.max(0, terminal.crest - terminal.trough)),
    explanation: [
      `Path minimizes cumulative strike resistance over ${steps * stepMinutes} minutes and never projects past the 15:00 CT cash close.`,
      flow
        ? `Transition speed uses measured options viscosity ${Math.round(viscosity)}.`
        : "Dealer-flow state is unavailable; fallback transition constants are in use and path confidence is capped at 55%.",
      `Remaining-move scale is ${expectedMove.toFixed(1)} points from ${remaining.source === "LIVE_STRADDLE" ? "the live ATM straddle" : "the time-aware floor"}.`,
      `Directional hose pressure contributes ${
        directionPush > 0 ? "upward" : directionPush < 0 ? "downward" : "neutral"
      } drift.`,
      `Winning-route separation is ${routeSeparationScore}/100 versus the nearest materially competing terminal route.`,
    ],
  };
}

export function scoreLeastResistanceStrike(args: {
  path: ZeroDteLeastResistancePath | null | undefined;
  side: "put" | "call";
  shortStrike: number;
}): number {
  const path = args.path;
  if (!path) return 50;
  const pathTrough = Math.min(...path.points.map((point) => point.trough));
  const pathCrest = Math.max(...path.points.map((point) => point.crest));
  const halfWidth = Math.max(path.terminalConeWidth / 2, 5);
  const insidePoints =
    args.side === "put"
      ? Math.max(0, args.shortStrike - pathTrough)
      : Math.max(0, pathCrest - args.shortStrike);
  const raw = insidePoints <= 0
    ? 100
    : clamp(100 - (insidePoints / halfWidth) * 100, 0, 100);
  const confidenceWeight = path.confidence / 100;
  return round(50 + (raw - 50) * confidenceWeight);
}

export function scoreLeastResistanceSide(args: {
  path: ZeroDteLeastResistancePath | null | undefined;
  side: "put" | "call";
}) {
  const path = args.path;
  if (!path) return 50;
  const raw =
    path.direction === "NEUTRAL"
      ? 55
      : args.side === "put"
        ? path.direction === "UP"
          ? 100
          : 0
        : path.direction === "DOWN"
          ? 100
          : 0;
  return round(50 + (raw - 50) * (path.confidence / 100));
}

export function leastResistanceThreatensShort(args: {
  path: ZeroDteLeastResistancePath | null | undefined;
  strategy: "put-credit-spread" | "call-credit-spread" | "iron-fly";
  shortStrike: number | null;
}) {
  const path = args.path;
  if (!path || args.shortStrike === null || path.confidence < 60) return false;
  if (args.strategy === "put-credit-spread") {
    return path.points.some((point) => point.trough <= args.shortStrike!);
  }
  if (args.strategy === "call-credit-spread") {
    return path.points.some((point) => point.crest >= args.shortStrike!);
  }
  return false;
}

function terrainCost(args: {
  price: number;
  spot: number;
  rows: SpxOiMapRow[];
  recommendation: ZeroDteRecommendation;
  structuralMap: {
    center: number;
    lowerWing: number;
    upperWing: number;
    callWall: number | null;
    putWall: number | null;
    pin: number | null;
  };
  flow: ZeroDteFlowStateRead | null;
  expectedMove: number;
  strikeStep: number;
  maxScore: number;
}) {
  let resistance = 0;
  let attraction = 0;

  for (const row of args.rows) {
    const distance = Math.abs(args.price - row.strike);
    const decay = Math.exp(-distance / Math.max(args.strikeStep * 2.2, 9));
    const strength = clamp((row.score || 0) / args.maxScore, 0, 1);
    const sideStrength = clamp(Math.abs(row.sideBiasPct || 0) / 100, 0, 1);

    if (row.sideBias === "call" && args.price <= row.strike) {
      resistance += strength * (0.65 + sideStrength * 0.55) * decay * 38;
    } else if (row.sideBias === "put" && args.price >= row.strike) {
      resistance += strength * (0.65 + sideStrength * 0.55) * decay * 38;
    } else {
      attraction += strength * decay * 12;
    }

    if (row.isPin) attraction += strength * decay * 28;
  }

  const centerDistance =
    Math.abs(args.price - args.structuralMap.center) / args.expectedMove;
  const pin = args.structuralMap.pin ?? args.structuralMap.center;
  const pinDistance = Math.abs(args.price - pin) / args.expectedMove;
  const wallPenalty =
    barrierPenalty(
      args.price,
      args.spot,
      args.structuralMap.callWall,
      "up",
      args.expectedMove,
    ) +
    barrierPenalty(
      args.price,
      args.spot,
      args.structuralMap.putWall,
      "down",
      args.expectedMove,
    );

  const absorption =
    args.flow?.state === "ABSORBING"
      ? 1.3
      : args.flow?.state === "AMPLIFYING"
        ? 0.72
        : 1;
  return (
    resistance * absorption +
    centerDistance * 8 +
    pinDistance * 5 +
    wallPenalty -
    attraction
  );
}

function barrierPenalty(
  price: number,
  spot: number,
  wall: number | null,
  direction: "up" | "down",
  expectedMove: number,
) {
  if (!Number.isFinite(wall)) return 0;
  const value = Number(wall);
  const crossed =
    direction === "up"
      ? price > value && spot <= value
      : price < value && spot >= value;
  if (!crossed) return 0;
  return 22 + (Math.abs(price - value) / expectedMove) * 10;
}

function localPathBounds(args: {
  prices: number[];
  field: number[];
  centerIndex: number;
  expectedMove: number;
  flow: ZeroDteFlowStateRead | null;
  progress: number;
}) {
  const centerCost = args.field[args.centerIndex];
  const stateWidth =
    args.flow?.state === "AMPLIFYING"
      ? 1.18
      : args.flow?.state === "ABSORBING"
        ? 0.68
        : args.flow?.state === "RELEASING"
          ? 1
          : 0.85;
  const maxWidth =
    args.expectedMove * (0.22 + args.progress * 0.18) * stateWidth;
  const costAllowance = 14 + (args.flow?.releaseRiskScore ?? 50) * 0.12;

  let lower = args.centerIndex;
  let upper = args.centerIndex;
  while (
    lower > 0 &&
    args.prices[args.centerIndex] - args.prices[lower - 1] <= maxWidth &&
    args.field[lower - 1] <= centerCost + costAllowance
  ) lower -= 1;
  while (
    upper < args.prices.length - 1 &&
    args.prices[upper + 1] - args.prices[args.centerIndex] <= maxWidth &&
    args.field[upper + 1] <= centerCost + costAllowance
  ) upper += 1;

  return { trough: args.prices[lower], crest: args.prices[upper] };
}

function directionalPush(
  flow: ZeroDteFlowStateRead | null,
  signedPressure: number,
) {
  const direction =
    flow?.direction ??
    (signedPressure > 15
      ? "UP"
      : signedPressure < -15
        ? "DOWN"
        : "NEUTRAL");
  const sign = direction === "UP" ? 1 : direction === "DOWN" ? -1 : 0;
  const stateMultiplier =
    flow?.state === "AMPLIFYING"
      ? 1.25
      : flow?.state === "ABSORBING"
        ? 0.35
        : flow?.state === "RELEASING"
          ? 0.9
          : 0.55;
  return (
    sign *
    clamp(Math.abs(signedPressure) / 55, 0, 1.5) *
    stateMultiplier
  );
}

function travelLimit(flow: ZeroDteFlowStateRead | null, strikeStep: number) {
  if (flow?.state === "AMPLIFYING") return strikeStep * 3;
  if (flow?.state === "RELEASING") return strikeStep * 2.2;
  if (flow?.state === "ABSORBING") return strikeStep * 1.2;
  return strikeStep * 1.7;
}

function inferStrikeStep(rows: SpxOiMapRow[]) {
  const strikes = [
    ...new Set(rows.map((row) => row.strike).filter(Number.isFinite)),
  ].sort((a, b) => a - b);
  const gaps = strikes
    .slice(1)
    .map((strike, index) => strike - strikes[index])
    .filter((gap) => gap > 0 && gap <= 25);
  if (!gaps.length) return 5;
  return Math.max(
    5,
    Math.min(10, Math.round(Math.min(...gaps) / 5) * 5),
  );
}

function buildPriceGrid(low: number, high: number, step: number) {
  const start = Math.floor(low / step) * step;
  const end = Math.ceil(high / step) * step;
  const values: number[] = [];
  for (let value = start; value <= end; value += step) values.push(value);
  return values;
}

function nearestIndex(values: number[], target: number) {
  return values.reduce((best, value, index) =>
    Math.abs(value - target) < Math.abs(values[best] - target)
      ? index
      : best,
  0);
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
