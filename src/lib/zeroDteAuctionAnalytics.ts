import {
  ES_TICK,
  candleShapeProxyPct,
  historicalCandleMatchesSession,
  reconstructHistoricalCandleFootprint,
  type HistoricalEsCandle,
  type HistoricalFootprintCell,
} from "./zeroDteHistoricalFootprint";

export type AuctionState =
  | "WARMING"
  | "BALANCED"
  | "ACCEPTANCE"
  | "RELEASE_UP"
  | "RELEASE_DOWN"
  | "STALL_HIGH"
  | "STALL_LOW"
  | "EXHAUSTION_UP"
  | "EXHAUSTION_DOWN"
  | "REJECTION_HIGH"
  | "REJECTION_LOW";

export type AuctionProfileNode = "POC" | "HVN" | "LVN" | "NORMAL";
export type AuctionPocPosition = "ABOVE" | "BELOW" | "AT";
/**
 * Renamed from AuctionDeltaDivergence. This detects "new extreme with a weak
 * close" — a price pattern, not tape divergence. See detectFailedExtreme().
 */
export type AuctionFailedExtreme = "BEARISH" | "BULLISH" | "NONE";
/** Renamed from AuctionDeltaReversal. Shape-proxy swing, not tape delta. */
export type AuctionShapeReversal = "BEARISH" | "BULLISH" | "NONE";
export type AuctionPocMomentum = "UP" | "DOWN" | "STALLED";

export type HistoricalAuctionMinute = {
  time: number;
  label: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  developingPoc: number;
  distanceFromPoc: number;
  pocPosition: AuctionPocPosition;
  pocMigration5m: number;
  pocMomentum: AuctionPocMomentum;
  node: AuctionProfileNode;
  /** Synthetic candle-shape proxy. NOT order-flow delta. 56*body + 34*closeLoc. */
  shapeProxyPct: number;
  volumeZ: number;
  rangeZ: number;
  efficiency5mPct: number;
  failedExtreme: AuctionFailedExtreme;
  shapeReversal: AuctionShapeReversal;
  acceptanceScore: number;
  releaseUpScore: number;
  releaseDownScore: number;
  stallHighScore: number;
  stallLowScore: number;
  exhaustionUpScore: number;
  exhaustionDownScore: number;
  rejectionHighScore: number;
  rejectionLowScore: number;
  centerConfidence: number;
  callFadeScore: number;
  putFadeScore: number;
  state: AuctionState;
  stateScore: number;
  /** Margin of the winning state over its own gate. Drives tie/ambiguity logic. */
  stateMargin: number;
  /** True when the top two eligible states are directional opposites within AMBIGUITY_BAND. */
  stateAmbiguous: boolean;
  features: string[];
};


export type AuctionConfluenceTier =
  | "NO_MATCH"
  | "DEFINITIVE"
  | "CONFIRMED"
  | "SUPPORTIVE"
  | "MIXED"
  | "NEUTRAL"
  /** Too little evidence either way — distinct from NEUTRAL ("balanced evidence"). */
  | "INSUFFICIENT"
  | "CONFLICT";

/**
 * CONCURRENT — the auction read and the signal coincide.
 * LATE        — the move the signal wanted to fade has already released.
 */
export type AuctionConfluenceTiming = "CONCURRENT" | "LATE" | "UNKNOWN";

export type AuctionConfluenceTarget = "CALL_FADE" | "PUT_FADE" | "CENTER";

export type AuctionConfluenceEvaluation = {
  target: AuctionConfluenceTarget;
  tier: AuctionConfluenceTier;
  convictionScore: number;
  ownScore: number;
  opposingScore: number;
  edge: number;
  alignedEvidence: string[];
  opposingEvidence: string[];
  /**
   * How many INDEPENDENT evidence families support the read (max 2 today:
   * SHAPE and VOLUME). DEFINITIVE requires 2. With a real tape this can reach 3.
   */
  independentFamilies: number;
  timing: AuctionConfluenceTiming;
  summary: string;
};

export type HistoricalAuctionSummary = {
  minutes: HistoricalAuctionMinute[];
  counts: Record<AuctionState, number>;
  featureCounts: {
    acceptance: number;
    release: number;
    stall: number;
    exhaustion: number;
    rejection: number;
    bearishFailedExtreme: number;
    bullishFailedExtreme: number;
    thinZone: number;
  };
  topCallFade: HistoricalAuctionMinute[];
  topPutFade: HistoricalAuctionMinute[];
  topCenters: HistoricalAuctionMinute[];
};

type MutableCell = HistoricalFootprintCell;

const STATES: AuctionState[] = [
  "WARMING",
  "BALANCED",
  "ACCEPTANCE",
  "RELEASE_UP",
  "RELEASE_DOWN",
  "STALL_HIGH",
  "STALL_LOW",
  "EXHAUSTION_UP",
  "EXHAUSTION_DOWN",
  "REJECTION_HIGH",
  "REJECTION_LOW",
];

