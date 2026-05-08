import { analyzeOIIntelligence } from "./oi-intelligence-engine";
import { ChainSnapshot, ExpirationChain } from "./types";

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
};

export type OIProjectionReport = {
  ticker: string;
  snapshotDate: string;
  currentPrice: number;
  points: OIProjectionPoint[];
  slope: number;
  projectedBias: "bullish" | "bearish" | "neutral";
  summary: string;
};

function dte(snapshotDate: string, expiration: string): number {
  const start = new Date(`${snapshotDate}T00:00:00Z`).getTime();
  const end = new Date(`${expiration}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((end - start) / (1000 * 60 * 60 * 24)));
}

function linearSlope(points: OIProjectionPoint[]): number {
  if (points.length < 2) return 0;

  const xs = points.map((p) => p.dte);
  const ys = points.map((p) => p.adjustedCenter);

  const xMean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const yMean = ys.reduce((s, y) => s + y, 0) / ys.length;

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

function classifyBias(slope: number, currentPrice: number): "bullish" | "bearish" | "neutral" {
  const threshold = Math.max(0.0025, currentPrice * 0.00025);

  if (slope > threshold) return "bullish";
  if (slope < -threshold) return "bearish";
  return "neutral";
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

  return {
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

  const slope = linearSlope(points);
  const projectedBias = classifyBias(slope, currentPrice);

  const nearest = points[0];
  const furthest = points.at(-1);

  const summary =
    points.length < 2
      ? "Not enough expirations to build a forward OI path."
      : projectedBias === "bullish"
        ? `OI implied path slopes upward from ${nearest.adjustedCenter.toFixed(
            2
          )} to ${furthest?.adjustedCenter.toFixed(2)} across the available expiration curve.`
        : projectedBias === "bearish"
          ? `OI implied path slopes downward from ${nearest.adjustedCenter.toFixed(
              2
            )} to ${furthest?.adjustedCenter.toFixed(2)} across the available expiration curve.`
          : `OI implied path is relatively flat across the available expiration curve.`;

  return {
    ticker: snapshot.ticker,
    snapshotDate: snapshot.snapshotDate,
    currentPrice,
    points,
    slope,
    projectedBias,
    summary
  };
}