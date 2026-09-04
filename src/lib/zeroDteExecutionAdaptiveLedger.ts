import type {
  ExecutionPositionMemory,
  ZeroDteExecutionRead,
} from "./zeroDteExecutionIntelligence";
import type { ZeroDteChainRow } from "./zeroDteOiIntelligence";
import type { ZeroDteRiskPolicy } from "./zeroDteRiskPolicy";
import {
  evaluateZeroDteAdaptiveManagement,
  type AdaptiveAuctionContext,
  type AdaptiveManagementAction,
  type AdaptiveManagementDecision,
  type AdaptiveManagementState,
} from "./zeroDteAdaptiveManagement";
import type {
  AdaptiveStructureHistoryItem,
  ZeroDteShadowTrade,
} from "./zeroDteShadowTrade";

/**
 * Applies the proven adaptive vertical manager to an ACTUAL execution position.
 *
 * The shadow engine remains the research/forward-validation book. This adapter
 * deliberately keeps actual execution state separate: recommendations are
 * allowed to fire automatically, but leg transformations are only committed
 * after the user confirms the broker fill in Portfolio Dock.
 */
export function evaluateExecutionPositionAdaptiveManagement(args: {
  position: ExecutionPositionMemory;
  read: ZeroDteExecutionRead;
  spot: number;
  rows: ZeroDteChainRow[];
  riskPolicy: ZeroDteRiskPolicy;
  auction?: AdaptiveAuctionContext | null;
}): AdaptiveManagementDecision {
  const quantity = Math.max(1, args.position.quantity || 1);
  const synthetic = executionPositionToAdaptiveShadowTrade(
    args.position,
    args.read,
    quantity,
  );

  const raw = evaluateZeroDteAdaptiveManagement({
    trade: synthetic,
    read: args.read,
    spot: args.spot,
    rows: args.rows,
    minSellableCredit: args.riskPolicy.minSellableCredit,
    auction: args.auction ?? null,
  });

  // The adaptive manager reasons in one-lot option economics. Actual Portfolio
  // Dock positions may have multiple contracts, so user-facing dollar fields
  // are scaled to the real quantity while thresholds/leg prices remain per-lot.
  return {
    ...raw,
    currentPnlDollars: scale(raw.currentPnlDollars, quantity),
    maxAdverseExcursionDollars: raw.maxAdverseExcursionDollars * quantity,
    maxFavorableExcursionDollars: raw.maxFavorableExcursionDollars * quantity,
    markedPnlDollars: scale(raw.markedPnlDollars, quantity),
    reasons:
      quantity === 1
        ? raw.reasons
        : [
            ...raw.reasons,
            `Dollar P/L and MAE/MFE shown for the actual ${quantity}-contract position; trigger multiples remain per short leg.`,
          ],
  };
}

/** Stable key used to persist only meaningful management changes, not 5-second noise. */
export function executionAdaptiveRecommendationKey(
  decision: AdaptiveManagementDecision,
) {
  const transition = decision.structureTransition;
  return [
    decision.state,
    decision.action,
    decision.structureState ?? "NONE",
    transition?.type ?? "NONE",
    transition?.strike == null ? "NONE" : transition.strike.toFixed(2),
  ].join("|");
}

