import { getControllingMarketMap } from "./session/mapEngine";
import type { SessionMapManagerState } from "./session/mapEngine";
import type {
  ExecutionCandidate,
  ExecutionLeg,
  ExecutionPositionMemory,
  ExecutionStrategy,
  ZeroDteExecutionMemory,
} from "./zeroDteExecutionIntelligence";
import type {
  ZeroDteChainRow,
  ZeroDteRecommendation,
} from "./zeroDteOiIntelligence";
import type { ZeroDteMoodRead } from "./zeroDteMoodEngine";

export type ZeroDteMarketStory =
  | "BULLISH_EXPANSION"
  | "BEARISH_EXPANSION"
  | "PINNED_NEUTRAL"
  | "TRANSITION";

export type ZeroDtePortfolioAction =
  | "BUILD_FIRST_POSITION"
  | "HOLD_PORTFOLIO"
  | "ADD_PUT_CREDIT_SPREAD"
  | "ADD_CALL_CREDIT_SPREAD"
  | "BUY_LONG_CALL"
  | "BUY_LONG_PUT"
  | "REDUCE_POSITIVE_DELTA"
  | "REDUCE_NEGATIVE_DELTA"
  | "CLOSE_INVALID_POSITION"
  | "NO_ACTION";

export type PortfolioPositionRead = {
  position: ExecutionPositionMemory;
  currentDebit: number | null;
  capturedPremiumPct: number | null;
  pnlDollars: number | null;
  delta: number;
  gamma: number;
  theta: number;
  shortStrike: number | null;
  shortDistancePoints: number | null;
  maxRiskDollars: number;
};

export type CandidatePortfolioContribution = {
  score: number;
  projectedNetDelta: number;
  projectedGrossRiskDollars: number;
  reasons: string[];
  blockers: string[];
};

export type ZeroDtePortfolioRead = {
  story: ZeroDteMarketStory;
  storyLabel: string;
  positions: PortfolioPositionRead[];
  positionCount: number;
  putSpreadCount: number;
  callSpreadCount: number;
  ironFlyCount: number;
  netDelta: number;
  netGamma: number;
  netTheta: number;
  openPnlDollars: number;
  grossRiskDollars: number;
  riskBudgetDollars: number;
  riskBudgetUsedPct: number;
  upsideMaxLossDollars: number;
  downsideMaxLossDollars: number;
  nearestPutShort: number | null;
  nearestCallShort: number | null;
  targetDeltaMin: number;
  targetDeltaMax: number;
  recommendedAction: ZeroDtePortfolioAction;
  recommendedActionLabel: string;
  reasons: string[];
  warnings: string[];
  candidateContribution: Record<
    ExecutionStrategy,
    CandidatePortfolioContribution
  >;
};

