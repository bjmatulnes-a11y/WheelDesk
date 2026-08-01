import type { SpxOiMapRow, ZeroDteRecommendation } from "./zeroDteOiIntelligence";
import type { ZeroDteFlowStateRead } from "./zeroDteFlowState";

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
  explanation: string[];
};

export function buildZeroDteLeastResistancePath(args: {
  recommendation: ZeroDteRecommendation;
  lastCandleTime: number;
  candleFrequencyMinutes: number;
}): ZeroDteLeastResistancePath | null {
  const { recommendation } = args;
  const spot = recommendation.spxPrice;
  const rows = recommendation.spxChainMap;
  if (!Number.isFinite(spot) || !rows.length || !Number.isFinite(args.lastCandleTime)) {
    return null;
  }

  const flow = recommendation.dealerPressureRead?.flowState ?? null;
  const stepMinutes = args.candleFrequencyMinutes === 1 ? 5 : 10;
  const horizonMinutes = args.candleFrequencyMinutes === 1 ? 75 : 120;
  const steps = Math.max(6, Math.round(horizonMinutes / stepMinutes));
  const strikeStep = inferStrikeStep(rows);
  const expectedMove = Math.max(recommendation.expectedMove || 0, strikeStep * 8, 40);
  const radius = Math.max(expectedMove * 1.25, 70);
  const prices = buildPriceGrid(spot - radius, spot + radius, strikeStep);

  const field = prices.map((price) =>
    terrainCost({
      price,
      spot,
      rows,
      recommendation,
      flow,
      expectedMove,
      strikeStep,
    }),
  );

  const startIndex = nearestIndex(prices, spot);
  const maxTravelPerStep = travelLimit(flow, strikeStep);
  const maxIndexJump = Math.max(1, Math.round(maxTravelPerStep / strikeStep));
  const viscosity = flow?.viscosityScore ?? 50;
  const transitionWeight = 0.45 + viscosity / 85;
  const directionPush = directionalPush(flow, recommendation.dealerPressure);

  let previous = prices.map((_, index) => (index === startIndex ? 0 : Number.POSITIVE_INFINITY));
  const parents: number[][] = [];

  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    const next = prices.map(() => Number.POSITIVE_INFINITY);
    const stepParents = prices.map(() => -1);

    for (let target = 0; target < prices.length; target += 1) {
      const targetPrice = prices[target];
      const driftReward = ((targetPrice - spot) / expectedMove) * directionPush * progress * 8;
      const timeCost = field[target] - driftReward;
      const fromStart = Math.max(0, target - maxIndexJump);
      const fromEnd = Math.min(prices.length - 1, target + maxIndexJump);

      for (let source = fromStart; source <= fromEnd; source += 1) {
        if (!Number.isFinite(previous[source])) continue;
        const movement = Math.abs(target - source);
        const reversalPenalty = movement * movement * transitionWeight;
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

  let endIndex = previous.reduce(
    (best, value, index, all) => (value < all[best] ? index : best),
    0,
  );
  const pathIndexes = new Array<number>(steps + 1);
  pathIndexes[steps] = endIndex;
  for (let step = steps - 1; step >= 0; step -= 1) {
    endIndex = parents[step][endIndex] >= 0 ? parents[step][endIndex] : endIndex;
    pathIndexes[step] = endIndex;
  }
  pathIndexes[0] = startIndex;

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
      time: args.lastCandleTime + step * stepMinutes * 60,
      center: round(center),
      crest: round(bounds.crest),
      trough: round(bounds.trough),
    };
  });

  const last = points.at(-1)?.center ?? spot;
  const direction = last > spot + strikeStep ? "UP" : last < spot - strikeStep ? "DOWN" : "NEUTRAL";
  const confidence = clamp(
    Math.round(
      recommendation.confidenceScore * 0.55 +
        (flow?.confidenceScore ?? 50) * 0.3 +
        recommendation.alignmentScore * 0.15,
    ),
    0,
    100,
  );

  return {
    points,
    horizonMinutes,
    stepMinutes,
    direction,
    confidence,
    explanation: [
      `Path minimizes cumulative strike resistance over ${horizonMinutes} minutes.`,
      `Transition speed is limited by options viscosity ${Math.round(viscosity)}.`,
      `Directional hose pressure contributes ${directionPush > 0 ? "upward" : directionPush < 0 ? "downward" : "neutral"} drift.`,
    ],
  };
}

