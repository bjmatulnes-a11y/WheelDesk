import type { ConfirmedExecutionSignal } from "./execution/useExecutionSignalPaint";
import type { ExecutionLeg, ExecutionStrategy } from "./zeroDteExecutionIntelligence";
import type { ZeroDteChainRow } from "./zeroDteOiIntelligence";
import type { ZeroDtePortfolioRead } from "./zeroDtePortfolioEngine";
import type { ZeroDteRiskPolicy } from "./zeroDteRiskPolicy";
import type { AdaptiveAuctionContext } from "./zeroDteAdaptiveManagement";
import type { ZeroDteShadowTrade } from "./zeroDteShadowTrade";
import {
  addCandidateToMarginEnvelope,
  buildAdaptiveMarginEnvelope,
  buildAdaptiveReserveEnvelope,
  candidateMarginDollars,
  portfolioRepairDeficitDollars,
} from "./zeroDteAdaptiveCapital";

export type LiveEsConvictionTier =
  | "DEFINITIVE"
  | "CONFIRMED"
  | "SUPPORTIVE"
  | "MIXED"
  | "CONFLICT"
  | "INSUFFICIENT";

export type ShadowPortfolioDecision = "TAKE" | "WATCH" | "PASS" | "BLOCKED_CAPITAL";

export type ShadowPortfolioRole =
  | "BUILD"
  | "PAIRED_SIDE"
  | "REPAIR_OFFSET"
  | "REPAIR"
  | "DEFENSE"
  | "NEW_RISK"
  | "IF_CENTER";

export type ShadowLegRole =
  | "CORE_SHORT"
  | "CEILING_LONG"
  | "FLOOR_LONG"
  | "CENTER_SHORT"
  | "UPPER_WING"
  | "LOWER_WING"
  | "RUNNER"
  | "REPAIR_SHORT";

export type ShadowLegSnapshot = {
  optionType: "call" | "put";
  action: "sell" | "buy";
  strike: number;
  role: ShadowLegRole;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
};

export type ShadowGreekSnapshot = {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
};

export type AdaptivePortfolioOpportunity = {
  decision: ShadowPortfolioDecision;
  role: ShadowPortfolioRole;
  conviction: LiveEsConvictionTier;
  convictionScore: number;
  premiumQualityScore: number;
  premiumQualityLabel: "EXCELLENT" | "STRONG" | "ACCEPTABLE" | "WEAK";
  effectiveRiskBeforeDollars: number;
  effectiveRiskAfterDollars: number;
  incrementalEffectiveRiskDollars: number;
  availableCapacityAfterDollars: number;
  adaptiveReserveNeedDollars: number;
  reserveCoverageX: number | null;
  callReleaseReserveDollars: number;
  putReleaseReserveDollars: number;
  reserveDominantSide: "CALL" | "PUT" | "BALANCED" | "NONE";
  portfolioRepairDeficitDollars: number;
  candidateOffsetCreditDollars: number;
  reasons: string[];
  entryLegSnapshots: ShadowLegSnapshot[];
  entryGreeks: ShadowGreekSnapshot;
};

/**
 * Selectively admits confirmed SELL_READY signals into the shadow portfolio.
 *
 * IMPORTANT: DEFINITIVE/CONFLICT are conviction evidence, not sizing commands.
 * One confirmed signal represents one independently evaluated lot. Capital,
 * premium economics and the current portfolio decide whether that lot enters.
 */
