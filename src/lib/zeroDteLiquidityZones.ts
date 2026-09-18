import type { EsOrderFlowSample, EsOrderFlowState } from "./zeroDteEsOrderFlow";

export type LiquidityZoneSide = "SUPPLY" | "DEMAND" | "BALANCED";
export type LiquidityZoneState =
  | "FORMING"
  | "ACTIVE"
  | "TESTING"
  | "ABSORBING"
  | "WEAKENING"
  | "DORMANT"
  | "BROKEN";

export type ProjectedLiquidityZone = {
  id: string;
  side: LiquidityZoneSide;
  state: LiquidityZoneState;
  lowEs: number;
  highEs: number;
  centerEs: number;
  lowSpx: number | null;
  highSpx: number | null;
  centerSpx: number | null;
  basisEsMinusSpx: number | null;
  strength: number;
  confidencePct: number;
  persistencePct: number;
  recencyPct: number;
  absorptionPct: number;
  executionPct: number;
  consumedPct: number;
  stackingPct: number;
  displayedSizePct: number;
  touches: number;
  observations: number;
  totalObservedVolume: number;
  firstAt: string;
  lastAt: string;
  memoryStatus: "LIVE" | "RETAINED";
  peakStrength: number;
  peakConfidencePct: number;
  peakState?: LiquidityZoneState;
  flippedFrom?: "SUPPLY" | "DEMAND" | null;
  brokenAt?: string | null;
};

export type LiquidityZoneRead = {
  generatedAt: string | null;
  basisEsMinusSpx: number | null;
  currentEs: number | null;
  currentSpx: number | null;
  sampleCount: number;
  supply: ProjectedLiquidityZone[];
  demand: ProjectedLiquidityZone[];
  balanced: ProjectedLiquidityZone[];
  registry: ProjectedLiquidityZone[];
  retainedCount: number;
  warnings: string[];
};

type Bucket = {
  side: LiquidityZoneSide;
  center: number;
  firstAt: string;
  lastAt: string;
  observations: number;
  sizeTotal: number;
  sizeCount: number;
  positiveStacking: number;
  pulledLiquidity: number;
  executionAbsorbed: number;
  executionConsumed: number;
  absorptionVolume: number;
  touches: number;
  totalObservedVolume: number;
  weightedPriceTotal: number;
  weightedPriceWeight: number;
  lastTouchAtMs: number | null;
};

const ES_TICK = 0.25;
const BUCKET_WIDTH = 2;
const MAX_WINDOW_MS = 15 * 60_000;
const MIN_OBSERVATIONS = 3;
const MAX_ZONES_PER_SIDE = 4;

/**
 * Builds short-lived supply/demand proxy zones entirely from the ES samples
 * already collected by the 1-second order-flow observer. There are no network,
 * Supabase, or persistence calls in this module.
 *
 * The current Schwab feed is top-of-book plus aggregate volume between REST
 * snapshots, so these are explicitly proxy zones rather than full DOM heatmap
 * levels. `persistencePct` is intentionally only a low-weight dwell/acceptance
 * measure; directional supply/demand strength is driven primarily by absorbed
 * execution, stacking and displayed size, while efficient consumption and
 * pulled liquidity are penalties.
 */
