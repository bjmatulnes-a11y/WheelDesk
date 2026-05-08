import {
  ChainRow,
  ChainSnapshotEntry,
  SnapshotComparison,
  SnapshotComparisonResult,
  SupportedTicker
} from "./types";
import { interpretStructure } from "./structure-interpretation";
import { deriveTacticalDecision } from "./tactical-decision";
import { buildExecutionPlan } from "./execution-engine";

const NEUTRAL_POSITION_CONTEXT = {
  shares: 0,
  shortCallStrike: 0,
  shortCallDte: 0,
  cashAvailable: 0
};

function mapRows(rows: ChainRow[]): Map<number, ChainRow> {
  return new Map(rows.map((row) => [row.strike, row]));
}

function strikeDeltas(
  currentRows: ChainRow[],
  priorRows: ChainRow[],
  side: "callOi" | "putOi"
): Array<{ strike: number; delta: number }> {
  const prior = mapRows(priorRows);

  return currentRows
    .map((row) => ({
      strike: row.strike,
      delta: (row[side] ?? 0) - (prior.get(row.strike)?.[side] ?? 0)
    }))
    .sort((a, b) => a.strike - b.strike);
}

function topMoves(deltas: Array<{ strike: number; delta: number }>) {
  return {
    increases: deltas
      .filter((d) => d.delta > 0)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 3),

    decreases: deltas
      .filter((d) => d.delta < 0)
      .sort((a, b) => a.delta - b.delta)
      .slice(0, 3)
  };
}

function nearestByDate(
  targetExpiration: string,
  chains: ChainSnapshotEntry[]
): ChainSnapshotEntry | undefined {
  const targetTs = new Date(`${targetExpiration}T00:00:00Z`).getTime();
  if (!Number.isFinite(targetTs)) return undefined;

  return [...chains]
    .map((c) => ({
      chain: c,
      diff: Math.abs(new Date(`${c.expiration}T00:00:00Z`).getTime() - targetTs)
    }))
    .sort((a, b) => a.diff - b.diff)[0]?.chain;
}

function choosePriorChain(
  selectedExpiration: string,
  compareDateSnapshots: ChainSnapshotEntry[]
): {
  chain?: ChainSnapshotEntry;
  matchType?: SnapshotComparison["comparisonMatchType"];
} {
  const exact = compareDateSnapshots.find((c) => c.expiration === selectedExpiration);
  if (exact) return { chain: exact, matchType: "exact" };

  const fallback = nearestByDate(selectedExpiration, compareDateSnapshots);
  if (fallback) return { chain: fallback, matchType: "fallback_nearest_expiration" };

  return {};
}

function concentrationAround(
  strike: number,
  rows: ChainRow[],
  side: "callOi" | "putOi"
): number {
  return rows
    .filter((r) => Math.abs(r.strike - strike) <= 5)
    .reduce((sum, r) => sum + (r[side] ?? 0), 0);
}

function nearPriceOi(currentPrice: number, rows: ChainRow[]): number {
  return rows
    .filter((r) => Math.abs(r.strike - currentPrice) / Math.max(currentPrice, 0.01) <= 0.03)
    .reduce((sum, r) => sum + r.callOi + r.putOi, 0);
}

