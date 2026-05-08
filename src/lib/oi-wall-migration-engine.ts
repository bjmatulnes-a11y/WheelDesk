import {
  type OptionSurfaceSnapshot
} from "./wheeldesk-storage";
import {
  getSnapshotSpot,
  getSurfaceStructure,
  type TraderBias
} from "./trader-edge-engine";

export type WallMigrationDirection = "up" | "down" | "flat" | "new" | "missing";
export type WallMigrationBias = "bullish" | "bearish" | "neutral" | "compression" | "expansion" | "unknown";

export type WallMigrationSummary = {
  ticker: string;
  currentDate: string;
  priorDate: string | null;
  hasPrior: boolean;

  currentSupport: number | null;
  priorSupport: number | null;
  supportChange: number | null;
  supportChangePct: number | null;
  supportDirection: WallMigrationDirection;

  currentResistance: number | null;
  priorResistance: number | null;
  resistanceChange: number | null;
  resistanceChangePct: number | null;
  resistanceDirection: WallMigrationDirection;

  currentMagnet: number | null;
  priorMagnet: number | null;
  magnetChange: number | null;
  magnetChangePct: number | null;
  magnetDirection: WallMigrationDirection;

  currentRangeWidthPct: number | null;
  priorRangeWidthPct: number | null;
  rangeChangePct: number | null;
  rangeDirection: "widening" | "tightening" | "flat" | "unknown";

  currentSpot: number;
  priorSpot: number | null;
  spotChangePct: number | null;

  migrationBias: WallMigrationBias;
  migrationScore: number;
  label: string;
  interpretation: string;
  playbookNotes: string[];
  dataQualityNotes: string[];
};

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dateKey(value: unknown): string {
  return String(value ?? "").slice(0, 10);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function pctChange(current: number | null, prior: number | null): number | null {
  if (current == null || prior == null || !Number.isFinite(current) || !Number.isFinite(prior) || prior === 0) return null;
  return ((current - prior) / prior) * 100;
}

function absoluteChange(current: number | null, prior: number | null): number | null {
  if (current == null || prior == null || !Number.isFinite(current) || !Number.isFinite(prior)) return null;
  return current - prior;
}

function directionFromChange(change: number | null, tolerance: number): WallMigrationDirection {
  if (change == null || !Number.isFinite(change)) return "missing";
  if (Math.abs(change) <= tolerance) return "flat";
  return change > 0 ? "up" : "down";
}

function rangeWidthPct(support: number | null, resistance: number | null, spot: number): number | null {
  if (support == null || resistance == null || !spot || !Number.isFinite(spot)) return null;
  return ((resistance - support) / spot) * 100;
}

function rangeDirection(current: number | null, prior: number | null): "widening" | "tightening" | "flat" | "unknown" {
  if (current == null || prior == null) return "unknown";
  const change = current - prior;
  if (Math.abs(change) <= 1) return "flat";
  return change > 0 ? "widening" : "tightening";
}

function summarizeBias(args: {
  supportDirection: WallMigrationDirection;
  resistanceDirection: WallMigrationDirection;
  magnetDirection: WallMigrationDirection;
  rangeDirection: "widening" | "tightening" | "flat" | "unknown";
  spotChangePct: number | null;
}): { bias: WallMigrationBias; label: string; interpretation: string; score: number } {
  const { supportDirection, resistanceDirection, magnetDirection } = args;
  let score = 50;

  if (resistanceDirection === "up") score += 16;
  if (supportDirection === "up") score += 12;
  if (magnetDirection === "up") score += 10;
  if (resistanceDirection === "down") score -= 14;
  if (supportDirection === "down") score -= 16;
  if (magnetDirection === "down") score -= 10;
  if (args.rangeDirection === "tightening") score += 5;
  if (args.rangeDirection === "widening") score += 3;

  if (resistanceDirection === "up" && (supportDirection === "flat" || supportDirection === "up")) {
    return {
      bias: "bullish",
      label: "Call wall rolling higher",
      interpretation: "Resistance migrated higher while support held or rose. That is bullish acceptance unless price fails back into the prior range.",
      score: clampScore(score + 10)
    };
  }

  if (supportDirection === "down" && (resistanceDirection === "flat" || resistanceDirection === "down")) {
    return {
      bias: "bearish",
      label: "Put wall rolling lower",
      interpretation: "Support migrated lower while resistance failed to lift. Downside risk is repricing; CSPs should move lower or wait.",
      score: clampScore(score + 10)
    };
  }

  if (args.rangeDirection === "tightening") {
    return {
      bias: "compression",
      label: "Walls tightening",
      interpretation: "Support and resistance are compressing around price. Treat the active range as a pin/chop zone until one wall breaks.",
      score: clampScore(score + 6)
    };
  }

  if (args.rangeDirection === "widening") {
    return {
      bias: "expansion",
      label: "Range widening",
      interpretation: "The options surface is expanding. Use wider strikes and avoid assuming old tight walls still control price.",
      score: clampScore(score + 4)
    };
  }

  if (resistanceDirection === "flat" && supportDirection === "flat" && magnetDirection === "flat") {
    return {
      bias: "neutral",
      label: "Walls unchanged",
      interpretation: "Options walls did not materially migrate. Use current support/resistance as reference, but require price confirmation.",
      score: clampScore(score)
    };
  }

  return {
    bias: "neutral",
    label: "Mixed wall migration",
    interpretation: "Support, resistance, and magnet are not moving in one clean direction. Treat this as a confirmation-required regime.",
    score: clampScore(score)
  };
}

export function findPriorSurfaceForTicker(
  surfaces: OptionSurfaceSnapshot[],
  ticker: string,
  currentDate: string
): OptionSurfaceSnapshot | null {
  const upper = String(ticker ?? "").toUpperCase();
  const currentKey = dateKey(currentDate);

  return surfaces
    .filter((surface) => String(surface.ticker ?? "").toUpperCase() === upper)
    .filter((surface) => dateKey(surface.snapshotDate) < currentKey)
    .sort((a, b) => dateKey(b.snapshotDate).localeCompare(dateKey(a.snapshotDate)))[0] ?? null;
}

export function buildWallMigrationSummary(args: {
  currentSurface: OptionSurfaceSnapshot | null;
  priorSurface?: OptionSurfaceSnapshot | null;
}): WallMigrationSummary | null {
  const currentSurface = args.currentSurface;
  if (!currentSurface) return null;

  const priorSurface = args.priorSurface ?? null;
  const ticker = String(currentSurface.ticker ?? "").toUpperCase();
  const currentSpot = getSnapshotSpot(currentSurface, 0);
  const priorSpot = priorSurface ? getSnapshotSpot(priorSurface, 0) : null;
  const currentLevels = getSurfaceStructure(currentSurface);
  const priorLevels = priorSurface ? getSurfaceStructure(priorSurface) : { support: null, resistance: null, magnet: null };

  const currentRangeWidthPct = rangeWidthPct(currentLevels.support, currentLevels.resistance, currentSpot);
  const priorRangeWidthPct = priorSurface && priorSpot ? rangeWidthPct(priorLevels.support, priorLevels.resistance, priorSpot) : null;
  const rangeDelta = absoluteChange(currentRangeWidthPct, priorRangeWidthPct);
  const rangeDir = rangeDirection(currentRangeWidthPct, priorRangeWidthPct);

  const tolerance = Math.max(0.01, currentSpot * 0.0025);
  const supportChange = absoluteChange(currentLevels.support, priorLevels.support);
  const resistanceChange = absoluteChange(currentLevels.resistance, priorLevels.resistance);
  const magnetChange = absoluteChange(currentLevels.magnet, priorLevels.magnet);

  const supportDirection = priorSurface ? directionFromChange(supportChange, tolerance) : "new";
  const resistanceDirection = priorSurface ? directionFromChange(resistanceChange, tolerance) : "new";
  const magnetDirection = priorSurface ? directionFromChange(magnetChange, tolerance) : "new";
  const spotChangePct = pctChange(currentSpot, priorSpot);

  const bias = summarizeBias({
    supportDirection,
    resistanceDirection,
    magnetDirection,
    rangeDirection: rangeDir,
    spotChangePct
  });

  const dataQualityNotes: string[] = [];
  if (!priorSurface) dataQualityNotes.push("No prior saved surface for wall migration comparison.");
  if (currentLevels.support == null) dataQualityNotes.push("Current support unavailable.");
  if (currentLevels.resistance == null) dataQualityNotes.push("Current resistance unavailable.");
  if (currentLevels.magnet == null) dataQualityNotes.push("Current magnet unavailable.");
  if (priorSurface && priorLevels.support == null) dataQualityNotes.push("Prior support unavailable.");
  if (priorSurface && priorLevels.resistance == null) dataQualityNotes.push("Prior resistance unavailable.");
  if (!dataQualityNotes.length) dataQualityNotes.push("Current and prior surfaces have usable wall levels.");

  const playbookNotes: string[] = [];
  if (!priorSurface) {
    playbookNotes.push("Save at least two surface days to activate migration reads.");
  } else {
    if (resistanceDirection === "up") playbookNotes.push("Call wall moved higher: avoid tight covered calls until price confirms failure below the new wall.");
    if (resistanceDirection === "down") playbookNotes.push("Call wall moved lower: upside cap risk increased; covered calls may be cleaner after rejection confirmation.");
    if (supportDirection === "up") playbookNotes.push("Put wall moved higher: buyers may be accepting higher support; CSPs can be considered only below snapped support zones.");
    if (supportDirection === "down") playbookNotes.push("Put wall moved lower: do not chase CSP premium; move puts lower or wait for support confirmation.");
    if (magnetDirection === "up") playbookNotes.push("OI magnet shifted higher: upside mean-reversion pressure improved.");
    if (magnetDirection === "down") playbookNotes.push("OI magnet shifted lower: upside pull weakened; watch for failed rallies.");
    if (rangeDir === "tightening") playbookNotes.push("Active OI range tightened: expect chop/pin until a wall breaks.");
    if (rangeDir === "widening") playbookNotes.push("Active OI range widened: use wider strikes and do not anchor to stale tight walls.");
  }

  if (!playbookNotes.length) playbookNotes.push("No dominant wall migration edge; defer to current OI structure and price confirmation.");

  return {
    ticker,
    currentDate: currentSurface.snapshotDate,
    priorDate: priorSurface?.snapshotDate ?? null,
    hasPrior: Boolean(priorSurface),
    currentSupport: currentLevels.support,
    priorSupport: priorLevels.support,
    supportChange,
    supportChangePct: pctChange(currentLevels.support, priorLevels.support),
    supportDirection,
    currentResistance: currentLevels.resistance,
    priorResistance: priorLevels.resistance,
    resistanceChange,
    resistanceChangePct: pctChange(currentLevels.resistance, priorLevels.resistance),
    resistanceDirection,
    currentMagnet: currentLevels.magnet,
    priorMagnet: priorLevels.magnet,
    magnetChange,
    magnetChangePct: pctChange(currentLevels.magnet, priorLevels.magnet),
    magnetDirection,
    currentRangeWidthPct,
    priorRangeWidthPct,
    rangeChangePct: rangeDelta,
    rangeDirection: rangeDir,
    currentSpot,
    priorSpot,
    spotChangePct,
    migrationBias: bias.bias,
    migrationScore: bias.score,
    label: bias.label,
    interpretation: bias.interpretation,
    playbookNotes,
    dataQualityNotes
  };
}
