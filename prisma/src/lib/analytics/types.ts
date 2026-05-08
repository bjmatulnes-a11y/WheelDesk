export type OptionContract = {
  symbol: string;
  underlyingPrice: number;
  strike: number;
  expiry: string;
  dte: number;
  premium: number;
  delta: number;
  iv: number;
  hasEarningsBeforeExpiry: boolean;
};

export type StrategyRules = {
  minDte: number;
  maxDte: number;
  maxDelta: number;
  minAnnualizedYield: number;
  avoidEarnings: boolean;
};

export type RankedCandidate = {
  contract: OptionContract;
  annualizedYield: number;
  assignmentRiskBand: "low" | "medium" | "high";
  score: number;
  rationale: string[];
};