export function buildZeroDtePortfolioRead(args: {
  memory: ZeroDteExecutionMemory;
  rows: ZeroDteChainRow[];
  recommendation: ZeroDteRecommendation;
  mapState: SessionMapManagerState;
  candidates: Partial<Record<ExecutionStrategy, ExecutionCandidate | null>>;
  mood?: ZeroDteMoodRead | null;
  riskBudgetDollars?: number;
}): ZeroDtePortfolioRead {
  const riskBudgetDollars = Math.max(500, args.riskBudgetDollars ?? 5000);
  const positions = args.memory.positions ?? (args.memory.position ? [args.memory.position] : []);
  const story = classifyStory(args.mapState, args.recommendation, args.mood ?? null);
  const target = targetDeltaBand(story, args.mood ?? null);

  const positionReads = positions.map((position) =>
    buildPositionRead(position, args.rows, args.recommendation.spxPrice),
  );
  const netDelta = round(
    positionReads.reduce((sum, item) => sum + item.delta, 0),
  );
  const netGamma = round(
    positionReads.reduce((sum, item) => sum + item.gamma, 0),
  );
  const netTheta = round(
    positionReads.reduce((sum, item) => sum + item.theta, 0),
  );
  const grossRiskDollars = positionReads.reduce(
    (sum, item) => sum + item.maxRiskDollars,
    0,
  );
  const openPnlDollars = positionReads.reduce(
    (sum, item) => sum + (item.pnlDollars ?? 0),
    0,
  );
  const upsideMaxLossDollars = positionReads.reduce(
    (sum, item) =>
      sum +
      (item.position.strategy === "call-credit-spread" ||
      item.position.strategy === "iron-fly"
        ? item.maxRiskDollars
        : 0),
    0,
  );
  const downsideMaxLossDollars = positionReads.reduce(
    (sum, item) =>
      sum +
      (item.position.strategy === "put-credit-spread" ||
      item.position.strategy === "iron-fly"
        ? item.maxRiskDollars
        : 0),
    0,
  );

  const putShorts = positionReads
    .filter((item) => item.position.strategy === "put-credit-spread")
    .map((item) => item.shortStrike)
    .filter((value): value is number => value !== null);
  const callShorts = positionReads
    .filter((item) => item.position.strategy === "call-credit-spread")
    .map((item) => item.shortStrike)
    .filter((value): value is number => value !== null);

  const base = {
    story,
    netDelta,
    grossRiskDollars,
    riskBudgetDollars,
    targetDeltaMin: target.min,
    targetDeltaMax: target.max,
    positions,
    positionReads,
  };

  const candidateContribution = {
    "iron-fly": scoreCandidateContribution(
      args.candidates["iron-fly"] ?? null,
      base,
      args.rows,
      args.recommendation.spxPrice,
    ),
    "put-credit-spread": scoreCandidateContribution(
      args.candidates["put-credit-spread"] ?? null,
      base,
      args.rows,
      args.recommendation.spxPrice,
    ),
    "call-credit-spread": scoreCandidateContribution(
      args.candidates["call-credit-spread"] ?? null,
      base,
      args.rows,
      args.recommendation.spxPrice,
    ),
  } satisfies Record<ExecutionStrategy, CandidatePortfolioContribution>;

  const invalidPosition = positionReads.find((item) =>
    positionStructurallyInvalid(item.position, args.mapState, args.recommendation),
  );
  const action = choosePortfolioAction({
    story,
    positionCount: positions.length,
    netDelta,
    target,
    invalidPosition: Boolean(invalidPosition),
    putContribution: candidateContribution["put-credit-spread"],
    callContribution: candidateContribution["call-credit-spread"],
  });

  const reasons = [
    `${storyLabel(story)} defines a target delta band of ${signed(target.min)} to ${signed(target.max)}.`,
    args.mood?.moodPercent == null
      ? "SPX Mood is unavailable, so the delta target is map-driven."
      : `SPX Mood is ${args.mood.moodPercent.toFixed(1)}% (${args.mood.coverage.status}); the target band is adjusted for directional conviction and divergence.`,
    positions.length
      ? `${positions.length} open position${positions.length === 1 ? "" : "s"} carry ${signed(netDelta)} net delta points.`
      : "No position is open; the next accepted trade establishes the session profile.",
    `Gross defined risk is $${Math.round(grossRiskDollars).toLocaleString()} of the $${Math.round(riskBudgetDollars).toLocaleString()} portfolio budget.`,
  ];
  const warnings: string[] = [];
  if (grossRiskDollars > riskBudgetDollars) {
    warnings.push("Gross defined risk exceeds the configured 0DTE portfolio budget.");
  }
  if (invalidPosition) {
    warnings.push(`${invalidPosition.position.label} is structurally invalid and should be managed before adding risk.`);
  }
  if (Math.abs(netGamma) > 0.5) {
    warnings.push("Portfolio gamma is elevated for a same-day expiration profile.");
  }
  if (netDelta < target.min || netDelta > target.max) {
    warnings.push(
      `Net delta ${signed(netDelta)} is outside the ${signed(target.min)} to ${signed(target.max)} story-conditioned band.`,
    );
  }

  return {
    story,
    storyLabel: storyLabel(story),
    positions: positionReads,
    positionCount: positions.length,
    putSpreadCount: positions.filter((item) => item.strategy === "put-credit-spread").length,
    callSpreadCount: positions.filter((item) => item.strategy === "call-credit-spread").length,
    ironFlyCount: positions.filter((item) => item.strategy === "iron-fly").length,
    netDelta,
    netGamma,
    netTheta,
    openPnlDollars: roundMoney(openPnlDollars),
    grossRiskDollars: roundMoney(grossRiskDollars),
    riskBudgetDollars,
    riskBudgetUsedPct: round((grossRiskDollars / riskBudgetDollars) * 100),
    upsideMaxLossDollars: roundMoney(upsideMaxLossDollars),
    downsideMaxLossDollars: roundMoney(downsideMaxLossDollars),
    nearestPutShort: putShorts.length ? Math.max(...putShorts) : null,
    nearestCallShort: callShorts.length ? Math.min(...callShorts) : null,
    targetDeltaMin: target.min,
    targetDeltaMax: target.max,
    recommendedAction: action,
    recommendedActionLabel: actionLabel(action),
    reasons,
    warnings,
    candidateContribution,
  };
}

