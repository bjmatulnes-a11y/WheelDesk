export type ZeroDteIndex = "SPX" | "NDX" | "RUT";

export type ZeroDteMoodTradeBias =
  | "put-credit-spread"
  | "call-credit-spread"
  | "iron-fly"
  | "iron-condor"
  | "skewed-bullish-condor"
  | "skewed-bearish-condor"
  | "no-trade";

export type ZeroDteMarketStage =
  | "acceleration"
  | "deceleration"
  | "accumulation"
  | "distribution"
  | "unknown";

export type ZeroDteMoodInput = {
  index?: ZeroDteIndex;
  moodRecommendationPercent?: number;

  /** Manual override from the Thinkorswim mood study. If provided, it becomes the primary mood value. */
  manualMoodPercent?: number | null;

  /** Index percent change from prior daily close. Example: +0.42 for +0.42%. */
  indexPctChange?: number | null;

  /** High-weight component pull versus index. Example: +0.25 means the top weights are pulling 0.25% stronger than the index. */
  highWeightPullPct?: number | null;

  /** Optional internals if you later source them from TOS/broker feed. */
  tick?: number | null;
  uvolDvolRatio?: number | null;
  advanceDecline?: number | null;
  marketStage?: ZeroDteMarketStage | null;

  /** Optional trend deltas. Use +1 rising, -1 falling, 0 flat/unknown. */
  highWeightTrend?: number | null;
  tickTrend?: number | null;
  uvolDvolTrend?: number | null;
  advanceDeclineTrend?: number | null;

  source?: string;
  generatedAt?: string;
};

export type ZeroDteMoodComponent = {
  name: string;
  value: number | null;
  points: number | null;
  weight: number;
  contribution: number | null;
  available: boolean;
};

export type ZeroDteMoodRead = {
  index: ZeroDteIndex;
  moodPercent: number | null;
  rawMoodPercent: number | null;
  threshold: number;
  zoneStep: number;
  tradeBias: ZeroDteMoodTradeBias;
  directionalBias: "bullish" | "bearish" | "neutral" | "unknown";
  confidence: number;
  coverageScore: number;
  source: "manual-tos-mood" | "partial-market-data" | "unavailable";
  generatedAt: string;
  warnings: string[];
  components: ZeroDteMoodComponent[];
  recommendationLabel: string;
};

