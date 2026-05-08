import {
  AggregateGreeks,
  EnrichedPortfolioPosition,
  MarketQuoteContext,
  OptionQuote,
  PortfolioPosition,
  PositionGreeks
} from "./portfolio-types";
import { makeOptionQuoteKey } from "./option-quote-key";

const CONTRACT_MULTIPLIER = 100;
const DEFAULT_RATE = 0.045;
const EPSILON_T = 1 / 3650;

function sideSign(side: "long" | "short"): number {
  return side === "long" ? 1 : -1;
}

function cleanNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function positiveOr(value: unknown, fallback: number): number {
  const n = cleanNumber(value);
  return n !== undefined && n > 0 ? n : fallback;
}

function yearsToExpiration(expiration?: string, valuationDate: Date = new Date()): number {
  if (!expiration) return EPSILON_T;
  const expiry = new Date(`${expiration}T16:00:00`);
  const ms = expiry.getTime() - valuationDate.getTime();
  return Math.max(ms / (1000 * 60 * 60 * 24 * 365), EPSILON_T);
}

function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * z);

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;

  const erf =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) *
      Math.exp(-z * z);

  return 0.5 * (1 + sign * erf);
}

function d1(S: number, K: number, r: number, sigma: number, T: number): number {
  return (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
}

function d2(S: number, K: number, r: number, sigma: number, T: number): number {
  return d1(S, K, r, sigma, T) - sigma * Math.sqrt(T);
}

function getUnderlyingSpot(position: PortfolioPosition, context: MarketQuoteContext): number | undefined {
  return cleanNumber(context.underlyingQuotes[position.symbol?.toUpperCase()]?.currentPrice);
}

function getUnderlyingPrevClose(position: PortfolioPosition, context: MarketQuoteContext): number | undefined {
  return cleanNumber(context.underlyingQuotes[position.symbol?.toUpperCase()]?.previousClose);
}

function getOptionQuote(position: PortfolioPosition, context: MarketQuoteContext): OptionQuote | undefined {
  const key = makeOptionQuoteKey(
    position.symbol,
    position.expiration,
    position.instrumentType,
    position.strike
  );

  if (!key) return undefined;
  return context.optionQuotes[key];
}

function optionMarkFromQuote(quote?: OptionQuote): number | undefined {
  if (!quote) return undefined;

  const bid = cleanNumber(quote.bid);
  const ask = cleanNumber(quote.ask);

  if (bid !== undefined && ask !== undefined && bid >= 0 && ask > 0) {
    return (bid + ask) / 2;
  }

  return cleanNumber(quote.mark) ?? cleanNumber(quote.lastPrice);
}

export function blackScholesPrice(
  optionType: "call" | "put",
  S: number,
  K: number,
  T: number,
  sigma: number,
  r: number
): number {
  S = positiveOr(S, 0.01);
  K = positiveOr(K, 0.01);
  sigma = positiveOr(sigma, 0.25);
  T = Math.max(T, EPSILON_T);

  const d_1 = d1(S, K, r, sigma, T);
  const d_2 = d2(S, K, r, sigma, T);

  if (optionType === "call") {
    return S * normCdf(d_1) - K * Math.exp(-r * T) * normCdf(d_2);
  }

  return K * Math.exp(-r * T) * normCdf(-d_2) - S * normCdf(-d_1);
}

export function blackScholesGreeks(
  optionType: "call" | "put",
  S: number,
  K: number,
  T: number,
  sigma: number,
  r: number
): PositionGreeks & { theoreticalValue: number } {
  S = positiveOr(S, 0.01);
  K = positiveOr(K, 0.01);
  sigma = positiveOr(sigma, 0.25);
  T = Math.max(T, EPSILON_T);

  const d_1 = d1(S, K, r, sigma, T);
  const d_2 = d2(S, K, r, sigma, T);
  const pdf = normPdf(d_1);

  const callDelta = normCdf(d_1);
  const putDelta = callDelta - 1;
  const gamma = pdf / (S * sigma * Math.sqrt(T));
  const vega = S * pdf * Math.sqrt(T);
  const commonTheta = -(S * pdf * sigma) / (2 * Math.sqrt(T));

  const callTheta =
    commonTheta - r * K * Math.exp(-r * T) * normCdf(d_2);

  const putTheta =
    commonTheta + r * K * Math.exp(-r * T) * normCdf(-d_2);

  return {
    theoreticalValue: blackScholesPrice(optionType, S, K, T, sigma, r),
    delta: optionType === "call" ? callDelta : putDelta,
    gamma,
    theta: optionType === "call" ? callTheta : putTheta,
    vega
  };
}

export function estimatePositionGreeks(
  position: PortfolioPosition,
  context: MarketQuoteContext,
  valuationDate: Date = new Date()
): PositionGreeks & { theoreticalValue?: number; mark?: number; iv?: number } {
  const sign = sideSign(position.side);
  const qty = positiveOr(position.qty, 0);

  if (!position.symbol || qty === 0) {
    return { delta: 0, gamma: 0, theta: 0, vega: 0 };
  }

  const spot = getUnderlyingSpot(position, context);

  if (!spot) {
    return { delta: 0, gamma: 0, theta: 0, vega: 0 };
  }

  if (position.instrumentType === "stock") {
    return {
      delta: sign * qty,
      gamma: 0,
      theta: 0,
      vega: 0,
      mark: spot
    };
  }

  const quote = getOptionQuote(position, context);
  const strike = positiveOr(position.strike, spot);
  const marketIv =
      cleanNumber(position.manualIv) ??
      cleanNumber(quote?.impliedVolatility);
  console.log("IV DEBUG", {
      symbol: position.symbol,
      expiration: position.expiration,
      type: position.instrumentType,
      strike: position.strike,
      manualIv: position.manualIv,
      yahooIv: quote?.impliedVolatility,
      marketIv
});

  const pricingIv = marketIv ?? 0.25;
    
  const r = cleanNumber(position.riskFreeRate) ?? DEFAULT_RATE;
  const T = yearsToExpiration(position.expiration, valuationDate);

  const bs = blackScholesGreeks(position.instrumentType, spot, strike, T, pricingIv, r);
  const mark = optionMarkFromQuote(quote) ?? bs.theoreticalValue;
  const scale = sign * qty * CONTRACT_MULTIPLIER;

  return {
    theoreticalValue: bs.theoreticalValue,
    mark,
    delta: bs.delta * scale,
    gamma: bs.gamma * scale,
    theta: (bs.theta / 365) * scale,
    vega: (bs.vega / 100) * scale
  };
}

function calculatePositionPnL(
  position: PortfolioPosition,
  context: MarketQuoteContext,
  valuationDate: Date = new Date()
): {
  plDay: number;
  plOpen: number;
  theoreticalValue?: number;
  mark?: number;
  iv?: number;
  currentSpot?: number;
  previousClose?: number;
} {
  const sign = sideSign(position.side);
  const qty = positiveOr(position.qty, 0);

  if (!position.symbol || qty === 0) {
    return { plDay: 0, plOpen: 0 };
  }

  const currentSpot = getUnderlyingSpot(position, context);
  const previousClose = getUnderlyingPrevClose(position, context);

  if (!currentSpot) {
    return { plDay: 0, plOpen: 0 };
  }

  if (position.instrumentType === "stock") {
    const entry = cleanNumber(position.entryPrice);
    const prev = previousClose ?? currentSpot;

    return {
      currentSpot,
      previousClose: prev,
      mark: currentSpot,
      plDay: sign * qty * (currentSpot - prev),
      plOpen: entry === undefined ? 0 : sign * qty * (currentSpot - entry)
    };
  }

  const greeks = estimatePositionGreeks(position, context, valuationDate);
  const quote = getOptionQuote(position, context);
  const entryPremium = cleanNumber(position.entryPrice);

  const currentValue =
    cleanNumber(greeks.mark) ??
    cleanNumber(quote?.lastPrice) ??
    cleanNumber(greeks.theoreticalValue) ??
    0;

  const previousValue =
    cleanNumber(quote?.previousCloseMark) ??
    cleanNumber(greeks.theoreticalValue) ??
    currentValue;

  const scale = sign * qty * CONTRACT_MULTIPLIER;

  return {
    currentSpot,
    previousClose,
    mark: currentValue,
    iv: greeks.iv,
    theoreticalValue: greeks.theoreticalValue,
    plDay: scale * (currentValue - previousValue),
    plOpen: entryPremium === undefined ? 0 : scale * (currentValue - entryPremium)
  };
}

export function enrichPositionsWithGreeks(
  positions: PortfolioPosition[],
  context: MarketQuoteContext,
  valuationDate: Date = new Date()
): EnrichedPortfolioPosition[] {
  return positions.map((p) => {
    const greeks = estimatePositionGreeks(p, context, valuationDate);
    const pnl = calculatePositionPnL(p, context, valuationDate);

    return {
      ...p,
      includeInRiskProfile: p.includeInRiskProfile !== false,
      delta: greeks.delta,
      gamma: greeks.gamma,
      theta: greeks.theta,
      vega: greeks.vega,
      theoreticalValue: greeks.theoreticalValue ?? pnl.theoreticalValue,
      mark: pnl.mark ?? greeks.mark,
      iv: pnl.iv ?? greeks.iv,
      currentUnderlyingPrice: pnl.currentSpot,
      previousCloseUnderlyingPrice: pnl.previousClose,
      plDay: pnl.plDay,
      plOpen: pnl.plOpen
    };
  });
}

export function aggregateGreeks(
  positions: PortfolioPosition[],
  context: MarketQuoteContext,
  valuationDate: Date = new Date()
): AggregateGreeks {
  return positions.reduce<AggregateGreeks>(
    (acc, p) => {
      const greeks = estimatePositionGreeks(p, context, valuationDate);
      const pnl = calculatePositionPnL(p, context, valuationDate);

      return {
        delta: acc.delta + greeks.delta,
        gamma: acc.gamma + greeks.gamma,
        theta: acc.theta + greeks.theta,
        vega: acc.vega + greeks.vega,
        totalPlDay: acc.totalPlDay + pnl.plDay,
        totalPlOpen: acc.totalPlOpen + pnl.plOpen,
        totalBpEffect: acc.totalBpEffect + (cleanNumber(p.bpEffect) ?? 0)
      };
    },
    {
      delta: 0,
      gamma: 0,
      theta: 0,
      vega: 0,
      totalPlDay: 0,
      totalPlOpen: 0,
      totalBpEffect: 0
    }
  );
}