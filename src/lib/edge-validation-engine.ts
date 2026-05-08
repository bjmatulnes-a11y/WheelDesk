import {
  type CandleRecord,
  type OptionSurfaceSnapshot,
  normalizeTicker,
  type EdgeProofSummary,
} from "./wheeldesk-storage";
import {
  buildTraderEdgeSummary,
  type ActionBucket,
  type TraderEdgeSummary,
} from "./trader-edge-engine";
import {
  buildWallMigrationSummary,
  type WallMigrationSummary,
} from "./oi-wall-migration-engine";

export type EdgeValidationHorizon = 1 | 3 | 5 | 10;

export type EdgeValidationOutcome = {
  horizonDays: EdgeValidationHorizon;
  evaluated: boolean;
  endDate: string | null;
  startClose: number;
  finalClose: number | null;
  maxHigh: number | null;
  minLow: number | null;
  closeReturnPct: number | null;
  maxUpsidePct: number | null;
  maxDownsidePct: number | null;

  supportHeld: boolean | null;
  resistanceHeld: boolean | null;
  magnetTouched: boolean | null;
  bullishUnlockHit: boolean | null;
  bearishFailureHit: boolean | null;
  cspZoneHeld: boolean | null;
  coveredCallZoneHeld: boolean | null;
  rangeExpanded: boolean | null;
  rangeHeld: boolean | null;

  labelValidated: boolean | null;
  outcomeLabel: string;
  notes: string[];
  isPartialHorizon?: boolean;
  observedDays?: number;
};

export type EdgeValidationRecord = {
  id: string;
  ticker: string;
  /** Actual saved surface date selected for this proof record. */
  snapshotDate: string;
  /** Trading-session date used as the proof start. Weekend/non-trading saves roll back to the prior market candle. */
  marketSessionDate: string;
  /** All saved surface dates that collapsed into this same market session. */
  sourceSnapshotDates: string[];
  duplicateSaveCount: number;
  surface: OptionSurfaceSnapshot;
  edge: TraderEdgeSummary;
  wallMigration: WallMigrationSummary | null;
  horizons: EdgeValidationOutcome[];
};

export type BucketProof = {
  bucket: ActionBucket | "ALL";
  total: number;
  evaluated: number;
  validated: number;
  validationRate: number | null;
};

export type EdgeValidationSummary = {
  totalRecords: number;
  evaluatedRecords: number;
  bucketProof: BucketProof[];
  cspZoneHoldRate: number | null;
  cspZoneHoldSamples: number;
  coveredCallZoneHoldRate: number | null;
  coveredCallZoneHoldSamples: number;
  compressionExpansionRate: number | null;
  compressionExpansionSamples: number;
  compressionRangeHoldRate: number | null;
  compressionRangeHoldSamples: number;
  coveredCallTrapBreachRate: number | null;
  coveredCallTrapBreachSamples: number;
  cspTrapFailureRate: number | null;
  cspTrapFailureSamples: number;
  bullishWallMigrationFollowThroughRate: number | null;
  bullishWallMigrationFollowThroughSamples: number;
  bearishWallMigrationFollowThroughRate: number | null;
  bearishWallMigrationFollowThroughSamples: number;
  lowEdgeWaitValidationRate: number | null;
  lowEdgeWaitValidationSamples: number;
};

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pctChange(current: number, prior: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(prior) || prior === 0)
    return null;
  return ((current - prior) / prior) * 100;
}

function robustDateKey(value: unknown): string {
  if (value == null) return "";

  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    const parsed = new Date(milliseconds);
    return Number.isNaN(parsed.getTime())
      ? ""
      : parsed.toISOString().slice(0, 10);
  }

  const raw = String(value).trim();
  if (!raw) return "";

  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
      const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
      const parsed = new Date(milliseconds);
      return Number.isNaN(parsed.getTime())
        ? ""
        : parsed.toISOString().slice(0, 10);
    }
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return raw.slice(0, 10);
}

function getCandleDate(candle: CandleRecord): string {
  return robustDateKey(candle.date);
}

function sortCandles(candles: CandleRecord[]): CandleRecord[] {
  return [...candles]
    .filter(
      (candle) =>
        robustDateKey(candle.date) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close),
    )
    .sort((a, b) => getCandleDate(a).localeCompare(getCandleDate(b)));
}