export function buildZeroDteMoodRead(input: ZeroDteMoodInput): ZeroDteMoodRead {
  const index = input.index ?? "SPX";
  const threshold = clamp(input.moodRecommendationPercent ?? 40, 0, 100);
  const zoneStep = (100 - threshold) / 2;
  const generatedAt = input.generatedAt ?? new Date().toISOString();

  const manual = clean(input.manualMoodPercent);
  if (manual !== null) {
    const moodPercent = clamp(manual, -100, 100);
    const tradeBias = classifyMood(moodPercent, threshold, zoneStep);
    return {
      index,
      moodPercent,
      rawMoodPercent: moodPercent,
      threshold,
      zoneStep,
      tradeBias,
      directionalBias: directionalBiasForMood(moodPercent, threshold),
      confidence: confidenceForMood(moodPercent, threshold, 100),
      coverageScore: 100,
      source: "manual-tos-mood",
      generatedAt,
      warnings: [],
      components: [],
      recommendationLabel: labelForTradeBias(tradeBias),
    };
  }

  const weights = componentWeights(index);
  const components: ZeroDteMoodComponent[] = [
    makeComponent("Index Change", indexChangePoints(index, input.indexPctChange), weights.indexChange, input.indexPctChange),
    makeComponent("High Weight Pull", highWeightPullPoints(index, input.highWeightPullPct), weights.highWeightPull, input.highWeightPullPct),
    makeComponent("High Weight Trend", trendPoints(input.highWeightTrend), weights.highWeightTrend, input.highWeightTrend),
    makeComponent("TICK", tickPoints(input.tick), weights.tick, input.tick),
    makeComponent("TICK Trend", trendPoints(input.tickTrend), weights.tickTrend, input.tickTrend),
    makeComponent("UVOL/DVOL", uvolDvolPoints(input.uvolDvolRatio), weights.uvolDvol, input.uvolDvolRatio),
    makeComponent("UVOL/DVOL Trend", trendPoints(input.uvolDvolTrend), weights.uvolDvolTrend, input.uvolDvolTrend),
    makeComponent("Advance/Decline", advanceDeclinePoints(index, input.advanceDecline), weights.advanceDecline, input.advanceDecline),
    makeComponent("A/D Trend", trendPoints(input.advanceDeclineTrend), weights.advanceDeclineTrend, input.advanceDeclineTrend),
    makeComponent("Market Stage", marketStagePoints(input.marketStage), weights.marketStage, input.marketStage === undefined ? null : stageNumeric(input.marketStage)),
  ];

  const available = components.filter((c) => c.available && c.contribution !== null);
  const totalWeight = available.reduce((sum, c) => sum + c.weight, 0);
  const totalContribution = available.reduce((sum, c) => sum + (c.contribution ?? 0), 0);
  const maxWeight = components.reduce((sum, c) => sum + c.weight, 0);
  const coverageScore = maxWeight > 0 ? Math.round((totalWeight / maxWeight) * 100) : 0;

  const rawMoodPercent = totalWeight > 0 ? clamp((totalContribution / totalWeight) * 50, -100, 100) : null;
  const moodPercent = rawMoodPercent;

  const tradeBias = moodPercent === null || coverageScore < 25 ? "no-trade" : classifyMood(moodPercent, threshold, zoneStep);
  const confidence = moodPercent === null ? 0 : confidenceForMood(moodPercent, threshold, coverageScore);
  const warnings: string[] = [];

  if (coverageScore < 60) {
    warnings.push("Mood read is partial because live TICK/UVOL-DVOL/A-D internals are not available from the current data feed.");
  }
  if (coverageScore < 25) {
    warnings.push("Coverage is too low for credit-spread strategy selection. Enter the TOS mood value manually or connect internals.");
  }

  return {
    index,
    moodPercent,
    rawMoodPercent,
    threshold,
    zoneStep,
    tradeBias,
    directionalBias: moodPercent === null ? "unknown" : directionalBiasForMood(moodPercent, threshold),
    confidence,
    coverageScore,
    source: moodPercent === null ? "unavailable" : "partial-market-data",
    generatedAt,
    warnings,
    components,
    recommendationLabel: labelForTradeBias(tradeBias),
  };
}

export function classifyMood(moodPercent: number, threshold = 40, zoneStep = (100 - threshold) / 2): ZeroDteMoodTradeBias {
  if (!Number.isFinite(moodPercent)) return "no-trade";
  if (moodPercent > threshold + zoneStep) return "put-credit-spread";
  if (moodPercent > threshold) return "skewed-bullish-condor";
  if (moodPercent < -threshold - zoneStep) return "call-credit-spread";
  if (moodPercent < -threshold) return "skewed-bearish-condor";
  return "iron-condor";
}

export function labelForTradeBias(bias: ZeroDteMoodTradeBias) {
  switch (bias) {
    case "put-credit-spread":
      return "Put Credit Spread";
    case "call-credit-spread":
      return "Call Credit Spread";
    case "skewed-bullish-condor":
      return "Skewed Bullish Iron Condor";
    case "skewed-bearish-condor":
      return "Skewed Bearish Iron Condor";
    case "iron-fly":
      return "Iron Fly";
    case "iron-condor":
      return "Iron Condor / Iron Fly Zone";
    default:
      return "No Trade";
  }
}

function componentWeights(index: ZeroDteIndex) {
  if (index === "NDX") {
    return { indexChange: 0.75, highWeightPull: 1.25, highWeightTrend: 1.5, tick: 1, tickTrend: 1.5, uvolDvol: 1, uvolDvolTrend: 1.5, advanceDecline: 0.75, advanceDeclineTrend: 1.25, marketStage: 1 };
  }
  if (index === "RUT") {
    return { indexChange: 1, highWeightPull: 0.75, highWeightTrend: 1, tick: 1, tickTrend: 1.5, uvolDvol: 1, uvolDvolTrend: 1.75, advanceDecline: 1, advanceDeclineTrend: 1.75, marketStage: 1 };
  }
  return { indexChange: 0.75, highWeightPull: 1, highWeightTrend: 1.5, tick: 1, tickTrend: 1.5, uvolDvol: 1, uvolDvolTrend: 1.5, advanceDecline: 1, advanceDeclineTrend: 1.5, marketStage: 1 };
}

