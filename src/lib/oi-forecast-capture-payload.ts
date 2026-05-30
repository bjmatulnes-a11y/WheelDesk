import type {
  OIFieldForecastResult,
  OIFieldHorizonForecast,
} from "./oi-field-engine-v2";

export type OIFieldCaptureArgs = {
  ticker: string;
  spot: number;
  snapshotDate?: string | null;
  expiration?: string | null;
  dte?: number | null;
  surfaceSnapshotId?: string | null;
  source?: string | null;
  provider?: string | null;
  forecast: OIFieldForecastResult | null;
  classicPath?: any | null;
  chainPath?: any | null;
  forecastOverlayMaxDte?: number | null;
  ivSurface?: any | null;
  selectedSurface?: any | null;
  selectedChainSurface?: any | null;
  inputs?: Record<string, unknown> | null;
};

const VALID_HORIZONS = new Set(["1D", "3D", "5D", "10D", "14D", "30D", "EXP"]);

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDate(value: unknown): string | null {
  if (!value) return null;
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toISOString().slice(0, 10);
}

function normalizePathPoints(
  points: any[] | null | undefined,
): Array<{ date: string; value: number }> {
  if (!Array.isArray(points)) return [];
  return points
    .map((point) => {
      const date = normalizeDate(
        point?.date ?? point?.time ?? point?.expiration,
      );
      const value = finite(
        point?.value ?? point?.price ?? point?.adjustedCenter,
      );
      return date && value != null ? { date, value } : null;
    })
    .filter((point): point is { date: string; value: number } =>
      Boolean(point),
    );
}

function pathReceipt(path: any | null | undefined, mode: string) {
  if (!path) return null;

  return {
    mode,
    ticker: path.ticker ?? null,
    snapshotDate: normalizeDate(path.snapshotDate),
    currentPrice: finite(path.currentPrice),
    anchorExpiration: normalizeDate(path.anchorExpiration),
    dominantExpiration: normalizeDate(path.dominantExpiration),
    horizonSessions: finite(path.horizonSessions),
    maxDte: finite(path.maxDte),
    includedExpirations: Array.isArray(path.includedExpirations)
      ? path.includedExpirations.map(normalizeDate).filter(Boolean)
      : [],
    regime: path.regime ?? null,
    confidence: path.confidence ?? null,
    pathBias: path.pathBias ?? null,
    basePath: normalizePathPoints(path.basePath),
    upperBand: normalizePathPoints(path.upperBand),
    lowerBand: normalizePathPoints(path.lowerBand),
    bullishUnlockPath: normalizePathPoints(path.bullishUnlockPath),
    bearishFailurePath: normalizePathPoints(path.bearishFailurePath),
    notes: Array.isArray(path.notes) ? path.notes : [],
  };
}

function buildForecastOverlayReceipt(
  args: OIFieldCaptureArgs,
  forecast: OIFieldForecastResult,
  horizons: any[],
) {
  const classicPath = pathReceipt(args.classicPath, "classic_oi_path");
  const selectedChainPath = pathReceipt(args.chainPath, "selected_chain_path");

  return {
    schemaVersion: "wd-forecast-overlay-v1",
    activeMode: classicPath
      ? "classic_oi_path"
      : selectedChainPath
        ? "selected_chain_path"
        : "oi_field_v2_horizons",
    validationMeaning:
      "Forecast overlay is frozen at capture; validation overlay is actual candles after the capture date.",
    snapshotDate: normalizeDate(args.snapshotDate ?? forecast.snapshotDate),
    capturedSpot: finite(args.spot ?? forecast.currentPrice),
    selectedExpiration: normalizeDate(args.expiration),
    selectedDte: finite(args.dte ?? forecast.selectedExpirationDte),
    maxDte:
      finite(args.forecastOverlayMaxDte) ?? finite(classicPath?.maxDte) ?? 30,
    classicPath,
    selectedChainPath,
    oiFieldHorizons: horizons,
  };
}

