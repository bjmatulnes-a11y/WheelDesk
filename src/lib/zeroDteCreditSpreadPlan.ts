import type { ExecutionCandidate } from "./zeroDteExecutionIntelligence";
import type { ZeroDteDirectionalSignal } from "./zeroDteDirectionalSignal";
import type { OpeningPriorContext } from "./zeroDtePriorStructure";
import type { ZeroDteRiskPolicy } from "./zeroDteRiskPolicy";
import {
  accountRiskBudgetDollars,
  absoluteDistanceFloorPoints,
  effectiveCreditPlanEventRisk,
} from "./zeroDteRiskPolicy";
import {
  buildStructureAnchorConfluence,
  type StructureAnchor,
  type StructureCandle,
  type StructureAnchorSourceKind,
  type ZeroDteStructureSnapshot,
} from "./zeroDteStructureMap";
import {
  buildSpreadEdgeRead,
  isInsideEntryWindow,
  type MoveTableContext,
  type SpreadEdgeRead,
  type ZeroDteMoveTable,
} from "./zeroDteMoveTable";

export type CreditSpreadPlanSide = "PCS" | "CCS";
export type CreditSpreadPlanStatus = "READY" | "PAIRED" | "WAIT" | "NO_TRADE_DAY";
export type CreditSpreadEntryTrigger =
  | "STRUCTURE_REVERSAL"
  | "STRUCTURE_CONTINUATION"
  | "FADE_REJECTION"
  | "FADE_SWEEP"
  | "NONE";
export type CreditSpreadGammaRegime = "POSITIVE" | "NEGATIVE" | null;
export type CreditSpreadDirectionalTilt = "BULL" | "BEAR" | "NONE";

export type CreditSpreadDefense = {
  label: string;
  price: number;
  kind: "OI" | "PRIOR" | "SWING" | "FVG";
  strong: boolean;
  sourceKind?: StructureAnchorSourceKind | null;
  anchorId?: string | null;
  confluenceCount?: number;
};

export type CreditSpreadExitPlan = {
  takeProfitDebit: number;
  takeProfitPct: number;
  structureStopText: string;
  priceStopDebit: number;
  stopCreditMultiple: number;
  timeStopText: string;
  holdToExpiryEdge: true;
};

export type CreditSpreadPlanLeg = {
  side: CreditSpreadPlanSide;
  strategy: "put-credit-spread" | "call-credit-spread";
  candidate: ExecutionCandidate;
  shortStrike: number;
  longStrike: number;
  widthPoints: number;
  sellableCredit: number;
  maxRiskDollars: number;
  creditToRiskPct: number;
  shortDeltaAbs: number | null;
  distancePoints: number;
  distanceEm: number;
  guard: CreditSpreadDefense | null;
  defenses: CreditSpreadDefense[];
  invalidationText: string;
  reasons: string[];
  blockers: string[];
  edge: SpreadEdgeRead | null;
  rank: number;
  entryTrigger: CreditSpreadEntryTrigger;
  entryTriggerDetail: string;
  directionalTilt: CreditSpreadDirectionalTilt;
  gammaRegime: CreditSpreadGammaRegime;
  riskSizeMultiplier: number;
  exitPlan: CreditSpreadExitPlan;
};

export type DefensibleCreditSpreadPlan = {
  status: CreditSpreadPlanStatus;
  side: CreditSpreadPlanSide | null;
  strategy: "put-credit-spread" | "call-credit-spread" | null;
  candidate: ExecutionCandidate | null;
  shortStrike: number | null;
  longStrike: number | null;
  widthPoints: number | null;
  sellableCredit: number | null;
  maxRiskDollars: number | null;
  creditToRiskPct: number | null;
  shortDeltaAbs: number | null;
  distancePoints: number | null;
  guard: CreditSpreadDefense | null;
  defenses: CreditSpreadDefense[];
  invalidationText: string;
  reasons: string[];
  blockers: string[];
  primary: CreditSpreadPlanLeg | null;
  paired: { pcs: CreditSpreadPlanLeg; ccs: CreditSpreadPlanLeg } | null;
  edge: SpreadEdgeRead | null;
  entryTrigger: CreditSpreadEntryTrigger;
  entryTriggerDetail: string;
  gammaRegime: CreditSpreadGammaRegime;
  directionalTilt: CreditSpreadDirectionalTilt;
  dayVetoReason: string | null;
  outsideEntryWindow: boolean;
  moveTableContext: MoveTableContext | null;
};

