import { type OIProjectionReport } from "./oi-projection-engine";
import { type TraderEdgeSummary } from "./trader-edge-engine";
import { type WallMigrationSummary } from "./oi-wall-migration-engine";

export type OIPathRegime =
  | "pin_chop"
  | "magnet_pull"
  | "bullish_unlock_watch"
  | "bearish_failure_watch"
  | "expansion"
  | "mixed";

export type OIPathDisplayMode = "minimal" | "standard" | "full";

export type OIPathPoint = {
  date: string;
  value: number;
};

export type OIPathActionRow = {
  scenario: "Base case" | "Bullish unlock" | "Bearish failure";
  condition: string;
  coveredCallAction: string;
  cspAction: string;
  existingPositionAction: string;
};

export type OITradePermissions = {
  coveredCalls: string;
  cashSecuredPuts: string;
  newPremium: string;
};

export type OIActiveScenario = "base" | "bullish_unlock" | "bearish_failure";

export type OIImpliedPathResult = {
  ticker: string;
  snapshotDate: string;
  currentPrice: number;
  anchorExpiration: string | null;
  dominantExpiration: string | null;
  horizonSessions: number;
  regime: OIPathRegime;
  confidence: "low" | "medium" | "high";
  pathBias: "bullish" | "bearish" | "neutral";
  activeScenario: OIActiveScenario;
  tradePermissions: OITradePermissions;
  invalidAbove: number | null;
  invalidBelow: number | null;
  basePath: OIPathPoint[];
  upperBand: OIPathPoint[];
  lowerBand: OIPathPoint[];
  bullishUnlockPath: OIPathPoint[];
  bearishFailurePath: OIPathPoint[];
  notes: string[];
  triggerNotes: string[];
  migrationNotes: string[];
  confidenceDegraders: string[];
  tradePlanNotes: string[];
  actionMatrix: OIPathActionRow[];
  baseCase: string;
  bullishUnlockCase: string;
  bearishFailureCase: string;
  displaySummary: string;
};

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function dateKey(value: unknown): string {
  return String(value ?? "").slice(0, 10);
}

function addBusinessDays(startDate: string, days: number): string {
  const date = new Date(`${dateKey(startDate)}T00:00:00Z`);
  let remaining = days;

  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }

  return date.toISOString().slice(0, 10);
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function smoothStep(t: number): number {
  return t * t * (3 - 2 * t);
}

function clampStep(next: number, previous: number, maxStep: number): number {
  if (!Number.isFinite(previous)) return next;
  if (Math.abs(next - previous) <= maxStep) return next;
  return previous + Math.sign(next - previous) * maxStep;
}

