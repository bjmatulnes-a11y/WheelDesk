import { getZeroDteSessionClock } from "./zeroDteSessionClock";

export type ZeroDteRemainingMoveRead = {
  generatedAt: string;
  minutesRemaining: number;
  sessionFractionRemaining: number;
  liveExpectedMove: number | null;
  floorExpectedMove: number;
  expectedMoveRemaining: number;
  source: "LIVE_STRADDLE" | "TIME_AWARE_FLOOR";
};

export function buildZeroDteRemainingMove(args: {
  generatedAt: string;
  spot: number;
  liveExpectedMove?: number | null;
  strikeStep?: number;
}): ZeroDteRemainingMoveRead {
  const clock = getZeroDteSessionClock(args.generatedAt);
  const closeMinute = 15 * 60;
  const minutesRemaining = Math.max(0, closeMinute - clock.minuteOfDayExact);
  const sessionFractionRemaining = clamp(minutesRemaining / 390, 0, 1);
  const strikeStep = positive(args.strikeStep) ?? 5;
  const spot = positive(args.spot) ?? 0;
  const liveExpectedMove = positive(args.liveExpectedMove);

  const timeScaledSpotFloor =
    spot > 0
      ? spot * 0.0008 * Math.sqrt(Math.max(sessionFractionRemaining, 1 / 390))
      : 0;
  const floorExpectedMove = Math.max(strikeStep * 2, timeScaledSpotFloor);
  const expectedMoveRemaining = Math.max(liveExpectedMove ?? 0, floorExpectedMove);

  return {
    generatedAt: args.generatedAt,
    minutesRemaining,
    sessionFractionRemaining,
    liveExpectedMove,
    floorExpectedMove,
    expectedMoveRemaining,
    source:
      liveExpectedMove !== null && liveExpectedMove >= floorExpectedMove
        ? "LIVE_STRADDLE"
        : "TIME_AWARE_FLOOR",
  };
}

function positive(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