export function buildDefensibleCreditSpreadPlan(args: {
  directional: ZeroDteDirectionalSignal;
  spot: number;
  expectedMove: number | null | undefined;
  candidates: readonly ExecutionCandidate[];
  anchors: readonly StructureAnchor[];
  structure: ZeroDteStructureSnapshot;
  candles?: readonly StructureCandle[];
  policy: ZeroDteRiskPolicy;
  moveTable?: ZeroDteMoveTable | null;
  moveTableContext?: MoveTableContext | null;
  gammaFlip?: number | null;
  generatedAt?: string | number | null;
  openingPriorContext?: OpeningPriorContext | null;
  vixChangePct?: number | null;
  macroEvent?: string | null;
  confluenceTolerance?: number;
}): DefensibleCreditSpreadPlan {
  const expectedMove = Math.max(1, finite(args.expectedMove) ?? 20);
  const gammaRegime = finite(args.gammaFlip)
    ? args.spot > args.gammaFlip! ? "POSITIVE" : "NEGATIVE"
    : null;
  const directionalTilt: CreditSpreadDirectionalTilt = args.directional.action === "BUY"
    ? "BULL"
    : args.directional.action === "SELL"
      ? "BEAR"
      : "NONE";
  const effectiveEventRisk = effectiveCreditPlanEventRisk(args.policy, args.macroEvent);
  const dayVetoReason = buildDayVetoReason({
    eventRisk: effectiveEventRisk,
    macroEvent: args.macroEvent ?? null,
    opening: args.openingPriorContext ?? null,
    gammaRegime,
    vixChangePct: args.vixChangePct ?? null,
  });
  const generatedEpoch = generatedEpochSeconds(args.generatedAt);
  const outsideEntryWindow = generatedEpoch === null
    ? false
    : !isInsideEntryWindow(generatedEpoch, args.policy.entryWindowStart, args.policy.entryWindowEnd);

  if (dayVetoReason) {
    return emptyPlan({
      status: "NO_TRADE_DAY",
      blockers: [dayVetoReason],
      gammaRegime,
      directionalTilt,
      dayVetoReason,
      outsideEntryWindow,
      moveTableContext: args.moveTableContext ?? null,
    });
  }

  const accountCap = accountRiskBudgetDollars(args.policy);
  const riskCap = minNullable(args.policy.maxRiskPerTradeDollars, accountCap);
  const baseFloor = absoluteDistanceFloorPoints(args.policy, args.spot);
  const confluenceTolerance = Math.max(1, args.confluenceTolerance ?? 0.05 * expectedMove);
  const rawEvaluations = args.candidates
    .filter((candidate) => candidate.strategy === "put-credit-spread" || candidate.strategy === "call-credit-spread")
    .map((candidate) => {
      const side: CreditSpreadPlanSide = candidate.strategy === "put-credit-spread" ? "PCS" : "CCS";
      const tiltFactor = distanceTiltFactor(side, directionalTilt);
      return evaluateCandidate({
        candidate,
        side,
        directional: args.directional,
        spot: args.spot,
        expectedMove,
        anchors: args.anchors,
        structure: args.structure,
        candles: args.candles ?? [],
        policy: args.policy,
        distanceFloor: baseFloor * tiltFactor,
        riskCap,
        moveTable: args.moveTable ?? null,
        moveTableContext: args.moveTableContext ?? null,
        gammaRegime,
        confluenceTolerance,
        directionalTilt,
      });
    });
  const evaluations = applyDirectionalRankTilt(rawEvaluations, directionalTilt);

  const bySide = (side: CreditSpreadPlanSide) => evaluations
    .filter((item) => item.side === side)
    .sort((a, b) => b.rank - a.rank);
  const pcs = bySide("PCS");
  const ccs = bySide("CCS");
  const readyPcs = pcs.find((item) => item.blockers.length === 0) ?? null;
  const readyCcs = ccs.find((item) => item.blockers.length === 0) ?? null;
  const bestBlocked = [...pcs, ...ccs].sort((a, b) => b.rank - a.rank)[0] ?? null;

  if (outsideEntryWindow) {
    const best = readyPcs ?? readyCcs ?? bestBlocked;
    return best
      ? fromEvaluated(best, "WAIT", {
          paired: null,
          blockers: dedupe([`Outside entry window ${args.policy.entryWindowStart}–${args.policy.entryWindowEnd} CT.`, ...best.blockers]),
          gammaRegime,
          directionalTilt,
          dayVetoReason: null,
          outsideEntryWindow,
          moveTableContext: args.moveTableContext ?? null,
        })
      : emptyPlan({
          status: "WAIT",
          blockers: [`Outside entry window ${args.policy.entryWindowStart}–${args.policy.entryWindowEnd} CT.`],
          gammaRegime,
          directionalTilt,
          dayVetoReason: null,
          outsideEntryWindow,
          moveTableContext: args.moveTableContext ?? null,
        });
  }

  const structuralReady = [readyPcs, readyCcs].filter((item): item is Evaluated =>
    Boolean(item && (item.entryTrigger === "STRUCTURE_REVERSAL" || item.entryTrigger === "STRUCTURE_CONTINUATION")),
  );

  if (readyPcs && readyCcs && gammaRegime === "POSITIVE" && structuralReady.length === 0) {
    const pcsLeg = toPlanLeg(readyPcs, 0.5);
    const ccsLeg = toPlanLeg(readyCcs, 0.5);
    const primaryEval = (readyPcs.edge?.evPerLotDollars ?? -Infinity) >= (readyCcs.edge?.evPerLotDollars ?? -Infinity)
      ? readyPcs
      : readyCcs;
    const plan = fromEvaluated(primaryEval, "PAIRED", {
      paired: { pcs: pcsLeg, ccs: ccsLeg },
      blockers: [],
      gammaRegime,
      directionalTilt,
      dayVetoReason: null,
      outsideEntryWindow,
      moveTableContext: args.moveTableContext ?? null,
    });
    plan.reasons = dedupe(["Both defended sides are positive-EV in positive gamma; size each side at 50% normal risk.", ...plan.reasons]);
    return plan;
  }

  const ready = [readyPcs, readyCcs].filter((item): item is Evaluated => Boolean(item));
  if (ready.length) {
    const triggerPriority = (item: Evaluated) =>
      item.entryTrigger === "STRUCTURE_REVERSAL" || item.entryTrigger === "STRUCTURE_CONTINUATION" ? 3
        : item.entryTrigger === "FADE_REJECTION" || item.entryTrigger === "FADE_SWEEP" ? 2
          : 1;
    const best = ready.sort((a, b) =>
      triggerPriority(b) - triggerPriority(a) ||
      b.rank - a.rank ||
      (b.edge?.evPerLotDollars ?? -Infinity) - (a.edge?.evPerLotDollars ?? -Infinity),
    )[0];
    return fromEvaluated(best, "READY", {
      paired: null,
      blockers: [],
      gammaRegime,
      directionalTilt,
      dayVetoReason: null,
      outsideEntryWindow,
      moveTableContext: args.moveTableContext ?? null,
    });
  }

  if (bestBlocked) {
    return fromEvaluated(bestBlocked, "WAIT", {
      paired: null,
      blockers: bestBlocked.blockers,
      gammaRegime,
      directionalTilt,
      dayVetoReason: null,
      outsideEntryWindow,
      moveTableContext: args.moveTableContext ?? null,
    });
  }
  return emptyPlan({
    status: "WAIT",
    blockers: ["No defended, positive-EV credit spread is available right now."],
    gammaRegime,
    directionalTilt,
    dayVetoReason: null,
    outsideEntryWindow,
    moveTableContext: args.moveTableContext ?? null,
  });
}