export function buildHistoricalAuctionAnalytics(args: {
  candles: HistoricalEsCandle[];
  date: string;
  session?: "RTH" | "FULL";
}): HistoricalAuctionSummary {
  const session = args.session ?? "RTH";
  const candles = args.candles
    .filter(isFiniteCandle)
    .filter((candle) => historicalCandleMatchesSession(candle, args.date, session))
    .sort((a, b) => a.time - b.time);

  const profile = new Map<number, MutableCell>();
  const minutes: HistoricalAuctionMinute[] = [];
  const pocHistory: number[] = [];
  const shapeHistory: number[] = [];
  const volumeHistory: number[] = [];
  const rangeHistory: number[] = [];

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const cells = reconstructHistoricalCandleFootprint(candle);
    for (const cell of cells) mergeCell(profile, cell);

    const developingPoc = findPoc(profile) ?? roundToTick(candle.close);
    pocHistory.push(developingPoc);

    // Closed form; identical to summing the synthetic cells but avoids implying
    // the value came from a tape. shapeProxyPct = 56*body + 34*closeLocation.
    const shapeProxyPct = candleShapeProxyPct(candle);
    shapeHistory.push(shapeProxyPct);

    const range = Math.max(ES_TICK, candle.high - candle.low);
    const volumeZ = zScore(candle.volume, volumeHistory.slice(-20));
    const rangeZ = zScore(range, rangeHistory.slice(-20));
    volumeHistory.push(candle.volume);
    rangeHistory.push(range);

    // classifyNode previously re-sorted the entire profile every minute
    // (O(N log N) per bar, the page's dominant cost). The ranker below sorts once
    // per bar over the volume array only, and reuses it for both node and POC.
    const node = classifyNode(profile, roundToTick(candle.close), developingPoc);
    const distanceFromPoc = candle.close - developingPoc;
    const pocPosition: AuctionPocPosition =
      Math.abs(distanceFromPoc) <= ES_TICK * 2
        ? "AT"
        : distanceFromPoc > 0
          ? "ABOVE"
          : "BELOW";
    const pocMigration5m = developingPoc - (pocHistory[Math.max(0, index - 5)] ?? developingPoc);
    const pocMomentum: AuctionPocMomentum =
      pocMigration5m >= ES_TICK * 3
        ? "UP"
        : pocMigration5m <= -ES_TICK * 3
          ? "DOWN"
          : "STALLED";

    const efficiency5mPct = pathEfficiency(candles, index, 5);
    const upperWickPct = clamp(
      ((candle.high - Math.max(candle.open, candle.close)) / range) * 100,
      0,
      100,
    );
    const lowerWickPct = clamp(
      ((Math.min(candle.open, candle.close) - candle.low) / range) * 100,
      0,
      100,
    );
    const closeLocationPct = clamp(((candle.close - candle.low) / range) * 100, 0, 100);

    // Both windows now exclude the current bar with the same convention.
    const priorShape3 = mean(shapeHistory.slice(Math.max(0, index - 3), index));
    const priorVolume3 = mean(volumeHistory.slice(Math.max(0, index - 3), index));
    const close3m = candle.close - (candles[Math.max(0, index - 3)]?.close ?? candle.close);
    const close5m = candle.close - (candles[Math.max(0, index - 5)]?.close ?? candle.close);
    const previousHigh = max(candles.slice(Math.max(0, index - 5), index).map((item) => item.high));
    const previousLow = min(candles.slice(Math.max(0, index - 5), index).map((item) => item.low));

    const failedExtreme = detectFailedExtreme({
      candle,
      previousHigh,
      previousLow,
      shapeProxyPct,
      priorShape3,
    });
    const shapeReversal = detectShapeReversal(shapeHistory, index);

    const visitsNearPoc = candles
      .slice(Math.max(0, index - 7), index + 1)
      .filter((item) => Math.abs(item.close - developingPoc) <= 1).length;

    const proximityScore = clamp(100 - Math.abs(distanceFromPoc) * 28, 0, 100);
    const nodeAcceptanceScore =
      node === "POC" ? 100 : node === "HVN" ? 85 : node === "NORMAL" ? 38 : 8;
    const revisitScore = clamp((visitsNearPoc / 6) * 100, 0, 100);
    const slowTradeScore = 100 - efficiency5mPct;
    const pocStabilityScore = clamp(100 - Math.abs(pocMigration5m) * 35, 0, 100);
    const balancedShapeScore = clamp(100 - Math.abs(shapeProxyPct) * 1.2, 0, 100);

    const acceptanceScore = weighted([
      [proximityScore, 0.24],
      [nodeAcceptanceScore, 0.20],
      [revisitScore, 0.18],
      [slowTradeScore, 0.16],
      [pocStabilityScore, 0.22],
    ]);

    const activityScore = clamp(50 + volumeZ * 22, 0, 100);
    const rangeActivityScore = clamp(50 + rangeZ * 22, 0, 100);
    const thinScore = node === "LVN" ? 100 : node === "NORMAL" ? 55 : node === "HVN" ? 20 : 0;
    const distanceScore = clamp(Math.abs(distanceFromPoc) * 24, 0, 100);
    const pocUpScore = pocMomentum === "UP" ? 100 : pocMomentum === "STALLED" ? 45 : 0;
    const pocDownScore = pocMomentum === "DOWN" ? 100 : pocMomentum === "STALLED" ? 45 : 0;
    const upDirectionScore = clamp(50 + close5m * 10, 0, 100);
    const downDirectionScore = clamp(50 - close5m * 10, 0, 100);

    const releaseUpScore = weighted([
      [efficiency5mPct, 0.34],
      [rangeActivityScore, 0.16],
      [thinScore, 0.15],
      [distanceScore, 0.12],
      [pocUpScore, 0.10],
      [upDirectionScore, 0.13],
    ]);
    const releaseDownScore = weighted([
      [efficiency5mPct, 0.34],
      [rangeActivityScore, 0.16],
      [thinScore, 0.15],
      [distanceScore, 0.12],
      [pocDownScore, 0.10],
      [downDirectionScore, 0.13],
    ]);

    const failureToProgress = 100 - efficiency5mPct;
    const upperLocationScore = clamp(48 + Math.max(0, distanceFromPoc) * 18, 0, 100);
    const lowerLocationScore = clamp(48 + Math.max(0, -distanceFromPoc) * 18, 0, 100);

    // STALL replaces the former ABSORPTION states.
    //
    // The prior formula was self-contradictory: `buyPressureScore` was derived from
    // the shape proxy, which is high only when the body/close is strongly up — which
    // mechanically raises efficiency and collapses `failureToProgress`. The two
    // heaviest terms (0.24 and 0.26) were negatively coupled, so no candle shape
    // could satisfy both. Genuine absorption (heavy buying met by a resting seller)
    // is undetectable without trade-side classification, so we no longer claim it.
    //
    // What IS detectable from OHLCV: elevated participation that produced no
    // progress, with rejection at one extreme. That is a stall, and we name it so.
    const stallHighScore = weighted([
      [activityScore, 0.30],       // volume z-score: real participation
      [failureToProgress, 0.34],   // price went nowhere
      [upperWickPct, 0.22],        // rejected at the top
      [upperLocationScore, 0.14],  // occurring above the developing POC
    ]);
    const stallLowScore = weighted([
      [activityScore, 0.30],
      [failureToProgress, 0.34],
      [lowerWickPct, 0.22],
      [lowerLocationScore, 0.14],
    ]);

    const shapeFadeUp = clamp(50 + (priorShape3 - shapeProxyPct) * 1.5, 0, 100);
    const shapeFadeDown = clamp(50 + (shapeProxyPct - priorShape3) * 1.5, 0, 100);
    const volumeFade =
      priorVolume3 > 0 ? clamp(50 + ((priorVolume3 - candle.volume) / priorVolume3) * 90, 0, 100) : 50;
    const upPushScore = clamp(Math.max(close3m, close5m) * 16, 0, 100);
    const downPushScore = clamp(Math.max(-close3m, -close5m) * 16, 0, 100);
    const failedHighScore =
      previousHigh === null
        ? 40
        : candle.high <= previousHigh + ES_TICK
          ? 85
          : clamp(100 - (candle.high - previousHigh) * 25, 20, 90);
    const failedLowScore =
      previousLow === null
        ? 40
        : candle.low >= previousLow - ES_TICK
          ? 85
          : clamp(100 - (previousLow - candle.low) * 25, 20, 90);

    const exhaustionUpScore = weighted([
      [upPushScore, 0.20],
      [shapeFadeUp, 0.24],
      [volumeFade, 0.14],
      [failureToProgress, 0.18],
      [upperWickPct, 0.12],
      [failedHighScore, 0.12],
    ]);
    const exhaustionDownScore = weighted([
      [downPushScore, 0.20],
      [shapeFadeDown, 0.24],
      [volumeFade, 0.14],
      [failureToProgress, 0.18],
      [lowerWickPct, 0.12],
      [failedLowScore, 0.12],
    ]);

    const upperCloseReversalScore = clamp(100 - closeLocationPct, 0, 100);
    const lowerCloseReversalScore = clamp(closeLocationPct, 0, 100);
    const highTestScore =
      previousHigh === null
        ? 35
        : candle.high >= previousHigh - ES_TICK
          ? 100
          : clamp(70 - (previousHigh - candle.high) * 20, 0, 70);
    const lowTestScore =
      previousLow === null
        ? 35
        : candle.low <= previousLow + ES_TICK
          ? 100
          : clamp(70 - (candle.low - previousLow) * 20, 0, 70);

    const rejectionHighScore = weighted([
      [upperWickPct, 0.30],
      [upperCloseReversalScore, 0.25],
      [highTestScore, 0.22],
      [upperLocationScore, 0.13],
      [shapeFadeUp, 0.10],
    ]);
    const rejectionLowScore = weighted([
      [lowerWickPct, 0.30],
      [lowerCloseReversalScore, 0.25],
      [lowTestScore, 0.22],
      [lowerLocationScore, 0.13],
      [shapeFadeDown, 0.10],
    ]);

    const centerConfidence = weighted([
      [acceptanceScore, 0.55],
      [balancedShapeScore, 0.18],
      [pocStabilityScore, 0.17],
      [revisitScore, 0.10],
    ]);

    const bearishShapeScore =
      failedExtreme === "BEARISH" ? 100 : shapeReversal === "BEARISH" ? 85 : clamp(50 - shapeProxyPct, 0, 100);
    const bullishShapeScore =
      failedExtreme === "BULLISH" ? 100 : shapeReversal === "BULLISH" ? 85 : clamp(50 + shapeProxyPct, 0, 100);
    const upperPocContext =
      pocMomentum === "DOWN" ? 100 : pocMomentum === "STALLED" ? 78 : 25;
    const lowerPocContext =
      pocMomentum === "UP" ? 100 : pocMomentum === "STALLED" ? 78 : 25;

    // Weights rebalanced away from shape-derived terms. bearish/bullishShapeScore
    // is the same candle already counted inside exhaustion and rejection, so its
    // weight drops 0.16 -> 0.08 and the freed weight moves to the POC context,
    // which is the only genuinely volume-derived input here.
    const callFadeScore = weighted([
      [stallHighScore, 0.24],
      [exhaustionUpScore, 0.25],
      [rejectionHighScore, 0.25],
      [bearishShapeScore, 0.08],
      [upperPocContext, 0.18],
    ]);
    const putFadeScore = weighted([
      [stallLowScore, 0.24],
      [exhaustionDownScore, 0.25],
      [rejectionLowScore, 0.25],
      [bullishShapeScore, 0.08],
      [lowerPocContext, 0.18],
    ]);

    const { state, stateScore, stateMargin, stateAmbiguous } = chooseState({
      index,
      acceptanceScore,
      releaseUpScore,
      releaseDownScore,
      stallHighScore,
      stallLowScore,
      exhaustionUpScore,
      exhaustionDownScore,
      rejectionHighScore,
      rejectionLowScore,
    });

    const features = buildFeatureList({
      node,
      pocPosition,
      pocMomentum,
      failedExtreme,
      shapeReversal,
      stallHighScore,
      stallLowScore,
      exhaustionUpScore,
      exhaustionDownScore,
      rejectionHighScore,
      rejectionLowScore,
      efficiency5mPct,
    });

    minutes.push({
      time: candle.time,
      label: formatChicagoClock(candle.time),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      developingPoc,
      distanceFromPoc,
      pocPosition,
      pocMigration5m,
      pocMomentum,
      node,
      shapeProxyPct,
      volumeZ,
      rangeZ,
      efficiency5mPct,
      failedExtreme,
      shapeReversal,
      acceptanceScore,
      releaseUpScore,
      releaseDownScore,
      stallHighScore,
      stallLowScore,
      exhaustionUpScore,
      exhaustionDownScore,
      rejectionHighScore,
      rejectionLowScore,
      centerConfidence,
      callFadeScore,
      putFadeScore,
      state,
      stateScore,
      stateMargin,
      stateAmbiguous,
      features,
    });
  }

  const counts = Object.fromEntries(STATES.map((state) => [state, 0])) as Record<AuctionState, number>;
  for (const minute of minutes) counts[minute.state] += 1;

  const featureCounts = {
    acceptance: minutes.filter((minute) => minute.acceptanceScore >= 64).length,
    release: minutes.filter((minute) => Math.max(minute.releaseUpScore, minute.releaseDownScore) >= 70).length,
    stall: minutes.filter((minute) => Math.max(minute.stallHighScore, minute.stallLowScore) >= 70).length,
    exhaustion: minutes.filter((minute) => Math.max(minute.exhaustionUpScore, minute.exhaustionDownScore) >= 70).length,
    rejection: minutes.filter((minute) => Math.max(minute.rejectionHighScore, minute.rejectionLowScore) >= 72).length,
    bearishFailedExtreme: minutes.filter((minute) => minute.failedExtreme === "BEARISH").length,
    bullishFailedExtreme: minutes.filter((minute) => minute.failedExtreme === "BULLISH").length,
    thinZone: minutes.filter((minute) => minute.node === "LVN").length,
  };

  return {
    minutes,
    counts,
    featureCounts,
    topCallFade: distinctTop(minutes, (minute) => minute.callFadeScore, 6),
    topPutFade: distinctTop(minutes, (minute) => minute.putFadeScore, 6),
    topCenters: distinctTop(minutes, (minute) => minute.centerConfidence, 6),
  };
}


