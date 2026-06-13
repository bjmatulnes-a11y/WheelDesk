import type { ZeroDteRecommendation } from "./zeroDteOiIntelligence";
import type { ZeroDteMoodRead, ZeroDteMoodTradeBias } from "./zeroDteMoodEngine";
import { selectZeroDteCreditSpread, type CreditSpreadRiskMode, type ZeroDteCreditSpreadSelection } from "./zeroDteCreditSpreadSelector";

export type ZeroDteSelectedTradeType =
  | "put-credit-spread"
  | "call-credit-spread"
  | "iron-fly"
  | "iron-condor"
  | "skewed-bullish-condor"
  | "skewed-bearish-condor"
  | "no-trade";

export type ZeroDteTradeSelection = {
  tradeType: ZeroDteSelectedTradeType;
  label: string;
  confidence: number;
  moodBias: ZeroDteMoodTradeBias;
  creditSpread: ZeroDteCreditSpreadSelection | null;
  ironFly: {
    center: number;
    lowerWing: number;
    upperWing: number;
    wingWidth: number;
  } | null;
  reasons: string[];
  warnings: string[];
};

export type BuildZeroDteTradeSelectionInput = {
  recommendation: ZeroDteRecommendation;
  mood: ZeroDteMoodRead | null;
  spreadWidth?: number | null;
  riskMode?: CreditSpreadRiskMode;
};

export function buildZeroDteTradeSelection(input: BuildZeroDteTradeSelectionInput): ZeroDteTradeSelection {
  const { recommendation: rec, mood } = input;
  const warnings: string[] = [];
  const reasons: string[] = [];

  if (!mood || mood.tradeBias === "no-trade") {
    warnings.push("No usable mood read is available. Strike placement is available, but strategy selection is not confirmed.");
    return {
      tradeType: "no-trade",
      label: "No Trade / Wait",
      confidence: 0,
      moodBias: "no-trade",
      creditSpread: null,
      ironFly: null,
      reasons,
      warnings,
    };
  }

  reasons.push(`Mood engine favors ${mood.recommendationLabel}.`);

  if (mood.warnings.length) warnings.push(...mood.warnings);

  if (mood.tradeBias === "put-credit-spread") {
    const creditSpread = selectZeroDteCreditSpread({
      recommendation: rec,
      mood,
      side: "put",
      width: input.spreadWidth,
      riskMode: input.riskMode ?? "balanced",
    });
    return {
      tradeType: "put-credit-spread",
      label: "Put Credit Spread",
      confidence: creditSpread.confidence,
      moodBias: mood.tradeBias,
      creditSpread,
      ironFly: null,
      reasons: [...reasons, ...creditSpread.reasons],
      warnings: [...warnings, ...creditSpread.warnings],
    };
  }

  if (mood.tradeBias === "call-credit-spread") {
    const creditSpread = selectZeroDteCreditSpread({
      recommendation: rec,
      mood,
      side: "call",
      width: input.spreadWidth,
      riskMode: input.riskMode ?? "balanced",
    });
    return {
      tradeType: "call-credit-spread",
      label: "Call Credit Spread",
      confidence: creditSpread.confidence,
      moodBias: mood.tradeBias,
      creditSpread,
      ironFly: null,
      reasons: [...reasons, ...creditSpread.reasons],
      warnings: [...warnings, ...creditSpread.warnings],
    };
  }

  if (mood.tradeBias === "skewed-bullish-condor") {
    const creditSpread = selectZeroDteCreditSpread({
      recommendation: rec,
      mood,
      side: "put",
      width: input.spreadWidth,
      riskMode: "conservative",
      minDistancePctOfExpectedMove: 0.6,
      maxDistancePctOfExpectedMove: 1.25,
    });
    warnings.push("Mood is only moderately bullish. Treat the put side as a skew/lean, not a full directional bet.");
    return {
      tradeType: "skewed-bullish-condor",
      label: "Skewed Bullish Condor / Conservative Put Spread",
      confidence: Math.round(creditSpread.confidence * 0.82),
      moodBias: mood.tradeBias,
      creditSpread,
      ironFly: null,
      reasons: [...reasons, ...creditSpread.reasons],
      warnings: [...warnings, ...creditSpread.warnings],
    };
  }

  if (mood.tradeBias === "skewed-bearish-condor") {
    const creditSpread = selectZeroDteCreditSpread({
      recommendation: rec,
      mood,
      side: "call",
      width: input.spreadWidth,
      riskMode: "conservative",
      minDistancePctOfExpectedMove: 0.6,
      maxDistancePctOfExpectedMove: 1.25,
    });
    warnings.push("Mood is only moderately bearish. Treat the call side as a skew/lean, not a full directional bet.");
    return {
      tradeType: "skewed-bearish-condor",
      label: "Skewed Bearish Condor / Conservative Call Spread",
      confidence: Math.round(creditSpread.confidence * 0.82),
      moodBias: mood.tradeBias,
      creditSpread,
      ironFly: null,
      reasons: [...reasons, ...creditSpread.reasons],
      warnings: [...warnings, ...creditSpread.warnings],
    };
  }

  reasons.push("Neutral mood keeps the focus on SPX OI pin/center placement.");
  return {
    tradeType: "iron-fly",
    label: "Iron Fly / Iron Condor Zone",
    confidence: Math.round(rec.confidenceScore * 0.75 + mood.confidence * 0.25),
    moodBias: mood.tradeBias,
    creditSpread: null,
    ironFly: {
      center: rec.suggestedCenter,
      lowerWing: rec.lowerWing,
      upperWing: rec.upperWing,
      wingWidth: rec.suggestedWingWidth,
    },
    reasons,
    warnings,
  };
}
