import type { EsOrderFlowState } from "./zeroDteEsOrderFlow";
import type { ZeroDteExecutionRead } from "./zeroDteExecutionIntelligence";
import { leastResistanceThreatensShort } from "./zeroDteLeastResistancePath";
import type { ExecutionLeg } from "./zeroDteExecutionIntelligence";
import type { ZeroDteChainRow } from "./zeroDteOiIntelligence";
import type { ZeroDteShadowTrade, AdaptiveStructureState } from "./zeroDteShadowTrade";
import { aggregateGreeks, buildShadowLegSnapshots, type ShadowGreekSnapshot } from "./zeroDteAdaptivePortfolio";

export type AdaptiveManagementState =
  | "HEALTHY"
  | "FAVORABLE_RELEASE"
  | "RECOVERY"
  | "THREATENED"
  | "INVALIDATED"
  | "HARVEST";

export type AdaptiveManagementAction =
  | "HOLD"
  | "HOLD_FOR_DEEPER_HARVEST"
  | "WATCH"
  | "RELEASE_SHORT"
  | "REINSTATE_SHORT"
  | "CLOSE_RUNNER"
  | "EXIT";

export type AdaptiveExitReason =
  | "ADAPTIVE_TARGET"
  | "ADAPTIVE_PROFIT_PROTECTION"
  | "ADAPTIVE_INVALIDATION"
  | "ADAPTIVE_SHORT_3X"
  | "ADAPTIVE_IF_NEAR_MAX_LOSS"
  | "ADAPTIVE_RUNNER_RECOVERED"
  | "ADAPTIVE_RUNNER_EXHAUSTED"
  | "ADAPTIVE_SESSION_CLOSE";

/**
 * Live-auction context passed from the 1-second Schwab ES observer.
 * This remains a proxy layer: no full DOM / true T&S assumptions are made.
 */
export type AdaptiveAuctionContext = {
  state: EsOrderFlowState | null;
  directionalPressurePct: number | null;
  efficiencyPct: number | null;
  flowConfidencePct: number | null;
  observedPocEs: number | null;
  projectedPocSpx: number | null;
  pocMigration5mSpx: number | null;
  observedVolume: number;
  classificationPct: number | null;
};

export type AdaptiveStructureTransition = {
  type: "RELEASE_SHORT" | "REINSTATE_SHORT" | "CLOSE_RUNNER";
  strike: number | null;
  executionPrice: number;
  nextStructureState: AdaptiveStructureState;
  nextActiveLegs: ExecutionLeg[];
  nextNetCashPoints: number;
  detail: string;
};

export type AdaptiveManagementDecision = {
  state: AdaptiveManagementState;
  action: AdaptiveManagementAction;
  shouldExit: boolean;
  exitReason: AdaptiveExitReason | null;
  targetCapturePct: number | null;
  targetDebit: number | null;
  targetR: number | null;
  thesisScore: number;
  favorableScore: number;
  threatScore: number;
  invalidationScore: number;
  currentPnlDollars: number | null;
  maxAdverseExcursionDollars: number;
  maxFavorableExcursionDollars: number;
  profitGivebackPct: number | null;
  auctionState: EsOrderFlowState | null;
  auctionPressurePct: number | null;
  auctionEfficiencyPct: number | null;
  projectedPocSpx: number | null;
  structureState: AdaptiveStructureState | null;
  structureTransition: AdaptiveStructureTransition | null;
  markedPnlDollars: number | null;
  currentGreeks: ShadowGreekSnapshot | null;
  reasons: string[];
};

export function evaluateZeroDteAdaptiveManagement(args: {
  trade: ZeroDteShadowTrade;
  read: ZeroDteExecutionRead;
  spot: number;
  rows?: ZeroDteChainRow[];
  minSellableCredit?: number;
  auction?: AdaptiveAuctionContext | null;
}): AdaptiveManagementDecision {
  const { trade, read, spot } = args;
  const auction = args.auction ?? null;
  const debit = finitePositiveOrZero(read.currentBuybackDebit ?? read.currentCredit);
  const structureMark =
    trade.strategy === "iron-fly" || !args.rows?.length
      ? null
      : markAdaptiveVerticalStructure(trade, args.rows);
  const currentPnlDollars =
    structureMark?.markedPnlDollars ??
    (debit === null ? null : (trade.entrySellableCredit - debit) * 100);
  const currentAdverse = currentPnlDollars === null ? 0 : Math.max(0, -currentPnlDollars);
  const currentFavorable = currentPnlDollars === null ? 0 : Math.max(0, currentPnlDollars);
  const priorAdaptiveMae = trade.adaptiveMaxAdverseExcursionDollars ?? 0;
  const priorAdaptiveMfe = trade.adaptiveMaxFavorableExcursionDollars ?? 0;
  const adaptiveMae = Math.max(priorAdaptiveMae, currentAdverse);
  const adaptiveMfe = Math.max(priorAdaptiveMfe, currentFavorable);
  const profitGivebackPct =
    currentPnlDollars !== null && currentPnlDollars >= 0 && adaptiveMfe > 0
      ? clamp(((adaptiveMfe - currentPnlDollars) / adaptiveMfe) * 100, 0, 100)
      : null;

  if (read.timeRegime.regime === "CLOSED") {
    return decision({
      state: "HARVEST",
      action: "EXIT",
      shouldExit: true,
      exitReason: "ADAPTIVE_SESSION_CLOSE",
      targetCapturePct: null,
      targetDebit: debit,
      targetR: null,
      thesisScore: 0,
      favorableScore: 0,
      threatScore: 100,
      invalidationScore: 100,
      currentPnlDollars,
      adaptiveMae,
      adaptiveMfe,
      profitGivebackPct,
      auction,
      reasons: ["0DTE session is closed; adaptive management exits the remaining paper position."],
    });
  }

  if (trade.strategy === "iron-fly") {
    return evaluateIronFly({
      trade,
      read,
      spot,
      debit,
      currentPnlDollars,
      adaptiveMae,
      adaptiveMfe,
      profitGivebackPct,
      auction,
    });
  }

  return evaluateVertical({
    trade,
    read,
    spot,
    debit,
    currentPnlDollars,
    adaptiveMae,
    adaptiveMfe,
    profitGivebackPct,
    auction,
    rows: args.rows ?? [],
    minSellableCredit: Math.max(0, args.minSellableCredit ?? 0.75),
    structureMark,
  });
}

