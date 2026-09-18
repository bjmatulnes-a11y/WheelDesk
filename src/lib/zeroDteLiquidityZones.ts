import type { EsOrderFlowSample, EsOrderFlowState } from "./zeroDteEsOrderFlow";

export type LiquidityZoneSide = "SUPPLY" | "DEMAND";
export type LiquidityZoneState =
  | "FORMING"
  | "ACTIVE"
  | "TESTING"
  | "ABSORBING"
  | "WEAKENING"
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
  stackingPct: number;
  displayedSizePct: number;
  touches: number;
  observations: number;
  totalObservedVolume: number;
  firstAt: string;
  lastAt: string;
};

export type LiquidityZoneRead = {
  generatedAt: string | null;
  basisEsMinusSpx: number | null;
  currentEs: number | null;
  currentSpx: number | null;
  sampleCount: number;
  supply: ProjectedLiquidityZone[];
  demand: ProjectedLiquidityZone[];
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
  executionVolume: number;
  absorptionVolume: number;
  touches: number;
  totalObservedVolume: number;
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
 * levels. The scoring favors persistence + size + actual executed volume and
 * discounts liquidity that is repeatedly pulled.
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
    observations: Math.max(1, ...raw.map((item) => item.observations)),
    avgSize: Math.max(1, ...raw.map((item) => averageSize(item))),
    stacking: Math.max(1, ...raw.map((item) => item.positiveStacking)),
    execution: Math.max(1, ...raw.map((item) => item.executionVolume)),
    absorption: Math.max(1, ...raw.map((item) => item.absorptionVolume)),
    touches: Math.max(1, ...raw.map((item) => item.touches)),
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
    warnings,
  };
}

function addBookObservation(
  buckets: Map<string, Bucket>,
  sample: EsOrderFlowSample,
  side: LiquidityZoneSide,
) {
  const price = side === "DEMAND" ? sample.bid : sample.ask;
  if (!finite(price)) return;
  const bucket = ensureBucket(buckets, side, Number(price), sample.timestamp);
  bucket.observations += 1;
  bucket.lastAt = sample.timestamp;

  const size = side === "DEMAND" ? sample.bidSize : sample.askSize;
  if (finite(size) && Number(size) >= 0) {
    bucket.sizeTotal += Number(size);
    bucket.sizeCount += 1;
  }

  const stacking = side === "DEMAND" ? sample.bidStacking : sample.askStacking;
  if (finite(stacking)) {
    if (Number(stacking) > 0) bucket.positiveStacking += Number(stacking);
    if (Number(stacking) < 0) bucket.pulledLiquidity += Math.abs(Number(stacking));
  }

  const tradePrice = sample.last ?? sample.mid;
  if (tradePrice != null && Math.abs(tradePrice - bucket.center) <= BUCKET_WIDTH * 0.75) {
    bucket.touches += 1;
  }
}

