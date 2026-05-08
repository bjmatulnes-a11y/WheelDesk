import { OptionContract, RankedCandidate, StrategyRules } from "./types";

export function coveredCallAnnualizedYield(premium: number, strike: number, dte: number): number {
  if (strike <= 0 || dte <= 0) return 0;
  return (premium / strike) * (365 / dte);
}

export function rankCoveredCalls(contracts: OptionContract[], rules: StrategyRules): RankedCandidate[] {
  return contracts
    .filter((c) => c.dte >= rules.minDte && c.dte <= rules.maxDte)
    .filter((c) => c.delta <= rules.maxDelta)
    .filter((c) => !rules.avoidEarnings || !c.hasEarningsBeforeExpiry)
    .map((c) => {
      const annualizedYield = coveredCallAnnualizedYield(c.premium, c.strike, c.dte);
      const yieldScore = Math.min(annualizedYield / Math.max(rules.minAnnualizedYield, 0.0001), 2);
      const deltaPenalty = Math.max(0, c.delta - rules.maxDelta) * 2;
      const score = Math.max(0, yieldScore - deltaPenalty + (c.hasEarningsBeforeExpiry ? -0.4 : 0));

      const assignmentRiskBand: RankedCandidate["assignmentRiskBand"] = c.delta < 0.25 ? "low" : c.delta < 0.4 ? "medium" : "high";
      const rationale = [
        `Annualized yield ${(annualizedYield * 100).toFixed(2)}%`,
        `Delta ${c.delta.toFixed(2)} implies ${assignmentRiskBand} assignment pressure`,
        c.hasEarningsBeforeExpiry ? "Earnings before expiry adds event risk" : "No earnings event before expiry"
      ];

      return { contract: c, annualizedYield, assignmentRiskBand, score, rationale };
    })
    .filter((r) => r.annualizedYield >= rules.minAnnualizedYield)
    .sort((a, b) => b.score - a.score);
}