function evaluateVertical(args: {
  trade: ZeroDteShadowTrade;
  read: ZeroDteExecutionRead;
  spot: number;
  debit: number | null;
  currentPnlDollars: number | null;
  adaptiveMae: number;
  adaptiveMfe: number;
  profitGivebackPct: number | null;
  auction: AdaptiveAuctionContext | null;
  rows: ZeroDteChainRow[];
  minSellableCredit: number;
  structureMark: ReturnType<typeof markAdaptiveVerticalStructure> | null;
}): AdaptiveManagementDecision {
  const {
    trade,
    read,
    spot,
    debit,
    currentPnlDollars,
    adaptiveMae,
    adaptiveMfe,
    profitGivebackPct,
    auction,
    rows,
    minSellableCredit,
    structureMark,
  } = args;
  const isPut = trade.strategy === "put-credit-spread";
  const shortStrike =
    structureMark?.activeLegs.find((leg) => leg.action === "sell")?.strike ??
    firstShortStrike(trade);
  const shortDistance = shortStrike === null ? null : isPut ? spot - shortStrike : shortStrike - spot;
  const shortBreached = shortDistance !== null && shortDistance <= 0;
  const worstShortMultiple =
    structureMark?.shortMultiple ?? trade.currentShortLegMultiple;
  const threeXShort = worstShortMultiple !== null && worstShortMultiple >= 3;
  const adverseRail = isPut ? read.railBreached === "LOWER" : read.railBreached === "UPPER";
  const mapShift = read.mapCenter - trade.entryMapCenter;
  const adverseMapShift = isPut ? mapShift <= -15 : mapShift >= 15;
  const pathThreat =
    shortStrike !== null &&
    leastResistanceThreatensShort({
      path: read.leastResistancePath,
      strategy: trade.strategy,
      shortStrike,
    });

  const favorableRelease = isPut
    ? auction?.state === "RELEASE_UP" || auction?.state === "REVERSAL_UP"
    : auction?.state === "RELEASE_DOWN" || auction?.state === "REVERSAL_DOWN";
  const recoveryAuction = isPut
    ? auction?.state === "ABSORBING_LOW" || auction?.state === "EXHAUSTING_DOWN"
    : auction?.state === "ABSORBING_HIGH" || auction?.state === "EXHAUSTING_UP";
  const adverseRelease = isPut
    ? auction?.state === "RELEASE_DOWN" || auction?.state === "REVERSAL_DOWN"
    : auction?.state === "RELEASE_UP" || auction?.state === "REVERSAL_UP";

  const pressure = auction?.directionalPressurePct ?? 0;
  const efficiency = auction?.efficiencyPct ?? 0;
  const confidence = auction?.flowConfidencePct ?? 0;
  const pressureAligned = isPut ? pressure > 20 : pressure < -20;
  const pressureAdverse = isPut ? pressure < -20 : pressure > 20;
  const projectedPoc = auction?.projectedPocSpx ?? null;
  const pocMigration = auction?.pocMigration5mSpx ?? null;
  const pocFavorable =
    shortStrike !== null && projectedPoc !== null
      ? isPut
        ? projectedPoc >= shortStrike + 5
        : projectedPoc <= shortStrike - 5
      : false;
  const pocBeyondShort =
    shortStrike !== null && projectedPoc !== null
      ? isPut
        ? projectedPoc <= shortStrike
        : projectedPoc >= shortStrike
      : false;
  const pocMigratingFavorable = pocMigration !== null && (isPut ? pocMigration > 0.5 : pocMigration < -0.5);
  const pocMigratingAdverse = pocMigration !== null && (isPut ? pocMigration < -0.5 : pocMigration > 0.5);

  const structureDecision = evaluateVerticalStructureTransition({
    trade,
    read,
    spot,
    rows,
    minSellableCredit,
    structureMark,
    auction,
    shortBreached,
    threeXShort,
    adverseRelease,
    efficiency,
    confidence,
    pocBeyondShort,
    pocMigratingAdverse,
    adverseMapShift,
  });
  if (structureDecision) return structureDecision;
  const verticalDecision = (value: Parameters<typeof decision>[0]) =>
    decision({
      ...value,
      structureState: trade.adaptiveStructureState ?? "CREDIT_SPREAD",
      markedPnlDollars: structureMark?.markedPnlDollars ?? value.currentPnlDollars,
      currentGreeks: structureMark?.currentGreeks ?? null,
    });
  const managementDebit =
    structureMark?.markedPnlDollars != null
      ? Math.max(0, trade.entrySellableCredit - structureMark.markedPnlDollars / 100)
      : debit;

  let favorableScore = 0;
  if (favorableRelease) favorableScore += 36;
  else if (recoveryAuction) favorableScore += 18;
  if (pressureAligned) favorableScore += clamp(Math.abs(pressure) * 0.22, 0, 16);
  if (pressureAligned && efficiency >= 45) favorableScore += 12;
  if (pocFavorable) favorableScore += 18;
  if (pocMigratingFavorable) favorableScore += 10;
  if (shortDistance !== null && shortDistance >= 20) favorableScore += 8;
  if (read.premiumVelocityPerMinute !== null && read.premiumVelocityPerMinute < -0.03) favorableScore += 8;
  favorableScore = clamp(favorableScore, 0, 100);

  let threatScore = 0;
  if (shortBreached) threatScore += 30;
  else if (shortDistance !== null && shortDistance <= Math.max(10, read.remainingMovePoints * 0.25)) threatScore += 16;
  if (worstShortMultiple !== null && worstShortMultiple >= 2.5) threatScore += 25;
  else if (worstShortMultiple !== null && worstShortMultiple >= 1.75) threatScore += 14;
  if (adverseRail) threatScore += 18;
  if (adverseMapShift) threatScore += 14;
  if (pathThreat) threatScore += 12;
  if (adverseRelease) threatScore += 24;
  if (pressureAdverse && efficiency >= 45) threatScore += 14;
  if (pocBeyondShort) threatScore += 18;
  else if (pocMigratingAdverse) threatScore += 10;
  threatScore = clamp(threatScore, 0, 100);

  const priceFailure = shortBreached || (worstShortMultiple !== null && worstShortMultiple >= 2.5);
  const structuralFailureCount = [adverseRail, adverseMapShift, pathThreat].filter(Boolean).length;
  const auctionFailure = Boolean(
    adverseRelease && efficiency >= 50 && confidence >= 45 ||
      pocBeyondShort && pocMigratingAdverse,
  );
  let invalidationScore = clamp(
    (priceFailure ? 32 : 0) +
      structuralFailureCount * 16 +
      (auctionFailure ? 28 : 0) +
      (pocBeyondShort ? 12 : 0),
    0,
    100,
  );
  if (threeXShort) invalidationScore = Math.max(invalidationScore, 88);

  const thesisScore = clamp(78 + favorableScore * 0.28 - threatScore * 0.55, 0, 100);
  const invalidated = Boolean(
    invalidationScore >= 75 && priceFailure && (auctionFailure || structuralFailureCount >= 2),
  );

  let targetCapturePct = 50;
  if (favorableScore >= 75 && threatScore < 30 && confidence >= 50) targetCapturePct = 80;
  else if (favorableScore >= 55 && threatScore < 40) targetCapturePct = 65;
  if (read.timeRegime.regime === "FINAL_ENTRY") targetCapturePct = Math.min(targetCapturePct, 50);
  const targetDebit = Math.max(0, trade.entrySellableCredit * (1 - targetCapturePct / 100));
  const capturedPct =
    managementDebit === null || trade.entrySellableCredit <= 0
      ? null
      : ((trade.entrySellableCredit - managementDebit) / trade.entrySellableCredit) * 100;

  const meaningfulMfe = 100;
  const retainedProfit = 50;
  const profitProtection = Boolean(
    currentPnlDollars !== null &&
      currentPnlDollars >= retainedProfit &&
      adaptiveMfe >= meaningfulMfe &&
      (profitGivebackPct ?? 0) >= 35 &&
      (favorableScore < 55 || threatScore >= 40),
  );

  const recoveredFromPain = Boolean(
    currentPnlDollars !== null &&
      currentPnlDollars < 0 &&
      adaptiveMae >= 100 &&
      Math.abs(currentPnlDollars) <= adaptiveMae * 0.7 &&
      thesisScore >= 55 &&
      threatScore < 55,
  );

  const reasons: string[] = [];
  if (favorableRelease) reasons.push(`Live ES state ${auction?.state} is moving away from the threatened short.`);
  if (pocFavorable && projectedPoc !== null && shortStrike !== null) {
    reasons.push(`Observed ES value projects to SPX ${projectedPoc.toFixed(1)}, favorably away from the ${shortStrike.toFixed(0)} short.`);
  }
  if (adverseRelease) reasons.push(`Live ES state ${auction?.state} is releasing toward the short.`);
  if (pocBeyondShort) reasons.push("Observed ES value has migrated to/through the short-strike side of the trade.");
  if (pathThreat) reasons.push("Least-resistance path reaches the short-strike side of the structure.");
  if (threeXShort) reasons.push(`Worst short leg is ${worstShortMultiple?.toFixed(2)}× its entry premium.`);

  if (threeXShort) {
    return verticalDecision({
      state: "THREATENED",
      action: "WATCH",
      shouldExit: false,
      exitReason: null,
      targetCapturePct,
      targetDebit,
      targetR: null,
      thesisScore,
      favorableScore,
      threatScore: Math.max(threatScore, 90),
      invalidationScore,
      currentPnlDollars,
      adaptiveMae,
      adaptiveMfe,
      profitGivebackPct,
      auction,
      reasons: [
        ...reasons,
        "The short has reached the 3× release threshold, but a leg-level transition could not be executed from the available exact-leg quote state. Do not liquidate the valuable long automatically; keep the short-release action armed.",
      ],
    });
  }

  if (invalidated) {
    return verticalDecision({
      state: "INVALIDATED",
      action: "EXIT",
      shouldExit: true,
      exitReason: "ADAPTIVE_INVALIDATION",
      targetCapturePct,
      targetDebit,
      targetR: null,
      thesisScore,
      favorableScore,
      threatScore,
      invalidationScore,
      currentPnlDollars,
      adaptiveMae,
      adaptiveMfe,
      profitGivebackPct,
      auction,
      reasons: [...reasons, "Price threat, structural failure, and continuation evidence have aligned."],
    });
  }

  if (managementDebit !== null && managementDebit <= targetDebit) {
    return verticalDecision({
      state: "HARVEST",
      action: "EXIT",
      shouldExit: true,
      exitReason: "ADAPTIVE_TARGET",
      targetCapturePct,
      targetDebit,
      targetR: null,
      thesisScore,
      favorableScore,
      threatScore,
      invalidationScore,
      currentPnlDollars,
      adaptiveMae,
      adaptiveMfe,
      profitGivebackPct,
      auction,
      reasons: [...reasons, `${Math.round(targetCapturePct)}% adaptive premium target has been reached.`],
    });
  }

  if (profitProtection) {
    return verticalDecision({
      state: "HARVEST",
      action: "EXIT",
      shouldExit: true,
      exitReason: "ADAPTIVE_PROFIT_PROTECTION",
      targetCapturePct,
      targetDebit,
      targetR: null,
      thesisScore,
      favorableScore,
      threatScore,
      invalidationScore,
      currentPnlDollars,
      adaptiveMae,
      adaptiveMfe,
      profitGivebackPct,
      auction,
      reasons: [...reasons, `Peak-profit giveback is ${Math.round(profitGivebackPct ?? 0)}% and favorable continuation has weakened.`],
    });
  }

  if (recoveredFromPain) {
    return verticalDecision({
      state: "RECOVERY",
      action: "HOLD",
      shouldExit: false,
      exitReason: null,
      targetCapturePct,
      targetDebit,
      targetR: null,
      thesisScore,
      favorableScore,
      threatScore,
      invalidationScore,
      currentPnlDollars,
      adaptiveMae,
      adaptiveMfe,
      profitGivebackPct,
      auction,
      reasons: [...reasons, `Position has recovered materially from a $${adaptiveMae.toFixed(0)} MAE while the thesis remains intact.`],
    });
  }

  if (threatScore >= 45) {
    return verticalDecision({
      state: "THREATENED",
      action: "WATCH",
      shouldExit: false,
      exitReason: null,
      targetCapturePct,
      targetDebit,
      targetR: null,
      thesisScore,
      favorableScore,
      threatScore,
      invalidationScore,
      currentPnlDollars,
      adaptiveMae,
      adaptiveMfe,
      profitGivebackPct,
      auction,
      reasons: [...reasons, "Threat is elevated, but objective invalidation has not been established."],
    });
  }

  if (targetCapturePct > 50) {
    return verticalDecision({
      state: "FAVORABLE_RELEASE",
      action: "HOLD_FOR_DEEPER_HARVEST",
      shouldExit: false,
      exitReason: null,
      targetCapturePct,
      targetDebit,
      targetR: null,
      thesisScore,
      favorableScore,
      threatScore,
      invalidationScore,
      currentPnlDollars,
      adaptiveMae,
      adaptiveMfe,
      profitGivebackPct,
      auction,
      reasons: [...reasons, `Favorable structure supports extending the target from 50% to ${targetCapturePct}%.`],
    });
  }

  return verticalDecision({
    state: "HEALTHY",
    action: "HOLD",
    shouldExit: false,
    exitReason: null,
    targetCapturePct,
    targetDebit,
    targetR: null,
    thesisScore,
    favorableScore,
    threatScore,
    invalidationScore,
    currentPnlDollars,
    adaptiveMae,
    adaptiveMfe,
    profitGivebackPct,
    auction,
    reasons: reasons.length ? reasons : ["No adaptive exit or threat condition is active."],
  });
}

