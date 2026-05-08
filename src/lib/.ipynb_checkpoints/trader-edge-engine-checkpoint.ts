import { type CandleRecord, type OptionSurfaceSnapshot } from "./wheeldesk-storage";

export type TraderBias = "bullish" | "bearish" | "neutral";
export type CompressionState = "High compression" | "Moderate compression" | "Open / not compressed";
export type ActionBucket =
  | "Best CSP setup"
  | "Best covered-call setup"
  | "Wheel candidate"
  | "Compression coil"
  | "Conflict / wait"
  | "Premium trap / avoid"
  | "Low-edge / wait";

export type TraderEdgeSummary = {
  ticker: string;
  snapshotDate: string;
  source: string;
  analysisPrice: number;
  livePrice: number | null;

  support: number | null;
  resistance: number | null;
  magnet: number | null;

  rangeWidthPct: number | null;
  supportCushionPct: number | null;
  resistanceCushionPct: number | null;
  compressionState: CompressionState;
  regime: string;

  chartBias: TraderBias;
  optionsBias: TraderBias;

  edgeScore: number;
  wheelScore: number;
  cspScore: number;
  coveredCallScore: number;
  trapRisk: number;

  supportEvidenceScore: number;
  resistanceEvidenceScore: number;
  priceConfluenceScore: number;
  pinSnapRiskScore: number;
  premiumProxyScore: number;

  realizedVolPct: number | null;
  atrPct: number | null;
  volumeThrust: number | null;
  volumeThrustSource: "stock_volume" | "option_flow" | "none";

  cushionPct: number;
  coveredCallCushionTarget: number | null;
  cspCushionTarget: number | null;
  executableCoveredCallFloor: number | null;
  executableCspCeiling: number | null;

  actionBucket: ActionBucket;
  bestAction: string;
  trapNotes: string[];
  triggerNotes: string[];
  freshnessLabel: string;
  staleDays: number | null;

  dataQualityScore: number;
  dataQualityNotes: string[];
};

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function dateKey(value: unknown): string {
  return String(value ?? "").slice(0, 10);
}

function daysBetween(a: string, b: string): number | null {
  const aTime = new Date(`${dateKey(a)}T00:00:00Z`).getTime();
  const bTime = new Date(`${dateKey(b)}T00:00:00Z`).getTime();
  if (!Number.isFinite(aTime) || !Number.isFinite(bTime)) return null;
  return Math.round((bTime - aTime) / 86_400_000);
}

function getRowCallOi(row: any): number {
  return safeNumber(row?.callOi ?? row?.callOpenInterest ?? row?.callsOpenInterest ?? row?.openInterestCall) ?? 0;
}

function getRowPutOi(row: any): number {
  return safeNumber(row?.putOi ?? row?.putOpenInterest ?? row?.putsOpenInterest ?? row?.openInterestPut) ?? 0;
}

function getRowCallVolume(row: any): number {
  return safeNumber(row?.callVolume ?? row?.callVol ?? row?.callsVolume ?? row?.volumeCall) ?? 0;
}

function getRowPutVolume(row: any): number {
  return safeNumber(row?.putVolume ?? row?.putVol ?? row?.putsVolume ?? row?.volumePut) ?? 0;
}

function getNestedStrike(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object") return safeNumber((value as any).strike);
  return null;
}

function getChainDteWeight(chain: any): number {
  const dte = safeNumber(chain?.dteAtCapture ?? chain?.summary?.dte ?? chain?.dte);
  if (dte == null) return 0.9;
  if (dte <= 7) return 1.5;
  if (dte <= 14) return 1.25;
  if (dte <= 45) return 1.1;
  if (dte <= 90) return 0.95;
  return 0.7;
}

function proximityWeight(strike: number, spot: number): number {
  if (!spot || !Number.isFinite(spot)) return 1;
  const distancePct = Math.abs(strike - spot) / spot;
  return 1 / (1 + distancePct * 8);
}

function aggregateStrikeScore(map: Map<number, number>, strike: number, score: number): void {
  map.set(strike, (map.get(strike) ?? 0) + score);
}

