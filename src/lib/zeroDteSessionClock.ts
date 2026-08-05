export type ZeroDteCashSessionStatus = "PREOPEN" | "OPEN" | "CLOSED";

export type ZeroDteSessionClock = {
  chicagoDate: string;
  hour: number;
  minute: number;
  minuteOfDay: number;
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
    hourCycle: "h23",
  }).formatToParts(date);

  const year = part(parts, "year") ?? date.getUTCFullYear().toString();
  const month = part(parts, "month") ?? String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = part(parts, "day") ?? String(date.getUTCDate()).padStart(2, "0");
  const hour = Number(part(parts, "hour") ?? 0);
  const minute = Number(part(parts, "minute") ?? 0);
  const minuteOfDay = hour * 60 + minute;
  const sessionStatus: ZeroDteCashSessionStatus =
    minuteOfDay < OPEN_MINUTE
      ? "PREOPEN"
      : minuteOfDay >= CLOSE_MINUTE
        ? "CLOSED"
        : "OPEN";
  const epochMinute = Math.floor(date.getTime() / 60_000);

  return {
    chicagoDate: `${year}-${month}-${day}`,
    hour,
    minute,
    minuteOfDay,
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

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return parts.find((item) => item.type === type)?.value;
}