function executionPositionToAdaptiveShadowTrade(
  position: ExecutionPositionMemory,
  read: ZeroDteExecutionRead,
  quantity: number,
): ZeroDteShadowTrade {
  const structureState =
    position.adaptiveStructureState ??
    (position.strategy === "iron-fly" ? "IF_CENTER" : "CREDIT_SPREAD");
  const activeLegs =
    position.adaptiveActiveLegs?.length
      ? position.adaptiveActiveLegs
      : position.legs;
  const history = (position.adaptiveManagementHistory ?? []).flatMap<AdaptiveStructureHistoryItem>(
    (item) => {
      if (item.kind !== "CONFIRMATION") return [];
      if (
        item.action !== "RELEASE_SHORT" &&
        item.action !== "REINSTATE_SHORT" &&
        item.action !== "CLOSE_RUNNER" &&
        item.action !== "EXIT"
      ) {
        return [];
      }
      return [
        {
          at: item.at,
          action: item.action,
          strike: item.strike,
          price: item.price,
          detail: item.detail,
          netCashPoints:
            item.netCashPoints ?? position.adaptiveNetCashPoints ?? position.entryCredit,
        },
      ];
    },
  );

  const entryShortLegs = (position.entryShortLegs ?? []).flatMap((entry) =>
    entry.sellPrice != null && entry.sellPrice > 0
      ? [
          {
            optionType: entry.optionType,
            strike: entry.strike,
            sellPrice: entry.sellPrice,
          },
        ]
      : [],
  );

  // Only fields consumed by the adaptive manager need economic fidelity here;
  // the remaining fields preserve the complete ShadowTrade contract and make
  // this adapter resistant to future manager reads.
  return {
    id: position.id,
    tradeDate: read.tradeDate,
    signalId: `actual:${position.id}`,
    strategy: position.strategy,
    setupKey: position.setupKey,
    label: position.label,
    legs: position.legs,
    state: "open",
    signalTime: position.signalTime ?? position.openedAt,
    signalCandleTime: Date.parse(position.signalTime ?? position.openedAt),
    entryScore: position.entryScore ?? 0,
    minimumEntryScore: read.minimumEntryScore,
    timeRegime: position.entryTimeRegime,
    shortDeltaAbs: position.entryShortDeltaAbs ?? read.shortDeltaAbs,
    shortDistancePoints: read.shortDistancePoints,
    entryMarkCredit: position.entryMarkCredit ?? position.entryCredit,
    entrySellableCredit: position.entrySellableCredit ?? position.entryCredit,
    entryShortLegs,
    signalPeakCredit: read.peakCredit,
    premiumExpansionPct: read.premiumExpansionPct,
    premiumRolloverPct: read.premiumFromPeakPct,
    premiumCrestStatus: read.premiumCrest.status,
    priceRejectionScore: read.priceRejectionScore,
    remainingMovePoints: read.remainingMovePoints,
    maxRiskDollars: position.maxRiskDollars,
    widthPoints: spreadWidth(position.legs),
    eventRisk: position.entryEventRisk === "HIGH" ? "HIGH" : "NORMAL",
    rangeConsumptionPct: position.entryRangeConsumptionPct ?? null,
    entryMapPhase: position.entryMapPhase,
    entryMapCenter: position.entryMapCenter,
    entryRailBreached: position.entryRailBreached,
    pathDirection: read.leastResistancePath?.direction ?? null,
    pathConfidence: read.leastResistancePath?.confidence ?? null,
    pathFlowSource: read.leastResistancePath?.flowSource ?? null,
    pathTerminalTrough: read.leastResistancePath?.terminalTrough ?? null,
    pathTerminalCrest: read.leastResistancePath?.terminalCrest ?? null,
    portfolioDecision: "TAKE",
    portfolioRole: null,
    portfolioConviction: null,
    portfolioConvictionScore: null,
    premiumQualityScore: null,
    premiumQualityLabel: null,
    effectiveRiskBeforeDollars: null,
    effectiveRiskAfterDollars: null,
    incrementalEffectiveRiskDollars: null,
    availableCapacityAfterDollars: null,
    adaptiveReserveNeedDollars: null,
    reserveCoverageX: null,
    callReleaseReserveDollars: null,
    putReleaseReserveDollars: null,
    reserveDominantSide: null,
    portfolioRepairDeficitDollars: null,
    candidateOffsetCreditDollars: null,
    portfolioDecisionReason: null,
    entryLegSnapshots: [],
    currentLegSnapshots: [],
    entryGreeks: null,
    currentGreeks: null,
    adaptiveStructureState: structureState,
    adaptiveActiveLegs: activeLegs,
    adaptiveNetCashPoints: position.adaptiveNetCashPoints ?? position.entryCredit,
    adaptiveMarkedPnlDollars: perLot(position.adaptiveMarkedPnlDollars, quantity),
    adaptiveReleasedShortStrike: position.adaptiveReleasedShortStrike ?? null,
    adaptiveReinstatedShortStrike: position.adaptiveReinstatedShortStrike ?? null,
    adaptiveStructureHistory: history,
    lastSampleAt: position.adaptiveLastUpdatedAt ?? null,
    currentMarkCredit: read.currentCredit,
    currentBuybackDebit: read.currentBuybackDebit,
    currentShortBuybackPrice:
      read.shortLegRisk
        .filter((item) => item.currentAsk != null)
        .sort((a, b) => (b.multiple ?? 0) - (a.multiple ?? 0))[0]?.currentAsk ?? null,
    currentShortLegMultiple: read.worstShortLegMultiple,
    maxMarkCredit: read.peakCredit,
    minBuybackDebit: null,
    maxAdverseExcursionDollars: perLotNumber(position.adaptiveMaxAdverseExcursionDollars, quantity),
    maxFavorableExcursionDollars: perLotNumber(position.adaptiveMaxFavorableExcursionDollars, quantity),
    hitShortStrike: (read.shortDistancePoints ?? 999) <= 0,
    hitOnePointFiveX: (read.worstShortLegMultiple ?? 0) >= 1.5,
    hitTwoX: (read.worstShortLegMultiple ?? 0) >= 2,
    ranToMaxLoss: false,
    exitTime: null,
    exitReason: null,
    exitBuybackDebit: null,
    pnlConservativeDollars: null,
    adaptiveState: "open",
    adaptiveManagementState: normalizeManagementState(position.adaptiveManagementState),
    adaptiveAction: normalizeManagementAction(position.adaptiveAction),
    adaptiveTargetCapturePct: null,
    adaptiveTargetDebit: null,
    adaptiveTargetR: null,
    adaptiveThesisScore: null,
    adaptiveFavorableScore: null,
    adaptiveThreatScore: null,
    adaptiveInvalidationScore: null,
    adaptiveReason: position.adaptiveReason ?? null,
    adaptiveMaxAdverseExcursionDollars: perLotNumber(position.adaptiveMaxAdverseExcursionDollars, quantity),
    adaptiveMaxFavorableExcursionDollars: perLotNumber(position.adaptiveMaxFavorableExcursionDollars, quantity),
    adaptiveProfitGivebackPct: null,
    adaptiveExitTime: null,
    adaptiveExitReason: null,
    adaptiveExitBuybackDebit: null,
    adaptivePnlDollars: null,
    adaptiveAuctionState: null,
    adaptiveAuctionPressurePct: null,
    adaptiveAuctionEfficiencyPct: null,
    adaptiveProjectedPocSpx: null,
  };
}

