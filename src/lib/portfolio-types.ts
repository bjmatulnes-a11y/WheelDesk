export type InstrumentType = "stock" | "call" | "put";
export type Side = "long" | "short";
export type RiskProfileMode = "expiration" | "theoretical";

export type PortfolioCashOutline = {
  cashBalance?: number;
  buyingPower?: number;
  manualReserve?: number;
  notes?: string;
};

export type PortfolioPosition = {
  id: string;
  symbol: string;
  instrumentType: InstrumentType;
  qty?: number;
  side: Side;

  expiration?: string;
  strike?: number;

  // User-entered entry basis:
  // stock = cost basis/share
  // option = entry premium/share
  entryPrice?: number;

  // Optional user override. If blank, Yahoo IV is used when available.
  manualIv?: number;

  includeInRiskProfile?: boolean;

  riskFreeRate?: number;
  bpEffect?: number;
  yieldPct?: number;
};

export type PositionGreeks = {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
};

export type AggregateGreeks = PositionGreeks & {
  totalPlDay: number;
  totalPlOpen: number;
  totalBpEffect: number;
};

export type PriceSlice = {
  id: string;
  underlyingPrice?: number;
};

export type SliceResult = {
  id: string;
  underlyingPrice?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  plAtSlice?: number;
  theoreticalNetLiq?: number;
  bpEffect?: number;
};

export type PortfolioProfile = {
  id: string;
  name: string;
  positions: PortfolioPosition[];
  slices: PriceSlice[];
  cashOutline?: PortfolioCashOutline;
  updatedAt: string;
};

export type UnderlyingQuote = {
  currentPrice?: number;
  previousClose?: number;
};

export type OptionQuote = {
  mark?: number;
  previousCloseMark?: number;
  impliedVolatility?: number;
  bid?: number;
  ask?: number;
  lastPrice?: number;
  openInterest?: number;
  volume?: number;
};

export type UnderlyingQuoteMap = Record<string, UnderlyingQuote>;
export type OptionQuoteMap = Record<string, OptionQuote>;

export type MarketQuoteContext = {
  underlyingQuotes: UnderlyingQuoteMap;
  optionQuotes: OptionQuoteMap;
};

export type EnrichedPortfolioPosition = PortfolioPosition &
  PositionGreeks & {
    mark?: number;
    iv?: number;
    theoreticalValue?: number;
    currentUnderlyingPrice?: number;
    previousCloseUnderlyingPrice?: number;
    plDay?: number;
    plOpen?: number;
  };

export type RiskProfilePoint = {
  price: number;
  pl: number;
};
