export type EsOrderFlowSnapshot = {
  generatedAt: string;
  symbol: string;
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  last: number | null;
  lastSize: number | null;
  totalVolume: number | null;
  quoteTime: number | null;
  tradeTime: number | null;
};

export type EsOrderFlowState =
  | "WARMING"
  | "DORMANT"
  | "BUILDING"
  | "RELEASE_UP"
  | "RELEASE_DOWN"
  | "ABSORBING_HIGH"
  | "ABSORBING_LOW"
  | "EXHAUSTING_UP"
  | "EXHAUSTING_DOWN"
  | "REVERSAL_DOWN"
  | "REVERSAL_UP";

export type EsOrderFlowSample = {
  timestamp: string;
  symbol: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  last: number | null;
  bidSize: number | null;
  askSize: number | null;
  bookImbalancePct: number | null;
  microPrice: number | null;
  spreadTicks: number | null;
  volumeDelta: number;
  volumeRatePerSec: number;
  aggressiveBuyVolume: number;
  aggressiveSellVolume: number;
  unknownVolume: number;
  signedDelta: number;
  rollingDelta20s: number;
  rollingVolume20s: number;
  directionalPressurePct: number;
  intensityZ: number | null;
  priceDisplacementTicks20s: number | null;
  efficiencyDisplacementTicks: number | null;
  grossTravelTicks20s: number | null;
  pathEfficiencyPct: number | null;
  directionalAlignmentPct: number | null;
  flowConfidencePct: number | null;
  flowConfidence: "LOW" | "MEDIUM" | "HIGH";
  rawEfficiencyPct: number | null;
  efficiencyPct: number | null;
  bidStacking: number | null;
  askStacking: number | null;
  sourceTotalVolume: number | null;
  sourceLastSize: number | null;
  sourceQuoteTime: number | null;
  sourceTradeTime: number | null;
  state: EsOrderFlowState;
};

export type EsOrderFlowRead = {
  state: EsOrderFlowState;
  sampleCount: number;
  latest: EsOrderFlowSample | null;
  samples: EsOrderFlowSample[];
  warnings: string[];
};

const ES_TICK = 0.25;
const MAX_SAMPLES = 240;
const ROLLING_WINDOW_MS = 20_000;
const EFFICIENCY_WINDOW_MS = 20_000;
const RECENT_STATE_MS = 45_000;
const MIN_EFFICIENCY_SPAN_MS = 8_000;
const MIN_EFFICIENCY_SAMPLES = 7;