export function evaluateAdaptivePortfolioOpportunity(args: {
  signal: ConfirmedExecutionSignal;
  rows: ZeroDteChainRow[];
  portfolio: ZeroDtePortfolioRead | null;
  existingTrades: ZeroDteShadowTrade[];
  riskPolicy: ZeroDteRiskPolicy;
  auction?: AdaptiveAuctionContext | null;
}): AdaptivePortfolioOpportunity {
  const { signal, rows, riskPolicy } = args;
  const auction = args.auction ?? null;
  const activeAccepted = args.existingTrades.filter(
    (trade) =>
      trade.portfolioDecision === "TAKE" &&
      trade.state !== "skipped" &&
      (trade.state === "open" || trade.adaptiveState === "open"),
  );

  const entryLegSnapshots = buildShadowLegSnapshots(rows, signal.legs, signal.strategy);
  const entryGreeks = aggregateGreeks(entryLegSnapshots);
  const candidateMargin = candidateMarginDollars(signal);
  const marginBefore = buildAdaptiveMarginEnvelope(activeAccepted);
  const projectedMargin = addCandidateToMarginEnvelope(marginBefore, signal.strategy, candidateMargin);

  // The shadow ledger owns the adaptive leg transformations. Actual execution
  // positions may also exist, so preserve the larger observed portfolio envelope
  // rather than letting shadow math understate live account exposure.
  const actualEffectiveRisk = args.portfolio?.effectiveRiskDollars ?? 0;
  const effectiveRiskBeforeDollars = Math.max(actualEffectiveRisk, marginBefore.effectiveMarginDollars);
  const effectiveRiskAfterDollars = Math.max(actualEffectiveRisk, projectedMargin.effectiveMarginDollars);
  const incrementalEffectiveRiskDollars = Math.max(0, effectiveRiskAfterDollars - effectiveRiskBeforeDollars);
  const availableCapacityAfterDollars = Math.max(0, riskPolicy.grossRiskBudgetDollars - effectiveRiskAfterDollars);

  const candidateShortSellPrice = entryLegSnapshots.find((leg) => leg.action === "sell")?.bid ?? null;
  const reserve = buildAdaptiveReserveEnvelope(activeAccepted, {
    strategy: signal.strategy,
    shortSellPrice: signal.strategy === "iron-fly" ? null : candidateShortSellPrice,
  });
  const adaptiveReserveNeedDollars = reserve.verticalReleaseReserveDollars;
  const reserveCoverageX = adaptiveReserveNeedDollars > 0
    ? availableCapacityAfterDollars / adaptiveReserveNeedDollars
    : null;

  const repairDeficit = portfolioRepairDeficitDollars(activeAccepted);
  const candidateOffsetCreditDollars = Math.max(0, signal.sellableCredit ?? 0) * 100;
  const convictionRead = classifyLiveEsConviction(signal, auction);
  const premiumRead = scorePremium(signal, riskPolicy, activeAccepted);
  const role = classifyRole(signal, activeAccepted, repairDeficit);
  const reasons: string[] = [];

  reasons.push(
    `Live ES conviction is ${convictionRead.tier}; it informs willingness to take the lot but does not assign quantity.`,
  );
  reasons.push(
    `Premium quality is ${premiumRead.label}: ${money(signal.sellableCredit)} credit on ${width(signal.legs)?.toFixed(0) ?? "?"}-point geometry.${premiumRead.relativeDetail ? ` ${premiumRead.relativeDetail}` : ""}`,
  );
  reasons.push(
    `Adaptive margin envelope moves from $${Math.round(effectiveRiskBeforeDollars).toLocaleString()} to $${Math.round(effectiveRiskAfterDollars).toLocaleString()} (${incrementalEffectiveRiskDollars > 0 ? "+" : ""}$${Math.round(incrementalEffectiveRiskDollars).toLocaleString()} incremental).`,
  );
  if ((role === "PAIRED_SIDE" || role === "REPAIR_OFFSET") && incrementalEffectiveRiskDollars < candidateMargin * 0.5) {
    reasons.push("Opposite-side geometry is using the existing worst-side margin envelope efficiently.");
  }
  if (role === "REPAIR_OFFSET" && repairDeficit > 0) {
    reasons.push(`The portfolio currently carries about $${Math.round(repairDeficit).toLocaleString()} of marked vertical repair deficit; this independently qualified opposite-side lot can add about $${Math.round(candidateOffsetCreditDollars).toLocaleString()} of entry credit.`);
  }
  if (reserveCoverageX !== null) {
    reasons.push(
      `After this lot, modeled short-release reserve is $${Math.round(adaptiveReserveNeedDollars).toLocaleString()} (${reserve.dominantSide.toLowerCase()} side dominant), covered ${reserveCoverageX.toFixed(2)}× by unused configured capacity.`,
    );
  }

  const base = {
    role,
    conviction: convictionRead.tier,
    convictionScore: convictionRead.score,
    premiumQualityScore: premiumRead.score,
    premiumQualityLabel: premiumRead.label,
    effectiveRiskBeforeDollars,
    effectiveRiskAfterDollars,
    incrementalEffectiveRiskDollars,
    availableCapacityAfterDollars,
    adaptiveReserveNeedDollars,
    reserveCoverageX,
    callReleaseReserveDollars: reserve.callReleaseReserveDollars,
    putReleaseReserveDollars: reserve.putReleaseReserveDollars,
    reserveDominantSide: reserve.dominantSide,
    portfolioRepairDeficitDollars: repairDeficit,
    candidateOffsetCreditDollars,
    entryLegSnapshots,
    entryGreeks,
  } satisfies Omit<AdaptivePortfolioOpportunity, "decision" | "reasons">;

  if (effectiveRiskAfterDollars > riskPolicy.grossRiskBudgetDollars + 0.01) {
    return {
      ...base,
      decision: "BLOCKED_CAPITAL",
      reasons: [...reasons, "The lot exceeds the configured effective margin envelope, so it is recorded but not opened."],
    };
  }

  if (signal.sellableCredit == null || signal.sellableCredit < riskPolicy.minSellableCredit) {
    return {
      ...base,
      decision: "PASS",
      reasons: [...reasons, "Executable credit is below the configured premium floor."],
    };
  }

  if (convictionRead.tier === "CONFLICT") {
    return {
      ...base,
      decision: "WATCH",
      reasons: [...reasons, "ES direction materially conflicts with the option fade; preserve the signal as a watch rather than automatically opening it."],
    };
  }

  if (premiumRead.label === "WEAK") {
    return {
      ...base,
      decision: "WATCH",
      reasons: [...reasons, "The signal is valid, but the executable premium is not rich enough to automatically consume portfolio capacity."],
    };
  }

  // Later ordinary NEW_RISK needs a stronger combination than morning BUILD,
  // repair or opposite-side pairing. This is a bias, not a hardened lot count.
  if (
    role === "NEW_RISK" &&
    convictionRead.tier !== "DEFINITIVE" &&
    convictionRead.tier !== "CONFIRMED" &&
    premiumRead.label !== "EXCELLENT"
  ) {
    return {
      ...base,
      decision: "WATCH",
      reasons: [...reasons, "Later-session ordinary new risk needs either strong ES confirmation or exceptional premium; management capacity is being preserved."],
    };
  }

  // Reserve is dynamic and scales with the actual open short inventory. An
  // efficiently paired / repair-offset order may still be useful when it adds
  // little or no worst-side margin, but ordinary same-side additions must leave
  // enough modeled capacity to release the currently exposed short side.
  const pairedEfficient =
    (role === "PAIRED_SIDE" || role === "REPAIR_OFFSET") &&
    incrementalEffectiveRiskDollars <= Math.max(50, candidateMargin * 0.25);
  const requiredCoverage = pairedEfficient ? 0.5 : 1.0;
  if (
    reserveCoverageX !== null &&
    reserveCoverageX < requiredCoverage &&
    incrementalEffectiveRiskDollars > 0 &&
    !pairedEfficient
  ) {
    return {
      ...base,
      decision: "WATCH",
      reasons: [
        ...reasons,
        `The lot would leave only ${reserveCoverageX.toFixed(2)}× coverage of the modeled open-short release reserve; preserve adaptive funds instead of hardening a contract-count limit.`,
      ],
    };
  }

  if (pairedEfficient && reserveCoverageX !== null && reserveCoverageX < 0.5) {
    return {
      ...base,
      decision: "WATCH",
      reasons: [
        ...reasons,
        "Opposite-side margin pairing is efficient, but the portfolio is already too thin on modeled short-release cash reserve to auto-admit another lot.",
      ],
    };
  }

  return {
    ...base,
    decision: "TAKE",
    reasons: [...reasons, "This signal is admitted as one independently selected lot; the next signal is re-evaluated at its own premium, conviction and post-trade adaptive capacity."],
  };
}