/**
 * EVIDENCE INDEPENDENCE MODEL
 * ---------------------------
 * The prior scoring treated the aligned state (22), failed extreme (12) and shape
 * reversal (10) as three separate pieces of evidence totalling 44 — but all three
 * are functions of the same candle geometry. DEFINITIVE was therefore reachable on
 * one candle counted four times.
 *
 * Evidence is now grouped into independent FAMILIES. Within a family only the
 * strongest member contributes, and the family is capped. Across families the
 * weights add. Two families exist because the source data supports exactly two
 * independent views:
 *
 *   SHAPE   — candle geometry (state, failed extreme, shape reversal, wicks)
 *   VOLUME  — volume distribution (POC position, POC momentum, node, efficiency)
 *
 * If a real bid/ask tape is added later, a third TAPE family can be introduced and
 * genuine confluence becomes measurable. Until then, `independentFamilies` reports
 * honestly how many distinct views actually agree.
 */
const SHAPE_FAMILY_CAP = 24;
const VOLUME_FAMILY_CAP = 24;

type Evidence = { label: string; weight: number; family: "SHAPE" | "VOLUME" };

function pushFamilyEvidence(
  target: Evidence[],
  condition: boolean,
  label: string,
  weight: number,
  family: "SHAPE" | "VOLUME",
) {
  if (condition) target.push({ label, weight, family });
}