type Evaluated = {
  side: CreditSpreadPlanSide;
  candidate: ExecutionCandidate;
  rank: number;
  shortStrike: number;
  longStrike: number;
  width: number;
  credit: number;
  maxRisk: number;
  creditToRiskPct: number;
  delta: number | null;
  distance: number;
  distanceEm: number;
  defenses: CreditSpreadDefense[];
  guard: CreditSpreadDefense | null;
  reasons: string[];
  blockers: string[];
  edge: SpreadEdgeRead | null;
  entryTrigger: CreditSpreadEntryTrigger;
  entryTriggerDetail: string;
  gammaRegime: CreditSpreadGammaRegime;
  directionalTilt: CreditSpreadDirectionalTilt;
  exitPlan: CreditSpreadExitPlan;
  riskSizeMultiplier: number;
};

function evaluateCandidate(args: {
  candidate: ExecutionCandidate;
  side: CreditSpreadPlanSide;
  directional: ZeroDteDirectionalSignal;
  spot: number;
  expectedMove: number;
  anchors: readonly StructureAnchor[];
  structure: ZeroDteStructureSnapshot;
  candles: readonly StructureCandle[];
  policy: ZeroDteRiskPolicy;
  distanceFloor: number;
  riskCap: number | null;
  moveTable: ZeroDteMoveTable | null;
  moveTableContext: MoveTableContext | null;
  gammaRegime: CreditSpreadGammaRegime;
  confluenceTolerance: number;
  directionalTilt: CreditSpreadDirectionalTilt;
}): Evaluated {
  const short = args.candidate.legs.find((leg) => leg.action === "sell")?.strike ?? NaN;
  const long = args.candidate.legs.find((leg) => leg.action === "buy")?.strike ?? NaN;
  const width = Math.abs(short - long);
  const credit = finite(args.candidate.sellableCredit) ?? finite(args.candidate.estimatedCredit) ?? NaN;
  const maxRisk = finite(args.candidate.maxRiskDollars) ?? (Number.isFinite(width) && Number.isFinite(credit)
    ? Math.max(0, width - credit) * 100
    : NaN);
  const delta = finite(args.candidate.shortDeltaAbs);
  const distance = args.side === "PCS" ? args.spot - short : short - args.spot;
  const distanceEm = distance / Math.max(1, args.expectedMove);
  const defenses = collectDefenses({
    side: args.side,
    spot: args.spot,
    shortStrike: short,
    anchors: args.anchors,
    structure: args.structure,
    tolerance: args.confluenceTolerance,
  });
  const guard = defenses.find((item) => item.strong) ?? defenses[0] ?? null;
  const blockers = [...args.candidate.blockers];
  const reasons: string[] = [];

  if (!args.candidate.eligible) blockers.push("Candidate is not eligible in the execution selector.");
  if (!Number.isFinite(short) || !Number.isFinite(long) || width <= 0) blockers.push("Spread legs are incomplete.");
  if (!Number.isFinite(credit) || credit < args.policy.minSellableCredit) blockers.push("Executable credit is below the policy floor.");
  if (!Number.isFinite(maxRisk) || maxRisk <= 0) blockers.push("Defined risk is unavailable.");
  if (args.riskCap !== null && Number.isFinite(maxRisk) && maxRisk > args.riskCap + 0.01) {
    blockers.push(`One-lot risk $${Math.round(maxRisk)} exceeds the active $${Math.round(args.riskCap)} cap.`);
  }
  if (distance <= 0) blockers.push("Short strike is not OTM.");
  if (distance < args.distanceFloor) blockers.push(`Short strike is only ${distance.toFixed(1)} points OTM; tilted policy requires ${args.distanceFloor.toFixed(1)}.`);
  if (delta !== null && delta > args.policy.shortDeltaMax + 0.0001) blockers.push(`Short delta ${delta.toFixed(2)} exceeds the ${args.policy.shortDeltaMax.toFixed(2)} cap.`);
  if (!guard) blockers.push("No support/resistance guard sits between spot and the short strike.");
  else if (!guard.strong) blockers.push("Only a minor FVG guard is present; require an OI/prior/external-swing defense for account-repair mode.");

  if (args.side === "PCS" && args.directional.gates.bullVeto) blockers.push("Fresh bearish BOS vetoes new put-credit spreads.");
  if (args.side === "CCS" && args.directional.gates.bearVeto) blockers.push("Fresh bullish BOS vetoes new call-credit spreads.");

  const riskPoints = Number.isFinite(maxRisk) ? maxRisk / 100 : NaN;
  const creditToRiskPct = Number.isFinite(credit) && Number.isFinite(riskPoints) && riskPoints > 0 ? credit / riskPoints : NaN;
  if (Number.isFinite(creditToRiskPct) && creditToRiskPct < 0.10) blockers.push(`Credit/risk ${(creditToRiskPct * 100).toFixed(0)}% is below the 10% defensibility floor.`);

  const trigger = detectEntryTrigger({
    side: args.side,
    spot: args.spot,
    expectedMove: args.expectedMove,
    anchors: args.anchors,
    structure: args.structure,
    candles: args.candles,
    directional: args.directional,
    gammaRegime: args.gammaRegime,
    tolerance: args.confluenceTolerance,
  });
  const structureConfirmedTrigger = trigger.kind === "STRUCTURE_REVERSAL" || trigger.kind === "STRUCTURE_CONTINUATION";

  const edge = buildSpreadEdgeRead({
    side: args.side,
    shortStrike: short,
    longStrike: long,
    credit,
    spot: args.spot,
    shortDeltaAbs: delta,
    table: args.moveTable,
    context: args.moveTableContext,
  });
  let provisionalHistory = false;
  if (!edge) {
    blockers.push("Historical edge is unavailable for this setup.");
  } else if (edge.evPerLotDollars <= 0) {
    blockers.push("Historical EV is negative: market is not overpaying for this distance.");
  } else if (edge.sample.n < 30) {
    if (structureConfirmedTrigger && guard?.strong) {
      provisionalHistory = true;
      reasons.push(`Thin history n=${edge.sample.n} days; fresh ${trigger.kind === "STRUCTURE_REVERSAL" ? "reversal" : "continuation"} structure permits a provisional half-size entry.`);
    } else {
      blockers.push(`Not enough history for this setup (n=${edge.sample.n} distinct days).`);
    }
  }

  if (guard) reasons.push(`${guard.label} ${guard.price.toFixed(1)} guards the short strike.`);
  const tiltText = args.directionalTilt === "NONE" ? "No directional tilt" : `${args.directionalTilt} directional tilt`;
  reasons.push(`${tiltText}; direction is a veto/placement adjustment, not an entry prerequisite.`);
  if (delta !== null) reasons.push(`Short delta ${delta.toFixed(2)}; distance ${distance.toFixed(1)} points (${Math.round(distanceEm * 100)}% of EM).`);
  if (edge) reasons.push(`${edge.sample.mode === "MODELED" ? "MODELED" : "Historical"} hold-to-expiry EV ${moneySigned(edge.evPerLotDollars)} / lot from n=${edge.sample.n} distinct days.`);

  const defenseBonus = defenses.reduce((sum, item) => sum + (item.strong ? 8 : 3), 0);
  const widthPreference = width >= 10 && width <= 20 ? 8 : width <= 30 ? 3 : -4;
  const deltaPreference = delta === null ? 0 : Math.max(-10, 8 - Math.abs(delta - 0.18) * 50);
  const distancePreference = Math.min(8, Math.max(0, (distance - args.distanceFloor) / 3));
  const edgeBonus = edge?.edgePts == null ? 0 : clamp(edge.edgePts, -10, 15);
  const triggerBonus = trigger.kind === "STRUCTURE_REVERSAL" || trigger.kind === "STRUCTURE_CONTINUATION"
    ? 18
    : trigger.kind === "FADE_REJECTION" || trigger.kind === "FADE_SWEEP"
      ? 8
      : 0;
  const rank = args.candidate.score + Math.min(22, defenseBonus) + widthPreference + deltaPreference + distancePreference + edgeBonus + triggerBonus;
  const invalidationText = guard
    ? `${args.side === "PCS" ? "1m close below" : "1m close above"} ${guard.label} ${guard.price.toFixed(1)} invalidates the defense thesis.`
    : "No structural guard is present between spot and the short strike.";
  const exitPlan = buildExitPlan({
    credit: Number.isFinite(credit) ? credit : 0,
    invalidationText,
    takeProfitPct: args.policy.takeProfitPct,
    stopCreditMultiple: args.policy.stopCreditMultiple,
  });

  return {
    side: args.side,
    candidate: args.candidate,
    rank,
    shortStrike: short,
    longStrike: long,
    width,
    credit,
    maxRisk,
    creditToRiskPct: Number.isFinite(creditToRiskPct) ? creditToRiskPct : 0,
    delta,
    distance,
    distanceEm,
    defenses,
    guard,
    reasons: dedupe(reasons),
    blockers: dedupe(blockers),
    edge,
    entryTrigger: trigger.kind,
    entryTriggerDetail: trigger.detail,
    gammaRegime: args.gammaRegime,
    directionalTilt: args.directionalTilt,
    exitPlan,
    riskSizeMultiplier: provisionalHistory ? 0.5 : 1,
  };
}

