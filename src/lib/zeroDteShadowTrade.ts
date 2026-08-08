import type {
  ExecutionLeg,
  ExecutionPositionMemory,
  ExecutionStrategy,
} from "./zeroDteExecutionIntelligence";

export type ZeroDteShadowTradeState = "open" | "closed";

export type ZeroDteShadowTrade = {
  id: string;
  tradeDate: string;
  signalId: string;
  strategy: ExecutionStrategy;
  setupKey: string;
  label: string;
  legs: ExecutionLeg[];
  state: ZeroDteShadowTradeState;
  signalTime: string;
  signalCandleTime: number;
  entryScore: number;
  minimumEntryScore: number;
  timeRegime: string;
  shortDeltaAbs: number | null;
  shortDistancePoints: number | null;
  entryMarkCredit: number | null;
  entrySellableCredit: number;
  signalPeakCredit: number | null;
  premiumExpansionPct: number | null;
  premiumRolloverPct: number | null;
  premiumCrestStatus: string | null;
  priceRejectionScore: number | null;
  remainingMovePoints: number | null;
  maxRiskDollars: number | null;
  widthPoints: number | null;
  eventRisk: "NORMAL" | "HIGH";
  rangeConsumptionPct: number | null;
  entryMapPhase: "OPENING" | "TRANSITION" | "ACTIVE";
  entryMapCenter: number;
  entryRailBreached: "UPPER" | "LOWER" | "NONE";
  pathDirection: "UP" | "DOWN" | "NEUTRAL" | null;
  pathConfidence: number | null;
  pathFlowSource: "engine" | "fallback" | null;
  pathTerminalTrough: number | null;
  pathTerminalCrest: number | null;
  lastSampleAt: string | null;
  currentMarkCredit: number | null;
  currentBuybackDebit: number | null;
  maxMarkCredit: number | null;
  minBuybackDebit: number | null;
  maxAdverseExcursionDollars: number;
  maxFavorableExcursionDollars: number;
  hitShortStrike: boolean;
  hitOnePointFiveX: boolean;
  hitTwoX: boolean;
  ranToMaxLoss: boolean;
  exitTime: string | null;
  exitReason: string | null;
  exitBuybackDebit: number | null;
  pnlConservativeDollars: number | null;
};

export function shadowTradeToExecutionPosition(
  trade: ZeroDteShadowTrade,
): ExecutionPositionMemory {
  return {
    id: `shadow:${trade.id}`,
    strategy: trade.strategy,
    label: `Shadow ${trade.label}`,
    setupKey: trade.setupKey,
    legs: trade.legs,
    openedAt: trade.signalTime,
    entryCredit: trade.entrySellableCredit,
    quantity: 1,
    maxRiskDollars: trade.maxRiskDollars,
    entryScore: trade.entryScore,
    entryMapPhase: trade.entryMapPhase,
    entryMapCenter: trade.entryMapCenter,
    entryRailBreached: trade.entryRailBreached,
    entryReasons: ["Automatic shadow trade created from a confirmed SELL_READY signal."],
    entryTimeRegime:
      trade.timeRegime === "SELECTIVE_CONTINUATION" ||
      trade.timeRegime === "EXHAUSTION" ||
      trade.timeRegime === "FINAL_ENTRY" ||
      trade.timeRegime === "PREMARKET" ||
      trade.timeRegime === "CLOSED"
        ? trade.timeRegime
        : "OPENING_OPPORTUNITY",
    side:
      trade.strategy === "put-credit-spread"
        ? "lower"
        : trade.strategy === "call-credit-spread"
          ? "upper"
          : "center",
    setupSource: "engine",
    engineClearedAtEntry: true,
    overrideReason: null,
    signalTime: trade.signalTime,
    signalCredit: trade.entryMarkCredit,
    entryMarkCredit: trade.entryMarkCredit,
    entrySellableCredit: trade.entrySellableCredit,
    entryShortDeltaAbs: trade.shortDeltaAbs,
    entryTouchRiskProxyPct:
      trade.shortDeltaAbs === null
        ? null
        : Math.min(100, trade.shortDeltaAbs * 200),
    entryRangeConsumptionPct: trade.rangeConsumptionPct,
    entryEventRisk: trade.eventRisk,
  };
}

export function shadowWidthPoints(legs: ExecutionLeg[]) {
  if (legs.length === 2) {
    return Math.abs(legs[0].strike - legs[1].strike);
  }
  const sold = legs.filter((leg) => leg.action === "sell").map((leg) => leg.strike);
  const bought = legs.filter((leg) => leg.action === "buy").map((leg) => leg.strike);
  if (!sold.length || !bought.length) return null;
  const center = sold.reduce((sum, strike) => sum + strike, 0) / sold.length;
  return Math.max(...bought.map((strike) => Math.abs(strike - center)));
}
