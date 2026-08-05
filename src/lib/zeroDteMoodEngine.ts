export type ZeroDteIndex = "SPX" | "NDX" | "RUT";

export type ZeroDteMoodTradeBias =
  | "put-credit-spread"
  | "call-credit-spread"
  | "iron-fly"
  | "iron-condor"
  | "skewed-bullish-condor"
  | "skewed-bearish-condor"
  | "no-trade";

export type ZeroDteManualMoodMode = "fallback" | "force";

export type ZeroDteMoodSource =
  | "calculated-full"
  | "calculated-partial"
  | "manual-fallback"
  | "manual-forced"
  | "unavailable";

export type ZeroDteMoodCoverageLevel = "FULL" | "PARTIAL" | "UNAVAILABLE";
export type ZeroDteMoodCoverageStatus = "FULL" | "PARTIAL" | "MANUAL" | "UNAVAILABLE";

export type ZeroDteMoodCoverage = {
  status: ZeroDteMoodCoverageStatus;
  schwabOptionChain: ZeroDteMoodCoverageLevel;
  spxLeadership: ZeroDteMoodCoverageLevel;
  breadthInternals: ZeroDteMoodCoverageLevel;
  calculatedCoverageScore: number;
  summary: string;
};

export type ZeroDteMarketStage =
  | "acceleration"
  | "deceleration"
  | "accumulation"
  | "distribution"
  | "unknown";

export type ZeroDteMoodInput = {
  index?: ZeroDteIndex;
  moodRecommendationPercent?: number;

  /**
   * Optional manually supplied mood value.
   * "fallback" uses it only when calculated mood is unavailable.
   * "force" deliberately overrides a calculated mood.
   */
  manualMoodPercent?: number | null;
  manualMoodMode?: ZeroDteManualMoodMode;

  /** Schwab SPX/SPY chain availability for source-aware coverage display. */
  optionChainCoverage?: "full" | "partial" | "unavailable";

  /** Index percent change from prior daily close. Example: +0.42 for +0.42%. */
  indexPctChange?: number | null;

  /** High-weight component pull versus index. Example: +0.25 means the top weights are pulling 0.25% stronger than the index. */
  highWeightPullPct?: number | null;

  /** Optional broad-market internals if they are connected from any supported feed. */
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
  source: ZeroDteMoodSource;
  manualMode: ZeroDteManualMoodMode;
  coverage: ZeroDteMoodCoverage;
  generatedAt: string;
  warnings: string[];
  information: string[];
  components: ZeroDteMoodComponent[];
  recommendationLabel: string;
};