export function buildEsLiquidityZones(args: {
  samples: EsOrderFlowSample[];
  spxPrice?: number | null;
  maxZonesPerSide?: number;
}): LiquidityZoneRead {
  const samples = usableWindow(args.samples);
  const latest = samples.at(-1) ?? null;
  const currentEs = latest?.last ?? latest?.mid ?? null;
  const currentSpx = finite(args.spxPrice) && Number(args.spxPrice) > 0
    ? Number(args.spxPrice)
    : null;
  const basisEsMinusSpx =
    currentEs != null && currentSpx != null ? currentEs - currentSpx : null;

  if (!samples.length) {
    return {
      generatedAt: null,
      basisEsMinusSpx,
      currentEs,
      currentSpx,
      sampleCount: 0,
      supply: [],
      demand: [],
      balanced: [],
      registry: [],
      retainedCount: 0,
      warnings: ["Liquidity zones are warming up."],
    };
  }

  const buckets = new Map<string, Bucket>();
  for (const sample of samples) {
    addBookObservation(buckets, sample, "DEMAND");
    addBookObservation(buckets, sample, "SUPPLY");
    addExecutionObservation(buckets, sample);
  }

  const raw = [...buckets.values()].filter(
    (bucket) => bucket.observations >= MIN_OBSERVATIONS,
  );
  const maxima = {
    observations: raw.reduce((max, item) => Math.max(max, item.observations), 1),
    avgSize: raw.reduce((max, item) => Math.max(max, averageSize(item)), 1),
    stacking: raw.reduce((max, item) => Math.max(max, item.positiveStacking), 1),
    executionAbsorbed: raw.reduce((max, item) => Math.max(max, item.executionAbsorbed), 1),
    executionConsumed: raw.reduce((max, item) => Math.max(max, item.executionConsumed), 1),
    absorption: raw.reduce((max, item) => Math.max(max, item.absorptionVolume), 1),
    touches: raw.reduce((max, item) => Math.max(max, item.touches), 1),
  };

  const scoredZones = raw
    .map((bucket) => scoreBucket({
      bucket,
      latestState: latest?.state ?? "WARMING",
      latestPressure: latest?.directionalPressurePct ?? 0,
      latestEfficiency: latest?.efficiencyPct ?? 0,
      currentEs,
      basisEsMinusSpx,
      latestMs: Date.parse(latest?.timestamp ?? ""),
      sampleCount: samples.length,
      maxima,
    }))
    .filter((zone) => zone.strength >= 24)
    .sort((a, b) => b.strength - a.strength);
  const zones = deconflictOppositeZones(scoredZones);

  const maxPerSide = Math.max(1, Math.min(8, args.maxZonesPerSide ?? MAX_ZONES_PER_SIDE));
  const supply = nearestRelevant(
    zones.filter((zone) => zone.side === "SUPPLY"),
    currentEs,
    maxPerSide,
  );
  const demand = nearestRelevant(
    zones.filter((zone) => zone.side === "DEMAND"),
    currentEs,
    maxPerSide,
  );
  const balanced = nearestRelevant(
    zones.filter((zone) => zone.side === "BALANCED"),
    currentEs,
    Math.min(4, maxPerSide),
  );

  const warnings: string[] = [];
  if (basisEsMinusSpx == null) {
    warnings.push("SPX basis is unavailable; ES zones cannot yet be projected onto the SPX chart.");
  }
  if (samples.length < 20) {
    warnings.push("Supply/demand confidence is limited while the ES observer warms up.");
  }

  return {
    generatedAt: latest?.timestamp ?? null,
    basisEsMinusSpx,
    currentEs,
    currentSpx,
    sampleCount: samples.length,
    supply,
    demand,
    balanced,
    registry: zones,
    retainedCount: 0,
    warnings,
  };
}

function addBookObservation(
  buckets: Map<string, Bucket>,
  sample: EsOrderFlowSample,
  side: LiquidityZoneSide,
) {
  if (side === "BALANCED") return;
  const price = side === "DEMAND" ? sample.bid : sample.ask;
  if (!finite(price)) return;
  const numericPrice = Number(price);
  const bucket = ensureBucket(buckets, side, numericPrice, sample.timestamp);
  bucket.observations += 1;
  bucket.lastAt = sample.timestamp;

  const size = side === "DEMAND" ? sample.bidSize : sample.askSize;
  if (finite(size) && Number(size) >= 0) {
    const numericSize = Number(size);
    bucket.sizeTotal += numericSize;
    bucket.sizeCount += 1;
    addWeightedPrice(bucket, numericPrice, Math.max(1, numericSize));
  } else {
    addWeightedPrice(bucket, numericPrice, 1);
  }

  const stacking = side === "DEMAND" ? sample.bidStacking : sample.askStacking;
  if (finite(stacking)) {
    if (Number(stacking) > 0) bucket.positiveStacking += Number(stacking);
    if (Number(stacking) < 0) bucket.pulledLiquidity += Math.abs(Number(stacking));
  }

  // Count distinct tests rather than every 1-second sample at the same price.
  // This prevents `touches` from being a second copy of dwell time.
  const tradePrice = sample.last ?? sample.mid;
  if (tradePrice != null && Math.abs(tradePrice - weightedCenter(bucket)) <= BUCKET_WIDTH * 0.75) {
    const touchMs = Date.parse(sample.timestamp);
    if (!Number.isFinite(touchMs) || bucket.lastTouchAtMs == null || touchMs - bucket.lastTouchAtMs >= 20_000) {
      bucket.touches += 1;
      bucket.lastTouchAtMs = Number.isFinite(touchMs) ? touchMs : bucket.lastTouchAtMs;
    }
  }
}

