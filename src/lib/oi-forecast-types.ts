export type ForecastHorizonKey =
  | "1D"
  | "3D"
  | "5D"
  | "10D"
  | "14D"
  | "30D"
  | "EXP";

export type ForecastHorizonPayload = {
  horizon: ForecastHorizonKey;
  days?: number;
  base?: number | null;
  upper?: number | null;
  lower?: number | null;
  bias?: string | null;
  confidence?: number | null;
  pinProbability?: number | null;
  upperTouchProbability?: number | null;
  lowerBreakProbability?: number | null;
  trapProbability?: number | null;
  wheelSupportHoldProbability?: number | null;
  posture?: string | null;
};

export type NeuralForecastModelStatus =
  | "collecting"
  | "collecting_baseline_only"
  | "research_preview"
  | "eligible"
  | "active"
  | "disabled";

export type OIFieldForecastPayload = {
  symbol: string;
  spot: number;
  snapshotDate?: string | null;
  expiration?: string | null;
  dte?: number | null;
  surfaceSnapshotId?: string | null;
  source?: string | null;
  provider?: string | null;
  bias?: string | null;
  confidence?: number | null;
  structureBandLower?: number | null;
  structureBandUpper?: number | null;
  expectedMoveLower?: number | null;
  expectedMoveUpper?: number | null;
  expectedMove?: number | null;
  expectedMoveSource?: string | null;
  pinProbability?: number | null;
  upperTouchProbability?: number | null;
  lowerBreakProbability?: number | null;
  trapProbability?: number | null;
  wheelSupportHoldProbability?: number | null;
  posture?: string | null;
  horizons?: ForecastHorizonPayload[];
  inputs?: Record<string, unknown> | null;
  forecast?: Record<string, unknown> | null;

  // Neural-network-ready capture fields. These are populated even while NN is not active
  // so the deterministic OI Field engine can become the baseline training dataset.
  engineVersion?: string | null;
  modelStatus?: NeuralForecastModelStatus | string | null;
  nnModelVersion?: string | null;
  baselineForecast?: Record<string, unknown> | null;
  featureVector?: Record<string, unknown> | null;
  nnAdjustment?: Record<string, unknown> | null;
  finalForecast?: Record<string, unknown> | null;
  trainingEligible?: boolean | null;
  outcomeStatus?: string | null;
};

export const FORECAST_HORIZONS: ForecastHorizonKey[] = [
  "1D",
  "3D",
  "5D",
  "10D",
  "14D",
  "30D",
  "EXP",
];

export function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function horizonByKey(
  payload: OIFieldForecastPayload,
  key: ForecastHorizonKey,
): ForecastHorizonPayload | undefined {
  return payload.horizons?.find((item) => item.horizon === key);
}

export function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}