function horizonKey(
  row: OIFieldHorizonForecast,
): "1D" | "3D" | "5D" | "10D" | "14D" | "30D" | "EXP" | null {
  const key = String(row.key ?? "").toUpperCase();
  if (VALID_HORIZONS.has(key)) return key as any;

  const label = String(row.label ?? "").toUpperCase();
  if (label.startsWith("EXP")) return "EXP";

  const sessions = finite(row.sessions);
  if (sessions === 1) return "1D";
  if (sessions === 3) return "3D";
  if (sessions === 5) return "5D";
  if (sessions === 10) return "10D";
  if (sessions === 14) return "14D";
  if (sessions === 30) return "30D";

  return null;
}

export function wheelHorizon(
  forecast: OIFieldForecastResult | null,
): OIFieldHorizonForecast | null {
  if (!forecast?.horizons?.length) return null;

  return (
    forecast.horizons.find((row) => horizonKey(row) === "30D") ??
    forecast.horizons.find((row) => row.bucket === "wheel") ??
    forecast.horizons.find((row) => row.bucket === "expiration") ??
    forecast.horizons[forecast.horizons.length - 1] ??
    null
  );
}

function expectedMove(ivSurface: any | null | undefined) {
  const oneSigma = finite(ivSurface?.expectedMove?.oneSigma);
  const lower = finite(ivSurface?.expectedMove?.lowerOneSigma);
  const upper = finite(ivSurface?.expectedMove?.upperOneSigma);

  return { oneSigma, lower, upper };
}

function firstFinite(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = finite(value);
    if (parsed != null) return parsed;
  }
  return null;
}

function extractRows(surface: any | null | undefined): any[] {
  if (Array.isArray(surface?.rows)) return surface.rows;
  if (Array.isArray(surface?.chains?.[0]?.rows)) return surface.chains[0].rows;
  if (Array.isArray(surface?.chain?.rows)) return surface.chain.rows;
  return [];
}

function sumBy(
  rows: any[],
  predicate: (row: any) => boolean,
  selector: (row: any) => unknown,
): number {
  return rows.reduce((sum, row) => {
    if (!predicate(row)) return sum;
    const value = finite(selector(row));
    return sum + (value ?? 0);
  }, 0);
}

function optionType(row: any): string {
  return String(
    row?.type ??
      row?.optionType ??
      row?.side ??
      row?.contractType ??
      row?.putCall ??
      "",
  ).toLowerCase();
}

function strike(row: any): number | null {
  return firstFinite(row?.strike, row?.strikePrice, row?.price);
}

function oi(row: any): number {
  return firstFinite(row?.openInterest, row?.oi, row?.open_interest) ?? 0;
}

function findWall(
  rows: any[],
  type: "call" | "put",
): { strike: number | null; openInterest: number | null } {
  const typed = rows
    .filter(
      (row) =>
        optionType(row).includes(type) ||
        optionType(row) === (type === "call" ? "c" : "p"),
    )
    .map((row) => ({ strike: strike(row), openInterest: oi(row) }))
    .filter((row) => row.strike != null);

  if (!typed.length) return { strike: null, openInterest: null };

  typed.sort((a, b) => (b.openInterest ?? 0) - (a.openInterest ?? 0));
  return typed[0];
}

function buildBaselineForecast(
  forecast: OIFieldForecastResult,
  horizons: any[],
  forecastOverlay: Record<string, unknown>,
) {
  return {
    engineVersion: forecast.version,
    forecastOverlay,
    baseBias: forecast.baseBias,
    confidenceScore: forecast.confidenceScore,
    regime: forecast.regime,
    shortTermScore: forecast.shortTermScore,
    swingScore: forecast.swingScore,
    wheelScore: forecast.wheelScore,
    horizons,
    readout: forecast.readout,
    engineNotes: forecast.engineNotes ?? [],
  };
}

