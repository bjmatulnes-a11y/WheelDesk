import { type CandleRecord, type OptionSurfaceSnapshot } from "./wheeldesk-storage";
import { type TraderEdgeSummary } from "./trader-edge-engine";
import { type WallMigrationSummary } from "./oi-wall-migration-engine";

export type DealerPressureRegime =
  | "Volatility suppression / pinning"
  | "Pin-to-snap"
  | "Volatility expansion / amplification"
  | "Neutral / mixed"
  | "Stale / low confidence";

export type HedgeFlowBias = "bullish" | "bearish" | "neutral" | "conflict" | "unknown";

export type PremiumSellerSafety =
  | "Safe only outside active range"
  | "Conditional"
  | "Danger near rails"
  | "Avoid / refresh data";

export type DealerPressureSummary = {
  ticker: string;
  snapshotDate: string;
  spot: number | null;

  regime: DealerPressureRegime;
  hedgeFlowBias: HedgeFlowBias;
  premiumSellerSafety: PremiumSellerSafety;

  pinRiskScore: number;
  snapRiskScore: number;
  gammaConcentrationScore: number;
  nearSpotBalanceScore: number;
  railProximityScore: number;
  wallMigrationScore: number;
  confidenceScore: number;

  callPressure: number;
  putPressure: number;
  totalPressure: number;
  callPressureSharePct: number | null;
  putPressureSharePct: number | null;

  dominantPressureStrike: number | null;
  nearestCallPressureStrike: number | null;
  nearestPutPressureStrike: number | null;

  support: number | null;
  resistance: number | null;
  magnet: number | null;
  activeRangeWidthPct: number | null;

  interpretation: string;
  tradeTranslation: string[];
  scalpLiteNotes: string[];
  riskNotes: string[];
  dataQualityNotes: string[];
};

type PressureStrike = {
  strike: number;
  callPressure: number;
  putPressure: number;
  totalPressure: number;
};

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampScore(value: number): number {
  return clamp(value, 0, 100);
}

function dateKey(value: unknown): string {
  return String(value ?? "").slice(0, 10);
}

function getSnapshotSpot(surface: OptionSurfaceSnapshot | null, fallback?: number | null): number | null {
  if (!surface) return fallback ?? null;
  const raw = (surface as any).dailyStructure ?? (surface as any).structure ?? {};
  return (
    safeNumber((surface as any).price?.close) ??
    safeNumber((surface as any).price?.spot) ??
    safeNumber(raw.spot) ??
    safeNumber(raw.currentPrice) ??
    safeNumber(raw.underlyingPrice) ??
    fallback ??
    null
  );
}

function getLevel(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object") {
    return safeNumber((value as any).strike ?? (value as any).value ?? (value as any).level);
  }
  return null;
}

function getSurfaceStructure(surface: OptionSurfaceSnapshot | null, edge?: TraderEdgeSummary | null): {
  support: number | null;
  resistance: number | null;
  magnet: number | null;
} {
  const raw = (surface as any)?.dailyStructure ?? (surface as any)?.structure ?? {};
  const levels = raw?.prevailingLevels ?? raw?.levels ?? {};

  return {
    support:
      edge?.support ??
      getLevel(raw.support) ??
      getLevel(raw.primarySupport) ??
      getLevel(raw.supportStrike) ??
      getLevel(levels.support),
    resistance:
      edge?.resistance ??
      getLevel(raw.resistance) ??
      getLevel(raw.primaryResistance) ??
      getLevel(raw.resistanceStrike) ??
      getLevel(levels.resistance),
    magnet:
      edge?.magnet ??
      getLevel(raw.magnet) ??
      getLevel(raw.oiMagnet) ??
      getLevel(raw.maxPain) ??
      getLevel(levels.magnet)
  };
}

function getCallOi(row: any): number {
  return safeNumber(row?.callOi ?? row?.callOpenInterest ?? row?.callsOpenInterest ?? row?.openInterestCall) ?? 0;
}

function getPutOi(row: any): number {
  return safeNumber(row?.putOi ?? row?.putOpenInterest ?? row?.putsOpenInterest ?? row?.openInterestPut) ?? 0;
}

function getCallVolume(row: any): number {
  return safeNumber(row?.callVolume ?? row?.callVol ?? row?.callsVolume ?? row?.volumeCall) ?? 0;
}

function getPutVolume(row: any): number {
  return safeNumber(row?.putVolume ?? row?.putVol ?? row?.putsVolume ?? row?.volumePut) ?? 0;
}

