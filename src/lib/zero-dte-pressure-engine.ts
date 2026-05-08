export type ZeroDTESide = "put" | "call";

export type ZeroDTEPressureStatus =
  | "safe"
  | "watch"
  | "pressure"
  | "defend"
  | "urgent_defend";

export type ZeroDTEAction =
  | "hold"
  | "monitor"
  | "prepare_defense"
  | "close_short_leg"
  | "urgent_close_short_leg"
  | "avoid_resell";

export type ZeroDTEChainRow = {
  strike: number;

  callOi?: number;
  putOi?: number;

  callVolume?: number;
  putVolume?: number;

  callDelta?: number;
  putDelta?: number;

  callMark?: number;
  putMark?: number;
};

export type ZeroDTESpreadPosition = {
  id: string;
  side: ZeroDTESide;

  shortStrike: number;
  longStrike: number;
  width: number;

  contracts: number;

  entryCredit: number;
  currentShortMark: number;
  currentSpreadMark?: number;

  openedAt?: string;
};

export type ZeroDTEInternals = {
  tick?: number;
  add?: number;
  vixChangePct?: number;
  topWeightParticipation?: number;
  uvolDvolRatio?: number;
};

export type StrikePressureMetrics = {
  side: ZeroDTESide;
  shortStrike: number;
  longStrike: number;

  spot: number;
  distancePoints: number;
  distancePct: number;

  nearStrikeVolume: number;
  totalSideVolume: number;
  nearStrikeOi: number;

  volumeConcentrationPct: number;
  volumeToOiPct: number;
  volumeAcceleration: number;
  directionalSkewPct: number;

  priceVelocityPoints: number;
  markMultiple: number;

  proximityScore: number;
  concentrationScore: number;
  volumeToOiScore: number;
  accelerationScore: number;
  skewScore: number;
  velocityScore: number;
  markMultipleScore: number;

  rawScore: number;
  internalsMultiplier: number;
  finalScore: number;

  status: ZeroDTEPressureStatus;
  action: ZeroDTEAction;

  reasons: string[];
  managementPlan: string[];
};

export type ZeroDTEPressureReport = {
  position: ZeroDTESpreadPosition;
  metrics: StrikePressureMetrics;
};