function bestStrikeFromScoreMap(map: Map<number, number>): number | null {
  let bestStrike: number | null = null;
  let bestScore = -Infinity;

  for (const [strike, score] of map.entries()) {
    if (score > bestScore) {
      bestScore = score;
      bestStrike = strike;
    }
  }

  return bestStrike;
}

function deriveStructureFromSurface(surface: OptionSurfaceSnapshot | null, spot: number): {
  support: number | null;
  resistance: number | null;
  magnet: number | null;
} {
  if (!surface?.chains?.length) return { support: null, resistance: null, magnet: null };

  const supportScores = new Map<number, number>();
  const resistanceScores = new Map<number, number>();
  let magnetNumerator = 0;
  let magnetDenominator = 0;

  for (const chain of surface.chains) {
    const dteWeight = getChainDteWeight(chain);

    const summary = (chain as any).summary ?? {};
    const summaryPutWall = safeNumber(summary.putWall ?? summary.putWallStrike ?? summary.maxPutStrike);
    const summaryCallWall = safeNumber(summary.callWall ?? summary.callWallStrike ?? summary.maxCallStrike);
    const summaryCenter = safeNumber(summary.combinedCenter ?? summary.center ?? summary.magnet ?? summary.maxPain);

    if (summaryPutWall != null && (!spot || summaryPutWall <= spot * 1.01)) {
      aggregateStrikeScore(supportScores, summaryPutWall, 10 * dteWeight);
    }

    if (summaryCallWall != null && (!spot || summaryCallWall >= spot * 0.99)) {
      aggregateStrikeScore(resistanceScores, summaryCallWall, 10 * dteWeight);
    }

    if (summaryCenter != null && (!spot || (summaryCenter > spot * 0.45 && summaryCenter < spot * 1.8))) {
      magnetNumerator += summaryCenter * 10 * dteWeight;
      magnetDenominator += 10 * dteWeight;
    }

    for (const row of chain.rows ?? []) {
      const strike = Number((row as any).strike);
      if (!Number.isFinite(strike) || strike <= 0) continue;

      const callOi = getRowCallOi(row);
      const putOi = getRowPutOi(row);
      const callVolume = getRowCallVolume(row);
      const putVolume = getRowPutVolume(row);
      const totalOi = callOi + putOi;

      if (totalOi > 0) {
        const magnetWeight = Math.log1p(totalOi) * dteWeight * proximityWeight(strike, spot);
        magnetNumerator += strike * magnetWeight;
        magnetDenominator += magnetWeight;
      }

      if (!spot || strike <= spot * 1.01) {
        const volumeBoost = 1 + Math.min(0.35, putOi > 0 ? putVolume / putOi : 0);
        const score = Math.log1p(putOi) * dteWeight * proximityWeight(strike, spot) * volumeBoost;
        if (score > 0) aggregateStrikeScore(supportScores, strike, score);
      }

      if (!spot || strike >= spot * 0.99) {
        const volumeBoost = 1 + Math.min(0.35, callOi > 0 ? callVolume / callOi : 0);
        const score = Math.log1p(callOi) * dteWeight * proximityWeight(strike, spot) * volumeBoost;
        if (score > 0) aggregateStrikeScore(resistanceScores, strike, score);
      }
    }
  }

  return {
    support: bestStrikeFromScoreMap(supportScores),
    resistance: bestStrikeFromScoreMap(resistanceScores),
    magnet: magnetDenominator > 0 ? magnetNumerator / magnetDenominator : null
  };
}

function isPlausibleLevel(value: number | null, spot: number, side: "support" | "resistance" | "magnet"): boolean {
  if (value == null || !Number.isFinite(value) || value <= 0) return false;
  if (!spot || !Number.isFinite(spot) || spot <= 0) return true;

  if (side === "support") return value >= spot * 0.45 && value <= spot * 1.01;
  if (side === "resistance") return value >= spot * 0.99 && value <= spot * 1.8;
  return value >= spot * 0.45 && value <= spot * 1.8;
}

