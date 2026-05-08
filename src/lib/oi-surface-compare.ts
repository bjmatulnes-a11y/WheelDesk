import { type OptionSurfaceSnapshot, dateKey } from "./wheeldesk-storage";
import { buildTraderEdgeSummary, type TraderEdgeSummary } from "./trader-edge-engine";

export type OISurfaceDirection =
  | "bullish"
  | "bearish"
  | "compression"
  | "expansion"
  | "stable"
  | "neutral";

export type OISurfaceComparisonPoint = {
  snapshotDate: string;
  surfaceKey?: string;
  support: number | null;
  resistance: number | null;
  magnet: number | null;
  rangeWidth: number | null;
  rangeWidthPct: number | null;
  edgeScore: number;
  dataQualityScore: number;
  actionBucket: string;
  source: string;
};

export type OISurfaceComparison = {
  current: OISurfaceComparisonPoint;
  prior: OISurfaceComparisonPoint | null;

  supportDelta: number | null;
  resistanceDelta: number | null;
  magnetDelta: number | null;
  rangeWidthDelta: number | null;
  rangeWidthPctDelta: number | null;
  edgeScoreDelta: number | null;

  biasChange: string;
  direction: OISurfaceDirection;
  strength: "low" | "medium" | "high";

  summary: string;
  implication: string;
  notes: string[];
  source: "wheeldesk_storage_v2.optionSurfaceSnapshots";
};

function fmt(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return value.toFixed(2);
}

function delta(current?: number | null, prior?: number | null): number | null {
  if (current == null || prior == null) return null;
  if (!Number.isFinite(current) || !Number.isFinite(prior)) return null;
  return current - prior;
}

function pointFromSurface(surface: OptionSurfaceSnapshot): OISurfaceComparisonPoint {
  const edge: TraderEdgeSummary = buildTraderEdgeSummary({
    ticker: surface.ticker,
    surface,
    candles: [],
    livePrice: surface.price?.close ?? surface.dailyStructure?.spot ?? null,
  });

  const rangeWidth =
    edge.support != null && edge.resistance != null
      ? edge.resistance - edge.support
      : null;

  return {
    snapshotDate: dateKey(surface.snapshotDate),
    surfaceKey: surface.surfaceKey,
    support: edge.support,
    resistance: edge.resistance,
    magnet: edge.magnet,
    rangeWidth,
    rangeWidthPct: edge.rangeWidthPct,
    edgeScore: edge.edgeScore,
    dataQualityScore: edge.dataQualityScore,
    actionBucket: edge.actionBucket,
    source: edge.source,
  };
}

function classifyDirection(args: {
  supportDelta: number | null;
  resistanceDelta: number | null;
  magnetDelta: number | null;
  rangeWidthDelta: number | null;
}): OISurfaceDirection {
  const s = args.supportDelta ?? 0;
  const r = args.resistanceDelta ?? 0;
  const m = args.magnetDelta ?? 0;
  const width = args.rangeWidthDelta ?? 0;

  const levelThreshold = 0.01;
  const magnetThreshold = 0.05;

  const supportUp = s > levelThreshold;
  const supportDown = s < -levelThreshold;
  const supportFlat = Math.abs(s) <= levelThreshold;

  const resistanceUp = r > levelThreshold;
  const resistanceDown = r < -levelThreshold;
  const resistanceFlat = Math.abs(r) <= levelThreshold;

  if (supportUp && resistanceUp) return "bullish";
  if (supportDown && resistanceDown) return "bearish";

  if (width < -levelThreshold || (supportUp && resistanceDown)) return "compression";
  if (width > levelThreshold || (supportDown && resistanceUp)) return "expansion";

  if (supportFlat && resistanceFlat) {
    if (m > magnetThreshold) return "bullish";
    if (m < -magnetThreshold) return "bearish";
    return "stable";
  }

  return "neutral";
}

