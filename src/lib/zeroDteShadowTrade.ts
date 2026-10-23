import type {
  ExecutionLeg,
  ExecutionPositionMemory,
  ExecutionStrategy,
  ZeroDteExecutionRead,
} from "./zeroDteExecutionIntelligence";
import type { ZeroDteChainRow } from "./zeroDteOiIntelligence";
import type {
  AdaptiveManagementAction,
  AdaptiveManagementState,
} from "./zeroDteAdaptiveManagement";
import type {
  LiveEsConvictionTier,
  ShadowGreekSnapshot,
  ShadowLegSnapshot,
  ShadowPortfolioDecision,
  ShadowPortfolioRole,
} from "./zeroDteAdaptivePortfolio";

export type ZeroDteShadowTradeState = "open" | "closed" | "skipped";
export type AdaptiveStructureState =
  | "CREDIT_SPREAD"
  | "LONG_RUNNER"
  | "REPAIRED_SPREAD"
  | "IF_CENTER"
  | "CLOSED";

export type AdaptiveStructureHistoryItem = {
  at: string;
  action: "OPEN" | "RELEASE_SHORT" | "REINSTATE_SHORT" | "CLOSE_RUNNER" | "EXIT";
  strike: number | null;
  price: number | null;
  detail: string;
  netCashPoints: number;
};

