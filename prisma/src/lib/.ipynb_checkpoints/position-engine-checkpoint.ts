import {
  BollingerBands,
  DecisionOutput,
  EngineMode,
  ExpirationSummary,
  SnapshotComparison,
  Timeframe
} from "./types";
import { PortfolioPosition, PortfolioProfile } from "./portfolio-types";

type EngineContext = {
  currentPrice: number;
  ticker: string;
  timeframe: Timeframe;
  oi: ExpirationSummary;
  bollinger: BollingerBands;
  portfolioProfile?: PortfolioProfile | null;
  tickerPositions?: PortfolioPosition[];
  structureComparison?: SnapshotComparison | null;
};

function tickerExposure(positions: PortfolioPosition[] = []) {
  const shares = positions
    .filter((p) => p.instrumentType === "stock")
    .reduce((sum, p) => sum + (p.side === "long" ? 1 : -1) * (p.qty ?? 0), 0);

  const shortCalls = positions.filter((p) => p.instrumentType === "call" && p.side === "short");
  const shortPuts = positions.filter((p) => p.instrumentType === "put" && p.side === "short");

  return { shares, shortCalls, shortPuts, hasPosition: positions.length > 0 };
}

function detectMode(ctx: EngineContext): EngineMode {
  const exposure = tickerExposure(ctx.tickerPositions);

  const nearestShortCall = exposure.shortCalls
    .filter((p) => typeof p.strike === "number")
    .sort((a, b) => Math.abs((a.strike ?? 0) - ctx.currentPrice) - Math.abs((b.strike ?? 0) - ctx.currentPrice))[0];

  const nearShortCall =
    nearestShortCall?.strike !== undefined &&
    Math.abs(ctx.currentPrice - nearestShortCall.strike) / Math.max(ctx.currentPrice, 0.01) <= 0.025;

  if (exposure.hasPosition && exposure.shares > 0 && ctx.currentPrice < ctx.oi.combinedCenter && ctx.currentPrice < ctx.oi.lowerRange) {
    return "recovery";
  }

  if (nearShortCall) return "assignment_risk";
  if (ctx.currentPrice >= ctx.oi.lowerRange && ctx.currentPrice <= ctx.oi.upperRange) return "income";
  return "decision_zone";
}