function detectEntryTrigger(args: {
  side: CreditSpreadPlanSide;
  spot: number;
  expectedMove: number;
  anchors: readonly StructureAnchor[];
  structure: ZeroDteStructureSnapshot;
  candles: readonly StructureCandle[];
  directional: ZeroDteDirectionalSignal;
  gammaRegime: CreditSpreadGammaRegime;
  tolerance: number;
}): { kind: CreditSpreadEntryTrigger; detail: string } {
  const structural = detectStructuralEntryTrigger(args);
  if (structural) return structural;

  if (args.gammaRegime !== "POSITIVE") {
    return { kind: "NONE", detail: args.gammaRegime === "NEGATIVE" ? "Neg-gamma: fades disabled." : "Gamma regime unavailable: fade trigger disabled." };
  }
  if (!args.candles.length) return { kind: "NONE", detail: "READY · no trigger yet" };
  const lastIndex = args.candles.length - 1;
  const confluence = buildStructureAnchorConfluence({ snapshot: args.structure, anchors: args.anchors, tolerancePoints: args.tolerance });
  const desiredTone = args.side === "PCS" ? "BULL" : "BEAR";
  const eligible = confluence.filter(({ anchor, count }) => {
    if (anchor.tone !== desiredTone) return false;
    if (count >= 2) return true;
    if (args.side === "PCS") return anchor.id === "put-wall" || /(^|-)prior-(PDL|ONL|PWL)/.test(anchor.id) || anchor.id === "ib-low";
    return anchor.id === "call-wall" || /(^|-)prior-(PDH|ONH|PWH)/.test(anchor.id) || anchor.id === "ib-high";
  });
  const recentSweep = [...args.structure.sweeps].reverse().find((sweep) =>
    lastIndex - sweep.sweepIndex <= 3 &&
    sweep.direction === (args.side === "PCS" ? "BULL" : "BEAR") &&
    eligible.some(({ anchor }) => Math.abs(anchor.price - sweep.level) <= args.tolerance),
  );
  if (recentSweep) return { kind: "FADE_SWEEP", detail: `${args.side} ENTER NOW · liquidity sweep rejected a defended level.` };

  for (let index = Math.max(0, lastIndex - 2); index <= lastIndex; index += 1) {
    const candle = args.candles[index];
    const hit = eligible.find(({ anchor }) => args.side === "PCS"
      ? candle.low <= anchor.price + args.tolerance && candle.close > anchor.price
      : candle.high >= anchor.price - args.tolerance && candle.close < anchor.price,
    );
    if (hit) return { kind: "FADE_REJECTION", detail: `${args.side} ENTER NOW · 1m rejection at ${hit.anchor.label} ${hit.anchor.price.toFixed(1)}.` };
  }
  return { kind: "NONE", detail: "READY · no trigger yet" };
}