function spreadWidth(legs: ExecutionPositionMemory["legs"]) {
  const short = legs.find((leg) => leg.action === "sell");
  const long = legs.find(
    (leg) => leg.action === "buy" && leg.optionType === short?.optionType,
  );
  return short && long ? Math.abs(short.strike - long.strike) : null;
}

function scale(value: number | null, quantity: number) {
  return value == null ? null : Math.round(value * quantity * 100) / 100;
}

function perLot(value: number | null | undefined, quantity: number) {
  return value == null ? null : value / quantity;
}

function perLotNumber(value: number | null | undefined, quantity: number) {
  return value == null ? 0 : value / quantity;
}
function normalizeManagementState(value: string | null | undefined): AdaptiveManagementState | null {
  return value === "HEALTHY" ||
    value === "FAVORABLE_RELEASE" ||
    value === "RECOVERY" ||
    value === "THREATENED" ||
    value === "INVALIDATED" ||
    value === "HARVEST"
    ? value
    : null;
}

function normalizeManagementAction(value: string | null | undefined): AdaptiveManagementAction | null {
  return value === "HOLD" ||
    value === "HOLD_FOR_DEEPER_HARVEST" ||
    value === "WATCH" ||
    value === "RELEASE_SHORT" ||
    value === "REINSTATE_SHORT" ||
    value === "CLOSE_RUNNER" ||
    value === "EXIT"
    ? value
    : null;
}

