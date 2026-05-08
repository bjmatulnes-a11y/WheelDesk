import {
  MarketQuoteContext,
  PortfolioPosition,
  PriceSlice,
  RiskProfileMode,
  RiskProfilePoint,
  SliceResult
} from "./portfolio-types";
import { blackScholesPrice, estimatePositionGreeks } from "./greeks-engine";

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

function optionIntrinsicAtExpiration(
  optionType: "call" | "put",
  stockPrice: number,
  strike: number
): number {
  return optionType === "call"
    ? Math.max(stockPrice - strike, 0)
    : Math.max(strike - stockPrice, 0);
}

function yearsToExpiration(expiration?: string, valuationDate: Date = new Date()): number {
  if (!expiration) return EPSILON_T;
  const expiry = new Date(`${expiration}T16:00:00`);
  const ms = expiry.getTime() - valuationDate.getTime();
  return Math.max(ms / (1000 * 60 * 60 * 24 * 365), EPSILON_T);
}

function positionPnLAtPrice(
  position: PortfolioPosition,
  stockPrice: number,
  mode: RiskProfileMode,
  valuationDate: Date = new Date()
): number {
  const sign = sideSign(position.side);
  const qty = positiveOr(position.qty, 0);

  if (!position.symbol || qty === 0) return 0;

  if (position.instrumentType === "stock") {
    const entry = cleanNumber(position.entryPrice);
    if (entry === undefined) return 0;
    return sign * qty * (stockPrice - entry);
  }

  const strike = positiveOr(position.strike, stockPrice);
  const entryPremium = cleanNumber(position.entryPrice);
  if (entryPremium === undefined) return 0;

  let optionValuePerShare = 0;

  if (mode === "expiration") {
    optionValuePerShare = optionIntrinsicAtExpiration(
      position.instrumentType,
      stockPrice,
      strike
    );
  } else {
    const T = yearsToExpiration(position.expiration, valuationDate);
    const sigma = positiveOr(position.manualIv, 0.25);
    const r = cleanNumber(position.riskFreeRate) ?? DEFAULT_RATE;

    optionValuePerShare = blackScholesPrice(
      position.instrumentType,
      stockPrice,
      strike,
      T,
      sigma,
      r
    );
  }

  const perSharePnL = sign * (optionValuePerShare - entryPremium);
  return qty * CONTRACT_MULTIPLIER * perSharePnL;
}

export function buildRiskProfile(
  positions: PortfolioPosition[],
  currentPrice: number,
  mode: RiskProfileMode = "expiration",
  valuationDate: Date = new Date(),
  range?: { min?: number; max?: number }
): RiskProfilePoint[] {
  const validPositions = positions.filter(
    (p) => p.includeInRiskProfile !== false && p.symbol && positiveOr(p.qty, 0) > 0
  );

  if (validPositions.length === 0) return [];

  const floor = Math.max(0.01, range?.min ?? currentPrice * 0.5);
  const ceil = Math.max(floor + 0.01, range?.max ?? currentPrice * 1.5);
  const steps = 100;

  return Array.from({ length: steps + 1 }).map((_, i) => {
    const price = floor + ((ceil - floor) * i) / steps;
    const pl = validPositions.reduce(
      (sum, p) => sum + positionPnLAtPrice(p, price, mode, valuationDate),
      0
    );

    return { price, pl };
  });
}

export function evaluateSlices(
  positions: PortfolioPosition[],
  slices: PriceSlice[],
  currentPrice: number,
  context: MarketQuoteContext,
  mode: RiskProfileMode = "expiration",
  valuationDate: Date = new Date()
): SliceResult[] {
  const activePositions = positions.filter((p) => p.includeInRiskProfile !== false);

  return slices.map((slice) => {
    const slicePrice = cleanNumber(slice.underlyingPrice);

    if (!slicePrice) {
      return {
        id: slice.id,
        underlyingPrice: undefined
      };
    }

    const pseudoContext: MarketQuoteContext = {
      underlyingQuotes: Object.fromEntries(
        Object.keys(context.underlyingQuotes).map((symbol) => [
          symbol,
          { currentPrice: slicePrice, previousClose: currentPrice }
        ])
      ),
      optionQuotes: context.optionQuotes
    };

    const totals = activePositions.reduce(
      (acc, p) => {
        const greeks = estimatePositionGreeks(p, pseudoContext, valuationDate);

        return {
          delta: acc.delta + greeks.delta,
          gamma: acc.gamma + greeks.gamma,
          theta: acc.theta + greeks.theta,
          vega: acc.vega + greeks.vega,
          plAtSlice:
            acc.plAtSlice + positionPnLAtPrice(p, slicePrice, mode, valuationDate),
          bpEffect: acc.bpEffect + (cleanNumber(p.bpEffect) ?? 0)
        };
      },
      { delta: 0, gamma: 0, theta: 0, vega: 0, plAtSlice: 0, bpEffect: 0 }
    );

    return {
      id: slice.id,
      underlyingPrice: slicePrice,
      delta: totals.delta,
      gamma: totals.gamma,
      theta: totals.theta,
      vega: totals.vega,
      plAtSlice: totals.plAtSlice,
      theoreticalNetLiq: totals.plAtSlice,
      bpEffect: totals.bpEffect
    };
  });
}