export function buildShadowLegSnapshots(
  rows: ZeroDteChainRow[],
  legs: ExecutionLeg[],
  strategy: ExecutionStrategy,
  roleOverrides?: Map<string, ShadowLegRole>,
): ShadowLegSnapshot[] {
  return legs.map((leg) => {
    const row = rows.find(
      (item) => item.optionType === leg.optionType && Math.abs(item.strike - leg.strike) < 0.01,
    );
    return {
      ...leg,
      role: roleOverrides?.get(legKey(leg)) ?? defaultLegRole(strategy, leg, legs),
      bid: finite(row?.bid),
      ask: finite(row?.ask),
      mid: finite(row?.mid),
      iv: finite(row?.iv),
      delta: finite(row?.delta),
      gamma: finite(row?.gamma),
      theta: finite(row?.theta),
      vega: finite(row?.vega),
    };
  });
}

export function aggregateGreeks(snapshots: ShadowLegSnapshot[]): ShadowGreekSnapshot {
  let delta = 0;
  let gamma = 0;
  let theta = 0;
  let vega = 0;
  for (const leg of snapshots) {
    const sign = leg.action === "buy" ? 1 : -1;
    delta += sign * (leg.delta ?? 0) * 100;
    gamma += sign * (leg.gamma ?? 0) * 100;
    theta += sign * (leg.theta ?? 0) * 100;
    vega += sign * (leg.vega ?? 0) * 100;
  }
  return {
    delta: round(delta),
    gamma: round(gamma),
    theta: round(theta),
    vega: round(vega),
  };
}