function detectStructuralEntryTrigger(args: {
  side: CreditSpreadPlanSide;
  spot: number;
  expectedMove: number;
  structure: ZeroDteStructureSnapshot;
  candles: readonly StructureCandle[];
  directional: ZeroDteDirectionalSignal;
}): { kind: Exclude<CreditSpreadEntryTrigger, "FADE_REJECTION" | "FADE_SWEEP" | "NONE">; detail: string } | null {
  if (!args.candles.length) return null;
  const lastIndex = args.candles.length - 1;
  const direction = args.side === "PCS" ? "BULL" : "BEAR";
  const opposite = direction === "BULL" ? "BEAR" : "BULL";
  const matchingAction = args.side === "PCS" ? "BUY" : "SELL";
  const latestClose = args.candles[lastIndex]?.close ?? args.spot;
  const maxChase = Math.max(4, Math.min(10, 0.25 * Math.max(1, args.expectedMove)));

  const breaks = [...args.structure.breaks].sort((a, b) => a.breakIndex - b.breakIndex);
  const freshBos = [...breaks].reverse().find((item) =>
    item.direction === direction && item.kind === "BOS" && lastIndex - item.breakIndex <= 3,
  ) ?? null;
  if (!freshBos) return null;
  if (Math.abs(latestClose - freshBos.level) > maxChase) return null;

  const oppositeAfter = breaks.some((item) =>
    item.direction === opposite && item.kind === "BOS" && item.breakIndex > freshBos.breakIndex,
  );
  if (oppositeAfter) return null;

  const priorChoch = [...breaks].reverse().find((item) =>
    item.direction === direction &&
    item.kind === "CHOCH" &&
    item.breakIndex < freshBos.breakIndex &&
    freshBos.breakIndex - item.breakIndex <= 8,
  ) ?? null;
  if (priorChoch) {
    return {
      kind: "STRUCTURE_REVERSAL",
      detail: `${args.side} ENTER NOW · CHoCH → BOS ${direction.toLowerCase()} reversal confirmed; fresh BOS is ${lastIndex - freshBos.breakIndex} bar(s) old.`,
    };
  }

  const pullbackLabel = args.side === "PCS" ? "HL" : "LH";
  const pullback = [...args.structure.swings].reverse().find((item) =>
    item.label === pullbackLabel &&
    item.confirmIndex <= freshBos.breakIndex &&
    freshBos.breakIndex - item.confirmIndex <= 8,
  ) ?? null;
  if (pullback) {
    const priorBos = [...breaks].reverse().find((item) =>
      item.direction === direction && item.kind === "BOS" && item.breakIndex < pullback.confirmIndex,
    ) ?? null;
    const oppositeSincePullback = breaks.some((item) =>
      item.direction === opposite && item.kind === "BOS" && item.breakIndex > pullback.confirmIndex,
    );
    if (priorBos && !oppositeSincePullback) {
      return {
        kind: "STRUCTURE_CONTINUATION",
        detail: `${args.side} ENTER NOW · ${pullbackLabel} → fresh BOS ${direction.toLowerCase()} continuation confirmed; fresh BOS is ${lastIndex - freshBos.breakIndex} bar(s) old.`,
      };
    }
  }

  if (args.directional.action === matchingAction && args.directional.trigger === "REVERSAL_CAPTURE") {
    return {
      kind: "STRUCTURE_REVERSAL",
      detail: `${args.side} ENTER NOW · directional reversal capture and fresh ${direction.toLowerCase()} BOS agree.`,
    };
  }
  if (args.directional.action === matchingAction && args.directional.trigger === "CONTINUATION_CAPTURE") {
    return {
      kind: "STRUCTURE_CONTINUATION",
      detail: `${args.side} ENTER NOW · directional continuation capture and fresh ${direction.toLowerCase()} BOS agree.`,
    };
  }
  return null;
}

