import { strict as assert } from "node:assert";
import {
  buildSpreadEdgeRead,
  resolveMoveTableSample,
  type MoveTableContext,
  type ZeroDteMoveTable,
} from "../src/lib/zeroDteMoveTable";
import { buildDefensibleCreditSpreadPlan } from "../src/lib/zeroDteCreditSpreadPlan";
import { DEFAULT_ZERO_DTE_RISK_POLICY } from "../src/lib/zeroDteRiskPolicy";
import { evaluateZeroDteShadowExit, type ZeroDteShadowTrade } from "../src/lib/zeroDteShadowTrade";

const context: MoveTableContext = {
  timeBucket: "10:30", dayType: "INSIDE_RANGE", gapClass: "FLAT", vixBucket: "15-20", morningTrend: "FLAT",
};
const table: ZeroDteMoveTable = {
  version: 1, generatedAt: "test", sessionCount: 40,
  buckets: [{
    ...context, n: 40,
    upMaxPct: Array(40).fill(0.04),
    downMaxPct: Array(40).fill(0.04),
    closeMovePct: Array(40).fill(0.01),
  }],
};

// Phase 1: hand-computable EV.
const edge = buildSpreadEdgeRead({ side: "CCS", shortStrike: 110, longStrike: 115, credit: 2, spot: 100, shortDeltaAbs: 0.16, table, context });
assert(edge);
assert.equal(edge.histProbTouch, 0);
assert.equal(edge.histProbItmAtClose, 0);
assert.equal(edge.histExpectedLossPoints, 0);
assert.equal(edge.evPerLotDollars, 200);
assert.equal(Math.round(edge.edgePts!), 16);
assert.equal(edge.sample.n, 40);

// Fallback order: dropping morning trend still finds the sample.
const fallback = resolveMoveTableSample(table, { ...context, morningTrend: "UP_GT_0_5" });
assert(fallback);
assert.equal(fallback.n, 40);
assert(fallback.keyUsed.includes("trend=*"));

const policy = {
  ...DEFAULT_ZERO_DTE_RISK_POLICY,
  minimumAbsoluteDistancePoints: 5,
  minimumAbsoluteDistanceSpotPct: 0,
  minWidth: 5,
  maxWidth: 20,
  eventRisk: "NORMAL" as const,
  eventRiskMode: "NORMAL" as const,
};
const waitDirectional: any = {
  action: "WAIT", strategy: null, score: 40, bullishScore: 40, bearishScore: 35,
  trigger: null, gates: { bullVeto: false, bearVeto: false },
};
const emptyStructure: any = {
  generatedAt: 10, trendInternal: null, trendExternal: null, swings: [], breaks: [], sweeps: [], fvgs: [], reactionZones: [], reversals: [], fibLevels: [],
};
const putCandidate: any = {
  strategy: "put-credit-spread", eligible: true, blockers: [], score: 60,
  legs: [{ action: "sell", optionType: "put", strike: 90 }, { action: "buy", optionType: "put", strike: 85 }],
  sellableCredit: 2, estimatedCredit: 2, maxRiskDollars: 300, shortDeltaAbs: 0.12,
};
const callCandidate: any = {
  strategy: "call-credit-spread", eligible: true, blockers: [], score: 60,
  legs: [{ action: "sell", optionType: "call", strike: 110 }, { action: "buy", optionType: "call", strike: 115 }],
  sellableCredit: 2, estimatedCredit: 2, maxRiskDollars: 300, shortDeltaAbs: 0.12,
};
const anchors: any[] = [
  { id: "put-wall", label: "PUT WALL", price: 95, tone: "BULL", sourceKind: "OI" },
  { id: "call-wall", label: "CALL WALL", price: 105, tone: "BEAR", sourceKind: "OI" },
];
const baseArgs: any = {
  directional: waitDirectional, spot: 100, expectedMove: 20, anchors, structure: emptyStructure,
  candles: [{ time: 1, open: 100, high: 100, low: 100, close: 100 }], policy, moveTable: table, moveTableContext: context,
  generatedAt: "2026-10-19T16:00:00.000Z", openingPriorContext: null, vixChangePct: 0, macroEvent: null,
};

// Phase 2: directional WAIT no longer prevents a defended, positive-EV spread.
let plan = buildDefensibleCreditSpreadPlan({ ...baseArgs, candidates: [putCandidate], gammaFlip: 95 });
assert.equal(plan.status, "READY");
assert.equal(plan.side, "PCS");

// Fresh bearish continuation veto blocks PCS.
plan = buildDefensibleCreditSpreadPlan({ ...baseArgs, directional: { ...waitDirectional, gates: { bullVeto: true, bearVeto: false } }, candidates: [putCandidate], gammaFlip: 95 });
assert.equal(plan.status, "WAIT");
assert(plan.blockers.some((value: string) => value.includes("bearish BOS")));