export function updateEsOrderFlow(
  previousSamples: EsOrderFlowSample[],
  snapshot: EsOrderFlowSnapshot,
): EsOrderFlowRead {
  const history = previousSamples
    .filter((sample) => sample.symbol === snapshot.symbol)
    .slice(-(MAX_SAMPLES - 1));
  const prior = history.at(-1) ?? null;
  const timestampMs = parseMs(snapshot.generatedAt);
  const priorMs = prior ? parseMs(prior.timestamp) : null;
  const mid = midpoint(snapshot.bid, snapshot.ask);
  const spreadTicks =
    snapshot.bid != null && snapshot.ask != null && snapshot.ask >= snapshot.bid
      ? (snapshot.ask - snapshot.bid) / ES_TICK
      : null;
  const bookImbalancePct = bookImbalance(snapshot.bidSize, snapshot.askSize);
  const microPrice = weightedMicroPrice(
    snapshot.bid,
    snapshot.ask,
    snapshot.bidSize,
    snapshot.askSize,
  );
  const volumeDelta = deriveVolumeDelta(snapshot, prior, timestampMs, priorMs);
  const elapsedSeconds = priorMs == null ? 1 : Math.max(0.25, (timestampMs - priorMs) / 1000);
  const volumeRatePerSec = volumeDelta / elapsedSeconds;
  const aggressor = classifyAggressor(snapshot, prior);
  const aggressiveBuyVolume = aggressor === "BUY" ? volumeDelta : 0;
  const aggressiveSellVolume = aggressor === "SELL" ? volumeDelta : 0;
  const unknownVolume = aggressor === "UNKNOWN" ? volumeDelta : 0;
  const signedDelta = aggressiveBuyVolume - aggressiveSellVolume;
  const provisional: EsOrderFlowSample = {
    timestamp: snapshot.generatedAt,
    symbol: snapshot.symbol,
    bid: snapshot.bid,
    ask: snapshot.ask,
    mid,
    last: snapshot.last,
    bidSize: snapshot.bidSize,
    askSize: snapshot.askSize,
    bookImbalancePct,
    microPrice,
    spreadTicks,
    volumeDelta,
    volumeRatePerSec,
    aggressiveBuyVolume,
    aggressiveSellVolume,
    unknownVolume,
    signedDelta,
    rollingDelta20s: 0,
    rollingVolume20s: 0,
    directionalPressurePct: 0,
    intensityZ: null,
    priceDisplacementTicks20s: null,
    efficiencyDisplacementTicks: null,
    grossTravelTicks20s: null,
    pathEfficiencyPct: null,
    directionalAlignmentPct: null,
    flowConfidencePct: null,
    flowConfidence: "LOW",
    rawEfficiencyPct: null,
    efficiencyPct: null,
    bidStacking: samePriceDelta(snapshot.bid, snapshot.bidSize, prior?.bid, prior?.bidSize),
    askStacking: samePriceDelta(snapshot.ask, snapshot.askSize, prior?.ask, prior?.askSize),
    sourceTotalVolume: snapshot.totalVolume,
    sourceLastSize: snapshot.lastSize,
    sourceQuoteTime: snapshot.quoteTime,
    sourceTradeTime: snapshot.tradeTime,
    state: "WARMING",
  };

  const samples = [...history, provisional];
  const rolling = samples.filter(
    (sample) => timestampMs - parseMs(sample.timestamp) <= ROLLING_WINDOW_MS,
  );
  const rollingDelta20s = sum(rolling.map((sample) => sample.signedDelta));
  const rollingVolume20s = sum(rolling.map((sample) => sample.volumeDelta));
  const directionalPressurePct =
    rollingVolume20s > 0
      ? clamp((rollingDelta20s / rollingVolume20s) * 100, -100, 100)
      : 0;
  const intensityZ = calculateIntensityZ(samples, provisional);
  const firstRollingMid = rolling.find((sample) => sample.mid != null)?.mid ?? null;
  const priceDisplacementTicks20s =
    mid != null && firstRollingMid != null
      ? (mid - firstRollingMid) / ES_TICK
      : null;
  const efficiencyRolling = samples.filter(
    (sample) => timestampMs - parseMs(sample.timestamp) <= EFFICIENCY_WINDOW_MS,
  );
  const efficiencyMetrics = calculateAuctionEfficiency({
    samples: efficiencyRolling,
    latestMid: mid,
    directionalPressurePct,
    rollingVolume: rollingVolume20s,
    intensityZ,
    priorEfficiencyPct: prior?.efficiencyPct ?? null,
  });

  const enriched: EsOrderFlowSample = {
    ...provisional,
    rollingDelta20s,
    rollingVolume20s,
    directionalPressurePct,
    intensityZ,
    priceDisplacementTicks20s,
    efficiencyDisplacementTicks: efficiencyMetrics.displacementTicks,
    grossTravelTicks20s: efficiencyMetrics.grossTravelTicks,
    pathEfficiencyPct: efficiencyMetrics.pathEfficiencyPct,
    directionalAlignmentPct: efficiencyMetrics.directionalAlignmentPct,
    flowConfidencePct: efficiencyMetrics.flowConfidencePct,
    flowConfidence: efficiencyMetrics.flowConfidence,
    rawEfficiencyPct: efficiencyMetrics.rawEfficiencyPct,
    efficiencyPct: efficiencyMetrics.efficiencyPct,
    state: "WARMING",
  };
  enriched.state = classifyState([...history, enriched], enriched);
  samples[samples.length - 1] = enriched;

  const warnings: string[] = [];
  if (snapshot.bid == null || snapshot.ask == null) {
    warnings.push("ES bid/ask is unavailable; order-flow direction is degraded.");
  }
  if (snapshot.bidSize == null || snapshot.askSize == null) {
    warnings.push("ES top-of-book size is unavailable; stacking and imbalance are disabled.");
  }
  if (snapshot.totalVolume == null && snapshot.lastSize == null) {
    warnings.push("No ES volume counter or last-size field is available; tape-flow intensity cannot be measured.");
  }
  if (unknownVolume > 0) {
    warnings.push("Some new volume could not be classified as buyer- or seller-aggressive from REST snapshots.");
  }

  return {
    state: enriched.state,
    sampleCount: samples.length,
    latest: enriched,
    samples: samples.slice(-MAX_SAMPLES),
    warnings,
  };
}

