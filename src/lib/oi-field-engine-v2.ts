import type { OIImpliedPathResult } from "./oi-implied-path-engine";
import type { OIProjectionReport } from "./oi-projection-engine";
import type { TraderEdgeSummary } from "./trader-edge-engine";
import type { WallMigrationSummary } from "./oi-wall-migration-engine";

export type OIFieldHorizonBucket = "short" | "swing" | "wheel" | "expiration";
export type OIFieldBias = "bullish" | "bearish" | "neutral" | "mixed";
export type OIFieldPosture = "actionable" | "watch" | "defensive" | "stand_down";

export type OIFieldHorizonForecast = {
  key: string;
  label: string;
  sessions: number;
  bucket: OIFieldHorizonBucket;
  baseTarget: number | null;
  upperBand: number | null;
  lowerBand: number | null;
  expectedDriftPct: number | null;
  bias: OIFieldBias;
  confidenceScore: number;
  pinProbability: number;
  upperWallTouchProbability: number;
  lowerWallBreakProbability: number;
  trapProbability: number;
  wheelSupportHoldProbability: number | null;
  premiumSellerPosture: OIFieldPosture;
  readout: string;
};

export type OIFieldForecastResult = {
  version: "oi-field-v2";
  ticker: string;
  snapshotDate: string;
  currentPrice: number;
  selectedExpirationDte: number | null;
  regime: string;
  baseBias: OIFieldBias;
  confidenceScore: number;
  shortTermScore: number;
  swingScore: number;
  wheelScore: number;
  horizons: OIFieldHorizonForecast[];
  readout: string;
  engineNotes: string[];
};

type PathLike = Partial<OIImpliedPathResult> & Record<string, any>;