function collectDefenses(args: {
  side: CreditSpreadPlanSide;
  spot: number;
  shortStrike: number;
  anchors: readonly StructureAnchor[];
  structure: ZeroDteStructureSnapshot;
  tolerance: number;
}): CreditSpreadDefense[] {
  if (!Number.isFinite(args.shortStrike) || !Number.isFinite(args.spot)) return [];
  const low = Math.min(args.spot, args.shortStrike);
  const high = Math.max(args.spot, args.shortStrike);
  const desiredTone = args.side === "PCS" ? "BULL" : "BEAR";
  const results: CreditSpreadDefense[] = [];
  const confluence = new Map(buildStructureAnchorConfluence({ snapshot: args.structure, anchors: args.anchors, tolerancePoints: args.tolerance }).map((item) => [item.anchor.id, item.count]));

  for (const anchor of args.anchors) {
    if (anchor.tone !== desiredTone || anchor.sourceKind === "TRADE") continue;
    if (anchor.price < low - 0.01 || anchor.price > high + 0.01) continue;
    const prior = anchor.sourceKind && ["PRIOR_DAY", "OVERNIGHT", "WEEKLY", "DAILY", "CARRIED_SWING", "INITIAL_BALANCE"].includes(anchor.sourceKind);
    results.push({
      label: anchor.label,
      price: anchor.price,
      kind: anchor.sourceKind === "OI" ? "OI" : "PRIOR",
      strong: anchor.sourceKind === "OI" || Boolean(prior) || (confluence.get(anchor.id) ?? 1) >= 2,
      sourceKind: anchor.sourceKind ?? null,
      anchorId: anchor.id,
      confluenceCount: confluence.get(anchor.id) ?? 1,
    });
  }

  const swingKind = args.side === "PCS" ? "LOW" : "HIGH";
  for (const swing of args.structure.swings.filter((item) => item.scale === "EXTERNAL" && item.kind === swingKind).slice(-6)) {
    if (swing.price < low - 0.01 || swing.price > high + 0.01) continue;
    results.push({ label: `External ${swing.label}`, price: swing.price, kind: "SWING", strong: true, sourceKind: null, anchorId: null, confluenceCount: 1 });
  }

  const fvgDirection = args.side === "PCS" ? "BULL" : "BEAR";
  for (const fvg of args.structure.fvgs.filter((item) => !item.mitigated && item.direction === fvgDirection).slice(-6)) {
    if (fvg.high < low || fvg.low > high) continue;
    results.push({ label: `${fvgDirection} FVG`, price: (fvg.low + fvg.high) / 2, kind: "FVG", strong: false, sourceKind: null, anchorId: null, confluenceCount: 1 });
  }
  return dedupeDefenses(results).sort((a, b) => Math.abs(a.price - args.spot) - Math.abs(b.price - args.spot));
}