export function emptyEsOrderFlowRead(): EsOrderFlowRead {
  return {
    state: "WARMING",
    sampleCount: 0,
    latest: null,
    samples: [],
    warnings: [],
  };
}

function deriveVolumeDelta(
  snapshot: EsOrderFlowSnapshot,
  prior: EsOrderFlowSample | null,
  timestampMs: number,
  priorMs: number | null,
) {
  if (!prior || priorMs == null || timestampMs <= priorMs) return 0;
  if (
    snapshot.totalVolume != null &&
    prior.sourceTotalVolume != null &&
    snapshot.totalVolume >= prior.sourceTotalVolume
  ) {
    return Math.max(0, snapshot.totalVolume - prior.sourceTotalVolume);
  }
  if (
    snapshot.lastSize != null &&
    snapshot.lastSize >= 0 &&
    snapshot.tradeTime != null &&
    (prior.sourceTradeTime == null || snapshot.tradeTime > prior.sourceTradeTime)
  ) {
    return snapshot.lastSize;
  }
  return 0;
}

function classifyAggressor(
  snapshot: EsOrderFlowSnapshot,
  prior: EsOrderFlowSample | null,
): "BUY" | "SELL" | "UNKNOWN" {
  if (snapshot.last == null) return "UNKNOWN";
  const referenceBid = prior?.bid ?? snapshot.bid;
  const referenceAsk = prior?.ask ?? snapshot.ask;
  const epsilon = ES_TICK * 0.2;
  if (referenceAsk != null && snapshot.last >= referenceAsk - epsilon) return "BUY";
  if (referenceBid != null && snapshot.last <= referenceBid + epsilon) return "SELL";
  if (prior?.last != null) {
    if (snapshot.last > prior.last) return "BUY";
    if (snapshot.last < prior.last) return "SELL";
  }
  return "UNKNOWN";
}

function calculateIntensityZ(samples: EsOrderFlowSample[], latest: EsOrderFlowSample) {
  const latestMs = parseMs(latest.timestamp);
  const recent = samples
    .slice(0, -1)
    .filter((sample) => latestMs - parseMs(sample.timestamp) <= 60_000)
    .map((sample) => sample.volumeRatePerSec)
    .filter((value) => Number.isFinite(value));
  if (recent.length < 10) return null;
  const mean = sum(recent) / recent.length;
  const variance =
    sum(recent.map((value) => (value - mean) ** 2)) / Math.max(1, recent.length - 1);
  const sd = Math.sqrt(variance);
  if (sd < 0.001) return latest.volumeRatePerSec > mean ? 2 : 0;
  return clamp((latest.volumeRatePerSec - mean) / sd, -3, 6);
}