export function classifyLiveEsConviction(
  signal: Pick<ConfirmedExecutionSignal, "strategy" | "legs" | "mapCenter">,
  auction: AdaptiveAuctionContext | null,
): { tier: LiveEsConvictionTier; score: number; reasons: string[] } {
  if (!auction?.state || (auction.flowConfidencePct ?? 0) < 20) {
    return { tier: "INSUFFICIENT", score: 50, reasons: ["Live ES proxy is not mature enough for a directional confluence read."] };
  }

  if (signal.strategy === "iron-fly") {
    const center = signal.mapCenter;
    const poc = auction.projectedPocSpx;
    const pocDistance = poc == null ? null : Math.abs(poc - center);
    const directionalRelease = auction.state === "RELEASE_UP" || auction.state === "RELEASE_DOWN";
    const lowEfficiency = (auction.efficiencyPct ?? 100) <= 35;
    let score = 50;
    if (pocDistance !== null && pocDistance <= 5) score += 22;
    if (Math.abs(auction.pocMigration5mSpx ?? 0) <= 0.75) score += 12;
    if (lowEfficiency) score += 12;
    if (directionalRelease && (auction.efficiencyPct ?? 0) >= 50) score -= 35;
    return tierFromScore(score, directionalRelease && (auction.efficiencyPct ?? 0) >= 55);
  }

  const isPut = signal.strategy === "put-credit-spread";
  const alignedStates = isPut
    ? ["ABSORBING_LOW", "EXHAUSTING_DOWN", "REVERSAL_UP"]
    : ["ABSORBING_HIGH", "EXHAUSTING_UP", "REVERSAL_DOWN"];
  const opposingStates = isPut
    ? ["RELEASE_DOWN", "REVERSAL_DOWN"]
    : ["RELEASE_UP", "REVERSAL_UP"];
  const short = signal.legs.find((leg) => leg.action === "sell")?.strike ?? null;
  const pressure = auction.directionalPressurePct ?? 0;
  const efficiency = auction.efficiencyPct ?? 0;
  const poc = auction.projectedPocSpx;
  const pocMigration = auction.pocMigration5mSpx ?? 0;
  let score = 50;
  const reasons: string[] = [];

  if (alignedStates.includes(auction.state)) {
    score += 24;
    reasons.push(`${auction.state} aligns with the ${isPut ? "put" : "call"} fade.`);
  }
  if (opposingStates.includes(auction.state)) {
    score -= efficiency >= 45 ? 32 : 22;
    reasons.push(`${auction.state} is directional continuation against the fade.`);
  }
  const alignedPressure = isPut ? pressure >= 18 : pressure <= -18;
  const opposingPressure = isPut ? pressure <= -18 : pressure >= 18;
  if (alignedPressure) score += efficiency >= 40 ? 12 : 7;
  if (opposingPressure) score -= efficiency >= 45 ? 14 : 7;
  if (short !== null && poc !== null) {
    const supportiveLocation = isPut ? poc >= short + 5 : poc <= short - 5;
    const adverseLocation = isPut ? poc <= short : poc >= short;
    if (supportiveLocation) score += 12;
    if (adverseLocation) score -= 14;
  }
  if (isPut ? pocMigration > 0.5 : pocMigration < -0.5) score += 8;
  if (isPut ? pocMigration < -0.5 : pocMigration > 0.5) score -= 8;
  score += clamp(((auction.flowConfidencePct ?? 50) - 50) * 0.08, -4, 4);

  const hardConflict = opposingStates.includes(auction.state) && efficiency >= 50;
  const tiered = tierFromScore(score, hardConflict);
  return { ...tiered, reasons };
}