/** Strongest member of each family, capped, then summed across families. */
function collapseEvidence(items: Evidence[]) {
  const byFamily = new Map<string, Evidence[]>();
  for (const item of items) {
    const list = byFamily.get(item.family) ?? [];
    list.push(item);
    byFamily.set(item.family, list);
  }

  let total = 0;
  const families: string[] = [];
  for (const [family, list] of byFamily) {
    const cap = family === "SHAPE" ? SHAPE_FAMILY_CAP : VOLUME_FAMILY_CAP;
    const strongest = Math.max(...list.map((item) => item.weight));
    // Secondary members inside a family contribute at heavily reduced weight,
    // reflecting that they are correlated restatements rather than new evidence.
    const secondary = list
      .map((item) => item.weight)
      .sort((a, b) => b - a)
      .slice(1)
      .reduce((sum, weight) => sum + weight * 0.25, 0);
    total += Math.min(cap, strongest + secondary);
    families.push(family);
  }

  return { weight: total, families, count: families.length };
}

export function evaluateAuctionConfluence(
  minute: HistoricalAuctionMinute | null,
  target: AuctionConfluenceTarget,
): AuctionConfluenceEvaluation {
  if (!minute) {
    return {
      target,
      tier: "NO_MATCH",
      convictionScore: 0,
      ownScore: 0,
      opposingScore: 0,
      edge: 0,
      alignedEvidence: [],
      opposingEvidence: [],
      independentFamilies: 0,
      timing: "UNKNOWN",
      summary: "No auction minute matched the signal timestamp.",
    };
  }

  if (target === "CENTER") {
    const aligned: Evidence[] = [];
    const opposing: Evidence[] = [];

    // ACCEPTANCE is primarily auction-structure/profile evidence (POC proximity,
    // node, revisits, efficiency, POC stability). Treating it as SHAPE could let
    // CENTER earn a fake 2/2 independent-family read from overlapping profile inputs.
    pushFamilyEvidence(aligned, minute.state === "ACCEPTANCE", "ACCEPTANCE", 18, "VOLUME");
    pushFamilyEvidence(aligned, Math.abs(minute.shapeProxyPct) <= 18, "BALANCED SHAPE", 8, "SHAPE");

    pushFamilyEvidence(aligned, minute.node === "POC", "AT POC", 18, "VOLUME");
    pushFamilyEvidence(aligned, minute.node === "HVN", "HVN", 12, "VOLUME");
    pushFamilyEvidence(aligned, minute.pocMomentum === "STALLED", "POC STALLED", 12, "VOLUME");
    pushFamilyEvidence(aligned, Math.abs(minute.distanceFromPoc) <= 1, "NEAR POC", 10, "VOLUME");
    pushFamilyEvidence(aligned, minute.efficiency5mPct <= 35, "LOW EFFICIENCY", 10, "VOLUME");

    const releasing = minute.state === "RELEASE_UP" || minute.state === "RELEASE_DOWN";
    pushFamilyEvidence(opposing, releasing, `RELEASE ${minute.state === "RELEASE_UP" ? "UP" : "DOWN"}`, 18, "SHAPE");
    pushFamilyEvidence(opposing, minute.pocMomentum !== "STALLED", `POC ${minute.pocMomentum}`, 12, "VOLUME");
    pushFamilyEvidence(opposing, minute.efficiency5mPct >= 65, "HIGH EFFICIENCY", 12, "VOLUME");
    pushFamilyEvidence(opposing, Math.abs(minute.distanceFromPoc) >= 3, "FAR FROM POC", 10, "VOLUME");

    const alignedCollapsed = collapseEvidence(aligned);
    const opposingCollapsed = collapseEvidence(opposing);
    const alignedWeight = alignedCollapsed.weight;
    const opposingWeight = opposingCollapsed.weight;

    const directionalPressure = Math.max(minute.callFadeScore, minute.putFadeScore);
    const ownScore = minute.centerConfidence;
    const opposingScore = directionalPressure;
    const edge = ownScore - opposingScore;
    const evidenceScore = clamp(50 + alignedWeight - opposingWeight, 0, 100);
    const edgeScore = clamp(50 + edge * 1.5, 0, 100);
    const convictionScore = weighted([
      [ownScore, 0.60],
      [evidenceScore, 0.25],
      [edgeScore, 0.15],
    ]);

    let tier: AuctionConfluenceTier = "NEUTRAL";
    // An active release is the thesis-killer for a centred fly, so it is promoted
    // to CONFLICT rather than being diluted into MIXED by a high aligned weight.
    if (releasing) tier = "CONFLICT";
    else if (opposingWeight >= 24 && opposingWeight > alignedWeight) tier = "CONFLICT";
    else if (alignedWeight >= 24 && opposingWeight >= 18) tier = "MIXED";
    else if (
      ownScore >= 82 &&
      alignedWeight >= 34 &&
      alignedCollapsed.count >= 2 &&
      opposingWeight <= 10 &&
      edge >= 8
    ) {
      tier = "DEFINITIVE";
    } else if (ownScore >= 72 && alignedWeight >= 22 && opposingWeight <= 12) tier = "CONFIRMED";
    else if (ownScore >= 62 && alignedWeight >= 14 && opposingWeight < alignedWeight) tier = "SUPPORTIVE";
    else if (alignedWeight < 8 && opposingWeight < 8) tier = "INSUFFICIENT";

    return {
      target,
      tier,
      convictionScore,
      ownScore,
      opposingScore,
      edge,
      alignedEvidence: aligned.map((item) => item.label),
      opposingEvidence: opposing.map((item) => item.label),
      independentFamilies: alignedCollapsed.count,
      timing: "CONCURRENT",
      summary: buildConfluenceSummary(tier, aligned, opposing, alignedCollapsed.count),
    };
  }

  const isCall = target === "CALL_FADE";
  const ownScore = isCall ? minute.callFadeScore : minute.putFadeScore;
  const opposingScore = isCall ? minute.putFadeScore : minute.callFadeScore;
  const edge = ownScore - opposingScore;
  const aligned: Evidence[] = [];
  const opposing: Evidence[] = [];

  // RELEASE_* deliberately excluded from the aligned set.
  //
  // RELEASE_DOWN means price has ALREADY released downward with high efficiency.
  // As entry confirmation for fading a high, that is post-hoc: the move has
  // happened and the premium has already deflated. Counting it as aligned
  // systematically inflated CONFIRMED/DEFINITIVE on late entries. It is now
  // reported through `timing: "LATE"` so the effect can be measured instead.
  const alignedStates: AuctionState[] = isCall
    ? ["REJECTION_HIGH", "EXHAUSTION_UP", "STALL_HIGH"]
    : ["REJECTION_LOW", "EXHAUSTION_DOWN", "STALL_LOW"];
  const opposingStates: AuctionState[] = isCall
    ? ["REJECTION_LOW", "EXHAUSTION_DOWN", "STALL_LOW", "RELEASE_UP"]
    : ["REJECTION_HIGH", "EXHAUSTION_UP", "STALL_HIGH", "RELEASE_DOWN"];
  const lateState: AuctionState = isCall ? "RELEASE_DOWN" : "RELEASE_UP";

  const hasAlignedState = alignedStates.includes(minute.state);
  const hasOpposingState = opposingStates.includes(minute.state);
  const isLate = minute.state === lateState;

  pushFamilyEvidence(aligned, hasAlignedState, stateEvidenceLabel(minute.state), 22, "SHAPE");
  pushFamilyEvidence(opposing, hasOpposingState, stateEvidenceLabel(minute.state), 24, "SHAPE");

  if (isCall) {
    pushFamilyEvidence(aligned, minute.failedExtreme === "BEARISH", "BEARISH FAILED EXTREME", 12, "SHAPE");
    pushFamilyEvidence(aligned, minute.shapeReversal === "BEARISH", "BEARISH SHAPE REVERSAL", 10, "SHAPE");
    pushFamilyEvidence(aligned, minute.pocMomentum === "DOWN", "POC DOWN", 16, "VOLUME");
    pushFamilyEvidence(aligned, minute.pocMomentum === "STALLED" && minute.pocPosition !== "BELOW", "POC STALLED", 8, "VOLUME");
    pushFamilyEvidence(aligned, minute.node === "LVN" && minute.pocPosition === "ABOVE", "THIN ABOVE POC", 10, "VOLUME");

    pushFamilyEvidence(opposing, minute.failedExtreme === "BULLISH", "BULLISH FAILED EXTREME", 12, "SHAPE");
    pushFamilyEvidence(opposing, minute.shapeReversal === "BULLISH", "BULLISH SHAPE REVERSAL", 10, "SHAPE");
    pushFamilyEvidence(opposing, minute.pocMomentum === "UP", "POC UP", 16, "VOLUME");
    pushFamilyEvidence(opposing, minute.state === "ACCEPTANCE" && minute.pocPosition === "ABOVE" && minute.pocMomentum === "UP", "ACCEPTANCE ABOVE POC", 12, "VOLUME");
  } else {
    pushFamilyEvidence(aligned, minute.failedExtreme === "BULLISH", "BULLISH FAILED EXTREME", 12, "SHAPE");
    pushFamilyEvidence(aligned, minute.shapeReversal === "BULLISH", "BULLISH SHAPE REVERSAL", 10, "SHAPE");
    pushFamilyEvidence(aligned, minute.pocMomentum === "UP", "POC UP", 16, "VOLUME");
    pushFamilyEvidence(aligned, minute.pocMomentum === "STALLED" && minute.pocPosition !== "ABOVE", "POC STALLED", 8, "VOLUME");
    pushFamilyEvidence(aligned, minute.node === "LVN" && minute.pocPosition === "BELOW", "THIN BELOW POC", 10, "VOLUME");

    pushFamilyEvidence(opposing, minute.failedExtreme === "BEARISH", "BEARISH FAILED EXTREME", 12, "SHAPE");
    pushFamilyEvidence(opposing, minute.shapeReversal === "BEARISH", "BEARISH SHAPE REVERSAL", 10, "SHAPE");
    pushFamilyEvidence(opposing, minute.pocMomentum === "DOWN", "POC DOWN", 16, "VOLUME");
    pushFamilyEvidence(opposing, minute.state === "ACCEPTANCE" && minute.pocPosition === "BELOW" && minute.pocMomentum === "DOWN", "ACCEPTANCE BELOW POC", 12, "VOLUME");
  }

  const alignedCollapsed = collapseEvidence(aligned);
  const opposingCollapsed = collapseEvidence(opposing);
  const alignedWeight = alignedCollapsed.weight;
  const opposingWeight = opposingCollapsed.weight;

  const edgeScore = clamp(50 + edge * 2, 0, 100);
  const evidenceScore = clamp(50 + alignedWeight - opposingWeight, 0, 100);
  const convictionScore = weighted([
    [ownScore, 0.55],
    [edgeScore, 0.25],
    [evidenceScore, 0.20],
  ]);

  const timing: AuctionConfluenceTiming = isLate ? "LATE" : "CONCURRENT";

  let tier: AuctionConfluenceTier = "NEUTRAL";
  // The own-vs-opposite score is itself directional evidence. A materially
  // negative edge cannot be called NEUTRAL merely because no discrete state
  // cleared its gate. This fixes cases such as CALL 44 vs PUT 67 (edge -23).
  if (edge <= -15) tier = "CONFLICT";
  else if (edge <= -8 && opposingWeight >= 8) tier = "CONFLICT";
  else if (edge <= -8) tier = "MIXED";
  else if (hasOpposingState && opposingWeight > alignedWeight + 4) tier = "CONFLICT";
  else if (alignedWeight >= 14 && opposingWeight >= 14) tier = "MIXED";
  else if (opposingWeight >= 20 && edge <= 0) tier = "CONFLICT";
  else if (
    // DEFINITIVE now requires evidence from BOTH families — a shape read alone,
    // however strong, is one candle and cannot be "unusually coherent".
    ownScore >= 70 &&
    edge >= 15 &&
    hasAlignedState &&
    alignedWeight >= 30 &&
    alignedCollapsed.count >= 2 &&
    opposingWeight <= 8
  ) {
    tier = "DEFINITIVE";
  } else if (
    ownScore >= 65 &&
    edge >= 5 &&
    (hasAlignedState || alignedWeight >= 18) &&
    !hasOpposingState &&
    opposingWeight <= 10
  ) {
    tier = "CONFIRMED";
  } else if (ownScore >= 55 && edge >= 0 && alignedWeight >= 8 && !hasOpposingState) tier = "SUPPORTIVE";
  else if (hasOpposingState || opposingWeight >= 18) tier = "CONFLICT";
  else if (alignedWeight < 8) tier = "INSUFFICIENT";

  // A late read cannot be better than SUPPORTIVE: the reversion is already under way.
  if (timing === "LATE" && (tier === "DEFINITIVE" || tier === "CONFIRMED")) {
    tier = "SUPPORTIVE";
  }

  return {
    target,
    tier,
    convictionScore,
    ownScore,
    opposingScore,
    edge,
    alignedEvidence: aligned.map((item) => item.label),
    opposingEvidence: opposing.map((item) => item.label),
    independentFamilies: alignedCollapsed.count,
    timing,
    summary: buildConfluenceSummary(tier, aligned, opposing, alignedCollapsed.count),
  };
}