function buildPositionRead(
  position: ExecutionPositionMemory,
  rows: ZeroDteChainRow[],
  spot: number,
): PortfolioPositionRead {
  const currentDebit = calculateCredit(rows, position.legs);
  const pnlDollars =
    currentDebit === null
      ? null
      : (position.entryCredit - currentDebit) * 100 * position.quantity;
  const capturedPremiumPct =
    currentDebit === null || position.entryCredit <= 0
      ? null
      : ((position.entryCredit - currentDebit) / position.entryCredit) * 100;
  const greeks = calculateLegGreeks(rows, position.legs, position.quantity);
  const shortStrike = position.legs.find((leg) => leg.action === "sell")?.strike ?? null;

  return {
    position,
    currentDebit,
    capturedPremiumPct,
    pnlDollars,
    delta: greeks.delta,
    gamma: greeks.gamma,
    theta: greeks.theta,
    shortStrike,
    shortDistancePoints:
      shortStrike === null
        ? null
        : position.strategy === "put-credit-spread"
          ? spot - shortStrike
          : position.strategy === "call-credit-spread"
            ? shortStrike - spot
            : Math.abs(spot - shortStrike),
    maxRiskDollars: Math.max(0, position.maxRiskDollars ?? 0) * position.quantity,
  };
}

function scoreCandidateContribution(
  candidate: ExecutionCandidate | null,
  context: {
    story: ZeroDteMarketStory;
    netDelta: number;
    grossRiskDollars: number;
    riskBudgetDollars: number;
    targetDeltaMin: number;
    targetDeltaMax: number;
    positions: ExecutionPositionMemory[];
    positionReads: PortfolioPositionRead[];
  },
  rows: ZeroDteChainRow[],
  spot: number,
): CandidatePortfolioContribution {
  if (!candidate) {
    return {
      score: 0,
      projectedNetDelta: context.netDelta,
      projectedGrossRiskDollars: context.grossRiskDollars,
      reasons: [],
      blockers: ["No tracked candidate is available."],
    };
  }

  const blockers: string[] = [];
  const reasons: string[] = [];
  const candidateGreeks = calculateLegGreeks(rows, candidate.legs, 1);
  const projectedNetDelta = round(context.netDelta + candidateGreeks.delta);
  const candidateRisk = Math.max(0, candidate.maxRiskDollars ?? 0);
  const projectedGrossRiskDollars = context.grossRiskDollars + candidateRisk;
  const duplicate = context.positions.some(
    (position) => position.setupKey === candidate.setupKey,
  );
  if (duplicate) blockers.push("This exact spread is already open in the portfolio.");
  if (projectedGrossRiskDollars > context.riskBudgetDollars) {
    blockers.push("Adding one contract would exceed the configured gross-risk budget.");
  }

  const shortStrike = candidate.legs.find((leg) => leg.action === "sell")?.strike ?? null;
  const clustered =
    shortStrike !== null &&
    context.positionReads.some(
      (item) =>
        item.position.strategy === candidate.strategy &&
        item.shortStrike !== null &&
        Math.abs(item.shortStrike - shortStrike) < 10,
    );
  if (clustered) blockers.push("The proposed short strike clusters within 10 points of existing same-side risk.");

  const beforeDistance = distanceToBand(
    context.netDelta,
    context.targetDeltaMin,
    context.targetDeltaMax,
  );
  const afterDistance = distanceToBand(
    projectedNetDelta,
    context.targetDeltaMin,
    context.targetDeltaMax,
  );
  const deltaImprovement = clamp(55 + (beforeDistance - afterDistance) * 2.5);
  if (afterDistance < beforeDistance) reasons.push("The addition moves net delta toward the story-conditioned target band.");
  if (afterDistance > beforeDistance) reasons.push("The addition increases directional imbalance versus the target band.");

  const storyScore = storyAlignment(candidate.strategy, context.story);
  const riskScore = clamp(
    100 - (projectedGrossRiskDollars / context.riskBudgetDollars) * 70,
  );
  const concentrationScore = clustered ? 20 : 85;
  let score =
    deltaImprovement * 0.35 +
    storyScore * 0.3 +
    riskScore * 0.25 +
    concentrationScore * 0.1;
  score -= blockers.length * 18;

  if (candidateRisk > 0) {
    reasons.push(`One contract raises gross risk by about $${Math.round(candidateRisk).toLocaleString()}.`);
  }
  reasons.push(`Projected net delta: ${signed(projectedNetDelta)}.`);

  return {
    score: Math.round(clamp(score)),
    projectedNetDelta,
    projectedGrossRiskDollars: roundMoney(projectedGrossRiskDollars),
    reasons,
    blockers,
  };
}