function calculateAuctionEfficiency(input: {
  samples: EsOrderFlowSample[];
  latestMid: number | null;
  directionalPressurePct: number;
  rollingVolume: number;
  intensityZ: number | null;
  priorEfficiencyPct: number | null;
}) {
  const mids = input.samples
    .map((sample) => ({ ms: parseMs(sample.timestamp), mid: sample.mid }))
    .filter((point): point is { ms: number; mid: number } => point.mid != null);
  const firstMid = mids[0]?.mid ?? null;
  const lastMid = input.latestMid ?? mids.at(-1)?.mid ?? null;
  const spanMs = mids.length >= 2 ? mids.at(-1)!.ms - mids[0]!.ms : 0;
  const displacementTicks =
    firstMid != null && lastMid != null ? (lastMid - firstMid) / ES_TICK : null;
  let grossTravelTicks = 0;
  for (let index = 1; index < mids.length; index += 1) {
    grossTravelTicks += Math.abs(mids[index].mid - mids[index - 1].mid) / ES_TICK;
  }

  const enoughPath =
    mids.length >= MIN_EFFICIENCY_SAMPLES && spanMs >= MIN_EFFICIENCY_SPAN_MS;
  const pathEfficiencyPct =
    enoughPath && displacementTicks != null
      ? grossTravelTicks > 0.001
        ? clamp((Math.abs(displacementTicks) / grossTravelTicks) * 100, 0, 100)
        : 0
      : null;

  const pressureStrength = clamp(Math.abs(input.directionalPressurePct) / 100, 0, 1);
  const displacementDirection = Math.sign(displacementTicks ?? 0);
  const pressureDirection = Math.sign(input.directionalPressurePct);
  const directionalAlignmentPct =
    pathEfficiencyPct == null || displacementDirection === 0 || pressureDirection === 0
      ? pathEfficiencyPct == null
        ? null
        : 35
      : displacementDirection === pressureDirection
        ? 60 + 40 * pressureStrength
        : 30 * (1 - pressureStrength);

  const flowConfidencePct = calculateFlowConfidencePct({
    samples: input.samples,
    rollingVolume: input.rollingVolume,
    intensityZ: input.intensityZ,
    spanMs,
  });
  const flowConfidence = confidenceLabel(flowConfidencePct);

  const rawEfficiencyPct =
    pathEfficiencyPct == null || directionalAlignmentPct == null
      ? null
      : clamp(pathEfficiencyPct * (directionalAlignmentPct / 100), 0, 100);

  // Low-confidence REST snapshots are allowed to move the displayed efficiency,
  // but only slowly. This keeps one half-tick quote change from creating the old
  // 0 -> 50 -> 100 flashing behavior while preserving fast response when the tape
  // becomes active and well classified.
  const confidenceFraction = (flowConfidencePct ?? 0) / 100;
  const alpha = clamp(0.10 + 0.42 * confidenceFraction, 0.10, 0.52);
  const efficiencyPct =
    rawEfficiencyPct == null
      ? input.priorEfficiencyPct
      : input.priorEfficiencyPct == null
        ? rawEfficiencyPct
        : input.priorEfficiencyPct + alpha * (rawEfficiencyPct - input.priorEfficiencyPct);

  return {
    displacementTicks,
    grossTravelTicks: enoughPath ? grossTravelTicks : null,
    pathEfficiencyPct,
    directionalAlignmentPct,
    flowConfidencePct,
    flowConfidence,
    rawEfficiencyPct,
    efficiencyPct: efficiencyPct == null ? null : clamp(efficiencyPct, 0, 100),
  };
}

function calculateFlowConfidencePct(input: {
  samples: EsOrderFlowSample[];
  rollingVolume: number;
  intensityZ: number | null;
  spanMs: number;
}) {
  if (input.samples.length < 2 || input.spanMs <= 0) return 0;
  const coverageScore = clamp(input.spanMs / ROLLING_WINDOW_MS, 0, 1);
  const classifiedVolume = sum(
    input.samples.map((sample) => sample.aggressiveBuyVolume + sample.aggressiveSellVolume),
  );
  const totalVolume = sum(input.samples.map((sample) => sample.volumeDelta));
  const classifiedScore = totalVolume > 0 ? clamp(classifiedVolume / totalVolume, 0, 1) : 0;

  // ES cash-session flow commonly reaches hundreds of contracts in 20 seconds.
  // This saturating curve intentionally keeps thin overnight samples low
  // confidence without imposing a brittle fixed minimum-volume gate.
  const volumeScore = 1 - Math.exp(-Math.max(0, input.rollingVolume) / 180);
  const z = input.intensityZ ?? -0.5;
  const intensityScore = clamp((z + 0.5) / 2.75, 0, 1);
  const activityScore = 0.65 * volumeScore + 0.35 * intensityScore;
  const qualityScore = Math.sqrt(coverageScore * classifiedScore);
  return clamp(qualityScore * activityScore * 100, 0, 100);
}

function confidenceLabel(value: number | null): "LOW" | "MEDIUM" | "HIGH" {
  if (value == null || value < 45) return "LOW";
  if (value < 70) return "MEDIUM";
  return "HIGH";
}

