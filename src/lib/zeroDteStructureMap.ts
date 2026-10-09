export type StructureDirection = "BULL" | "BEAR";
export type StructureScale = "INTERNAL" | "EXTERNAL";
export type StructureEventKind = "BOS" | "CHOCH";
export type SwingLabel = "HH" | "LH" | "HL" | "LL";

export interface StructureCandle {
  /** Unix epoch seconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Optional traded/proxy volume. For SPX, prefer ES/SPY proxy volume. */
  volume?: number | null;
}

export interface StructureSwing {
  id: string;
  scale: StructureScale;
  kind: "HIGH" | "LOW";
  label: SwingLabel;
  time: number;
  confirmedAt: number;
  price: number;
  index: number;
  confirmIndex: number;
}

export interface StructureBreak {
  id: string;
  scale: StructureScale;
  kind: StructureEventKind;
  direction: StructureDirection;
  level: number;
  swingTime: number;
  breakTime: number;
  breakIndex: number;
}

export interface LiquiditySweep {
  id: string;
  /** BULL means a downside sweep reclaimed the level; BEAR means an upside sweep rejected. */
  direction: StructureDirection;
  scale: StructureScale;
  level: number;
  swingTime: number;
  sweepTime: number;
  sweepIndex: number;
}

export interface FairValueGap {
  id: string;
  direction: StructureDirection;
  low: number;
  high: number;
  startedAt: number;
  startIndex: number;
  mitigated: boolean;
  mitigatedAt: number | null;
  mitigationIndex: number | null;
}

export interface ReactionZone {
  id: string;
  direction: StructureDirection;
  low: number;
  high: number;
  mid: number;
  startedAt: number;
  startIndex: number;
  strength: number;
  relativeVolume: number;
  mitigated: boolean;
  mitigatedAt: number | null;
  mitigationIndex: number | null;
}

export interface ThreeBarReversal {
  id: string;
  direction: StructureDirection;
  time: number;
  index: number;
  price: number;
  enhanced: boolean;
}

export interface StructureFibLevel {
  ratio: number;
  price: number;
  direction: StructureDirection;
  anchorStartTime: number;
  anchorEndTime: number;
}

export interface ZeroDteStructureSnapshot {
  generatedAt: number | null;
  trendInternal: StructureDirection | null;
  trendExternal: StructureDirection | null;
  swings: StructureSwing[];
  breaks: StructureBreak[];
  sweeps: LiquiditySweep[];
  fvgs: FairValueGap[];
  reactionZones: ReactionZone[];
  reversals: ThreeBarReversal[];
  fibLevels: StructureFibLevel[];
}

export interface ZeroDteStructureOptions {
  /** Symmetric pivot radius in bars. 3 means 3 bars on each side. */
  internalRadius?: number;
  /** Symmetric pivot radius in bars. 8 is responsive enough for 1m 0DTE. */
  externalRadius?: number;
  /** Ignore FVGs smaller than this percentage of the prior reference price. */
  fvgThresholdPct?: number;
  /** CLOSE is more conservative; WICK removes zones on a simple touch-through. */
  mitigationMode?: "CLOSE" | "WICK";
  /** Radius used to find local peaks in the supplied ES/SPY proxy volume. */
  reactionVolumeRadius?: number;
  /** Minimum local-volume / rolling-median ratio required for a reaction zone. */
  reactionMinRelativeVolume?: number;
  /** Number of bars used for rolling median volume normalization. */
  reactionVolumeLookback?: number;
}