function evaluateIronFly(args: {
  trade: ZeroDteShadowTrade;
  read: ZeroDteExecutionRead;
  spot: number;
  debit: number | null;
  currentPnlDollars: number | null;
  adaptiveMae: number;
  adaptiveMfe: number;
  profitGivebackPct: number | null;
  auction: AdaptiveAuctionContext | null;
}): AdaptiveManagementDecision {
  const {
    trade,
    read,
    spot,
    debit,
    currentPnlDollars,
    adaptiveMae,
    adaptiveMfe,
    profitGivebackPct,
    auction,
  } = args;
  const center = ironFlyCenter(trade);
  const wingWidth = trade.widthPoints ?? ironFlyWingWidth(trade);
  const riskPoints =
    wingWidth === null ? null : Math.max(0.01, wingWidth - trade.entrySellableCredit);
  const mapDistance = center === null ? Math.abs(read.mapCenter - trade.entryMapCenter) : Math.abs(read.mapCenter - center);
  const spotDistance = center === null ? null : Math.abs(spot - center);
  const pocDistance = center === null || auction?.projectedPocSpx == null
    ? null
    : Math.abs(auction.projectedPocSpx - center);
  const pocMigration = auction?.pocMigration5mSpx ?? null;
  const pocMovingAway =
    center !== null && auction?.projectedPocSpx != null && pocMigration !== null
      ? auction.projectedPocSpx > center
        ? pocMigration > 0.5
        : auction.projectedPocSpx < center
          ? pocMigration < -0.5
          : false
      : false;
  const spotSide = center === null ? 0 : Math.sign(spot - center);
  const releaseAway = Boolean(
    spotSide > 0 && (auction?.state === "RELEASE_UP" || auction?.state === "REVERSAL_UP") ||
      spotSide < 0 && (auction?.state === "RELEASE_DOWN" || auction?.state === "REVERSAL_DOWN"),
  );
  const efficiency = auction?.efficiencyPct ?? 0;
  const flowConfidence = auction?.flowConfidencePct ?? 0;
  const worstShortMultiple = trade.currentShortLegMultiple;
  const severeShort = worstShortMultiple !== null && worstShortMultiple >= 3;
  const nearMaxLoss = Boolean(
    wingWidth !== null && debit !== null && debit >= wingWidth * 0.985,
  );

  let thesisScore = 55;
  if (mapDistance <= 5) thesisScore += 22;
  else if (mapDistance <= 10) thesisScore += 12;
  else if (mapDistance >= 15) thesisScore -= 28;
  if (pocDistance !== null) {
    if (pocDistance <= 3) thesisScore += 20;
    else if (pocDistance <= 7) thesisScore += 12;
    else if (pocDistance >= 12) thesisScore -= 22;
  }
  if (efficiency > 0 && efficiency <= 35) thesisScore += 10;
  if (pocMovingAway) thesisScore -= 14;
  if (releaseAway && efficiency >= 50) thesisScore -= 20;
  if (spotDistance !== null && wingWidth !== null) {
    if (spotDistance <= wingWidth * 0.2) thesisScore += 8;
    else if (spotDistance >= wingWidth * 0.5) thesisScore -= 18;
  }
  thesisScore = clamp(thesisScore, 0, 100);

  let favorableScore = 0;
  if (pocDistance !== null && pocDistance <= 3) favorableScore += 30;
  else if (pocDistance !== null && pocDistance <= 7) favorableScore += 18;
  if (mapDistance <= 5) favorableScore += 25;
  else if (mapDistance <= 10) favorableScore += 14;
  if (efficiency > 0 && efficiency <= 35) favorableScore += 18;
  if (!pocMovingAway && pocMigration !== null && Math.abs(pocMigration) <= 0.5) favorableScore += 12;
  if (auction?.state === "BUILDING" || auction?.state === "DORMANT") favorableScore += 5;
  favorableScore = clamp(favorableScore, 0, 100);

  let threatScore = 0;
  if (mapDistance >= 15) threatScore += 28;
  else if (mapDistance >= 10) threatScore += 14;
  if (pocDistance !== null && pocDistance >= 12) threatScore += 24;
  if (pocMovingAway) threatScore += 16;
  if (releaseAway && efficiency >= 50) threatScore += 25;
  if (spotDistance !== null && wingWidth !== null && spotDistance >= wingWidth * 0.5) threatScore += 20;
  if (severeShort) threatScore += 22;
  if (nearMaxLoss) threatScore += 25;
  threatScore = clamp(threatScore, 0, 100);

  const structuralFailures = [mapDistance >= 15, pocDistance !== null && pocDistance >= 12, pocMovingAway].filter(Boolean).length;
  const directionalFailure = releaseAway && efficiency >= 55 && flowConfidence >= 45;
  const displacementFailure = Boolean(spotDistance !== null && wingWidth !== null && spotDistance >= wingWidth * 0.5);
  let invalidationScore = clamp(
    structuralFailures * 22 +
      (directionalFailure ? 28 : 0) +
      (displacementFailure ? 18 : 0) +
      (severeShort ? 14 : 0) +
      (nearMaxLoss ? 18 : 0),
    0,
    100,
  );
  const invalidated = Boolean(
    invalidationScore >= 78 &&
      structuralFailures >= 2 &&
      (directionalFailure || displacementFailure || nearMaxLoss),
  );

  let targetR = 1;
  if (thesisScore >= 86 && favorableScore >= 65) targetR = 2;
  else if (thesisScore >= 72 && favorableScore >= 45) targetR = 1.5;
  if (threatScore >= 50) targetR = Math.min(targetR, 1);
  const targetDebit =
    riskPoints === null
      ? Math.max(0, trade.entrySellableCredit * 0.5)
      : Math.max(0, trade.entrySellableCredit - riskPoints * targetR);
  const targetCapturePct =
    targetDebit === null || trade.entrySellableCredit <= 0
      ? null
      : clamp(((trade.entrySellableCredit - targetDebit) / trade.entrySellableCredit) * 100, 0, 100);

  const profitProtection = Boolean(
    currentPnlDollars !== null &&
      currentPnlDollars >= 50 &&
      adaptiveMfe >= 100 &&
      (profitGivebackPct ?? 0) >= 35 &&
      thesisScore < 65,
  );
  const recoveredFromPain = Boolean(
    currentPnlDollars !== null &&
      currentPnlDollars < 0 &&
      adaptiveMae >= 100 &&
      Math.abs(currentPnlDollars) <= adaptiveMae * 0.7 &&
      thesisScore >= 60 &&
      !invalidated,
  );

  const reasons: string[] = [];
  if (center !== null) reasons.push(`IF center ${center.toFixed(0)}; controlling-map distance ${mapDistance.toFixed(1)} points.`);
  if (pocDistance !== null && auction?.projectedPocSpx !== null) {
    reasons.push(`Observed ES value projects to SPX ${auction?.projectedPocSpx?.toFixed(1)}, ${pocDistance.toFixed(1)} points from center.`);
  }
  if (releaseAway) reasons.push(`Live ES ${auction?.state} is releasing away from the IF center.`);
  if (severeShort) reasons.push(`Worst IF short is ${worstShortMultiple?.toFixed(2)}× entry premium; this is a severe threat, not an automatic IF exit by itself.`);

  if (nearMaxLoss && invalidated) {
    return decision({
      state: "INVALIDATED",
      action: "EXIT",
      shouldExit: true,
      exitReason: "ADAPTIVE_IF_NEAR_MAX_LOSS",
      targetCapturePct,
      targetDebit,
      targetR,
      thesisScore,
      favorableScore,
      threatScore,
      invalidationScore,
      currentPnlDollars,
      adaptiveMae,
      adaptiveMfe,
      profitGivebackPct,
      auction,
      reasons: [...reasons, "Package is near wing value and the center thesis is independently invalidated."],
    });
  }

  if (invalidated) {
    return decision({
      state: "INVALIDATED",
      action: "EXIT",
      shouldExit: true,
      exitReason: "ADAPTIVE_INVALIDATION",
      targetCapturePct,
      targetDebit,
      targetR,
      thesisScore,
      favorableScore,
      threatScore,
      invalidationScore,
      currentPnlDollars,
      adaptiveMae,
      adaptiveMfe,
      profitGivebackPct,
      auction,
      reasons: [...reasons, "IF center, value migration, and directional release have aligned against the original center thesis."],
    });
  }

  if (debit !== null && debit <= targetDebit) {
    return decision({
      state: "HARVEST",
      action: "EXIT",
      shouldExit: true,
      exitReason: "ADAPTIVE_TARGET",
      targetCapturePct,
      targetDebit,
      targetR,
      thesisScore,
      favorableScore,
      threatScore,
      invalidationScore,
      currentPnlDollars,
      adaptiveMae,
      adaptiveMfe,
      profitGivebackPct,
      auction,
      reasons: [...reasons, `${targetR.toFixed(1)}R IF harvest target has been reached.`],
    });
  }

  if (profitProtection) {
    return decision({
      state: "HARVEST",
      action: "EXIT",
      shouldExit: true,
      exitReason: "ADAPTIVE_PROFIT_PROTECTION",
      targetCapturePct,
      targetDebit,
      targetR,
      thesisScore,
      favorableScore,
      threatScore,
      invalidationScore,
      currentPnlDollars,
      adaptiveMae,
      adaptiveMfe,
      profitGivebackPct,
      auction,
      reasons: [...reasons, `IF has surrendered ${Math.round(profitGivebackPct ?? 0)}% of peak profit while center conviction has weakened.`],
    });
  }

  if (recoveredFromPain) {
    return decision({
      state: "RECOVERY",
      action: "HOLD",
      shouldExit: false,
      exitReason: null,
      targetCapturePct,
      targetDebit,
      targetR,
      thesisScore,
      favorableScore,
      threatScore,
      invalidationScore,
      currentPnlDollars,
      adaptiveMae,
      adaptiveMfe,
      profitGivebackPct,
      auction,
      reasons: [...reasons, `IF has recovered materially from a $${adaptiveMae.toFixed(0)} MAE while center conviction remains ${Math.round(thesisScore)}.`],
    });
  }

  if (threatScore >= 45) {
    return decision({
      state: "THREATENED",
      action: "WATCH",
      shouldExit: false,
      exitReason: null,
      targetCapturePct,
      targetDebit,
      targetR,
      thesisScore,
      favorableScore,
      threatScore,
      invalidationScore,
      currentPnlDollars,
      adaptiveMae,
      adaptiveMfe,
      profitGivebackPct,
      auction,
      reasons: [...reasons, "IF is under pressure, but the center thesis has not met the multi-factor invalidation rule."],
    });
  }

  if (targetR > 1) {
    return decision({
      state: "HEALTHY",
      action: "HOLD_FOR_DEEPER_HARVEST",
      shouldExit: false,
      exitReason: null,
      targetCapturePct,
      targetDebit,
      targetR,
      thesisScore,
      favorableScore,
      threatScore,
      invalidationScore,
      currentPnlDollars,
      adaptiveMae,
      adaptiveMfe,
      profitGivebackPct,
      auction,
      reasons: [...reasons, `Center conviction supports a ${targetR.toFixed(1)}R target instead of a fixed 50% credit target.`],
    });
  }

  return decision({
    state: "HEALTHY",
    action: "HOLD",
    shouldExit: false,
    exitReason: null,
    targetCapturePct,
    targetDebit,
    targetR,
    thesisScore,
    favorableScore,
    threatScore,
    invalidationScore,
    currentPnlDollars,
    adaptiveMae,
    adaptiveMfe,
    profitGivebackPct,
    auction,
    reasons: reasons.length ? reasons : ["IF center thesis remains intact."],
  });
}


