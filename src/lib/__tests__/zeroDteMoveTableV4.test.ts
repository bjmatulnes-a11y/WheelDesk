import { describe, expect, it } from "vitest";
import {
  buildMoveObservationsFrom30MinuteSessions,
  buildMoveTableFromObservations,
  resolveMoveTableSample,
  sourcePrecedence,
  type DailyMoveObservation,
  type MoveTableObservation,
} from "../zeroDteMoveTable";
import type { StructureCandle } from "../zeroDteStructureMap";

const CT_OFFSET_HOURS = 5; // October 2026 = CDT.
function epoch(date: string, hour: number, minute: number) {
  return Math.floor(Date.parse(`${date}T${String(hour + CT_OFFSET_HOURS).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`) / 1000);
}
function candle(date: string, hour: number, minute: number, open: number, high: number, low: number, close: number): StructureCandle {
  return { time: epoch(date, hour, minute), open, high, low, close, volume: null };
}

function obs(tradeDate: string, timeBucket: string, value = 0.01): MoveTableObservation {
  return {
    tradeDate,
    timeBucket,
    dayType: "INSIDE_RANGE",
    gapClass: "FLAT",
    vixBucket: "15-20",
    morningTrend: "FLAT",
    upMaxPct: value,
    downMaxPct: value,
    closeMovePct: 0,
    source: "SCHWAB_30M",
  };
}

describe("0DTE move table v4", () => {
  it("counts merged neighboring buckets by distinct trading day", () => {
    const rows: MoveTableObservation[] = [];
    for (let i = 1; i <= 25; i += 1) {
      const date = `2026-09-${String(i).padStart(2, "0")}`;
      rows.push(obs(date, "10:00"), obs(date, "10:30"), obs(date, "11:00"));
    }
    const table = buildMoveTableFromObservations(rows);
    const sample = resolveMoveTableSample(table, {
      timeBucket: "10:30",
      dayType: "INSIDE_RANGE",
      gapClass: "FLAT",
      vixBucket: "15-20",
      morningTrend: "FLAT",
    }, 30);
    expect(sample?.n).toBe(25);
    expect(sample?.mode).toBe("EMPIRICAL");
  });

  it("gives 1-minute observations higher precedence than 30-minute observations", () => {
    expect(sourcePrecedence("SCHWAB_1M")).toBeGreaterThan(sourcePrecedence("SCHWAB_30M"));
  });

  it("uses the 30-minute bar open as entry and includes that bar in the future path", () => {
    const prior = "2026-10-14";
    const today = "2026-10-15";
    const priorBars = [
      candle(prior, 8, 30, 100, 102, 98, 101),
      candle(prior, 9, 0, 101, 103, 100, 102),
      candle(prior, 15, 0, 102, 103, 101, 102),
    ];
    const todayBars = [
      candle(today, 8, 30, 101, 102, 100, 101),
      candle(today, 9, 0, 102, 104, 99, 103),
      candle(today, 9, 30, 103, 110, 101, 108),
      candle(today, 10, 0, 108, 109, 100, 101),
      candle(today, 15, 0, 101, 102, 100, 101),
    ];
    const rows = buildMoveObservationsFrom30MinuteSessions([
      { tradeDate: prior, candles: priorBars, priorVixClose: 18 },
      { tradeDate: today, candles: todayBars, priorVixClose: 18 },
    ]);
    const nine = rows.find((row) => row.timeBucket === "09:00");
    expect(nine).toBeTruthy();
    expect(nine!.upMaxPct).toBeCloseTo((110 - 102) / 102, 8);
    expect(nine!.downMaxPct).toBeCloseTo((102 - 99) / 102, 8);
    expect(nine!.closeMovePct).toBeCloseTo((101 - 102) / 102, 8);
  });

  it("uses the modeled daily fallback only when fewer than 30 distinct intraday days exist", () => {
    const rows: MoveTableObservation[] = [];
    const daily: DailyMoveObservation[] = [];
    for (let i = 1; i <= 40; i += 1) {
      const month = i <= 30 ? 8 : 9;
      const day = i <= 30 ? i : i - 30;
      const date = `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      daily.push({ tradeDate: date, priorVixClose: 18, vixBucket: "15-20", upMaxPct: 0.02, downMaxPct: 0.018, closeMovePct: 0.005 });
      if (i <= 25) rows.push(obs(date, "10:30", 0.008));
    }
    const table = buildMoveTableFromObservations(rows, { dailyMoves: daily });
    const sample = resolveMoveTableSample(table, {
      timeBucket: "10:30",
      dayType: "INSIDE_RANGE",
      gapClass: "FLAT",
      vixBucket: "15-20",
      morningTrend: "FLAT",
    }, 30);
    expect(sample?.mode).toBe("MODELED");
    expect(sample?.keyUsed.startsWith("MODELED|")).toBe(true);
    expect(sample?.n).toBe(40);
  });
});
