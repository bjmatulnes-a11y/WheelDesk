import { OverallBias, StructuralDirection, StructuralState, StructuralStrength, TacticalDecision } from "./types";

type TacticalInput = {
  structuralDirection: StructuralDirection;
  supportState: StructuralStrength;
  resistanceState: StructuralStrength;
  structuralState: StructuralState;
  overallBias: OverallBias;
  currentPrice: number;
  oiCenter: number;
  oiLowerRange: number;
  oiUpperRange: number;
  callWall: number;
  putWall: number;
  shares: number;
  shortCallStrike: number;
  shortCallDte: number;
  cashAvailable: number;
};

function near(price: number, level: number, pct = 0.01): boolean {
  return Math.abs(price - level) / Math.max(price, 0.01) <= pct;
}

export function deriveTacticalDecision(input: TacticalInput): TacticalDecision {
  const recommendedActions: string[] = [];
  const cautionFlags: string[] = [];

  if (input.structuralDirection === "lower" && input.supportState === "weakening") {
    recommendedActions.push("Avoid aggressive CSP entries; require deeper discount near/under lower range.");
    recommendedActions.push("Keep position defensive until put-side structure stabilizes.");
    cautionFlags.push("Downside exploration risk is elevated while support is degrading.");
  }

  if (input.structuralDirection === "higher" && input.supportState === "strengthening") {
    recommendedActions.push("Favor selective CSP entries closer to supportive strikes.");
    recommendedActions.push("Allow covered calls more upside room when choosing strike.");
  }

  if (input.structuralState === "compressing") {
    recommendedActions.push("Reduce sizing and avoid heavy one-direction exposure into compression.");
    recommendedActions.push("Prepare breakout plan above upper range and below lower range.");
    cautionFlags.push("Compression can release abruptly; avoid overconfidence in pinning.");
  }

  if (input.structuralState === "expanding") {
    recommendedActions.push("Use wider strike spacing and expectations due to expansion.");
    cautionFlags.push("Volatility regime appears wider; tight risk assumptions may fail.");
  }

  if (input.resistanceState === "strengthening" && input.currentPrice < input.callWall) {
    recommendedActions.push("Cap upside expectations near call wall; prefer CC strikes near resistance.");
    cautionFlags.push("Rejection risk increases when resistance strengthens above price.");
  }

  if (input.supportState === "strengthening" && input.currentPrice > input.putWall) {
    recommendedActions.push("Support under price improves CSP attractiveness on pullbacks.");
  }

  if (input.currentPrice < input.oiCenter && input.structuralDirection === "lower") {
    cautionFlags.push("Price below center while center falls = bearish pressure continuation risk.");
  }
  if (input.currentPrice >= input.oiLowerRange && input.currentPrice <= input.oiUpperRange && input.structuralState === "compressing") {
    recommendedActions.push("Price is inside range during compression; wait for break confirmation before scaling.");
  }
  if (near(input.currentPrice, input.callWall, 0.012) && input.resistanceState === "strengthening") {
    cautionFlags.push("Price is near call wall with stronger resistance; upside follow-through may stall.");
  }

  if (input.shortCallDte <= 7 && input.currentPrice >= input.shortCallStrike * 0.99) {
    recommendedActions.push("Short call is near strike with short DTE; evaluate roll timing now.");
  }

  if (input.cashAvailable <= 0) {
    cautionFlags.push("Limited cash buffer reduces flexibility for defensive adjustments.");
  }

  if (!recommendedActions.length) {
    recommendedActions.push("Maintain balanced posture and react to next structural update.");
  }

  let tacticalSummary = "Mixed tactical setup: keep risk moderate and adapt to structural confirmation.";
  if (input.overallBias === "constructive") tacticalSummary = "Constructive tactical setup: selectively lean bullish with disciplined entries.";
  if (input.overallBias === "defensive") tacticalSummary = "Defensive tactical setup: prioritize capital protection and conservative strike selection.";
  if (input.structuralState === "compressing") tacticalSummary = `${tacticalSummary} Compression suggests breakout setup.`;
  if (input.structuralState === "expanding") tacticalSummary = `${tacticalSummary} Expansion suggests wider movement and volatility.`;

  return {
    tacticalSummary,
    recommendedActions: recommendedActions.slice(0, 5),
    cautionFlags: cautionFlags.slice(0, 5)
  };
}