function markAdaptiveVerticalStructure(
  trade: ZeroDteShadowTrade,
  rows: ZeroDteChainRow[],
) {
  const activeLegs = trade.adaptiveActiveLegs?.length
    ? trade.adaptiveActiveLegs
    : trade.legs;
  const netCashPoints =
    trade.adaptiveNetCashPoints ?? trade.entrySellableCredit;
  const snapshots = buildShadowLegSnapshots(rows, activeLegs, trade.strategy);
  let closeValuePoints = 0;
  let complete = activeLegs.length > 0;
  for (const snapshot of snapshots) {
    if (snapshot.action === "buy") {
      if (snapshot.bid === null) complete = false;
      else closeValuePoints += snapshot.bid;
    } else {
      if (snapshot.ask === null) complete = false;
      else closeValuePoints -= snapshot.ask;
    }
  }
  const markedPnlDollars = complete
    ? (netCashPoints + closeValuePoints) * 100
    : null;
  const short = activeLegs.find((leg) => leg.action === "sell") ?? null;
  const shortSnapshot = short
    ? snapshots.find(
        (leg) =>
          leg.action === "sell" &&
          leg.optionType === short.optionType &&
          Math.abs(leg.strike - short.strike) < 0.01,
      ) ?? null
    : null;
  const shortEntryPrice = short
    ? adaptiveShortEntryPrice(trade, short)
    : null;
  const shortMultiple =
    shortSnapshot?.ask != null && shortEntryPrice != null && shortEntryPrice > 0
      ? shortSnapshot.ask / shortEntryPrice
      : null;
  return {
    activeLegs,
    netCashPoints,
    snapshots,
    currentGreeks: aggregateGreeks(snapshots),
    closeValuePoints: complete ? closeValuePoints : null,
    markedPnlDollars,
    shortMultiple,
  };
}

