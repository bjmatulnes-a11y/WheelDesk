import { describe, expect, it } from "vitest";
import {
  advanceDirectionalLatch,
  aggregateStructureCandles,
  buildZeroDteDirectionalSignal,
  combineScores,
  detectDirectionalReversalCapture,
  detectDirectionalContinuationCapture,
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
    trigger: "COMPOSITE",
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
      bullReversalCapture: false,
      bearReversalCapture: false,
      bullContinuationCapture: false,
      bearContinuationCapture: false,
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

  it("fires an early BULL reversal capture on CHoCH -> BOS + HL + bull FVG", () => {
    const candles = Array.from({ length: 12 }, (_, i) =>
      candle(i * 60, 100 + i * 0.2, 101 + i * 0.2, 99 + i * 0.2, 100.4 + i * 0.2),
    );
    const snapshot: ZeroDteStructureSnapshot = {
      generatedAt: candles.at(-1)?.time ?? null,
      trendInternal: "BULL",
      trendExternal: "BEAR",
      swings: [{
        id: "hl",
        scale: "INTERNAL",
        kind: "LOW",
        label: "HL",
        time: 7 * 60,
        confirmedAt: 9 * 60,
        price: 100.2,
        index: 7,
        confirmIndex: 9,
      }],
      breaks: [
        { id: "down", scale: "EXTERNAL", kind: "BOS", direction: "BEAR", level: 101, swingTime: 120, breakTime: 5 * 60, breakIndex: 5 },
        { id: "choch", scale: "INTERNAL", kind: "CHOCH", direction: "BULL", level: 101.4, swingTime: 6 * 60, breakTime: 8 * 60, breakIndex: 8 },
        { id: "bos", scale: "INTERNAL", kind: "BOS", direction: "BULL", level: 102, swingTime: 7 * 60, breakTime: 10 * 60, breakIndex: 10 },
      ],
      sweeps: [],
      fvgs: [{
        id: "fvg",
        direction: "BULL",
        low: 101.2,
        high: 101.8,
        startedAt: 9 * 60,
        startIndex: 9,
        mitigated: false,
        mitigatedAt: null,
        mitigationIndex: null,
      }],
      reactionZones: [],
      reversals: [],
      fibLevels: [],
    };
    const read = detectDirectionalReversalCapture({
      candles,
      snapshot,
      currentPrice: 102.6,
      expectedMove: 20,
      direction: "BULL",
      leastResistancePath: null,
    });
    expect(read.qualified).toBe(true);
    expect(read.confirmations).toContain("HL confirmed");
    expect(read.confirmations).toContain("Bull FVG holding");

    const signal = buildZeroDteDirectionalSignal({
      candles,
      structure: snapshot,
      higherTimeframeStructure: null,
      recommendation: {
        spxPrice: 102.6,
        expectedMove: 20,
        dealerPressure: 0,
        spx: { strongestPin: null, callWall: null, putWall: null },
      } as any,
      leastResistancePath: null,
      executionReads: [],
    });
    expect(signal.score).toBeLessThan(74);
    expect(signal.action).toBe("BUY");
    expect(signal.strategy).toBe("PCS");
    expect(signal.trigger).toBe("REVERSAL_CAPTURE");

    const chased = detectDirectionalReversalCapture({
      candles,
      snapshot,
      currentPrice: 110,
      expectedMove: 20,
      direction: "BULL",
      leastResistancePath: null,
    });
    expect(chased.qualified).toBe(false);
    expect(chased.blocker).toContain("too extended");
  });

  it("fires the mirrored BEAR reversal capture on CHoCH -> BOS + LH + bear FVG", () => {
    const candles = Array.from({ length: 12 }, (_, i) =>
      candle(i * 60, 110 - i * 0.2, 111 - i * 0.2, 109 - i * 0.2, 109.6 - i * 0.2),
    );
    const snapshot: ZeroDteStructureSnapshot = {
      generatedAt: candles.at(-1)?.time ?? null,
      trendInternal: "BEAR",
      trendExternal: "BULL",
      swings: [{
        id: "lh",
        scale: "INTERNAL",
        kind: "HIGH",
        label: "LH",
        time: 7 * 60,
        confirmedAt: 9 * 60,
        price: 109.8,
        index: 7,
        confirmIndex: 9,
      }],
      breaks: [
        { id: "up", scale: "EXTERNAL", kind: "BOS", direction: "BULL", level: 109, swingTime: 120, breakTime: 5 * 60, breakIndex: 5 },
        { id: "choch", scale: "INTERNAL", kind: "CHOCH", direction: "BEAR", level: 108.6, swingTime: 6 * 60, breakTime: 8 * 60, breakIndex: 8 },
        { id: "bos", scale: "INTERNAL", kind: "BOS", direction: "BEAR", level: 108, swingTime: 7 * 60, breakTime: 10 * 60, breakIndex: 10 },
      ],
      sweeps: [],
      fvgs: [{
        id: "fvg",
        direction: "BEAR",
        low: 108.2,
        high: 108.8,
        startedAt: 9 * 60,
        startIndex: 9,
        mitigated: false,
        mitigatedAt: null,
        mitigationIndex: null,
      }],
      reactionZones: [],
      reversals: [],
      fibLevels: [],
    };
    const read = detectDirectionalReversalCapture({
      candles,
      snapshot,
      currentPrice: 107.4,
      expectedMove: 20,
      direction: "BEAR",
      leastResistancePath: null,
    });
    expect(read.qualified).toBe(true);
    expect(read.confirmations).toContain("LH confirmed");
    expect(read.confirmations).toContain("Bear FVG holding");

    const signal = buildZeroDteDirectionalSignal({
      candles,
      structure: snapshot,
      higherTimeframeStructure: null,
      recommendation: {
        spxPrice: 107.4,
        expectedMove: 20,
        dealerPressure: 0,
        spx: { strongestPin: null, callWall: null, putWall: null },
      } as any,
      leastResistancePath: null,
      executionReads: [],
    });
    expect(signal.score).toBeLessThan(74);
    expect(signal.action).toBe("SELL");
    expect(signal.strategy).toBe("CCS");
    expect(signal.trigger).toBe("REVERSAL_CAPTURE");
  });

  it("fires an early BEAR continuation capture on prior BOS -> LH -> fresh BOS + bear FVG", () => {
    const candles = Array.from({ length: 14 }, (_, i) =>
      candle(i * 60, 110 - i * 0.15, 111 - i * 0.15, 109 - i * 0.15, 109.7 - i * 0.15),
    );
    const snapshot: ZeroDteStructureSnapshot = {
      generatedAt: candles.at(-1)?.time ?? null,
      trendInternal: "BEAR",
      trendExternal: "BEAR",
      swings: [{
        id: "lh-cont",
        scale: "INTERNAL",
        kind: "HIGH",
        label: "LH",
        time: 7 * 60,
        confirmedAt: 9 * 60,
        price: 108.9,
        index: 7,
        confirmIndex: 9,
      }],
      breaks: [
        { id: "bos-1", scale: "INTERNAL", kind: "BOS", direction: "BEAR", level: 109.2, swingTime: 2 * 60, breakTime: 5 * 60, breakIndex: 5 },
        { id: "choch-pull", scale: "INTERNAL", kind: "CHOCH", direction: "BULL", level: 108.7, swingTime: 6 * 60, breakTime: 8 * 60, breakIndex: 8 },
        { id: "bos-2", scale: "INTERNAL", kind: "BOS", direction: "BEAR", level: 108.0, swingTime: 8 * 60, breakTime: 11 * 60, breakIndex: 11 },
      ],
      sweeps: [],
      fvgs: [{
        id: "bear-cont-fvg",
        direction: "BEAR",
        low: 108.3,
        high: 108.8,
        startedAt: 9 * 60,
        startIndex: 9,
        mitigated: false,
        mitigatedAt: null,
        mitigationIndex: null,
      }],
      reactionZones: [],
      reversals: [],
      fibLevels: [],
    };

    const read = detectDirectionalContinuationCapture({
      candles,
      snapshot,
      currentPrice: 107.4,
      expectedMove: 20,
      direction: "BEAR",
      leastResistancePath: null,
    });
    expect(read.qualified).toBe(true);
    expect(read.confirmations).toContain("LH pullback confirmed");
    expect(read.confirmations.some((item) => item.includes("Bear FVG"))).toBe(true);

    const signal = buildZeroDteDirectionalSignal({
      candles,
      structure: snapshot,
      higherTimeframeStructure: null,
      recommendation: {
        spxPrice: 107.4,
        expectedMove: 20,
        dealerPressure: 0,
        spx: { strongestPin: null, callWall: null, putWall: null },
      } as any,
      leastResistancePath: null,
      executionReads: [],
    });
    expect(signal.score).toBeLessThan(signal.threshold);
    expect(signal.action).toBe("SELL");
    expect(signal.strategy).toBe("CCS");
    expect(signal.trigger).toBe("CONTINUATION_CAPTURE");
  });

  it("fires the mirrored BULL continuation capture on prior BOS -> HL -> fresh BOS + bull FVG", () => {
    const candles = Array.from({ length: 14 }, (_, i) =>
      candle(i * 60, 100 + i * 0.15, 101 + i * 0.15, 99 + i * 0.15, 100.3 + i * 0.15),
    );
    const snapshot: ZeroDteStructureSnapshot = {
      generatedAt: candles.at(-1)?.time ?? null,
      trendInternal: "BULL",
      trendExternal: "BULL",
      swings: [{
        id: "hl-cont",
        scale: "INTERNAL",
        kind: "LOW",
        label: "HL",
        time: 7 * 60,
        confirmedAt: 9 * 60,
        price: 101.1,
        index: 7,
        confirmIndex: 9,
      }],
      breaks: [
        { id: "bos-1", scale: "INTERNAL", kind: "BOS", direction: "BULL", level: 100.8, swingTime: 2 * 60, breakTime: 5 * 60, breakIndex: 5 },
        { id: "choch-pull", scale: "INTERNAL", kind: "CHOCH", direction: "BEAR", level: 101.3, swingTime: 6 * 60, breakTime: 8 * 60, breakIndex: 8 },
        { id: "bos-2", scale: "INTERNAL", kind: "BOS", direction: "BULL", level: 102.0, swingTime: 8 * 60, breakTime: 11 * 60, breakIndex: 11 },
      ],
      sweeps: [],
      fvgs: [{
        id: "bull-cont-fvg",
        direction: "BULL",
        low: 101.2,
        high: 101.7,
        startedAt: 9 * 60,
        startIndex: 9,
        mitigated: false,
        mitigatedAt: null,
        mitigationIndex: null,
      }],
      reactionZones: [],
      reversals: [],
      fibLevels: [],
    };

    const read = detectDirectionalContinuationCapture({
      candles,
      snapshot,
      currentPrice: 102.6,
      expectedMove: 20,
      direction: "BULL",
      leastResistancePath: null,
    });
    expect(read.qualified).toBe(true);
    expect(read.confirmations).toContain("HL pullback confirmed");

    const signal = buildZeroDteDirectionalSignal({
      candles,
      structure: snapshot,
      higherTimeframeStructure: null,
      recommendation: {
        spxPrice: 102.6,
        expectedMove: 20,
        dealerPressure: 0,
        spx: { strongestPin: null, callWall: null, putWall: null },
      } as any,
      leastResistancePath: null,
      executionReads: [],
    });
    expect(signal.score).toBeLessThan(signal.threshold);
    expect(signal.action).toBe("BUY");
    expect(signal.strategy).toBe("PCS");
    expect(signal.trigger).toBe("CONTINUATION_CAPTURE");
  });

  it("does not fire continuation without the HL/LH pullback", () => {
    const candles = Array.from({ length: 12 }, (_, i) =>
      candle(i * 60, 110 - i * 0.15, 111 - i * 0.15, 109 - i * 0.15, 109.7 - i * 0.15),
    );
    const snapshot: ZeroDteStructureSnapshot = {
      generatedAt: candles.at(-1)?.time ?? null,
      trendInternal: "BEAR",
      trendExternal: "BEAR",
      swings: [],
      breaks: [
        { id: "bos-a", scale: "INTERNAL", kind: "BOS", direction: "BEAR", level: 109, swingTime: 60, breakTime: 4 * 60, breakIndex: 4 },
        { id: "bos-b", scale: "INTERNAL", kind: "BOS", direction: "BEAR", level: 108, swingTime: 6 * 60, breakTime: 10 * 60, breakIndex: 10 },
      ],
      sweeps: [], fvgs: [], reactionZones: [], reversals: [], fibLevels: [],
    };
    const read = detectDirectionalContinuationCapture({
      candles, snapshot, currentPrice: 107.6, expectedMove: 20, direction: "BEAR", leastResistancePath: null,
    });
    expect(read.qualified).toBe(false);
    expect(read.blocker).toContain("LH pullback");
  });

  it("blocks a continuation arrow after the fresh BOS has already run too far", () => {
    const candles = Array.from({ length: 14 }, (_, i) =>
      candle(i * 60, 110 - i * 0.15, 111 - i * 0.15, 109 - i * 0.15, 109.7 - i * 0.15),
    );
    const snapshot: ZeroDteStructureSnapshot = {
      generatedAt: candles.at(-1)?.time ?? null,
      trendInternal: "BEAR", trendExternal: "BEAR",
      swings: [{ id: "lh", scale: "INTERNAL", kind: "HIGH", label: "LH", time: 7 * 60, confirmedAt: 9 * 60, price: 109, index: 7, confirmIndex: 9 }],
      breaks: [
        { id: "bos-a", scale: "INTERNAL", kind: "BOS", direction: "BEAR", level: 109, swingTime: 60, breakTime: 5 * 60, breakIndex: 5 },
        { id: "bos-b", scale: "INTERNAL", kind: "BOS", direction: "BEAR", level: 108, swingTime: 7 * 60, breakTime: 11 * 60, breakIndex: 11 },
      ],
      sweeps: [],
      fvgs: [{ id: "f", direction: "BEAR", low: 108.2, high: 108.8, startedAt: 9 * 60, startIndex: 9, mitigated: false, mitigatedAt: null, mitigationIndex: null }],
      reactionZones: [], reversals: [], fibLevels: [],
    };
    const read = detectDirectionalContinuationCapture({
      candles, snapshot, currentPrice: 100, expectedMove: 20, direction: "BEAR", leastResistancePath: null,
    });
    expect(read.qualified).toBe(false);
    expect(read.blocker).toContain("too extended");
  });

});
