import { describe, expect, it } from "vitest";
import {
  computeDailyStructure,
  computeOpeningPriorContext,
  computeOvernightLevels,
  computePriorCashSession,
  dailyFlipInPlay,
  filterActiveCarriedLevels,
  previousTradingSessionDate,
  priorStructureFetchKey,
  zonedDateTimeToEpochMs,
  type PriorStructureLevel,
} from "../zeroDtePriorStructure";
import {
  buildStructureAnchorConfluence,
  type StructureCandle,
  type ZeroDteStructureSnapshot,
} from "../zeroDteStructureMap";

function candle(
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
): StructureCandle {
  return { time, open, high, low, close, volume: null };
}

function atCt(date: string, hour: number, minute: number): number {
  return Math.floor(zonedDateTimeToEpochMs(date, hour, minute) / 1000);
}

const emptySnapshot: ZeroDteStructureSnapshot = {
  generatedAt: null,
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

describe("WheelDesk prior-session & higher-timeframe structure", () => {
  it("resolves the prior real session across weekends and holidays", () => {
    expect(previousTradingSessionDate("2026-10-12")).toBe("2026-10-09"); // Monday -> Friday
    expect(previousTradingSessionDate("2026-11-27")).toBe("2026-11-25"); // day after Thanksgiving -> Wed
  });

  it("computes prior cash OHLC and excludes candles after 15:00 CT", () => {
    const date = "2026-10-08";
    const candles = [
      candle(atCt(date, 8, 30), 100, 102, 99, 101),
      candle(atCt(date, 8, 31), 101, 105, 100, 104),
      candle(atCt(date, 14, 59), 104, 106, 98, 103),
      candle(atCt(date, 15, 0), 103, 104, 101, 102.5),
      candle(atCt(date, 15, 5), 102.5, 120, 80, 119),
    ];
    const result = computePriorCashSession({ candles, priorSessionDate: date });
    expect(result.open).toBe(100);
    expect(result.high).toBe(106);
    expect(result.low).toBe(98);
    expect(result.close).toBe(102.5);
    expect(result.candles).toHaveLength(4);
  });

  it("projects overnight ES levels with basis and marks low coverage approximate", () => {
    const prior = "2026-10-08";
    const trade = "2026-10-09";
    const levels = computeOvernightLevels({
      esCandles: [
        candle(atCt(prior, 15, 15), 7840, 7850, 7838, 7848),
        candle(atCt(trade, 8, 29), 7845, 7848, 7835, 7840),
      ],
      priorSessionDate: prior,
      tradeDate: trade,
      basisMedian: 28.5,
      basisCoveragePct: 49,
    });
    const onh = levels.find((level) => level.id === "ONH");
    expect(onh?.price).toBeCloseTo(7821.5, 6);
    expect(onh?.approximate).toBe(true);
    expect(levels.find((level) => level.id === "ONL")?.price).toBeCloseTo(7806.5, 6);
  });

  it("removes a carried FVG as soon as today's price trades into it", () => {
    const level: PriorStructureLevel = {
      id: "PD_FVG_BULL_1",
      label: "PD bull FVG",
      price: 100.5,
      low: 100,
      high: 101,
      kind: "CARRIED_FVG",
    };
    const untouched = filterActiveCarriedLevels(
      [level],
      [candle(1, 103, 104, 102, 103)],
    );
    expect(untouched).toHaveLength(1);

    const touched = filterActiveCarriedLevels(
      [level],
      [candle(1, 103, 104, 100.8, 101.5)],
    );
    expect(touched).toHaveLength(0);
  });

  it("classifies a large outside-up gap and detects a return into the prior range", () => {
    const levels: PriorStructureLevel[] = [
      { id: "PDH", label: "PDH", price: 105, kind: "PRIOR_DAY" },
      { id: "PDL", label: "PDL", price: 95, kind: "PRIOR_DAY" },
      { id: "PDC", label: "PDC", price: 100, kind: "PRIOR_DAY" },
    ];
    const today = [
      candle(1, 106, 107, 105.5, 106.5),
      candle(2, 106.5, 107, 103.5, 104),
    ];
    const context = computeOpeningPriorContext({ todayCandles: today, levels, expectedMove: 10 });
    expect(context?.openingDayType).toBe("OUTSIDE_UP");
    expect(context?.gapVsExpectedMove).toBeCloseTo(0.6, 6);
    expect(context?.gapClass).toBe("LARGE");
    expect(context?.regainedPriorRange).toBe(true);
    expect(context?.tag).toContain("Failed gap");
  });

  it("uses the last external swing low as the BULL daily flip and applies the 1x EM rule", () => {
    const values = [
      [99, 101, 98, 100],
      [100, 103, 99, 102],
      [102, 105, 100, 104],
      [107, 110, 104, 108],
      [105, 107, 102, 103],
      [103, 106, 101, 102],
      [102, 105, 100, 101],
      [100, 103, 95, 99],
      [100, 104, 98, 103],
      [103, 105, 99, 104],
      [104, 106, 100, 105],
      [106, 112, 104, 111], // closes above the confirmed external high at 110 -> BULL
      [111, 113, 108, 112],
      [112, 114, 109, 113],
      [113, 115, 110, 114],
    ];
    const daily = values.map((row, index) => candle(
      Math.floor(Date.UTC(2026, 8, 1 + index, 16) / 1000),
      row[0], row[1], row[2], row[3],
    ));
    const result = computeDailyStructure({
      dailyCandles: daily,
      tradeDate: "2026-09-20",
      spot: 104,
      expectedMove: 10,
    });
    expect(result.trend).toBe("BULL");
    expect(result.flipLevel).toBe(95);
    expect(result.flipInPlay).toBe(true);
    expect(dailyFlipInPlay(106, result.flipLevel, 10)).toBe(false);
  });

  it("counts an OI wall plus nearby PDL as confluence using volatility-scaled tolerance", () => {
    const expectedMove = 35;
    const tolerance = Math.max(1, 0.05 * expectedMove);
    const result = buildStructureAnchorConfluence({
      snapshot: emptySnapshot,
      tolerancePoints: tolerance,
      anchors: [
        { id: "put-wall", label: "PUT WALL", price: 7805, tone: "BULL", sourceKind: "OI" },
        { id: "prior-PDL", label: "PDL", price: 7805.8, tone: "BULL", sourceKind: "PRIOR_DAY" },
      ],
    });
    const wall = result.find((item) => item.anchor.id === "put-wall");
    expect(tolerance).toBeCloseTo(1.75, 6);
    expect(wall?.count).toBe(2);
    expect(wall?.reasons).toContain("prior-day level");
  });

  it("keys prior-structure fetching only by trade date, not 5-second generatedAt updates", () => {
    const generated = [
      "2026-10-09T14:30:00Z",
      "2026-10-09T14:30:05Z",
      "2026-10-09T14:30:10Z",
      "2026-10-09T14:30:15Z",
      "2026-10-09T14:30:20Z",
    ];
    const keys = generated.map((generatedAt) =>
      priorStructureFetchKey({ tradeDate: "2026-10-09", generatedAt }),
    );
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe("2026-10-09");
  });
});