function tierFromScore(scoreValue: number, hardConflict: boolean) {
  const score = Math.round(clamp(scoreValue, 0, 100));
  const tier: LiveEsConvictionTier = hardConflict
    ? "CONFLICT"
    : score >= 82
      ? "DEFINITIVE"
      : score >= 70
        ? "CONFIRMED"
        : score >= 59
          ? "SUPPORTIVE"
          : score <= 35
            ? "CONFLICT"
            : score <= 46
              ? "MIXED"
              : "INSUFFICIENT";
  return { tier, score, reasons: [] as string[] };
}

function scorePremium(
  signal: ConfirmedExecutionSignal,
  policy: ZeroDteRiskPolicy,
  active: ZeroDteShadowTrade[],
) {
  const credit = Math.max(0, signal.sellableCredit ?? 0);
  const spreadWidth = width(signal.legs) ?? Math.max(5, policy.minWidth);
  const creditToWidth = spreadWidth > 0 ? credit / spreadWidth : 0;
  const floorRatio = policy.minSellableCredit > 0 ? credit / policy.minSellableCredit : 1;
  let score = 35;
  score += clamp((floorRatio - 1) * 22, -20, 30);
  score += clamp((creditToWidth - 0.06) * 300, -15, 30);
  score += clamp((signal.premiumExpansionPct ?? 0) * 0.12, 0, 12);

  // Premium is assessed in the context of the lots already selected on the same
  // strategy. This preserves the user's one-at-a-time build behavior: a later
  // lot should earn capital because its economics are attractive now, not simply
  // because an earlier signal was taken.
  const peers = active
    .filter((trade) => trade.strategy === signal.strategy)
    .map((trade) => {
      const peerWidth = trade.widthPoints ?? width(trade.legs);
      return peerWidth && peerWidth > 0 ? trade.entrySellableCredit / peerWidth : null;
    })
    .filter((value): value is number => value !== null && Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  const benchmark = median(peers);
  let relativeDetail = "";
  if (benchmark !== null && benchmark > 0 && creditToWidth > 0) {
    const ratio = creditToWidth / benchmark;
    score += clamp((ratio - 1) * 45, -20, 20);
    relativeDetail = ratio >= 1.05
      ? `Credit/width is ${Math.round((ratio - 1) * 100)}% richer than the median active same-strategy lot.`
      : ratio <= 0.9
        ? `Credit/width is ${Math.round((1 - ratio) * 100)}% thinner than the median active same-strategy lot.`
        : "Credit/width is near the median active same-strategy lot.";
  }

  score = clamp(score, 0, 100);
  const label = score >= 78 ? "EXCELLENT" : score >= 64 ? "STRONG" : score >= 48 ? "ACCEPTABLE" : "WEAK";
  return { score: Math.round(score), label, relativeDetail } as const;
}

function classifyRole(
  signal: ConfirmedExecutionSignal,
  active: ZeroDteShadowTrade[],
  repairDeficitDollars: number,
): ShadowPortfolioRole {
  if (signal.strategy === "iron-fly") return "IF_CENTER";
  const opposite = signal.strategy === "call-credit-spread" ? "put-credit-spread" : "call-credit-spread";
  const signalShort = signal.legs.find((leg) => leg.action === "sell")?.strike ?? null;
  const sameSide = active.filter((trade) => trade.strategy === signal.strategy);
  const repairing = sameSide.some(
    (trade) => trade.adaptiveStructureState === "LONG_RUNNER" || trade.adaptiveStructureState === "REPAIRED_SPREAD",
  );
  if (signalShort !== null && sameSide.length) {
    const isCall = signal.strategy === "call-credit-spread";
    const improvesLocation = sameSide.some((trade) => {
      const priorShort = trade.adaptiveReinstatedShortStrike ??
        trade.legs.find((leg) => leg.action === "sell")?.strike ?? null;
      return priorShort !== null && (isCall ? signalShort > priorShort : signalShort < priorShort);
    });
    if (repairing && improvesLocation) return "REPAIR";

    // A richer spread farther from the challenged short is a defensive layer,
    // not an unrelated new bet. Example: 7740/7750 added while 7735/7745 is
    // under pressure. It still consumes capital and must pass the governor.
    const challenged = sameSide.some(
      (trade) =>
        trade.hitShortStrike ||
        (trade.currentShortLegMultiple !== null && trade.currentShortLegMultiple >= 1.5),
    );
    if (challenged && improvesLocation) return "DEFENSE";
  }

  // If this is not a same-side repair/defense, the opposite book can provide
  // paired-margin efficiency. That pairing classification should not hide the
  // real purpose of a defensive same-side layer.
  const oppositeTrades = active.filter((trade) => trade.strategy === opposite);
  const oppositeRepairing = oppositeTrades.some(
    (trade) =>
      trade.adaptiveStructureState === "LONG_RUNNER" ||
      trade.adaptiveStructureState === "REPAIRED_SPREAD" ||
      (trade.adaptiveStructureHistory ?? []).some((item) => item.action === "RELEASE_SHORT"),
  );
  if (oppositeRepairing && repairDeficitDollars > 0) return "REPAIR_OFFSET";
  if (oppositeTrades.length) return "PAIRED_SIDE";

  if (signal.timeRegime === "OPENING_OPPORTUNITY" || signal.timeRegime === "SELECTIVE_CONTINUATION") {
    return "BUILD";
  }
  return "NEW_RISK";
}

function defaultLegRole(
  strategy: ExecutionStrategy,
  leg: ExecutionLeg,
  legs: ExecutionLeg[],
): ShadowLegRole {
  if (strategy === "iron-fly") {
    const sold = legs.filter((item) => item.action === "sell").map((item) => item.strike);
    const center = sold.length ? sold.reduce((sum, strike) => sum + strike, 0) / sold.length : leg.strike;
    if (leg.action === "sell") return "CENTER_SHORT";
    return leg.strike > center ? "UPPER_WING" : "LOWER_WING";
  }
  if (leg.action === "sell") return "CORE_SHORT";
  return strategy === "call-credit-spread" ? "CEILING_LONG" : "FLOOR_LONG";
}

function legKey(leg: ExecutionLeg) {
  return `${leg.optionType}:${leg.action}:${leg.strike}`;
}

function width(legs: ExecutionLeg[]) {
  if (legs.length !== 2) return null;
  return Math.abs(legs[0].strike - legs[1].strike);
}

function median(values: number[]) {
  if (!values.length) return null;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

function money(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : `$${value.toFixed(2)}`;
}

function finite(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}