function classifyState(
  samples: EsOrderFlowSample[],
  latest: EsOrderFlowSample,
): EsOrderFlowState {
  if (
    samples.length < 12 ||
    latest.intensityZ == null ||
    latest.efficiencyPct == null ||
    latest.flowConfidencePct == null
  ) {
    return "WARMING";
  }
  const pressure = latest.directionalPressurePct;
  const displacement = latest.efficiencyDisplacementTicks ?? 0;
  const intensity = latest.intensityZ;
  const efficiency = latest.efficiencyPct;
  const confidence = latest.flowConfidencePct;
  const nowMs = parseMs(latest.timestamp);
  const recentStates = samples
    .slice(0, -1)
    .filter((sample) => nowMs - parseMs(sample.timestamp) <= RECENT_STATE_MS)
    .map((sample) => sample.state);
  const hadHighAbsorption = recentStates.includes("ABSORBING_HIGH");
  const hadLowAbsorption = recentStates.includes("ABSORBING_LOW");
  const hadUpExhaustion = recentStates.includes("EXHAUSTING_UP");
  const hadDownExhaustion = recentStates.includes("EXHAUSTING_DOWN");

  const reversalDown = sustainedCondition(
    samples,
    latest,
    (sample) =>
      sample.directionalPressurePct <= -20 &&
      (sample.efficiencyDisplacementTicks ?? 0) <= -1 &&
      (sample.flowConfidencePct ?? 0) >= 35,
    2,
    5_000,
  );
  const reversalUp = sustainedCondition(
    samples,
    latest,
    (sample) =>
      sample.directionalPressurePct >= 20 &&
      (sample.efficiencyDisplacementTicks ?? 0) >= 1 &&
      (sample.flowConfidencePct ?? 0) >= 35,
    2,
    5_000,
  );
  if (hadUpExhaustion && reversalDown) return "REVERSAL_DOWN";
  if (hadDownExhaustion && reversalUp) return "REVERSAL_UP";

  const exhaustingUp = sustainedCondition(
    samples,
    latest,
    (sample) =>
      sample.directionalPressurePct < 25 ||
      (sample.flowConfidencePct ?? 0) < 40 ||
      ((sample.intensityZ ?? 0) < 0.3 && (sample.flowConfidencePct ?? 0) < 55),
    2,
    5_000,
  );
  const exhaustingDown = sustainedCondition(
    samples,
    latest,
    (sample) =>
      sample.directionalPressurePct > -25 ||
      (sample.flowConfidencePct ?? 0) < 40 ||
      ((sample.intensityZ ?? 0) < 0.3 && (sample.flowConfidencePct ?? 0) < 55),
    2,
    5_000,
  );
  if (hadHighAbsorption && exhaustingUp && displacement <= 1.5) {
    return "EXHAUSTING_UP";
  }
  if (hadLowAbsorption && exhaustingDown && displacement >= -1.5) {
    return "EXHAUSTING_DOWN";
  }

  // Hysteresis: once absorption is confirmed, a one-second REST classification
  // wobble should not blink the state back to BUILDING while the broader
  // auction still shows heavy directional force with poor price progress.
  if (
    hadHighAbsorption &&
    pressure >= 35 &&
    confidence >= 50 &&
    efficiency <= 50 &&
    displacement < 3
  ) {
    return "ABSORBING_HIGH";
  }
  if (
    hadLowAbsorption &&
    pressure <= -35 &&
    confidence >= 50 &&
    efficiency <= 50 &&
    displacement > -3
  ) {
    return "ABSORBING_LOW";
  }

  const absorbingHigh = sustainedCondition(
    samples,
    latest,
    (sample) =>
      sample.directionalPressurePct >= 45 &&
      (sample.flowConfidencePct ?? 0) >= 55 &&
      (sample.efficiencyPct ?? 100) <= 42 &&
      ((sample.intensityZ ?? 0) >= 0.8 || (sample.flowConfidencePct ?? 0) >= 70) &&
      (sample.efficiencyDisplacementTicks ?? 0) < 3,
    3,
    6_000,
  );
  const absorbingLow = sustainedCondition(
    samples,
    latest,
    (sample) =>
      sample.directionalPressurePct <= -45 &&
      (sample.flowConfidencePct ?? 0) >= 55 &&
      (sample.efficiencyPct ?? 100) <= 42 &&
      ((sample.intensityZ ?? 0) >= 0.8 || (sample.flowConfidencePct ?? 0) >= 70) &&
      (sample.efficiencyDisplacementTicks ?? 0) > -3,
    3,
    6_000,
  );
  if (absorbingHigh) return "ABSORBING_HIGH";
  if (absorbingLow) return "ABSORBING_LOW";

  const previousState = samples.length >= 2 ? samples[samples.length - 2].state : null;
  if (
    previousState === "RELEASE_UP" &&
    pressure >= 20 &&
    confidence >= 40 &&
    efficiency >= 48 &&
    displacement >= 0.5
  ) {
    return "RELEASE_UP";
  }
  if (
    previousState === "RELEASE_DOWN" &&
    pressure <= -20 &&
    confidence >= 40 &&
    efficiency >= 48 &&
    displacement <= -0.5
  ) {
    return "RELEASE_DOWN";
  }

  const releaseUp = sustainedCondition(
    samples,
    latest,
    (sample) =>
      sample.directionalPressurePct >= 30 &&
      (sample.flowConfidencePct ?? 0) >= 45 &&
      (sample.efficiencyPct ?? 0) >= 55 &&
      ((sample.intensityZ ?? 0) >= 0.5 || (sample.flowConfidencePct ?? 0) >= 70) &&
      (sample.efficiencyDisplacementTicks ?? 0) >= 1,
    3,
    6_000,
  );
  const releaseDown = sustainedCondition(
    samples,
    latest,
    (sample) =>
      sample.directionalPressurePct <= -30 &&
      (sample.flowConfidencePct ?? 0) >= 45 &&
      (sample.efficiencyPct ?? 0) >= 55 &&
      ((sample.intensityZ ?? 0) >= 0.5 || (sample.flowConfidencePct ?? 0) >= 70) &&
      (sample.efficiencyDisplacementTicks ?? 0) <= -1,
    3,
    6_000,
  );
  if (releaseUp) return "RELEASE_UP";
  if (releaseDown) return "RELEASE_DOWN";

  if (intensity >= 0.5 || Math.abs(pressure) >= 20 || confidence >= 35) {
    return "BUILDING";
  }
  return "DORMANT";
}