function getChainDte(chain: any): number | null {
  return safeNumber(chain?.dteAtCapture ?? chain?.summary?.dte ?? chain?.dte);
}

function expiryWeight(chain: any): number {
  const dte = getChainDte(chain);
  if (dte == null) return 0.8;
  if (dte <= 2) return 1.8;
  if (dte <= 7) return 1.55;
  if (dte <= 14) return 1.35;
  if (dte <= 30) return 1.15;
  if (dte <= 60) return 0.95;
  if (dte <= 120) return 0.75;
  return 0.55;
}

function gammaProxyWeight(strike: number, spot: number): number {
  if (!spot || !Number.isFinite(spot) || spot <= 0) return 1;
  const distancePct = Math.abs(strike - spot) / spot;
  const floor = 0.006;
  const raw = 1 / Math.pow(Math.max(distancePct, floor), 1.18);
  return clamp(raw / 55, 0.15, 4.5);
}

function addPressure(map: Map<number, PressureStrike>, strike: number, callPressure: number, putPressure: number): void {
  const current = map.get(strike) ?? { strike, callPressure: 0, putPressure: 0, totalPressure: 0 };
  current.callPressure += callPressure;
  current.putPressure += putPressure;
  current.totalPressure = current.callPressure + current.putPressure;
  map.set(strike, current);
}

function buildPressureMap(surface: OptionSurfaceSnapshot | null, spot: number | null): PressureStrike[] {
  if (!surface?.chains?.length || !spot) return [];

  const map = new Map<number, PressureStrike>();

  for (const chain of surface.chains as any[]) {
    const eWeight = expiryWeight(chain);

    for (const row of chain.rows ?? []) {
      const strike = Number(row?.strike);
      if (!Number.isFinite(strike) || strike <= 0) continue;

      const callOi = getCallOi(row);
      const putOi = getPutOi(row);
      const callVolume = getCallVolume(row);
      const putVolume = getPutVolume(row);
      const gWeight = gammaProxyWeight(strike, spot);
      const flowBoostCall = 1 + Math.min(0.5, callOi > 0 ? callVolume / Math.max(callOi, 1) : callVolume > 0 ? 0.25 : 0);
      const flowBoostPut = 1 + Math.min(0.5, putOi > 0 ? putVolume / Math.max(putOi, 1) : putVolume > 0 ? 0.25 : 0);

      addPressure(map, strike, callOi * eWeight * gWeight * flowBoostCall, putOi * eWeight * gWeight * flowBoostPut);
    }
  }

  return Array.from(map.values()).sort((a, b) => b.totalPressure - a.totalPressure);
}

function scoreGammaConcentration(strikes: PressureStrike[], spot: number | null): number {
  if (!strikes.length || !spot) return 0;
  const total = strikes.reduce((sum, item) => sum + item.totalPressure, 0);
  if (total <= 0) return 0;

  const near = strikes
    .filter((item) => Math.abs(item.strike - spot) / spot <= 0.04)
    .reduce((sum, item) => sum + item.totalPressure, 0);

  return clampScore((near / total) * 130);
}

function scoreBalance(strikes: PressureStrike[], spot: number | null): number {
  if (!strikes.length || !spot) return 0;
  const near = strikes.filter((item) => Math.abs(item.strike - spot) / spot <= 0.06);
  const callPressure = near.reduce((sum, item) => sum + item.callPressure, 0);
  const putPressure = near.reduce((sum, item) => sum + item.putPressure, 0);
  const total = callPressure + putPressure;
  if (total <= 0) return 0;

  const imbalance = Math.abs(callPressure - putPressure) / total;
  return clampScore((1 - imbalance) * 100);
}

function scoreRailProximity(edge: TraderEdgeSummary | null | undefined, spot: number | null, support: number | null, resistance: number | null): number {
  if (!spot || spot <= 0) return 0;
  const supportDistance = support != null ? Math.abs(spot - support) / spot : null;
  const resistanceDistance = resistance != null ? Math.abs(resistance - spot) / spot : null;
  const nearestDistance = Math.min(supportDistance ?? Infinity, resistanceDistance ?? Infinity);
  if (!Number.isFinite(nearestDistance)) return 0;

  const proximityScore = clampScore(100 - nearestDistance * 1000);
  const compressionBoost = edge?.compressionState === "High compression" ? 16 : edge?.compressionState === "Moderate compression" ? 9 : 0;
  return clampScore(proximityScore + compressionBoost);
}

