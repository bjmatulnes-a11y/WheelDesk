import { type CandleRecord } from "./wheeldesk-storage";
import { type IVSurfaceSummary } from "./iv-surface-engine";

export type ControlSignalType =
  | "TOP_RISK"
  | "BOTTOM_RISK"
  | "BUY_BREAKOUT"
  | "SELL_BREAKDOWN"
  | "PIN_CONFLUENCE"
  | "NO_EDGE";

export type ControlSignalStrength = "none" | "watch" | "active" | "strong";

export type ControlSignalFactor = {
  label: string;
  points: number;
  maxPoints: number;
  active: boolean;
};

export type ControlSignalSummary = {
  signalType: ControlSignalType;
  label: string;
  shortLabel: string;
  score: number;
  strength: ControlSignalStrength;
  bias: "bullish" | "bearish" | "neutral";
  marker: "arrowUp" | "arrowDown" | "circle" | null;
  markerPosition: "aboveBar" | "belowBar" | "inBar";
  markerColor: string;
  anchorDate?: string;
  factors: ControlSignalFactor[];
  action: string;
  invalidation: string;
  notes: string[];
};

type BuildArgs = {
  currentPrice: number;
  candles?: CandleRecord[];
  edgeSummary?: any;
  dealerPressure?: any;
  predictiveMatrix?: any;
  path?: any;
  wallMigration?: any;
  ivSurface?: IVSurfaceSummary | null;
};

function n(value: unknown): number | null {
  const x = Number(value);
  return Number.isFinite(x) ? x : null;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function dateOnly(value: unknown): string | undefined {
  const s = String(value ?? "").slice(0, 10);
  return s ? s : undefined;
}

function last<T>(arr?: T[]): T | undefined {
  return arr?.length ? arr[arr.length - 1] : undefined;
}

function pctDistance(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return Infinity;
  return Math.abs(a - b) / Math.abs(b);
}

function within(price: number, level: number | null | undefined, tolerancePct: number): boolean {
  if (level == null || !Number.isFinite(level) || level <= 0) return false;
  return pctDistance(price, level) <= tolerancePct;
}

function above(price: number, level: number | null | undefined): boolean {
  return level != null && Number.isFinite(level) && price > level;
}

function below(price: number, level: number | null | undefined): boolean {
  return level != null && Number.isFinite(level) && price < level;
}

function getFirstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const x = n(value);
    if (x != null) return x;
  }
  return null;
}

function getBullishProbability(matrix: any): number {
  const rows = matrix?.rows ?? matrix?.scenarioRows ?? [];
  const hit = rows.find((row: any) => String(row?.scenario ?? row?.name ?? "").toLowerCase().includes("bull"));
  return n(hit?.probabilityPct ?? hit?.probability ?? matrix?.bullishProbabilityPct ?? matrix?.bullishProbability) ?? 0;
}

function getBearishProbability(matrix: any): number {
  const rows = matrix?.rows ?? matrix?.scenarioRows ?? [];
  const hit = rows.find((row: any) => String(row?.scenario ?? row?.name ?? "").toLowerCase().includes("bear"));
  return n(hit?.probabilityPct ?? hit?.probability ?? matrix?.bearishProbabilityPct ?? matrix?.bearishProbability) ?? 0;
}

function getBaseProbability(matrix: any): number {
  const rows = matrix?.rows ?? matrix?.scenarioRows ?? [];
  const hit = rows.find((row: any) => {
    const label = String(row?.scenario ?? row?.name ?? "").toLowerCase();
    return label.includes("base") || label.includes("pin") || label.includes("magnet");
  });
  return n(hit?.probabilityPct ?? hit?.probability ?? matrix?.baseProbabilityPct ?? matrix?.baseProbability) ?? 0;
}

function wallBiasText(wallMigration: any): string {
  return String(
    wallMigration?.bias ??
    wallMigration?.directionalBias ??
    wallMigration?.migrationBias ??
    wallMigration?.regime ??
    ""
  ).toLowerCase();
}

function dealerRegimeText(dealerPressure: any): string {
  return String(
    dealerPressure?.regime ??
    dealerPressure?.classification ??
    dealerPressure?.pressureRegime ??
    dealerPressure?.summaryLabel ??
    ""
  ).toLowerCase();
}

function factor(label: string, active: boolean, points: number, maxPoints = points): ControlSignalFactor {
  return { label, active, points: active ? points : 0, maxPoints };
}

function sumFactors(factors: ControlSignalFactor[]): number {
  return clamp(Math.round(factors.reduce((sum, item) => sum + item.points, 0)));
}

