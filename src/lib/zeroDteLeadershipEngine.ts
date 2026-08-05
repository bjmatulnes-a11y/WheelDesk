import type { SchwabQuoteInstrument, SchwabQuotesResponse } from "./schwab/types";
import type {
  ZeroDteLeadershipWeight,
  ZeroDteLeadershipWeightSnapshot,
} from "./zeroDteLeadershipWeights";

export type ZeroDteLeadershipConstituentRead = ZeroDteLeadershipWeight & {
  currentPrice: number | null;
  previousClose: number | null;
  percentChange: number | null;
  weightedContribution: number | null;
  available: boolean;
};

export type ZeroDteLeadershipRead = {
  tradeDate: string;
  asOfDate: string | null;
  weightSource: ZeroDteLeadershipWeightSnapshot["source"];
  selectedCount: number;
  availableCount: number;
  cumulativeWeightPct: number;
  availableWeightPct: number;
  quoteCoveragePct: number;
  weightedReturnPct: number | null;
  indexPctChange: number | null;
  pullVsIndexPct: number | null;
  constituents: ZeroDteLeadershipConstituentRead[];
  warnings: string[];
};

export function buildZeroDteLeadershipRead(args: {
  weights: ZeroDteLeadershipWeightSnapshot;
  quotes: SchwabQuotesResponse;
  spxCurrent: number | null;
  spxPreviousClose: number | null;
}): ZeroDteLeadershipRead {
  const constituents = args.weights.constituents.map((weight) => {
    const quote = findQuote(args.quotes, weight.providerSymbol, weight.symbol);
    const currentPrice = quoteCurrent(quote);
    const previousClose = quotePrevious(quote);
    const directPct = quotePercentChange(quote);
    const percentChange =
      directPct ??
      (currentPrice !== null && previousClose !== null && previousClose > 0
        ? ((currentPrice - previousClose) / previousClose) * 100
        : null);
    return {
      ...weight,
      currentPrice,
      previousClose,
      percentChange,
      weightedContribution:
        percentChange === null ? null : percentChange * weight.weightPct,
      available: percentChange !== null,
    };
  });

  const available = constituents.filter((item) => item.available);
  const availableWeightPct = available.reduce((sum, item) => sum + item.weightPct, 0);
  const weightedReturnPct =
    availableWeightPct > 0
      ? available.reduce(
          (sum, item) => sum + (item.percentChange ?? 0) * item.weightPct,
          0,
        ) / availableWeightPct
      : null;
  const indexPctChange =
    args.spxCurrent !== null &&
    args.spxPreviousClose !== null &&
    args.spxPreviousClose > 0
      ? ((args.spxCurrent - args.spxPreviousClose) / args.spxPreviousClose) * 100
      : null;
  const pullVsIndexPct =
    weightedReturnPct !== null && indexPctChange !== null
      ? weightedReturnPct - indexPctChange
      : null;
  const quoteCoveragePct =
    args.weights.cumulativeWeightPct > 0
      ? Math.min(
          100,
          (availableWeightPct / args.weights.cumulativeWeightPct) * 100,
        )
      : 0;

  const warnings = [...args.weights.warnings];
  if (quoteCoveragePct < 90) {
    warnings.push(
      `Leadership quote coverage is ${quoteCoveragePct.toFixed(0)}% of the selected weight basket.`,
    );
  }

  return {
    tradeDate: args.weights.tradeDate,
    asOfDate: args.weights.asOfDate,
    weightSource: args.weights.source,
    selectedCount: constituents.length,
    availableCount: available.length,
    cumulativeWeightPct: args.weights.cumulativeWeightPct,
    availableWeightPct,
    quoteCoveragePct,
    weightedReturnPct,
    indexPctChange,
    pullVsIndexPct,
    constituents,
    warnings,
  };
}

function findQuote(
  quotes: SchwabQuotesResponse,
  providerSymbol: string,
  originalSymbol: string,
) {
  const alternatives = [
    providerSymbol,
    originalSymbol,
    providerSymbol.replace("/", "."),
    providerSymbol.replace("/", "-"),
  ];
  for (const symbol of alternatives) {
    const exact = quotes[symbol];
    if (exact) return exact;
    const key = Object.keys(quotes).find(
      (candidate) => candidate.toUpperCase() === symbol.toUpperCase(),
    );
    if (key) return quotes[key];
  }
  return undefined;
}

function quoteCurrent(quote: SchwabQuoteInstrument | undefined) {
  return finite(
    quote?.quote?.lastPrice ??
      quote?.quote?.mark ??
      quote?.regular?.regularMarketLastPrice ??
      quote?.regular?.lastPrice ??
      quote?.regular?.mark,
  );
}

function quotePrevious(quote: SchwabQuoteInstrument | undefined) {
  return finite(quote?.quote?.closePrice ?? quote?.regular?.closePrice);
}

function quotePercentChange(quote: SchwabQuoteInstrument | undefined) {
  return finite(
    quote?.quote?.netPercentChange ??
      quote?.regular?.regularMarketPercentChange ??
      quote?.regular?.netPercentChange,
  );
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
