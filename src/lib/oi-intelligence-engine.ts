import { ChainRow, ExpirationSummary } from "./types";
import { safeFixed } from "./format";

export type OIAnomaly = {
  type:
    | "deep_itm_call_concentration"
    | "deep_itm_put_concentration"
    | "far_otm_call_lottery"
    | "far_otm_put_crash_hedge"
    | "oi_outlier";
  severity: "low" | "medium" | "high";
  strike: number;
  side: "call" | "put";
  openInterest: number;
  shareEquivalent: number;
  description: string;
  interpretation: string;
  action: string;
};

export type OIIntelligenceReport = {
  activeStructureSummary: string;
  anomalySummary: string;
  adjustedCallWall: number;
  adjustedPutWall: number;
  adjustedCenter: number;
  anomalies: OIAnomaly[];
  intelligenceReadout: string[];
};

function median(values: number[]): number {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function activeRows(rows: ChainRow[], spot: number): ChainRow[] {
  const low = spot * 0.5;
  const high = spot * 1.75;
  return rows.filter((r) => r.strike >= low && r.strike <= high);
}

function largestCallWall(rows: ChainRow[]): number {
  return [...rows].sort((a, b) => b.callOi - a.callOi)[0]?.strike ?? 0;
}

function largestPutWall(rows: ChainRow[]): number {
  return [...rows].sort((a, b) => b.putOi - a.putOi)[0]?.strike ?? 0;
}

function weightedCenter(rows: ChainRow[]): number {
  const total = rows.reduce((s, r) => s + r.callOi + r.putOi, 0);
  if (!total) return 0;

  return (
    rows.reduce((s, r) => s + r.strike * (r.callOi + r.putOi), 0) / total
  );
}

export function analyzeOIIntelligence(args: {
  rows: ChainRow[];
  summary: ExpirationSummary;
  currentPrice: number;
}): OIIntelligenceReport {
  const { rows, summary, currentPrice } = args;

  const callOis = rows.map((r) => r.callOi).filter((v) => v > 0);
  const putOis = rows.map((r) => r.putOi).filter((v) => v > 0);

  const medianCallOi = median(callOis);
  const medianPutOi = median(putOis);

  const anomalies: OIAnomaly[] = [];

  for (const row of rows) {
    const callOutlier =
      medianCallOi > 0 && row.callOi >= medianCallOi * 8 && row.callOi > 5000;

    const putOutlier =
      medianPutOi > 0 && row.putOi >= medianPutOi * 8 && row.putOi > 5000;

    const deepItmCall = row.strike < currentPrice * 0.5 && callOutlier;
    const deepItmPut = row.strike > currentPrice * 1.5 && putOutlier;

    const farOtmCall = row.strike > currentPrice * 1.75 && callOutlier;
    const farOtmPut = row.strike < currentPrice * 0.5 && putOutlier;

    if (deepItmCall) {
      anomalies.push({
        type: "deep_itm_call_concentration",
        severity: row.callOi > medianCallOi * 20 ? "high" : "medium",
        strike: row.strike,
        side: "call",
        openInterest: row.callOi,
        shareEquivalent: row.callOi * 100,
        description: `Large deep-ITM call OI detected at ${row.strike}.`,
        interpretation:
          "This likely behaves closer to synthetic stock exposure than ordinary call-wall resistance.",
        action:
          "Exclude from active resistance calculation, but flag as possible institutional/synthetic exposure."
      });
    }

    if (deepItmPut) {
      anomalies.push({
        type: "deep_itm_put_concentration",
        severity: row.putOi > medianPutOi * 20 ? "high" : "medium",
        strike: row.strike,
        side: "put",
        openInterest: row.putOi,
        shareEquivalent: row.putOi * 100,
        description: `Large deep-ITM put OI detected at ${row.strike}.`,
        interpretation:
          "This may represent synthetic short exposure, hedge structure, or institutional positioning.",
        action:
          "Exclude from active support calculation, but flag as directional hedge exposure."
      });
    }

    if (farOtmCall) {
      anomalies.push({
        type: "far_otm_call_lottery",
        severity: "medium",
        strike: row.strike,
        side: "call",
        openInterest: row.callOi,
        shareEquivalent: row.callOi * 100,
        description: `Large far-OTM call OI detected at ${row.strike}.`,
        interpretation:
          "This may represent upside speculation, event positioning, or low-probability convexity demand.",
        action:
          "Do not treat as near-term resistance unless price approaches this zone."
      });
    }

    if (farOtmPut) {
      anomalies.push({
        type: "far_otm_put_crash_hedge",
        severity: "medium",
        strike: row.strike,
        side: "put",
        openInterest: row.putOi,
        shareEquivalent: row.putOi * 100,
        description: `Large far-OTM put OI detected at ${row.strike}.`,
        interpretation:
          "This may represent crash hedge demand or institutional tail-risk protection.",
        action:
          "Track separately as tail-risk structure, not ordinary support."
      });
    }
  }

  const active = activeRows(rows, currentPrice);
  const adjustedCallWall = largestCallWall(active);
  const adjustedPutWall = largestPutWall(active);
  const adjustedCenter = weightedCenter(active) || summary.combinedCenter;

  const intelligenceReadout: string[] = [];

  if (anomalies.length) {
    intelligenceReadout.push(
      `${anomalies.length} OI anomaly/anomalies detected outside normal active structure.`
    );
  } else {
    intelligenceReadout.push("No major OI anomalies detected outside active structure.");
  }

  if (adjustedCallWall !== summary.callWall) {
    intelligenceReadout.push(
      `Raw call wall ${summary.callWall.toFixed(2)} differs from adjusted active call wall ${adjustedCallWall.toFixed(2)}; raw wall may be distorted by deep ITM or far OTM OI.`
    );
  }

  if (adjustedPutWall !== summary.putWall) {
    intelligenceReadout.push(
      `Raw put wall ${summary.putWall.toFixed(2)} differs from adjusted active put wall ${adjustedPutWall.toFixed(2)}; raw wall may be distorted by non-active structure.`
    );
  }

  intelligenceReadout.push(
    `Adjusted active center is ${adjustedCenter.toFixed(2)}, compared with raw center ${summary.combinedCenter.toFixed(2)}.`
  );

  return {
    activeStructureSummary: `Active structure uses strikes from ${(currentPrice * 0.5).toFixed(2)} to ${(currentPrice * 1.75).toFixed(2)}.`,
    anomalySummary: anomalies.length
      ? "Anomalies detected. Raw OI should be separated from active trading structure."
      : "No major anomaly adjustment required.",
    adjustedCallWall,
    adjustedPutWall,
    adjustedCenter,
    anomalies,
    intelligenceReadout
  };
}