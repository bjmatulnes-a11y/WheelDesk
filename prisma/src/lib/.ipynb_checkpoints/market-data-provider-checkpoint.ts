export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type UnderlyingQuote = {
  symbol: string;
  price?: number;
  previousClose?: number;
  currency?: string;
};

export type OptionContract = {
  contractSymbol?: string;
  strike: number;
  expiration?: string;
  impliedVolatility?: number;
  openInterest?: number;
  volume?: number;
  bid?: number;
  ask?: number;
  lastPrice?: number;
  inTheMoney?: boolean;
};

export type OptionChain = {
  symbol: string;
  expirationDate?: string;
  expirationTimestamp?: number;
  calls: OptionContract[];
  puts: OptionContract[];
};

export interface MarketDataProvider {
  getQuote(symbol: string): Promise<UnderlyingQuote>;
  getCandles(symbol: string, range?: string, interval?: string): Promise<Candle[]>;
  getOptionExpirations(symbol: string): Promise<number[]>;
  getOptionChain(symbol: string, expirationTimestamp?: number): Promise<OptionChain>;
}