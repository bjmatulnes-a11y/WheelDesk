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
  efficiencyPct: number | null;
  bidStacking: number | null;
  askStacking: number | null;
  sourceTotalVolume: number | null;
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
const EFFICIENCY_WINDOW_MS = 8_000;
const RECENT_STATE_MS = 45_000;

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
    efficiencyPct: null,
    bidStacking: samePriceDelta(snapshot.bid, snapshot.bidSize, prior?.bid, prior?.bidSize),
    askStacking: samePriceDelta(snapshot.ask, snapshot.askSize, prior?.ask, prior?.askSize),
    sourceTotalVolume: snapshot.totalVolume,
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
  const efficiencyFirstMid =
    efficiencyRolling.find((sample) => sample.mid != null)?.mid ?? null;
  const efficiencyDisplacementTicks =
    mid != null && efficiencyFirstMid != null
      ? (mid - efficiencyFirstMid) / ES_TICK
      : null;
  const efficiencyVolume = sum(
    efficiencyRolling.map((sample) => sample.volumeDelta),
  );
  const efficiencyPct = calculateEfficiencyPct(
    efficiencyDisplacementTicks,
    efficiencyVolume,
  );

  const enriched: EsOrderFlowSample = {
    ...provisional,
    rollingDelta20s,
    rollingVolume20s,
    directionalPressurePct,
    intensityZ,
    priceDisplacementTicks20s,
    efficiencyDisplacementTicks,
    efficiencyPct,
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

function calculateEfficiencyPct(
  displacementTicks: number | null,
  rollingVolume: number,
) {
  if (displacementTicks == null || rollingVolume <= 0) return null;
  // Impact is intentionally normalized by sqrt(volume), not raw volume. This
  // prevents very active periods from appearing inefficient simply because
  // absolute contracts are large. It is a relative auction-efficiency proxy,
  // not a claim about true market impact per contract.
  const expectedTicks = Math.max(1, Math.sqrt(rollingVolume / 40));
  return clamp((Math.abs(displacementTicks) / expectedTicks) * 100, 0, 100);
}

function classifyState(
  samples: EsOrderFlowSample[],
  latest: EsOrderFlowSample,
): EsOrderFlowState {
  if (samples.length < 12 || latest.intensityZ == null || latest.efficiencyPct == null) {
    return "WARMING";
  }
  const pressure = latest.directionalPressurePct;
  const displacement = latest.efficiencyDisplacementTicks ?? 0;
  const intensity = latest.intensityZ;
  const efficiency = latest.efficiencyPct;
  const nowMs = parseMs(latest.timestamp);
  const recentStates = samples
    .slice(0, -1)
    .filter((sample) => nowMs - parseMs(sample.timestamp) <= RECENT_STATE_MS)
    .map((sample) => sample.state);
  const hadHighAbsorption = recentStates.includes("ABSORBING_HIGH");
  const hadLowAbsorption = recentStates.includes("ABSORBING_LOW");
  const hadUpExhaustion = recentStates.includes("EXHAUSTING_UP");
  const hadDownExhaustion = recentStates.includes("EXHAUSTING_DOWN");

  if (hadUpExhaustion && pressure <= -20 && displacement <= -1) return "REVERSAL_DOWN";
  if (hadDownExhaustion && pressure >= 20 && displacement >= 1) return "REVERSAL_UP";

  if (
    hadHighAbsorption &&
    (pressure < 25 || intensity < 0.6) &&
    displacement <= 1
  ) {
    return "EXHAUSTING_UP";
  }
  if (
    hadLowAbsorption &&
    (pressure > -25 || intensity < 0.6) &&
    displacement >= -1
  ) {
    return "EXHAUSTING_DOWN";
  }

  if (pressure >= 45 && intensity >= 1.1 && efficiency <= 45 && displacement < 3) {
    return "ABSORBING_HIGH";
  }
  if (pressure <= -45 && intensity >= 1.1 && efficiency <= 45 && displacement > -3) {
    return "ABSORBING_LOW";
  }
  if (pressure >= 30 && intensity >= 0.7 && efficiency >= 55 && displacement >= 1) {
    return "RELEASE_UP";
  }
  if (pressure <= -30 && intensity >= 0.7 && efficiency >= 55 && displacement <= -1) {
    return "RELEASE_DOWN";
  }
  if (intensity >= 0.5 || Math.abs(pressure) >= 20) return "BUILDING";
  return "DORMANT";
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