function addExecutionObservation(
  buckets: Map<string, Bucket>,
  sample: EsOrderFlowSample,
) {
  const price = sample.last ?? sample.mid;
  if (!finite(price) || sample.volumeDelta <= 0) return;

  const numericPrice = Number(price);
  const supply = ensureBucket(buckets, "SUPPLY", numericPrice, sample.timestamp);
  const demand = ensureBucket(buckets, "DEMAND", numericPrice, sample.timestamp);

  supply.totalObservedVolume += sample.volumeDelta;
  demand.totalObservedVolume += sample.volumeDelta;

  const efficiency = sample.efficiencyPct;
  const lowEfficiency = efficiency == null || efficiency < 50;
  const strongAbsorptionEfficiency = efficiency != null && efficiency < 35;
  const supplyAbsorptionState = isSupplyAbsorption(sample.state);
  const demandAbsorptionState = isDemandAbsorption(sample.state);

  if (sample.aggressiveBuyVolume > 0) {
    addWeightedPrice(supply, numericPrice, sample.aggressiveBuyVolume);
    if (lowEfficiency || supplyAbsorptionState) {
      supply.executionAbsorbed += sample.aggressiveBuyVolume;
      if (strongAbsorptionEfficiency || supplyAbsorptionState) {
        supply.absorptionVolume += sample.aggressiveBuyVolume;
      }
    } else {
      // Efficient buying that advances through the level means supply was
      // consumed, not defended. Treat it as negative evidence.
      supply.executionConsumed += sample.aggressiveBuyVolume;
    }
  }

  if (sample.aggressiveSellVolume > 0) {
    addWeightedPrice(demand, numericPrice, sample.aggressiveSellVolume);
    if (lowEfficiency || demandAbsorptionState) {
      demand.executionAbsorbed += sample.aggressiveSellVolume;
      if (strongAbsorptionEfficiency || demandAbsorptionState) {
        demand.absorptionVolume += sample.aggressiveSellVolume;
      }
    } else {
      // Efficient selling through the bid means demand was consumed.
      demand.executionConsumed += sample.aggressiveSellVolume;
    }
  }
}