function n(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function scoreFromRange(value: number, low: number, high: number): number {
  if (value <= low) return 0;
  if (value >= high) return 1;
  return (value - low) / (high - low);
}

function absDistance(a: number, b: number): number {
  return Math.abs(a - b);
}

function getSideOi(row: ZeroDTEChainRow, side: ZeroDTESide): number {
  return side === "put" ? n(row.putOi) : n(row.callOi);
}

function getSideVolume(row: ZeroDTEChainRow, side: ZeroDTESide): number {
  return side === "put" ? n(row.putVolume) : n(row.callVolume);
}

function getOppositeVolume(row: ZeroDTEChainRow, side: ZeroDTESide): number {
  return side === "put" ? n(row.callVolume) : n(row.putVolume);
}

function relevantRows(args: {
  chain: ZeroDTEChainRow[];
  shortStrike: number;
  windowPoints: number;
}): ZeroDTEChainRow[] {
  return args.chain.filter((row) => absDistance(row.strike, args.shortStrike) <= args.windowPoints);
}

function sumSideVolume(chain: ZeroDTEChainRow[], side: ZeroDTESide): number {
  return chain.reduce((sum, row) => sum + getSideVolume(row, side), 0);
}

function sumSideOi(chain: ZeroDTEChainRow[], side: ZeroDTESide): number {
  return chain.reduce((sum, row) => sum + getSideOi(row, side), 0);
}

function nearVolume(args: {
  chain: ZeroDTEChainRow[];
  side: ZeroDTESide;
  shortStrike: number;
  windowPoints: number;
}): number {
  return relevantRows(args).reduce((sum, row) => sum + getSideVolume(row, args.side), 0);
}

function nearOppositeVolume(args: {
  chain: ZeroDTEChainRow[];
  side: ZeroDTESide;
  shortStrike: number;
  windowPoints: number;
}): number {
  return relevantRows(args).reduce((sum, row) => sum + getOppositeVolume(row, args.side), 0);
}

function nearOi(args: {
  chain: ZeroDTEChainRow[];
  side: ZeroDTESide;
  shortStrike: number;
  windowPoints: number;
}): number {
  return relevantRows(args).reduce((sum, row) => sum + getSideOi(row, args.side), 0);
}

function priceVelocityTowardStrike(args: {
  side: ZeroDTESide;
  priorSpot?: number;
  spot: number;
}): number {
  if (args.priorSpot == null || !Number.isFinite(args.priorSpot)) return 0;

  const move = args.spot - args.priorSpot;

  if (args.side === "put") {
    return move < 0 ? Math.abs(move) : 0;
  }

  return move > 0 ? Math.abs(move) : 0;
}

function volumeAcceleration(args: {
  side: ZeroDTESide;
  chain: ZeroDTEChainRow[];
  priorChain?: ZeroDTEChainRow[];
  shortStrike: number;
  windowPoints: number;
}): number {
  if (!args.priorChain?.length) return 1;

  const current = nearVolume({
    chain: args.chain,
    side: args.side,
    shortStrike: args.shortStrike,
    windowPoints: args.windowPoints
  });

  const prior = nearVolume({
    chain: args.priorChain,
    side: args.side,
    shortStrike: args.shortStrike,
    windowPoints: args.windowPoints
  });

  return current / Math.max(prior, 1);
}

function directionalSkew(args: {
  chain: ZeroDTEChainRow[];
  side: ZeroDTESide;
  shortStrike: number;
  windowPoints: number;
}): number {
  const sideVol = nearVolume(args);
  const oppositeVol = nearOppositeVolume(args);
  const total = sideVol + oppositeVol;

  if (!total) return 0.5;

  return sideVol / total;
}

function internalsMultiplier(args: {
  side: ZeroDTESide;
  internals?: ZeroDTEInternals;
}): number {
  const i = args.internals;
  if (!i) return 1;

  let multiplier = 1;

  const tick = n(i.tick);
  const add = n(i.add);
  const vixChangePct = n(i.vixChangePct);
  const topWeightParticipation = n(i.topWeightParticipation);
  const uvolDvolRatio = n(i.uvolDvolRatio);

  if (args.side === "put") {
    if (tick < -500) multiplier += 0.1;
    if (tick < -900) multiplier += 0.15;

    if (add < -500) multiplier += 0.1;
    if (add < -1200) multiplier += 0.15;

    if (vixChangePct > 2) multiplier += 0.1;
    if (vixChangePct > 5) multiplier += 0.15;

    if (topWeightParticipation < -0.4) multiplier += 0.1;

    if (uvolDvolRatio > 0 && uvolDvolRatio < 0.7) multiplier += 0.1;
  }

  if (args.side === "call") {
    if (tick > 500) multiplier += 0.1;
    if (tick > 900) multiplier += 0.15;

    if (add > 500) multiplier += 0.1;
    if (add > 1200) multiplier += 0.15;

    if (vixChangePct > 2) multiplier += 0.05;

    if (topWeightParticipation > 0.4) multiplier += 0.1;

    if (uvolDvolRatio > 1.4) multiplier += 0.1;
  }

  return Math.min(multiplier, 1.6);
}

function classify(score: number, markMultiple: number, breached: boolean): ZeroDTEPressureStatus {
  if (breached && score >= 65) return "urgent_defend";
  if (breached) return "defend";

  if (markMultiple >= 3 && score >= 55) return "defend";
  if (markMultiple >= 3) return "pressure";

  if (score >= 80) return "urgent_defend";
  if (score >= 65) return "defend";
  if (score >= 45) return "pressure";
  if (score >= 25) return "watch";

  return "safe";
}

function actionFor(status: ZeroDTEPressureStatus): ZeroDTEAction {
  if (status === "urgent_defend") return "urgent_close_short_leg";
  if (status === "defend") return "close_short_leg";
  if (status === "pressure") return "prepare_defense";
  if (status === "watch") return "monitor";
  return "hold";
}

function buildReasons(args: {
  side: ZeroDTESide;
  status: ZeroDTEPressureStatus;
  distancePoints: number;
  volumeConcentrationPct: number;
  volumeToOiPct: number;
  volumeAcceleration: number;
  directionalSkewPct: number;
  priceVelocityPoints: number;
  markMultiple: number;
  breached: boolean;
}): string[] {
  const reasons: string[] = [];
  const label = args.side === "put" ? "put" : "call";

  reasons.push(`Short ${label} strike is ${args.distancePoints.toFixed(1)} point(s) from spot.`);

  if (args.volumeConcentrationPct >= 0.25) {
    reasons.push(`${label.toUpperCase()} volume is highly concentrated near the short strike (${pct(args.volumeConcentrationPct)} of same-side chain volume).`);
  } else if (args.volumeConcentrationPct >= 0.15) {
    reasons.push(`${label.toUpperCase()} volume is meaningfully concentrated near the short strike (${pct(args.volumeConcentrationPct)}).`);
  }

  if (args.volumeToOiPct >= 0.75) {
    reasons.push(`Near-strike volume is very large relative to OI (${pct(args.volumeToOiPct)}).`);
  } else if (args.volumeToOiPct >= 0.3) {
    reasons.push(`Near-strike volume is meaningful relative to OI (${pct(args.volumeToOiPct)}).`);
  }

  if (args.volumeAcceleration >= 4) {
    reasons.push(`Near-strike volume is accelerating aggressively (${args.volumeAcceleration.toFixed(1)}x prior window).`);
  } else if (args.volumeAcceleration >= 2.5) {
    reasons.push(`Near-strike volume is accelerating (${args.volumeAcceleration.toFixed(1)}x prior window).`);
  }

  if (args.directionalSkewPct >= 0.85) {
    reasons.push(`Flow near the short strike is strongly one-sided (${pct(args.directionalSkewPct)} ${label} skew).`);
  } else if (args.directionalSkewPct >= 0.7) {
    reasons.push(`Flow near the short strike is directionally skewed (${pct(args.directionalSkewPct)} ${label} skew).`);
  }

  if (args.priceVelocityPoints >= 30) {
    reasons.push(`Price is moving rapidly toward the short strike (${args.priceVelocityPoints.toFixed(1)} points in the measured window).`);
  } else if (args.priceVelocityPoints >= 15) {
    reasons.push(`Price velocity toward the short strike is elevated (${args.priceVelocityPoints.toFixed(1)} points).`);
  }

  if (args.markMultiple >= 3) {
    reasons.push(`Short-leg mark reached the 3x management trigger (${args.markMultiple.toFixed(2)}x entry credit).`);
  } else if (args.markMultiple >= 2.5) {
    reasons.push(`Short-leg mark is approaching the 3x trigger (${args.markMultiple.toFixed(2)}x).`);
  }

  if (args.breached) {
    reasons.push("Spot has breached the short strike.");
  }

  if (!reasons.length) {
    reasons.push("No significant strike attack conditions detected.");
  }

  reasons.push(`Status classified as ${args.status.toUpperCase().replaceAll("_", " ")}.`);

  return reasons;
}

function buildManagementPlan(args: {
  side: ZeroDTESide;
  status: ZeroDTEPressureStatus;
  entryCredit: number;
  shortStrike: number;
  longStrike: number;
  width: number;
  markMultiple: number;
  distancePoints: number;
  breached: boolean;
}): string[] {
  const sideLabel = args.side === "put" ? "put" : "call";
  const trigger = args.entryCredit * 3;

  const plan: string[] = [];

  plan.push(`3x short-leg trigger: ${trigger.toFixed(2)}.`);

  if (args.status === "safe") {
    plan.push("Hold position. No defense needed.");
    plan.push("Continue monitoring short-leg mark and distance to short strike.");
    return plan;
  }

  if (args.status === "watch") {
    plan.push("Monitor. Do not close solely from IV expansion unless price also moves toward the strike.");
    plan.push("Prepare defense if mark approaches 3x or spot accelerates toward short strike.");
    return plan;
  }

  if (args.status === "pressure") {
    plan.push("Prepare defense. Short leg is under pressure but may not require immediate close yet.");
    plan.push("If short-leg mark reaches 3x and price is still moving toward strike, buy back short leg.");
    plan.push("If IV spike fades and price remains far from strike, continue monitoring.");
    return plan;
  }

  if (args.status === "defend") {
    plan.push(`Buy back the short ${sideLabel} if short mark is at/above 3x and price remains near the short strike.`);
    plan.push(`Leave the long ${sideLabel} open to retain convexity if momentum continues.`);
    plan.push(`If price stabilizes, consider re-selling a new short ${sideLabel} closer to the long leg.`);
    plan.push(`Prefer reducing width from ${args.width.toFixed(0)}pt toward ${(args.width / 2).toFixed(0)}pt if re-centering.`);
    return plan;
  }

  plan.push(`Urgent defense: buy back the short ${sideLabel}.`);
  plan.push("Do not immediately re-sell unless price stabilizes and volume acceleration cools.");
  plan.push(`Keep the long ${sideLabel} open while momentum persists.`);
  plan.push("If re-entering, use smaller size and narrower width.");
  return plan;
}

export function evaluateSpreadPressure(args: {
  position: ZeroDTESpreadPosition;

  spot: number;
  priorSpot?: number;

  chain: ZeroDTEChainRow[];
  priorChain?: ZeroDTEChainRow[];

  internals?: ZeroDTEInternals;

  windowPoints?: number;
}): ZeroDTEPressureReport {
  const windowPoints = args.windowPoints ?? 25;

  const { position } = args;

  const distancePoints =
    position.side === "put"
      ? args.spot - position.shortStrike
      : position.shortStrike - args.spot;

  const distancePct = distancePoints / Math.max(args.spot, 0.01);
  const breached = distancePoints <= 0;

  const nearStrikeVolume = nearVolume({
    chain: args.chain,
    side: position.side,
    shortStrike: position.shortStrike,
    windowPoints
  });

  const totalSideVolume = sumSideVolume(args.chain, position.side);

  const nearStrikeOi = nearOi({
    chain: args.chain,
    side: position.side,
    shortStrike: position.shortStrike,
    windowPoints
  });

  const volumeConcentrationPct = nearStrikeVolume / Math.max(totalSideVolume, 1);
  const volumeToOiPct = nearStrikeVolume / Math.max(nearStrikeOi, 1);

  const accel = volumeAcceleration({
    chain: args.chain,
    priorChain: args.priorChain,
    side: position.side,
    shortStrike: position.shortStrike,
    windowPoints
  });

  const skew = directionalSkew({
    chain: args.chain,
    side: position.side,
    shortStrike: position.shortStrike,
    windowPoints
  });

  const velocity = priceVelocityTowardStrike({
    side: position.side,
    priorSpot: args.priorSpot,
    spot: args.spot
  });

  const markMultiple = position.currentShortMark / Math.max(position.entryCredit, 0.01);

  const proximityScore = clamp(1 / (1 + Math.max(distancePoints, 0) / 25), 0, 1);
  const concentrationScore = scoreFromRange(volumeConcentrationPct, 0.05, 0.25);
  const volumeToOiScore = scoreFromRange(volumeToOiPct, 0.1, 0.75);
  const accelerationScore = scoreFromRange(accel, 1.2, 4.0);
  const skewScore = scoreFromRange(skew, 0.6, 0.9);
  const velocityScore = scoreFromRange(velocity, 5, 30);
  const markMultipleScore = scoreFromRange(markMultiple, 1.5, 3.0);

  const rawScore =
    25 * proximityScore +
    20 * concentrationScore +
    20 * volumeToOiScore +
    15 * accelerationScore +
    10 * skewScore +
    10 * velocityScore +
    20 * markMultipleScore;

  const multiplier = internalsMultiplier({
    side: position.side,
    internals: args.internals
  });

  const finalScore = clamp(rawScore * multiplier, 0, 100);

  const status = classify(finalScore, markMultiple, breached);
  const action = actionFor(status);

  const reasons = buildReasons({
    side: position.side,
    status,
    distancePoints,
    volumeConcentrationPct,
    volumeToOiPct,
    volumeAcceleration: accel,
    directionalSkewPct: skew,
    priceVelocityPoints: velocity,
    markMultiple,
    breached
  });

  const managementPlan = buildManagementPlan({
    side: position.side,
    status,
    entryCredit: position.entryCredit,
    shortStrike: position.shortStrike,
    longStrike: position.longStrike,
    width: position.width,
    markMultiple,
    distancePoints,
    breached
  });

  return {
    position,
    metrics: {
      side: position.side,
      shortStrike: position.shortStrike,
      longStrike: position.longStrike,

      spot: args.spot,
      distancePoints,
      distancePct,

      nearStrikeVolume,
      totalSideVolume,
      nearStrikeOi,

      volumeConcentrationPct,
      volumeToOiPct,
      volumeAcceleration: accel,
      directionalSkewPct: skew,

      priceVelocityPoints: velocity,
      markMultiple,

      proximityScore,
      concentrationScore,
      volumeToOiScore,
      accelerationScore,
      skewScore,
      velocityScore,
      markMultipleScore,

      rawScore,
      internalsMultiplier: multiplier,
      finalScore,

      status,
      action,

      reasons,
      managementPlan
    }
  };
}

export function evaluateZeroDTEPortfolioPressure(args: {
  positions: ZeroDTESpreadPosition[];

  spot: number;
  priorSpot?: number;

  chain: ZeroDTEChainRow[];
  priorChain?: ZeroDTEChainRow[];

  internals?: ZeroDTEInternals;

  windowPoints?: number;
}): ZeroDTEPressureReport[] {
  return args.positions.map((position) =>
    evaluateSpreadPressure({
      position,
      spot: args.spot,
      priorSpot: args.priorSpot,
      chain: args.chain,
      priorChain: args.priorChain,
      internals: args.internals,
      windowPoints: args.windowPoints
    })
  );
}