function uniquePath(points: OIPathPoint[]): OIPathPoint[] {
  const byDate = new Map<string, OIPathPoint>();
  for (const point of points) {
    if (!point.date || !Number.isFinite(point.value)) continue;
    byDate.set(point.date.slice(0, 10), { date: point.date.slice(0, 10), value: roundToCents(point.value) });
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function weightedAverage(values: { value: number; weight: number }[]): number | null {
  const clean = values.filter((item) => Number.isFinite(item.value) && Number.isFinite(item.weight) && item.weight > 0);
  const weight = clean.reduce((sum, item) => sum + item.weight, 0);
  if (!weight) return null;
  return clean.reduce((sum, item) => sum + item.value * item.weight, 0) / weight;
}

function confidenceFrom(args: {
  projectionConfidence?: "low" | "medium" | "high";
  edge?: TraderEdgeSummary | null;
  wallMigration?: WallMigrationSummary | null;
  confidenceDegraders: string[];
}): "low" | "medium" | "high" {
  let score = args.projectionConfidence === "high" ? 68 : args.projectionConfidence === "medium" ? 55 : 42;

  if ((args.edge?.dataQualityScore ?? 0) >= 80) score += 10;
  if ((args.edge?.dataQualityScore ?? 0) < 60) score -= 18;
  if (args.wallMigration?.hasPrior) score += 7;
  if (args.wallMigration?.migrationBias === "unknown") score -= 6;
  if ((args.edge?.trapRisk ?? 0) >= 75) score -= 8;
  if ((args.edge?.staleDays ?? 0) >= 2) score -= 14;
  if (args.edge?.volumeThrust == null) score -= 4;

  if ((args.edge?.staleDays ?? 0) >= 2) args.confidenceDegraders.push("Surface is stale; OI path confidence is reduced.");
  if (args.edge?.volumeThrust == null) args.confidenceDegraders.push("Current volume confirmation is unavailable; treat path as structure-only.");
  if ((args.edge?.trapRisk ?? 0) >= 75) args.confidenceDegraders.push("Trap risk is high; avoid reading the path as a clean directional forecast.");
  if (!args.wallMigration?.hasPrior) args.confidenceDegraders.push("No prior surface comparison; wall migration cannot confirm direction.");

  if (score >= 70) return "high";
  if (score >= 52) return "medium";
  return "low";
}

function regimeFrom(args: {
  edge?: TraderEdgeSummary | null;
  wallMigration?: WallMigrationSummary | null;
  projection?: OIProjectionReport | null;
}): OIPathRegime {
  const edge = args.edge;
  const wall = args.wallMigration;

  if (wall?.migrationBias === "bullish") return "bullish_unlock_watch";
  if (wall?.migrationBias === "bearish") return "bearish_failure_watch";
  if (wall?.migrationBias === "expansion") return "expansion";
  if (wall?.migrationBias === "compression") return "pin_chop";

  if (edge?.compressionState === "High compression" || edge?.compressionState === "Moderate compression") return "pin_chop";
  if (edge?.magnet != null && edge.analysisPrice) {
    const magnetDistancePct = Math.abs((edge.magnet - edge.analysisPrice) / edge.analysisPrice) * 100;
    if (magnetDistancePct <= 8) return "magnet_pull";
  }

  if (args.projection?.projectedBias === "bullish") return "bullish_unlock_watch";
  if (args.projection?.projectedBias === "bearish") return "bearish_failure_watch";
  return "mixed";
}

function pathBiasFrom(args: {
  edge?: TraderEdgeSummary | null;
  wallMigration?: WallMigrationSummary | null;
  projection?: OIProjectionReport | null;
}): "bullish" | "bearish" | "neutral" {
  if (args.wallMigration?.migrationBias === "bullish") return "bullish";
  if (args.wallMigration?.migrationBias === "bearish") return "bearish";
  if (args.edge?.optionsBias === "bullish") return "bullish";
  if (args.edge?.optionsBias === "bearish") return "bearish";
  return args.projection?.projectedBias ?? "neutral";
}

function activeScenarioFrom(args: {
  currentPrice: number;
  invalidAbove: number | null;
  invalidBelow: number | null;
}): OIActiveScenario {
  if (args.invalidAbove != null && args.currentPrice >= args.invalidAbove) return "bullish_unlock";
  if (args.invalidBelow != null && args.currentPrice <= args.invalidBelow) return "bearish_failure";
  return "base";
}

function activeScenarioLabel(scenario: OIActiveScenario): string {
  if (scenario === "bullish_unlock") return "Bullish unlock active";
  if (scenario === "bearish_failure") return "Bearish failure active";
  return "Base case active";
}

function buildTradePermissions(edge?: TraderEdgeSummary | null): OITradePermissions {
  const ccFloor = edge?.executableCoveredCallFloor != null ? edge.executableCoveredCallFloor.toFixed(2) : "outside resistance";
  const cspCeiling = edge?.executableCspCeiling != null ? edge.executableCspCeiling.toFixed(2) : "below support";
  const compression = edge?.compressionState ?? "Open / not compressed";
  const trapRisk = edge?.trapRisk ?? 0;

  const newPremium = trapRisk >= 65 || compression !== "Open / not compressed"
    ? "Conditional / smaller size; sell only outside snapped zones."
    : "Allowed only if premium, liquidity, and assignment/call-away intent are acceptable.";

  return {
    coveredCalls: `${ccFloor}+ only unless call-away is desired.`,
    cashSecuredPuts: `${cspCeiling} or lower unless assignment is desired.`,
    newPremium
  };
}

function regimeLabel(regime: OIPathRegime): string {
  switch (regime) {
    case "pin_chop":
      return "Pin/chop pressure map";
    case "magnet_pull":
      return "Magnet-pull pressure map";
    case "bullish_unlock_watch":
      return "Bullish unlock watch";
    case "bearish_failure_watch":
      return "Bearish failure watch";
    case "expansion":
      return "Expansion pressure map";
    default:
      return "Mixed pressure map";
  }
}

function baseTargetFrom(args: {
  currentPrice: number;
  edge?: TraderEdgeSummary | null;
  projection?: OIProjectionReport | null;
  regime: OIPathRegime;
  pathBias: "bullish" | "bearish" | "neutral";
}): number {
  const currentPrice = args.currentPrice;
  const edge = args.edge;
  const projection = args.projection;

  const weightedProjection = weightedAverage(
    (projection?.points ?? []).slice(0, 5).map((point) => ({ value: point.adjustedCenter, weight: point.weight }))
  );

  let target = weightedProjection ?? edge?.magnet ?? currentPrice;

  if (args.regime === "pin_chop" || args.regime === "magnet_pull") {
    const magnet = edge?.magnet ?? target;
    const rangeMid = edge?.support != null && edge.resistance != null ? (edge.support + edge.resistance) / 2 : magnet;
    target = magnet * 0.65 + rangeMid * 0.25 + target * 0.10;
  }

  if (args.pathBias === "bullish" && edge?.resistance != null) {
    target = Math.max(target, currentPrice * 1.01);
    target = Math.min(edge.resistance, target * 0.65 + edge.resistance * 0.35);
  }

  if (args.pathBias === "bearish" && edge?.support != null) {
    target = Math.min(target, currentPrice * 0.99);
    target = Math.max(edge.support, target * 0.65 + edge.support * 0.35);
  }

  return roundToCents(target);
}

function getHorizonSessions(args: {
  edge?: TraderEdgeSummary | null;
  wallMigration?: WallMigrationSummary | null;
}): number {
  if (args.wallMigration?.migrationBias === "expansion") return 14;
  if (args.edge?.compressionState === "High compression") return 10;
  if (args.edge?.compressionState === "Moderate compression") return 12;
  return 14;
}

function getEnvelopeWidth(args: {
  currentPrice: number;
  edge?: TraderEdgeSummary | null;
  wallMigration?: WallMigrationSummary | null;
}): number {
  const currentPrice = args.currentPrice || 1;
  const atrWidth = args.edge?.atrPct != null ? currentPrice * clamp(args.edge.atrPct / 100 * 0.95, 0.012, 0.065) : null;
  const rangeWidth = args.edge?.support != null && args.edge.resistance != null ? Math.abs(args.edge.resistance - args.edge.support) : null;

  let width = atrWidth ?? currentPrice * 0.03;
  if (rangeWidth != null) width = Math.max(width, rangeWidth * 0.18);

  if (args.edge?.compressionState === "High compression") width *= 0.72;
  if (args.edge?.compressionState === "Moderate compression") width *= 0.86;
  if (args.wallMigration?.migrationBias === "expansion") width *= 1.25;
  if ((args.edge?.pinSnapRiskScore ?? 0) > 70) width *= 1.15;

  return Math.max(currentPrice * 0.01, width);
}

function buildSmoothPath(args: {
  startDate: string;
  startValue: number;
  targetValue: number;
  horizonSessions: number;
  maxStep: number;
  curvature?: "early" | "late" | "linear";
}): OIPathPoint[] {
  const points: OIPathPoint[] = [];
  let previous = args.startValue;

  for (let i = 1; i <= args.horizonSessions; i += 1) {
    const t = i / args.horizonSessions;
    const shapedT = args.curvature === "late" ? smoothStep(t) : args.curvature === "linear" ? t : easeOutCubic(t);
    const raw = args.startValue + (args.targetValue - args.startValue) * shapedT;
    const value = clampStep(raw, previous, args.maxStep);
    previous = value;
    points.push({ date: addBusinessDays(args.startDate, i), value: roundToCents(value) });
  }

  return uniquePath(points);
}


function buildActivatedScenarioPath(args: {
  startDate: string;
  activationValue: number;
  targetValue: number;
  horizonSessions: number;
  maxStep: number;
  curvature?: "early" | "late" | "linear";
}): OIPathPoint[] {
  const points: OIPathPoint[] = [];
  const sessions = Math.max(4, args.horizonSessions);
  let previous = args.activationValue;

  points.push({ date: addBusinessDays(args.startDate, 1), value: roundToCents(args.activationValue) });

  for (let i = 2; i <= sessions; i += 1) {
    const t = (i - 1) / Math.max(1, sessions - 1);
    const shapedT = args.curvature === "early" ? easeOutCubic(t) : args.curvature === "linear" ? t : smoothStep(t);
    const raw = args.activationValue + (args.targetValue - args.activationValue) * shapedT;
    const value = clampStep(raw, previous, args.maxStep);
    previous = value;
    points.push({ date: addBusinessDays(args.startDate, i), value: roundToCents(value) });
  }

  return uniquePath(points);
}

function buildActionMatrix(args: {
  edge?: TraderEdgeSummary | null;
  currentPrice: number;
  invalidAbove: number | null;
  invalidBelow: number | null;
}): OIPathActionRow[] {
  const edge = args.edge;
  const rangeText = edge?.support != null && edge.resistance != null ? `${edge.support.toFixed(2)} – ${edge.resistance.toFixed(2)}` : "active OI range";
  const ccFloor = edge?.executableCoveredCallFloor != null ? edge.executableCoveredCallFloor.toFixed(2) : "outside resistance";
  const cspCeiling = edge?.executableCspCeiling != null ? edge.executableCspCeiling.toFixed(2) : "below support";
  const above = args.invalidAbove != null ? args.invalidAbove.toFixed(2) : "resistance";
  const below = args.invalidBelow != null ? args.invalidBelow.toFixed(2) : "support";

  return [
    {
      scenario: "Base case",
      condition: `Price remains inside ${rangeText}.`,
      coveredCallAction: `Do not sell calls below ${ccFloor} unless call-away is desired.`,
      cspAction: `Do not sell puts above ${cspCeiling} unless assignment is desired.`,
      existingPositionAction: "Manage existing exposure; avoid stacking new premium inside the active OI range."
    },
    {
      scenario: "Bullish unlock",
      condition: `Price accepts above ${above}.`,
      coveredCallAction: "Treat the old call wall as possible fuel; avoid tight covered calls or roll higher.",
      cspAction: "CSPs can improve only if support/magnet migrate higher and premium remains worth the risk.",
      existingPositionAction: "Let long calls/upside work; defend short calls if price holds above the unlock rail."
    },
    {
      scenario: "Bearish failure",
      condition: `Price loses ${below}.`,
      coveredCallAction: "Covered calls become cleaner only after failed support confirms and bounce risk fades.",
      cspAction: "Pause or move CSPs lower; do not treat the broken put wall as safe support.",
      existingPositionAction: "Defend short puts and reduce bullish exposure until a new support wall forms."
    }
  ];
}

export function buildOIImpliedPath(args: {
  projectionReport: OIProjectionReport | null;
  edgeSummary: TraderEdgeSummary | null;
  wallMigration?: WallMigrationSummary | null;
  currentPrice?: number | null;
}): OIImpliedPathResult | null {
  const projection = args.projectionReport;
  const edge = args.edgeSummary;
  if (!projection?.points?.length && !edge) return null;

  const wall = args.wallMigration ?? null;
  const currentPrice = safeNumber(args.currentPrice) ?? edge?.analysisPrice ?? projection?.currentPrice ?? null;
  if (!currentPrice || !Number.isFinite(currentPrice)) return null;

  const confidenceDegraders: string[] = [];
  const regime = regimeFrom({ edge, wallMigration: wall, projection });
  const pathBias = pathBiasFrom({ edge, wallMigration: wall, projection });
  const confidence = confidenceFrom({ projectionConfidence: projection?.confidence, edge, wallMigration: wall, confidenceDegraders });

  const bufferPct = edge?.compressionState === "High compression" ? 0.004 : 0.006;
  const buffer = Math.max(0.05, currentPrice * bufferPct);
  const invalidAbove = edge?.resistance != null ? roundToCents(edge.resistance + buffer) : null;
  const invalidBelow = edge?.support != null ? roundToCents(edge.support - buffer) : null;
  const magnet = edge?.magnet ?? null;

  const projectionPoints = projection?.points ?? [];
  const maxWeightPoint = projectionPoints.length
    ? projectionPoints.reduce((best, point) => (point.weight > best.weight ? point : best), projectionPoints[0])
    : null;
  const anchorExpiration = projectionPoints[0]?.expiration ?? null;
  const dominantExpiration = maxWeightPoint?.expiration ?? null;

  const horizonSessions = getHorizonSessions({ edge, wallMigration: wall });
  const startDate = projection?.snapshotDate ?? edge?.snapshotDate ?? new Date().toISOString().slice(0, 10);
  const target = baseTargetFrom({ currentPrice, edge, projection, regime, pathBias });
  const envelopeWidth = getEnvelopeWidth({ currentPrice, edge, wallMigration: wall });
  const maxStep = Math.max(currentPrice * 0.0075, envelopeWidth * 0.28);

  const basePath = buildSmoothPath({
    startDate,
    startValue: currentPrice,
    targetValue: target,
    horizonSessions,
    maxStep,
    curvature: regime === "pin_chop" ? "linear" : "early"
  });

  const upperBand = basePath.map((point, index) => {
    const t = (index + 1) / horizonSessions;
    const width = envelopeWidth * (0.65 + 0.35 * t);
    return { date: point.date, value: roundToCents(point.value + width) };
  });

  const lowerBand = basePath.map((point, index) => {
    const t = (index + 1) / horizonSessions;
    const width = envelopeWidth * (0.65 + 0.35 * t);
    return { date: point.date, value: roundToCents(point.value - width) };
  });

  const activeRange =
    edge?.support != null && edge.resistance != null
      ? Math.abs(edge.resistance - edge.support)
      : envelopeWidth * 4;

  const scenarioAmp = confidence === "high" ? 1 : confidence === "medium" ? 0.72 : 0.52;
  const bullishActivation = invalidAbove ?? edge?.resistance ?? currentPrice;
  const bearishActivation = invalidBelow ?? edge?.support ?? currentPrice;

  const bullishExtension = Math.max(envelopeWidth * 1.5, activeRange * 0.16, currentPrice * 0.018) * scenarioAmp;
  const bearishExtension = Math.max(envelopeWidth * 1.5, activeRange * 0.16, currentPrice * 0.018) * scenarioAmp;

  const bullishTargetBase = Math.max(
    bullishActivation + bullishExtension,
    edge?.executableCoveredCallFloor ?? bullishActivation,
    maxWeightPoint?.upperRange ?? bullishActivation
  );
  const bearishTargetBase = Math.min(
    bearishActivation - bearishExtension,
    edge?.executableCspCeiling ?? bearishActivation,
    maxWeightPoint?.lowerRange ?? bearishActivation
  );

  const bullishTarget = roundToCents(bullishTargetBase);
  const bearishTarget = roundToCents(bearishTargetBase);

  const bullishUnlockPath = buildActivatedScenarioPath({
    startDate,
    activationValue: bullishActivation,
    targetValue: bullishTarget,
    horizonSessions: Math.max(6, Math.min(10, horizonSessions)),
    maxStep: maxStep * 1.05,
    curvature: "late"
  });
  const bearishFailurePath = buildActivatedScenarioPath({
    startDate,
    activationValue: bearishActivation,
    targetValue: bearishTarget,
    horizonSessions: Math.max(6, Math.min(10, horizonSessions)),
    maxStep: maxStep * 1.05,
    curvature: "late"
  });

  const notes: string[] = [];
  const triggerNotes: string[] = [];
  const migrationNotes: string[] = [];
  const tradePlanNotes: string[] = [];
  const activeScenario = activeScenarioFrom({ currentPrice, invalidAbove, invalidBelow });
  const tradePermissions = buildTradePermissions(edge);

  if (regime === "pin_chop") {
    notes.push("Base case treats the active OI range as a pin/chop pressure zone until support or resistance breaks.");
  } else if (regime === "magnet_pull") {
    notes.push("Base case favors mean reversion toward the OI magnet while support/resistance remain intact.");
  } else if (regime === "bullish_unlock_watch") {
    notes.push("Upside scenario has higher weight because options positioning or wall migration leans higher.");
  } else if (regime === "bearish_failure_watch") {
    notes.push("Downside scenario has higher weight because support or wall migration is weakening.");
  } else if (regime === "expansion") {
    notes.push("OI range is widening; treat the path as a scenario envelope, not a tight forecast.");
  } else {
    notes.push("Current OI structure is mixed; use rails and strike zones more than the base line.");
  }

  notes.push(`Path horizon is intentionally limited to ${horizonSessions} trading sessions to avoid fake long-range precision.`);

  triggerNotes.push(`${activeScenarioLabel(activeScenario)}. Green/red scenarios remain inactive unless their rails are triggered.`);
  if (invalidAbove != null) triggerNotes.push(`Bullish unlock above ${invalidAbove.toFixed(2)}; the green scenario path starts at this rail and is inactive until price accepts above it.`);
  if (invalidBelow != null) triggerNotes.push(`Bearish failure below ${invalidBelow.toFixed(2)}; the red scenario path starts at this rail and is inactive until price loses it.`);
  if (magnet != null) triggerNotes.push(`OI magnet reference sits at ${magnet.toFixed(2)}; base case can mean-revert toward this level while structure holds.`);

  if (wall?.hasPrior) {
    migrationNotes.push(`${wall.label}: ${wall.interpretation}`);
    if (wall.resistanceChange != null) migrationNotes.push(`Resistance change: ${wall.resistanceChange >= 0 ? "+" : ""}${wall.resistanceChange.toFixed(2)}.`);
    if (wall.supportChange != null) migrationNotes.push(`Support change: ${wall.supportChange >= 0 ? "+" : ""}${wall.supportChange.toFixed(2)}.`);
  } else {
    migrationNotes.push("No prior saved surface was available, so path is based on current OI structure only.");
  }

  if (edge?.executableCoveredCallFloor != null) tradePlanNotes.push(`Covered-call floor: avoid selling below ${edge.executableCoveredCallFloor.toFixed(2)} unless call-away is acceptable.`);
  if (edge?.executableCspCeiling != null) tradePlanNotes.push(`CSP ceiling: avoid selling above ${edge.executableCspCeiling.toFixed(2)} unless assignment is desired.`);
  tradePlanNotes.push("Use the base case while price remains inside the active OI range; green/red scenario paths are conditional and start at their activation rails.");

  const actionMatrix = buildActionMatrix({ edge, currentPrice, invalidAbove, invalidBelow });
  const rangeText = edge?.support != null && edge.resistance != null ? `${edge.support.toFixed(2)}–${edge.resistance.toFixed(2)}` : "the active OI range";
  const baseTargetLast = basePath[basePath.length - 1]?.value ?? target;
  const magnetGapPct = magnet != null ? Math.abs((magnet - currentPrice) / currentPrice) * 100 : null;
  const baseDriftDirection = baseTargetLast > currentPrice * 1.003 ? "higher" : baseTargetLast < currentPrice * 0.997 ? "lower" : "sideways";
  const baseCase = magnet != null && magnetGapPct != null && magnetGapPct > 8
    ? `Inside ${rangeText}, base pressure currently favors ${baseDriftDirection === "higher" ? "holding or drifting toward the upper half of the active range" : baseDriftDirection === "lower" ? "softening toward the lower half of the active range" : "chop inside the active range"}. The ${magnet.toFixed(2)} OI magnet is a reversion reference if the active range weakens, not an immediate target.`
    : magnet != null
      ? `Inside ${rangeText}, base pressure favors chop or drift toward the ${magnet.toFixed(2)} magnet while structure holds.`
      : `Inside ${rangeText}, base pressure favors chop until a wall breaks.`;
  const bullishUnlockCase = invalidAbove != null
    ? `Acceptance above ${invalidAbove.toFixed(2)} activates the upside scenario; the green path begins at that rail, not at current spot.`
    : "Upside scenario activates only after price clears the call wall/resistance.";
  const bearishFailureCase = invalidBelow != null
    ? `Loss of ${invalidBelow.toFixed(2)} activates the downside failure scenario; the red path begins at that rail, not at current spot.`
    : "Downside scenario activates only after price loses the put wall/support.";

  const displaySummary = `${regimeLabel(regime)}. ${notes[0] ?? "Use this as an OI pressure map, not a candle-by-candle prediction."}`;

  return {
    ticker: projection?.ticker ?? edge?.ticker ?? "",
    snapshotDate: projection?.snapshotDate ?? edge?.snapshotDate ?? startDate,
    currentPrice,
    anchorExpiration,
    dominantExpiration,
    horizonSessions,
    regime,
    confidence,
    pathBias,
    activeScenario,
    tradePermissions,
    invalidAbove,
    invalidBelow,
    basePath: uniquePath(basePath),
    upperBand: uniquePath(upperBand),
    lowerBand: uniquePath(lowerBand),
    bullishUnlockPath: uniquePath(bullishUnlockPath),
    bearishFailurePath: uniquePath(bearishFailurePath),
    notes,
    triggerNotes,
    migrationNotes,
    confidenceDegraders,
    tradePlanNotes,
    actionMatrix,
    baseCase,
    bullishUnlockCase,
    bearishFailureCase,
    displaySummary
  };
}