function stateEvidenceLabel(state: AuctionState) {
  return state.replaceAll("_", " ");
}

function buildConfluenceSummary(
  tier: AuctionConfluenceTier,
  aligned: Evidence[],
  opposing: Evidence[],
  independentFamilies: number,
) {
  // Surface at least one item from every represented family so a 2/2 row does not
  // accidentally display only SHAPE evidence while hiding the VOLUME evidence that
  // earned the second independent family.
  const shape = aligned.filter((item) => item.family === "SHAPE");
  const volume = aligned.filter((item) => item.family === "VOLUME");
  const lead = [
    ...shape.slice(0, volume.length ? 2 : 3),
    ...volume.slice(0, shape.length ? 2 : 3),
  ]
    .map((item) => item.label)
    .join(" · ");

  const conflict = opposing.slice(0, 2).map((item) => item.label).join(" · ");
  if (tier === "CONFLICT") return conflict ? `Opposing: ${conflict}` : "Opposing auction evidence dominates.";
  if (tier === "MIXED") return `Aligned: ${lead || "none"} | Opposing: ${conflict || "none"}`;
  if (tier === "INSUFFICIENT") return "Not enough auction evidence either way.";

  const familyNote =
    independentFamilies >= 2
      ? " (shape + volume)"
      : volume.length && !shape.length
        ? " (volume only)"
        : shape.length && !volume.length
          ? " (shape only)"
          : "";

  return lead ? `${lead}${familyNote}` : "No decisive directional auction evidence.";
}