const DEFAULTS: Required<ZeroDteStructureOptions> = {
  internalRadius: 3,
  externalRadius: 8,
  fvgThresholdPct: 0,
  mitigationMode: "CLOSE",
  reactionVolumeRadius: 3,
  reactionMinRelativeVolume: 1.35,
  reactionVolumeLookback: 50,
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function normalizeStructureCandles(
  candles: readonly StructureCandle[],
): StructureCandle[] {
  const byTime = new Map<number, StructureCandle>();
  for (const candle of candles) {
    if (
      !finite(candle.time) ||
      !finite(candle.open) ||
      !finite(candle.high) ||
      !finite(candle.low) ||
      !finite(candle.close) ||
      candle.high < candle.low
    ) {
      continue;
    }
    byTime.set(candle.time, {
      ...candle,
      volume: finite(candle.volume) && candle.volume! > 0 ? candle.volume : null,
    });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

function isPivotHigh(candles: readonly StructureCandle[], index: number, radius: number): boolean {
  const price = candles[index]?.high;
  if (!finite(price) || index < radius || index + radius >= candles.length) return false;
  for (let j = index - radius; j <= index + radius; j += 1) {
    if (j === index) continue;
    const other = candles[j].high;
    if (other > price || (other === price && j > index)) return false;
  }
  return true;
}

function isPivotLow(candles: readonly StructureCandle[], index: number, radius: number): boolean {
  const price = candles[index]?.low;
  if (!finite(price) || index < radius || index + radius >= candles.length) return false;
  for (let j = index - radius; j <= index + radius; j += 1) {
    if (j === index) continue;
    const other = candles[j].low;
    if (other < price || (other === price && j > index)) return false;
  }
  return true;
}

function buildSwings(
  candles: readonly StructureCandle[],
  radius: number,
  scale: StructureScale,
): StructureSwing[] {
  const out: StructureSwing[] = [];
  let priorHigh: number | null = null;
  let priorLow: number | null = null;

  for (let index = radius; index + radius < candles.length; index += 1) {
    if (isPivotHigh(candles, index, radius)) {
      const price = candles[index].high;
      const label: SwingLabel = priorHigh == null || price >= priorHigh ? "HH" : "LH";
      out.push({
        id: `${scale}:H:${candles[index].time}`,
        scale,
        kind: "HIGH",
        label,
        time: candles[index].time,
        confirmedAt: candles[index + radius].time,
        price,
        index,
        confirmIndex: index + radius,
      });
      priorHigh = price;
    }
    if (isPivotLow(candles, index, radius)) {
      const price = candles[index].low;
      const label: SwingLabel = priorLow == null || price >= priorLow ? "HL" : "LL";
      out.push({
        id: `${scale}:L:${candles[index].time}`,
        scale,
        kind: "LOW",
        label,
        time: candles[index].time,
        confirmedAt: candles[index + radius].time,
        price,
        index,
        confirmIndex: index + radius,
      });
      priorLow = price;
    }
  }

  return out.sort((a, b) => a.confirmIndex - b.confirmIndex || a.index - b.index);
}

function buildBreaks(
  candles: readonly StructureCandle[],
  swings: readonly StructureSwing[],
  scale: StructureScale,
): { breaks: StructureBreak[]; trend: StructureDirection | null } {
  const byConfirmation = new Map<number, StructureSwing[]>();
  for (const swing of swings.filter((item) => item.scale === scale)) {
    const bucket = byConfirmation.get(swing.confirmIndex) ?? [];
    bucket.push(swing);
    byConfirmation.set(swing.confirmIndex, bucket);
  }

  let activeHigh: StructureSwing | null = null;
  let activeLow: StructureSwing | null = null;
  let highBroken = false;
  let lowBroken = false;
  let trend: StructureDirection | null = null;
  const breaks: StructureBreak[] = [];

  for (let index = 0; index < candles.length; index += 1) {
    for (const swing of byConfirmation.get(index) ?? []) {
      if (swing.kind === "HIGH") {
        activeHigh = swing;
        highBroken = false;
      } else {
        activeLow = swing;
        lowBroken = false;
      }
    }

    const close = candles[index].close;
    if (activeHigh && !highBroken && index > activeHigh.confirmIndex && close > activeHigh.price) {
      const kind: StructureEventKind = trend === "BEAR" ? "CHOCH" : "BOS";
      breaks.push({
        id: `${scale}:UP:${activeHigh.time}:${candles[index].time}`,
        scale,
        kind,
        direction: "BULL",
        level: activeHigh.price,
        swingTime: activeHigh.time,
        breakTime: candles[index].time,
        breakIndex: index,
      });
      highBroken = true;
      trend = "BULL";
    }

    if (activeLow && !lowBroken && index > activeLow.confirmIndex && close < activeLow.price) {
      const kind: StructureEventKind = trend === "BULL" ? "CHOCH" : "BOS";
      breaks.push({
        id: `${scale}:DN:${activeLow.time}:${candles[index].time}`,
        scale,
        kind,
        direction: "BEAR",
        level: activeLow.price,
        swingTime: activeLow.time,
        breakTime: candles[index].time,
        breakIndex: index,
      });
      lowBroken = true;
      trend = "BEAR";
    }
  }

  return { breaks, trend };
}


function buildLiquiditySweeps(
  candles: readonly StructureCandle[],
  swings: readonly StructureSwing[],
): LiquiditySweep[] {
  const out: LiquiditySweep[] = [];

  for (const swing of swings) {
    // A confirmed swing can attract stop liquidity for a while, but very old
    // levels should not manufacture fresh 0DTE sweep signals hours later.
    const endIndex = Math.min(candles.length - 1, swing.confirmIndex + 30);
    for (let index = swing.confirmIndex + 1; index <= endIndex; index += 1) {
      const candle = candles[index];
      if (!candle) continue;

      if (
        swing.kind === "HIGH" &&
        candle.high > swing.price &&
        candle.close < swing.price
      ) {
        out.push({
          id: `SWEEP:BEAR:${swing.scale}:${swing.time}:${candle.time}`,
          direction: "BEAR",
          scale: swing.scale,
          level: swing.price,
          swingTime: swing.time,
          sweepTime: candle.time,
          sweepIndex: index,
        });
        break;
      }

      if (
        swing.kind === "LOW" &&
        candle.low < swing.price &&
        candle.close > swing.price
      ) {
        out.push({
          id: `SWEEP:BULL:${swing.scale}:${swing.time}:${candle.time}`,
          direction: "BULL",
          scale: swing.scale,
          level: swing.price,
          swingTime: swing.time,
          sweepTime: candle.time,
          sweepIndex: index,
        });
        break;
      }
    }
  }

  return out.sort((a, b) => a.sweepIndex - b.sweepIndex);
}

function fvgMitigated(
  candle: StructureCandle,
  fvg: FairValueGap,
  mode: "CLOSE" | "WICK",
): boolean {
  if (fvg.direction === "BULL") {
    return mode === "CLOSE" ? candle.close < fvg.low : candle.low < fvg.low;
  }
  return mode === "CLOSE" ? candle.close > fvg.high : candle.high > fvg.high;
}

function buildFvgs(
  candles: readonly StructureCandle[],
  options: Required<ZeroDteStructureOptions>,
): FairValueGap[] {
  const gaps: FairValueGap[] = [];
  for (let index = 2; index < candles.length; index += 1) {
    const current = candles[index];
    const middle = candles[index - 1];
    const prior = candles[index - 2];
    const threshold = options.fvgThresholdPct / 100;

    const bullSize = current.low - prior.high;
    const bullReference = Math.max(Math.abs(prior.high), 1e-9);
    if (
      bullSize > 0 &&
      middle.close > prior.high &&
      bullSize / bullReference >= threshold
    ) {
      gaps.push({
        id: `FVG:B:${current.time}`,
        direction: "BULL",
        low: prior.high,
        high: current.low,
        startedAt: prior.time,
        startIndex: index - 2,
        mitigated: false,
        mitigatedAt: null,
        mitigationIndex: null,
      });
    }

    const bearSize = prior.low - current.high;
    const bearReference = Math.max(Math.abs(current.high), 1e-9);
    if (
      bearSize > 0 &&
      middle.close < prior.low &&
      bearSize / bearReference >= threshold
    ) {
      gaps.push({
        id: `FVG:S:${current.time}`,
        direction: "BEAR",
        low: current.high,
        high: prior.low,
        startedAt: prior.time,
        startIndex: index - 2,
        mitigated: false,
        mitigatedAt: null,
        mitigationIndex: null,
      });
    }
  }

  for (const gap of gaps) {
    for (let index = gap.startIndex + 3; index < candles.length; index += 1) {
      if (fvgMitigated(candles[index], gap, options.mitigationMode)) {
        gap.mitigated = true;
        gap.mitigatedAt = candles[index].time;
        gap.mitigationIndex = index;
        break;
      }
    }
  }
  return gaps;
}

function isLocalVolumePeak(
  candles: readonly StructureCandle[],
  index: number,
  radius: number,
): boolean {
  const volume = candles[index]?.volume;
  if (!finite(volume) || volume <= 0 || index < radius || index + radius >= candles.length) return false;
  for (let j = index - radius; j <= index + radius; j += 1) {
    if (j === index) continue;
    const other = candles[j].volume;
    if (finite(other) && other > volume) return false;
  }
  return true;
}

function reactionZoneMitigated(
  candle: StructureCandle,
  zone: ReactionZone,
  mode: "CLOSE" | "WICK",
): boolean {
  if (zone.direction === "BULL") {
    return mode === "CLOSE" ? candle.close < zone.low : candle.low < zone.low;
  }
  return mode === "CLOSE" ? candle.close > zone.high : candle.high > zone.high;
}

function buildReactionZones(
  candles: readonly StructureCandle[],
  options: Required<ZeroDteStructureOptions>,
): ReactionZone[] {
  const zones: ReactionZone[] = [];
  const radius = options.reactionVolumeRadius;

  for (let index = radius; index + radius < candles.length; index += 1) {
    const candle = candles[index];
    if (!isLocalVolumePeak(candles, index, radius) || !finite(candle.volume)) continue;

    const start = Math.max(0, index - options.reactionVolumeLookback);
    const sample = candles
      .slice(start, index)
      .map((item) => item.volume)
      .filter((value): value is number => finite(value) && value > 0);
    const base = median(sample);
    if (!base || base <= 0) continue;

    const relativeVolume = candle.volume! / base;
    if (relativeVolume < options.reactionMinRelativeVolume) continue;

    // This is deliberately named a reaction zone, not an "order block". A high-volume
    // down candle contributes a potential demand zone; a high-volume up candle contributes
    // a potential supply zone. No claim of institutional-order provenance is made.
    const direction: StructureDirection = candle.close < candle.open ? "BULL" : "BEAR";
    const mid = (candle.high + candle.low) / 2;
    const low = direction === "BULL" ? candle.low : mid;
    const high = direction === "BULL" ? mid : candle.high;
    const strength = clamp(35 + (relativeVolume - 1) * 35, 35, 100);

    zones.push({
      id: `RZ:${direction}:${candle.time}`,
      direction,
      low,
      high,
      mid,
      startedAt: candle.time,
      startIndex: index,
      strength,
      relativeVolume,
      mitigated: false,
      mitigatedAt: null,
      mitigationIndex: null,
    });
  }

  for (const zone of zones) {
    for (let index = zone.startIndex + 1; index < candles.length; index += 1) {
      if (reactionZoneMitigated(candles[index], zone, options.mitigationMode)) {
        zone.mitigated = true;
        zone.mitigatedAt = candles[index].time;
        zone.mitigationIndex = index;
        break;
      }
    }
  }

  return zones;
}

function buildThreeBarReversals(candles: readonly StructureCandle[]): ThreeBarReversal[] {
  const out: ThreeBarReversal[] = [];
  for (let index = 2; index < candles.length; index += 1) {
    const a = candles[index - 2];
    const b = candles[index - 1];
    const c = candles[index];

    const bull =
      a.close < a.open &&
      b.low < a.low &&
      b.high < a.high &&
      b.close < b.open &&
      c.close > c.open &&
      c.high > a.high;

    const bear =
      a.close > a.open &&
      b.high > a.high &&
      b.low > a.low &&
      b.close > b.open &&
      c.close < c.open &&
      c.low < a.low;

    if (bull) {
      const enhanced = c.close > a.high && c.close >= c.high - (c.high - c.low) * 0.25;
      out.push({
        id: `3BR:B:${c.time}`,
        direction: "BULL",
        time: c.time,
        index,
        price: c.low,
        enhanced,
      });
    }
    if (bear) {
      const enhanced = c.close < a.low && c.close <= c.low + (c.high - c.low) * 0.25;
      out.push({
        id: `3BR:S:${c.time}`,
        direction: "BEAR",
        time: c.time,
        index,
        price: c.high,
        enhanced,
      });
    }
  }
  return out;
}

function buildFibLevels(externalSwings: readonly StructureSwing[]): StructureFibLevel[] {
  if (externalSwings.length < 2) return [];
  let end: StructureSwing | null = null;
  let start: StructureSwing | null = null;

  for (let i = externalSwings.length - 1; i >= 0; i -= 1) {
    if (!end) {
      end = externalSwings[i];
      continue;
    }
    if (externalSwings[i].kind !== end.kind) {
      start = externalSwings[i];
      break;
    }
  }
  if (!start || !end || end.time <= start.time) return [];

  const ratios = [0.382, 0.5, 0.618, 0.786];
  if (start.kind === "LOW" && end.kind === "HIGH") {
    const range = end.price - start.price;
    if (range <= 0) return [];
    return ratios.map((ratio) => ({
      ratio,
      price: end!.price - range * ratio,
      direction: "BULL" as const,
      anchorStartTime: start!.time,
      anchorEndTime: end!.time,
    }));
  }

  if (start.kind === "HIGH" && end.kind === "LOW") {
    const range = start.price - end.price;
    if (range <= 0) return [];
    return ratios.map((ratio) => ({
      ratio,
      price: end!.price + range * ratio,
      direction: "BEAR" as const,
      anchorStartTime: start!.time,
      anchorEndTime: end!.time,
    }));
  }

  return [];
}

export function buildZeroDteStructureMap(
  input: readonly StructureCandle[],
  options: ZeroDteStructureOptions = {},
): ZeroDteStructureSnapshot {
  const settings: Required<ZeroDteStructureOptions> = { ...DEFAULTS, ...options };
  const candles = normalizeStructureCandles(input);
  if (candles.length < 3) {
    return {
      generatedAt: candles.at(-1)?.time ?? null,
      trendInternal: null,
      trendExternal: null,
      swings: [],
      breaks: [],
      sweeps: [],
      fvgs: [],
      reactionZones: [],
      reversals: [],
      fibLevels: [],
    };
  }

  const internalSwings = buildSwings(candles, Math.max(1, settings.internalRadius), "INTERNAL");
  const externalSwings = buildSwings(candles, Math.max(2, settings.externalRadius), "EXTERNAL");
  const internal = buildBreaks(candles, internalSwings, "INTERNAL");
  const external = buildBreaks(candles, externalSwings, "EXTERNAL");

  return {
    generatedAt: candles.at(-1)?.time ?? null,
    trendInternal: internal.trend,
    trendExternal: external.trend,
    swings: [...internalSwings, ...externalSwings].sort((a, b) => a.time - b.time),
    breaks: [...internal.breaks, ...external.breaks].sort((a, b) => a.breakTime - b.breakTime),
    sweeps: buildLiquiditySweeps(candles, [...internalSwings, ...externalSwings]),
    fvgs: buildFvgs(candles, settings),
    reactionZones: buildReactionZones(candles, settings),
    reversals: buildThreeBarReversals(candles),
    fibLevels: buildFibLevels(externalSwings),
  };
}

export interface StructureAnchor {
  id: string;
  label: string;
  price: number;
  tone?: "BULL" | "BEAR" | "NEUTRAL";
}

export interface StructureAnchorConfluence {
  anchor: StructureAnchor;
  count: number;
  reasons: string[];
}

export function buildStructureAnchorConfluence(args: {
  snapshot: ZeroDteStructureSnapshot;
  anchors: readonly StructureAnchor[];
  tolerancePoints?: number;
}): StructureAnchorConfluence[] {
  const tolerance = Math.max(0.1, args.tolerancePoints ?? 1.5);
  const latestBreaks = args.snapshot.breaks.slice(-8);
  const latestExternalSwings = args.snapshot.swings
    .filter((item) => item.scale === "EXTERNAL")
    .slice(-8);
  const activeFvgs = args.snapshot.fvgs.filter((item) => !item.mitigated).slice(-8);
  const activeZones = args.snapshot.reactionZones.filter((item) => !item.mitigated).slice(-6);

  return args.anchors
    .filter((anchor) => finite(anchor.price))
    .map((anchor) => {
      const reasons: string[] = [];
      const near = (price: number) => Math.abs(price - anchor.price) <= tolerance;

      if (latestBreaks.some((event) => near(event.level))) reasons.push("structure break");
      if (latestExternalSwings.some((swing) => near(swing.price))) reasons.push("external swing");
      if (activeFvgs.some((fvg) => anchor.price >= fvg.low - tolerance && anchor.price <= fvg.high + tolerance)) {
        reasons.push("active FVG");
      }
      if (activeZones.some((zone) => anchor.price >= zone.low - tolerance && anchor.price <= zone.high + tolerance)) {
        reasons.push("reaction zone");
      }

      return { anchor, count: reasons.length, reasons };
    });
}