function classifyStory(
  mapState: SessionMapManagerState,
  recommendation: ZeroDteRecommendation,
  mood: ZeroDteMoodRead | null,
): ZeroDteMarketStory {
  const controlling = getControllingMarketMap(mapState);
  if (mapState.phase === "TRANSITION") return "TRANSITION";

  const directionalThreshold = Math.max(
    8,
    recommendation.expectedMove * 0.2,
  );
  const distanceFromCenter = recommendation.spxPrice - controlling.center;

  if (
    mapState.railBreached === "UPPER" ||
    recommendation.spxPrice > controlling.upperWing ||
    (distanceFromCenter >= directionalThreshold &&
      recommendation.dealerPressure >= -10) ||
    (mood?.moodPercent != null && mood.moodPercent >= 70 && distanceFromCenter > 0)
  ) {
    return "BULLISH_EXPANSION";
  }
  if (
    mapState.railBreached === "LOWER" ||
    recommendation.spxPrice < controlling.lowerWing ||
    (distanceFromCenter <= -directionalThreshold &&
      recommendation.dealerPressure <= 10) ||
    (mood?.moodPercent != null && mood.moodPercent <= -70 && distanceFromCenter < 0)
  ) {
    return "BEARISH_EXPANSION";
  }
  return "PINNED_NEUTRAL";
}

function targetDeltaBand(
  story: ZeroDteMarketStory,
  mood: ZeroDteMoodRead | null,
) {
  if (story === "TRANSITION") return { min: -5, max: 5 };
  if (story === "BULLISH_EXPANSION") {
    if (mood?.internalDivergence === "PRICE_UP_MOOD_DOWN") return { min: 0, max: 15 };
    if ((mood?.moodPercent ?? 0) >= 70) return { min: 10, max: 35 };
    return { min: 5, max: 30 };
  }
  if (story === "BEARISH_EXPANSION") {
    if (mood?.internalDivergence === "PRICE_DOWN_MOOD_UP") return { min: -15, max: 0 };
    if ((mood?.moodPercent ?? 0) <= -70) return { min: -35, max: -10 };
    return { min: -30, max: -5 };
  }
  if ((mood?.moodPercent ?? 0) >= 40) return { min: 0, max: 15 };
  if ((mood?.moodPercent ?? 0) <= -40) return { min: -15, max: 0 };
  return { min: -10, max: 10 };
}

function choosePortfolioAction(args: {
  story: ZeroDteMarketStory;
  positionCount: number;
  netDelta: number;
  target: { min: number; max: number };
  invalidPosition: boolean;
  putContribution: CandidatePortfolioContribution;
  callContribution: CandidatePortfolioContribution;
}): ZeroDtePortfolioAction {
  if (args.invalidPosition) return "CLOSE_INVALID_POSITION";
  if (args.positionCount === 0) return "BUILD_FIRST_POSITION";

  const putAvailable =
    !args.putContribution.blockers.length &&
    args.putContribution.score >= 70;
  const callAvailable =
    !args.callContribution.blockers.length &&
    args.callContribution.score >= 70;
  const targetMidpoint = (args.target.min + args.target.max) / 2;

  if (args.story === "BULLISH_EXPANSION") {
    if (args.netDelta > args.target.max + 20) return "BUY_LONG_PUT";
    if (
      putAvailable &&
      args.netDelta < targetMidpoint &&
      args.putContribution.projectedNetDelta <= args.target.max + 5
    ) {
      return "ADD_PUT_CREDIT_SPREAD";
    }
    return "HOLD_PORTFOLIO";
  }

  if (args.story === "BEARISH_EXPANSION") {
    if (args.netDelta < args.target.min - 20) return "BUY_LONG_CALL";
    if (
      callAvailable &&
      args.netDelta > targetMidpoint &&
      args.callContribution.projectedNetDelta >= args.target.min - 5
    ) {
      return "ADD_CALL_CREDIT_SPREAD";
    }
    return "HOLD_PORTFOLIO";
  }

  if (args.netDelta > args.target.max) {
    if (callAvailable) return "ADD_CALL_CREDIT_SPREAD";
    return "BUY_LONG_PUT";
  }
  if (args.netDelta < args.target.min) {
    if (putAvailable) return "ADD_PUT_CREDIT_SPREAD";
    return "BUY_LONG_CALL";
  }
  return "HOLD_PORTFOLIO";
}

