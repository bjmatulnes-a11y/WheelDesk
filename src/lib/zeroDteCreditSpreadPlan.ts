import type { ExecutionCandidate } from "./zeroDteExecutionIntelligence";
import type { ZeroDteDirectionalSignal } from "./zeroDteDirectionalSignal";
import type { ZeroDteRiskPolicy } from "./zeroDteRiskPolicy";
import { accountRiskBudgetDollars, absoluteDistanceFloorPoints } from "./zeroDteRiskPolicy";
import type { StructureAnchor, ZeroDteStructureSnapshot } from "./zeroDteStructureMap";

export type CreditSpreadPlanSide = "PCS" | "CCS";
export type CreditSpreadPlanStatus = "READY" | "WAIT";

export type CreditSpreadDefense = {
  label: string;
  price: number;
  kind: "OI" | "PRIOR" | "SWING" | "FVG";
  strong: boolean;
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
};

export function buildDefensibleCreditSpreadPlan(args: {
  directional: ZeroDteDirectionalSignal;
  spot: number;
  expectedMove: number | null | undefined;
  candidates: readonly ExecutionCandidate[];
  anchors: readonly StructureAnchor[];
  structure: ZeroDteStructureSnapshot;
  policy: ZeroDteRiskPolicy;
}): DefensibleCreditSpreadPlan {
  const directionalSide = args.directional.action === "BUY"
    ? "PCS"
    : args.directional.action === "SELL"
      ? "CCS"
      : null;
  const strategy = directionalSide === "PCS"
    ? "put-credit-spread"
    : directionalSide === "CCS"
      ? "call-credit-spread"
      : null;

  if (!directionalSide || !strategy) {
    return waitPlan(null, null, ["Directional engine is WAIT. Do not sell a new credit spread without a confirmed side."]);
  }

  const expectedMove = Math.max(1, finite(args.expectedMove) ?? 20);
  const distanceFloor = absoluteDistanceFloorPoints(args.policy, args.spot);
  const accountCap = accountRiskBudgetDollars(args.policy);
  const riskCap = minNullable(args.policy.maxRiskPerTradeDollars, accountCap);
  const scored = args.candidates
    .filter((candidate) => candidate.strategy === strategy)
    .map((candidate) => evaluateCandidate({
      candidate,
      side: directionalSide,
      directional: args.directional,
      spot: args.spot,
      expectedMove,
      anchors: args.anchors,
      structure: args.structure,
      policy: args.policy,
      distanceFloor,
      riskCap,
    }))
    .sort((a, b) => b.rank - a.rank);

  const ready = scored.find((item) => item.blockers.length === 0) ?? null;
  const best = ready ?? scored[0] ?? null;
  if (!best) {
    return waitPlan(directionalSide, strategy, ["No executable candidate exists on the confirmed side."]);
  }

  const candidate = best.candidate;
  return {
    status: ready ? "READY" : "WAIT",
    side: directionalSide,
    strategy,
    candidate,
    shortStrike: best.shortStrike,
    longStrike: best.longStrike,
    widthPoints: best.width,
    sellableCredit: best.credit,
    maxRiskDollars: best.maxRisk,
    creditToRiskPct: best.creditToRiskPct,
    shortDeltaAbs: best.delta,
    distancePoints: best.distance,
    guard: best.guard,
    defenses: best.defenses,
    invalidationText: best.guard
      ? `${directionalSide === "PCS" ? "1m close below" : "1m close above"} ${best.guard.label} ${best.guard.price.toFixed(1)} invalidates the defense thesis.`
      : "No structural guard is present between spot and the short strike.",
    reasons: best.reasons,
    blockers: best.blockers,
  };
}

type Evaluated = {
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
  defenses: CreditSpreadDefense[];
  guard: CreditSpreadDefense | null;
  reasons: string[];
  blockers: string[];
};