function strength(score: number): ControlSignalStrength {
  if (score >= 82) return "strong";
  if (score >= 70) return "active";
  if (score >= 58) return "watch";
  return "none";
}

function recentMomentum(candles?: CandleRecord[]): number {
  const rows = (candles ?? []).filter((c) => Number.isFinite(Number(c.close))).slice(-8);
  if (rows.length < 3) return 0;
  const first = Number(rows[0].close);
  const lastClose = Number(rows[rows.length - 1].close);
  return first > 0 ? (lastClose - first) / first : 0;
}

function lastCandle(candles?: CandleRecord[]): CandleRecord | undefined {
  return last((candles ?? []).filter((c) => Number.isFinite(Number(c.close))));
}

function findAnchorDate(candles: CandleRecord[] | undefined, kind: "top" | "bottom" | "latest"): string | undefined {
  const rows = (candles ?? []).slice(-14);
  if (!rows.length) return undefined;
  if (kind === "latest") return dateOnly(rows[rows.length - 1]?.date);

  if (kind === "top") {
    const top = rows.slice().sort((a, b) => Number(b.high ?? b.close) - Number(a.high ?? a.close))[0];
    return dateOnly(top?.date);
  }

  const bottom = rows.slice().sort((a, b) => Number(a.low ?? a.close) - Number(b.low ?? b.close))[0];
  return dateOnly(bottom?.date);
}

function buildNoEdge(): ControlSignalSummary {
  return {
    signalType: "NO_EDGE",
    label: "No clean control signal",
    shortLabel: "WAIT",
    score: 0,
    strength: "none",
    bias: "neutral",
    marker: null,
    markerPosition: "inBar",
    markerColor: "#94a3b8",
    factors: [],
    action: "Wait for a cleaner rail, magnet, or IV-band interaction.",
    invalidation: "N/A",
    notes: ["No gated confluence state reached the signal threshold."],
  };
}