function buildFeatureVector(
  args: OIFieldCaptureArgs,
  forecast: OIFieldForecastResult,
  wheel: OIFieldHorizonForecast | null,
) {
  const rows = extractRows(args.selectedChainSurface);
  const callWall = findWall(rows, "call");
  const putWall = findWall(rows, "put");
  const totalCallOi = sumBy(
    rows,
    (row) => optionType(row).includes("call") || optionType(row) === "c",
    oi,
  );
  const totalPutOi = sumBy(
    rows,
    (row) => optionType(row).includes("put") || optionType(row) === "p",
    oi,
  );
  const totalOi = totalCallOi + totalPutOi;
  const spot = finite(args.spot ?? forecast.currentPrice);
  const callWallDistancePct =
    spot && callWall.strike ? ((callWall.strike - spot) / spot) * 100 : null;
  const putWallDistancePct =
    spot && putWall.strike ? ((spot - putWall.strike) / spot) * 100 : null;
  const em = expectedMove(args.ivSurface);

  return {
    schemaVersion: "wd-feature-vector-v1",
    symbol: String(args.ticker || forecast.ticker || "")
      .trim()
      .toUpperCase(),
    spot,
    snapshotDate: normalizeDate(args.snapshotDate ?? forecast.snapshotDate),
    expiration: normalizeDate(args.expiration),
    dte: finite(args.dte ?? forecast.selectedExpirationDte),
    engineVersion: forecast.version,
    regime: forecast.regime,
    baseBias: forecast.baseBias,
    confidenceScore: forecast.confidenceScore,
    shortTermScore: forecast.shortTermScore,
    swingScore: forecast.swingScore,
    wheelScore: forecast.wheelScore,
    structureBandLower: finite(wheel?.lowerBand),
    structureBandUpper: finite(wheel?.upperBand),
    structureBandWidthPct:
      spot && wheel?.lowerBand != null && wheel?.upperBand != null
        ? ((Number(wheel.upperBand) - Number(wheel.lowerBand)) / spot) * 100
        : null,
    expectedMove: em.oneSigma,
    expectedMoveLower: em.lower,
    expectedMoveUpper: em.upper,
    expectedMoveWidthPct:
      spot && em.oneSigma != null ? (em.oneSigma / spot) * 100 : null,
    atmIv: finite(args.ivSurface?.atmIv),
    ivRank: finite(args.ivSurface?.ivRank),
    ivPercentile: finite(args.ivSurface?.ivPercentile),
    ivSkewBias: args.ivSurface?.skewBias ?? null,
    callWallStrike: callWall.strike,
    callWallOpenInterest: callWall.openInterest,
    putWallStrike: putWall.strike,
    putWallOpenInterest: putWall.openInterest,
    totalCallOi,
    totalPutOi,
    totalOi,
    putCallOiRatio: totalCallOi > 0 ? totalPutOi / totalCallOi : null,
    callWallDistancePct,
    putWallDistancePct,
    selectedChainRows: rows.length || null,
    surfaceChains: Array.isArray(args.selectedSurface?.chains)
      ? args.selectedSurface.chains.length
      : null,
    pinProbability: finite(wheel?.pinProbability),
    upperTouchProbability: finite(wheel?.upperWallTouchProbability),
    lowerBreakProbability: finite(wheel?.lowerWallBreakProbability),
    trapProbability: finite(wheel?.trapProbability),
    wheelSupportHoldProbability: finite(wheel?.wheelSupportHoldProbability),
    posture: wheel?.premiumSellerPosture ?? null,
    userInputs: args.inputs ?? {},
  };
}

function buildFinalForecast(
  baselineForecast: Record<string, unknown>,
  nnAdjustment: Record<string, unknown> | null,
) {
  return {
    schemaVersion: "wd-final-forecast-v1",
    source: nnAdjustment ? "oi-field-v2-plus-nn" : "oi-field-v2-baseline",
    baseline: baselineForecast,
    nnAdjustment,
  };
}