function classifyStrength(args: {
  supportDelta: number | null;
  resistanceDelta: number | null;
  magnetDelta: number | null;
  rangeWidthDelta: number | null;
}): "low" | "medium" | "high" {
  const total =
    Math.abs(args.supportDelta ?? 0) +
    Math.abs(args.resistanceDelta ?? 0) +
    Math.abs(args.magnetDelta ?? 0) +
    Math.abs(args.rangeWidthDelta ?? 0);

  if (total >= 8) return "high";
  if (total >= 2) return "medium";
  return "low";
}

function buildSummary(args: {
  direction: OISurfaceDirection;
  current: OISurfaceComparisonPoint;
  prior: OISurfaceComparisonPoint;
  supportDelta: number | null;
  resistanceDelta: number | null;
  magnetDelta: number | null;
  rangeWidthDelta: number | null;
}): string {
  const supportText =
    args.supportDelta == null
      ? "Support unavailable."
      : Math.abs(args.supportDelta) < 0.01
        ? `Support held at ${fmt(args.current.support)}.`
        : args.supportDelta > 0
          ? `Support moved higher from ${fmt(args.prior.support)} to ${fmt(args.current.support)}.`
          : `Support moved lower from ${fmt(args.prior.support)} to ${fmt(args.current.support)}.`;

  const resistanceText =
    args.resistanceDelta == null
      ? "Resistance unavailable."
      : Math.abs(args.resistanceDelta) < 0.01
        ? `Resistance held at ${fmt(args.current.resistance)}.`
        : args.resistanceDelta > 0
          ? `Resistance moved higher from ${fmt(args.prior.resistance)} to ${fmt(args.current.resistance)}.`
          : `Resistance compressed lower from ${fmt(args.prior.resistance)} to ${fmt(args.current.resistance)}.`;

  const magnetText =
    args.magnetDelta == null
      ? "Magnet unavailable."
      : Math.abs(args.magnetDelta) < 0.05
        ? `Magnet was mostly stable near ${fmt(args.current.magnet)}.`
        : args.magnetDelta > 0
          ? `Magnet drifted higher from ${fmt(args.prior.magnet)} to ${fmt(args.current.magnet)}.`
          : `Magnet drifted lower from ${fmt(args.prior.magnet)} to ${fmt(args.current.magnet)}.`;

  const widthText =
    args.rangeWidthDelta == null
      ? "Range width unavailable."
      : Math.abs(args.rangeWidthDelta) < 0.01
        ? `Active range held near ${fmt(args.current.rangeWidth)} wide.`
        : args.rangeWidthDelta > 0
          ? `Active range widened by ${fmt(args.rangeWidthDelta)}.`
          : `Active range tightened by ${fmt(Math.abs(args.rangeWidthDelta))}.`;

  const tail =
    args.direction === "compression"
      ? "The validated v2 surface is compressing."
      : args.direction === "expansion"
        ? "The validated v2 surface is widening."
        : args.direction === "bullish"
          ? "The validated v2 surface is shifting constructively."
          : args.direction === "bearish"
            ? "The validated v2 surface is shifting defensively."
            : args.direction === "stable"
              ? "The validated v2 surface is stable."
              : "The validated v2 surface is mixed.";

  return `${supportText} ${resistanceText} ${magnetText} ${widthText} ${tail}`;
}

function buildImplication(direction: OISurfaceDirection): string {
  if (direction === "compression") {
    return "Upside/downside room is narrowing. Treat the active OI range as a pressure zone and avoid selling premium inside the walls unless assignment/call-away is intentional.";
  }

  if (direction === "expansion") {
    return "The OI battlefield is widening. Tight premium assumptions are less reliable; use snapped strike zones and respect unlock/failure rails.";
  }

  if (direction === "bullish") {
    return "Positioning is migrating higher. Avoid capping upside too aggressively until price rejects resistance or call walls stop migrating.";
  }

  if (direction === "bearish") {
    return "Positioning is migrating lower. Be cautious with put selling until support stabilizes or a new lower put wall forms.";
  }

  if (direction === "stable") {
    return "Structure is mostly unchanged. Range logic can be useful if price respects the validated support/resistance rails.";
  }

  return "Mixed structure. Use the pressure map, current volume, and price reaction before trusting one-sided trades.";
}