function buildExitPlan(args: {
  credit: number;
  invalidationText: string;
  takeProfitPct: number;
  stopCreditMultiple: number;
}): CreditSpreadExitPlan {
  return {
    takeProfitDebit: Math.max(0, args.credit * args.takeProfitPct),
    takeProfitPct: args.takeProfitPct,
    structureStopText: args.invalidationText,
    priceStopDebit: Math.max(0, args.credit * args.stopCreditMultiple),
    stopCreditMultiple: args.stopCreditMultiple,
    timeStopText: "14:30 CT: exit if spot is within 0.25× remaining move of the short strike.",
    holdToExpiryEdge: true,
  };
}

function toPlanLeg(item: Evaluated, riskSizeMultiplier = 1): CreditSpreadPlanLeg {
  const invalidationText = item.guard
    ? `${item.side === "PCS" ? "1m close below" : "1m close above"} ${item.guard.label} ${item.guard.price.toFixed(1)} invalidates the defense thesis.`
    : "No structural guard is present between spot and the short strike.";
  return {
    side: item.side,
    strategy: item.side === "PCS" ? "put-credit-spread" : "call-credit-spread",
    candidate: item.candidate,
    shortStrike: item.shortStrike,
    longStrike: item.longStrike,
    widthPoints: item.width,
    sellableCredit: item.credit,
    maxRiskDollars: item.maxRisk,
    creditToRiskPct: item.creditToRiskPct,
    shortDeltaAbs: item.delta,
    distancePoints: item.distance,
    distanceEm: item.distanceEm,
    guard: item.guard,
    defenses: item.defenses,
    invalidationText,
    reasons: item.reasons,
    blockers: item.blockers,
    edge: item.edge,
    rank: item.rank,
    entryTrigger: item.entryTrigger,
    entryTriggerDetail: item.entryTriggerDetail,
    directionalTilt: item.directionalTilt,
    gammaRegime: item.gammaRegime,
    riskSizeMultiplier: Math.min(riskSizeMultiplier, item.riskSizeMultiplier),
    exitPlan: item.exitPlan,
  };
}

function fromEvaluated(
  item: Evaluated,
  status: CreditSpreadPlanStatus,
  meta: {
    paired: DefensibleCreditSpreadPlan["paired"];
    blockers: string[];
    gammaRegime: CreditSpreadGammaRegime;
    directionalTilt: CreditSpreadDirectionalTilt;
    dayVetoReason: string | null;
    outsideEntryWindow: boolean;
    moveTableContext: MoveTableContext | null;
  },
): DefensibleCreditSpreadPlan {
  const leg = toPlanLeg(item);
  return {
    status,
    side: status === "PAIRED" ? null : leg.side,
    strategy: status === "PAIRED" ? null : leg.strategy,
    candidate: leg.candidate,
    shortStrike: leg.shortStrike,
    longStrike: leg.longStrike,
    widthPoints: leg.widthPoints,
    sellableCredit: leg.sellableCredit,
    maxRiskDollars: leg.maxRiskDollars,
    creditToRiskPct: leg.creditToRiskPct,
    shortDeltaAbs: leg.shortDeltaAbs,
    distancePoints: leg.distancePoints,
    guard: leg.guard,
    defenses: leg.defenses,
    invalidationText: leg.invalidationText,
    reasons: leg.reasons,
    blockers: meta.blockers,
    primary: leg,
    paired: meta.paired,
    edge: leg.edge,
    entryTrigger: leg.entryTrigger,
    entryTriggerDetail: leg.entryTriggerDetail,
    gammaRegime: meta.gammaRegime,
    directionalTilt: meta.directionalTilt,
    dayVetoReason: meta.dayVetoReason,
    outsideEntryWindow: meta.outsideEntryWindow,
    moveTableContext: meta.moveTableContext,
  };
}