function getSurfaceRowCount(surface: OptionSurfaceSnapshot | null): number {
  return (surface?.chains ?? []).reduce((sum, chain) => sum + ((chain.rows ?? []).length), 0);
}

function buildDataQuality(args: {
  surface: OptionSurfaceSnapshot | null;
  support: number | null;
  resistance: number | null;
  magnet: number | null;
  strikes: number[];
}): { score: number; notes: string[] } {
  const chainCount = args.surface?.chains?.length ?? 0;
  const rowCount = getSurfaceRowCount(args.surface);
  const notes: string[] = [];
  let score = 100;

  if (chainCount === 0) {
    score -= 45;
    notes.push("No option chains in saved surface.");
  } else if (chainCount < 3) {
    score -= 15;
    notes.push("Limited expiration coverage.");
  }

  if (rowCount < 25) {
    score -= 25;
    notes.push("Low row count; surface may be incomplete.");
  }

  if (args.strikes.length < 8) {
    score -= 15;
    notes.push("Few available strikes for executable snapping.");
  }

  if (args.support == null) {
    score -= 15;
    notes.push("Support level unavailable after fallback derivation.");
  }

  if (args.resistance == null) {
    score -= 15;
    notes.push("Resistance level unavailable after fallback derivation.");
  }

  if (args.magnet == null) {
    score -= 8;
    notes.push("OI magnet unavailable or implausible.");
  }

  if (!notes.length) notes.push("Surface has enough chains, rows, levels, and strike data for scanner ranking.");
  return { score: clampScore(score), notes };
}

export function getSnapshotSpot(surface: OptionSurfaceSnapshot | null, fallback = 0): number {
  const daily = surface?.dailyStructure as any;
  const price = surface?.price as any;

  const candidates = [
    price?.close,
    price?.spot,
    daily?.spot,
    daily?.currentPrice,
    daily?.underlyingPrice,
    daily?.prevailingLevels?.spot
  ];

  const found = candidates.find((value) => typeof value === "number" && Number.isFinite(value) && value > 0);
  return found ?? fallback;
}

export function getSurfaceStructure(surface: OptionSurfaceSnapshot | null): {
  support: number | null;
  resistance: number | null;
  magnet: number | null;
} {
  const daily = surface?.dailyStructure as any;
  const spot = getSnapshotSpot(surface, 0);
  const derived = deriveStructureFromSurface(surface, spot);

  const dailySupport =
    safeNumber(daily?.support) ??
    getNestedStrike(daily?.support) ??
    safeNumber(daily?.primarySupport) ??
    safeNumber(daily?.supportStrike) ??
    safeNumber(daily?.surfaceSupport) ??
    safeNumber(daily?.putWall) ??
    getNestedStrike(daily?.prevailingLevels?.support) ??
    safeNumber(daily?.prevailingLevels?.support);

  const dailyResistance =
    safeNumber(daily?.resistance) ??
    getNestedStrike(daily?.resistance) ??
    safeNumber(daily?.primaryResistance) ??
    safeNumber(daily?.resistanceStrike) ??
    safeNumber(daily?.surfaceResistance) ??
    safeNumber(daily?.callWall) ??
    getNestedStrike(daily?.prevailingLevels?.resistance) ??
    safeNumber(daily?.prevailingLevels?.resistance);

  const dailyMagnet =
    safeNumber(daily?.magnet) ??
    getNestedStrike(daily?.magnet) ??
    safeNumber(daily?.oiMagnet) ??
    safeNumber(daily?.magnetStrike) ??
    safeNumber(daily?.surfaceMagnet) ??
    safeNumber(daily?.combinedCenter) ??
    safeNumber(daily?.maxPain) ??
    getNestedStrike(daily?.prevailingLevels?.magnet) ??
    safeNumber(daily?.prevailingLevels?.magnet);

  return {
    support: isPlausibleLevel(dailySupport, spot, "support") ? dailySupport : derived.support,
    resistance: isPlausibleLevel(dailyResistance, spot, "resistance") ? dailyResistance : derived.resistance,
    magnet: isPlausibleLevel(dailyMagnet, spot, "magnet") ? dailyMagnet : derived.magnet
  };
}