export function buildOISurfaceComparison(
  surfaces: OptionSurfaceSnapshot[],
  selectedDate?: string,
  priorDate?: string
): OISurfaceComparison | null {
  if (!Array.isArray(surfaces) || surfaces.length === 0) return null;

  const ordered = [...surfaces].sort((a, b) =>
    dateKey(a.snapshotDate).localeCompare(dateKey(b.snapshotDate))
  );

  const selectedKey = selectedDate ? dateKey(selectedDate) : "";
  const currentSurface =
    (selectedKey
      ? ordered.find((surface) => dateKey(surface.snapshotDate) === selectedKey)
      : null) ?? ordered.at(-1) ?? null;

  if (!currentSurface) return null;

  const currentDate = dateKey(currentSurface.snapshotDate);
  const priorKey = priorDate ? dateKey(priorDate) : "";
  const priorSurface =
    (priorKey
      ? ordered.find((surface) => dateKey(surface.snapshotDate) === priorKey && dateKey(surface.snapshotDate) !== currentDate)
      : null) ??
    [...ordered]
      .reverse()
      .find((surface) => dateKey(surface.snapshotDate) < currentDate) ??
    null;

  const current = pointFromSurface(currentSurface);

  if (!priorSurface) {
    return {
      current,
      prior: null,
      supportDelta: null,
      resistanceDelta: null,
      magnetDelta: null,
      rangeWidthDelta: null,
      rangeWidthPctDelta: null,
      edgeScoreDelta: null,
      biasChange: "N/A",
      direction: "neutral",
      strength: "low",
      summary: "No prior v2 surface snapshot is available for comparison.",
      implication: "Save another full OI surface snapshot in wheeldesk_storage_v2 to begin tracking validated wall drift.",
      notes: ["No prior full surface snapshot found for this ticker."],
      source: "wheeldesk_storage_v2.optionSurfaceSnapshots",
    };
  }

  const prior = pointFromSurface(priorSurface);
  const supportDelta = delta(current.support, prior.support);
  const resistanceDelta = delta(current.resistance, prior.resistance);
  const magnetDelta = delta(current.magnet, prior.magnet);
  const rangeWidthDelta = delta(current.rangeWidth, prior.rangeWidth);
  const rangeWidthPctDelta = delta(current.rangeWidthPct, prior.rangeWidthPct);
  const edgeScoreDelta = delta(current.edgeScore, prior.edgeScore);

  const direction = classifyDirection({
    supportDelta,
    resistanceDelta,
    magnetDelta,
    rangeWidthDelta,
  });

  const strength = classifyStrength({
    supportDelta,
    resistanceDelta,
    magnetDelta,
    rangeWidthDelta,
  });

  const notes = [
    `Support: ${fmt(prior.support)} → ${fmt(current.support)}`,
    `Resistance: ${fmt(prior.resistance)} → ${fmt(current.resistance)}`,
    `Magnet: ${fmt(prior.magnet)} → ${fmt(current.magnet)}`,
    `Range width: ${fmt(prior.rangeWidth)} → ${fmt(current.rangeWidth)}`,
    `Edge score: ${prior.edgeScore.toFixed(0)} → ${current.edgeScore.toFixed(0)}`,
    `Data quality: ${prior.dataQualityScore.toFixed(0)} → ${current.dataQualityScore.toFixed(0)}`,
  ];

  return {
    current,
    prior,
    supportDelta,
    resistanceDelta,
    magnetDelta,
    rangeWidthDelta,
    rangeWidthPctDelta,
    edgeScoreDelta,
    biasChange: `${prior.actionBucket} → ${current.actionBucket}`,
    direction,
    strength,
    summary: buildSummary({
      direction,
      current,
      prior,
      supportDelta,
      resistanceDelta,
      magnetDelta,
      rangeWidthDelta,
    }),
    implication: buildImplication(direction),
    notes,
    source: "wheeldesk_storage_v2.optionSurfaceSnapshots",
  };
}
