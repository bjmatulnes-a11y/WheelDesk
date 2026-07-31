import type { ZeroDteChainRow } from "../zeroDteOiIntelligence";

export type SchwabTokenRecord = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  scope: string | null;
  expires_at: string;
  refresh_expires_at: string | null;
  updated_at: string;
};

export type SchwabOptionContract = {
  symbol?: string;
  strikePrice?: number;
  expirationDate?: string;
  daysToExpiration?: number;
  bid?: number;
  ask?: number;
  last?: number;
  mark?: number;
  totalVolume?: number;
  openInterest?: number;
  volatility?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  rho?: number;
};

export type SchwabOptionChainResponse = {
  symbol?: string;
  status?: string;
  underlyingPrice?: number;
  volatility?: number;
  interestRate?: number;
  daysToExpiration?: number;
  callExpDateMap?: Record<string, Record<string, SchwabOptionContract[]>>;
  putExpDateMap?: Record<string, Record<string, SchwabOptionContract[]>>;
};

export type SchwabHarvestSymbol = {
  symbol: "SPX" | "SPY";
  providerSymbol: string;
  price: number;
  expirationTimestamp: number;
  expirationDate: string;
  isZeroDte: boolean;
  rows: ZeroDteChainRow[];
  source: "schwab";
};