export function buildOIFieldForecastCapturePayload(args: OIFieldCaptureArgs) {
  const forecast = args.forecast;
  const spot = finite(args.spot ?? forecast?.currentPrice);

  if (!forecast || !spot) return null;

  const wheel = wheelHorizon(forecast);
  const em = expectedMove(args.ivSurface);

  const chainRows = Array.isArray(args.selectedChainSurface?.chains?.[0]?.rows)
    ? args.selectedChainSurface.chains[0].rows.length
    : null;

  const surfaceChains = Array.isArray(args.selectedSurface?.chains)
    ? args.selectedSurface.chains.length
    : null;

  const horizons = forecast.horizons
    .map((row) => {
      const key = horizonKey(row);
      if (!key) return null;

      return {
        horizon: key,
        days: finite(row.sessions),
        base: finite(row.baseTarget),
        upper: finite(row.upperBand),
        lower: finite(row.lowerBand),
        bias: row.bias ?? null,
        confidence: finite(row.confidenceScore),
        pinProbability: finite(row.pinProbability),
        upperTouchProbability: finite(row.upperWallTouchProbability),
        lowerBreakProbability: finite(row.lowerWallBreakProbability),
        trapProbability: finite(row.trapProbability),
        wheelSupportHoldProbability: finite(row.wheelSupportHoldProbability),
        posture: row.premiumSellerPosture ?? null,
      };
    })
    .filter(Boolean);

  const forecastOverlay = buildForecastOverlayReceipt(args, forecast, horizons);
  const baselineForecast = buildBaselineForecast(
    forecast,
    horizons,
    forecastOverlay,
  );
  const featureVector = buildFeatureVector(args, forecast, wheel);
  const nnAdjustment = null;
  const finalForecast = buildFinalForecast(baselineForecast, nnAdjustment);

  return {
    symbol: String(args.ticker || forecast.ticker || "")
      .trim()
      .toUpperCase(),
    spot,
    snapshotDate: normalizeDate(args.snapshotDate ?? forecast.snapshotDate),
    expiration: normalizeDate(args.expiration),
    dte: finite(args.dte ?? forecast.selectedExpirationDte),
    surfaceSnapshotId: args.surfaceSnapshotId ?? null,
    source: args.source ?? "control_center",
    provider: args.provider ?? "supabase_surface",
    bias: forecast.baseBias,
    confidence: finite(forecast.confidenceScore),
    structureBandLower: finite(wheel?.lowerBand),
    structureBandUpper: finite(wheel?.upperBand),
    expectedMoveLower: em.lower,
    expectedMoveUpper: em.upper,
    expectedMove: em.oneSigma,
    expectedMoveSource: em.oneSigma != null ? "iv_surface_one_sigma" : null,
    pinProbability: finite(wheel?.pinProbability),
    upperTouchProbability: finite(wheel?.upperWallTouchProbability),
    lowerBreakProbability: finite(wheel?.lowerWallBreakProbability),
    trapProbability: finite(wheel?.trapProbability),
    wheelSupportHoldProbability: finite(wheel?.wheelSupportHoldProbability),
    posture: wheel?.premiumSellerPosture ?? null,
    horizons,
    engineVersion: forecast.version,
    modelStatus: "collecting_baseline_only",
    nnModelVersion: null,
    baselineForecast,
    featureVector,
    nnAdjustment,
    finalForecast,
    trainingEligible: Boolean(horizons.length && spot && args.expiration),
    outcomeStatus: "waiting",
    inputs: {
      ...args.inputs,
      forecastOverlay,
      engineVersion: forecast.version,
      selectedExpirationDte: forecast.selectedExpirationDte,
      regime: forecast.regime,
      shortTermScore: forecast.shortTermScore,
      swingScore: forecast.swingScore,
      wheelScore: forecast.wheelScore,
      atmIv: finite(args.ivSurface?.atmIv),
      ivSkewBias: args.ivSurface?.skewBias ?? null,
      surfaceChains,
      selectedChainRows: chainRows,
    },
    forecast: { ...forecast, forecastOverlay },
  };
}