type BuildArgs = {
  path: PathLike | null;
  projectionReport?: OIProjectionReport | null;
  edgeSummary?: TraderEdgeSummary | null;
  wallMigration?: WallMigrationSummary | null;
  currentPrice?: number | null;
  selectedExpirationDte?: number | null;
};

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function avg(values: Array<number | null | undefined>): number | null {
  const clean = values.filter((value): value is number => Number.isFinite(value));
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function horizonBucket(sessions: number, isExpiration = false): OIFieldHorizonBucket {
  if (isExpiration) return "expiration";
  if (sessions <= 5) return "short";
  if (sessions <= 14) return "swing";
  return "wheel";
}

function horizonLabel(sessions: number, isExpiration = false): string {
  if (isExpiration) return `EXP / ${sessions}D`;
  return `${sessions}D`;
}

function pointValue(points: any[] | undefined, sessions: number, currentPrice: number): number | null {
  if (!Array.isArray(points) || !points.length || sessions <= 0) return null;

  const clean = points
    .map((point) => toNumber(point?.value ?? point?.price ?? point?.adjustedCenter))
    .filter((value): value is number => value != null && Number.isFinite(value));

  if (!clean.length) return null;

  const index = Math.min(clean.length - 1, Math.max(0, Math.round(sessions) - 1));

  if (sessions <= clean.length) return round(clean[index]);

  const last = clean[clean.length - 1];
  const slopePerSession = (last - currentPrice) / Math.max(1, clean.length);
  const extra = sessions - clean.length;
  const decay = Math.sqrt(Math.max(1, sessions) / Math.max(1, clean.length));

  return round(last + slopePerSession * extra * 0.45 / decay);
}

function inferBaseBias(args: {
  path?: PathLike | null;
  edge?: TraderEdgeSummary | null;
  wall?: WallMigrationSummary | null;
  projection?: OIProjectionReport | null;
}): OIFieldBias {
  const pathBias = String(args.path?.pathBias ?? "");
  if (pathBias === "bullish" || pathBias === "bearish" || pathBias === "neutral") return pathBias;

  if (args.wall?.migrationBias === "bullish") return "bullish";
  if (args.wall?.migrationBias === "bearish") return "bearish";
  if (args.edge?.optionsBias === "bullish") return "bullish";
  if (args.edge?.optionsBias === "bearish") return "bearish";
  if (args.projection?.projectedBias === "bullish") return "bullish";
  if (args.projection?.projectedBias === "bearish") return "bearish";
  if (args.projection?.projectedBias === "neutral") return "neutral";

  return "mixed";
}

function confidenceScore(args: {
  path?: PathLike | null;
  edge?: TraderEdgeSummary | null;
  wall?: WallMigrationSummary | null;
  projection?: OIProjectionReport | null;
}): number {
  const pathConfidence = String(args.path?.confidence ?? args.projection?.confidence ?? "low");
  let score = pathConfidence === "high" ? 72 : pathConfidence === "medium" ? 59 : 45;

  const dataQuality = toNumber(args.edge?.dataQualityScore);
  if (dataQuality != null) score += (dataQuality - 70) * 0.22;

  if (args.wall?.hasPrior) score += 7;
  if (!args.wall?.hasPrior) score -= 5;
  if (args.wall?.migrationBias === "unknown") score -= 3;

  const staleDays = toNumber(args.edge?.staleDays) ?? 0;
  if (staleDays >= 1) score -= staleDays * 6;

  const trapRisk = toNumber(args.edge?.trapRisk) ?? 0;
  if (trapRisk >= 75) score -= 8;
  if (trapRisk <= 35) score += 4;

  const pointCount = args.projection?.points?.length ?? 0;
  if (pointCount >= 3) score += 4;
  if (pointCount <= 1) score -= 5;

  return Math.round(clamp(score, 20, 92));
}

function directionalProbability(args: {
  currentPrice: number;
  target: number | null;
  baseBias: OIFieldBias;
  confidence: number;
  direction: "upper" | "lower";
  sessions: number;
  wallDistancePct?: number | null;
}): number {
  const { currentPrice, target, baseBias, confidence, direction, sessions } = args;
  const driftPct = target != null && currentPrice > 0 ? ((target - currentPrice) / currentPrice) * 100 : 0;
  const horizonBoost = clamp(Math.log1p(sessions) / Math.log1p(30), 0.25, 1.05);
  const confidenceBoost = (confidence - 55) * 0.22;
  const wallDistanceAdjustment = args.wallDistancePct != null ? clamp(10 - args.wallDistancePct * 0.9, -8, 10) : 0;

  let score = 36 + confidenceBoost + wallDistanceAdjustment * horizonBoost;

  if (direction === "upper") {
    score += driftPct * 2.2 * horizonBoost;
    if (baseBias === "bullish") score += 10;
    if (baseBias === "bearish") score -= 9;
  } else {
    score += -driftPct * 2.2 * horizonBoost;
    if (baseBias === "bearish") score += 10;
    if (baseBias === "bullish") score -= 9;
  }

  if (baseBias === "neutral" || baseBias === "mixed") score -= 2;

  return Math.round(clamp(score, 8, 88));
}

function pinProbability(args: {
  currentPrice: number;
  target: number | null;
  baseBias: OIFieldBias;
  edge?: TraderEdgeSummary | null;
  confidence: number;
  sessions: number;
}): number {
  const driftPct = args.target != null && args.currentPrice > 0 ? Math.abs((args.target - args.currentPrice) / args.currentPrice) * 100 : 0;
  const compression = String(args.edge?.compressionState ?? "");
  const pinSnapRisk = toNumber(args.edge?.pinSnapRiskScore) ?? 0;
  const confidenceBoost = (args.confidence - 55) * 0.18;
  const horizonPenalty = args.sessions > 14 ? (args.sessions - 14) * 0.45 : 0;

  let score = 62 - driftPct * 4.2 + confidenceBoost - horizonPenalty;
  if (compression.includes("High")) score += 14;
  if (compression.includes("Moderate")) score += 8;
  if (args.baseBias === "neutral" || args.baseBias === "mixed") score += 5;
  score += pinSnapRisk * 0.08;

  return Math.round(clamp(score, 10, 90));
}

function postureFrom(args: {
  bias: OIFieldBias;
  trapProbability: number;
  wheelHold: number | null;
  confidence: number;
  sessions: number;
}): OIFieldPosture {
  if (args.trapProbability >= 72) return "stand_down";
  if (args.confidence < 42) return "watch";
  if (args.wheelHold != null && args.wheelHold < 45) return "defensive";
  if (args.sessions >= 14 && args.wheelHold != null && args.wheelHold >= 62 && args.trapProbability <= 58) return "actionable";
  if (args.bias === "bullish" || args.bias === "bearish") return "watch";
  return "watch";
}

function biasFromDrift(driftPct: number | null, baseBias: OIFieldBias): OIFieldBias {
  if (driftPct == null) return baseBias;
  if (driftPct >= 1.2) return "bullish";
  if (driftPct <= -1.2) return "bearish";
  if (Math.abs(driftPct) <= 0.45) return "neutral";
  return baseBias;
}

function readoutFor(args: {
  label: string;
  bias: OIFieldBias;
  pin: number;
  upper: number;
  lower: number;
  trap: number;
  posture: OIFieldPosture;
}): string {
  if (args.trap >= 72) return `${args.label}: trap/chop risk dominates; require confirmation before adding premium.`;
  if (args.pin >= Math.max(args.upper, args.lower) + 10) return `${args.label}: pin/magnet behavior is the leading structure.`;
  if (args.upper > args.lower + 12) return `${args.label}: upside wall-touch/unlock pressure leads the map.`;
  if (args.lower > args.upper + 12) return `${args.label}: downside support test/break risk leads the map.`;
  if (args.posture === "actionable") return `${args.label}: premium-selling posture is constructive if strikes stay outside the active rails.`;
  return `${args.label}: mixed structure; use rails and validation rather than directional conviction.`;
}

function buildHorizon(args: {
  sessions: number;
  isExpiration?: boolean;
  currentPrice: number;
  path: PathLike | null;
  edge?: TraderEdgeSummary | null;
  baseBias: OIFieldBias;
  confidence: number;
}): OIFieldHorizonForecast {
  const target = pointValue(args.path?.basePath, args.sessions, args.currentPrice);
  const upperBand = pointValue(args.path?.upperBand, args.sessions, args.currentPrice);
  const lowerBand = pointValue(args.path?.lowerBand, args.sessions, args.currentPrice);
  const expectedDriftPct = target != null ? round(((target - args.currentPrice) / args.currentPrice) * 100, 2) : null;
  const bias = biasFromDrift(expectedDriftPct, args.baseBias);

  const invalidAbove = toNumber(args.path?.invalidAbove ?? args.edge?.resistance);
  const invalidBelow = toNumber(args.path?.invalidBelow ?? args.edge?.support);
  const upperDistancePct = invalidAbove != null ? Math.abs((invalidAbove - args.currentPrice) / args.currentPrice) * 100 : null;
  const lowerDistancePct = invalidBelow != null ? Math.abs((args.currentPrice - invalidBelow) / args.currentPrice) * 100 : null;

  const upperWallTouchProbability = directionalProbability({
    currentPrice: args.currentPrice,
    target,
    baseBias: bias,
    confidence: args.confidence,
    direction: "upper",
    sessions: args.sessions,
    wallDistancePct: upperDistancePct,
  });

  const lowerWallBreakProbability = directionalProbability({
    currentPrice: args.currentPrice,
    target,
    baseBias: bias,
    confidence: args.confidence,
    direction: "lower",
    sessions: args.sessions,
    wallDistancePct: lowerDistancePct,
  });

  const pin = pinProbability({
    currentPrice: args.currentPrice,
    target,
    baseBias: bias,
    edge: args.edge,
    confidence: args.confidence,
    sessions: args.sessions,
  });

  const trapBase = toNumber(args.edge?.trapRisk) ?? 45;
  const expansionPenalty = String(args.path?.regime ?? "").includes("expansion") ? 7 : 0;
  const shortHorizonChop = args.sessions <= 5 && pin >= 60 ? 7 : 0;
  const trapProbability = Math.round(clamp(trapBase * 0.68 + expansionPenalty + shortHorizonChop + Math.abs((expectedDriftPct ?? 0)) * 0.7, 8, 92));

  const support = toNumber(args.edge?.support ?? args.path?.invalidBelow);
  const supportDistancePct = support != null ? ((args.currentPrice - support) / args.currentPrice) * 100 : null;
  const wheelSupportHoldProbability = supportDistancePct == null
    ? null
    : Math.round(clamp(58 + supportDistancePct * 3.2 + args.confidence * 0.18 - trapProbability * 0.28 - lowerWallBreakProbability * 0.22, 8, 92));

  const premiumSellerPosture = postureFrom({
    bias,
    trapProbability,
    wheelHold: wheelSupportHoldProbability,
    confidence: args.confidence,
    sessions: args.sessions,
  });

  const label = horizonLabel(args.sessions, Boolean(args.isExpiration));
  const confidenceAdjustment = args.sessions >= 30 ? -4 : args.sessions <= 3 ? -2 : 0;
  const confidenceScore = Math.round(clamp(args.confidence + confidenceAdjustment, 10, 94));

  return {
    key: args.isExpiration ? "EXP" : `${args.sessions}D`,
    label,
    sessions: args.sessions,
    bucket: horizonBucket(args.sessions, Boolean(args.isExpiration)),
    baseTarget: target,
    upperBand,
    lowerBand,
    expectedDriftPct,
    bias,
    confidenceScore,
    pinProbability: pin,
    upperWallTouchProbability,
    lowerWallBreakProbability,
    trapProbability,
    wheelSupportHoldProbability,
    premiumSellerPosture,
    readout: readoutFor({
      label,
      bias,
      pin,
      upper: upperWallTouchProbability,
      lower: lowerWallBreakProbability,
      trap: trapProbability,
      posture: premiumSellerPosture,
    }),
  };
}

function scoreByBucket(horizons: OIFieldHorizonForecast[], bucket: OIFieldHorizonBucket): number {
  const rows = horizons.filter((row) => row.bucket === bucket);
  if (!rows.length) return 0;

  const values = rows.map((row) => {
    const constructive = Math.max(row.pinProbability, row.upperWallTouchProbability, row.wheelSupportHoldProbability ?? 0);
    const risk = Math.max(row.lowerWallBreakProbability * 0.7, row.trapProbability * 0.9);
    return clamp(constructive * 0.62 + row.confidenceScore * 0.38 - risk * 0.18, 0, 100);
  });

  return Math.round(avg(values) ?? 0);
}

export function buildOIFieldForecast(args: BuildArgs): OIFieldForecastResult | null {
  const path = args.path ?? null;
  const edge = args.edgeSummary ?? null;
  const projection = args.projectionReport ?? null;
  const wall = args.wallMigration ?? null;
  const currentPrice = toNumber(args.currentPrice) ?? toNumber(path?.currentPrice) ?? toNumber(edge?.analysisPrice) ?? toNumber(projection?.currentPrice);

  if (!currentPrice || currentPrice <= 0 || (!path && !edge && !projection)) return null;

  const selectedExpirationDte = toNumber(args.selectedExpirationDte);
  const baseBias = inferBaseBias({ path, edge, wall, projection });
  const confidence = confidenceScore({ path, edge, wall, projection });

  const horizonsToBuild = [1, 3, 5, 10, 14, 30];
  const horizons = horizonsToBuild.map((sessions) => buildHorizon({
    sessions,
    currentPrice,
    path,
    edge,
    baseBias,
    confidence,
  }));

  if (selectedExpirationDte != null && selectedExpirationDte > 0 && selectedExpirationDte <= 75 && !horizonsToBuild.includes(Math.round(selectedExpirationDte))) {
    horizons.push(buildHorizon({
      sessions: Math.round(selectedExpirationDte),
      isExpiration: true,
      currentPrice,
      path,
      edge,
      baseBias,
      confidence,
    }));
  }

  const sorted = horizons.sort((a, b) => a.sessions - b.sessions || a.key.localeCompare(b.key));
  const shortTermScore = scoreByBucket(sorted, "short");
  const swingScore = scoreByBucket(sorted, "swing");
  const wheelScore = Math.max(scoreByBucket(sorted, "wheel"), scoreByBucket(sorted, "expiration"));

  const best = sorted.slice().sort((a, b) => {
    const aEdge = Math.max(a.pinProbability, a.upperWallTouchProbability, a.wheelSupportHoldProbability ?? 0) - a.trapProbability * 0.6;
    const bEdge = Math.max(b.pinProbability, b.upperWallTouchProbability, b.wheelSupportHoldProbability ?? 0) - b.trapProbability * 0.6;
    return bEdge - aEdge;
  })[0];

  const engineNotes: string[] = [
    "OI Field v2 treats the option chain as a pressure field across multiple trading horizons, not a single price target.",
    "Short horizons emphasize reaction/pin behavior; 10D/14D emphasize swing follow-through; 30D/EXP emphasize wheel and premium-selling posture.",
  ];

  if (!wall?.hasPrior) engineNotes.push("No prior surface was available, so migration-sensitive confidence is reduced.");
  if ((edge?.staleDays ?? 0) > 0) engineNotes.push("Surface freshness is imperfect; validate levels against current candles before acting.");
  if ((edge?.trapRisk ?? 0) >= 70) engineNotes.push("Trap risk is elevated; the forecast should be read as a rail map rather than a clean directional call.");

  return {
    version: "oi-field-v2",
    ticker: String(path?.ticker ?? edge?.ticker ?? projection?.ticker ?? ""),
    snapshotDate: String(path?.snapshotDate ?? edge?.snapshotDate ?? projection?.snapshotDate ?? ""),
    currentPrice,
    selectedExpirationDte,
    regime: String(path?.regime ?? "mixed"),
    baseBias,
    confidenceScore: confidence,
    shortTermScore,
    swingScore,
    wheelScore,
    horizons: sorted,
    readout: best?.readout ?? "OI Field v2 needs more option/candle context before producing a useful horizon read.",
    engineNotes,
  };
}
