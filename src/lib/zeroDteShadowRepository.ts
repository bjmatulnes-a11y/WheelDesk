import type { ConfirmedExecutionSignal } from "./execution/useExecutionSignalPaint";
import type { ZeroDteExecutionRead } from "./zeroDteExecutionIntelligence";
import type { ZeroDteShadowTrade } from "./zeroDteShadowTrade";
import type { AdaptiveManagementDecision } from "./zeroDteAdaptiveManagement";
import { buildShadowShortLegEntries, shadowWidthPoints } from "./zeroDteShadowTrade";
import type { ZeroDteChainRow } from "./zeroDteOiIntelligence";
import type { AdaptivePortfolioOpportunity, ShadowLegSnapshot } from "./zeroDteAdaptivePortfolio";
import { getSupabaseAuthClient } from "./auth/supabase-auth-client";

async function authHeaders(includeJson = false) {
  const headers: Record<string, string> = includeJson
    ? { "content-type": "application/json" }
    : {};
  const { data } = await getSupabaseAuthClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Login session is not ready for Shadow Lab.");
  headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function call(body: Record<string, unknown>) {
  const response = await fetch("/api/zero-dte/shadow", {
    method: "POST",
    headers: await authHeaders(true),
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = await response.json();
  if (!response.ok || !json.ok) {
    throw new Error(json.error || "Shadow-trade persistence failed");
  }
  return json;
}

export async function loadZeroDteShadowTrades(
  tradeDate: string,
): Promise<ZeroDteShadowTrade[]> {
  const response = await fetch(
    `/api/zero-dte/shadow?tradeDate=${encodeURIComponent(tradeDate)}`,
    { headers: await authHeaders(), cache: "no-store" },
  );
  const json = await response.json();
  if (!response.ok || !json.ok) {
    throw new Error(json.error || "Shadow-trade load failed");
  }
  return (json.trades ?? []) as ZeroDteShadowTrade[];
}

export async function openZeroDteShadowTrade(args: {
  signal: ConfirmedExecutionSignal;
  spxRows: ZeroDteChainRow[];
  opportunity: AdaptivePortfolioOpportunity;
}) {
  const signal = args.signal;
  if (
    signal.kind !== "SELL" ||
    !signal.setupKey ||
    !signal.legs?.length ||
    signal.sellableCredit === null ||
    signal.sellableCredit === undefined ||
    signal.sellableCredit <= 0
  ) {
    return null;
  }

  const entryShortLegs = buildShadowShortLegEntries(args.spxRows, signal.legs);
  const json = await call({
    action: "open",
    tradeDate: signal.tradeDate,
    signalId: signal.id,
    signalTime: new Date((signal.candleTime + 60) * 1000).toISOString(),
    signalCandleTime: signal.candleTime,
    strategy: signal.strategy,
    setupKey: signal.setupKey,
    label: signal.label,
    legs: signal.legs,
    entryScore: signal.confidence,
    minimumEntryScore: signal.minimumEntryScore,
    timeRegime: signal.timeRegime,
    shortDeltaAbs: signal.shortDeltaAbs,
    shortDistancePoints: signal.shortDistancePoints,
    entryMarkCredit: signal.markCredit,
    entrySellableCredit: signal.sellableCredit,
    entryShortLegs,
    signalPeakCredit: signal.peakCreditAtSignal,
    premiumExpansionPct: signal.premiumExpansionPct,
    premiumRolloverPct: signal.premiumRolloverPct,
    premiumCrestStatus: signal.premiumCrestStatus,
    priceRejectionScore: signal.priceRejectionScore,
    remainingMovePoints: signal.remainingMovePoints,
    maxRiskDollars: signal.maxRiskDollars,
    widthPoints: shadowWidthPoints(signal.legs),
    eventRisk: signal.eventRisk,
    rangeConsumptionPct: signal.rangeConsumptionPct,
    entryMapPhase: signal.mapPhase,
    entryMapCenter: signal.mapCenter,
    entryRailBreached: signal.railBreached,
    pathDirection: signal.pathDirection,
    pathConfidence: signal.pathConfidence,
    pathFlowSource: signal.pathFlowSource,
    pathTerminalTrough: signal.pathTerminalTrough,
    pathTerminalCrest: signal.pathTerminalCrest,
    portfolioDecision: args.opportunity.decision,
    portfolioRole: args.opportunity.role,
    portfolioConviction: args.opportunity.conviction,
    portfolioConvictionScore: args.opportunity.convictionScore,
    premiumQualityScore: args.opportunity.premiumQualityScore,
    premiumQualityLabel: args.opportunity.premiumQualityLabel,
    effectiveRiskBeforeDollars: args.opportunity.effectiveRiskBeforeDollars,
    effectiveRiskAfterDollars: args.opportunity.effectiveRiskAfterDollars,
    incrementalEffectiveRiskDollars: args.opportunity.incrementalEffectiveRiskDollars,
    availableCapacityAfterDollars: args.opportunity.availableCapacityAfterDollars,
    adaptiveReserveNeedDollars: args.opportunity.adaptiveReserveNeedDollars,
    reserveCoverageX: args.opportunity.reserveCoverageX,
    callReleaseReserveDollars: args.opportunity.callReleaseReserveDollars,
    putReleaseReserveDollars: args.opportunity.putReleaseReserveDollars,
    reserveDominantSide: args.opportunity.reserveDominantSide,
    portfolioRepairDeficitDollars: args.opportunity.portfolioRepairDeficitDollars,
    candidateOffsetCreditDollars: args.opportunity.candidateOffsetCreditDollars,
    portfolioDecisionReason: args.opportunity.reasons.join(" "),
    entryLegSnapshots: args.opportunity.entryLegSnapshots,
    entryGreeks: args.opportunity.entryGreeks,
  });
  return (json.trade ?? null) as ZeroDteShadowTrade | null;
}

export async function sampleZeroDteShadowTrades(args: {
  tradeDate: string;
  generatedAt: string;
  spot: number;
  items: Array<{
    tradeId: string;
    read: ZeroDteExecutionRead;
    currentShortBuybackPrice: number | null;
    currentShortLegMultiple: number | null;
    currentLegSnapshots: ShadowLegSnapshot[];
    adaptiveDecision: AdaptiveManagementDecision | null;
  }>;
}) {
  if (!args.items.length) return [] as ZeroDteShadowTrade[];
  const json = await call({
    action: "sample-batch",
    ...args,
    items: args.items.map(({ tradeId, read, currentShortBuybackPrice, currentShortLegMultiple, currentLegSnapshots, adaptiveDecision }) => ({
      tradeId,
      strategy: read.position?.strategy ?? read.strategy,
      lifecycle: read.lifecycle,
      exitScore: read.exitScore,
      emergencyExit: read.emergencyExit,
      markCredit: read.currentCredit,
      sellableCredit: read.currentSellableCredit,
      buybackDebit: read.currentBuybackDebit,
      currentShortBuybackPrice,
      currentShortLegMultiple,
      currentLegSnapshots,
      adaptiveDecision,
      shortDistancePoints: read.position
        ? shortDistanceForPosition(read, args.spot)
        : read.shortDistancePoints,
      pathThreat: Boolean(
        read.leastResistancePath &&
          read.position &&
          read.position.strategy !== "iron-fly" &&
          read.position.legs.some(
            (leg) =>
              leg.action === "sell" &&
              (read.position!.strategy === "put-credit-spread"
                ? read.leastResistancePath!.terminalTrough <= leg.strike
                : read.leastResistancePath!.terminalCrest >= leg.strike),
          ),
      ),
    })),
  });
  return (json.trades ?? []) as ZeroDteShadowTrade[];
}

export async function closeZeroDteShadowTrade(args: {
  tradeId: string;
  tradeDate: string;
  generatedAt: string;
  read: ZeroDteExecutionRead;
  reason: string;
}) {
  const json = await call({
    action: "close",
    tradeId: args.tradeId,
    tradeDate: args.tradeDate,
    exitTime: args.generatedAt,
    exitReason: args.reason,
    exitBuybackDebit: args.read.currentBuybackDebit ?? args.read.currentCredit,
    exitScore: args.read.exitScore,
    emergencyExit: args.read.emergencyExit,
  });
  return (json.trade ?? null) as ZeroDteShadowTrade | null;
}

function shortDistanceForPosition(read: ZeroDteExecutionRead, spot: number) {
  const position = read.position;
  if (!position) return null;
  const short = position.legs.find((leg) => leg.action === "sell")?.strike ?? null;
  if (short === null) return null;
  if (position.strategy === "put-credit-spread") return spot - short;
  if (position.strategy === "call-credit-spread") return short - spot;
  return Math.abs(spot - short);
}
