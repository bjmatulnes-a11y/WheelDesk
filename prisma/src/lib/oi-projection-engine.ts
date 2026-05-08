import { analyzeOIIntelligence } from "./oi-intelligence-engine";
import { ChainSnapshot, ExpirationChain } from "./types";

export type ProjectionBias = "bullish" | "bearish" | "neutral";

export type OIProjectionPoint = {
  expiration: string;
  dte: number;
  rawCenter: number;
  adjustedCenter: number;
  lowerRange: number;
  upperRange: number;
  callWall: number;
  putWall: number;
  prevailingScore: number;
  anomalyCount: number;
  weight: number;
};

export type OIProjectionReport = {
  ticker: string;
  snapshotDate: string;
  currentPrice: number;
  points: OIProjectionPoint[];
  slope: number;
  frontCenter: number;
  backCenter: number;
  curveDelta: number;
  spotOffset: number;
  projectedBias: ProjectionBias;
  confidence: "low" | "medium" | "high";
  reasons: string[];
  summary: string;
};

function dte(snapshotDate: string, expiration: string): number {
  const start = new Date(`${snapshotDate}T00:00:00Z`).getTime();
  const end = new Date(`${expiration}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((end - start) / (1000 * 60 * 60 * 24)));
}

function avg(values: number[]): number {
  const clean = values.filter((v) => Number.isFinite(v));
  if (!clean.length) return 0;
  return clean.reduce((s, v) => s + v, 0) / clean.length;
}

function linearSlope(points: OIProjectionPoint[]): number {
  if (points.length < 2) return 0;

  const xs = points.map((p) => p.dte);
  const ys = points.map((p) => p.adjustedCenter);

  const xMean = avg(xs);
  const yMean = avg(ys);

  const numerator = points.reduce(
    (sum, _, i) => sum + (xs[i] - xMean) * (ys[i] - yMean),
    0
  );

  const denominator = points.reduce(
    (sum, _, i) => sum + (xs[i] - xMean) ** 2,
    0
  );

  return denominator === 0 ? 0 : numerator / denominator;
}

function weightedAverage(points: OIProjectionPoint[]): number {
  const totalWeight = points.reduce((s, p) => s + p.weight, 0);
  if (!totalWeight) return avg(points.map((p) => p.adjustedCenter));

  return points.reduce((s, p) => s + p.adjustedCenter * p.weight, 0) / totalWeight;
}

function pointWeight(p: {
  dte: number;
  prevailingScore: number;
  anomalyCount: number;
}): number {
  const scoreWeight = Math.max(1, p.prevailingScore);
  const dteWeight = 1 / (1 + p.dte / 120);
  const anomalyPenalty = 1 / (1 + p.anomalyCount * 0.35);

  return scoreWeight * dteWeight * anomalyPenalty;
}

function classifyProjection(args: {
  currentPrice: number;
  slope: number;
  frontCenter: number;
  backCenter: number;
  curveDelta: number;
  spotOffset: number;
}): { bias: ProjectionBias; confidence: "low" | "medium" | "high"; reasons: string[] } {
  const { currentPrice, slope, frontCenter, backCenter, curveDelta, spotOffset } = args;

  const reasons: string[] = [];
  let score = 0;

  const slopeThreshold = Math.max(0.002, currentPrice * 0.00008);
  const curveThreshold = currentPrice * 0.03;
  const spotThreshold = 0.03;

  if (slope > slopeThreshold) {
    score += 1;
    reasons.push(`Forward OI slope is positive at ${slope.toFixed(4)} / day.`);
  } else if (slope < -slopeThreshold) {
    score -= 1;
    reasons.push(`Forward OI slope is negative at ${slope.toFixed(4)} / day.`);
  } else {
    reasons.push(`Forward OI slope is mostly flat at ${slope.toFixed(4)} / day.`);
  }

  if (curveDelta > curveThreshold) {
    score += 2;
    reasons.push(
      `Back expirations are meaningfully above front expirations (${frontCenter.toFixed(
        2
      )} → ${backCenter.toFixed(2)}).`
    );
  } else if (curveDelta < -curveThreshold) {
    score -= 2;
    reasons.push(
      `Back expirations are meaningfully below front expirations (${frontCenter.toFixed(
        2
      )} → ${backCenter.toFixed(2)}).`
    );
  } else {
    reasons.push(
      `Front and back expiration centers are close (${frontCenter.toFixed(
        2
      )} → ${backCenter.toFixed(2)}).`
    );
  }

  if (spotOffset > spotThreshold) {
    score += 2;
    reasons.push(
      `Weighted OI path is above spot by ${(spotOffset * 100).toFixed(1)}%.`
    );
  } else if (spotOffset < -spotThreshold) {
    score -= 2;
    reasons.push(
      `Weighted OI path is below spot by ${(spotOffset * 100).toFixed(1)}%.`
    );
  } else {
    reasons.push(
      `Weighted OI path is near spot (${(spotOffset * 100).toFixed(1)}% offset).`
    );
  }

  const bias: ProjectionBias = score >= 2 ? "bullish" : score <= -2 ? "bearish" : "neutral";
  const confidence =
    Math.abs(score) >= 4 ? "high" : Math.abs(score) >= 2 ? "medium" : "low";

  return { bias, confidence, reasons };
}

function buildPoint(args: {
  chain: ExpirationChain;
  snapshotDate: string;
  currentPrice: number;
}): OIProjectionPoint {
  const intelligence = analyzeOIIntelligence({
    rows: args.chain.rows,
    summary: args.chain.summary,
    currentPrice: args.currentPrice
  });

  const base = {
    expiration: args.chain.expiration,
    dte: dte(args.snapshotDate, args.chain.expiration),
    rawCenter: args.chain.summary.combinedCenter,
    adjustedCenter: intelligence.adjustedCenter,
    lowerRange: args.chain.summary.lowerRange,
    upperRange: args.chain.summary.upperRange,
    callWall: intelligence.adjustedCallWall,
    putWall: intelligence.adjustedPutWall,
    prevailingScore: args.chain.summary.prevailingScore,
    anomalyCount: intelligence.anomalies.length
  };

  return {
    ...base,
    weight: pointWeight({
      dte: base.dte,
      prevailingScore: base.prevailingScore,
      anomalyCount: base.anomalyCount
    })
  };
}

export function buildOIProjectionReport(args: {
  snapshot: ChainSnapshot | null;
  currentPrice: number;
}): OIProjectionReport | null {
  const { snapshot, currentPrice } = args;

  if (!snapshot || !snapshot.chains.length || !currentPrice) return null;

  const points = snapshot.chains
    .map((chain) =>
      buildPoint({
        chain,
        snapshotDate: snapshot.snapshotDate,
        currentPrice
      })
    )
    .filter((p) => Number.isFinite(p.adjustedCenter))
    .sort((a, b) => a.dte - b.dte);

  if (!points.length) return null;

  const slope = linearSlope(points);
  const front = points.slice(0, Math.min(3, points.length));
  const back = points.slice(Math.max(0, points.length - 3));

  const frontCenter = weightedAverage(front);
  const backCenter = weightedAverage(back);
  const curveDelta = backCenter - frontCenter;

  const weightedPathCenter = weightedAverage(points);
  const spotOffset = (weightedPathCenter - currentPrice) / currentPrice;

  const classification = classifyProjection({
    currentPrice,
    slope,
    frontCenter,
    backCenter,
    curveDelta,
    spotOffset
  });

  const summary =
    points.length < 2
      ? "Not enough expirations to build a forward OI path."
      : classification.bias === "bullish"
        ? `OI implied path has bullish structure: weighted centers sit above spot and/or rise across expirations.`
        : classification.bias === "bearish"
          ? `OI implied path has bearish structure: weighted centers sit below spot and/or decline across expirations.`
          : `OI implied path is mixed/neutral: forward centers do not show a strong directional skew.`;

  return {
    ticker: snapshot.ticker,
    snapshotDate: snapshot.snapshotDate,
    currentPrice,
    points,
    slope,
    frontCenter,
    backCenter,
    curveDelta,
    spotOffset,
    projectedBias: classification.bias,
    confidence: classification.confidence,
    reasons: classification.reasons,
    summary
  };
}