function adaptiveShortEntryPrice(
  trade: ZeroDteShadowTrade,
  short: ExecutionLeg,
) {
  const repair = [...(trade.adaptiveStructureHistory ?? [])]
    .reverse()
    .find(
      (item) =>
        item.action === "REINSTATE_SHORT" &&
        item.strike !== null &&
        Math.abs(item.strike - short.strike) < 0.01 &&
        item.price !== null &&
        item.price > 0,
    );
  if (repair?.price) return repair.price;
  return (
    trade.entryShortLegs.find(
      (item) =>
        item.optionType === short.optionType &&
        Math.abs(item.strike - short.strike) < 0.01,
    )?.sellPrice ?? null
  );
}

function evaluateVerticalStructureTransition(args: {
  trade: ZeroDteShadowTrade;
  read: ZeroDteExecutionRead;
  spot: number;
  rows: ZeroDteChainRow[];
  minSellableCredit: number;
  structureMark: ReturnType<typeof markAdaptiveVerticalStructure> | null;
  auction: AdaptiveAuctionContext | null;
  shortBreached: boolean;
  threeXShort: boolean;
  adverseRelease: boolean;
  efficiency: number;
  confidence: number;
  pocBeyondShort: boolean;
  pocMigratingAdverse: boolean;
  adverseMapShift: boolean;
}): AdaptiveManagementDecision | null {
  const {
    trade,
    read,
    spot,
    rows,
    minSellableCredit,
    structureMark,
    auction,
  } = args;
  if (!structureMark || trade.strategy === "iron-fly") return null;

  const structureState: AdaptiveStructureState =
    trade.adaptiveStructureState ?? "CREDIT_SPREAD";
  const isPut = trade.strategy === "put-credit-spread";
  const activeLong = structureMark.activeLegs.find((leg) => leg.action === "buy") ?? null;
  const activeShort = structureMark.activeLegs.find((leg) => leg.action === "sell") ?? null;
  const currentPnl = structureMark.markedPnlDollars;
  const currentAdverse = currentPnl === null ? 0 : Math.max(0, -currentPnl);
  const currentFavorable = currentPnl === null ? 0 : Math.max(0, currentPnl);
  const adaptiveMae = Math.max(trade.adaptiveMaxAdverseExcursionDollars ?? 0, currentAdverse);
  const adaptiveMfe = Math.max(trade.adaptiveMaxFavorableExcursionDollars ?? 0, currentFavorable);
  const profitGivebackPct =
    currentPnl !== null && currentPnl >= 0 && adaptiveMfe > 0
      ? clamp(((adaptiveMfe - currentPnl) / adaptiveMfe) * 100, 0, 100)
      : null;

  if (structureState === "LONG_RUNNER") {
    if (!activeLong) return null;
    const longSnapshot = structureMark.snapshots.find(
      (item) =>
        item.action === "buy" &&
        item.optionType === activeLong.optionType &&
        Math.abs(item.strike - activeLong.strike) < 0.01,
    );
    if (!longSnapshot || longSnapshot.bid === null) {
      return decision({
        state: "THREATENED",
        action: "WATCH",
        shouldExit: false,
        exitReason: null,
        targetCapturePct: null,
        targetDebit: null,
        targetR: null,
        thesisScore: 50,
        favorableScore: 0,
        threatScore: 45,
        invalidationScore: 20,
        currentPnlDollars: currentPnl,
        adaptiveMae,
        adaptiveMfe,
        profitGivebackPct,
        auction,
        structureState,
        markedPnlDollars: currentPnl,
        currentGreeks: structureMark.currentGreeks,
        reasons: ["Released-short runner is active, but the long-leg executable bid is unavailable."],
      });
    }

    // Rare but clean branch: if the long has repaired the entire episode, close it.
    if (currentPnl !== null && currentPnl >= 0) {
      const nextNetCash = structureMark.netCashPoints + longSnapshot.bid;
      return decision({
        state: "HARVEST",
        action: "CLOSE_RUNNER",
        shouldExit: true,
        exitReason: "ADAPTIVE_RUNNER_RECOVERED",
        targetCapturePct: null,
        targetDebit: null,
        targetR: null,
        thesisScore: 100,
        favorableScore: 80,
        threatScore: 0,
        invalidationScore: 0,
        currentPnlDollars: currentPnl,
        adaptiveMae,
        adaptiveMfe,
        profitGivebackPct,
        auction,
        structureState,
        markedPnlDollars: currentPnl,
        currentGreeks: structureMark.currentGreeks,
        structureTransition: {
          type: "CLOSE_RUNNER",
          strike: activeLong.strike,
          executionPrice: longSnapshot.bid,
          nextStructureState: "CLOSED",
          nextActiveLegs: [],
          nextNetCashPoints: nextNetCash,
          detail: `Long ${activeLong.strike.toFixed(0)} recovered the short-release deficit; close the runner at its executable bid.`,
        },
        reasons: ["The released long has recovered the episode-level short buyback damage; the rare full-repair condition is satisfied."],
      });
    }

    const entryLongSnapshot = (trade.entryLegSnapshots ?? []).find(
      (item) =>
        item.action === "buy" &&
        item.optionType === activeLong.optionType &&
        Math.abs(item.strike - activeLong.strike) < 0.01,
    ) ?? null;
    const longDeltaAbs = Math.abs(longSnapshot.delta ?? 0);
    const entryLongDeltaAbs = entryLongSnapshot?.delta == null
      ? null
      : Math.max(0.03, Math.abs(entryLongSnapshot.delta));
    const longDeltaExpansion = entryLongDeltaAbs === null
      ? null
      : longDeltaAbs / entryLongDeltaAbs;
    const longGammaAbs = Math.abs(longSnapshot.gamma ?? 0);
    const greekContinuationSupport = Boolean(
      entryLongDeltaAbs !== null &&
      longDeltaAbs >= 0.3 &&
      (longDeltaExpansion ?? 0) >= 1.35 &&
      longGammaAbs > 0,
    );

    const directionContinuation = isPut
      ? auction?.state === "RELEASE_DOWN" || auction?.state === "REVERSAL_DOWN"
      : auction?.state === "RELEASE_UP" || auction?.state === "REVERSAL_UP";
    const directionExhaustion = isPut
      ? auction?.state === "ABSORBING_LOW" ||
        auction?.state === "EXHAUSTING_DOWN" ||
        auction?.state === "REVERSAL_UP"
      : auction?.state === "ABSORBING_HIGH" ||
        auction?.state === "EXHAUSTING_UP" ||
        auction?.state === "REVERSAL_DOWN";
    const projectedTerminal = isPut
      ? read.leastResistancePath?.terminalTrough ?? null
      : read.leastResistancePath?.terminalCrest ?? null;
    const projectedRoom = projectedTerminal === null
      ? null
      : isPut
        ? spot - projectedTerminal
        : projectedTerminal - spot;
    const pocMigration = auction?.pocMigration5mSpx ?? 0;
    const pocContinuing = isPut ? pocMigration < -0.5 : pocMigration > 0.5;
    const continuationStrong = Boolean(
      directionContinuation &&
      (auction?.efficiencyPct ?? 0) >= 45 &&
      (auction?.flowConfidencePct ?? 0) >= 35 &&
      (pocContinuing || (projectedRoom ?? 0) > 7 || greekContinuationSupport),
    );
    const priceExhaustion = Boolean(
      read.priceRejectionReady && read.priceRejectionScore >= 55,
    );
    const exhaustion = Boolean(
      directionExhaustion ||
      priceExhaustion ||
      ((projectedRoom ?? 999) <= 7 && (auction?.efficiencyPct ?? 0) < 45),
    );

    if (exhaustion && !continuationStrong) {
      const releasedShort =
        trade.adaptiveReleasedShortStrike ?? firstShortStrike(trade);
      const repair = findInteriorRepairShort({
        rows,
        strategy: trade.strategy,
        longStrike: activeLong.strike,
        releasedShortStrike: releasedShort,
        minSellableCredit,
      });
      if (repair) {
        const repairLeg: ExecutionLeg = {
          optionType: activeLong.optionType,
          action: "sell",
          strike: repair.strike,
        };
        const nextNetCash = structureMark.netCashPoints + repair.bid;
        return decision({
          state: "RECOVERY",
          action: "REINSTATE_SHORT",
          shouldExit: false,
          exitReason: null,
          targetCapturePct: null,
          targetDebit: null,
          targetR: null,
          thesisScore: 65,
          favorableScore: 45,
          threatScore: 25,
          invalidationScore: 15,
          currentPnlDollars: currentPnl,
          adaptiveMae,
          adaptiveMfe,
          profitGivebackPct,
          auction,
          structureState,
          markedPnlDollars: currentPnl,
          currentGreeks: structureMark.currentGreeks,
          structureTransition: {
            type: "REINSTATE_SHORT",
            strike: repair.strike,
            executionPrice: repair.bid,
            nextStructureState: "REPAIRED_SPREAD",
            nextActiveLegs: [repairLeg, activeLong],
            nextNetCashPoints: nextNetCash,
            detail: `Continuation exhausted; sell ${repair.strike.toFixed(0)} inside the existing ${activeLong.strike.toFixed(0)} long for ${repair.bid.toFixed(2)} credit.`,
          },
          reasons: [
            `The runner has not fully recovered (${currentPnl === null ? "P/L unavailable" : `$${currentPnl.toFixed(0)}`}), but continuation is exhausting.`,
            `Re-short ${repair.strike.toFixed(0)} inside the fixed ${activeLong.strike.toFixed(0)} long to narrow margin and bring in richer repair credit.`,
          ],
        });
      }

      // No interior strike exists (common after a 5-wide repair). Exit the long
      // rather than allow an exhausted runner to decay with no repair geometry.
      const nextNetCash = structureMark.netCashPoints + longSnapshot.bid;
      return decision({
        state: "HARVEST",
        action: "CLOSE_RUNNER",
        shouldExit: true,
        exitReason: "ADAPTIVE_RUNNER_EXHAUSTED",
        targetCapturePct: null,
        targetDebit: null,
        targetR: null,
        thesisScore: 25,
        favorableScore: 10,
        threatScore: 55,
        invalidationScore: 45,
        currentPnlDollars: currentPnl,
        adaptiveMae,
        adaptiveMfe,
        profitGivebackPct,
        auction,
        structureState,
        markedPnlDollars: currentPnl,
        currentGreeks: structureMark.currentGreeks,
        structureTransition: {
          type: "CLOSE_RUNNER",
          strike: activeLong.strike,
          executionPrice: longSnapshot.bid,
          nextStructureState: "CLOSED",
          nextActiveLegs: [],
          nextNetCashPoints: nextNetCash,
          detail: "Runner continuation exhausted and there is no valid interior re-short strike; harvest the remaining long value.",
        },
        reasons: ["Continuation has exhausted and the original long contains no remaining interior repair strike."],
      });
    }

    return decision({
      state: continuationStrong ? "FAVORABLE_RELEASE" : "RECOVERY",
      action: continuationStrong ? "HOLD_FOR_DEEPER_HARVEST" : "HOLD",
      shouldExit: false,
      exitReason: null,
      targetCapturePct: null,
      targetDebit: null,
      targetR: null,
      thesisScore: continuationStrong ? 78 : 60,
      favorableScore: continuationStrong ? 75 : 42,
      threatScore: continuationStrong ? 18 : 32,
      invalidationScore: 10,
      currentPnlDollars: currentPnl,
      adaptiveMae,
      adaptiveMfe,
      profitGivebackPct,
      auction,
      structureState,
      markedPnlDollars: currentPnl,
      currentGreeks: structureMark.currentGreeks,
      reasons: [
        continuationStrong
          ? `Short has been released; map/ES continuation still supports running the ${activeLong.strike.toFixed(0)} long.`
          : `Short has been released; keep the ${activeLong.strike.toFixed(0)} long as a temporary repair runner while waiting for either recovery or a valid re-short exhaustion.`,
        projectedRoom === null
          ? "Map terminal projection is unavailable."
          : `Map terminal projection leaves about ${Math.max(0, projectedRoom).toFixed(1)} points of directional room.`,
        `Runner Greeks: |delta| ${longDeltaAbs.toFixed(2)}, delta expansion ${longDeltaExpansion === null ? "n/a" : `${longDeltaExpansion.toFixed(2)}×`} versus entry, |gamma| ${longGammaAbs.toFixed(4)}${greekContinuationSupport ? " — convexity supports continuation." : "."}`,
      ],
    });
  }

  if (!activeShort || !activeLong) return null;
  const shortSnapshot = structureMark.snapshots.find(
    (item) =>
      item.action === "sell" &&
      item.optionType === activeShort.optionType &&
      Math.abs(item.strike - activeShort.strike) < 0.01,
  );
  if (!shortSnapshot || shortSnapshot.ask === null) return null;
  const longSnapshot = structureMark.snapshots.find(
    (item) =>
      item.action === "buy" &&
      item.optionType === activeLong.optionType &&
      Math.abs(item.strike - activeLong.strike) < 0.01,
  ) ?? null;
  const entryShortSnapshot = (trade.entryLegSnapshots ?? []).find(
    (item) =>
      item.action === "sell" &&
      item.optionType === activeShort.optionType &&
      Math.abs(item.strike - activeShort.strike) < 0.01,
  ) ?? null;
  const entryLongSnapshot = (trade.entryLegSnapshots ?? []).find(
    (item) =>
      item.action === "buy" &&
      item.optionType === activeLong.optionType &&
      Math.abs(item.strike - activeLong.strike) < 0.01,
  ) ?? null;
  const shortDeltaAbs = Math.abs(shortSnapshot.delta ?? 0);
  const entryShortDeltaAbs = entryShortSnapshot?.delta == null
    ? null
    : Math.max(0.05, Math.abs(entryShortSnapshot.delta));
  const shortDeltaExpansion = entryShortDeltaAbs === null
    ? null
    : shortDeltaAbs / entryShortDeltaAbs;
  const longDeltaAbs = Math.abs(longSnapshot?.delta ?? 0);
  const entryLongDeltaAbs = entryLongSnapshot?.delta == null
    ? null
    : Math.max(0.03, Math.abs(entryLongSnapshot.delta));
  const longDeltaExpansion = entryLongDeltaAbs === null
    ? null
    : longDeltaAbs / entryLongDeltaAbs;
  const shortGammaAbs = Math.abs(shortSnapshot.gamma ?? 0);
  const longGammaAbs = Math.abs(longSnapshot?.gamma ?? 0);
  // Do not manufacture a Greek continuation vote when the actual position has
  // no stored entry-Greek baseline. Shadow trades usually have it; actual
  // broker positions currently do not. Missing evidence stays missing.
  const greekShortThreat = Boolean(
    entryShortDeltaAbs !== null &&
    shortDeltaAbs >= 0.45 &&
    (shortDeltaExpansion ?? 0) >= 1.5 &&
    (shortGammaAbs > 0 || (longDeltaExpansion ?? 0) >= 1.3),
  );
  const longConvexityAvailable = Boolean(
    longSnapshot?.bid != null &&
    longDeltaAbs >= 0.2 &&
    (longGammaAbs > 0 ||
      (entryLongDeltaAbs !== null && (longDeltaExpansion ?? 0) >= 1.25)),
  );

  const pathThroughLong = isPut
    ? (read.leastResistancePath?.terminalTrough ?? Infinity) <= activeLong.strike
    : (read.leastResistancePath?.terminalCrest ?? -Infinity) >= activeLong.strike;
  const continuationEvidenceCount = [
    args.adverseRelease && args.efficiency >= 40 && args.confidence >= 30,
    args.pocBeyondShort,
    args.pocMigratingAdverse,
    pathThroughLong,
    args.adverseMapShift,
    greekShortThreat,
  ].filter(Boolean).length;
  // Preserve the agreed short-release rule: the deterministic trigger is 3×
  // the short-leg sale premium. A breached short can also release when two
  // independent continuation factors confirm that price is not merely probing
  // the strike. The actual-position ledger fix below makes this logic run on
  // real Portfolio Dock positions; do not move the 3× threshold silently.
  const releaseConfirmed = Boolean(
    args.threeXShort ||
      (args.shortBreached && continuationEvidenceCount >= 2),
  );

  if (!releaseConfirmed) return null;

  const nextNetCash = structureMark.netCashPoints - shortSnapshot.ask;
  return decision({
    state: "THREATENED",
    action: "RELEASE_SHORT",
    shouldExit: false,
    exitReason: null,
    targetCapturePct: null,
    targetDebit: null,
    targetR: null,
    thesisScore: 35,
    favorableScore: 15,
    threatScore: 88,
    invalidationScore: 82,
    currentPnlDollars: currentPnl,
    adaptiveMae,
    adaptiveMfe,
    profitGivebackPct,
    auction,
    structureState,
    markedPnlDollars: currentPnl,
    currentGreeks: structureMark.currentGreeks,
    structureTransition: {
      type: "RELEASE_SHORT",
      strike: activeShort.strike,
      executionPrice: shortSnapshot.ask,
      nextStructureState: "LONG_RUNNER",
      nextActiveLegs: [activeLong],
      nextNetCashPoints: nextNetCash,
      detail: `Confirmed continuation through ${activeShort.strike.toFixed(0)}: buy back the short at ${shortSnapshot.ask.toFixed(2)} and retain the ${activeLong.strike.toFixed(0)} long.`,
    },
    reasons: [
      args.threeXShort
        ? `The ${activeShort.strike.toFixed(0)} short reached the 3× release threshold; the trigger applies to the short leg, not the entire vertical.`
        : `The ${activeShort.strike.toFixed(0)} short is breached and ${continuationEvidenceCount} continuation factors are aligned; do not liquidate the long automatically.`,
      `Release the short liability and let the ${activeLong.strike.toFixed(0)} long participate while map projection / ES continuation is reassessed.`,
      `Greek support: short |delta| ${shortDeltaAbs.toFixed(2)} (${shortDeltaExpansion === null ? "baseline n/a" : `${shortDeltaExpansion.toFixed(2)}× entry`}), long |delta| ${longDeltaAbs.toFixed(2)} (${longDeltaExpansion === null ? "baseline n/a" : `${longDeltaExpansion.toFixed(2)}× entry`})${greekShortThreat ? "; short gamma/delta behavior supports release" : ""}${longConvexityAvailable ? "; long convexity is available" : ""}.`,
    ],
  });
}

