import { type OptionSurfaceSnapshot } from "./wheeldesk-storage";
import { getSnapshotSpot, getSurfaceStructure } from "./trader-edge-engine";

export type WallMigrationDirection = "up" | "down" | "flat" | "new" | "missing";
export type WallMigrationBias =
  | "bullish"
  | "bearish"
  | "neutral"
  | "compression"
  | "expansion"
  | "unknown";

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
  /** Directional score: higher is more bullish, lower is more bearish. */
  migrationScore: number;
  /** Intensity score: wall movement magnitude regardless of bullish/bearish direction. */
  migrationIntensityScore: number;
  /** Data-quality score for the selected prior surface used in this comparison. */
  priorQualityScore: number | null;
  label: string;
  interpretation: string;
  playbookNotes: string[];
  dataQualityNotes: string[];
};

type OiKey = `${string}|${string}|${"call" | "put"}`;

type OiMapEntry = {
  oi: number;
  volume: number;
};

function safeNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function dateKey(value: unknown): string {
  return String(value ?? "").slice(0, 10);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function pctChange(current: number | null, prior: number | null): number | null {
  if (
    current == null ||
    prior == null ||
    !Number.isFinite(current) ||
    !Number.isFinite(prior) ||
    prior === 0
  )
    return null;
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

function expirationOf(chain: any): string {
  return String(chain?.expiration ?? chain?.expirationDate ?? chain?.expiry ?? "").slice(0, 10);
}

function strikeKey(strike: unknown): string | null {
  const n = Number(strike);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(2);
}

function sideOf(row: any): "call" | "put" | null {
  const side = String(row?.side ?? row?.optionType ?? row?.type ?? row?.right ?? "").toLowerCase();
  if (side === "call" || side === "c") return "call";
  if (side === "put" || side === "p") return "put";
  return null;
}

function sideRowOi(row: any): number | null {
  return safeNumber(row?.openInterest ?? row?.open_interest ?? row?.oi ?? row?.open_interest_contracts ?? row?.openInterestContracts);
}

function sideRowVolume(row: any): number | null {
  return safeNumber(row?.volume ?? row?.vol ?? row?.optionVolume);
}

function addOi(map: Map<OiKey, OiMapEntry>, key: OiKey, oi: number, volume = 0): void {
  const current = map.get(key) ?? { oi: 0, volume: 0 };
  current.oi += Math.max(0, oi);
  current.volume += Math.max(0, volume);
  map.set(key, current);
}

function buildOiMap(surface: OptionSurfaceSnapshot | null): Map<OiKey, OiMapEntry> {
  const map = new Map<OiKey, OiMapEntry>();
  if (!surface?.chains?.length) return map;

  for (const chain of surface.chains as any[]) {
    const expiration = expirationOf(chain);
    if (!expiration) continue;

    for (const row of chain.rows ?? []) {
      const strike = strikeKey(row?.strike);
      if (!strike) continue;

      const explicitSide = sideOf(row);
      if (explicitSide) {
        const oi = sideRowOi(row);
        if (oi != null) {
          addOi(map, `${expiration}|${strike}|${explicitSide}`, oi, sideRowVolume(row) ?? 0);
          continue;
        }
      }

      const callOi = safeNumber(row?.callOi ?? row?.callOpenInterest ?? row?.callsOpenInterest ?? row?.openInterestCall);
      const putOi = safeNumber(row?.putOi ?? row?.putOpenInterest ?? row?.putsOpenInterest ?? row?.openInterestPut);
      const callVolume = safeNumber(row?.callVolume ?? row?.callVol ?? row?.callsVolume ?? row?.volumeCall) ?? 0;
      const putVolume = safeNumber(row?.putVolume ?? row?.putVol ?? row?.putsVolume ?? row?.volumePut) ?? 0;

      if (callOi != null) addOi(map, `${expiration}|${strike}|call`, callOi, callVolume);
      if (putOi != null) addOi(map, `${expiration}|${strike}|put`, putOi, putVolume);
    }
  }

  return map;
}

function totalOi(map: Map<OiKey, OiMapEntry>): number {
  let total = 0;
  for (const row of map.values()) total += row.oi;
  return total;
}

function priorSurfaceQuality(current: OptionSurfaceSnapshot | null, prior: OptionSurfaceSnapshot | null): {
  score: number;
  notes: string[];
  suspectPriorZeroRows: number;
  suspectPriorZeroOiShare: number;
} {
  const notes: string[] = [];
  if (!prior) {
    return { score: 0, notes: ["No prior surface."], suspectPriorZeroRows: 0, suspectPriorZeroOiShare: 0 };
  }

  const currentMap = buildOiMap(current);
  const priorMap = buildOiMap(prior);
  const currentTotal = totalOi(currentMap);
  const priorTotal = totalOi(priorMap);
  const minLargeOi = Math.max(750, currentTotal * 0.0025);

  let matchedRows = 0;
  let suspectPriorZeroRows = 0;
  let suspectPriorZeroOi = 0;

  for (const [key, currentRow] of currentMap.entries()) {
    const priorRow = priorMap.get(key);
    if (!priorRow) continue;
    matchedRows += 1;
    if (priorRow.oi === 0 && currentRow.oi >= minLargeOi) {
      suspectPriorZeroRows += 1;
      suspectPriorZeroOi += currentRow.oi;
    }
  }

  const suspectPriorZeroOiShare = currentTotal > 0 ? suspectPriorZeroOi / currentTotal : 0;
  let score = 100;
  if ((prior.chains?.length ?? 0) === 0) score -= 45;
  if (priorMap.size < 20) score -= 25;
  if (priorTotal <= 0) score -= 45;
  if (matchedRows < 15) score -= 20;
  if (suspectPriorZeroRows > 0) score -= Math.min(45, suspectPriorZeroRows * 8 + suspectPriorZeroOiShare * 160);

  if (suspectPriorZeroRows > 0) {
    notes.push(`${suspectPriorZeroRows} matched OI rows were suspicious prior-zero jumps; prior may contain corrupted zero OI.`);
  }
  if (matchedRows < 15) notes.push(`Only ${matchedRows} matched OI rows between current/prior surfaces.`);
  if (priorTotal <= 0) notes.push("Prior surface total OI is zero or unavailable.");
  if (!notes.length) notes.push("Prior surface passed OI completeness checks.");

  return {
    score: clampScore(score),
    notes,
    suspectPriorZeroRows,
    suspectPriorZeroOiShare
  };
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

function migrationIntensityScore(args: {
  supportChangePct: number | null;
  resistanceChangePct: number | null;
  magnetChangePct: number | null;
  rangeChangePct: number | null;
  hasPrior: boolean;
}): number {
  if (!args.hasPrior) return 0;
  const moves = [args.supportChangePct, args.resistanceChangePct, args.magnetChangePct]
    .filter((value): value is number => value != null && Number.isFinite(value))
    .map((value) => Math.abs(value));
  const strongestLevelMove = moves.length ? Math.max(...moves) : 0;
  const rangeMove = Math.abs(args.rangeChangePct ?? 0);
  return clampScore(strongestLevelMove * 14 + rangeMove * 7);
}

export function findPriorSurfaceForTicker(
  surfaces: OptionSurfaceSnapshot[],
  ticker: string,
  currentDate: string,
  currentSurface?: OptionSurfaceSnapshot | null
): OptionSurfaceSnapshot | null {
  const upper = String(ticker ?? "").toUpperCase();
  const currentKey = dateKey(currentDate);

  const candidates = surfaces
    .filter((surface) => String(surface.ticker ?? "").toUpperCase() === upper)
    .filter((surface) => dateKey(surface.snapshotDate) < currentKey)
    .sort((a, b) => dateKey(b.snapshotDate).localeCompare(dateKey(a.snapshotDate)));

  if (!candidates.length) return null;
  if (!currentSurface) return candidates[0] ?? null;

  const scored = candidates.map((surface) => ({
    surface,
    quality: priorSurfaceQuality(currentSurface, surface)
  }));

  const clean = scored.find((item) => item.quality.score >= 70);
  return (clean ?? scored[0])?.surface ?? null;
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

  const supportChangePct = pctChange(currentLevels.support, priorLevels.support);
  const resistanceChangePct = pctChange(currentLevels.resistance, priorLevels.resistance);
  const magnetChangePct = pctChange(currentLevels.magnet, priorLevels.magnet);

  const bias = summarizeBias({
    supportDirection,
    resistanceDirection,
    magnetDirection,
    rangeDirection: rangeDir,
    spotChangePct
  });

  const quality = priorSurface ? priorSurfaceQuality(currentSurface, priorSurface) : null;
  const intensity = migrationIntensityScore({
    supportChangePct,
    resistanceChangePct,
    magnetChangePct,
    rangeChangePct: rangeDelta,
    hasPrior: Boolean(priorSurface)
  });

  const dataQualityNotes: string[] = [];
  if (!priorSurface) dataQualityNotes.push("No prior saved surface for wall migration comparison.");
  if (quality) dataQualityNotes.push(...quality.notes);
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
    if (magnetDirection === "down") playbookNotes.push("OI magnet shifted lower: downside magnet risk increased.");
    if (rangeDir === "tightening") playbookNotes.push("OI range tightened: expect chop/pin until price accepts outside the compressed zone.");
    if (rangeDir === "widening") playbookNotes.push("OI range widened: use wider strikes and do not anchor to stale tight walls.");
    if (intensity >= 65) playbookNotes.push("Wall movement intensity is high; use migration direction as context but expect faster snap risk near rails.");
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
    supportChangePct,
    supportDirection,
    currentResistance: currentLevels.resistance,
    priorResistance: priorLevels.resistance,
    resistanceChange,
    resistanceChangePct,
    resistanceDirection,
    currentMagnet: currentLevels.magnet,
    priorMagnet: priorLevels.magnet,
    magnetChange,
    magnetChangePct,
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
    migrationIntensityScore: intensity,
    priorQualityScore: quality?.score ?? null,
    label: bias.label,
    interpretation: bias.interpretation,
    playbookNotes,
    dataQualityNotes
  };
}
