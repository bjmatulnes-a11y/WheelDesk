import type { ZeroDteChainRow, ZeroDteRecommendation } from "./zeroDteOiIntelligence";
import type { ZeroDteStrikeFlowRead } from "./zeroDteStrikeFlow";
import type { ZeroDteLeastResistancePath } from "./zeroDteLeastResistancePath";
import { scoreLeastResistanceSide } from "./zeroDteLeastResistancePath";
import type {
  ZeroDteCreditSpreadSelection,
} from "./zeroDteCreditSpreadSelector";
import type {
  ZeroDteMapContext,
  ZeroDteStrategyRanking,
  ZeroDteTradeSelection,
} from "./zeroDteTradeSelector";
import {
  getControllingMarketMap,
  type MarketMapSnapshot,
  type SessionMapManagerState,
} from "./session/mapEngine";

export type BuildZeroDteStrategyOrchestrationInput = {
  baseSelection: ZeroDteTradeSelection;
  recommendation: ZeroDteRecommendation;
  spxRows: ZeroDteChainRow[];
  mapState: SessionMapManagerState | null | undefined;
  strikeFlow?: ZeroDteStrikeFlowRead | null;
  leastResistancePath?: ZeroDteLeastResistancePath | null;
};

export function orchestrateZeroDteStrategySelection(
  input: BuildZeroDteStrategyOrchestrationInput,
): ZeroDteTradeSelection {
  const { baseSelection, recommendation: rec, spxRows, mapState } = input;
  if (!mapState) return baseSelection;

  const controlling = getControllingMarketMap(mapState);
  const mapContext: ZeroDteMapContext = {
    phase: mapState.phase,
    railBreached: mapState.railBreached,
    confirmationCount: mapState.confirmationCount,
    confirmationRequired: mapState.confirmationRequired,
    controllingSource: controlling.source,
    controllingCenter: controlling.center,
    controllingLowerWing: controlling.lowerWing,
    controllingUpperWing: controlling.upperWing,
    centerShiftFromOpen: controlling.center - mapState.opening.center,
  };

  const put = buildSpreadRanking({
    spread: baseSelection.creditSpreadBook.put,
    side: "put",
    rec,
    mapState,
    controlling,
    strikeFlow: input.strikeFlow ?? null,
    leastResistancePath: input.leastResistancePath ?? null,
  });
  const call = buildSpreadRanking({
    spread: baseSelection.creditSpreadBook.call,
    side: "call",
    rec,
    mapState,
    controlling,
    strikeFlow: input.strikeFlow ?? null,
    leastResistancePath: input.leastResistancePath ?? null,
  });
  const ironFly = buildIronFlyRanking({
    rec,
    spxRows,
    mapState,
    leastResistancePath: input.leastResistancePath ?? null,
  });
  const noTrade = buildNoTradeRanking({
    rec,
    mapState,
    controlling,
    put,
    call,
    ironFly,
  });

  const strategyRankings = [put, call, ironFly, noTrade]
    .sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      return b.score - a.score;
    })
    .map((item, index) => ({ ...item, rank: index + 1 }));

  const winner = strategyRankings.find((item) => item.eligible) ?? noTrade;
  const commonReasons = [
    `Map phase ${mapState.phase}; controlling center ${controlling.center.toFixed(0)} with rails ${controlling.lowerWing.toFixed(0)} / ${controlling.upperWing.toFixed(0)}.`,
    mapState.railBreached === "NONE"
      ? "Price remains inside the controlling rails."
      : `${mapState.railBreached.toLowerCase()} controlling rail is breached.`,
    ...winner.reasons,
  ];

  if (winner.tradeType === "put-credit-spread") {
    return {
      ...baseSelection,
      tradeType: winner.tradeType,
      label: "Map-Aware Put Credit Spread",
      confidence: winner.score,
      creditSpread: baseSelection.creditSpreadBook.put,
      ironFly: null,
      reasons: unique([...commonReasons, ...baseSelection.reasons]),
      warnings: unique([...baseSelection.warnings, ...winner.blockers]),
      orchestrationMode: "map-aware",
      mapContext,
      strategyRankings,
    };
  }

  if (winner.tradeType === "call-credit-spread") {
    return {
      ...baseSelection,
      tradeType: winner.tradeType,
      label: "Map-Aware Call Credit Spread",
      confidence: winner.score,
      creditSpread: baseSelection.creditSpreadBook.call,
      ironFly: null,
      reasons: unique([...commonReasons, ...baseSelection.reasons]),
      warnings: unique([...baseSelection.warnings, ...winner.blockers]),
      orchestrationMode: "map-aware",
      mapContext,
      strategyRankings,
    };
  }

  if (winner.tradeType === "iron-fly") {
    return {
      ...baseSelection,
      tradeType: "iron-fly",
      label: "Map-Aware Iron Fly",
      confidence: winner.score,
      creditSpread: null,
      ironFly: {
        center: mapState.opening.center,
        lowerWing: mapState.opening.lowerWing,
        upperWing: mapState.opening.upperWing,
        wingWidth: Math.abs(
          mapState.opening.upperWing - mapState.opening.center,
        ),
      },
      reasons: unique([...commonReasons, ...baseSelection.reasons]),
      warnings: unique([...baseSelection.warnings, ...winner.blockers]),
      orchestrationMode: "map-aware",
      mapContext,
      strategyRankings,
    };
  }

  return {
    ...baseSelection,
    tradeType: "no-trade",
    label: "No Trade / Wait",
    confidence: winner.score,
    creditSpread: null,
    ironFly: null,
    reasons: unique([...commonReasons, ...baseSelection.reasons]),
    warnings: unique([
      ...baseSelection.warnings,
      "No strategy has enough aligned map, dealer and flow evidence to justify entry.",
    ]),
    orchestrationMode: "map-aware",
    mapContext,
    strategyRankings,
  };
}

