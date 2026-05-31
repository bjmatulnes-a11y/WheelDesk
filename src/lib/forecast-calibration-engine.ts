import {
  type PredictiveMatrixResult,
  type PredictiveScenarioKey,
} from "./predictive-matrix-engine";
import { type EdgeValidationSummary } from "./edge-validation-engine";

/**
 * Forecast Calibration engine.
 *
 * Purpose:
 *   Join the LIVE predictive-matrix scenario to the HISTORICAL validation record
 *   for the closest available horizon.
 *
 * Stronger v2 rules:
 *   - Compare scenario probability to historical hit rate, not modelScore to hit rate.
 *     modelScore is retained as a structural-quality score, but it is not the same
 *     thing as event probability.
 *   - Treat historical rates as proxy rates unless/until validation labels are exact.
 *   - Use Wilson confidence bands so thin samples do not over-confirm/over-discount.
 *   - Suppress hard verdicts when sample size is thin, horizon is mismatched, or the
 *     historical interval overlaps the structural probability.
 *   - Keep this additive: no official forecast mutation and no NN activation.
 */

export type CalibrationVerdict =
  | "history_confirms"
  | "history_discounts"
  | "history_neutral"
  | "insufficient_history";

export type CalibrationReliability =
  | "none"
  | "thin"
  | "developing"
  | "usable"
  | "strong";

export type ForecastCalibration = {
  ok: boolean;
  scenario: PredictiveScenarioKey;
  scenarioLabel: string;

  /** Horizon actually used by edge-validation. */
  horizon: number;
  /** Horizon the live forecast UI was asking about before nearest-horizon fallback. */
  requestedHorizon: number;
  horizonMismatch: boolean;

  /** Primary scenario probability from the predictive matrix, 0..100. */
  structuralScore: number;
  /** Overall model-quality score from the predictive matrix, 0..100. */
  modelScore: number;
  structuralConfidence: "low" | "medium" | "high";

  empiricalRate: number | null; // 0..1 historical hit rate for the mapped proxy
  empiricalSamples: number;
  empiricalLower: number | null; // Wilson lower bound, 0..1
  empiricalUpper: number | null; // Wilson upper bound, 0..1
  bucketLabel: string; // human label for the historical bucket used
  proxyLabel: string;
  isProxy: boolean;

  reliability: CalibrationReliability;
  verdict: CalibrationVerdict;
  headline: string;
  detail: string;
  actionRead: string;

  /**
   * Scenario probability blended with history, weighted by sample quality.
   * This is an accountability read, not an official replacement forecast.
   */
  calibratedScore: number;
  notes: string[];
};

const MIN_TRUSTWORTHY_SAMPLES = 12;
const USABLE_SAMPLES = 30;
const STRONG_SAMPLES = 75;
const FULL_WEIGHT_SAMPLES = 100;
const MATERIAL_GAP_POINTS = 8;

const SCENARIO_LABELS: Record<PredictiveScenarioKey, string> = {
  base_pin_magnet: "magnet / range hold",
  bullish_unlock: "bullish unlock",
  bearish_failure: "bearish failure",
  volatility_expansion: "volatility expansion",
};

type RatePick = {
  rate: number | null;
  samples: number;
  bucketLabel: string;
  proxyLabel: string;
  isProxy: boolean;
};