export type ZeroDteShadowTrade = {
  id: string;
  source: "EXECUTION" | "PLAN";
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
  entryShortLegs: ShadowShortLegEntry[];
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
  directionalSide?: "BULL" | "BEAR" | "WAIT" | null;
  directionalScore?: number | null;
  directionalStructureScore?: number | null;
  directionalMarketScore?: number | null;
  directionalAgreesWithTrade?: boolean | null;
  structureTrendExternal?: "BULL" | "BEAR" | null;
  lastBreakKind?: "BOS" | "CHOCH" | null;
  lastBreakAgeBars?: number | null;
  recentSweep?: "BULL" | "BEAR" | null;
  openingDayType?: "INSIDE_RANGE" | "OUTSIDE_UP" | "OUTSIDE_DOWN" | null;
  gapVsExpectedMove?: number | null;
  regainedPriorRange?: boolean | null;
  nearestPriorLevelId?: string | null;
  nearestPriorLevelDistance?: number | null;
  shortStrikeBeyondPriorLevel?: boolean | null;
  dailyTrend?: "BULL" | "BEAR" | null;
  dailyFlipInPlay?: boolean | null;
  edgePts?: number | null;
  evPerLotDollars?: number | null;
  histProbTouch?: number | null;
  histProbItmAtClose?: number | null;
  moveTableKeyUsed?: string | null;
  moveTableN?: number | null;
  planStatus?: "READY" | "PAIRED" | "WAIT" | "NO_TRADE_DAY" | null;
  entryTrigger?: "STRUCTURE_REVERSAL" | "STRUCTURE_CONTINUATION" | "FADE_REJECTION" | "FADE_SWEEP" | "NONE" | null;
  entryTimeBucket?: string | null;
  gammaRegime?: "POSITIVE" | "NEGATIVE" | null;
  directionalTilt?: "BULL" | "BEAR" | "NONE" | null;
  exitRule?: "TAKE_PROFIT" | "STRUCTURE_STOP" | "PRICE_STOP" | "TIME_STOP" | "TAKE_PROFIT_50" | "SHORT_LEG_3X_STOP" | "EXPIRED" | null;
  planGuardKind?: "OI" | "PRIOR" | "SWING" | "FVG" | null;
  planGuardLabel?: string | null;
  planGuardPrice?: number | null;
  planDistanceEm?: number | null;
  planTakeProfitPct?: number | null;
  planStopCreditMultiple?: number | null;
  portfolioDecision: ShadowPortfolioDecision | null;
  portfolioRole: ShadowPortfolioRole | null;
  portfolioConviction: LiveEsConvictionTier | null;
  portfolioConvictionScore: number | null;
  premiumQualityScore: number | null;
  premiumQualityLabel: "EXCELLENT" | "STRONG" | "ACCEPTABLE" | "WEAK" | null;
  effectiveRiskBeforeDollars: number | null;
  effectiveRiskAfterDollars: number | null;
  incrementalEffectiveRiskDollars: number | null;
  availableCapacityAfterDollars: number | null;
  adaptiveReserveNeedDollars: number | null;
  reserveCoverageX: number | null;
  callReleaseReserveDollars: number | null;
  putReleaseReserveDollars: number | null;
  reserveDominantSide: "CALL" | "PUT" | "BALANCED" | "NONE" | null;
  portfolioRepairDeficitDollars: number | null;
  candidateOffsetCreditDollars: number | null;
  portfolioDecisionReason: string | null;
  entryLegSnapshots: ShadowLegSnapshot[];
  currentLegSnapshots: ShadowLegSnapshot[];
  entryGreeks: ShadowGreekSnapshot | null;
  currentGreeks: ShadowGreekSnapshot | null;
  adaptiveStructureState: AdaptiveStructureState | null;
  adaptiveActiveLegs: ExecutionLeg[];
  adaptiveNetCashPoints: number | null;
  adaptiveMarkedPnlDollars: number | null;
  adaptiveReleasedShortStrike: number | null;
  adaptiveReinstatedShortStrike: number | null;
  adaptiveStructureHistory: AdaptiveStructureHistoryItem[];
  lastSampleAt: string | null;
  currentMarkCredit: number | null;
  currentBuybackDebit: number | null;
  currentShortBuybackPrice: number | null;
  currentShortLegMultiple: number | null;
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
  adaptiveState: "open" | "closed" | null;
  adaptiveManagementState: AdaptiveManagementState | null;
  adaptiveAction: AdaptiveManagementAction | null;
  adaptiveTargetCapturePct: number | null;
  adaptiveTargetDebit: number | null;
  adaptiveTargetR: number | null;
  adaptiveThesisScore: number | null;
  adaptiveFavorableScore: number | null;
  adaptiveThreatScore: number | null;
  adaptiveInvalidationScore: number | null;
  adaptiveReason: string | null;
  adaptiveMaxAdverseExcursionDollars: number;
  adaptiveMaxFavorableExcursionDollars: number;
  adaptiveProfitGivebackPct: number | null;
  adaptiveExitTime: string | null;
  adaptiveExitReason: string | null;
  adaptiveExitBuybackDebit: number | null;
  adaptivePnlDollars: number | null;
  adaptiveAuctionState: string | null;
  adaptiveAuctionPressurePct: number | null;
  adaptiveAuctionEfficiencyPct: number | null;
  adaptiveProjectedPocSpx: number | null;
};

export type ShadowShortLegEntry = {
  optionType: "call" | "put";
  strike: number;
  sellPrice: number;
};