export function getAvailableSurfaceStrikes(surface: OptionSurfaceSnapshot | null): number[] {
  if (!surface?.chains?.length) return [];

  const strikes = new Set<number>();

  for (const chain of surface.chains) {
    for (const row of chain.rows ?? []) {
      const strike = Number((row as any).strike);
      if (Number.isFinite(strike) && strike > 0) strikes.add(strike);
    }
  }

  return Array.from(strikes).sort((a, b) => a - b);
}

export function snapCallStrikeFloor(target: number | null, strikes: number[]): number | null {
  if (target == null || !Number.isFinite(target)) return null;
  return strikes.find((strike) => strike >= target) ?? null;
}

export function snapPutStrikeCeiling(target: number | null, strikes: number[]): number | null {
  if (target == null || !Number.isFinite(target)) return null;

  for (let index = strikes.length - 1; index >= 0; index -= 1) {
    if (strikes[index] <= target) return strikes[index];
  }

  return null;
}

function getChartBias(candles: CandleRecord[]): TraderBias {
  const closes = candles.map((c) => c.close).filter((value) => Number.isFinite(value));
  if (closes.length < 50) return "neutral";

  const last = closes.at(-1) ?? 0;
  const sma20 = closes.slice(-20).reduce((sum, value) => sum + value, 0) / 20;
  const sma50 = closes.slice(-50).reduce((sum, value) => sum + value, 0) / 50;

  if (last > sma20 && sma20 >= sma50) return "bullish";
  if (last < sma20 && sma20 <= sma50) return "bearish";
  return "neutral";
}

function getOptionsBias(args: { spot: number; support: number | null; resistance: number | null; magnet: number | null }): TraderBias {
  if (!args.spot) return "neutral";

  const magnetDeltaPct = args.magnet ? ((args.magnet - args.spot) / args.spot) * 100 : 0;
  const supportCushionPct = args.support ? ((args.spot - args.support) / args.spot) * 100 : null;
  const resistanceCushionPct = args.resistance ? ((args.resistance - args.spot) / args.spot) * 100 : null;

  if (magnetDeltaPct >= 2) return "bullish";
  if (magnetDeltaPct <= -2) return "bearish";

  if (supportCushionPct != null && resistanceCushionPct != null) {
    if (supportCushionPct > resistanceCushionPct * 1.5) return "bearish";
    if (resistanceCushionPct > supportCushionPct * 1.5) return "bullish";
  }

  return "neutral";
}