function sustainedCondition(
  samples: EsOrderFlowSample[],
  latest: EsOrderFlowSample,
  predicate: (sample: EsOrderFlowSample) => boolean,
  minimumMatches: number,
  windowMs: number,
) {
  if (!predicate(latest)) return false;
  const latestMs = parseMs(latest.timestamp);
  const recent = samples.filter(
    (sample) => latestMs - parseMs(sample.timestamp) <= windowMs,
  );
  return recent.filter(predicate).length >= minimumMatches;
}

function midpoint(bid: number | null, ask: number | null) {
  if (bid == null || ask == null || ask < bid) return null;
  return (bid + ask) / 2;
}

function bookImbalance(bidSize: number | null, askSize: number | null) {
  if (bidSize == null || askSize == null || bidSize + askSize <= 0) return null;
  return clamp(((bidSize - askSize) / (bidSize + askSize)) * 100, -100, 100);
}

function weightedMicroPrice(
  bid: number | null,
  ask: number | null,
  bidSize: number | null,
  askSize: number | null,
) {
  if (
    bid == null ||
    ask == null ||
    bidSize == null ||
    askSize == null ||
    bidSize + askSize <= 0 ||
    ask < bid
  ) {
    return null;
  }
  return (ask * bidSize + bid * askSize) / (bidSize + askSize);
}

function samePriceDelta(
  price: number | null,
  size: number | null,
  priorPrice: number | null | undefined,
  priorSize: number | null | undefined,
) {
  if (
    price == null ||
    size == null ||
    priorPrice == null ||
    priorSize == null ||
    Math.abs(price - priorPrice) > ES_TICK / 2
  ) {
    return null;
  }
  return size - priorSize;
}

function parseMs(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