/**
 * Research-safe timestamp matcher. Returns only information that existed at or
 * before the signal timestamp; it never reaches into the following ES minute.
 */
export function latestAuctionMinuteAtOrBefore(
  minutes: HistoricalAuctionMinute[],
  epochSeconds: number,
  toleranceSeconds = 90,
) {
  let best: HistoricalAuctionMinute | null = null;
  let bestLag = Number.POSITIVE_INFINITY;
  for (const minute of minutes) {
    if (minute.time > epochSeconds) continue;
    const lag = epochSeconds - minute.time;
    if (lag < bestLag) {
      best = minute;
      bestLag = lag;
    }
  }
  return best && bestLag <= toleranceSeconds ? best : null;
}

/**
 * Kept for compatibility with older research callers. Do not use this helper
 * for causal/backtest attribution because it may choose a future minute.
 */
export function nearestAuctionMinute(
  minutes: HistoricalAuctionMinute[],
  epochSeconds: number,
  toleranceSeconds = 90,
) {
  let best: HistoricalAuctionMinute | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const minute of minutes) {
    const distance = Math.abs(minute.time - epochSeconds);
    if (distance < bestDistance) {
      best = minute;
      bestDistance = distance;
    }
  }
  return best && bestDistance <= toleranceSeconds ? best : null;
}

