import { type DealerPressureSummary } from "./dealer-pressure-engine";
import { type OIImpliedPathResult } from "./oi-implied-path-engine";
import { type PredictiveMatrixResult, type PredictiveScenarioKey } from "./predictive-matrix-engine";
import { type TraderEdgeSummary } from "./trader-edge-engine";
import { type WallMigrationSummary } from "./oi-wall-migration-engine";
import { type PortfolioPosition } from "./portfolio-types";

export type ControlActionKey =
  | "wait"
  | "sell_covered_call"
  | "roll_covered_call_up_out"
  | "sell_cash_secured_put"
  | "roll_put_down_out"
  | "add_long_call"
  | "close_or_defend_short_call"
  | "reduce_short_premium";

export type AdaptiveControlRow = {
  key: ControlActionKey;
  action: string;
  score: number;
  whenValid: string;
  warning: string;
  rationale: string[];
};

export type ScenarioControl = {
  scenario: PredictiveScenarioKey | "unknown";
  label: string;
  trigger: string;
  preferredAction: string;
  avoidAction: string;
};

export type ControlBand = {
  label: string;
  value: number | null;
  tone: "bullish" | "bearish" | "neutral" | "warning";
};

export type AdaptivePositionControlResult = {
  ticker: string;
  snapshotDate: string;
  currentState: string;
  optimalAction: string;
  optimalActionKey: ControlActionKey;
  actionScore: number;
  confidence: number;
  confidenceLabel: "low" | "medium" | "high";
  avoidActions: string[];
  controlBands: ControlBand[];
  scenarioActions: ScenarioControl[];
  rows: AdaptiveControlRow[];
  triggerMap: string[];
  explanation: string;
  riskNotes: string[];
};