function scoreBucket(args: {
  bucket: Bucket;
  latestState: EsOrderFlowState;
  latestPressure: number;
  latestEfficiency: number;
  currentEs: number | null;
  basisEsMinusSpx: number | null;
  latestMs: number;
  sampleCount: number;
  maxima: {
    observations: number;
    avgSize: number;
    stacking: number;
    executionAbsorbed: number;
    executionConsumed: number;
    absorption: number;
    touches: number;
  };
}): ProjectedLiquidityZone {
  const { bucket, maxima } = args;
  const persistencePct = pct(bucket.observations / maxima.observations);
  const lastSeenMs = Date.parse(bucket.lastAt);
  const ageMs = Number.isFinite(args.latestMs) && Number.isFinite(lastSeenMs)
    ? Math.max(0, args.latestMs - lastSeenMs)
    : 0;
  const recencyPct = clamp(100 * Math.exp(-ageMs / (8 * 60_000)), 12, 100);
  const displayedSizePct = pct(averageSize(bucket) / maxima.avgSize);
  const stackingGross = bucket.positiveStacking + bucket.pulledLiquidity;
  const stackingQuality = stackingGross > 0
    ? bucket.positiveStacking / stackingGross
    : 0;
  const stackingPct = pct((bucket.positiveStacking / maxima.stacking) * stackingQuality);
  const executionPct = pct(bucket.executionAbsorbed / maxima.executionAbsorbed);
  const consumedPct = pct(bucket.executionConsumed / maxima.executionConsumed);
  const absorptionPct = pct(bucket.absorptionVolume / maxima.absorption);
  const touchPct = pct(bucket.touches / maxima.touches);
  const pullPenalty = stackingGross > 0
    ? clamp((bucket.pulledLiquidity / stackingGross) * 20, 0, 20)
    : 0;
  const consumedPenalty = consumedPct * 0.20;

  // Dwell/acceptance is deliberately low weight because top-of-book samples
  // cannot observe resting liquidity away from price. Absorption is the
  // strongest directional evidence available in this feed.
  const strength = clamp(
    persistencePct * 0.08 +
      recencyPct * 0.10 +
      displayedSizePct * 0.10 +
      stackingPct * 0.12 +
      executionPct * 0.16 +
      absorptionPct * 0.32 +
      touchPct * 0.04 -
      consumedPenalty -
      pullPenalty,
    0,
    100,
  );

  const classificationVolume = bucket.executionAbsorbed + bucket.executionConsumed;
  const volumeConfidence = bucket.totalObservedVolume > 0
    ? clamp((classificationVolume / bucket.totalObservedVolume) * 100, 0, 100)
    : 0;
  const warmupConfidence = clamp((args.sampleCount / 60) * 100, 0, 100);
  const confidencePct = clamp(
    warmupConfidence * 0.25 +
      persistencePct * 0.10 +
      recencyPct * 0.15 +
      volumeConfidence * 0.20 +
      absorptionPct * 0.20 +
      displayedSizePct * 0.10,
    0,
    100,
  );

  const centerEs = weightedCenter(bucket);
  const half = BUCKET_WIDTH / 2;
  const lowEs = centerEs - half;
  const highEs = centerEs + half;
  const lowSpx = projectToSpx(lowEs, args.basisEsMinusSpx);
  const highSpx = projectToSpx(highEs, args.basisEsMinusSpx);
  const centerSpx = projectToSpx(centerEs, args.basisEsMinusSpx);
  assertProjectedWidth(lowSpx, highSpx, `${bucket.side}:${bucket.center.toFixed(2)}`);
  const state = classifyZoneState({
    side: bucket.side,
    strength,
    absorptionPct,
    touches: bucket.touches,
    currentEs: args.currentEs,
    lowEs,
    highEs,
    pressure: args.latestPressure,
    efficiency: args.latestEfficiency,
    latestState: args.latestState,
    ageMs,
    pullRatio: stackingGross > 0 ? bucket.pulledLiquidity / stackingGross : 0,
  });

  return {
    id: `${bucket.side}:${bucket.center.toFixed(2)}`,
    side: bucket.side,
    state,
    lowEs,
    highEs,
    centerEs,
    lowSpx,
    highSpx,
    centerSpx,
    basisEsMinusSpx: args.basisEsMinusSpx,
    strength: round(strength),
    confidencePct: round(confidencePct),
    persistencePct: round(persistencePct),
    recencyPct: round(recencyPct),
    absorptionPct: round(absorptionPct),
    executionPct: round(executionPct),
    consumedPct: round(consumedPct),
    stackingPct: round(stackingPct),
    displayedSizePct: round(displayedSizePct),
    touches: bucket.touches,
    observations: bucket.observations,
    totalObservedVolume: round(bucket.totalObservedVolume),
    firstAt: bucket.firstAt,
    lastAt: bucket.lastAt,
    memoryStatus: "LIVE",
    peakStrength: round(strength),
    peakConfidencePct: round(confidencePct),
    peakState: state,
    flippedFrom: null,
    brokenAt: null,
  };
}

function classifyZoneState(args: {
  side: LiquidityZoneSide;
  strength: number;
  absorptionPct: number;
  touches: number;
  currentEs: number | null;
  lowEs: number;
  highEs: number;
  pressure: number;
  efficiency: number;
  latestState: EsOrderFlowState;
  ageMs: number;
  pullRatio: number;
}): LiquidityZoneState {
  const near = args.currentEs != null &&
    args.currentEs >= args.lowEs - 0.75 &&
    args.currentEs <= args.highEs + 0.75;

  if (args.side !== "BALANCED") {
    const broken = args.currentEs != null && (
      args.side === "SUPPLY"
        ? args.currentEs > args.highEs + 1 && args.pressure > 18 && args.efficiency >= 42
        : args.currentEs < args.lowEs - 1 && args.pressure < -18 && args.efficiency >= 42
    );
    if (broken) return "BROKEN";
  }

  const absorptionState = args.side === "SUPPLY"
    ? isSupplyAbsorption(args.latestState)
    : args.side === "DEMAND"
      ? isDemandAbsorption(args.latestState)
      : false;
  if (near && (args.absorptionPct >= 45 || absorptionState)) return "ABSORBING";
  if (near) return "TESTING";
  if (args.ageMs >= 5 * 60_000) return "WEAKENING";
  if (args.pullRatio >= 0.58 || (args.touches >= 4 && args.strength < 55)) return "WEAKENING";
  if (args.strength >= 48) return "ACTIVE";
  return "FORMING";
}