function makeComponent(name: string, points: number | null, weight: number, value: unknown): ZeroDteMoodComponent {
  const available = points !== null;
  return {
    name,
    value: typeof value === "number" && Number.isFinite(value) ? value : null,
    points,
    weight,
    contribution: available ? (points ?? 0) * weight : null,
    available,
  };
}

function indexChangePoints(index: ZeroDteIndex, pct: number | null | undefined) {
  const value = clean(pct);
  if (value === null) return null;
  const range = 0.25;
  if (value > range * 6) return 2;
  if (value > range * 4) return 1.5;
  if (value > range) return 1;
  if (value < range * -6) return -2;
  if (value < range * -4) return -1.5;
  if (value < range * -1) return -1;
  return 0;
}

function highWeightPullPoints(index: ZeroDteIndex, pct: number | null | undefined) {
  const value = clean(pct);
  if (value === null) return null;

  if (index === "NDX") {
    if (value > 0.5) return 2;
    if (value > 0.35) return 1;
    if (value > 0.2) return 0.5;
    if (value < -0.5) return -2;
    if (value < -0.35) return -1;
    if (value < -0.2) return -0.5;
    return 0;
  }

  if (index === "RUT") {
    if (value > 2.0) return 2;
    if (value > 1.5) return 1;
    if (value > 1.0) return 0.5;
    if (value < -2.0) return -2;
    if (value < -1.5) return -1;
    if (value < -1.0) return -0.5;
    return 0;
  }

  if (value > 1.5) return 2;
  if (value > 0.75) return 1;
  if (value > 0.35) return 0.5;
  if (value < -1.5) return -2;
  if (value < -0.75) return -1;
  if (value < -0.35) return -0.5;
  return 0;
}

function tickPoints(tick: number | null | undefined) {
  const value = clean(tick);
  if (value === null) return null;
  if (value > 50) return 1;
  if (value < -50) return -1;
  return 0;
}

function uvolDvolPoints(ratio: number | null | undefined) {
  const value = clean(ratio);
  if (value === null) return null;
  const range = 1.2;
  if (value > range * 3) return 3;
  if (value > range * 2) return 2;
  if (value > range) return 1;
  if (value < -range * 3) return -3;
  if (value < -range * 2) return -2;
  if (value < -range) return -1;
  return 0;
}

function advanceDeclinePoints(index: ZeroDteIndex, add: number | null | undefined) {
  const value = clean(add);
  if (value === null) return null;

  if (index === "NDX") {
    if (value > 2000) return 3;
    if (value > 1500) return 2;
    if (value > 500) return 1;
    if (value < -2000) return -3;
    if (value < -1500) return -2;
    if (value < -500) return -1;
    return 0;
  }

  if (index === "RUT") {
    if (value > 1250) return 3;
    if (value > 750) return 2;
    if (value > 250) return 1;
    if (value < -1250) return -3;
    if (value < -750) return -2;
    if (value < -250) return -1;
    return 0;
  }

  if (value > 300) return 3;
  if (value > 200) return 2;
  if (value > 50) return 1;
  if (value < -300) return -3;
  if (value < -200) return -2;
  if (value < -50) return -1;
  return 0;
}

function trendPoints(value: number | null | undefined) {
  const trend = clean(value);
  if (trend === null) return null;
  if (trend > 0) return 1;
  if (trend < 0) return -1;
  return 0;
}

function marketStagePoints(stage: ZeroDteMarketStage | null | undefined) {
  if (!stage || stage === "unknown") return null;
  if (stage === "acceleration") return 2;
  if (stage === "deceleration") return -2;
  if (stage === "accumulation") return 1;
  if (stage === "distribution") return -1;
  return null;
}

function stageNumeric(stage: ZeroDteMarketStage | null | undefined) {
  const points = marketStagePoints(stage);
  return points === null ? null : points;
}

function directionalBiasForMood(moodPercent: number, threshold: number): ZeroDteMoodRead["directionalBias"] {
  if (moodPercent > threshold) return "bullish";
  if (moodPercent < -threshold) return "bearish";
  return "neutral";
}

function confidenceForMood(moodPercent: number, threshold: number, coverageScore: number) {
  const distance = Math.max(0, Math.abs(moodPercent) - threshold);
  const distanceScore = clamp((distance / Math.max(1, 100 - threshold)) * 100, 0, 100);
  return Math.round(clamp(distanceScore * 0.65 + coverageScore * 0.35, 0, 100));
}

function clean(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