function scoreWallMigration(migration?: WallMigrationSummary | null): number {
  if (!migration) return 35;
  if (!migration.hasPrior) return 35;
  return clampScore(migration.migrationScore ?? 50);
}

function inferHedgeFlowBias(args: {
  edge?: TraderEdgeSummary | null;
  migration?: WallMigrationSummary | null;
  callShare: number | null;
  putShare: number | null;
}): HedgeFlowBias {
  const migration = args.migration;
  if (migration?.migrationBias === "bullish") return "bullish";
  if (migration?.migrationBias === "bearish") return "bearish";
  if (migration?.migrationBias === "compression") return "neutral";
  if (migration?.migrationBias === "expansion") return "conflict";

  if (args.edge?.optionsBias === "bullish" && args.edge?.chartBias !== "bearish") return "bullish";
  if (args.edge?.optionsBias === "bearish" && args.edge?.chartBias !== "bullish") return "bearish";
  if (args.edge?.optionsBias && args.edge.chartBias && args.edge.optionsBias !== args.edge.chartBias && args.edge.chartBias !== "neutral") {
    return "conflict";
  }

  if (args.callShare != null && args.putShare != null) {
    if (args.callShare - args.putShare > 18) return "bearish";
    if (args.putShare - args.callShare > 18) return "bullish";
  }

  return "neutral";
}

function summarizeRegime(args: {
  pinRiskScore: number;
  snapRiskScore: number;
  confidenceScore: number;
  edge?: TraderEdgeSummary | null;
}): DealerPressureRegime {
  if (args.confidenceScore < 35 || (args.edge?.dataQualityScore ?? 100) < 45) return "Stale / low confidence";
  if (args.pinRiskScore >= 66 && args.snapRiskScore >= 62) return "Pin-to-snap";
  if (args.snapRiskScore >= 68) return "Volatility expansion / amplification";
  if (args.pinRiskScore >= 62 && args.snapRiskScore < 58) return "Volatility suppression / pinning";
  return "Neutral / mixed";
}

function premiumSafetyFromRegime(regime: DealerPressureRegime): PremiumSellerSafety {
  if (regime === "Stale / low confidence") return "Avoid / refresh data";
  if (regime === "Volatility suppression / pinning") return "Safe only outside active range";
  if (regime === "Pin-to-snap") return "Danger near rails";
  if (regime === "Volatility expansion / amplification") return "Danger near rails";
  return "Conditional";
}

function inferConfidence(edge?: TraderEdgeSummary | null, migration?: WallMigrationSummary | null, pressureRows?: PressureStrike[]): number {
  let score = 55;
  if ((pressureRows?.length ?? 0) > 20) score += 12;
  if ((pressureRows?.length ?? 0) > 80) score += 8;
  if (edge?.dataQualityScore != null) score = score * 0.45 + edge.dataQualityScore * 0.55;
  if (edge?.staleDays != null && edge.staleDays > 1) score -= Math.min(25, edge.staleDays * 7);
  if (migration && !migration.hasPrior) score -= 8;
  return clampScore(score);
}

function describeRegime(args: {
  regime: DealerPressureRegime;
  hedgeFlowBias: HedgeFlowBias;
  support: number | null;
  resistance: number | null;
  magnet: number | null;
}): string {
  const range = args.support != null && args.resistance != null ? `${args.support}–${args.resistance}` : "the active OI range";
  if (args.regime === "Volatility suppression / pinning") {
    return `Options pressure is pinning/mean-reversion-like. Expect chop or magnet behavior while price remains inside ${range}.`;
  }
  if (args.regime === "Pin-to-snap") {
    return `The surface is compressed enough to pin, but snap risk is elevated near the rails. Treat ${range} as active until one side breaks.`;
  }
  if (args.regime === "Volatility expansion / amplification") {
    return `Dealer-pressure proxy favors amplification over pinning. If a rail breaks, price may move faster than the static wall map implies.`;
  }
  if (args.regime === "Stale / low confidence") {
    return "Dealer-pressure read is low confidence. Refresh the OI surface/candles before treating this as a trade input.";
  }
  return `Dealer-pressure read is mixed. Use support, resistance, and the magnet as reference rails, but require price confirmation.`;
}

