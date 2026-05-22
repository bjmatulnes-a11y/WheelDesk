import type { OIFieldForecastResult, OIFieldHorizonForecast } from "./oi-field-engine-v2";

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
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function horizonKey(row: OIFieldHorizonForecast): "1D" | "3D" | "5D" | "10D" | "14D" | "30D" | "EXP" | null {
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

export function wheelHorizon(forecast: OIFieldForecastResult | null): OIFieldHorizonForecast | null {
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

  return {
    symbol: String(args.ticker || forecast.ticker || "").trim().toUpperCase(),
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
    inputs: {
      ...args.inputs,
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
    forecast,
  };
}