function deconflictOppositeZones(zones: ProjectedLiquidityZone[]) {
  const byCenter = new Map<string, ProjectedLiquidityZone[]>();
  for (const zone of zones) {
    const snapped = Math.round(zone.centerEs / BUCKET_WIDTH) * BUCKET_WIDTH;
    const key = snapped.toFixed(2);
    const list = byCenter.get(key) ?? [];
    list.push(zone);
    byCenter.set(key, list);
  }

  const result: ProjectedLiquidityZone[] = [];
  for (const [key, list] of byCenter.entries()) {
    if (list.length === 1) {
      result.push(list[0]);
      continue;
    }
    const supply = list.find((zone) => zone.side === "SUPPLY");
    const demand = list.find((zone) => zone.side === "DEMAND");
    if (!supply || !demand) {
      result.push(...list);
      continue;
    }

    const strengthDiff = supply.strength - demand.strength;
    const executionEdge =
      (supply.executionPct - demand.executionPct) * 0.65 +
      (supply.absorptionPct - demand.absorptionPct) * 0.35;

    // Do not delete balanced high-information levels. When the directional
    // edge is genuinely tied, emit a neutral acceptance band instead of
    // painting simultaneous supply and demand or silently dropping both.
    if (Math.abs(strengthDiff) < 3 && Math.abs(executionEdge) < 10) {
      result.push(makeBalancedZone(key, supply, demand));
      continue;
    }

    if (Math.abs(executionEdge) >= 6) {
      result.push(executionEdge > 0 ? supply : demand);
    } else {
      result.push(strengthDiff >= 0 ? supply : demand);
    }
  }
  return result.sort((a, b) => b.strength - a.strength);
}

function makeBalancedZone(
  key: string,
  supply: ProjectedLiquidityZone,
  demand: ProjectedLiquidityZone,
): ProjectedLiquidityZone {
  const strength = round((supply.strength + demand.strength) / 2);
  const confidencePct = round((supply.confidencePct + demand.confidencePct) / 2);
  // A BALANCED zone replaces the directional pair at one canonical ES bucket.
  // Never union already-projected SPX values (or slightly different weighted
  // centers), because that inflates a 2-point bucket when basis moves.
  const centerEs = Number(key);
  const half = BUCKET_WIDTH / 2;
  const lowEs = centerEs - half;
  const highEs = centerEs + half;
  const basis = supply.basisEsMinusSpx ?? demand.basisEsMinusSpx;
  const lowSpx = projectToSpx(lowEs, basis);
  const highSpx = projectToSpx(highEs, basis);
  const centerSpx = projectToSpx(centerEs, basis);
  assertProjectedWidth(lowSpx, highSpx, `BALANCED:${key}`);
  const state = balancedState(supply.state, demand.state, strength);
  return {
    id: `BALANCED:${key}`,
    side: "BALANCED",
    state,
    lowEs,
    highEs,
    centerEs,
    lowSpx,
    highSpx,
    centerSpx,
    basisEsMinusSpx: basis,
    strength,
    confidencePct,
    persistencePct: round((supply.persistencePct + demand.persistencePct) / 2),
    recencyPct: Math.max(supply.recencyPct, demand.recencyPct),
    absorptionPct: round((supply.absorptionPct + demand.absorptionPct) / 2),
    executionPct: round((supply.executionPct + demand.executionPct) / 2),
    consumedPct: round((supply.consumedPct + demand.consumedPct) / 2),
    stackingPct: round((supply.stackingPct + demand.stackingPct) / 2),
    displayedSizePct: round((supply.displayedSizePct + demand.displayedSizePct) / 2),
    touches: Math.max(supply.touches, demand.touches),
    observations: Math.max(supply.observations, demand.observations),
    totalObservedVolume: Math.max(supply.totalObservedVolume, demand.totalObservedVolume),
    firstAt: olderTimestamp(supply.firstAt, demand.firstAt),
    lastAt: newerTimestamp(supply.lastAt, demand.lastAt),
    memoryStatus: "LIVE",
    peakStrength: strength,
    peakConfidencePct: confidencePct,
    peakState: state,
    flippedFrom: null,
    brokenAt: null,
  };
}

function balancedState(
  supply: LiquidityZoneState,
  demand: LiquidityZoneState,
  strength: number,
): LiquidityZoneState {
  const states = new Set([supply, demand]);
  if (states.has("ABSORBING")) return "ABSORBING";
  if (states.has("TESTING")) return "TESTING";
  if (states.has("ACTIVE") || strength >= 48) return "ACTIVE";
  if (states.has("WEAKENING")) return "WEAKENING";
  return "FORMING";
}