type PositionContext = {
  shares: number;
  shortCalls: PortfolioPosition[];
  shortPuts: PortfolioPosition[];
  longCalls: PortfolioPosition[];
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function round0(value: number): number {
  return Math.round(clamp(value));
}

function money(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return value.toFixed(2);
}

function confidenceLabel(score: number): "low" | "medium" | "high" {
  if (score >= 70) return "high";
  if (score >= 52) return "medium";
  return "low";
}

function summarizePositions(positions?: PortfolioPosition[] | null, ticker?: string): PositionContext {
  const upper = String(ticker ?? "").toUpperCase();
  const matching = (positions ?? []).filter((position) => String(position.symbol ?? "").toUpperCase() === upper);

  return {
    shares: matching
      .filter((position) => position.instrumentType === "stock")
      .reduce((sum, position) => sum + (position.side === "long" ? 1 : -1) * (position.qty ?? 0), 0),
    shortCalls: matching.filter((position) => position.instrumentType === "call" && position.side === "short"),
    shortPuts: matching.filter((position) => position.instrumentType === "put" && position.side === "short"),
    longCalls: matching.filter((position) => position.instrumentType === "call" && position.side === "long")
  };
}

function dominantState(args: {
  path?: OIImpliedPathResult | null;
  dealer?: DealerPressureSummary | null;
  matrix?: PredictiveMatrixResult | null;
  wallMigration?: WallMigrationSummary | null;
}): string {
  if (args.dealer?.regime === "Pin-to-snap") return "Pin-to-Snap Regime";
  if (args.dealer?.regime === "Volatility expansion / amplification") return "Expansion / Amplification Regime";
  if (args.dealer?.regime === "Volatility suppression / pinning") return "Pin / Premium-Harvest Regime";
  if (args.path?.activeScenario === "bullish_unlock") return "Bullish Unlock Active";
  if (args.path?.activeScenario === "bearish_failure") return "Bearish Failure Active";
  if (args.wallMigration?.migrationBias === "compression") return "Compression / Pin Risk";
  if (args.matrix?.primaryScenario === "bullish_unlock") return "Bullish Unlock Watch";
  if (args.matrix?.primaryScenario === "bearish_failure") return "Bearish Failure Watch";
  return args.path?.regime ? args.path.regime.replace(/_/g, " ") : "Structure Awaiting Confirmation";
}

function scoreWait(args: {
  dealer?: DealerPressureSummary | null;
  matrix?: PredictiveMatrixResult | null;
  edge?: TraderEdgeSummary | null;
}): number {
  let score = 58;
  if (args.dealer?.regime === "Pin-to-snap") score += 18;
  if (args.dealer?.regime === "Stale / low confidence") score += 20;
  if ((args.matrix?.modelScore ?? 0) < 55) score += 12;
  if ((args.edge?.trapRisk ?? 0) >= 70) score += 10;
  if (args.dealer?.regime === "Volatility suppression / pinning") score -= 7;
  return round0(score);
}

function scoreSellCoveredCall(args: {
  context: PositionContext;
  dealer?: DealerPressureSummary | null;
  matrix?: PredictiveMatrixResult | null;
  path?: OIImpliedPathResult | null;
  edge?: TraderEdgeSummary | null;
}): number {
  if (args.context.shares < 100) return 0;

  let score = 50;
  if (args.dealer?.regime === "Volatility suppression / pinning") score += 18;
  if (args.dealer?.regime === "Pin-to-snap") score -= 12;
  if (args.dealer?.regime === "Volatility expansion / amplification") score -= 18;
  if (args.matrix?.primaryScenario === "bullish_unlock") score -= 22;
  if (args.path?.activeScenario === "bullish_unlock") score -= 28;
  if ((args.edge?.coveredCallScore ?? 0) > 65) score += 8;
  if ((args.edge?.trapRisk ?? 0) > 70) score -= 18;
  if ((args.dealer?.snapRiskScore ?? 0) > 65) score -= 14;
  return round0(score);
}

function scoreRollCall(args: {
  context: PositionContext;
  dealer?: DealerPressureSummary | null;
  matrix?: PredictiveMatrixResult | null;
  path?: OIImpliedPathResult | null;
}): number {
  if (!args.context.shortCalls.length) return 0;

  let score = 45;
  if (args.matrix?.primaryScenario === "bullish_unlock") score += 18;
  if (args.path?.activeScenario === "bullish_unlock") score += 24;
  if (args.dealer?.hedgeFlowBias === "bullish") score += 10;
  if (args.dealer?.regime === "Volatility expansion / amplification") score += 7;
  if (args.dealer?.regime === "Volatility suppression / pinning") score -= 8;
  return round0(score);
}

function scoreSellCsp(args: {
  context: PositionContext;
  dealer?: DealerPressureSummary | null;
  matrix?: PredictiveMatrixResult | null;
  path?: OIImpliedPathResult | null;
  edge?: TraderEdgeSummary | null;
}): number {
  let score = 48;
  if (args.dealer?.regime === "Volatility suppression / pinning") score += 12;
  if (args.matrix?.primaryScenario === "bearish_failure") score -= 24;
  if (args.path?.activeScenario === "bearish_failure") score -= 30;
  if (args.dealer?.hedgeFlowBias === "bearish") score -= 15;
  if ((args.edge?.cspScore ?? 0) > 65) score += 10;
  if ((args.edge?.supportEvidenceScore ?? 0) > 70) score += 7;
  if ((args.dealer?.snapRiskScore ?? 0) > 65) score -= 12;
  return round0(score);
}

function scoreAddLongCall(args: {
  dealer?: DealerPressureSummary | null;
  matrix?: PredictiveMatrixResult | null;
  path?: OIImpliedPathResult | null;
  edge?: TraderEdgeSummary | null;
}): number {
  let score = 35;
  if (args.matrix?.primaryScenario === "bullish_unlock") score += 18;
  if (args.path?.activeScenario === "bullish_unlock") score += 22;
  if (args.dealer?.hedgeFlowBias === "bullish") score += 10;
  if (args.dealer?.regime === "Volatility expansion / amplification") score += 10;
  if (args.dealer?.regime === "Volatility suppression / pinning") score -= 12;
  if ((args.edge?.volumeThrust ?? 0) > 1.25) score += 6;
  return round0(score);
}

function scoreReduceShortPremium(args: {
  dealer?: DealerPressureSummary | null;
  matrix?: PredictiveMatrixResult | null;
  edge?: TraderEdgeSummary | null;
}): number {
  let score = 28;
  if (args.dealer?.regime === "Pin-to-snap") score += 22;
  if (args.dealer?.regime === "Volatility expansion / amplification") score += 28;
  if (args.matrix?.primaryScenario === "volatility_expansion") score += 18;
  if ((args.edge?.trapRisk ?? 0) > 70) score += 12;
  return round0(score);
}

function buildRows(args: {
  context: PositionContext;
  path?: OIImpliedPathResult | null;
  dealer?: DealerPressureSummary | null;
  matrix?: PredictiveMatrixResult | null;
  edge?: TraderEdgeSummary | null;
}): AdaptiveControlRow[] {
  const bullishRail = money(args.matrix?.bullishUnlock ?? args.path?.invalidAbove);
  const bearishRail = money(args.matrix?.bearishFailure ?? args.path?.invalidBelow);
  const ccFloor = money(args.edge?.executableCoveredCallFloor ?? args.matrix?.expectedRangeHigh);
  const cspCeiling = money(args.edge?.executableCspCeiling ?? args.matrix?.expectedRangeLow);

  const rows: AdaptiveControlRow[] = [
    {
      key: "wait",
      action: "Wait",
      score: scoreWait(args),
      whenValid: `Inside ${bearishRail} – ${bullishRail} or confidence below high`,
      warning: "Do not overtrade the middle of the cone",
      rationale: [
        "Waiting is a valid control input when price remains inside the active OI range.",
        args.dealer?.regime ? `Dealer regime: ${args.dealer.regime}.` : "Dealer pressure unavailable."
      ]
    },
    {
      key: "sell_covered_call",
      action: "Sell CC",
      score: scoreSellCoveredCall(args),
      whenValid: `Only above ${ccFloor} and below bullish unlock risk`,
      warning: "Do not sell tight calls into unlock/snap risk",
      rationale: [
        `Covered-call floor: ${ccFloor}.`,
        args.matrix?.primaryScenario === "bullish_unlock" ? "Bullish unlock is the lead scenario; cap risk is elevated." : "Covered calls are cleaner when price remains contained."
      ]
    },
    {
      key: "roll_covered_call_up_out",
      action: "Roll CC Up/Out",
      score: scoreRollCall(args),
      whenValid: `Above ${bullishRail} or short calls are inside the forecast cone`,
      warning: "Roll only if acceptance holds; avoid chasing a single wick",
      rationale: [
        args.context.shortCalls.length ? `${args.context.shortCalls.length} short call leg(s) detected.` : "No short call leg detected.",
        "This protects upside when old call walls convert into fuel."
      ]
    },
    {
      key: "sell_cash_secured_put",
      action: "Sell CSP",
      score: scoreSellCsp(args),
      whenValid: `Below ${cspCeiling} and only if assignment is acceptable`,
      warning: `Avoid CSPs near/below bearish failure ${bearishRail}`,
      rationale: [
        `CSP ceiling: ${cspCeiling}.`,
        args.matrix?.primaryScenario === "bearish_failure" ? "Bearish failure risk is elevated; put support may not hold." : "CSPs are cleaner below confirmed support."
      ]
    },
    {
      key: "add_long_call",
      action: "Add Long Call / Defined Risk",
      score: scoreAddLongCall(args),
      whenValid: `Above ${bullishRail} or volatility expansion confirms`,
      warning: "Manage cost, duration, and IV crush",
      rationale: [
        "Long convexity is favored only after confirmation or when expansion risk dominates.",
        args.dealer?.hedgeFlowBias ? `Pressure bias: ${args.dealer.hedgeFlowBias}.` : "Pressure bias unavailable."
      ]
    },
    {
      key: "reduce_short_premium",
      action: "Reduce Short Premium",
      score: scoreReduceShortPremium(args),
      whenValid: "Pin-to-snap, expansion, or high trap risk",
      warning: "Short premium can be right until it suddenly is not",
      rationale: [
        `Snap risk: ${money(args.dealer?.snapRiskScore)} / 100.`,
        `Trap risk: ${money(args.edge?.trapRisk)} / 100.`
      ]
    }
  ];

  return rows.sort((a, b) => b.score - a.score);
}

function buildScenarioActions(matrix?: PredictiveMatrixResult | null): ScenarioControl[] {
  if (!matrix) return [];

  return matrix.rows.map((row) => {
    if (row.key === "bullish_unlock") {
      return {
        scenario: row.key,
        label: row.scenario,
        trigger: row.activation,
        preferredAction: "Preserve upside; roll/repair capped calls only after acceptance.",
        avoidAction: "Avoid selling tight covered calls under the upper forecast band."
      };
    }

    if (row.key === "bearish_failure") {
      return {
        scenario: row.key,
        label: row.scenario,
        trigger: row.activation,
        preferredAction: "Pause or lower CSP strikes; protect short puts.",
        avoidAction: "Avoid treating the broken put wall as safe support."
      };
    }

    if (row.key === "volatility_expansion") {
      return {
        scenario: row.key,
        label: row.scenario,
        trigger: row.activation,
        preferredAction: "Reduce short-gamma exposure or use defined-risk structures.",
        avoidAction: "Avoid stacking naked short premium into an expanding range."
      };
    }

    return {
      scenario: row.key,
      label: row.scenario,
      trigger: row.activation,
      preferredAction: "Harvest premium outside the active cone only.",
      avoidAction: "Avoid selling directly at the magnet or inside the forecast cone."
    };
  });
}

export function buildAdaptivePositionControl(args: {
  ticker: string;
  positions?: PortfolioPosition[] | null;
  path?: OIImpliedPathResult | null;
  predictiveMatrix?: PredictiveMatrixResult | null;
  dealerPressure?: DealerPressureSummary | null;
  edgeSummary?: TraderEdgeSummary | null;
  wallMigration?: WallMigrationSummary | null;
}): AdaptivePositionControlResult | null {
  const matrix = args.predictiveMatrix ?? null;
  const path = args.path ?? null;
  const dealer = args.dealerPressure ?? null;
  const edge = args.edgeSummary ?? null;

  if (!matrix && !path && !dealer && !edge) return null;

  const ticker = String(args.ticker || matrix?.ticker || path?.ticker || dealer?.ticker || edge?.ticker || "").toUpperCase();
  const context = summarizePositions(args.positions, ticker);
  const rows = buildRows({ context, path, dealer, matrix, edge });
  const optimal = rows[0];
  const confidence = round0((matrix?.modelScore ?? dealer?.confidenceScore ?? edge?.dataQualityScore ?? 45) * 0.72 + (dealer?.confidenceScore ?? 45) * 0.28);

  const bullishUnlock = matrix?.bullishUnlock ?? path?.invalidAbove ?? edge?.resistance ?? null;
  const bearishFailure = matrix?.bearishFailure ?? path?.invalidBelow ?? edge?.support ?? null;
  const magnet = edge?.magnet ?? dealer?.magnet ?? null;

  const avoidActions = rows
    .filter((row) => row.score < 45)
    .slice(0, 3)
    .map((row) => `${row.action}: ${row.warning}`);

  const triggerMap = [
    bearishFailure != null ? `Below ${money(bearishFailure)}: bearish failure control mode.` : "Bearish failure rail unavailable.",
    magnet != null ? `Near ${money(magnet)}: magnet/pin behavior can dominate.` : "Magnet unavailable.",
    bullishUnlock != null ? `Above ${money(bullishUnlock)}: bullish unlock control mode.` : "Bullish unlock rail unavailable."
  ];

  const riskNotes = [
    ...(matrix?.warnings ?? []),
    ...(dealer?.riskNotes ?? []),
    ...(edge?.trapNotes ?? [])
  ].slice(0, 6);

  return {
    ticker,
    snapshotDate: matrix?.snapshotDate ?? path?.snapshotDate ?? dealer?.snapshotDate ?? edge?.snapshotDate ?? "",
    currentState: dominantState({ path, dealer, matrix, wallMigration: args.wallMigration }),
    optimalAction: optimal?.action ?? "Wait",
    optimalActionKey: optimal?.key ?? "wait",
    actionScore: optimal?.score ?? 0,
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    avoidActions,
    controlBands: [
      { label: "Bearish Failure", value: bearishFailure, tone: "bearish" },
      { label: "Magnet", value: magnet, tone: "warning" },
      { label: "Bullish Unlock", value: bullishUnlock, tone: "bullish" },
      { label: "EV Target", value: matrix?.expectedValueTarget ?? path?.basePath?.at(-1)?.value ?? null, tone: "neutral" }
    ],
    scenarioActions: buildScenarioActions(matrix),
    rows,
    triggerMap,
    explanation: `${dominantState({ path, dealer, matrix, wallMigration: args.wallMigration })}: optimal control is ${optimal?.action ?? "Wait"} with a ${optimal?.score ?? 0}/100 action score. This is a receding-horizon control read; refresh as candles/OI surfaces update.`,
    riskNotes
  };
}
