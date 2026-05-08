import { OptionContract, RankedCandidate, StrategyRules } from "./types";

export function cspAnnualizedYield(premium: number, strike: number, dte: number): number {
  if (strike <= 0 || dte <= 0) return 0;
  return (premium / strike) * (365 / dte);
}

export function rankCashSecuredPuts(contracts: OptionContract[], rules: StrategyRules): RankedCandidate[] {
  return contracts
    .filter((c) => c.dte >= rules.minDte && c.dte <= rules.maxDte)
    .filter((c) => c.delta <= rules.maxDelta)
    .filter((c) => !rules.avoidEarnings || !c.hasEarningsBeforeExpiry)
    .map((c) => {
      const annualizedYield = cspAnnualizedYield(c.premium, c.strike, c.dte);
      const yieldScore = Math.min(annualizedYield / Math.max(rules.minAnnualizedYield, 0.0001), 2);
      const moneynessBuffer = (c.underlyingPrice - c.strike) / c.underlyingPrice;
      const bufferBonus = Math.max(0, moneynessBuffer) * 2;
      const score = Math.max(0, yieldScore + bufferBonus - c.delta);

      const assignmentRiskBand: RankedCandidate["assignmentRiskBand"] = c.delta < 0.2 ? "low" : c.delta < 0.35 ? "medium" : "high";
      const rationale = [
        `Annualized yield ${(annualizedYield * 100).toFixed(2)}%`,
        `Strike buffer ${(moneynessBuffer * 100).toFixed(2)}% below spot`,
        `Assignment risk band: ${assignmentRiskBand}`
      ];

      return { contract: c, annualizedYield, assignmentRiskBand, score, rationale };
    })
    .filter((r) => r.annualizedYield >= rules.minAnnualizedYield)
    .sort((a, b) => b.score - a.score);
}