function evaluateCandidate(args: {
  candidate: ExecutionCandidate;
  side: CreditSpreadPlanSide;
  directional: ZeroDteDirectionalSignal;
  spot: number;
  expectedMove: number;
  anchors: readonly StructureAnchor[];
  structure: ZeroDteStructureSnapshot;
  policy: ZeroDteRiskPolicy;
  distanceFloor: number;
  riskCap: number | null;
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
  const defenses = collectDefenses({
    side: args.side,
    spot: args.spot,
    shortStrike: short,
    anchors: args.anchors,
    structure: args.structure,
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
  if (distance < args.distanceFloor) blockers.push(`Short strike is only ${distance.toFixed(1)} points OTM; policy requires ${args.distanceFloor.toFixed(1)}.`);
  if (delta !== null && delta > args.policy.shortDeltaMax + 0.0001) {
    blockers.push(`Short delta ${delta.toFixed(2)} exceeds the ${args.policy.shortDeltaMax.toFixed(2)} cap.`);
  }
  if (!guard) blockers.push("No support/resistance guard sits between spot and the short strike.");
  else if (!guard.strong) blockers.push("Only a minor FVG guard is present; require an OI/prior/external-swing defense for account-repair mode.");

  const riskPoints = Number.isFinite(maxRisk) ? maxRisk / 100 : NaN;
  const creditToRiskPct = Number.isFinite(credit) && Number.isFinite(riskPoints) && riskPoints > 0
    ? credit / riskPoints
    : NaN;
  if (Number.isFinite(creditToRiskPct) && creditToRiskPct < 0.10) {
    blockers.push(`Credit/risk ${(creditToRiskPct * 100).toFixed(0)}% is below the 10% defensibility floor.`);
  }

  if (guard) reasons.push(`${guard.label} ${guard.price.toFixed(1)} guards the short strike.`);
  reasons.push(`${args.directional.trigger ?? "COMPOSITE"} ${args.side} bias is active at score ${Math.round(args.directional.score)}.`);
  if (delta !== null) reasons.push(`Short delta ${delta.toFixed(2)}; distance ${distance.toFixed(1)} points (${Math.round((distance / args.expectedMove) * 100)}% of EM).`);
  if (Number.isFinite(creditToRiskPct)) reasons.push(`Executable credit/risk ${(creditToRiskPct * 100).toFixed(0)}%.`);

  const defenseBonus = defenses.reduce((sum, item) => sum + (item.strong ? 8 : 3), 0);
  const widthPreference = width >= 10 && width <= 20 ? 8 : width <= 30 ? 3 : -4;
  const deltaPreference = delta === null ? 0 : Math.max(-10, 8 - Math.abs(delta - 0.18) * 50);
  const distancePreference = Math.min(8, Math.max(0, (distance - args.distanceFloor) / 3));
  const rank = args.candidate.score + Math.min(22, defenseBonus) + widthPreference + deltaPreference + distancePreference;

  return {
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
    defenses,
    guard,
    reasons: dedupe(reasons),
    blockers: dedupe(blockers),
  };
}

function collectDefenses(args: {
  side: CreditSpreadPlanSide;
  spot: number;
  shortStrike: number;
  anchors: readonly StructureAnchor[];
  structure: ZeroDteStructureSnapshot;
}): CreditSpreadDefense[] {
  if (!Number.isFinite(args.shortStrike) || !Number.isFinite(args.spot)) return [];
  const low = Math.min(args.spot, args.shortStrike);
  const high = Math.max(args.spot, args.shortStrike);
  const desiredTone = args.side === "PCS" ? "BULL" : "BEAR";
  const results: CreditSpreadDefense[] = [];

  for (const anchor of args.anchors) {
    if (anchor.tone !== desiredTone || anchor.sourceKind === "TRADE") continue;
    if (anchor.price < low - 0.01 || anchor.price > high + 0.01) continue;
    const prior = anchor.sourceKind && ["PRIOR_DAY", "OVERNIGHT", "WEEKLY", "DAILY", "CARRIED_SWING"].includes(anchor.sourceKind);
    results.push({
      label: anchor.label,
      price: anchor.price,
      kind: anchor.sourceKind === "OI" ? "OI" : "PRIOR",
      strong: anchor.sourceKind === "OI" || Boolean(prior),
    });
  }

  const swingKind = args.side === "PCS" ? "LOW" : "HIGH";
  for (const swing of args.structure.swings.filter((item) => item.scale === "EXTERNAL" && item.kind === swingKind).slice(-6)) {
    if (swing.price < low - 0.01 || swing.price > high + 0.01) continue;
    results.push({ label: `External ${swing.label}`, price: swing.price, kind: "SWING", strong: true });
  }

  const fvgDirection = args.side === "PCS" ? "BULL" : "BEAR";
  for (const fvg of args.structure.fvgs.filter((item) => !item.mitigated && item.direction === fvgDirection).slice(-6)) {
    if (fvg.high < low || fvg.low > high) continue;
    results.push({ label: `${fvgDirection} FVG`, price: (fvg.low + fvg.high) / 2, kind: "FVG", strong: false });
  }

  return dedupeDefenses(results).sort((a, b) => Math.abs(a.price - args.spot) - Math.abs(b.price - args.spot));
}

function waitPlan(
  side: CreditSpreadPlanSide | null,
  strategy: "put-credit-spread" | "call-credit-spread" | null,
  blockers: string[],
): DefensibleCreditSpreadPlan {
  return {
    status: "WAIT",
    side,
    strategy,
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
    blockers,
  };
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