function getRealizedVolatilityPct(candles: CandleRecord[], lookback = 20): number | null {
  const closes = candles.map((c) => c.close).filter((value) => Number.isFinite(value) && value > 0);
  if (closes.length < lookback + 1) return null;

  const returns: number[] = [];
  const slice = closes.slice(-(lookback + 1));

  for (let index = 1; index < slice.length; index += 1) {
    returns.push(Math.log(slice[index] / slice[index - 1]));
  }

  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / Math.max(1, returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function getAtrPct(candles: CandleRecord[], lookback = 14): number | null {
  if (candles.length < lookback + 1) return null;

  const slice = candles.slice(-(lookback + 1));
  const trueRanges: number[] = [];

  for (let index = 1; index < slice.length; index += 1) {
    const candle = slice[index];
    const previous = slice[index - 1];
    const high = candle.high;
    const low = candle.low;
    const prevClose = previous.close;

    if (![high, low, prevClose].every(Number.isFinite)) continue;

    trueRanges.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }

  const lastClose = candles.at(-1)?.close;
  if (!trueRanges.length || !lastClose) return null;

  const atr = trueRanges.slice(-lookback).reduce((sum, value) => sum + value, 0) / Math.min(lookback, trueRanges.length);
  return (atr / lastClose) * 100;
}

function getVolumeThrust(candles: CandleRecord[], lookback = 20): number | null {
  const volumes = candles.map((c) => c.volume).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (volumes.length < lookback + 1) return null;

  const latest = volumes.at(-1) ?? 0;
  const average = volumes.slice(-(lookback + 1), -1).reduce((sum, value) => sum + value, 0) / lookback;
  if (!average) return null;
  return latest / average;
}


function getOptionFlowThrust(stats: { totalCallOi: number; totalPutOi: number; totalCallVolume: number; totalPutVolume: number }): number | null {
  const totalOi = stats.totalCallOi + stats.totalPutOi;
  const totalVolume = stats.totalCallVolume + stats.totalPutVolume;

  if (totalOi <= 0 || totalVolume <= 0) return null;

  // Options volume and open interest are not the same as stock volume.
  // This normalizes option participation into a thrust-like factor where
  // ~8% same-day option volume versus total OI is treated as roughly 1.0x.
  const participation = totalVolume / totalOi;
  return Math.max(0.1, Math.min(4, participation / 0.08));
}

function getSurfaceOiStats(surface: OptionSurfaceSnapshot | null, support: number | null, resistance: number | null) {
  let totalCallOi = 0;
  let totalPutOi = 0;
  let totalCallVolume = 0;
  let totalPutVolume = 0;
  let supportOi = 0;
  let resistanceOi = 0;
  let supportVolume = 0;
  let resistanceVolume = 0;

  for (const chain of surface?.chains ?? []) {
    for (const row of chain.rows ?? []) {
      const strike = Number((row as any).strike);
      const callOi = getRowCallOi(row);
      const putOi = getRowPutOi(row);
      const callVolume = getRowCallVolume(row);
      const putVolume = getRowPutVolume(row);

      totalCallOi += callOi;
      totalPutOi += putOi;
      totalCallVolume += callVolume;
      totalPutVolume += putVolume;

      if (support != null && Number.isFinite(strike) && Math.abs(strike - support) < 1e-9) {
        supportOi += putOi;
        supportVolume += putVolume;
      }

      if (resistance != null && Number.isFinite(strike) && Math.abs(strike - resistance) < 1e-9) {
        resistanceOi += callOi;
        resistanceVolume += callVolume;
      }
    }
  }

  return { totalCallOi, totalPutOi, totalCallVolume, totalPutVolume, supportOi, resistanceOi, supportVolume, resistanceVolume };
}

function levelEvidenceScore(args: { oi: number; volume: number; totalOi: number; cushionPct: number | null; side: "support" | "resistance" }): number {
  const oiShare = args.totalOi > 0 ? (args.oi / args.totalOi) * 100 : 0;
  const volToOi = args.oi > 0 ? args.volume / args.oi : 0;
  const distance = args.cushionPct ?? 99;

  let score = 35;
  score += Math.min(28, oiShare * 5);
  score += Math.min(18, volToOi * 30);
  score += distance >= 2 && distance <= 8 ? 12 : distance < 2 ? -8 : 4;

  return clampScore(score);
}

function computePriceConfluenceScore(args: { candles: CandleRecord[]; support: number | null; resistance: number | null; spot: number }): number {
  const recent = args.candles.slice(-60);
  if (!recent.length || !args.spot) return 50;

  let score = 45;
  const tolerancePct = 1.2;

const support = args.support;

if (typeof support === "number" && Number.isFinite(support) && support !== 0) {
  const touches = recent.filter(
    (c) => Math.abs((c.low - support) / support) * 100 <= tolerancePct
  ).length;

  score += Math.min(1, touches * 4);
}

const resistance = args.resistance;

if (typeof resistance === "number" && Number.isFinite(resistance) && resistance !== 0) {
  const touches = recent.filter(
    (c) => Math.abs((c.high - resistance) / resistance) * 100 <= tolerancePct
  ).length;

  score += Math.min(1, touches * 4);
}
  return clampScore(score);
}

function computeFreshness(snapshotDate: string): { label: string; staleDays: number | null; penalty: number } {
  const staleDays = daysBetween(snapshotDate, new Date().toISOString());
  if (staleDays == null) return { label: "Unknown freshness", staleDays: null, penalty: 8 };
  if (staleDays <= 1) return { label: "Fresh", staleDays, penalty: 0 };
  if (staleDays <= 3) return { label: `${staleDays}d old`, staleDays, penalty: 5 };
  if (staleDays <= 7) return { label: `${staleDays}d old / aging`, staleDays, penalty: 12 };
  return { label: `${staleDays}d old / stale`, staleDays, penalty: 22 };
}

export function buildTraderEdgeSummary(args: {
  ticker: string;
  surface: OptionSurfaceSnapshot;
  candles?: CandleRecord[];
  livePrice?: number | null;
}): TraderEdgeSummary {
  const ticker = String(args.ticker || args.surface.ticker || "").toUpperCase();
  const candles = args.candles ?? [];
  const livePrice = args.livePrice ?? candles.at(-1)?.close ?? null;
  const analysisPrice = getSnapshotSpot(args.surface, livePrice ?? 0);
  const structure = getSurfaceStructure(args.surface);
  const support = structure.support;
  const resistance = structure.resistance;
  const magnet = structure.magnet;

  const rangeWidthPct = support && resistance && analysisPrice ? ((resistance - support) / analysisPrice) * 100 : null;
  const supportCushionPct = support && analysisPrice ? ((analysisPrice - support) / analysisPrice) * 100 : null;
  const resistanceCushionPct = resistance && analysisPrice ? ((resistance - analysisPrice) / analysisPrice) * 100 : null;

  let compressionState: CompressionState = "Open / not compressed";
  if ((rangeWidthPct != null && rangeWidthPct <= 4) || (supportCushionPct != null && supportCushionPct <= 1.5) || (resistanceCushionPct != null && resistanceCushionPct <= 1.5)) {
    compressionState = "High compression";
  } else if ((rangeWidthPct != null && rangeWidthPct <= 8) || (supportCushionPct != null && supportCushionPct <= 3) || (resistanceCushionPct != null && resistanceCushionPct <= 3)) {
    compressionState = "Moderate compression";
  }

  const chartBias = getChartBias(candles);
  const optionsBias = getOptionsBias({ spot: analysisPrice, support, resistance, magnet });
  const conflict = chartBias !== "neutral" && optionsBias !== "neutral" && chartBias !== optionsBias;
  const regime = conflict ? "Conflict regime" : compressionState === "Open / not compressed" ? "Open / not compressed" : "Compression regime";

  const availableStrikes = getAvailableSurfaceStrikes(args.surface);
  const dataQuality = buildDataQuality({ surface: args.surface, support, resistance, magnet, strikes: availableStrikes });
  const realizedVolPct = getRealizedVolatilityPct(candles);
  const atrPct = getAtrPct(candles);
  const candleVolumeThrust = getVolumeThrust(candles);

  const cushionPct = compressionState === "High compression" ? 5 : compressionState === "Moderate compression" ? 3.5 : 2.5;
  const coveredCallCushionTarget = resistance ? Math.max(resistance, analysisPrice * (1 + cushionPct / 100)) : null;
  const cspCushionTarget = support ? Math.min(support, analysisPrice * (1 - cushionPct / 100)) : null;
  const executableCoveredCallFloor = snapCallStrikeFloor(coveredCallCushionTarget, availableStrikes);
  const executableCspCeiling = snapPutStrikeCeiling(cspCushionTarget, availableStrikes);

  const stats = getSurfaceOiStats(args.surface, support, resistance);
  const optionFlowThrust = getOptionFlowThrust(stats);
  const volumeThrust = candleVolumeThrust ?? optionFlowThrust;
  const volumeThrustSource: TraderEdgeSummary["volumeThrustSource"] = candleVolumeThrust != null ? "stock_volume" : optionFlowThrust != null ? "option_flow" : "none";

  const supportEvidenceScore = levelEvidenceScore({
    oi: stats.supportOi,
    volume: stats.supportVolume,
    totalOi: stats.totalPutOi,
    cushionPct: supportCushionPct,
    side: "support"
  });
  const resistanceEvidenceScore = levelEvidenceScore({
    oi: stats.resistanceOi,
    volume: stats.resistanceVolume,
    totalOi: stats.totalCallOi,
    cushionPct: resistanceCushionPct,
    side: "resistance"
  });
  const priceConfluence = computePriceConfluenceScore({ candles, support, resistance, spot: analysisPrice });

  const pinSnapRiskScore = clampScore(
    35 +
      (compressionState === "High compression" ? 35 : compressionState === "Moderate compression" ? 22 : 0) +
      (magnet && analysisPrice ? Math.max(0, 18 - Math.abs(((magnet - analysisPrice) / analysisPrice) * 100) * 5) : 0) +
      (volumeThrust != null && volumeThrust > 1.5 ? 10 : 0)
  );

  const premiumProxyScore = clampScore(
    50 +
      Math.min(22, (realizedVolPct ?? 35) / 4) +
      Math.min(16, (atrPct ?? 2) * 3) +
      (compressionState !== "Open / not compressed" ? 6 : 0) -
      (pinSnapRiskScore > 75 ? 12 : 0)
  );

  const freshness = computeFreshness(args.surface.snapshotDate);

  const edgeScore = clampScore(
    0.22 * supportEvidenceScore +
      0.22 * resistanceEvidenceScore +
      0.16 * priceConfluence +
      0.16 * premiumProxyScore +
      0.12 * (100 - pinSnapRiskScore) +
      0.12 * (volumeThrust == null ? 50 : clampScore(45 + volumeThrust * 18)) -
      freshness.penalty -
      (conflict ? 7 : 0) -
      Math.max(0, 60 - dataQuality.score) * 0.35
  );

  const cspScore = clampScore(
    0.36 * supportEvidenceScore +
      0.22 * premiumProxyScore +
      0.14 * priceConfluence +
      0.16 * (100 - pinSnapRiskScore) +
      (optionsBias === "bullish" ? 8 : optionsBias === "bearish" ? -8 : 0) -
      freshness.penalty -
      Math.max(0, 60 - dataQuality.score) * 0.25
  );

  const coveredCallScore = clampScore(
    0.36 * resistanceEvidenceScore +
      0.22 * premiumProxyScore +
      0.14 * priceConfluence +
      0.16 * (100 - pinSnapRiskScore) +
      (optionsBias === "bearish" ? 8 : optionsBias === "bullish" ? -10 : 0) -
      freshness.penalty -
      Math.max(0, 60 - dataQuality.score) * 0.25
  );

  const wheelScore = clampScore((cspScore + coveredCallScore + edgeScore) / 3);
  const trapRisk = clampScore(
    25 +
      (conflict ? 22 : 0) +
      (compressionState === "High compression" ? 25 : compressionState === "Moderate compression" ? 16 : 0) +
      (pinSnapRiskScore > 70 ? 18 : pinSnapRiskScore > 55 ? 10 : 0) +
      (freshness.staleDays != null && freshness.staleDays > 3 ? 10 : 0) -
      (edgeScore > 75 ? 12 : 0)
  );

  let actionBucket: ActionBucket = "Low-edge / wait";
  if (trapRisk >= 75) actionBucket = "Premium trap / avoid";
  else if (conflict) actionBucket = "Conflict / wait";
  else if (compressionState !== "Open / not compressed" && pinSnapRiskScore >= 65) actionBucket = "Compression coil";
  else if (cspScore >= 70 && cspScore >= coveredCallScore + 8) actionBucket = "Best CSP setup";
  else if (coveredCallScore >= 70 && coveredCallScore >= cspScore + 8) actionBucket = "Best covered-call setup";
  else if (wheelScore >= 65) actionBucket = "Wheel candidate";

  const trapNotes: string[] = [];
  if ((magnet && magnet > analysisPrice && (resistanceCushionPct ?? 999) <= 4) || optionsBias === "bullish") {
    trapNotes.push("Covered-call trap: upside magnet or tight resistance can make near calls dangerous.");
  }
  if ((chartBias === "bearish" && (supportCushionPct ?? 999) <= 4) || (support != null && analysisPrice < support)) {
    trapNotes.push("CSP trap: support is close or failing; attractive premium may be assignment bait.");
  }
  if (compressionState !== "Open / not compressed") {
    trapNotes.push("Compression trap: OI walls are reference levels, not automatic sell strikes.");
  }
  if (premiumProxyScore < 55) trapNotes.push("Premium trap: risk may not be paying enough for the setup.");
  if (!trapNotes.length) trapNotes.push("No dominant trap, but liquidity and real premium still need confirmation.");

  const bufferPct = Math.max(0.25, Math.min(1.25, (atrPct ?? 2.5) * 0.25));
  const triggerBuffer = analysisPrice * (bufferPct / 100);
  const triggerNotes = [
    resistance ? `Bullish unlock above ${(resistance + triggerBuffer).toFixed(2)}.` : "Bullish unlock unavailable without resistance.",
    support ? `Bearish failure below ${(support - triggerBuffer).toFixed(2)}.` : "Bearish failure unavailable without support.",
    support && resistance ? `Pin/chop zone is ${support.toFixed(2)} - ${resistance.toFixed(2)}.` : "Pin/chop zone unavailable.",
    magnet ? `OI magnet sits at ${magnet.toFixed(2)}.` : "OI magnet unavailable."
  ];

  let bestAction = "Wait for better stacked edge or move strikes farther from spot.";
  if (actionBucket === "Best CSP setup") bestAction = `Favor CSPs at/below ${executableCspCeiling?.toFixed(2) ?? "the snapped put ceiling"}; require premium and assignment comfort.`;
  if (actionBucket === "Best covered-call setup") bestAction = `Covered calls are cleaner at/above ${executableCoveredCallFloor?.toFixed(2) ?? "the snapped call floor"}; avoid selling below resistance.`;
  if (actionBucket === "Wheel candidate") bestAction = "Balanced wheel setup; sell only at snapped zones and size around event/freshness risk.";
  if (actionBucket === "Compression coil") bestAction = "Treat as pin/chop until a wall breaks. Sell only outside the active OI range.";
  if (actionBucket === "Conflict / wait") bestAction = "Chart and options disagree. Wait for support/resistance break before leaning directional.";
  if (actionBucket === "Premium trap / avoid") bestAction = "Avoid the obvious strike. Trap risk dominates; wait or demand much better premium.";

  return {
    ticker,
    snapshotDate: args.surface.snapshotDate,
    source: `wheeldesk_storage_v2 saved surface ${args.surface.snapshotDate}`,
    analysisPrice,
    livePrice,
    support,
    resistance,
    magnet,
    rangeWidthPct,
    supportCushionPct,
    resistanceCushionPct,
    compressionState,
    regime,
    chartBias,
    optionsBias,
    edgeScore,
    wheelScore,
    cspScore,
    coveredCallScore,
    trapRisk,
    supportEvidenceScore,
    resistanceEvidenceScore,
    priceConfluenceScore: priceConfluence,
    pinSnapRiskScore,
    premiumProxyScore,
    realizedVolPct,
    atrPct,
    volumeThrust,
    volumeThrustSource,
    cushionPct,
    coveredCallCushionTarget,
    cspCushionTarget,
    executableCoveredCallFloor,
    executableCspCeiling,
    actionBucket,
    bestAction,
    trapNotes,
    triggerNotes,
    freshnessLabel: freshness.label,
    staleDays: freshness.staleDays,
    dataQualityScore: dataQuality.score,
    dataQualityNotes: dataQuality.notes
  };
}


export function latestSurfaceByTicker(surfaces: OptionSurfaceSnapshot[]): OptionSurfaceSnapshot[] {
  const map = new Map<string, OptionSurfaceSnapshot>();

  for (const surface of surfaces) {
    const ticker = String(surface.ticker ?? "").toUpperCase();
    if (!ticker) continue;
    const existing = map.get(ticker);
    if (!existing || dateKey(surface.snapshotDate).localeCompare(dateKey(existing.snapshotDate)) > 0) {
      map.set(ticker, surface);
    }
  }

  return Array.from(map.values()).sort((a, b) => String(a.ticker).localeCompare(String(b.ticker)));
}