function candlesThroughDate(
  candles: CandleRecord[],
  snapshotDate: string,
): CandleRecord[] {
  const key = robustDateKey(snapshotDate);
  return sortCandles(candles).filter((candle) => getCandleDate(candle) <= key);
}

function futureCandlesAfterDate(
  candles: CandleRecord[],
  snapshotDate: string,
  horizonDays: number,
): CandleRecord[] {
  const key = robustDateKey(snapshotDate);
  return sortCandles(candles)
    .filter((candle) => getCandleDate(candle) > key)
    .slice(0, horizonDays);
}

function isWeekendDate(date: string): boolean {
  const key = robustDateKey(date);
  if (!key) return false;
  const day = new Date(`${key}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function hasCandleOnDate(candles: CandleRecord[], date: string): boolean {
  const key = robustDateKey(date);
  return sortCandles(candles).some((candle) => getCandleDate(candle) === key);
}

function latestCandleDateOnOrBefore(
  candles: CandleRecord[],
  date: string,
): string | null {
  const key = robustDateKey(date);
  const prior = sortCandles(candles)
    .map((candle) => getCandleDate(candle))
    .filter((candleDate) => candleDate && candleDate <= key);
  return prior.at(-1) ?? null;
}

function getProofStartDate(
  candles: CandleRecord[],
  snapshotDate: string,
): string {
  const key = robustDateKey(snapshotDate);
  if (!key) return snapshotDate;

  // If the surface was saved on a weekend/non-trading day, it represents the
  // prior completed market session. Do not require a candle on the weekend date.
  if (isWeekendDate(key) && !hasCandleOnDate(candles, key)) {
    return latestCandleDateOnOrBefore(candles, key) ?? key;
  }

  // For weekday/intraday saves, keep the actual snapshot date even if today's
  // daily candle is not available yet. That lets validation wait for the next
  // true future candle instead of incorrectly rolling the record back.
  return key;
}

function chooseRepresentativeSurface(
  surfaces: OptionSurfaceSnapshot[],
): OptionSurfaceSnapshot {
  return (
    [...surfaces]
      .sort((a, b) =>
        robustDateKey(a.snapshotDate).localeCompare(
          robustDateKey(b.snapshotDate),
        ),
      )
      .at(-1) ?? surfaces[0]
  );
}

function touchedLevel(
  low: number | null,
  high: number | null,
  level: number | null,
): boolean | null {
  if (low == null || high == null || level == null) return null;
  return low <= level && high >= level;
}

function buildOutcomeLabel(outcome: EdgeValidationOutcome): string {
  if (!outcome.evaluated) return "Not enough future candles";
  if (outcome.bullishUnlockHit) return "Bullish unlock hit";
  if (outcome.bearishFailureHit) return "Bearish failure hit";
  if (outcome.magnetTouched) return "Magnet touched";
  if (outcome.rangeHeld) return "Range held";
  if (outcome.rangeExpanded) return "Range expanded";
  return "Mixed / no clean outcome";
}

function validateLabel(args: {
  edge: TraderEdgeSummary;
  outcome: Omit<
    EdgeValidationOutcome,
    "labelValidated" | "outcomeLabel" | "notes"
  >;
}): { labelValidated: boolean | null; notes: string[] } {
  const { edge, outcome } = args;
  const notes: string[] = [];

  if (!outcome.evaluated)
    return {
      labelValidated: null,
      notes: ["Not enough future candles to validate this horizon."],
    };

  const bucket = edge.actionBucket;
  const closeReturnAbs =
    outcome.closeReturnPct == null ? null : Math.abs(outcome.closeReturnPct);

  if (bucket === "Best CSP setup") {
    const ok =
      outcome.cspZoneHeld === true && outcome.bearishFailureHit !== true;
    notes.push(
      ok
        ? "Suggested CSP zone stayed structurally intact."
        : "CSP setup was threatened or failed below the put/failure zone.",
    );
    return { labelValidated: ok, notes };
  }

  if (bucket === "Best covered-call setup") {
    const ok =
      outcome.coveredCallZoneHeld === true && outcome.bullishUnlockHit !== true;
    notes.push(
      ok
        ? "Covered-call zone stayed structurally intact."
        : "Covered-call setup was threatened by upside unlock / call-wall breach.",
    );
    return { labelValidated: ok, notes };
  }

  if (bucket === "Wheel candidate") {
    const ok =
      outcome.cspZoneHeld === true && outcome.coveredCallZoneHeld === true;
    notes.push(
      ok
        ? "Both snapped wheel zones stayed outside the realized path."
        : "At least one snapped wheel zone was tested or breached.",
    );
    return { labelValidated: ok, notes };
  }

  if (bucket === "Compression coil") {
    const ok = outcome.rangeExpanded === true || outcome.rangeHeld === true;
    notes.push(
      outcome.rangeExpanded
        ? "Compression produced expansion; waiting for trigger/outer strikes was justified."
        : outcome.rangeHeld
          ? "Compression held as pin/chop; selling only outside the range was justified."
          : "Compression label did not resolve clearly.",
    );
    return { labelValidated: ok, notes };
  }

  if (bucket === "Conflict / wait") {
    const ok =
      outcome.rangeExpanded === true ||
      (closeReturnAbs != null && closeReturnAbs <= 2.5);
    notes.push(
      ok
        ? "Wait label was justified by either chop or a decisive break requirement."
        : "Conflict label did not clearly justify waiting over directional action.",
    );
    return { labelValidated: ok, notes };
  }

  if (bucket === "Premium trap / avoid") {
    const ok =
      outcome.bullishUnlockHit === true ||
      outcome.bearishFailureHit === true ||
      outcome.rangeExpanded === true;
    notes.push(
      ok
        ? "Trap/avoid label was confirmed by a wall break or range expansion."
        : "Trap did not trigger during this horizon.",
    );
    return { labelValidated: ok, notes };
  }

  if (bucket === "Low-edge / wait") {
    const ok =
      (closeReturnAbs != null && closeReturnAbs <= 3) ||
      outcome.rangeHeld === true;
    notes.push(
      ok
        ? "Low-edge/wait avoided a low-quality or range-bound setup."
        : "Low-edge label may have missed a directional opportunity.",
    );
    return { labelValidated: ok, notes };
  }

  return {
    labelValidated: null,
    notes: ["No validation rule for this action bucket."],
  };
}

function evaluateHorizon(args: {
  edge: TraderEdgeSummary;
  snapshotDate: string;
  candles: CandleRecord[];
  horizonDays: EdgeValidationHorizon;
}): EdgeValidationOutcome {
  const future = futureCandlesAfterDate(
    args.candles,
    args.snapshotDate,
    args.horizonDays,
  );
  const startClose = args.edge.analysisPrice;

  if (!startClose || future.length === 0) {
    const base = {
      horizonDays: args.horizonDays,
      evaluated: false,
      endDate: future.at(-1)?.date ?? null,
      startClose,
      finalClose: future.at(-1)?.close ?? null,
      maxHigh: null,
      minLow: null,
      closeReturnPct: null,
      maxUpsidePct: null,
      maxDownsidePct: null,
      supportHeld: null,
      resistanceHeld: null,
      magnetTouched: null,
      bullishUnlockHit: null,
      bearishFailureHit: null,
      cspZoneHeld: null,
      coveredCallZoneHeld: null,
      rangeExpanded: null,
      rangeHeld: null,
      isPartialHorizon: false,
      observedDays: future.length,
    } satisfies Omit<
      EdgeValidationOutcome,
      "labelValidated" | "outcomeLabel" | "notes"
    >;

    return {
      ...base,
      labelValidated: null,
      outcomeLabel: "Waiting for future candles",
      notes: ["Need at least one future candle after the snapshot date."],
    };
  }

  const isPartialHorizon = future.length < args.horizonDays;

  const highs = future.map((candle) => candle.high).filter(Number.isFinite);
  const lows = future.map((candle) => candle.low).filter(Number.isFinite);
  const finalClose = future.at(-1)?.close ?? null;
  const maxHigh = highs.length ? Math.max(...highs) : null;
  const minLow = lows.length ? Math.min(...lows) : null;
  const closeReturnPct =
    finalClose != null ? pctChange(finalClose, startClose) : null;
  const maxUpsidePct = maxHigh != null ? pctChange(maxHigh, startClose) : null;
  const maxDownsidePct = minLow != null ? pctChange(minLow, startClose) : null;

  const bufferPct = Math.max(
    0.25,
    Math.min(1.25, (args.edge.atrPct ?? 2.5) * 0.25),
  );
  const triggerBuffer = startClose * (bufferPct / 100);
  const bullishUnlockLevel =
    args.edge.resistance != null ? args.edge.resistance + triggerBuffer : null;
  const bearishFailureLevel =
    args.edge.support != null ? args.edge.support - triggerBuffer : null;

  const supportHeld =
    args.edge.support == null || minLow == null
      ? null
      : minLow >= args.edge.support;
  const resistanceHeld =
    args.edge.resistance == null || maxHigh == null
      ? null
      : maxHigh <= args.edge.resistance;
  const magnetTouched = touchedLevel(minLow, maxHigh, args.edge.magnet);
  const bullishUnlockHit =
    bullishUnlockLevel == null || maxHigh == null
      ? null
      : maxHigh >= bullishUnlockLevel;
  const bearishFailureHit =
    bearishFailureLevel == null || minLow == null
      ? null
      : minLow <= bearishFailureLevel;
  const cspZoneHeld =
    args.edge.executableCspCeiling == null || minLow == null
      ? null
      : minLow >= args.edge.executableCspCeiling;
  const coveredCallZoneHeld =
    args.edge.executableCoveredCallFloor == null || maxHigh == null
      ? null
      : maxHigh <= args.edge.executableCoveredCallFloor;
  const rangeExpanded = bullishUnlockHit === true || bearishFailureHit === true;
  const rangeHeld = supportHeld === true && resistanceHeld === true;

  const base = {
    horizonDays: args.horizonDays,
    evaluated: true,
    endDate: future.at(-1)?.date ?? null,
    startClose,
    finalClose,
    maxHigh,
    minLow,
    closeReturnPct,
    maxUpsidePct,
    maxDownsidePct,
    supportHeld,
    resistanceHeld,
    magnetTouched,
    bullishUnlockHit,
    bearishFailureHit,
    cspZoneHeld,
    coveredCallZoneHeld,
    rangeExpanded,
    rangeHeld,
    isPartialHorizon,
    observedDays: future.length,
  } satisfies Omit<
    EdgeValidationOutcome,
    "labelValidated" | "outcomeLabel" | "notes"
  >;

  const label = validateLabel({ edge: args.edge, outcome: base });
  const partialNote = isPartialHorizon
    ? [
        `Provisional: only ${future.length} of ${args.horizonDays} requested future trading days are available.`,
      ]
    : [];

  return {
    ...base,
    labelValidated: label.labelValidated,
    outcomeLabel: isPartialHorizon
      ? `Provisional ${buildOutcomeLabel({ ...base, labelValidated: label.labelValidated, notes: [], outcomeLabel: "" })}`
      : buildOutcomeLabel({
          ...base,
          labelValidated: label.labelValidated,
          notes: [],
          outcomeLabel: "",
        }),
    notes: [...partialNote, ...label.notes],
  };
}

export function buildEdgeValidationRecords(args: {
  ticker: string;
  surfaces: OptionSurfaceSnapshot[];
  candles: CandleRecord[];
  horizons?: EdgeValidationHorizon[];
}): EdgeValidationRecord[] {
  const ticker = normalizeTicker(args.ticker);
  const horizons = args.horizons ?? [1, 3, 5, 10];
  const sortedCandles = sortCandles(args.candles);

  const tickerSurfaces = [...args.surfaces]
    .filter((surface) => normalizeTicker(surface.ticker) === ticker)
    .sort((a, b) =>
      robustDateKey(a.snapshotDate).localeCompare(
        robustDateKey(b.snapshotDate),
      ),
    );

  // Daily OI proof is market-session based, not calendar-save based.
  // Example: Friday 05/01 plus weekend saves 05/02 and 05/03 are one market
  // session for validation. Monday 05/04 is a separate session and waits for
  // Tuesday's candle.
  const groups = new Map<string, OptionSurfaceSnapshot[]>();
  for (const surface of tickerSurfaces) {
    const snapshotDate = robustDateKey(surface.snapshotDate);
    const proofStartDate = getProofStartDate(sortedCandles, snapshotDate);
    const existing = groups.get(proofStartDate) ?? [];
    existing.push(surface);
    groups.set(proofStartDate, existing);
  }

  const proofGroups = Array.from(groups.entries())
    .map(([marketSessionDate, surfaces]) => ({
      marketSessionDate,
      surfaces: surfaces.sort((a, b) =>
        robustDateKey(a.snapshotDate).localeCompare(
          robustDateKey(b.snapshotDate),
        ),
      ),
      surface: chooseRepresentativeSurface(surfaces),
      sourceSnapshotDates: Array.from(
        new Set(surfaces.map((surface) => robustDateKey(surface.snapshotDate))),
      ).sort(),
    }))
    .sort((a, b) => a.marketSessionDate.localeCompare(b.marketSessionDate));

  return proofGroups.map((group) => {
    const surface = group.surface;
    const snapshotDate = robustDateKey(surface.snapshotDate);
    const proofStartDate = group.marketSessionDate;
    const candlesAtSnapshot = candlesThroughDate(sortedCandles, proofStartDate);
    const edge = buildTraderEdgeSummary({
      ticker,
      surface,
      candles: candlesAtSnapshot,
      livePrice: candlesAtSnapshot.at(-1)?.close ?? null,
    });

    const priorGroup = proofGroups
      .filter((candidate) => candidate.marketSessionDate < proofStartDate)
      .at(-1);
    const wallMigration = buildWallMigrationSummary({
      currentSurface: surface,
      priorSurface: priorGroup?.surface ?? null,
    });

    return {
      id: `${ticker}-${proofStartDate}`,
      ticker,
      snapshotDate,
      marketSessionDate: proofStartDate,
      sourceSnapshotDates: group.sourceSnapshotDates,
      duplicateSaveCount: Math.max(0, group.sourceSnapshotDates.length - 1),
      surface,
      edge,
      wallMigration,
      horizons: horizons.map((horizonDays) =>
        evaluateHorizon({
          edge,
          snapshotDate: proofStartDate,
          candles: sortedCandles,
          horizonDays,
        }),
      ),
    };
  });
}

function rate(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return numerator / denominator;
}

function summarizeBucket(
  records: EdgeValidationRecord[],
  bucket: ActionBucket | "ALL",
  horizon: EdgeValidationHorizon,
): BucketProof {
  const selected =
    bucket === "ALL"
      ? records
      : records.filter((record) => record.edge.actionBucket === bucket);
  const outcomes = selected
    .map((record) =>
      record.horizons.find((item) => item.horizonDays === horizon),
    )
    .filter((outcome): outcome is EdgeValidationOutcome => Boolean(outcome));
  const evaluated = outcomes.filter(
    (outcome) => outcome.evaluated && outcome.labelValidated != null,
  );
  const validated = evaluated.filter(
    (outcome) => outcome.labelValidated === true,
  );

  return {
    bucket,
    total: selected.length,
    evaluated: evaluated.length,
    validated: validated.length,
    validationRate: rate(validated.length, evaluated.length),
  };
}

export function summarizeEdgeValidation(
  records: EdgeValidationRecord[],
  horizon: EdgeValidationHorizon,
): EdgeValidationSummary {
  const outcomes = records
    .map((record) => ({
      record,
      outcome: record.horizons.find((item) => item.horizonDays === horizon),
    }))
    .filter(
      (
        item,
      ): item is {
        record: EdgeValidationRecord;
        outcome: EdgeValidationOutcome;
      } => Boolean(item.outcome),
    );
  const evaluated = outcomes.filter((item) => item.outcome.evaluated);

  const bucketList: (ActionBucket | "ALL")[] = [
    "ALL",
    "Best CSP setup",
    "Best covered-call setup",
    "Wheel candidate",
    "Compression coil",
    "Conflict / wait",
    "Premium trap / avoid",
    "Low-edge / wait",
  ];

  const cspCandidates = evaluated.filter(
    (item) => item.record.edge.executableCspCeiling != null,
  );
  const ccCandidates = evaluated.filter(
    (item) => item.record.edge.executableCoveredCallFloor != null,
  );
  const compressionRows = evaluated.filter(
    (item) => item.record.edge.actionBucket === "Compression coil",
  );
  const ccTrapRows = evaluated.filter((item) =>
    item.record.edge.trapNotes.some((note) =>
      note.toLowerCase().includes("covered-call trap"),
    ),
  );
  const cspTrapRows = evaluated.filter((item) =>
    item.record.edge.trapNotes.some((note) =>
      note.toLowerCase().includes("csp trap"),
    ),
  );
  const bullishMigrationRows = evaluated.filter(
    (item) => item.record.wallMigration?.migrationBias === "bullish",
  );
  const bearishMigrationRows = evaluated.filter(
    (item) => item.record.wallMigration?.migrationBias === "bearish",
  );
  const lowEdgeRows = evaluated.filter(
    (item) => item.record.edge.actionBucket === "Low-edge / wait",
  );

  return {
    totalRecords: records.length,
    evaluatedRecords: evaluated.length,
    bucketProof: bucketList.map((bucket) =>
      summarizeBucket(records, bucket, horizon),
    ),
    cspZoneHoldRate: rate(
      cspCandidates.filter((item) => item.outcome.cspZoneHeld === true).length,
      cspCandidates.length,
    ),
    cspZoneHoldSamples: cspCandidates.length,
    coveredCallZoneHoldRate: rate(
      ccCandidates.filter((item) => item.outcome.coveredCallZoneHeld === true)
        .length,
      ccCandidates.length,
    ),
    coveredCallZoneHoldSamples: ccCandidates.length,
    compressionExpansionRate: rate(
      compressionRows.filter((item) => item.outcome.rangeExpanded === true)
        .length,
      compressionRows.length,
    ),
    compressionExpansionSamples: compressionRows.length,
    compressionRangeHoldRate: rate(
      compressionRows.filter((item) => item.outcome.rangeHeld === true).length,
      compressionRows.length,
    ),
    compressionRangeHoldSamples: compressionRows.length,
    coveredCallTrapBreachRate: rate(
      ccTrapRows.filter(
        (item) =>
          item.outcome.bullishUnlockHit === true ||
          item.outcome.resistanceHeld === false,
      ).length,
      ccTrapRows.length,
    ),
    coveredCallTrapBreachSamples: ccTrapRows.length,
    cspTrapFailureRate: rate(
      cspTrapRows.filter(
        (item) =>
          item.outcome.bearishFailureHit === true ||
          item.outcome.supportHeld === false,
      ).length,
      cspTrapRows.length,
    ),
    cspTrapFailureSamples: cspTrapRows.length,
    bullishWallMigrationFollowThroughRate: rate(
      bullishMigrationRows.filter(
        (item) =>
          (item.outcome.closeReturnPct ?? 0) > 0 ||
          item.outcome.bullishUnlockHit === true,
      ).length,
      bullishMigrationRows.length,
    ),
    bullishWallMigrationFollowThroughSamples: bullishMigrationRows.length,
    bearishWallMigrationFollowThroughRate: rate(
      bearishMigrationRows.filter(
        (item) =>
          (item.outcome.closeReturnPct ?? 0) < 0 ||
          item.outcome.bearishFailureHit === true,
      ).length,
      bearishMigrationRows.length,
    ),
    bearishWallMigrationFollowThroughSamples: bearishMigrationRows.length,
    lowEdgeWaitValidationRate: rate(
      lowEdgeRows.filter((item) => item.outcome.labelValidated === true).length,
      lowEdgeRows.length,
    ),
    lowEdgeWaitValidationSamples: lowEdgeRows.length,
  };
}

function adjustedRate(validated: number, evaluated: number): number | null {
  if (!evaluated) return null;
  return (validated + 2) / (evaluated + 4);
}

function proofConfidence(evaluated: number): EdgeProofSummary["confidence"] {
  if (evaluated <= 0) return "none";
  if (evaluated <= 4) return "very_low";
  if (evaluated <= 14) return "low";
  if (evaluated <= 29) return "medium";
  if (evaluated <= 99) return "high";
  return "strong";
}

function proofGrade(evaluated: number): EdgeProofSummary["proofGrade"] {
  if (evaluated <= 0) return "none";
  if (evaluated <= 4) return "early";
  if (evaluated <= 14) return "developing";
  if (evaluated <= 29) return "tested";
  if (evaluated <= 99) return "proven";
  return "institutional";
}

function outcomeBucket(outcome: EdgeValidationOutcome): string {
  if (!outcome.evaluated) return "waiting";
  if (outcome.bullishUnlockHit) return "bullishUnlock";
  if (outcome.bearishFailureHit) return "bearishFailure";
  if (outcome.rangeExpanded) return "rangeExpanded";
  if (outcome.rangeHeld) return "rangeHeld";
  if (outcome.magnetTouched) return "magnetTouched";
  if (outcome.labelValidated === true) return "validatedOther";
  if (outcome.labelValidated === false) return "failed";
  return "mixed";
}

function primaryOutcome(
  distribution: Record<string, number>,
): string | undefined {
  let bestKey = "";
  let bestValue = 0;
  for (const [key, value] of Object.entries(distribution)) {
    if (value > bestValue) {
      bestKey = key;
      bestValue = value;
    }
  }

  if (!bestKey) return undefined;

  const labels: Record<string, string> = {
    bullishUnlock: "Bullish unlock",
    bearishFailure: "Bearish failure",
    rangeExpanded: "Range expansion",
    rangeHeld: "Range held",
    magnetTouched: "Magnet touched",
    validatedOther: "Validated",
    failed: "Failed",
    mixed: "Mixed",
  };

  return labels[bestKey] ?? bestKey;
}

function buildProofForLabel(args: {
  label: ActionBucket | "ALL";
  records: EdgeValidationRecord[];
  horizon: EdgeValidationHorizon;
  ticker?: string;
}): EdgeProofSummary {
  const selected =
    args.label === "ALL"
      ? args.records
      : args.records.filter(
          (record) => record.edge.actionBucket === args.label,
        );

  const outcomes = selected
    .map((record) =>
      record.horizons.find((item) => item.horizonDays === args.horizon),
    )
    .filter((outcome): outcome is EdgeValidationOutcome => Boolean(outcome));

  const evaluated = outcomes.filter(
    (outcome) => outcome.evaluated && outcome.labelValidated != null,
  );
  const validated = evaluated.filter(
    (outcome) => outcome.labelValidated === true,
  );
  const distribution = evaluated.reduce<Record<string, number>>(
    (acc, outcome) => {
      const bucket = outcomeBucket(outcome);
      acc[bucket] = (acc[bucket] ?? 0) + 1;
      return acc;
    },
    {},
  );

  return {
    ticker: args.ticker ? normalizeTicker(args.ticker) : undefined,
    label: args.label,
    horizonDays: args.horizon,
    total: selected.length,
    evaluated: evaluated.length,
    validated: validated.length,
    rawRate: rate(validated.length, evaluated.length),
    adjustedRate: adjustedRate(validated.length, evaluated.length),
    confidence: proofConfidence(evaluated.length),
    proofGrade: proofGrade(evaluated.length),
    primaryOutcome: primaryOutcome(distribution),
    outcomeDistribution: distribution,
    updatedAt: new Date().toISOString(),
  };
}

export function buildEdgeProofSummaries(
  records: EdgeValidationRecord[],
  horizon: EdgeValidationHorizon,
  ticker?: string,
): EdgeProofSummary[] {
  const labels: (ActionBucket | "ALL")[] = [
    "ALL",
    "Best CSP setup",
    "Best covered-call setup",
    "Wheel candidate",
    "Compression coil",
    "Conflict / wait",
    "Premium trap / avoid",
    "Low-edge / wait",
  ];

  return labels.map((label) =>
    buildProofForLabel({ label, records, horizon, ticker }),
  );
}

export function normalizeValidationCandles(raw: unknown[]): CandleRecord[] {
  return raw
    .map((item: any) => {
      const date = robustDateKey(item.date ?? item.time ?? item.timestamp);
      const high = safeNumber(item.high ?? item.h);
      const low = safeNumber(item.low ?? item.l);
      const close = safeNumber(item.close ?? item.c);
      const open = safeNumber(item.open ?? item.o) ?? undefined;
      const volume = safeNumber(item.volume ?? item.v) ?? undefined;

      if (!date || high == null || low == null || close == null) return null;
      return { date, open, high, low, close, volume } as CandleRecord;
    })
    .filter((candle): candle is CandleRecord => candle != null)
    .sort((a, b) => a.date.localeCompare(b.date));
}