function buildSpreadRanking(args: {
  spread: ZeroDteCreditSpreadSelection;
  side: "put" | "call";
  rec: ZeroDteRecommendation;
  mapState: SessionMapManagerState;
  controlling: MarketMapSnapshot;
  strikeFlow: ZeroDteStrikeFlowRead | null;
  leastResistancePath: ZeroDteLeastResistancePath | null;
}): ZeroDteStrategyRanking {
  const { spread, side, rec, mapState, controlling, strikeFlow, leastResistancePath } = args;
  const reasons: string[] = [];
  const blockers: string[] = [];
  const executable =
    spread.shortStrike !== null &&
    spread.longStrike !== null &&
    spread.estimatedCredit !== null;

  if (!executable) blockers.push("No executable live spread candidate is available.");

  const mapAlignment = spreadMapAlignment(side, mapState, controlling);
  const fadeSide =
    (side === "put" && rec.spxPrice < controlling.center) ||
    (side === "call" && rec.spxPrice > controlling.center);
  const dealerAlignment = clamp(
    fadeSide
      ? side === "put"
        ? 50 - rec.dealerPressure * 0.8
        : 50 + rec.dealerPressure * 0.8
      : side === "put"
        ? 50 + rec.dealerPressure * 0.8
        : 50 - rec.dealerPressure * 0.8,
  );
  const flowAlignment = spreadFlowAlignment(side, strikeFlow);
  const desiredPathDirection =
    fadeSide
      ? side === "put"
        ? "UP"
        : "DOWN"
      : null;
  const pathAlignment =
    fadeSide && leastResistancePath
      ? leastResistancePath.direction === "NEUTRAL"
        ? 72
        : leastResistancePath.direction === desiredPathDirection
          ? clamp(58 + leastResistancePath.confidence * 0.42)
          : clamp(58 - leastResistancePath.confidence * 0.52)
      : scoreLeastResistanceSide({
          path: leastResistancePath,
          side,
        });
  const wall = side === "put" ? controlling.putWall : controlling.callWall;

  if (mapState.phase === "TRANSITION") {
    blockers.push(
      "Credit-spread fade is blocked while a replacement structural center is being confirmed.",
    );
  } else if (fadeSide && mapState.railBreached !== "NONE") {
    reasons.push(
      "Controlling-rail breach is treated as extension evidence; completed premium rollover must prove the fade before execution.",
    );
  }

  const flowState =
    side === "put" ? strikeFlow?.putWall.state : strikeFlow?.callWall.state;
  if (side === "put" && flowState === "breaking") {
    blockers.push("Put wall is breaking; do not sell put premium into failed support.");
  }
  if (side === "call" && flowState === "attacked") {
    blockers.push("Call wall is being attacked; do not sell call premium into accepted resistance.");
  }
  if (side === "put" && flowState === "absorbed") {
    reasons.push("Put-wall absorption supports selling put premium.");
  }
  if (side === "call" && flowState === "defended") {
    reasons.push("Call-wall defense supports selling call premium.");
  }

  if (spread.shortStrike !== null && wall !== null) {
    const safelyOutsideWall =
      side === "put" ? spread.shortStrike <= wall : spread.shortStrike >= wall;
    if (safelyOutsideWall) {
      reasons.push("The short strike is placed at or beyond the controlling wall.");
    } else {
      blockers.push("The short strike sits inside the controlling wall.");
    }
  }

  const structuralConfidence = controlling.structure.structuralConfidence;
  const structureBlocked = structuralConfidence < 30;
  if (structureBlocked) {
    blockers.push("Controlling structure confidence is below 30%.");
  }

  const shortInsideWall =
    spread.shortStrike !== null &&
    wall !== null &&
    (side === "put" ? spread.shortStrike > wall : spread.shortStrike < wall);

  let score =
    spread.confidence * 0.42 +
    mapAlignment * 0.23 +
    dealerAlignment * 0.15 +
    flowAlignment * 0.10 +
    pathAlignment * 0.10;

  if (mapState.phase === "TRANSITION") {
    const confirmationRatio =
      mapState.confirmationCount / Math.max(mapState.confirmationRequired, 1);
    score += confirmationRatio * 8;
  }

  score -= blockers.length * 9;
  const hardFlowBlock =
    (side === "put" && flowState === "breaking") ||
    (side === "call" && flowState === "attacked");
  const againstMigration = mapState.phase === "TRANSITION";
  const eligible =
    executable &&
    !hardFlowBlock &&
    !againstMigration &&
    !structureBlocked &&
    !shortInsideWall &&
    score >= 35;

  if (fadeSide) {
    reasons.push(
      `${side === "put" ? "Downside" : "Upside"} displacement puts this spread in EXHAUSTION FADE review; dealer/mood direction is interpreted as premium inflation until the crest engine confirms rollover.`,
    );
  }
  reasons.push(
    `Map ${Math.round(mapAlignment)} · dealer ${Math.round(dealerAlignment)} · flow ${Math.round(flowAlignment)} · path ${Math.round(pathAlignment)}.`,
  );
  if (leastResistancePath) {
    reasons.push(
      `Least resistance is ${leastResistancePath.direction} at ${leastResistancePath.confidence}% confidence with terminal cone ${leastResistancePath.terminalTrough.toFixed(0)}–${leastResistancePath.terminalCrest.toFixed(0)}.`,
    );
  }

  return {
    rank: 0,
    tradeType:
      side === "put" ? "put-credit-spread" : "call-credit-spread",
    label: side === "put" ? "Put Credit Spread" : "Call Credit Spread",
    score: clamp(score),
    eligible,
    mapAlignment: clamp(mapAlignment),
    dealerAlignment: clamp(dealerAlignment),
    flowAlignment: clamp(flowAlignment),
    pathAlignment: clamp(pathAlignment),
    strikes:
      spread.shortStrike !== null && spread.longStrike !== null
        ? `${spread.shortStrike.toFixed(0)} / ${spread.longStrike.toFixed(0)}`
        : "—",
    estimatedCredit: spread.estimatedCredit,
    maxRiskDollars: spread.maxLossDollars,
    creditToRiskPct: spread.creditToRiskPct,
    reasons,
    blockers,
  };
}