// Both sides ready in positive gamma -> paired.
plan = buildDefensibleCreditSpreadPlan({ ...baseArgs, candidates: [putCandidate, callCandidate], gammaFlip: 95 });
assert.equal(plan.status, "PAIRED");
assert(plan.paired);

// Event-risk veto.
plan = buildDefensibleCreditSpreadPlan({ ...baseArgs, policy: { ...policy, eventRisk: "HIGH", eventRiskMode: "HIGH" }, candidates: [putCandidate], gammaFlip: 95 });
assert.equal(plan.status, "NO_TRADE_DAY");

// Phase 4: same fixed policy exits drive paper trading.
const shadow = {
  state: "open", strategy: "put-credit-spread", entrySellableCredit: 2,
  currentBuybackDebit: 0.9, planTakeProfitPct: 0.5, planStopCreditMultiple: 2,
  maxFavorableExcursionDollars: 0, legs: [{ action: "sell", optionType: "put", strike: 90 }, { action: "buy", optionType: "put", strike: 85 }],
} as unknown as ZeroDteShadowTrade;
assert.equal(evaluateZeroDteShadowExit(shadow).reason, "TAKE_PROFIT");

console.log("credit-spread edge tests: PASS");

// Phase 1 table builder: keys use only information available at the entry time,
// while future candles affect the outcome distribution but not the conditioning key.
function t(iso: string) { return Math.floor(Date.parse(iso) / 1000); }
function c(iso: string, open: number, high: number, low: number, close: number): any {
  return { time: t(iso), open, high, low, close, volume: null };
}
const priorSession = {
  tradeDate: "2026-10-16",
  priorVixClose: 18,
  candles: [
    c("2026-10-16T08:30:00-05:00", 100, 101, 99, 100),
    c("2026-10-16T15:00:00-05:00", 100, 102, 98, 100),
  ],
};
const currentA = {
  tradeDate: "2026-10-19",
  priorVixClose: 18,
  candles: [
    c("2026-10-19T08:30:00-05:00", 100, 100.2, 99.8, 100),
    c("2026-10-19T09:00:00-05:00", 100, 100.2, 99.8, 100),
    c("2026-10-19T09:30:00-05:00", 100, 100.2, 99.8, 100),
    c("2026-10-19T10:00:00-05:00", 100, 100.2, 99.8, 100),
    c("2026-10-19T10:30:00-05:00", 100, 100.5, 99.5, 100),
    c("2026-10-19T11:00:00-05:00", 100, 101, 99, 100),
    c("2026-10-19T12:00:00-05:00", 100, 104, 97, 103),
    c("2026-10-19T15:00:00-05:00", 103, 105, 96, 102),
  ],
};
const currentB = {
  ...currentA,
  candles: currentA.candles.map((row: any, i: number) => i < 5 ? row : ({ ...row, high: row.high + 20, low: row.low - 20, close: row.close + 5 })),
};
const builtA = require("../src/lib/zeroDteMoveTable") as typeof import("../src/lib/zeroDteMoveTable");
const tableA = builtA.buildMoveTableFromSessions([priorSession as any, currentA as any]);
const tableB = builtA.buildMoveTableFromSessions([priorSession as any, currentB as any]);
const keyA = tableA.buckets.find((b: any) => b.timeBucket === "10:30");
const keyB = tableB.buckets.find((b: any) => b.timeBucket === "10:30");
assert(keyA && keyB);
assert.equal(keyA.dayType, keyB.dayType);
assert.equal(keyA.gapClass, keyB.gapClass);
assert.equal(keyA.vixBucket, keyB.vixBucket);
assert.equal(keyA.morningTrend, keyB.morningTrend);
assert.notEqual(keyA.upMaxPct[0], keyB.upMaxPct[0]);
assert(Math.abs(keyA.upMaxPct[0] - 0.05) < 1e-9);
assert(Math.abs(keyA.downMaxPct[0] - 0.04) < 1e-9);
assert(Math.abs(keyA.closeMovePct[0] - 0.02) < 1e-9);

// Merge support for the post-close append job retains sorted empirical arrays.
const merged = builtA.mergeZeroDteMoveTables(tableA, tableB);
const merged1030 = merged.buckets.find((b: any) => b.timeBucket === "10:30");
assert(merged1030);
assert.equal(merged1030.n, 2);
assert(merged1030.upMaxPct[0] <= merged1030.upMaxPct[1]);

console.log("move-table builder/no-lookahead tests: PASS");
