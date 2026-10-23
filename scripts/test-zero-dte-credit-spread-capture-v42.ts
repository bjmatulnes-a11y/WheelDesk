import { strict as assert } from "node:assert";
import { buildDefensibleCreditSpreadPlan } from "../src/lib/zeroDteCreditSpreadPlan";
import { DEFAULT_ZERO_DTE_RISK_POLICY } from "../src/lib/zeroDteRiskPolicy";
import type { MoveTableContext, ZeroDteMoveTable } from "../src/lib/zeroDteMoveTable";

const context: MoveTableContext = {
  timeBucket: "10:30",
  dayType: "INSIDE_RANGE",
  gapClass: "FLAT",
  vixBucket: "15-20",
  morningTrend: "FLAT",
};
function table(n: number): ZeroDteMoveTable {
  return {
    version: 1,
    generatedAt: "test",
    sessionCount: n,
    buckets: [{
      ...context,
      n,
      upMaxPct: Array(n).fill(0.04),
      downMaxPct: Array(n).fill(0.04),
      closeMovePct: Array(n).fill(0.01),
    }],
  };
}
const policy = {
  ...DEFAULT_ZERO_DTE_RISK_POLICY,
  minimumAbsoluteDistancePoints: 5,
  minimumAbsoluteDistanceSpotPct: 0,
  minWidth: 5,
  maxWidth: 20,
  eventRisk: "NORMAL" as const,
  eventRiskMode: "NORMAL" as const,
};
const directional: any = {
  action: "WAIT",
  strategy: null,
  score: 40,
  bullishScore: 40,
  bearishScore: 35,
  trigger: null,
  gates: { bullVeto: false, bearVeto: false },
};
const emptyStructure: any = {
  generatedAt: 10,
  trendInternal: null,
  trendExternal: null,
  swings: [],
  breaks: [],
  sweeps: [],
  fvgs: [],
  reactionZones: [],
  reversals: [],
  fibLevels: [],
};
const putCandidate: any = {
  strategy: "put-credit-spread",
  eligible: true,
  blockers: [],
  score: 60,
  legs: [{ action: "sell", optionType: "put", strike: 90 }, { action: "buy", optionType: "put", strike: 85 }],
  sellableCredit: 2,
  estimatedCredit: 2,
  maxRiskDollars: 300,
  shortDeltaAbs: 0.12,
};
const callCandidate: any = {
  strategy: "call-credit-spread",
  eligible: true,
  blockers: [],
  score: 60,
  legs: [{ action: "sell", optionType: "call", strike: 110 }, { action: "buy", optionType: "call", strike: 115 }],
  sellableCredit: 2,
  estimatedCredit: 2,
  maxRiskDollars: 300,
  shortDeltaAbs: 0.12,
};
const anchors: any[] = [
  { id: "put-wall", label: "PUT WALL", price: 95, tone: "BULL", sourceKind: "OI" },
  { id: "call-wall", label: "CALL WALL", price: 105, tone: "BEAR", sourceKind: "OI" },
];
const candles: any[] = Array.from({ length: 6 }, (_, i) => ({
  time: i + 1,
  open: 100,
  high: 101,
  low: 99,
  close: 100,
}));
const base: any = {
  directional,
  spot: 100,
  expectedMove: 20,
  candidates: [],
  anchors,
  structure: emptyStructure,
  candles,
  policy,
  moveTableContext: context,
  generatedAt: "2026-10-22T16:30:00.000Z",
  openingPriorContext: null,
  vixChangePct: 0,
  macroEvent: null,
};

const bearContinuation: any = {
  ...emptyStructure,
  trendInternal: "BEAR",
  trendExternal: "BEAR",
  swings: [
    { id: "lh1", scale: "INTERNAL", kind: "HIGH", label: "LH", time: 3, confirmedAt: 4, price: 104, index: 2, confirmIndex: 3 },
  ],
  breaks: [
    { id: "b1", scale: "INTERNAL", kind: "BOS", direction: "BEAR", level: 105, swingTime: 1, breakTime: 2, breakIndex: 1 },
    { id: "b2", scale: "INTERNAL", kind: "BOS", direction: "BEAR", level: 102, swingTime: 3, breakTime: 5, breakIndex: 4 },
  ],
};
let plan = buildDefensibleCreditSpreadPlan({
  ...base,
  structure: bearContinuation,
  candidates: [callCandidate],
  moveTable: table(20),
  gammaFlip: 105,
});
assert.equal(plan.status, "READY");
assert.equal(plan.side, "CCS");
assert.equal(plan.entryTrigger, "STRUCTURE_CONTINUATION");
assert.equal(plan.primary?.riskSizeMultiplier, 0.5);
assert(plan.reasons.some((r: string) => r.includes("Thin history")));

plan = buildDefensibleCreditSpreadPlan({
  ...base,
  candidates: [callCandidate],
  moveTable: table(20),
  gammaFlip: 105,
});
assert.equal(plan.status, "WAIT");
assert(plan.blockers.some((r: string) => r.includes("Not enough history")));

const bullReversal: any = {
  ...emptyStructure,
  trendInternal: "BULL",
  breaks: [
    { id: "c1", scale: "INTERNAL", kind: "CHOCH", direction: "BULL", level: 96, swingTime: 1, breakTime: 3, breakIndex: 2 },
    { id: "c2", scale: "INTERNAL", kind: "BOS", direction: "BULL", level: 98, swingTime: 2, breakTime: 5, breakIndex: 4 },
  ],
};
plan = buildDefensibleCreditSpreadPlan({
  ...base,
  structure: bullReversal,
  candidates: [putCandidate],
  moveTable: table(20),
  gammaFlip: 105,
});
assert.equal(plan.status, "READY");
assert.equal(plan.side, "PCS");
assert.equal(plan.entryTrigger, "STRUCTURE_REVERSAL");
assert.equal(plan.primary?.riskSizeMultiplier, 0.5);

plan = buildDefensibleCreditSpreadPlan({
  ...base,
  structure: bearContinuation,
  candidates: [putCandidate, callCandidate],
  moveTable: table(40),
  gammaFlip: 95,
});
assert.equal(plan.status, "READY");
assert.equal(plan.side, "CCS");
assert.equal(plan.entryTrigger, "STRUCTURE_CONTINUATION");

console.log("v4.2 structure capture tests: PASS");