function positionStructurallyInvalid(
  position: ExecutionPositionMemory,
  mapState: SessionMapManagerState,
  recommendation: ZeroDteRecommendation,
) {
  if (position.strategy === "put-credit-spread") {
    return mapState.railBreached === "LOWER" || recommendation.dealerPressure <= -35;
  }
  if (position.strategy === "call-credit-spread") {
    return mapState.railBreached === "UPPER" || recommendation.dealerPressure >= 35;
  }
  return mapState.phase === "TRANSITION" || mapState.railBreached !== "NONE";
}

function calculateLegGreeks(
  rows: ZeroDteChainRow[],
  legs: ExecutionLeg[],
  quantity: number,
) {
  let delta = 0;
  let gamma = 0;
  let theta = 0;
  for (const leg of legs) {
    const row = findRow(rows, leg);
    if (!row) continue;
    const sign = leg.action === "buy" ? 1 : -1;
    delta += sign * Number(row.delta ?? 0) * quantity * 100;
    gamma += sign * Number(row.gamma ?? 0) * quantity * 100;
    theta += sign * Number(row.theta ?? 0) * quantity * 100;
  }
  return { delta: round(delta), gamma: round(gamma), theta: round(theta) };
}

function calculateCredit(rows: ZeroDteChainRow[], legs: ExecutionLeg[]) {
  let total = 0;
  for (const leg of legs) {
    const row = findRow(rows, leg);
    if (!row) return null;
    const mid = optionMid(row);
    if (mid === null) return null;
    total += leg.action === "sell" ? mid : -mid;
  }
  return total >= 0 ? roundMoney(total) : null;
}

function findRow(rows: ZeroDteChainRow[], leg: ExecutionLeg) {
  return rows.find(
    (row) =>
      row.optionType === leg.optionType &&
      Math.abs(row.strike - leg.strike) < 0.01,
  );
}

function optionMid(row: ZeroDteChainRow) {
  if (Number.isFinite(row.mid) && Number(row.mid) >= 0) return Number(row.mid);
  if (
    Number.isFinite(row.bid) &&
    Number.isFinite(row.ask) &&
    Number(row.bid) >= 0 &&
    Number(row.ask) >= 0
  ) {
    return (Number(row.bid) + Number(row.ask)) / 2;
  }
  if (Number.isFinite(row.last) && Number(row.last) >= 0) return Number(row.last);
  return null;
}

function storyAlignment(
  strategy: ExecutionStrategy,
  story: ZeroDteMarketStory,
) {
  if (story === "BULLISH_EXPANSION") {
    return strategy === "put-credit-spread" ? 100 : strategy === "iron-fly" ? 20 : 5;
  }
  if (story === "BEARISH_EXPANSION") {
    return strategy === "call-credit-spread" ? 100 : strategy === "iron-fly" ? 20 : 5;
  }
  if (story === "TRANSITION") {
    return strategy === "iron-fly" ? 10 : 55;
  }
  return strategy === "iron-fly" ? 95 : 70;
}

function distanceToBand(value: number, min: number, max: number) {
  if (value < min) return min - value;
  if (value > max) return value - max;
  return 0;
}

function storyLabel(story: ZeroDteMarketStory) {
  return story.replaceAll("_", " ");
}

function actionLabel(action: ZeroDtePortfolioAction) {
  return action.replaceAll("_", " ");
}

function signed(value: number) {
  return `${value > 0 ? "+" : ""}${Math.round(value)}`;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}