function addExecutionObservation(
  buckets: Map<string, Bucket>,
  sample: EsOrderFlowSample,
) {
  const price = sample.last ?? sample.mid;
  if (!finite(price) || sample.volumeDelta <= 0) return;

  // Aggressive buying into offers is evidence for supply only when price does
  // not efficiently advance. Aggressive selling into bids is the mirror image.
  const supply = ensureBucket(buckets, "SUPPLY", Number(price), sample.timestamp);
  const demand = ensureBucket(buckets, "DEMAND", Number(price), sample.timestamp);

  supply.totalObservedVolume += sample.volumeDelta;
  demand.totalObservedVolume += sample.volumeDelta;
  supply.executionVolume += sample.aggressiveBuyVolume;
  demand.executionVolume += sample.aggressiveSellVolume;

  const lowEfficiency = sample.efficiencyPct == null || sample.efficiencyPct < 50;
  const supplyAbsorptionState = isSupplyAbsorption(sample.state);
  const demandAbsorptionState = isDemandAbsorption(sample.state);

  if (sample.aggressiveBuyVolume > 0 && (lowEfficiency || supplyAbsorptionState)) {
    supply.absorptionVolume += sample.aggressiveBuyVolume;
  }
  if (sample.aggressiveSellVolume > 0 && (lowEfficiency || demandAbsorptionState)) {
    demand.absorptionVolume += sample.aggressiveSellVolume;
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
    execution: number;
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
  const executionPct = pct(bucket.executionVolume / maxima.execution);
  const absorptionPct = pct(bucket.absorptionVolume / maxima.absorption);
  const touchPct = pct(bucket.touches / maxima.touches);
  const pullPenalty = stackingGross > 0
    ? clamp((bucket.pulledLiquidity / stackingGross) * 18, 0, 18)
    : 0;

  const strength = clamp(
    persistencePct * 0.24 +
      recencyPct * 0.10 +
      displayedSizePct * 0.16 +
      stackingPct * 0.14 +
      executionPct * 0.15 +
      absorptionPct * 0.16 +
      touchPct * 0.05 -
      pullPenalty,
    0,
    100,
  );

  const classificationVolume = bucket.executionVolume;
  const volumeConfidence = bucket.totalObservedVolume > 0
    ? clamp((classificationVolume / bucket.totalObservedVolume) * 100, 0, 100)
    : 0;
  const warmupConfidence = clamp((args.sampleCount / 60) * 100, 0, 100);
  const confidencePct = clamp(
    warmupConfidence * 0.32 +
      persistencePct * 0.23 +
      recencyPct * 0.12 +
      volumeConfidence * 0.18 +
      displayedSizePct * 0.15,
    0,
    100,
  );

  const half = BUCKET_WIDTH / 2;
  const lowEs = bucket.center - half;
  const highEs = bucket.center + half;
  const lowSpx = projectToSpx(lowEs, args.basisEsMinusSpx);
  const highSpx = projectToSpx(highEs, args.basisEsMinusSpx);
  const centerSpx = projectToSpx(bucket.center, args.basisEsMinusSpx);

  return {
    id: `${bucket.side}:${bucket.center.toFixed(2)}`,
    side: bucket.side,
    state: classifyZoneState({
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
    }),
    lowEs,
    highEs,
    centerEs: bucket.center,
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
    stackingPct: round(stackingPct),
    displayedSizePct: round(displayedSizePct),
    touches: bucket.touches,
    observations: bucket.observations,
    totalObservedVolume: round(bucket.totalObservedVolume),
    firstAt: bucket.firstAt,
    lastAt: bucket.lastAt,
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
  const broken = args.currentEs != null && (
    args.side === "SUPPLY"
      ? args.currentEs > args.highEs + 1 && args.pressure > 18 && args.efficiency >= 42
      : args.currentEs < args.lowEs - 1 && args.pressure < -18 && args.efficiency >= 42
  );
  if (broken) return "BROKEN";

  const absorptionState = args.side === "SUPPLY"
    ? isSupplyAbsorption(args.latestState)
    : isDemandAbsorption(args.latestState);
  if (near && (args.absorptionPct >= 45 || absorptionState)) return "ABSORBING";
  if (near) return "TESTING";
  if (args.ageMs >= 5 * 60_000) return "WEAKENING";
  if (args.pullRatio >= 0.58 || (args.touches >= 8 && args.strength < 55)) return "WEAKENING";
  if (args.strength >= 48) return "ACTIVE";
  return "FORMING";
}

function deconflictOppositeZones(zones: ProjectedLiquidityZone[]) {
  const byCenter = new Map<string, ProjectedLiquidityZone[]>();
  for (const zone of zones) {
    const key = zone.centerEs.toFixed(2);
    const list = byCenter.get(key) ?? [];
    list.push(zone);
    byCenter.set(key, list);
  }

  const keep = new Set<string>();
  for (const list of byCenter.values()) {
    if (list.length === 1) {
      keep.add(list[0].id);
      continue;
    }
    const supply = list.find((zone) => zone.side === "SUPPLY");
    const demand = list.find((zone) => zone.side === "DEMAND");
    if (!supply || !demand) {
      list.forEach((zone) => keep.add(zone.id));
      continue;
    }

    // A top-of-book snapshot naturally observes both bid and ask around the
    // same price. When directional evidence is nearly tied, treating that
    // bucket as both supply and demand paints a false red/cyan overlap. Keep
    // only a materially dominant side; otherwise call it balanced and omit it.
    const spread = Math.abs(supply.strength - demand.strength);
    if (spread < 7) continue;
    keep.add(supply.strength > demand.strength ? supply.id : demand.id);
  }
  return zones.filter((zone) => keep.has(zone.id));
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
      executionVolume: 0,
      absorptionVolume: 0,
      touches: 0,
      totalObservedVolume: 0,
    };
    buckets.set(key, bucket);
  }
  return bucket;
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