/** Directional-opposite pairs. If the top two eligible states are opposites and
 *  their margins are within this band, the read is ambiguous and we return BALANCED
 *  rather than letting a tiebreak decide direction. */
const AMBIGUITY_BAND = 4;

const OPPOSITE_STATE: Partial<Record<AuctionState, AuctionState>> = {
  REJECTION_HIGH: "REJECTION_LOW",
  REJECTION_LOW: "REJECTION_HIGH",
  EXHAUSTION_UP: "EXHAUSTION_DOWN",
  EXHAUSTION_DOWN: "EXHAUSTION_UP",
  STALL_HIGH: "STALL_LOW",
  STALL_LOW: "STALL_HIGH",
  RELEASE_UP: "RELEASE_DOWN",
  RELEASE_DOWN: "RELEASE_UP",
};

function chooseState(scores: {
  index: number;
  acceptanceScore: number;
  releaseUpScore: number;
  releaseDownScore: number;
  stallHighScore: number;
  stallLowScore: number;
  exhaustionUpScore: number;
  exhaustionDownScore: number;
  rejectionHighScore: number;
  rejectionLowScore: number;
}): { state: AuctionState; stateScore: number; stateMargin: number; stateAmbiguous: boolean } {
  if (scores.index < 5) {
    return { state: "WARMING", stateScore: 0, stateMargin: 0, stateAmbiguous: false };
  }

  const candidates: Array<[AuctionState, number, number]> = [
    ["REJECTION_HIGH", scores.rejectionHighScore, 72],
    ["REJECTION_LOW", scores.rejectionLowScore, 72],
    ["EXHAUSTION_UP", scores.exhaustionUpScore, 70],
    ["EXHAUSTION_DOWN", scores.exhaustionDownScore, 70],
    ["STALL_HIGH", scores.stallHighScore, 68],
    ["STALL_LOW", scores.stallLowScore, 68],
    ["RELEASE_UP", scores.releaseUpScore, 70],
    ["RELEASE_DOWN", scores.releaseDownScore, 70],
    ["ACCEPTANCE", scores.acceptanceScore, 64],
  ];

  // Sort by MARGIN OVER THRESHOLD, not raw score.
  //
  // The prior implementation filtered by per-state thresholds and then sorted by
  // raw score, which is non-monotonic: rejectionHigh=71.9 (below its 72 gate) lost
  // to stallHigh=68.5 (above its 68 gate), so the stronger reading was discarded
  // while a weaker one won. Comparing margins puts every state on one scale.
  const eligible = candidates
    .map(([state, score, threshold]) => ({ state, score, threshold, margin: score - threshold }))
    .filter((item) => item.margin >= 0)
    .sort((a, b) => b.margin - a.margin);

  if (!eligible.length) {
    return {
      state: "BALANCED",
      stateScore: Math.max(...candidates.map(([, score]) => score)),
      stateMargin: 0,
      stateAmbiguous: false,
    };
  }

  const winner = eligible[0];
  const runnerUp = eligible[1];

  // A long-legged doji scores REJECTION_HIGH and REJECTION_LOW identically from
  // shape alone; the winner was previously decided by the highTest/lowTest
  // tiebreak, i.e. by noise. When opposites are this close, report BALANCED.
  const ambiguous = Boolean(
    runnerUp &&
      OPPOSITE_STATE[winner.state] === runnerUp.state &&
      winner.margin - runnerUp.margin <= AMBIGUITY_BAND,
  );

  if (ambiguous) {
    return {
      state: "BALANCED",
      stateScore: winner.score,
      stateMargin: winner.margin,
      stateAmbiguous: true,
    };
  }

  return {
    state: winner.state,
    stateScore: winner.score,
    stateMargin: winner.margin,
    stateAmbiguous: false,
  };
}

function buildFeatureList(args: {
  node: AuctionProfileNode;
  pocPosition: AuctionPocPosition;
  pocMomentum: AuctionPocMomentum;
  failedExtreme: AuctionFailedExtreme;
  shapeReversal: AuctionShapeReversal;
  stallHighScore: number;
  stallLowScore: number;
  exhaustionUpScore: number;
  exhaustionDownScore: number;
  rejectionHighScore: number;
  rejectionLowScore: number;
  efficiency5mPct: number;
}) {
  const features: string[] = [];
  features.push(`${args.pocPosition} POC`);
  if (args.pocMomentum !== "STALLED") features.push(`POC ${args.pocMomentum}`);
  else features.push("POC STALLED");
  if (args.node === "LVN") features.push("THIN / LVN");
  if (args.node === "HVN" || args.node === "POC") features.push("HVN / ACCEPTANCE");
  if (args.failedExtreme !== "NONE") features.push(`${args.failedExtreme} FAILED EXTREME`);
  if (args.shapeReversal !== "NONE") features.push(`${args.shapeReversal} SHAPE REVERSAL`);
  if (args.stallHighScore >= 70) features.push("STALL HIGH");
  if (args.stallLowScore >= 70) features.push("STALL LOW");
  if (args.exhaustionUpScore >= 70) features.push("EXHAUSTION UP");
  if (args.exhaustionDownScore >= 70) features.push("EXHAUSTION DOWN");
  if (args.rejectionHighScore >= 72) features.push("REJECTION HIGH");
  if (args.rejectionLowScore >= 72) features.push("REJECTION LOW");
  if (args.efficiency5mPct >= 72) features.push("FAST / RELEASE");
  return features;
}