export type ShadowExitDecision = {
  shouldExit: boolean;
  reason: "TAKE_PROFIT" | "STRUCTURE_STOP" | "PRICE_STOP" | "TIME_STOP" | "TAKE_PROFIT_50" | "SHORT_LEG_3X_STOP" | "PROFIT_PROTECTION" | null;
  detail: string;
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
    adaptiveManagementState: trade.adaptiveManagementState,
    adaptiveAction: trade.adaptiveAction,
    adaptiveReason: trade.adaptiveReason,
    adaptiveStructureState: trade.adaptiveStructureState,
    adaptiveActiveLegs: trade.adaptiveActiveLegs,
    adaptiveNetCashPoints: trade.adaptiveNetCashPoints,
    adaptiveReleasedShortStrike: trade.adaptiveReleasedShortStrike,
    adaptiveReinstatedShortStrike: trade.adaptiveReinstatedShortStrike,
    adaptiveMarkedPnlDollars: trade.adaptiveMarkedPnlDollars,
    adaptiveMaxAdverseExcursionDollars: trade.adaptiveMaxAdverseExcursionDollars,
    adaptiveMaxFavorableExcursionDollars: trade.adaptiveMaxFavorableExcursionDollars,
    adaptiveLastUpdatedAt: trade.lastSampleAt,
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
    entryShortLegs: trade.entryShortLegs.map((leg) => ({
      optionType: leg.optionType,
      strike: leg.strike,
      sellPrice: leg.sellPrice,
      source: "live-bid" as const,
    })),
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


export function buildShadowShortLegEntries(
  rows: ZeroDteChainRow[],
  legs: ExecutionLeg[],
): ShadowShortLegEntry[] {
  return legs.flatMap((leg) => {
    if (leg.action !== "sell") return [];
    const row = rows.find(
      (item) => item.strike === leg.strike && item.optionType === leg.optionType,
    );
    const sellPrice = finitePositive(row?.bid);
    if (sellPrice === null) return [];
    return [{ optionType: leg.optionType, strike: leg.strike, sellPrice }];
  });
}

export function currentShadowShortLegRead(
  rows: ZeroDteChainRow[],
  entries: ShadowShortLegEntry[],
) {
  if (!entries.length) {
    return { currentShortBuybackPrice: null, currentShortLegMultiple: null };
  }
  let worstAsk: number | null = null;
  let worstMultiple: number | null = null;
  for (const entry of entries) {
    const row = rows.find(
      (item) => item.strike === entry.strike && item.optionType === entry.optionType,
    );
    const ask = finitePositive(row?.ask);
    if (ask === null || entry.sellPrice <= 0) continue;
    const multiple = ask / entry.sellPrice;
    if (worstMultiple === null || multiple > worstMultiple) {
      worstMultiple = multiple;
      worstAsk = ask;
    }
  }
  return {
    currentShortBuybackPrice: worstAsk,
    currentShortLegMultiple: worstMultiple,
  };
}

export function evaluateZeroDteShadowExit(
  trade: ZeroDteShadowTrade,
  context?: {
    spotClose?: number | null;
    generatedAt?: string | number | null;
    remainingMovePoints?: number | null;
  },
): ShadowExitDecision {
  if (trade.state !== "open" || trade.entrySellableCredit <= 0) {
    return { shouldExit: false, reason: null, detail: "Shadow trade is not open." };
  }

  const isPlanTrade = trade.source === "PLAN" || trade.planTakeProfitPct != null;

  if (isPlanTrade) {
    const takeProfitPct = clampNumber(trade.planTakeProfitPct ?? 0.5, 0.1, 0.9);
    if (
      trade.currentBuybackDebit !== null &&
      trade.currentBuybackDebit <= trade.entrySellableCredit * takeProfitPct
    ) {
      return {
        shouldExit: true,
        reason: "TAKE_PROFIT",
        detail: `Executable package debit ${trade.currentBuybackDebit.toFixed(2)} reached the ${(takeProfitPct * 100).toFixed(0)}% entry-credit take-profit debit.`,
      };
    }

    const stopMultiple = clampNumber(trade.planStopCreditMultiple ?? 2, 1.1, 5);
    if (
      trade.currentBuybackDebit !== null &&
      trade.currentBuybackDebit >= trade.entrySellableCredit * stopMultiple
    ) {
      return {
        shouldExit: true,
        reason: "PRICE_STOP",
        detail: `Spread buyback ${trade.currentBuybackDebit.toFixed(2)} reached ${stopMultiple.toFixed(2)}x the ${trade.entrySellableCredit.toFixed(2)} entry credit.`,
      };
    }

    const spotClose = finitePositive(context?.spotClose);
    const guard = finitePositive(trade.planGuardPrice);
    if (spotClose !== null && guard !== null) {
      const structureBroken =
        trade.strategy === "put-credit-spread"
          ? spotClose < guard
          : trade.strategy === "call-credit-spread"
            ? spotClose > guard
            : false;
      if (structureBroken) {
        return {
          shouldExit: true,
          reason: "STRUCTURE_STOP",
          detail: `Completed 1m close ${spotClose.toFixed(1)} broke ${trade.planGuardLabel ?? "the guard"} ${guard.toFixed(1)}.`,
        };
      }
    }

    const generatedAt = epochSeconds(context?.generatedAt);
    const shortStrike = trade.legs.find((leg) => leg.action === "sell")?.strike ?? null;
    const remainingMove = finitePositive(context?.remainingMovePoints);
    if (generatedAt !== null && spotClose !== null && Number.isFinite(shortStrike) && remainingMove !== null) {
      const minute = centralMinuteOfDay(generatedAt);
      if (minute >= 14 * 60 + 30 && Math.abs(spotClose - Number(shortStrike)) <= remainingMove * 0.25) {
        return {
          shouldExit: true,
          reason: "TIME_STOP",
          detail: "After 14:30 CT, spot is within 0.25x remaining move of the short strike.",
        };
      }
    }
  } else {
    if (
      trade.currentBuybackDebit !== null &&
      trade.currentBuybackDebit <= trade.entrySellableCredit * 0.5
    ) {
      return {
        shouldExit: true,
        reason: "TAKE_PROFIT_50",
        detail: `Executable package debit ${trade.currentBuybackDebit.toFixed(2)} has captured at least 50% of the ${trade.entrySellableCredit.toFixed(2)} entry credit.`,
      };
    }

    if (
      trade.currentShortLegMultiple !== null &&
      trade.currentShortLegMultiple >= 3
    ) {
      return {
        shouldExit: true,
        reason: "SHORT_LEG_3X_STOP",
        detail: `Worst short leg is ${trade.currentShortLegMultiple.toFixed(2)}x its executable entry sale price.`,
      };
    }
  }

  const currentPnl =
    trade.currentBuybackDebit === null
      ? null
      : (trade.entrySellableCredit - trade.currentBuybackDebit) * 100;
  const mfe = trade.maxFavorableExcursionDollars;
  if (currentPnl !== null && currentPnl >= 50 && mfe >= 100) {
    const retained = currentPnl / mfe;
    if (retained <= 0.65) {
      return {
        shouldExit: true,
        reason: "PROFIT_PROTECTION",
        detail: `Trade retains ${(retained * 100).toFixed(0)}% of a $${mfe.toFixed(0)} MFE after giving back at least 35% of peak profit.`,
      };
    }
  }

  return { shouldExit: false, reason: null, detail: "Deterministic shadow exit has not triggered." };
}

function epochSeconds(value: string | number | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return value > 1e12 ? value / 1000 : value;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms / 1000 : null;
  }
  return null;
}

function centralMinuteOfDay(epoch: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(epoch * 1000));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(map.hour) * 60 + Number(map.minute);
}

function clampNumber(value: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, value));
}

export function shadowExitAdvisory(read: ZeroDteExecutionRead) {
  return {
    lifecycle: read.lifecycle,
    exitScore: read.exitScore,
    action: read.action,
  };
}


export function shadowSettlementCloseValuePoints(
  legs: ExecutionLeg[],
  spot: number,
): number | null {
  if (!Number.isFinite(spot) || spot <= 0 || !legs.length) return null;
  let value = 0;
  for (const leg of legs) {
    if (!Number.isFinite(leg.strike)) return null;
    const intrinsic = leg.optionType === "call"
      ? Math.max(0, spot - leg.strike)
      : Math.max(0, leg.strike - spot);
    value += leg.action === "buy" ? intrinsic : -intrinsic;
  }
  return value;
}

export function shadowSettlementDebitPoints(
  legs: ExecutionLeg[],
  spot: number,
): number | null {
  const closeValue = shadowSettlementCloseValuePoints(legs, spot);
  return closeValue === null ? null : Math.max(0, -closeValue);
}

function finitePositive(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}