function buildIronFlyRanking(args: {
  rec: ZeroDteRecommendation;
  spxRows: ZeroDteChainRow[];
  mapState: SessionMapManagerState;
  leastResistancePath: ZeroDteLeastResistancePath | null;
}): ZeroDteStrategyRanking {
  const { rec, spxRows, mapState, leastResistancePath } = args;

  // The IF thesis is anchored to the true Opening Map.  The opportunity is
  // NOT "spot is near center"; it is "spot is displaced from a still-valid
  // center and the exact-leg premium can later prove exhaustion."
  const controlling = mapState.opening;
  const reasons: string[] = [];
  const blockers: string[] = [];
  const credit = estimateIronFlyCredit(
    spxRows,
    controlling.center,
    controlling.lowerWing,
    controlling.upperWing,
  );

  const centerDistance = Math.abs(rec.spxPrice - controlling.center);
  const halfWidth = Math.max(
    1,
    Math.abs(controlling.upperWing - controlling.center),
  );
  const stretchRatio = centerDistance / halfWidth;
  const creditToWidthPct = credit === null ? null : credit / halfWidth;
  const residualRiskPoints =
    credit === null ? null : Math.max(0, halfWidth - credit);
  const rewardToResidualRisk =
    credit === null || residualRiskPoints === null || residualRiskPoints <= 0
      ? null
      : credit / residualRiskPoints;

  // Candidate ranking is deliberately pre-trigger.  It needs to KEEP the
  // stretched setup alive long enough for the premium crest engine to observe
  // expansion -> rollover.  ROLLOVER_CONFIRMED remains an execution gate.
  const stretchOpportunity = clamp(stretchRatio * 105);
  const premiumLoading =
    creditToWidthPct === null ? 0 : clamp(creditToWidthPct * 115);
  const centerValidity = clamp(
    controlling.structure.structuralConfidence * 0.58 +
      controlling.structure.pinProbability * 0.22 +
      controlling.structure.callWallStrength * 0.10 +
      controlling.structure.putWallStrength * 0.10,
  );

  // A directional LRP is no longer automatically hostile to a fly.
  // If spot is above center, DOWN/NEUTRAL is reversion-friendly.
  // If spot is below center, UP/NEUTRAL is reversion-friendly.
  const desiredPathDirection =
    rec.spxPrice > controlling.center
      ? "DOWN"
      : rec.spxPrice < controlling.center
        ? "UP"
        : "NEUTRAL";
  const pathAlignment =
    !leastResistancePath
      ? 55
      : leastResistancePath.direction === "NEUTRAL"
        ? 72
        : leastResistancePath.direction === desiredPathDirection
          ? clamp(58 + leastResistancePath.confidence * 0.42)
          : clamp(58 - leastResistancePath.confidence * 0.52);

  // Strong directional dealer pressure is the fuel that can inflate premium.
  // Its LEVEL is therefore context, not a hard blocker.  The live execution
  // engine still requires completed premium rollover + price rejection.
  const dealerContext = clamp(
    48 + Math.min(45, Math.abs(rec.dealerPressure)) * 0.75,
  );
  const railContext =
    mapState.railBreached === "NONE"
      ? 62
      : stretchRatio >= 0.55
        ? 78
        : 48;

  if (credit === null) {
    blockers.push("The opening-centered iron fly cannot be priced from the live chain.");
  }
  if (mapState.phase === "TRANSITION") {
    blockers.push(
      "Opening-center fade is blocked while a replacement map is being confirmed.",
    );
  }

  let score =
    centerValidity * 0.20 +
    stretchOpportunity * 0.24 +
    premiumLoading * 0.20 +
    pathAlignment * 0.12 +
    dealerContext * 0.08 +
    railContext * 0.06 +
    rec.confidenceScore * 0.10;
  score -= blockers.length * 12;

  if (stretchRatio >= 0.55) {
    reasons.push(
      `Exhaustion candidate: SPX is ${centerDistance.toFixed(1)} points from the Opening Map center (${Math.round(stretchRatio * 100)}% of half-width).`,
    );
  } else {
    reasons.push(
      `Opening-centered IF is tracking a ${centerDistance.toFixed(1)}-point displacement (${Math.round(stretchRatio * 100)}% of half-width).`,
    );
  }
  if (creditToWidthPct !== null) {
    reasons.push(
      `IF premium is loaded to ${Math.round(creditToWidthPct * 100)}% of wing width; residual defined risk is ${residualRiskPoints!.toFixed(2)} points.`,
    );
  }
  if (rewardToResidualRisk !== null) {
    reasons.push(
      `Credit / residual-risk geometry is ${rewardToResidualRisk.toFixed(2)}× before any reversion assumption.`,
    );
  }
  if (mapState.railBreached !== "NONE") {
    reasons.push(
      `${mapState.railBreached.toLowerCase()} rail breach is treated as displacement evidence, not automatic failure; execution still requires exhaustion confirmation.`,
    );
  }
  if (Math.abs(rec.dealerPressure) > 35) {
    reasons.push(
      `Directional dealer pressure (${rec.dealerPressure.toFixed(0)}) is treated as expansion fuel; the premium crest must prove it has stopped paying higher.`,
    );
  }
  if (leastResistancePath) {
    reasons.push(
      `Least-resistance fade alignment ${Math.round(pathAlignment)}/100; desired path ${desiredPathDirection}, actual ${leastResistancePath.direction} ${leastResistancePath.confidence}%.`,
    );
  }
  reasons.push(
    `Opening center validity scores ${Math.round(centerValidity)}/100 from structural confidence, pin probability, and both walls.`,
  );

  return {
    rank: 0,
    tradeType: "iron-fly",
    label: stretchRatio >= 0.55 ? "Iron Fly · Exhaustion Fade" : "Iron Fly · Opening Center",
    score: clamp(score),
    eligible:
      credit !== null &&
      mapState.phase !== "TRANSITION" &&
      centerValidity >= 30 &&
      score >= 35,
    // Keep the legacy field names for UI compatibility, but point them at the
    // corrected thesis components.
    mapAlignment: stretchOpportunity,
    dealerAlignment: dealerContext,
    flowAlignment: railContext,
    pathAlignment,
    strikes: `${controlling.lowerWing.toFixed(0)} / ${controlling.center.toFixed(0)} / ${controlling.upperWing.toFixed(0)}`,
    estimatedCredit: credit,
    maxRiskDollars:
      residualRiskPoints === null ? null : residualRiskPoints * 100,
    creditToRiskPct:
      rewardToResidualRisk === null ? null : rewardToResidualRisk,
    reasons,
    blockers,
  };
}