export function buildSnapshotComparison(args: {
  ticker: SupportedTicker;
  snapshots: ChainSnapshotEntry[];
  primarySnapshotDate: string;
  compareSnapshotDate: string;
  selectedExpiration: string;
  currentPrice: number;
}): SnapshotComparisonResult {
  const {
    ticker,
    snapshots,
    primarySnapshotDate,
    compareSnapshotDate,
    selectedExpiration,
    currentPrice
  } = args;

  if (!snapshots.length) {
    return {
      comparison: null,
      reason: "no_prior_snapshots_for_ticker",
      message: `No snapshots saved for ${ticker}.`
    };
  }

  const uniqueDates = [...new Set(snapshots.map((s) => s.snapshotDate))].sort((a, b) =>
    b.localeCompare(a)
  );

  if (uniqueDates.length === 1) {
    return {
      comparison: null,
      reason: "only_one_snapshot_exists",
      message: `Only one snapshot exists for ${ticker}; save another date to compare.`
    };
  }

  const primaryDate = uniqueDates.find((d) => d === primarySnapshotDate) ?? uniqueDates[0];

  const effectiveCompareDate =
    compareSnapshotDate ||
    uniqueDates.find((d) => d < primaryDate) ||
    "";

  if (!effectiveCompareDate) {
    return {
      comparison: null,
      reason: "no_prior_snapshots_for_ticker",
      message: "No prior snapshot date available for comparison."
    };
  }

  const primaryChain = snapshots.find(
    (s) => s.snapshotDate === primaryDate && s.expiration === selectedExpiration
  );

  if (!primaryChain) {
    return {
      comparison: null,
      reason: "incomplete_snapshot_data",
      message: `Selected expiration ${selectedExpiration} not present in primary snapshot.`
    };
  }

  const compareDateChains = snapshots.filter((s) => s.snapshotDate === effectiveCompareDate);
  const priorChoice = choosePriorChain(selectedExpiration, compareDateChains);

  if (!priorChoice.chain || !priorChoice.matchType) {
    return {
      comparison: null,
      reason: "no_matching_expiration_chain",
      message: `No comparable expiration chain found in compare snapshot (${effectiveCompareDate}).`
    };
  }

  const priorChain = priorChoice.chain;

  const callOiDeltaByStrike = strikeDeltas(primaryChain.rows, priorChain.rows, "callOi");
  const putOiDeltaByStrike = strikeDeltas(primaryChain.rows, priorChain.rows, "putOi");

  const callTop = topMoves(callOiDeltaByStrike);
  const putTop = topMoves(putOiDeltaByStrike);

  const currentRangeWidth = primaryChain.summary.upperRange - primaryChain.summary.lowerRange;
  const priorRangeWidth = priorChain.summary.upperRange - priorChain.summary.lowerRange;

  const supportConcentrationDelta =
    concentrationAround(primaryChain.summary.putWall, primaryChain.rows, "putOi") -
    concentrationAround(priorChain.summary.putWall, priorChain.rows, "putOi");

  const resistanceConcentrationDelta =
    concentrationAround(primaryChain.summary.callWall, primaryChain.rows, "callOi") -
    concentrationAround(priorChain.summary.callWall, priorChain.rows, "callOi");

  const nearPriceOiDelta =
    nearPriceOi(currentPrice, primaryChain.rows) -
    nearPriceOi(currentPrice, priorChain.rows);

  const interpretation = interpretStructure({
    oiCenterDelta: primaryChain.summary.combinedCenter - priorChain.summary.combinedCenter,
    callWeightedStrikeDelta:
      primaryChain.summary.callWeightedStrike - priorChain.summary.callWeightedStrike,
    putWeightedStrikeDelta:
      primaryChain.summary.putWeightedStrike - priorChain.summary.putWeightedStrike,
    callWallDelta: primaryChain.summary.callWall - priorChain.summary.callWall,
    putWallDelta: primaryChain.summary.putWall - priorChain.summary.putWall,
    oiRangeWidthDelta: currentRangeWidth - priorRangeWidth,
    supportConcentrationDelta,
    resistanceConcentrationDelta,
    nearPriceOiDelta,
    currentPrice
  });

  /**
   * Snapshot comparison is now structure-only.
   * We keep a neutral context here only because downstream tactical/execution helpers
   * still expect these fields. Do not use dashboard position inputs anymore.
   */
  const tacticalDecision = deriveTacticalDecision({
    structuralDirection: interpretation.structuralDirection,
    supportState: interpretation.supportState,
    resistanceState: interpretation.resistanceState,
    structuralState: interpretation.structuralState,
    overallBias: interpretation.overallBias,
    currentPrice,
    oiCenter: primaryChain.summary.combinedCenter,
    oiLowerRange: primaryChain.summary.lowerRange,
    oiUpperRange: primaryChain.summary.upperRange,
    callWall: primaryChain.summary.callWall,
    putWall: primaryChain.summary.putWall,
    shares: NEUTRAL_POSITION_CONTEXT.shares,
    shortCallStrike: NEUTRAL_POSITION_CONTEXT.shortCallStrike,
    shortCallDte: NEUTRAL_POSITION_CONTEXT.shortCallDte,
    cashAvailable: NEUTRAL_POSITION_CONTEXT.cashAvailable
  });

  const executionPlan = buildExecutionPlan({
    tacticalDecision,
    structure: interpretation,
    currentPrice,
    oiCenter: primaryChain.summary.combinedCenter,
    oiLowerRange: primaryChain.summary.lowerRange,
    oiUpperRange: primaryChain.summary.upperRange,
    callWall: primaryChain.summary.callWall,
    putWall: primaryChain.summary.putWall,
    position: NEUTRAL_POSITION_CONTEXT
  });

  const comparison: SnapshotComparison = {
    ticker,
    currentSnapshotDate: primaryDate,
    priorSnapshotDate: effectiveCompareDate,
    selectedExpiration,
    currentExpirationUsed: primaryChain.expiration,
    priorExpirationUsed: priorChain.expiration,
    comparisonMatchType: priorChoice.matchType,
    comparisonNotes:
      priorChoice.matchType === "exact"
        ? "Exact expiration match used."
        : "Fallback used: nearest prior expiration was selected.",

    totalCallOiDelta: primaryChain.summary.totalCallOi - priorChain.summary.totalCallOi,
    totalPutOiDelta: primaryChain.summary.totalPutOi - priorChain.summary.totalPutOi,
    callWeightedStrikeDelta:
      primaryChain.summary.callWeightedStrike - priorChain.summary.callWeightedStrike,
    putWeightedStrikeDelta:
      primaryChain.summary.putWeightedStrike - priorChain.summary.putWeightedStrike,
    oiCenterDelta: primaryChain.summary.combinedCenter - priorChain.summary.combinedCenter,
    lowerRangeDelta: primaryChain.summary.lowerRange - priorChain.summary.lowerRange,
    upperRangeDelta: primaryChain.summary.upperRange - priorChain.summary.upperRange,
    callWallDelta: primaryChain.summary.callWall - priorChain.summary.callWall,
    putWallDelta: primaryChain.summary.putWall - priorChain.summary.putWall,
    oiRangeWidthDelta: currentRangeWidth - priorRangeWidth,

    callOiDeltaByStrike,
    putOiDeltaByStrike,
    topCallOiIncreases: callTop.increases,
    topCallOiDecreases: callTop.decreases,
    topPutOiIncreases: putTop.increases,
    topPutOiDecreases: putTop.decreases,

    interpretation,
    tacticalDecision,
    executionPlan
  };

  return {
    comparison,
    reason: "ok",
    message:
      priorChoice.matchType === "exact"
        ? "Comparison ready (exact expiration match)."
        : "Comparison ready (nearest expiration fallback used)."
  };
}