export function runPositionEngine(ctx: EngineContext): DecisionOutput {
  const mode = detectMode(ctx);
  const exposure = tickerExposure(ctx.tickerPositions);

  const upperBand = Number.isFinite(ctx.bollinger.upper) ? ctx.bollinger.upper : ctx.currentPrice * 1.02;
  const lowerBand = Number.isFinite(ctx.bollinger.lower) ? ctx.bollinger.lower : ctx.currentPrice * 0.98;

  const callAnchor = Math.min(upperBand, Math.max(ctx.oi.combinedCenter, ctx.oi.upperRange, ctx.oi.callWall));
  const putAnchor = Math.max(lowerBand, Math.min(ctx.oi.combinedCenter, ctx.oi.lowerRange, ctx.oi.putWall));

  const coveredCallZone = `${(callAnchor * 0.99).toFixed(2)} - ${(callAnchor * 1.02).toFixed(2)}`;

  const supportWeakening = ctx.structureComparison?.interpretation.supportState === "weakening";
  const cspLowMultiplier = supportWeakening ? 0.95 : 0.97;
  const cspZone = `${(putAnchor * cspLowMultiplier).toFixed(2)} - ${(putAnchor * 1.01).toFixed(2)}`;

  const reasoningBullets = [
    `${ctx.ticker} ${ctx.timeframe}: price ${ctx.currentPrice.toFixed(2)} vs OI center ${ctx.oi.combinedCenter.toFixed(2)}.`,
    `Selected chain walls: Call ${ctx.oi.callWall.toFixed(2)} / Put ${ctx.oi.putWall.toFixed(2)} with range ${ctx.oi.lowerRange.toFixed(2)}-${ctx.oi.upperRange.toFixed(2)}.`
  ];

  if (!exposure.hasPosition) {
    reasoningBullets.push("No matching portfolio position is selected for this ticker, so the decision is market-structure only.");
  } else {
    reasoningBullets.push(`Portfolio context: ${exposure.shares.toLocaleString()} shares, ${exposure.shortCalls.length} short call leg(s), ${exposure.shortPuts.length} short put leg(s).`);
  }

  if (ctx.currentPrice < ctx.oi.combinedCenter) reasoningBullets.push("Price below OI center → defensive / support-test lean.");
  if (ctx.currentPrice > ctx.oi.upperRange) reasoningBullets.push("Price above OI upper range → upside extension / call-side management focus.");
  if (ctx.currentPrice < ctx.oi.lowerRange) reasoningBullets.push("Price below OI lower range → downside exploration risk is elevated.");

  if (ctx.structureComparison) {
    reasoningBullets.push(`Snapshot structure: ${ctx.structureComparison.interpretation.narrative}`);
    reasoningBullets.push(`Tactical layer: ${ctx.structureComparison.tacticalDecision.tacticalSummary}`);
    reasoningBullets.push(
      `Execution anchors: CSP ${ctx.structureComparison.executionPlan.cspCandidateRange.low.toFixed(2)}-${ctx.structureComparison.executionPlan.cspCandidateRange.high.toFixed(2)}, CC ${ctx.structureComparison.executionPlan.coveredCallCandidateRange.low.toFixed(2)}-${ctx.structureComparison.executionPlan.coveredCallCandidateRange.high.toFixed(2)} (${ctx.structureComparison.executionPlan.confidence} confidence).`
    );
  }

  let primaryAction = "Monitor structure and wait for confirmation.";
  let marketStructureReadout = "Balanced structure: price is trading near the OI center with two-sided liquidity.";

  if (mode === "recovery") {
    primaryAction = exposure.hasPosition
      ? "Manage existing exposure defensively: prioritize basis repair and avoid adding aggressive downside risk."
      : "Structure is defensive; no portfolio position detected, so treat this as a watchlist support/recovery setup.";
    marketStructureReadout = "Recovery structure: price is below key structure and requires capital protection over premium maximization.";
  }

  if (mode === "income") {
    primaryAction = exposure.hasPosition
      ? "Run measured premium collection around OI center/range while respecting current portfolio exposure."
      : "Income structure detected, but no portfolio position is selected; use this as a candidate for wheel or premium planning.";
    marketStructureReadout = "Income structure: OI concentration supports systematic cycle management.";
  }

  if (mode === "decision_zone") {
    primaryAction = "Stay tactical: wait for cleaner alignment or use smaller sizing while monitoring wall migration.";
    marketStructureReadout = "Decision structure: price, center, and walls suggest mixed conviction.";
  }

  if (mode === "assignment_risk") {
    primaryAction = "Assignment risk is elevated: evaluate rolling, closing, or accepting assignment based on portfolio objective.";
    marketStructureReadout = "Assignment-risk structure: price is near a short call strike and requires active management.";
  }

  if (ctx.structureComparison) {
    marketStructureReadout = `${marketStructureReadout} ${ctx.structureComparison.interpretation.tacticalImplication} ${ctx.structureComparison.tacticalDecision.tacticalSummary} ${ctx.structureComparison.executionPlan.executionSummary}`;
  }

  const riskNotes = [
    "OI lines are structural references, not guarantees.",
    "Portfolio context is read from saved Portfolio profiles; update the Portfolio page if exposure is stale.",
    "Verify liquidity, collateral, and event risk before execution."
  ];

  return {
    detectedMode: mode,
    primaryAction,
    coveredCallZone,
    cspZone,
    marketStructureReadout,
    reasoningBullets,
    riskNotes
  };
}

export function calculateBollinger(candles: { close: number }[], period = 20): BollingerBands {
  const closes = candles.slice(-period).map((c) => c.close);
  const sma20 = closes.reduce((sum, c) => sum + c, 0) / Math.max(closes.length, 1);
  const variance = closes.reduce((sum, c) => sum + (c - sma20) ** 2, 0) / Math.max(closes.length, 1);
  const std = Math.sqrt(variance);

  return {
    sma20,
    upper: sma20 + std * 2,
    lower: sma20 - std * 2
  };
}