function buildNoTradeRanking(args: {
  rec: ZeroDteRecommendation;
  mapState: SessionMapManagerState;
  controlling: MarketMapSnapshot;
  put: ZeroDteStrategyRanking;
  call: ZeroDteStrategyRanking;
  ironFly: ZeroDteStrategyRanking;
}): ZeroDteStrategyRanking {
  const { rec, mapState, controlling, put, call, ironFly } = args;
  const reasons: string[] = [];
  let score = 18;

  if (mapState.phase === "TRANSITION") {
    score += 28;
    reasons.push("A replacement map is still being confirmed.");
  }
  if (controlling.structure.structuralConfidence < 35) {
    score += 18;
    reasons.push("Structural confidence is weak.");
  }
  if (!put.eligible && !call.eligible && !ironFly.eligible) {
    score += 35;
    reasons.push("Every executable strategy is blocked or below threshold.");
  }
  if (Math.abs(put.score - call.score) <= 6 && put.eligible && call.eligible) {
    score += 12;
    reasons.push("Directional spread evidence is nearly tied.");
  }
  if (Math.abs(rec.dealerPressure) > 55 && mapState.railBreached === "NONE") {
    score += 10;
    reasons.push("Dealer pressure is extreme without a confirmed map migration.");
  }
  if (mapState.railBreached !== "NONE" && mapState.phase === "OPENING") {
    score += 12;
    reasons.push("An opening rail is breached but migration has not confirmed.");
  }

  return {
    rank: 0,
    tradeType: "no-trade",
    label: "No Trade / Wait",
    score: clamp(score),
    eligible: true,
    mapAlignment: clamp(score),
    dealerAlignment: clamp(100 - Math.abs(rec.dealerPressure)),
    flowAlignment: 50,
    strikes: "—",
    estimatedCredit: null,
    maxRiskDollars: null,
    creditToRiskPct: null,
    reasons:
      reasons.length > 0
        ? reasons
        : ["At least one strategy has enough alignment to remain actionable."],
    blockers: [],
  };
}