export function buildZeroDteMoodRead(input: ZeroDteMoodInput): ZeroDteMoodRead {
  const index = input.index ?? "SPX";
  const threshold = clamp(input.moodRecommendationPercent ?? 40, 0, 100);
  const zoneStep = (100 - threshold) / 2;
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const manualMode: ZeroDteManualMoodMode =
    input.manualMoodMode === "force" ? "force" : "fallback";
  const manual = clean(input.manualMoodPercent);

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

  const available = components.filter((component) => component.available && component.contribution !== null);
  const totalWeight = available.reduce((sum, component) => sum + component.weight, 0);
  const totalContribution = available.reduce((sum, component) => sum + (component.contribution ?? 0), 0);
  const maxWeight = components.reduce((sum, component) => sum + component.weight, 0);
  const calculatedCoverageScore =
    maxWeight > 0 ? Math.round((totalWeight / maxWeight) * 100) : 0;
  const calculatedRawMood =
    totalWeight > 0
      ? clamp((totalContribution / totalWeight) * 50, -100, 100)
      : null;
  const calculatedUsable =
    calculatedRawMood !== null && calculatedCoverageScore >= 25;

  const leadership = inferLeadershipCoverage(input);
  const breadth = inferBreadthCoverage(input);
  const optionChain = normalizeCoverageLevel(input.optionChainCoverage);
  const calculatedStatus: ZeroDteMoodCoverageStatus =
    calculatedUsable && leadership === "FULL" && breadth === "FULL" && calculatedCoverageScore >= 80
      ? "FULL"
      : calculatedUsable
        ? "PARTIAL"
        : "UNAVAILABLE";

  let moodPercent: number | null = null;
  let rawMoodPercent: number | null = null;
  let source: ZeroDteMoodSource = "unavailable";
  let coverageStatus: ZeroDteMoodCoverageStatus = calculatedStatus;

  if (manual !== null && manualMode === "force") {
    moodPercent = clamp(manual, -100, 100);
    rawMoodPercent = moodPercent;
    source = "manual-forced";
    coverageStatus = "MANUAL";
  } else if (calculatedUsable) {
    moodPercent = calculatedRawMood;
    rawMoodPercent = calculatedRawMood;
    source = calculatedStatus === "FULL" ? "calculated-full" : "calculated-partial";
  } else if (manual !== null) {
    moodPercent = clamp(manual, -100, 100);
    rawMoodPercent = moodPercent;
    source = "manual-fallback";
    coverageStatus = "MANUAL";
  }

  const tradeBias =
    moodPercent === null
      ? "no-trade"
      : classifyMood(moodPercent, threshold, zoneStep);
  const activeCoverageScore =
    source === "manual-fallback" || source === "manual-forced"
      ? 100
      : calculatedCoverageScore;
  const confidence =
    moodPercent === null
      ? 0
      : confidenceForMood(moodPercent, threshold, activeCoverageScore);

  const information: string[] = [];
  if (coverageStatus === "FULL") {
    information.push(
      "Full calculated SPX mood: leadership and breadth internals are available.",
    );
  } else if (coverageStatus === "PARTIAL") {
    information.push(
      "Partial calculated SPX mood: available SPX leadership components are active while one or more breadth internals are unavailable.",
    );
  } else if (coverageStatus === "MANUAL") {
    information.push(
      source === "manual-forced"
        ? "Manual mood is deliberately forced over the calculated read."
        : "Manual mood fallback is active because a usable calculated mood is unavailable.",
    );
  } else {
    information.push(
      "No usable SPX mood is currently available; Schwab chain, map, dealer, strike-flow, and portfolio logic remain active.",
    );
  }

  if (breadth !== "FULL") {
    information.push(
      "TICK, UVOL/DVOL, and advance-decline coverage is incomplete; this reduces mood confidence but does not disable strategy selection.",
    );
  }

  const coverage: ZeroDteMoodCoverage = {
    status: coverageStatus,
    schwabOptionChain: optionChain,
    spxLeadership: leadership,
    breadthInternals: breadth,
    calculatedCoverageScore,
    summary: coverageSummary({
      status: coverageStatus,
      optionChain,
      leadership,
      breadth,
      source,
    }),
  };

  return {
    index,
    moodPercent,
    rawMoodPercent,
    threshold,
    zoneStep,
    tradeBias,
    directionalBias:
      moodPercent === null
        ? "unknown"
        : directionalBiasForMood(moodPercent, threshold),
    confidence,
    coverageScore: activeCoverageScore,
    source,
    manualMode,
    coverage,
    generatedAt,
    warnings: [],
    information,
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


function inferLeadershipCoverage(input: ZeroDteMoodInput): ZeroDteMoodCoverageLevel {
  const core = [
    clean(input.indexPctChange),
    clean(input.highWeightPullPct),
  ];
  const trend = clean(input.highWeightTrend);
  const availableCore = core.filter((value) => value !== null).length;

  if (availableCore === core.length && trend !== null) return "FULL";
  if (availableCore > 0 || trend !== null) return "PARTIAL";
  return "UNAVAILABLE";
}

function inferBreadthCoverage(input: ZeroDteMoodInput): ZeroDteMoodCoverageLevel {
  const core = [
    clean(input.tick),
    clean(input.uvolDvolRatio),
    clean(input.advanceDecline),
  ];
  const trends = [
    clean(input.tickTrend),
    clean(input.uvolDvolTrend),
    clean(input.advanceDeclineTrend),
  ];
  const availableCore = core.filter((value) => value !== null).length;
  const availableTrends = trends.filter((value) => value !== null).length;

  if (availableCore === core.length && availableTrends >= 2) return "FULL";
  if (availableCore > 0 || availableTrends > 0) return "PARTIAL";
  return "UNAVAILABLE";
}

function normalizeCoverageLevel(
  value: ZeroDteMoodInput["optionChainCoverage"],
): ZeroDteMoodCoverageLevel {
  if (value === "full") return "FULL";
  if (value === "partial") return "PARTIAL";
  return "UNAVAILABLE";
}

function coverageSummary(args: {
  status: ZeroDteMoodCoverageStatus;
  optionChain: ZeroDteMoodCoverageLevel;
  leadership: ZeroDteMoodCoverageLevel;
  breadth: ZeroDteMoodCoverageLevel;
  source: ZeroDteMoodSource;
}) {
  if (args.status === "MANUAL") {
    return args.source === "manual-forced"
      ? "Manual mood forced; calculated coverage remains visible for comparison."
      : "Manual mood fallback active because calculated SPX mood is unavailable.";
  }
  if (args.status === "FULL") {
    return "Full calculated SPX mood coverage.";
  }
  if (args.status === "PARTIAL") {
    return `Partial calculated mood: leadership ${args.leadership.toLowerCase()}, breadth ${args.breadth.toLowerCase()}.`;
  }
  return args.optionChain === "FULL"
    ? "Schwab chain coverage is available, but no calculated or manual mood is active."
    : "SPX mood inputs are unavailable.";
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
