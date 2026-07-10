import type { ZeroDteChainRow, ZeroDteRecommendation } from "./zeroDteOiIntelligence";
import type { ZeroDteMoodRead, ZeroDteMoodTradeBias } from "./zeroDteMoodEngine";
import {
  buildZeroDteCreditSpreadBook,
  type CreditSpreadRiskMode,
  type CreditSpreadSelectionMode,
  type ZeroDteCreditSpreadBook,
  type ZeroDteCreditSpreadSelection,
} from "./zeroDteCreditSpreadSelector";
import { buildZeroDteOpeningExecutionPlan, type ZeroDteOpeningExecutionPlan } from "./zeroDteOpeningExecutionPlan";

export type ZeroDteSelectedTradeType =
  | "put-credit-spread"
  | "call-credit-spread"
  | "iron-fly"
  | "iron-condor"
  | "skewed-bullish-condor"
  | "skewed-bearish-condor"
  | "two-sided-credit-spread-review"
  | "no-trade";

export type ZeroDteTradeSelection = {
  tradeType: ZeroDteSelectedTradeType;
  label: string;
  confidence: number;
  moodBias: ZeroDteMoodTradeBias;
  selectionMode: CreditSpreadSelectionMode;
  creditSpread: ZeroDteCreditSpreadSelection | null;
  creditSpreadBook: ZeroDteCreditSpreadBook;
  ironFly: {
    center: number;
    lowerWing: number;
    upperWing: number;
    wingWidth: number;
  } | null;
  openingExecutionPlan: ZeroDteOpeningExecutionPlan;
  reasons: string[];
  warnings: string[];
};

export type BuildZeroDteTradeSelectionInput = {
  recommendation: ZeroDteRecommendation;
  spxRows: ZeroDteChainRow[];
  mood?: ZeroDteMoodRead | null;
  /** Legacy field. Now treated as max allowed width, not a forced width. */
  spreadWidth?: number | null;
  maxWidth?: number | null;
  minWidth?: number | null;
  maxRiskDollars?: number | null;
  minCredit?: number | null;
  minCreditToRiskPct?: number | null;
  riskMode?: CreditSpreadRiskMode;
  tradeDate?: string | null;
  generatedAt?: string | null;
};

export function buildZeroDteTradeSelection(input: BuildZeroDteTradeSelectionInput): ZeroDteTradeSelection {
  const { recommendation: rec, mood = null } = input;
  const warnings: string[] = [];
  const reasons: string[] = [];

  const creditSpreadBook = buildZeroDteCreditSpreadBook({
    recommendation: rec,
    spxRows: input.spxRows,
    mood,
    width: input.spreadWidth,
    maxWidth: input.maxWidth ?? input.spreadWidth,
    minWidth: input.minWidth,
    maxRiskDollars: input.maxRiskDollars,
    minCredit: input.minCredit,
    minCreditToRiskPct: input.minCreditToRiskPct,
    riskMode: input.riskMode ?? "balanced",
  });

  const openingExecutionPlan = buildZeroDteOpeningExecutionPlan({
    recommendation: rec,
    spxRows: input.spxRows,
    creditSpreadBook,
    tradeDate: input.tradeDate,
    generatedAt: input.generatedAt,
  });

  reasons.push("Credit-spread strikes are selected from live SPX option mids plus the SPX OI chain map.");
  reasons.push("SPY is used only as alignment/confirmation, not as the traded strike map.");
  reasons.push("Opening IF is a locked 50-wide map; it is not an automatic open-entry order.");
  reasons.push(...creditSpreadBook.notes);
  reasons.push(...openingExecutionPlan.reasons);
  warnings.push(...creditSpreadBook.warnings);
  warnings.push(...openingExecutionPlan.warnings);

  if (mood?.warnings?.length) warnings.push(...mood.warnings);

  const preferred = creditSpreadBook.preferredSpread;
  const neutralStructure = rec.confidenceScore >= 55 && Math.abs(rec.dealerPressure) <= 25;

  if (preferred?.shortStrike) {
    return {
      tradeType: preferred.side === "put" ? "put-credit-spread" : "call-credit-spread",
      label: preferred.side === "put" ? "Preferred Put Credit Spread" : "Preferred Call Credit Spread",
      confidence: preferred.confidence,
      moodBias: mood?.tradeBias ?? "no-trade",
      selectionMode: creditSpreadBook.selectionMode,
      creditSpread: preferred,
      creditSpreadBook,
      ironFly: neutralStructure
        ? {
            center: rec.suggestedCenter,
            lowerWing: rec.lowerWing,
            upperWing: rec.upperWing,
            wingWidth: rec.suggestedWingWidth,
          }
        : null,
      openingExecutionPlan,
      reasons: [...reasons, ...preferred.reasons],
      warnings: unique([...warnings, ...preferred.warnings]),
    };
  }

  if (neutralStructure) {
    reasons.push("Dealer pressure is neutral and the SPX OI footprint still supports an iron fly/condor read.");
    return {
      tradeType: "iron-fly",
      label: "Iron Fly / Iron Condor Zone",
      confidence: rec.confidenceScore,
      moodBias: mood?.tradeBias ?? "no-trade",
      selectionMode: creditSpreadBook.selectionMode,
      creditSpread: null,
      creditSpreadBook,
      ironFly: {
        center: rec.suggestedCenter,
        lowerWing: rec.lowerWing,
        upperWing: rec.upperWing,
        wingWidth: rec.suggestedWingWidth,
      },
      openingExecutionPlan,
      reasons,
      warnings: unique(warnings),
    };
  }

  warnings.push("No preferred spread could be selected with executable mids. Review the option chain manually or widen the chain range/width.");
  return {
    tradeType: "two-sided-credit-spread-review",
    label: "Review Both Sides / No Clean Favorite",
    confidence: Math.max(creditSpreadBook.put.confidence, creditSpreadBook.call.confidence),
    moodBias: mood?.tradeBias ?? "no-trade",
    selectionMode: creditSpreadBook.selectionMode,
    creditSpread: null,
    creditSpreadBook,
    ironFly: null,
    openingExecutionPlan,
    reasons,
    warnings: unique(warnings),
  };
}

function unique(items: string[]) {
  return [...new Set(items.filter(Boolean))];
}