function spreadMapAlignment(
  side: "put" | "call",
  state: SessionMapManagerState,
  controlling: MarketMapSnapshot,
) {
  const centerShift = controlling.center - state.opening.center;

  if (state.phase === "TRANSITION") {
    if (side === "put" && state.railBreached === "UPPER") return 96;
    if (side === "call" && state.railBreached === "LOWER") return 96;
    if (state.railBreached !== "NONE") return 8;
    return 40;
  }

  if (state.phase === "ACTIVE") {
    if (side === "put") return clamp(55 + centerShift * 1.5);
    return clamp(55 - centerShift * 1.5);
  }

  if (state.railBreached === "UPPER") return side === "put" ? 78 : 20;
  if (state.railBreached === "LOWER") return side === "call" ? 78 : 20;
  return 55;
}

function spreadFlowAlignment(
  side: "put" | "call",
  flow: ZeroDteStrikeFlowRead | null,
) {
  if (!flow?.hasPriorSnapshot) return 52;
  const state = side === "put" ? flow.putWall.state : flow.callWall.state;
  if (side === "put") {
    if (state === "absorbed") return 100;
    if (state === "breaking") return 0;
  } else {
    if (state === "defended") return 100;
    if (state === "attacked") return 0;
  }
  if (state === "quiet") return 58;
  if (state === "unclear") return 42;
  return 52;
}