function findInteriorRepairShort(args: {
  rows: ZeroDteChainRow[];
  strategy: ZeroDteShadowTrade["strategy"];
  longStrike: number;
  releasedShortStrike: number | null;
  minSellableCredit: number;
}) {
  const releasedShortStrike = args.releasedShortStrike;
  if (releasedShortStrike === null) return null;
  const isCall = args.strategy === "call-credit-spread";
  const optionType = isCall ? "call" : "put";
  const candidates = args.rows
    .filter(
      (row) =>
        row.optionType === optionType &&
        Number.isFinite(row.bid) &&
        Number(row.bid) >= args.minSellableCredit &&
        (isCall
          ? row.strike > releasedShortStrike && row.strike < args.longStrike
          : row.strike < releasedShortStrike && row.strike > args.longStrike),
    )
    .map((row) => ({ strike: row.strike, bid: Number(row.bid) }));
  if (!candidates.length) return null;
  // Narrow the repair toward the existing long. For 7735/7745 this selects
  // 7740; for 7700/7690 puts it selects 7695.
  candidates.sort((left, right) =>
    Math.abs(left.strike - args.longStrike) - Math.abs(right.strike - args.longStrike),
  );
  return candidates[0];
}

function decision(args: {
  state: AdaptiveManagementState;
  action: AdaptiveManagementAction;
  shouldExit: boolean;
  exitReason: AdaptiveExitReason | null;
  targetCapturePct: number | null;
  targetDebit: number | null;
  targetR: number | null;
  thesisScore: number;
  favorableScore: number;
  threatScore: number;
  invalidationScore: number;
  currentPnlDollars: number | null;
  adaptiveMae: number;
  adaptiveMfe: number;
  profitGivebackPct: number | null;
  auction: AdaptiveAuctionContext | null;
  structureState?: AdaptiveStructureState | null;
  structureTransition?: AdaptiveStructureTransition | null;
  markedPnlDollars?: number | null;
  currentGreeks?: ShadowGreekSnapshot | null;
  reasons: string[];
}): AdaptiveManagementDecision {
  return {
    state: args.state,
    action: args.action,
    shouldExit: args.shouldExit,
    exitReason: args.exitReason,
    targetCapturePct: args.targetCapturePct,
    targetDebit: args.targetDebit,
    targetR: args.targetR,
    thesisScore: Math.round(clamp(args.thesisScore, 0, 100)),
    favorableScore: Math.round(clamp(args.favorableScore, 0, 100)),
    threatScore: Math.round(clamp(args.threatScore, 0, 100)),
    invalidationScore: Math.round(clamp(args.invalidationScore, 0, 100)),
    currentPnlDollars: args.currentPnlDollars,
    maxAdverseExcursionDollars: args.adaptiveMae,
    maxFavorableExcursionDollars: args.adaptiveMfe,
    profitGivebackPct: args.profitGivebackPct,
    auctionState: args.auction?.state ?? null,
    auctionPressurePct: args.auction?.directionalPressurePct ?? null,
    auctionEfficiencyPct: args.auction?.efficiencyPct ?? null,
    projectedPocSpx: args.auction?.projectedPocSpx ?? null,
    structureState: args.structureState ?? null,
    structureTransition: args.structureTransition ?? null,
    markedPnlDollars: args.markedPnlDollars ?? args.currentPnlDollars,
    currentGreeks: args.currentGreeks ?? null,
    reasons: unique(args.reasons),
  };
}

function firstShortStrike(trade: ZeroDteShadowTrade) {
  return trade.legs.find((leg) => leg.action === "sell")?.strike ?? null;
}

function ironFlyCenter(trade: ZeroDteShadowTrade) {
  const shorts = trade.legs.filter((leg) => leg.action === "sell").map((leg) => leg.strike);
  if (!shorts.length) return null;
  return shorts.reduce((sum, value) => sum + value, 0) / shorts.length;
}

function ironFlyWingWidth(trade: ZeroDteShadowTrade) {
  const center = ironFlyCenter(trade);
  if (center === null) return null;
  const wings = trade.legs.filter((leg) => leg.action === "buy").map((leg) => Math.abs(leg.strike - center));
  return wings.length ? Math.max(...wings) : null;
}

function finitePositiveOrZero(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function clamp(value: number, minValue: number, maxValue: number) {
  return Math.max(minValue, Math.min(maxValue, value));
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