function terrainCost(args: {
  price: number;
  spot: number;
  rows: SpxOiMapRow[];
  recommendation: ZeroDteRecommendation;
  flow: ZeroDteFlowStateRead | null;
  expectedMove: number;
  strikeStep: number;
}) {
  const maxScore = Math.max(1, ...args.rows.map((row) => row.score || 0));
  let resistance = 0;
  let attraction = 0;

  for (const row of args.rows) {
    const distance = Math.abs(args.price - row.strike);
    const decay = Math.exp(-distance / Math.max(args.strikeStep * 2.2, 9));
    const strength = clamp((row.score || 0) / maxScore, 0, 1);
    const sideStrength = clamp((row.sideBiasPct || 0) / 100, 0, 1);

    if (row.sideBias === "call" && args.price <= row.strike) {
      resistance += strength * (0.65 + sideStrength * 0.55) * decay * 38;
    } else if (row.sideBias === "put" && args.price >= row.strike) {
      resistance += strength * (0.65 + sideStrength * 0.55) * decay * 38;
    } else {
      attraction += strength * decay * 12;
    }

    if (row.isPin) attraction += strength * decay * 28;
  }

  const centerDistance = Math.abs(args.price - args.recommendation.suggestedCenter) / args.expectedMove;
  const pin = args.recommendation.spx.strongestPin ?? args.recommendation.suggestedCenter;
  const pinDistance = Math.abs(args.price - pin) / args.expectedMove;
  const wallPenalty =
    barrierPenalty(args.price, args.spot, args.recommendation.spx.callWall, "up", args.expectedMove) +
    barrierPenalty(args.price, args.spot, args.recommendation.spx.putWall, "down", args.expectedMove);

  const absorption = args.flow?.state === "ABSORBING" ? 1.3 : args.flow?.state === "AMPLIFYING" ? 0.72 : 1;
  return resistance * absorption + centerDistance * 8 + pinDistance * 5 + wallPenalty - attraction;
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
  const crossed = direction === "up" ? price > value && spot <= value : price < value && spot >= value;
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
  const maxWidth = args.expectedMove * (0.22 + args.progress * 0.18) * stateWidth;
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

function directionalPush(flow: ZeroDteFlowStateRead | null, signedPressure: number) {
  const direction = flow?.direction ?? (signedPressure > 15 ? "UP" : signedPressure < -15 ? "DOWN" : "NEUTRAL");
  const sign = direction === "UP" ? 1 : direction === "DOWN" ? -1 : 0;
  const stateMultiplier = flow?.state === "AMPLIFYING" ? 1.25 : flow?.state === "ABSORBING" ? 0.35 : flow?.state === "RELEASING" ? 0.9 : 0.55;
  return sign * clamp(Math.abs(signedPressure) / 55, 0, 1.5) * stateMultiplier;
}

function travelLimit(flow: ZeroDteFlowStateRead | null, strikeStep: number) {
  if (flow?.state === "AMPLIFYING") return strikeStep * 3;
  if (flow?.state === "RELEASING") return strikeStep * 2.2;
  if (flow?.state === "ABSORBING") return strikeStep * 1.2;
  return strikeStep * 1.7;
}

function inferStrikeStep(rows: SpxOiMapRow[]) {
  const strikes = [...new Set(rows.map((row) => row.strike).filter(Number.isFinite))].sort((a, b) => a - b);
  const gaps = strikes.slice(1).map((strike, index) => strike - strikes[index]).filter((gap) => gap > 0 && gap <= 25);
  if (!gaps.length) return 5;
  return Math.max(5, Math.min(10, Math.round(Math.min(...gaps) / 5) * 5));
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
    Math.abs(value - target) < Math.abs(values[best] - target) ? index : best,
  0);
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
