export type ZeroDteCashSessionStatus = "PREOPEN" | "OPEN" | "CLOSED";

export type ZeroDteSessionClock = {
  chicagoDate: string;
  hour: number;
  minute: number;
  second: number;
  minuteOfDay: number;
  minuteOfDayExact: number;
  weekday: number;
  isTradingWeekday: boolean;
  minuteIndex: number;
  sessionStatus: ZeroDteCashSessionStatus;
  minuteKey: string;
  epochMinute: number;
};

const OPEN_MINUTE = 8 * 60 + 30;
const CLOSE_MINUTE = 15 * 60;

export function getZeroDteSessionClock(
  generatedAt: string,
): ZeroDteSessionClock {
  const timestamp = Date.parse(generatedAt);
  const date = Number.isFinite(timestamp) ? new Date(timestamp) : new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);

  const year = part(parts, "year") ?? date.getUTCFullYear().toString();
  const month = part(parts, "month") ?? String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = part(parts, "day") ?? String(date.getUTCDate()).padStart(2, "0");
  const hour = Number(part(parts, "hour") ?? 0);
  const minute = Number(part(parts, "minute") ?? 0);
  const second = Number(part(parts, "second") ?? 0);
  const minuteOfDay = hour * 60 + minute;
  const minuteOfDayExact = minuteOfDay + second / 60;
  const weekdayLabel = part(parts, "weekday") ?? "";
  const weekday = weekdayNumber(weekdayLabel);
  const isTradingWeekday = weekday >= 1 && weekday <= 5;
  const sessionStatus: ZeroDteCashSessionStatus =
    !isTradingWeekday
      ? "CLOSED"
      : minuteOfDay < OPEN_MINUTE
      ? "PREOPEN"
      : minuteOfDay >= CLOSE_MINUTE
        ? "CLOSED"
        : "OPEN";
  const epochMinute = Math.floor(date.getTime() / 60_000);

  return {
    chicagoDate: `${year}-${month}-${day}`,
    hour,
    minute,
    second,
    minuteOfDay,
    minuteOfDayExact,
    weekday,
    isTradingWeekday,
    minuteIndex: minuteOfDay - OPEN_MINUTE,
    sessionStatus,
    minuteKey: String(epochMinute),
    epochMinute,
  };
}

export function flowConfirmationWindowMinutes(clock: ZeroDteSessionClock) {
  if (clock.sessionStatus !== "OPEN") return 5;
  if (clock.minuteIndex >= 0 && clock.minuteIndex < 30) return 3;
  return 5;
}

export function flowContextWindowMinutes(clock: ZeroDteSessionClock) {
  if (clock.sessionStatus === "OPEN" && clock.minuteOfDay >= 12 * 60) return 15;
  return 15;
}

export function isSameOrLaterMinute(a: string, b: string) {
  return Number(a) >= Number(b);
}

function part(parts: Intl.DateTimeFormatPart[], type: string) {
  return parts.find((item) => item.type === type)?.value;
}

function weekdayNumber(label: string) {
  const normalized = label.slice(0, 3).toLowerCase();
  if (normalized === "mon") return 1;
  if (normalized === "tue") return 2;
  if (normalized === "wed") return 3;
  if (normalized === "thu") return 4;
  if (normalized === "fri") return 5;
  if (normalized === "sat") return 6;
  return 0;
}