function pickRate(
  scenario: PredictiveScenarioKey,
  summary: EdgeValidationSummary,
): RatePick {
  switch (scenario) {
    case "bullish_unlock":
      return {
        rate: summary.bullishWallMigrationFollowThroughRate,
        samples: summary.bullishWallMigrationFollowThroughSamples,
        bucketLabel: "bullish wall-migration follow-through",
        proxyLabel: "proxy for bullish unlock follow-through",
        isProxy: true,
      };
    case "bearish_failure":
      return {
        rate: summary.bearishWallMigrationFollowThroughRate,
        samples: summary.bearishWallMigrationFollowThroughSamples,
        bucketLabel: "bearish wall-migration follow-through",
        proxyLabel: "proxy for bearish failure follow-through",
        isProxy: true,
      };
    case "base_pin_magnet":
      if (
        summary.compressionRangeHoldRate !== null &&
        summary.compressionRangeHoldSamples > 0
      ) {
        return {
          rate: summary.compressionRangeHoldRate,
          samples: summary.compressionRangeHoldSamples,
          bucketLabel: "compression range hold",
          proxyLabel: "proxy for magnet/range hold",
          isProxy: true,
        };
      }
      return {
        rate: summary.cspZoneHoldRate,
        samples: summary.cspZoneHoldSamples,
        bucketLabel: "CSP zone hold",
        proxyLabel: "fallback proxy for lower-zone hold",
        isProxy: true,
      };
    case "volatility_expansion":
      return {
        rate: summary.compressionExpansionRate,
        samples: summary.compressionExpansionSamples,
        bucketLabel: "compression → expansion",
        proxyLabel: "proxy for volatility expansion",
        isProxy: true,
      };
    default:
      return {
        rate: null,
        samples: 0,
        bucketLabel: "unmapped",
        proxyLabel: "unmapped",
        isProxy: true,
      };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toPct(value: number | null): number | null {
  return value == null || !Number.isFinite(value) ? null : Math.round(value * 100);
}

function reliabilityFromSamples(samples: number): CalibrationReliability {
  if (samples <= 0) return "none";
  if (samples < MIN_TRUSTWORTHY_SAMPLES) return "thin";
  if (samples < USABLE_SAMPLES) return "developing";
  if (samples < STRONG_SAMPLES) return "usable";
  return "strong";
}

function wilsonInterval(rate: number, n: number): { lower: number; upper: number } {
  if (n <= 0 || !Number.isFinite(rate)) return { lower: 0, upper: 1 };
  const z = 1.96;
  const z2 = z * z;
  const p = clamp(rate, 0, 1);
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin =
    (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denom;
  return {
    lower: clamp(center - margin, 0, 1),
    upper: clamp(center + margin, 0, 1),
  };
}

function primaryScenarioProbability(matrix: PredictiveMatrixResult): number {
  const row = matrix.rows.find((item) => item.key === matrix.primaryScenario);
  return clamp(Math.round(row?.probabilityPct ?? matrix.modelScore), 0, 100);
}

function sampleWeight(samples: number, horizonMismatch: boolean): number {
  const raw = clamp(samples / FULL_WEIGHT_SAMPLES, 0, 1);
  // Nearest-horizon proxy is still useful, but should have less authority.
  return horizonMismatch ? raw * 0.65 : raw;
}

function actionReadFor(verdict: CalibrationVerdict): string {
  switch (verdict) {
    case "history_confirms":
      return "History supports this scenario. It can raise confidence, but keep normal risk controls because this is still a proxy calibration.";
    case "history_discounts":
      return "Reduce confidence. The structure may look better than this setup has historically resolved.";
    case "history_neutral":
      return "No meaningful adjustment. Use the official OI forecast with normal sizing.";
    default:
      return "Do not size from calibration yet. Treat this card as data collection until more outcomes resolve.";
  }
}

export function buildForecastCalibration(args: {
  matrix: PredictiveMatrixResult | null;
  validationSummary: EdgeValidationSummary | null;
  horizon: number;
  requestedHorizon?: number;
}): ForecastCalibration | null {
  const matrix = args.matrix;
  if (!matrix) return null;

  const scenario = matrix.primaryScenario;
  const scenarioLabel = SCENARIO_LABELS[scenario] ?? scenario;
  const structuralScore = primaryScenarioProbability(matrix);
  const modelScore = clamp(Math.round(matrix.modelScore), 0, 100);
  const structuralConfidence = matrix.modelConfidence;
  const requestedHorizon = Math.max(1, Math.round(args.requestedHorizon ?? args.horizon));
  const horizon = Math.max(1, Math.round(args.horizon));
  const horizonMismatch = requestedHorizon !== horizon;
  const notes: string[] = [];

  const summary = args.validationSummary;
  const pick = summary
    ? pickRate(scenario, summary)
    : {
        rate: null,
        samples: 0,
        bucketLabel: "no validation data",
        proxyLabel: "no validation data",
        isProxy: true,
      };

  const empiricalRate = pick.rate;
  const empiricalSamples = pick.samples;
  const reliability = reliabilityFromSamples(empiricalSamples);

  if (horizonMismatch) {
    notes.push(
      `Using nearest available ${horizon}D validation as a proxy for requested ${requestedHorizon}D. Add 14D/30D validation before giving this full authority.`,
    );
  }

  if (summary && summary.evaluatedRecords < 10) {
    notes.push(
      `Only ${summary.evaluatedRecords} evaluated surface record${summary.evaluatedRecords === 1 ? "" : "s"} available for this ticker; calibration can be unstable.`,
    );
  }

  if (empiricalRate === null || empiricalSamples <= 0) {
    return {
      ok: true,
      scenario,
      scenarioLabel,
      horizon,
      requestedHorizon,
      horizonMismatch,
      structuralScore,
      modelScore,
      structuralConfidence,
      empiricalRate: null,
      empiricalSamples: 0,
      empiricalLower: null,
      empiricalUpper: null,
      bucketLabel: pick.bucketLabel,
      proxyLabel: pick.proxyLabel,
      isProxy: pick.isProxy,
      reliability: "none",
      verdict: "insufficient_history",
      headline: "No resolved track record yet",
      detail: `The live matrix assigns ${structuralScore}% to ${scenarioLabel}, with model quality ${modelScore}. There are not enough resolved ${pick.bucketLabel} samples to calibrate it yet.`,
      actionRead: actionReadFor("insufficient_history"),
      calibratedScore: structuralScore,
      notes: [
        ...notes,
        "Calibration is display-only until this setup has resolved samples.",
      ],
    };
  }

  const interval = wilsonInterval(empiricalRate, empiricalSamples);
  const empiricalScore = Math.round(empiricalRate * 100);
  const lowerPct = Math.round(interval.lower * 100);
  const upperPct = Math.round(interval.upper * 100);
  const structuralProb = structuralScore / 100;

  const weight = sampleWeight(empiricalSamples, horizonMismatch);
  const calibratedScore = Math.round(
    structuralScore * (1 - weight) + empiricalScore * weight,
  );

  let verdict: CalibrationVerdict = "history_neutral";
  let headline = "Structure and history are broadly aligned";
  let detail = `The live matrix assigns ${structuralScore}% to ${scenarioLabel}. The historical ${pick.bucketLabel} proxy resolved ${empiricalScore}% of the time over ${horizon}D (n=${empiricalSamples}, Wilson range ${lowerPct}%–${upperPct}%).`;

  if (empiricalSamples < MIN_TRUSTWORTHY_SAMPLES) {
    verdict = "insufficient_history";
    headline = "Track record is still thin";
    detail = `${scenarioLabel} has a ${empiricalScore}% ${pick.bucketLabel} proxy rate over ${horizon}D, but only ${empiricalSamples} occurrence${empiricalSamples === 1 ? "" : "s"}. Do not let this override the structure yet.`;
    notes.push(
      `Historical sample (${empiricalSamples}) is below the ${MIN_TRUSTWORTHY_SAMPLES}-sample trust threshold.`,
    );
  } else if (horizonMismatch && empiricalSamples < USABLE_SAMPLES) {
    verdict = "insufficient_history";
    headline = "Proxy horizon is not strong enough yet";
    detail = `The nearest ${horizon}D proxy has ${empiricalSamples} samples, but the live context is ${requestedHorizon}D. Treat this as an early calibration hint, not a verdict.`;
  } else if (interval.upper * 100 + MATERIAL_GAP_POINTS < structuralScore) {
    verdict = "history_discounts";
    headline = "History discounts this setup";
    detail = `The matrix assigns ${structuralScore}% to ${scenarioLabel}, but the ${pick.bucketLabel} proxy has resolved ${empiricalScore}% historically and its Wilson upper band is only ${upperPct}% (n=${empiricalSamples}). The structure may be overstating the setup.`;
  } else if (interval.lower * 100 - MATERIAL_GAP_POINTS > structuralScore) {
    verdict = "history_confirms";
    headline = "History strongly backs this setup";
    detail = `The matrix assigns ${structuralScore}% to ${scenarioLabel}, while the ${pick.bucketLabel} proxy has resolved ${empiricalScore}% historically and its Wilson lower band is ${lowerPct}% (n=${empiricalSamples}). History is stronger than the live structural probability.`;
  } else {
    const rawGap = empiricalScore - structuralScore;
    if (rawGap >= MATERIAL_GAP_POINTS) {
      headline = "History leans supportive, but not decisive";
      detail = `Historical ${pick.bucketLabel} resolved ${empiricalScore}% vs the live ${structuralScore}% read, but the confidence band (${lowerPct}%–${upperPct}%) still overlaps the structure. Treat it as mild support, not confirmation.`;
    } else if (rawGap <= -MATERIAL_GAP_POINTS) {
      headline = "History leans weaker, but not decisive";
      detail = `Historical ${pick.bucketLabel} resolved ${empiricalScore}% vs the live ${structuralScore}% read, but the confidence band (${lowerPct}%–${upperPct}%) still overlaps the structure. Treat it as mild caution, not a full discount.`;
    }
  }

  if (pick.isProxy) {
    notes.push(
      `Empirical rate is a proxy (${pick.proxyLabel}), not an exact scenario match.`,
    );
  }

  if (reliability !== "strong") {
    notes.push(
      `Reliability: ${reliability}. Historical weight in calibrated score: ${Math.round(weight * 100)}%.`,
    );
  }

  return {
    ok: true,
    scenario,
    scenarioLabel,
    horizon,
    requestedHorizon,
    horizonMismatch,
    structuralScore,
    modelScore,
    structuralConfidence,
    empiricalRate,
    empiricalSamples,
    empiricalLower: interval.lower,
    empiricalUpper: interval.upper,
    bucketLabel: pick.bucketLabel,
    proxyLabel: pick.proxyLabel,
    isProxy: pick.isProxy,
    reliability,
    verdict,
    headline,
    detail,
    actionRead: actionReadFor(verdict),
    calibratedScore,
    notes,
  };
}