function buildTradeTranslation(args: {
  regime: DealerPressureRegime;
  hedgeFlowBias: HedgeFlowBias;
  support: number | null;
  resistance: number | null;
  edge?: TraderEdgeSummary | null;
}): string[] {
  const ccFloor = args.edge?.executableCoveredCallFloor ?? args.resistance;
  const cspCeiling = args.edge?.executableCspCeiling ?? args.support;
  const notes: string[] = [];

  if (args.regime === "Volatility suppression / pinning") {
    notes.push("Premium selling is most defensible outside the active range, not at the magnet.");
    if (ccFloor != null) notes.push(`Covered calls: prefer at/above ${ccFloor}; avoid selling below the call wall if upside magnet risk remains.`);
    if (cspCeiling != null) notes.push(`CSPs: prefer at/below ${cspCeiling}; avoid selling puts above support unless assignment is desired.`);
  } else if (args.regime === "Pin-to-snap") {
    notes.push("Do not sell tight premium near the rails. The setup can pin first, then release quickly.");
    if (ccFloor != null) notes.push(`Covered calls: keep strikes at/above ${ccFloor}; stop adding calls if bullish unlock triggers.`);
    if (cspCeiling != null) notes.push(`CSPs: keep strikes at/below ${cspCeiling}; pause if bearish failure triggers.`);
  } else if (args.regime === "Volatility expansion / amplification") {
    notes.push("Short premium near the active rails is dangerous. Consider waiting, reducing size, or using defined-risk structures.");
    if (args.hedgeFlowBias === "bullish") notes.push("Bullish hedge-flow bias: tight covered calls are the main trap.");
    if (args.hedgeFlowBias === "bearish") notes.push("Bearish hedge-flow bias: tight CSPs are the main trap.");
  } else if (args.regime === "Stale / low confidence") {
    notes.push("Refresh OI/candle data before using the dealer-pressure read.");
  } else {
    notes.push("Mixed regime: use smaller size or wait for support/resistance acceptance before deploying new premium.");
  }

  return notes;
}

function buildScalpLiteNotes(regime: DealerPressureRegime): string[] {
  if (regime === "Volatility suppression / pinning") {
    return [
      "Gamma-scalp-lite read: mean reversion is favored; take profits near magnet/rails rather than chasing continuation.",
      "Best fit: short premium outside the active range, quick profit-taking, alerts at rails."
    ];
  }
  if (regime === "Pin-to-snap") {
    return [
      "Gamma-scalp-lite read: wait for the rail break. Inside the range may chop; outside the range may move fast.",
      "Best fit: avoid tight premium, use trigger alerts, consider defined-risk directional trades only after activation."
    ];
  }
  if (regime === "Volatility expansion / amplification") {
    return [
      "Gamma-scalp-lite read: the environment favors movement over pinning; short premium needs extra cushion or defined risk.",
      "Best fit: avoid selling directly into the break rail; let long convexity work if already owned."
    ];
  }
  return [
    "Gamma-scalp-lite read: no clean pin/snap advantage. Require confirmation or refresh the surface."
  ];
}

function latestClose(candles?: CandleRecord[] | null): number | null {
  const last = (candles ?? []).slice().reverse().find((candle: any) => safeNumber(candle?.close) != null);
  return safeNumber((last as any)?.close);
}

