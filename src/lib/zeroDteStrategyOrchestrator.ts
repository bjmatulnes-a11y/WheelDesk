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
  const dealerAlignment = clamp(
    side === "put"
      ? 50 + rec.dealerPressure * 0.8
      : 50 - rec.dealerPressure * 0.8,
  );
  const flowAlignment = spreadFlowAlignment(side, strikeFlow);
  const pathAlignment = scoreLeastResistanceSide({
    path: leastResistancePath,
    side,
  });
  const wall = side === "put" ? controlling.putWall : controlling.callWall;

  if (mapState.phase === "TRANSITION") {
    const aligned =
      (side === "put" && mapState.railBreached === "UPPER") ||
      (side === "call" && mapState.railBreached === "LOWER");
    if (aligned) {
      reasons.push(
        `${side === "put" ? "Upper" : "Lower"} migration promotes the ${side}-credit-spread side.`,
      );
    } else if (mapState.railBreached !== "NONE") {
      blockers.push("This spread sells premium against the active map migration.");
    }
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
  const againstMigration = blockers.some((item) =>
    item.includes("against the active map migration"),
  );
  const eligible =
    executable &&
    !hardFlowBlock &&
    !againstMigration &&
    !structureBlocked &&
    !shortInsideWall &&
    score >= 35;

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
  const mapAlignment = clamp(100 - (centerDistance / halfWidth) * 100);
  const dealerAlignment = clamp(100 - Math.abs(rec.dealerPressure) * 1.6);
  const flowAlignment = mapState.railBreached === "NONE" ? 72 : 22;
  const pinProbability = controlling.structure.pinProbability;
  const pathNeutrality =
    !leastResistancePath
      ? 55
      : leastResistancePath.direction === "NEUTRAL"
        ? 95
        : Math.max(10, 70 - leastResistancePath.confidence * 0.55);
  const pathConeScore =
    !leastResistancePath
      ? 55
      : clamp(
          100 -
            (leastResistancePath.terminalConeWidth /
              Math.max(leastResistancePath.expectedMoveRemaining, 1)) *
              70,
        );
  const pathAlignment = clamp(pathNeutrality * 0.65 + pathConeScore * 0.35);

  if (credit === null) blockers.push("The opening iron fly cannot be priced from live mids.");
  if (mapState.phase === "TRANSITION") {
    blockers.push("Iron fly is blocked while a replacement map is being confirmed.");
  }
  if (mapState.railBreached !== "NONE") {
    blockers.push("Price is outside a controlling rail; symmetric premium is not stable.");
  }
  if (Math.abs(rec.dealerPressure) > 35) {
    blockers.push("Dealer pressure is too directional for a symmetric fly.");
  }
  const pathHardDirectional = Boolean(
    leastResistancePath &&
      leastResistancePath.confidence >= 75 &&
      leastResistancePath.direction !== "NEUTRAL",
  );
  if (pathHardDirectional) {
    blockers.push("High-confidence least-resistance path is directional; symmetric fly entry is blocked.");
  }

  let score =
    rec.confidenceScore * 0.22 +
    rec.spx.symmetryScore * 0.18 +
    pinProbability * 0.16 +
    mapAlignment * 0.18 +
    dealerAlignment * 0.11 +
    flowAlignment * 0.05 +
    pathAlignment * 0.10;
  score -= blockers.length * 10;

  if (mapState.phase === "ACTIVE" && mapState.railBreached === "NONE") {
    reasons.push("Confirmed active map is holding inside its rails.");
  }
  if (pinProbability >= 60) reasons.push("Pin probability supports center attraction.");
  if (dealerAlignment >= 65) reasons.push("Dealer pressure is sufficiently neutral.");
  if (leastResistancePath) {
    reasons.push(
      `Least-resistance fly alignment ${Math.round(pathAlignment)}/100; path ${leastResistancePath.direction} ${leastResistancePath.confidence}% with ${leastResistancePath.terminalConeWidth.toFixed(1)}-point terminal cone.`,
    );
  }
  reasons.push(
    `Center distance ${centerDistance.toFixed(1)} points; opening IF center ${controlling.center.toFixed(0)}.`,
  );

  return {
    rank: 0,
    tradeType: "iron-fly",
    label: "Iron Fly",
    score: clamp(score),
    eligible:
      credit !== null &&
      mapState.phase !== "TRANSITION" &&
      mapState.railBreached === "NONE" &&
      Math.abs(rec.dealerPressure) <= 35 &&
      !pathHardDirectional &&
      score >= 40,
    mapAlignment,
    dealerAlignment,
    flowAlignment,
    pathAlignment,
    strikes: `${controlling.lowerWing.toFixed(0)} / ${controlling.center.toFixed(0)} / ${controlling.upperWing.toFixed(0)}`,
    estimatedCredit: credit,
    maxRiskDollars:
      credit === null
        ? null
        : Math.max(0, halfWidth - credit) * 100,
    creditToRiskPct:
      credit === null || halfWidth - credit <= 0
        ? null
        : credit / (halfWidth - credit),
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