function estimateIronFlyCredit(
  rows: ZeroDteChainRow[],
  center: number,
  lowerWing: number,
  upperWing: number,
) {
  const shortPut = optionMid(rows, center, "put");
  const shortCall = optionMid(rows, center, "call");
  const longPut = optionMid(rows, lowerWing, "put");
  const longCall = optionMid(rows, upperWing, "call");
  if ([shortPut, shortCall, longPut, longCall].some((value) => value === null)) {
    return null;
  }
  return roundMoney(
    Number(shortPut) + Number(shortCall) - Number(longPut) - Number(longCall),
  );
}

function optionMid(
  rows: ZeroDteChainRow[],
  strike: number,
  optionType: "call" | "put",
) {
  const row = rows.find(
    (item) =>
      item.optionType === optionType && Math.abs(item.strike - strike) < 0.01,
  );
  if (!row) return null;
  if (Number.isFinite(row.mid)) return Number(row.mid);
  if (Number.isFinite(row.bid) && Number.isFinite(row.ask)) {
    return (Number(row.bid) + Number(row.ask)) / 2;
  }
  return null;
}

function roundMoney(value: number) {
  return Math.max(0, Math.round(value * 100) / 100);
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function unique(items: string[]) {
  return [...new Set(items.filter(Boolean))];
}