function detectFailedExtreme(args: {
  candle: HistoricalEsCandle;
  previousHigh: number | null;
  previousLow: number | null;
  shapeProxyPct: number;
  priorShape3: number;
}): AuctionFailedExtreme {
  if (
    args.previousHigh !== null &&
    args.candle.high >= args.previousHigh + ES_TICK &&
    args.shapeProxyPct <= args.priorShape3 - 12
  ) {
    return "BEARISH";
  }
  if (
    args.previousLow !== null &&
    args.candle.low <= args.previousLow - ES_TICK &&
    args.shapeProxyPct >= args.priorShape3 + 12
  ) {
    return "BULLISH";
  }
  return "NONE";
}

function detectShapeReversal(history: number[], index: number): AuctionShapeReversal {
  if (index < 2) return "NONE";
  const previous = mean(history.slice(Math.max(0, index - 2), index));
  const current = history[index] ?? 0;
  if (previous >= 12 && current <= -6) return "BEARISH";
  if (previous <= -12 && current >= 6) return "BULLISH";
  return "NONE";
}

function classifyNode(
  profile: Map<number, MutableCell>,
  price: number,
  poc: number,
): AuctionProfileNode {
  if (price === poc) return "POC";
  const cell = profile.get(price);
  if (!cell) return "LVN";
  const totalLevels = profile.size;
  if (totalLevels <= 1) return "NORMAL";

  // O(N) percentile rank. The prior implementation sorted the entire profile on
  // every minute (O(N log N)) only to discover this cell's rank. Counting levels
  // with strictly greater reconstructed volume produces the same useful percentile
  // classification without the repeated sort cost.
  let greater = 0;
  for (const level of profile.values()) {
    if (level.totalVolume > cell.totalVolume) greater += 1;
  }
  const pct = (greater / (totalLevels - 1)) * 100;
  if (pct <= 20) return "HVN";
  if (pct >= 80) return "LVN";
  return "NORMAL";
}

function pathEfficiency(candles: HistoricalEsCandle[], index: number, lookback: number) {
  const start = Math.max(0, index - lookback + 1);
  const slice = candles.slice(start, index + 1);
  if (slice.length <= 1) return 0;
  const net = Math.abs(slice[slice.length - 1].close - slice[0].open);
  let gross = 0;
  for (let i = 0; i < slice.length; i += 1) {
    const previousClose = i === 0 ? slice[i].open : slice[i - 1].close;
    const trueRange = Math.max(
      slice[i].high - slice[i].low,
      Math.abs(slice[i].high - previousClose),
      Math.abs(slice[i].low - previousClose),
    );
    gross += Math.max(ES_TICK, trueRange);
  }
  // True-range travel intentionally penalizes wick-heavy churn. The 1.25 factor
  // keeps clean directional sequences in the familiar 70–100 release band.
  return clamp((net / Math.max(ES_TICK, gross)) * 125, 0, 100);
}

function findPoc(profile: Map<number, MutableCell>) {
  let bestPrice: number | null = null;
  let bestVolume = -1;
  for (const [price, cell] of profile) {
    if (cell.totalVolume > bestVolume) {
      bestPrice = price;
      bestVolume = cell.totalVolume;
    }
  }
  return bestPrice;
}

function distinctTop(
  minutes: HistoricalAuctionMinute[],
  score: (minute: HistoricalAuctionMinute) => number,
  limit: number,
) {
  const sorted = [...minutes].sort((a, b) => score(b) - score(a));
  const selected: HistoricalAuctionMinute[] = [];
  for (const minute of sorted) {
    if (selected.some((prior) => Math.abs(prior.time - minute.time) < 5 * 60)) continue;
    selected.push(minute);
    if (selected.length >= limit) break;
  }
  return selected;
}

function mergeCell(map: Map<number, MutableCell>, incoming: HistoricalFootprintCell) {
  const prior = map.get(incoming.price);
  if (!prior) {
    map.set(incoming.price, { ...incoming });
    return;
  }
  prior.bidVolume += incoming.bidVolume;
  prior.askVolume += incoming.askVolume;
  prior.totalVolume += incoming.totalVolume;
  prior.shapeProxy += incoming.shapeProxy;
}

function weighted(items: Array<[number, number]>) {
  const totalWeight = items.reduce((sum, [, weight]) => sum + weight, 0) || 1;
  return clamp(
    items.reduce((sum, [value, weight]) => sum + clamp(value, 0, 100) * weight, 0) / totalWeight,
    0,
    100,
  );
}

function zScore(value: number, history: number[]) {
  if (history.length < 5) return 0;
  const avg = mean(history);
  const variance = mean(history.map((item) => (item - avg) ** 2));
  const sd = Math.sqrt(variance);
  if (!Number.isFinite(sd) || sd <= 1e-9) return 0;
  return clamp((value - avg) / sd, -5, 5);
}

function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function max(values: number[]) {
  if (!values.length) return null;
  return Math.max(...values);
}

function min(values: number[]) {
  if (!values.length) return null;
  return Math.min(...values);
}

function roundToTick(value: number) {
  return Math.round(value / ES_TICK) * ES_TICK;
}

function clamp(value: number, minValue: number, maxValue: number) {
  return Math.max(minValue, Math.min(maxValue, value));
}

function formatChicagoClock(epochSeconds: number) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(epochSeconds * 1000));
}

function isFiniteCandle(candle: HistoricalEsCandle) {
  return (
    Number.isFinite(candle.time) &&
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close) &&
    Number.isFinite(candle.volume)
  );
}
