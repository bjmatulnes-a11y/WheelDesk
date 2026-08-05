import type { ZeroDteChainRow, ZeroDteRecommendation } from "./zeroDteOiIntelligence";
import type { ZeroDteMoodRead, ZeroDteMoodTradeBias } from "./zeroDteMoodEngine";
import type { ZeroDteStrikeFlowRead } from "./zeroDteStrikeFlow";
import {
  buildZeroDteCreditSpreadBook,
  type CreditSpreadRiskMode,
  type CreditSpreadSelectionMode,
  type ZeroDteCreditSpreadBook,
  type ZeroDteCreditSpreadSelection,
} from "./zeroDteCreditSpreadSelector";

export type ZeroDteSelectedTradeType =
  | "put-credit-spread"
  | "call-credit-spread"
  | "iron-fly"
  | "iron-condor"
  | "skewed-bullish-condor"
  | "skewed-bearish-condor"
  | "two-sided-credit-spread-review"
  | "no-trade";

export type ZeroDteStrategyRanking = {
  rank: number;
  tradeType: Extract<
    ZeroDteSelectedTradeType,
    "put-credit-spread" | "call-credit-spread" | "iron-fly" | "no-trade"
  >;
  label: string;
  score: number;
  eligible: boolean;
  mapAlignment: number;
  dealerAlignment: number;
  flowAlignment: number;
  strikes: string;
  estimatedCredit: number | null;
  maxRiskDollars: number | null;
  creditToRiskPct: number | null;
  reasons: string[];
  blockers: string[];
};

export type ZeroDteMapContext = {
  phase: "OPENING" | "TRANSITION" | "ACTIVE";
  railBreached: "UPPER" | "LOWER" | "NONE";
  confirmationCount: number;
  confirmationRequired: number;
  controllingSource: "open-map" | "first-live-fallback" | "live";
  controllingCenter: number;
  controllingLowerWing: number;
  controllingUpperWing: number;
  centerShiftFromOpen: number;
};

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
  reasons: string[];
  warnings: string[];
  orchestrationMode?: "map-aware";
  mapContext?: ZeroDteMapContext;
  strategyRankings?: ZeroDteStrategyRanking[];
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
  strikeFlow?: ZeroDteStrikeFlowRead | null;
};

export function buildZeroDteTradeSelection(input: BuildZeroDteTradeSelectionInput): ZeroDteTradeSelection {
  const { recommendation: rec, mood = null, strikeFlow = null } = input;
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

  reasons.push("Credit-spread strikes are selected from live SPX option mids plus the SPX OI chain map.");
  reasons.push("SPY is used only as alignment/confirmation, not as the traded strike map.");
  reasons.push(...creditSpreadBook.notes);
  warnings.push(...creditSpreadBook.warnings);

  if (mood?.information?.length) reasons.push(...mood.information);
  if (mood?.warnings?.length) warnings.push(...mood.warnings);

  let preferred = creditSpreadBook.preferredSpread;

  if (strikeFlow?.hasPriorSnapshot) {
    reasons.push(`Strike-flow comparison: call wall ${strikeFlow.callWall.state}; put wall ${strikeFlow.putWall.state}.`);

    const callSpreadBlocked = strikeFlow.callWall.state === "attacked";
    const putSpreadBlocked = strikeFlow.putWall.state === "breaking";

    if (callSpreadBlocked) warnings.push("Call wall is being attacked with accelerating volume and price acceptance. Avoid selling the call side until it reclaims below the wall.");
    if (putSpreadBlocked) warnings.push("Put wall is breaking with accelerating volume and price acceptance. Avoid selling the put side until it reclaims above the wall.");

    if (preferred?.side === "call" && callSpreadBlocked) {
      preferred = creditSpreadBook.put.shortStrike && !putSpreadBlocked ? creditSpreadBook.put : null;
      if (preferred) reasons.push("Flow vetoed the call spread and promoted the executable put spread.");
    } else if (preferred?.side === "put" && putSpreadBlocked) {
      preferred = creditSpreadBook.call.shortStrike && !callSpreadBlocked ? creditSpreadBook.call : null;
      if (preferred) reasons.push("Flow vetoed the put spread and promoted the executable call spread.");
    }

    if (preferred?.side === "call" && strikeFlow.callWall.state === "defended") reasons.push("Accelerating call-wall flow rejected below the wall, supporting the call-credit-spread side.");
    if (preferred?.side === "put" && strikeFlow.putWall.state === "absorbed") reasons.push("Accelerating put-wall flow reclaimed above the wall, supporting the put-credit-spread side.");
  }

  const neutralStructure = rec.confidenceScore >= 55 && Math.abs(rec.dealerPressure) <= 25;

  if (preferred?.shortStrike) {
    return {
      tradeType: preferred.side === "put" ? "put-credit-spread" : "call-credit-spread",
      label: preferred.side === "put" ? "Preferred Put Credit Spread" : "Preferred Call Credit Spread",
      confidence: clampConfidence(
        preferred.confidence +
          (preferred.side === "call" && strikeFlow?.callWall.state === "defended" ? 7 : 0) +
          (preferred.side === "put" && strikeFlow?.putWall.state === "absorbed" ? 7 : 0)
      ),
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
    reasons,
    warnings: unique(warnings),
  };
}

function clampConfidence(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function unique(items: string[]) {
  return [...new Set(items.filter(Boolean))];
}