export function buildDealerPressureSummary(args: {
  surface: OptionSurfaceSnapshot | null;
  edge?: TraderEdgeSummary | null;
  wallMigration?: WallMigrationSummary | null;
  candles?: CandleRecord[] | null;
  livePrice?: number | null;
}): DealerPressureSummary | null {
  const surface = args.surface;
  if (!surface) return null;

  const spot = args.edge?.analysisPrice ?? getSnapshotSpot(surface, args.livePrice ?? latestClose(args.candles));
  const levels = getSurfaceStructure(surface, args.edge ?? null);
  const pressureRows = buildPressureMap(surface, spot);
  const totalPressure = pressureRows.reduce((sum, item) => sum + item.totalPressure, 0);
  const callPressure = pressureRows.reduce((sum, item) => sum + item.callPressure, 0);
  const putPressure = pressureRows.reduce((sum, item) => sum + item.putPressure, 0);
  const callShare = totalPressure > 0 ? (callPressure / totalPressure) * 100 : null;
  const putShare = totalPressure > 0 ? (putPressure / totalPressure) * 100 : null;

  const gammaConcentrationScore = scoreGammaConcentration(pressureRows, spot);
  const nearSpotBalanceScore = scoreBalance(pressureRows, spot);
  const railProximityScore = scoreRailProximity(args.edge, spot, levels.support, levels.resistance);
  const wallMigrationScore = scoreWallMigration(args.wallMigration);
  const confidenceScore = inferConfidence(args.edge, args.wallMigration, pressureRows);

  const rangeWidthPct = args.edge?.rangeWidthPct ?? (spot && levels.support != null && levels.resistance != null ? ((levels.resistance - levels.support) / spot) * 100 : null);
  const compressionScore = rangeWidthPct == null ? 35 : clampScore(100 - rangeWidthPct * 9);
  const thrustScore = args.edge?.volumeThrust != null ? clampScore((args.edge.volumeThrust - 0.8) * 55) : 35;
  const atrScore = args.edge?.atrPct != null ? clampScore(args.edge.atrPct * 8) : 35;

  const pinRiskScore = clampScore(
    gammaConcentrationScore * 0.32 +
    nearSpotBalanceScore * 0.22 +
    compressionScore * 0.22 +
    (args.edge?.pinSnapRiskScore ?? 50) * 0.14 +
    (100 - Math.min(100, atrScore)) * 0.1
  );

  const snapRiskScore = clampScore(
    railProximityScore * 0.28 +
    gammaConcentrationScore * 0.18 +
    compressionScore * 0.16 +
    thrustScore * 0.14 +
    atrScore * 0.12 +
    wallMigrationScore * 0.12
  );

  const hedgeFlowBias = inferHedgeFlowBias({ edge: args.edge, migration: args.wallMigration, callShare, putShare });
  const regime = summarizeRegime({ pinRiskScore, snapRiskScore, confidenceScore, edge: args.edge });
  const premiumSellerSafety = premiumSafetyFromRegime(regime);
  const dominant = pressureRows[0] ?? null;
  const nearestCall = pressureRows
    .filter((item) => spot != null && item.strike >= spot && item.callPressure > 0)
    .sort((a, b) => Math.abs(a.strike - (spot ?? 0)) - Math.abs(b.strike - (spot ?? 0)))[0] ?? null;
  const nearestPut = pressureRows
    .filter((item) => spot != null && item.strike <= spot && item.putPressure > 0)
    .sort((a, b) => Math.abs(a.strike - (spot ?? 0)) - Math.abs(b.strike - (spot ?? 0)))[0] ?? null;

  const riskNotes: string[] = [];
  if (regime === "Pin-to-snap") riskNotes.push("Pin risk and snap risk are both elevated; do not confuse calm price action with safety.");
  if (regime === "Volatility expansion / amplification") riskNotes.push("Wall breaks may accelerate; avoid short premium directly near the break rail.");
  if (hedgeFlowBias === "conflict") riskNotes.push("Hedge-flow bias is conflicted; wait for price acceptance outside the active range.");
  if ((args.edge?.staleDays ?? 0) > 1) riskNotes.push(`Surface is ${args.edge?.staleDays} days old; refresh before relying on this read.`);

  const dataQualityNotes: string[] = [];
  if (!pressureRows.length) dataQualityNotes.push("No usable option rows for pressure estimate.");
  if (!args.wallMigration?.hasPrior) dataQualityNotes.push("No prior surface comparison; wall migration input is limited.");
  if (confidenceScore < 45) dataQualityNotes.push("Dealer-pressure confidence is low; use as context only.");

  return {
    ticker: String((surface as any).ticker ?? args.edge?.ticker ?? "").toUpperCase(),
    snapshotDate: dateKey((surface as any).snapshotDate ?? args.edge?.snapshotDate),
    spot,
    regime,
    hedgeFlowBias,
    premiumSellerSafety,
    pinRiskScore,
    snapRiskScore,
    gammaConcentrationScore,
    nearSpotBalanceScore,
    railProximityScore,
    wallMigrationScore,
    confidenceScore,
    callPressure,
    putPressure,
    totalPressure,
    callPressureSharePct: callShare,
    putPressureSharePct: putShare,
    dominantPressureStrike: dominant?.strike ?? null,
    nearestCallPressureStrike: nearestCall?.strike ?? null,
    nearestPutPressureStrike: nearestPut?.strike ?? null,
    support: levels.support,
    resistance: levels.resistance,
    magnet: levels.magnet,
    activeRangeWidthPct: rangeWidthPct,
    interpretation: describeRegime({ regime, hedgeFlowBias, support: levels.support, resistance: levels.resistance, magnet: levels.magnet }),
    tradeTranslation: buildTradeTranslation({ regime, hedgeFlowBias, support: levels.support, resistance: levels.resistance, edge: args.edge }),
    scalpLiteNotes: buildScalpLiteNotes(regime),
    riskNotes,
    dataQualityNotes
  };
}