export function buildControlSignalSummary(args: BuildArgs): ControlSignalSummary {
  const price = n(args.currentPrice) ?? n(lastCandle(args.candles)?.close) ?? 0;
  if (!Number.isFinite(price) || price <= 0) return buildNoEdge();

  const edge = args.edgeSummary ?? {};
  const dealer = args.dealerPressure ?? {};
  const matrix = args.predictiveMatrix ?? {};
  const path = args.path ?? {};
  const iv = args.ivSurface ?? null;

  const bullishUnlock = getFirstNumber(path?.bullishUnlock, path?.bullishUnlockLevel, matrix?.bullishUnlock, edge?.bullishUnlock, edge?.resistance);
  const bearishFailure = getFirstNumber(path?.bearishFailure, path?.bearishFailureLevel, matrix?.bearishFailure, edge?.bearishFailure, edge?.support);
  const callWall = getFirstNumber(edge?.callWall, edge?.resistance, dealer?.callWall, dealer?.resistance, path?.callWall);
  const putWall = getFirstNumber(edge?.putWall, edge?.support, dealer?.putWall, dealer?.support, path?.putWall);
  const magnet = getFirstNumber(edge?.magnet, dealer?.magnet, path?.magnet, matrix?.expectedValueTarget);
  const upperCone = getFirstNumber(path?.upperCone, path?.upperBand?.at?.(-1)?.value, path?.upperBand?.at?.(-1)?.price, matrix?.expectedRangeHigh);
  const lowerCone = getFirstNumber(path?.lowerCone, path?.lowerBand?.at?.(-1)?.value, path?.lowerBand?.at?.(-1)?.price, matrix?.expectedRangeLow);

  const ivUpper = iv?.expectedMove?.upperOneSigma ?? null;
  const ivLower = iv?.expectedMove?.lowerOneSigma ?? null;
  const ivUpperHalf = iv?.expectedMove?.upperHalfSigma ?? null;
  const ivLowerHalf = iv?.expectedMove?.lowerHalfSigma ?? null;
  const ivRange = ivUpper != null && ivLower != null ? Math.max(0, ivUpper - ivLower) : price * 0.05;
  const tolerancePct = Math.max(0.004, Math.min(0.018, ivRange / price / 10));

  const pinRisk = n(dealer?.pinRisk ?? dealer?.pinRiskPct ?? dealer?.scores?.pinRisk) ?? 0;
  const snapRisk = n(dealer?.snapRisk ?? dealer?.snapRiskPct ?? dealer?.scores?.snapRisk) ?? 0;
  const gammaConcentration = n(dealer?.gammaConcentration ?? dealer?.scores?.gammaConcentration) ?? 0;
  const wallBias = wallBiasText(args.wallMigration);
  const dealerRegime = dealerRegimeText(dealer);
  const bullishProb = getBullishProbability(matrix);
  const bearishProb = getBearishProbability(matrix);
  const baseProb = getBaseProbability(matrix);
  const momentum = recentMomentum(args.candles);
  const candle = lastCandle(args.candles);
  const redLast = candle ? Number(candle.close) < Number(candle.open) : false;
  const greenLast = candle ? Number(candle.close) > Number(candle.open) : false;

  const insideRange = (!bullishUnlock || price <= bullishUnlock) && (!bearishFailure || price >= bearishFailure);
  const nearUpper =
    within(price, callWall, tolerancePct * 1.6) ||
    within(price, bullishUnlock, tolerancePct * 1.4) ||
    within(price, upperCone, tolerancePct * 1.6) ||
    (ivUpperHalf != null && price >= ivUpperHalf) ||
    (ivUpper != null && within(price, ivUpper, tolerancePct * 2.2));

  const nearLower =
    within(price, putWall, tolerancePct * 1.6) ||
    within(price, bearishFailure, tolerancePct * 1.4) ||
    within(price, lowerCone, tolerancePct * 1.6) ||
    (ivLowerHalf != null && price <= ivLowerHalf) ||
    (ivLower != null && within(price, ivLower, tolerancePct * 2.2));

  const nearMagnet = within(price, magnet, tolerancePct * 1.8);

  const breakoutFactors = [
    factor("Accepted above bullish unlock", above(price, bullishUnlock), 25),
    factor("Bullish scenario is active", bullishProb >= Math.max(25, bearishProb + 6), 15),
    factor("Dealer pressure not bearish", !dealerRegime.includes("bear"), 12),
    factor("Wall migration supports upside", wallBias.includes("bull") || wallBias.includes("up") || wallBias.includes("expanding"), 12),
    factor("IV range allows continuation", ivUpper == null || price < ivUpper, 12),
    factor("Momentum confirms", momentum > 0.006 || greenLast, 10),
    factor("Call wall reclaimed", above(price, callWall), 8),
  ];

  const breakdownFactors = [
    factor("Accepted below bearish failure", below(price, bearishFailure), 25),
    factor("Bearish scenario is active", bearishProb >= Math.max(22, bullishProb + 4), 15),
    factor("Dealer pressure is bearish/unstable", dealerRegime.includes("bear") || snapRisk >= 65, 12),
    factor("Wall migration supports downside", wallBias.includes("bear") || wallBias.includes("down") || wallBias.includes("fall"), 12),
    factor("IV range allows downside", ivLower == null || price > ivLower, 12),
    factor("Momentum confirms", momentum < -0.006 || redLast, 10),
    factor("Put wall lost", below(price, putWall), 8),
  ];

  const topFactors = [
    factor("Price at upper control boundary", nearUpper, 22),
    factor("Near call wall / resistance", within(price, callWall, tolerancePct * 2) || within(price, bullishUnlock, tolerancePct * 2), 14),
    factor("Near upper IV surface band", ivUpperHalf != null && price >= ivUpperHalf, 14),
    factor("Bullish path target reached", upperCone != null && price >= upperCone * 0.985, 12),
    factor("Dealer pin/suppression pressure", pinRisk >= 60 || dealerRegime.includes("pin") || dealerRegime.includes("suppress"), 12),
    factor("Wall migration stalls/compresses", wallBias.includes("compress") || wallBias.includes("flat") || wallBias.includes("neutral"), 10),
    factor("Upside momentum fading", momentum < 0.004 || redLast, 9),
    factor("IV/skew does not confirm chase", iv?.skewBias === "bearish" || iv?.termStructure === "compressed" || iv?.volRegime === "normal", 7),
  ];

  const bottomFactors = [
    factor("Price at lower control boundary", nearLower, 22),
    factor("Near put wall / support", within(price, putWall, tolerancePct * 2) || within(price, bearishFailure, tolerancePct * 2), 14),
    factor("Near lower IV surface band", ivLowerHalf != null && price <= ivLowerHalf, 14),
    factor("Bearish path target reached", lowerCone != null && price <= lowerCone * 1.015, 12),
    factor("Dealer absorption / pin pressure", pinRisk >= 55 || gammaConcentration >= 55 || dealerRegime.includes("pin"), 12),
    factor("Wall migration stalls/compresses", wallBias.includes("compress") || wallBias.includes("flat") || wallBias.includes("neutral"), 10),
    factor("Selling momentum fading", momentum > -0.004 || greenLast, 9),
    factor("Downside skew already rich", iv?.skewBias === "bearish" || iv?.lowerBandIv != null && iv?.atmIv != null && iv.lowerBandIv > iv.atmIv, 7),
  ];

  const pinFactors = [
    factor("Price inside control range", insideRange, 20),
    factor("Price near magnet", nearMagnet, 20),
    factor("Pin risk elevated", pinRisk >= 60, 15),
    factor("Snap risk controlled", snapRisk <= 55, 12),
    factor("Call/put pressure balanced", Math.abs((n(dealer?.callPressure) ?? 0) - (n(dealer?.putPressure) ?? 0)) < 20 || gammaConcentration >= 55, 10),
    factor("Walls stable/compressing", wallBias.includes("compress") || wallBias.includes("flat") || wallBias.includes("neutral"), 10),
    factor("Base scenario dominant", baseProb >= bullishProb && baseProb >= bearishProb, 8),
    factor("IV normal/compressed", iv?.volRegime === "normal" || iv?.volRegime === "compressed", 5),
  ];

  const candidates = [
    { type: "BUY_BREAKOUT" as const, factors: breakoutFactors, gate: above(price, bullishUnlock), label: "Buy Breakout", shortLabel: "BUY", bias: "bullish" as const, marker: "arrowUp" as const, markerPosition: "belowBar" as const, markerColor: "#22c55e", anchor: findAnchorDate(args.candles, "latest"), action: "Bullish continuation state. Preserve upside; avoid tight covered calls.", invalidation: bullishUnlock ? `Back below ${bullishUnlock.toFixed(2)}` : "Back below bullish rail" },
    { type: "SELL_BREAKDOWN" as const, factors: breakdownFactors, gate: below(price, bearishFailure), label: "Sell Breakdown", shortLabel: "SELL", bias: "bearish" as const, marker: "arrowDown" as const, markerPosition: "aboveBar" as const, markerColor: "#ef4444", anchor: findAnchorDate(args.candles, "latest"), action: "Bearish continuation state. Avoid CSPs near spot; reduce downside exposure.", invalidation: bearishFailure ? `Back above ${bearishFailure.toFixed(2)}` : "Back above failure rail" },
    { type: "TOP_RISK" as const, factors: topFactors, gate: nearUpper && !above(price, bullishUnlock), label: "Top Risk", shortLabel: "TOP", bias: "bearish" as const, marker: "arrowDown" as const, markerPosition: "aboveBar" as const, markerColor: "#fb7185", anchor: findAnchorDate(args.candles, "top"), action: "Probable upper exhaustion zone. Avoid chasing longs; covered calls may become attractive above the upper band.", invalidation: bullishUnlock ? `Acceptance above ${bullishUnlock.toFixed(2)}` : "Acceptance above upper rail" },
    { type: "BOTTOM_RISK" as const, factors: bottomFactors, gate: nearLower && !below(price, bearishFailure), label: "Bottom Risk", shortLabel: "BOTTOM", bias: "bullish" as const, marker: "arrowUp" as const, markerPosition: "belowBar" as const, markerColor: "#22c55e", anchor: findAnchorDate(args.candles, "bottom"), action: "Probable lower absorption zone. Avoid chasing downside; look for reclaim/defined-risk upside.", invalidation: bearishFailure ? `Acceptance below ${bearishFailure.toFixed(2)}` : "Acceptance below lower rail" },
    { type: "PIN_CONFLUENCE" as const, factors: pinFactors, gate: insideRange && nearMagnet, label: "Pin Confluence", shortLabel: "PIN", bias: "neutral" as const, marker: "circle" as const, markerPosition: "inBar" as const, markerColor: "#facc15", anchor: findAnchorDate(args.candles, "latest"), action: "Containment state. Favor premium outside the cone; avoid chasing direction at the magnet.", invalidation: "Break and acceptance outside the control range" },
  ].map((candidate) => ({ ...candidate, score: candidate.gate ? sumFactors(candidate.factors) : 0 }));

  const best = candidates.sort((a, b) => b.score - a.score)[0];
  if (!best || best.score < 58) return buildNoEdge();

  return {
    signalType: best.type,
    label: best.label,
    shortLabel: `${best.shortLabel} ${best.score}`,
    score: best.score,
    strength: strength(best.score),
    bias: best.bias,
    marker: best.marker,
    markerPosition: best.markerPosition,
    markerColor: best.markerColor,
    anchorDate: best.anchor,
    factors: best.factors,
    action: best.action,
    invalidation: best.invalidation,
    notes: best.factors.filter((item) => item.active).slice(0, 5).map((item) => item.label),
  };
}
