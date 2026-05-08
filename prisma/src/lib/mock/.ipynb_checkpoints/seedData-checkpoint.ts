import { OptionContract, StrategyRules } from "../analytics/types";

export const demoRules: StrategyRules = {
  minDte: 14,
  maxDte: 45,
  maxDelta: 0.35,
  minAnnualizedYield: 0.12,
  avoidEarnings: true
};

export const demoContracts: OptionContract[] = [
  {
    symbol: "AAPL",
    underlyingPrice: 210,
    strike: 220,
    expiry: "2026-05-15",
    dte: 28,
    premium: 3.2,
    delta: 0.27,
    iv: 0.24,
    hasEarningsBeforeExpiry: false
  },
  {
    symbol: "AAPL",
    underlyingPrice: 210,
    strike: 215,
    expiry: "2026-05-08",
    dte: 21,
    premium: 2.8,
    delta: 0.38,
    iv: 0.27,
    hasEarningsBeforeExpiry: false
  },
  {
    symbol: "MSFT",
    underlyingPrice: 465,
    strike: 450,
    expiry: "2026-05-22",
    dte: 35,
    premium: 5.5,
    delta: 0.31,
    iv: 0.22,
    hasEarningsBeforeExpiry: true
  }
];