function emptyPlan(args: {
  status: CreditSpreadPlanStatus;
  blockers: string[];
  gammaRegime: CreditSpreadGammaRegime;
  directionalTilt: CreditSpreadDirectionalTilt;
  dayVetoReason: string | null;
  outsideEntryWindow: boolean;
  moveTableContext: MoveTableContext | null;
}): DefensibleCreditSpreadPlan {
  return {
    status: args.status,
    side: null,
    strategy: null,
    candidate: null,
    shortStrike: null,
    longStrike: null,
    widthPoints: null,
    sellableCredit: null,
    maxRiskDollars: null,
    creditToRiskPct: null,
    shortDeltaAbs: null,
    distancePoints: null,
    guard: null,
    defenses: [],
    invalidationText: "No defended spread is ready.",
    reasons: [],
    blockers: args.blockers,
    primary: null,
    paired: null,
    edge: null,
    entryTrigger: "NONE",
    entryTriggerDetail: args.status === "NO_TRADE_DAY" ? "New credit-spread entries are vetoed for this session." : "WAIT",
    gammaRegime: args.gammaRegime,
    directionalTilt: args.directionalTilt,
    dayVetoReason: args.dayVetoReason,
    outsideEntryWindow: args.outsideEntryWindow,
    moveTableContext: args.moveTableContext,
  };
}

function buildDayVetoReason(args: {
  eventRisk: "NORMAL" | "HIGH";
  macroEvent: string | null;
  opening: OpeningPriorContext | null;
  gammaRegime: CreditSpreadGammaRegime;
  vixChangePct: number | null;
}) {
  if (args.eventRisk === "HIGH") return args.macroEvent ? `NO TRADE: ${args.macroEvent} macro-risk day.` : "NO TRADE: event risk is HIGH.";
  if (args.opening && args.opening.openingDayType !== "INSIDE_RANGE" && args.opening.gapClass === "LARGE" && args.gammaRegime === "NEGATIVE") {
    return "NO TRADE: large outside gap is trading in negative gamma.";
  }
  if (finite(args.vixChangePct) && args.vixChangePct! > 15) return `NO TRADE: VIX is up ${args.vixChangePct!.toFixed(1)}% from its prior close.`;
  return null;
}


function applyDirectionalRankTilt(
  evaluations: readonly Evaluated[],
  tilt: CreditSpreadDirectionalTilt,
): Evaluated[] {
  if (tilt === "NONE") return [...evaluations];
  const favoredSide: CreditSpreadPlanSide = tilt === "BULL" ? "PCS" : "CCS";
  const adjusted = evaluations.map((item) => ({ ...item }));
  for (const side of ["PCS", "CCS"] as const) {
    const eligible = adjusted
      .filter((item) => item.side === side && item.candidate.eligible && Number.isFinite(item.distanceEm))
      .sort((a, b) => a.distanceEm - b.distanceEm);
    if (!eligible.length) continue;
    const median = eligible[Math.floor((eligible.length - 1) / 2)]?.distanceEm ?? 0;
    for (const item of adjusted.filter((value) => value.side === side)) {
      const closerHalf = item.distanceEm <= median;
      const shouldBonus = side === favoredSide ? closerHalf : !closerHalf;
      if (shouldBonus) item.rank += 4;
    }
  }
  return adjusted;
}

function distanceTiltFactor(side: CreditSpreadPlanSide, tilt: CreditSpreadDirectionalTilt) {
  if (tilt === "NONE") return 1;
  if ((tilt === "BULL" && side === "PCS") || (tilt === "BEAR" && side === "CCS")) return 0.85;
  return 1.15;
}

function generatedEpochSeconds(value: string | number | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return value > 1e12 ? value / 1000 : value;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return ms / 1000;
  }
  return null;
}

function minNullable(a: number | null, b: number | null) {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

function finite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, value));
}

function dedupe(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function dedupeDefenses(values: CreditSpreadDefense[]) {
  const seen = new Set<string>();
  return values.filter((item) => {
    const key = `${item.kind}:${item.label}:${item.price.toFixed(2)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function moneySigned(value: number) {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(0)}`;
}