function nearestRelevant(
  zones: ProjectedLiquidityZone[],
  currentEs: number | null,
  limit: number,
) {
  const live = zones.filter((zone) => {
    if (zone.state === "BROKEN") return false;
    if (currentEs == null) return true;
    // Keep supply primarily overhead and demand primarily underneath. Allow a
    // small overlap while a level is actively being tested so the zone does
    // not blink off at the exact moment it matters most.
    if (zone.side === "BALANCED") {
      return distanceToZone(currentEs, zone.lowEs, zone.highEs) <= 60;
    }
    return zone.side === "SUPPLY"
      ? zone.highEs >= currentEs - 1.5
      : zone.lowEs <= currentEs + 1.5;
  });
  const ranked = [...live].sort((a, b) => {
    if (currentEs == null) return b.strength - a.strength;
    const da = distanceToZone(currentEs, a.lowEs, a.highEs);
    const db = distanceToZone(currentEs, b.lowEs, b.highEs);
    const distanceBias = da - db;
    if (Math.abs(distanceBias) > 3) return distanceBias;
    return b.strength - a.strength;
  });
  return ranked.slice(0, limit);
}

function usableWindow(samples: EsOrderFlowSample[]) {
  const latest = samples.at(-1);
  if (!latest) return [];
  const latestMs = Date.parse(latest.timestamp);
  if (!Number.isFinite(latestMs)) return samples.slice(-240);
  return samples.filter((sample) => {
    const ms = Date.parse(sample.timestamp);
    return Number.isFinite(ms) && latestMs - ms <= MAX_WINDOW_MS;
  });
}

function ensureBucket(
  buckets: Map<string, Bucket>,
  side: LiquidityZoneSide,
  price: number,
  timestamp: string,
) {
  const center = Math.round(price / BUCKET_WIDTH) * BUCKET_WIDTH;
  const key = `${side}:${center.toFixed(2)}`;
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = {
      side,
      center,
      firstAt: timestamp,
      lastAt: timestamp,
      observations: 0,
      sizeTotal: 0,
      sizeCount: 0,
      positiveStacking: 0,
      pulledLiquidity: 0,
      executionAbsorbed: 0,
      executionConsumed: 0,
      absorptionVolume: 0,
      touches: 0,
      totalObservedVolume: 0,
      weightedPriceTotal: 0,
      weightedPriceWeight: 0,
      lastTouchAtMs: null,
    };
    buckets.set(key, bucket);
  }
  return bucket;
}


function addWeightedPrice(bucket: Bucket, price: number, weight: number) {
  if (!Number.isFinite(price) || !Number.isFinite(weight) || weight <= 0) return;
  bucket.weightedPriceTotal += price * weight;
  bucket.weightedPriceWeight += weight;
}

function weightedCenter(bucket: Bucket) {
  if (bucket.weightedPriceWeight <= 0) return bucket.center;
  return bucket.weightedPriceTotal / bucket.weightedPriceWeight;
}

function olderTimestamp(a: string, b: string) {
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

function newerTimestamp(a: string, b: string) {
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function isSupplyAbsorption(state: EsOrderFlowState) {
  return state === "ABSORBING_HIGH" || state === "EXHAUSTING_UP" || state === "REVERSAL_DOWN";
}

function isDemandAbsorption(state: EsOrderFlowState) {
  return state === "ABSORBING_LOW" || state === "EXHAUSTING_DOWN" || state === "REVERSAL_UP";
}

function averageSize(bucket: Bucket) {
  return bucket.sizeCount > 0 ? bucket.sizeTotal / bucket.sizeCount : 0;
}

function projectToSpx(esPrice: number, basisEsMinusSpx: number | null) {
  return basisEsMinusSpx == null ? null : esPrice - basisEsMinusSpx;
}

function assertProjectedWidth(lowSpx: number | null, highSpx: number | null, id: string) {
  if (lowSpx == null || highSpx == null) return;
  const width = highSpx - lowSpx;
  if (Math.abs(width - BUCKET_WIDTH) > 0.001) {
    console.warn(`[WheelDesk] Liquidity-zone projection width invariant failed for ${id}: ${width.toFixed(4)} vs ${BUCKET_WIDTH.toFixed(2)}`);
  }
}

function distanceToZone(price: number, low: number, high: number) {
  if (price < low) return low - price;
  if (price > high) return price - high;
  return 0;
}

function pct(value: number) {
  return clamp(value * 100, 0, 100);
}

function finite(value: unknown) {
  return Number.isFinite(Number(value));
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export const ES_LIQUIDITY_ZONE_TICK = ES_TICK;
