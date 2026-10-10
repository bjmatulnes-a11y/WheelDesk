import { describe, expect, it } from "vitest";
import {
  advanceDirectionalLatch,
  aggregateStructureCandles,
  buildZeroDteDirectionalSignal,
  combineScores,
  emptyDirectionalLatch,
  scoreExecutionAdjustment,
  type ZeroDteDirectionalSignal,
} from "../zeroDteDirectionalSignal";
import {
  buildLiquiditySweeps,
  type StructureCandle,
  type StructureSwing,
  type ZeroDteStructureSnapshot,
} from "../zeroDteStructureMap";

function candle(time: number, open: number, high: number, low: number, close: number): StructureCandle {
  return { time, open, high, low, close, volume: null };
}

function rawSignal(overrides: Partial<ZeroDteDirectionalSignal> = {}): ZeroDteDirectionalSignal {
  return {
    action: "BUY",
    strategy: "PCS",
    score: 75,
    bullishScore: 75,
    bearishScore: 30,
    margin: 45,
    threshold: 74,
    requiredMargin: 14,
    generatedAt: 60,
    currentPrice: 100,
    state: "TREND",
    structureConfirmed: true,
    reasons: [],
    blockers: [],
    gates: {
      bullConfirmed: true,
      bearConfirmed: false,
      bullVeto: false,
      bearVeto: false,
      bullExternalBosVeto: false,
      bearExternalBosVeto: false,
      transition: false,
      higherExternalTrend: "BULL",
    },
    groups: {
      structureBull: 55,
      structureBear: 20,
      marketBull: 70,
      marketBear: 20,
      executionBull: 0,
      executionBear: 0,
    },
    ...overrides,
  };
}

describe("WheelDesk directional decision fixes", () => {
  it("does not record a sweep after the level already closed through", () => {
    const candles = [
      candle(0, 99, 100, 98, 99.5),
      candle(60, 99.5, 100.2, 99, 99.8),
      candle(120, 99.8, 100.1, 99.2, 99.6),
      candle(180, 99.6, 101.8, 99.5, 101.5), // BOS through 100
      candle(240, 101.5, 101.7, 100.4, 100.8),
      candle(300, 100.8, 101.2, 99.1, 99.4), // failed retest, not a sweep
    ];
    const swings: StructureSwing[] = [{
      id: "H",
      scale: "INTERNAL",
      kind: "HIGH",
      label: "HH",
      time: 0,
      confirmedAt: 120,
      price: 100,
      index: 0,
      confirmIndex: 2,
    }];
    expect(buildLiquiditySweeps(candles, swings)).toEqual([]);
  });

  it("records one clean downside sweep and dedupes internal/external at the same price", () => {
    const candles = [
      candle(0, 101, 102, 100, 101),
      candle(60, 101, 101.5, 99.2, 100.4),
      candle(120, 100.4, 101, 98.8, 100.2),
      candle(180, 100.2, 101.1, 97.8, 100.5),
    ];
    const base = {
      kind: "LOW" as const,
      label: "LL" as const,
      time: 0,
      confirmedAt: 120,
      price: 99,
      index: 0,
      confirmIndex: 2,
    };
    const sweeps = buildLiquiditySweeps(candles, [
      { ...base, id: "I", scale: "INTERNAL" },
      { ...base, id: "E", scale: "EXTERNAL" },
    ]);
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0].direction).toBe("BULL");
    expect(sweeps[0].scale).toBe("EXTERNAL");
  });

  it("keeps an ordinary unarmed execution read score-neutral", () => {
    const base = combineScores(58, 71, null);
    const adjustment = scoreExecutionAdjustment({
      candidate: {} as any,
      entryHardBlocked: false,
      lifecycle: "WAIT",
      priceRejectionReady: false,
    } as any);
    expect(adjustment).toBe(0);
    expect(combineScores(58, 71, adjustment)).toBe(base);
  });

  it("market inputs alone cannot bypass the structure gate", () => {
    const candles = Array.from({ length: 30 }, (_, i) => candle(i * 60, 100, 101, 99, 100));
    const empty: ZeroDteStructureSnapshot = {
      generatedAt: candles.at(-1)?.time ?? null,
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
    const result = buildZeroDteDirectionalSignal({
      candles,
      structure: empty,
      higherTimeframeStructure: empty,
      recommendation: {
        spxPrice: 100,
        expectedMove: 20,
        dealerPressure: 70,
        spx: { strongestPin: 110, callWall: null, putWall: 100 },
      } as any,
      mood: {
        directionalBias: "bullish",
        confidence: 100,
        coverageScore: 100,
      } as any,
      leastResistancePath: {
        direction: "UP",
        confidence: 100,
        routeSeparationScore: 100,
      } as any,
      executionReads: [],
    });
    expect(result.action).toBe("WAIT");
    expect(result.blockers.some((item) => item.includes("Structure has not confirmed"))).toBe(true);
  });

  it("holds a BULL latch through small threshold oscillations", () => {
    let state = emptyDirectionalLatch();
    const scores = [75, 73, 75, 73, 75];
    const sides: string[] = [];
    scores.forEach((score, index) => {
      const step = advanceDirectionalLatch(
        state,
        rawSignal({ bullishScore: score, score }),
        (index + 1) * 60,
      );
      state = step.state;
      sides.push(state.side);
    });
    expect(sides).toEqual(["BULL", "BULL", "BULL", "BULL", "BULL"]);
  });

  it("drops a partial final 5-minute bucket", () => {
    const candles = Array.from({ length: 7 }, (_, index) =>
      candle(index * 60, 100 + index, 101 + index, 99 + index, 100.5 + index),
    );
    const aggregated = aggregateStructureCandles(candles, 5);
    expect(aggregated).toHaveLength(1);
    expect(aggregated[0].time).toBe(0);
  });
});
