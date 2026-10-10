import {
  buildZeroDteStructureMap,
  type StructureCandle,
  type StructureDirection,
} from "./zeroDteStructureMap";

export type PriorStructureLevelKind =
  | "PRIOR_DAY"
  | "OVERNIGHT"
  | "WEEKLY"
  | "DAILY"
  | "CARRIED_SWING"
  | "CARRIED_FVG";

export type PriorStructureLevel = {
  id: string;
  label: string;
  price: number;
  kind: PriorStructureLevelKind;
  low?: number;
  high?: number;
  approximate?: boolean;
};

export type PriorStructure = {
  tradeDate: string;
  priorSessionDate: string;
  levels: PriorStructureLevel[];
  daily: { trend: StructureDirection | null; flipLevel: number | null };
  basis: { median: number | null; coveragePct: number | null };
  warnings: string[];
};

export type OpeningDayType = "INSIDE_RANGE" | "OUTSIDE_UP" | "OUTSIDE_DOWN";
export type GapClass = "FLAT" | "MODERATE" | "LARGE";

export type OpeningPriorContext = {
  openingDayType: OpeningDayType;
  todayOpen: number;
  gapPoints: number;
  gapVsExpectedMove: number;
  gapClass: GapClass;
  regainedPriorRange: boolean;
  tag: string;
};

export type DailyStructureSummary = {
  trend: StructureDirection | null;
  flipLevel: number | null;
  flipInPlay: boolean;
  priorWeekHigh: number | null;
  priorWeekLow: number | null;
};

export type PriorCashSessionSummary = {
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  rawClose: number | null;
  mid: number | null;
  candles: StructureCandle[];
  warnings: string[];
};

const CENTRAL_TZ = "America/Chicago";
const MARKET_TZ = "America/New_York";

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function ymdParts(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Invalid YYYY-MM-DD date: ${date}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function formatYmdUtc(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function addCalendarDays(date: string, days: number): string {
  const { year, month, day } = ymdParts(date);
  const value = new Date(Date.UTC(year, month - 1, day + days, 12));
  return formatYmdUtc(value);
}

function dayOfWeek(date: string): number {
  const { year, month, day } = ymdParts(date);
  return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
}

function observedFixedHoliday(date: string): string {
  const dow = dayOfWeek(date);
  if (dow === 6) return addCalendarDays(date, -1);
  if (dow === 0) return addCalendarDays(date, 1);
  return date;
}

function nthWeekday(year: number, month: number, weekday: number, nth: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return formatYmdUtc(new Date(Date.UTC(year, month - 1, 1 + offset + (nth - 1) * 7, 12)));
}

function lastWeekday(year: number, month: number, weekday: number): string {
  const last = new Date(Date.UTC(year, month, 0, 12));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return formatYmdUtc(new Date(Date.UTC(year, month - 1, last.getUTCDate() - offset, 12)));
}

function easterSunday(year: number): string {
  // Meeus/Jones/Butcher Gregorian algorithm.
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function usEquityMarketHolidays(year: number): Set<string> {
  const dates = new Set<string>();
  dates.add(observedFixedHoliday(`${year}-01-01`));
  // If next New Year's Day is Saturday, its observation is Dec 31 of this year.
  const nextNewYearObserved = observedFixedHoliday(`${year + 1}-01-01`);
  if (nextNewYearObserved.startsWith(`${year}-`)) dates.add(nextNewYearObserved);
  dates.add(nthWeekday(year, 1, 1, 3)); // MLK
  dates.add(nthWeekday(year, 2, 1, 3)); // Presidents' Day
  dates.add(addCalendarDays(easterSunday(year), -2)); // Good Friday
  dates.add(lastWeekday(year, 5, 1)); // Memorial Day
  if (year >= 2022) dates.add(observedFixedHoliday(`${year}-06-19`)); // Juneteenth
  dates.add(observedFixedHoliday(`${year}-07-04`));
  dates.add(nthWeekday(year, 9, 1, 1)); // Labor Day
  dates.add(nthWeekday(year, 11, 4, 4)); // Thanksgiving
  dates.add(observedFixedHoliday(`${year}-12-25`));
  return dates;
}

export function isUsEquityTradingDay(date: string): boolean {
  const dow = dayOfWeek(date);
  if (dow === 0 || dow === 6) return false;
  const { year } = ymdParts(date);
  return !usEquityMarketHolidays(year).has(date);
}


export function priorStructureFetchKey(args: {
  tradeDate: string | null | undefined;
  generatedAt?: string | null;
}): string | null {
  const tradeDate = args.tradeDate?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(tradeDate) ? tradeDate : null;
}

export function previousTradingSessionDate(tradeDate: string): string {
  let candidate = addCalendarDays(tradeDate, -1);
  for (let attempts = 0; attempts < 14; attempts += 1) {
    if (isUsEquityTradingDay(candidate)) return candidate;
    candidate = addCalendarDays(candidate, -1);
  }
  throw new Error(`Could not resolve prior trading session for ${tradeDate}`);
}

function timeZoneParts(epochMs: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(epochMs));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

export function zonedDateTimeToEpochMs(
  date: string,
  hour: number,
  minute: number,
  timeZone = CENTRAL_TZ,
): number {
  const desired = ymdParts(date);
  const targetAsUtc = Date.UTC(desired.year, desired.month - 1, desired.day, hour, minute, 0, 0);
  let guess = targetAsUtc;
  // Iteratively correct the guessed UTC timestamp until its formatted zoned
  // wall-clock time equals the requested local wall-clock time. This avoids a
  // hard-coded CST/CDT offset and works across DST boundaries.
  for (let index = 0; index < 4; index += 1) {
    const observed = timeZoneParts(guess, timeZone);
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
      0,
    );
    const delta = targetAsUtc - observedAsUtc;
    guess += delta;
    if (Math.abs(delta) < 1_000) break;
  }
  return guess;
}

export function dateInTimeZone(epochSeconds: number, timeZone = CENTRAL_TZ): string {
  const parts = timeZoneParts(epochSeconds * 1000, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function minuteOfDayInTimeZone(epochSeconds: number, timeZone = CENTRAL_TZ): number {
  const parts = timeZoneParts(epochSeconds * 1000, timeZone);
  return parts.hour * 60 + parts.minute;
}

export function filterCashSessionCandles(
  candles: readonly StructureCandle[],
  sessionDate: string,
): StructureCandle[] {
  return candles
    .filter((candle) => {
      if (dateInTimeZone(candle.time, CENTRAL_TZ) !== sessionDate) return false;
      const minute = minuteOfDayInTimeZone(candle.time, CENTRAL_TZ);
      return minute >= 8 * 60 + 30 && minute <= 15 * 60;
    })
    .sort((a, b) => a.time - b.time);
}

export function computePriorCashSession(args: {
  candles: readonly StructureCandle[];
  priorSessionDate: string;
  previousClose?: number | null;
}): PriorCashSessionSummary {
  const candles = filterCashSessionCandles(args.candles, args.priorSessionDate);
  const warnings: string[] = [];
  if (!candles.length) {
    warnings.push(`No SPX cash-session candles found for ${args.priorSessionDate}.`);
    return { open: null, high: null, low: null, close: null, rawClose: null, mid: null, candles: [], warnings };
  }

  const open = candles[0]?.open ?? null;
  const high = Math.max(...candles.map((candle) => candle.high));
  const low = Math.min(...candles.map((candle) => candle.low));
  const rawClose = candles.at(-1)?.close ?? null;
  let close = rawClose;
  if (finite(args.previousClose) && finite(rawClose) && Math.abs(args.previousClose - rawClose) > 0.5) {
    warnings.push(
      `Prior close mismatch: last 1m close ${rawClose.toFixed(2)} vs Schwab previousClose ${args.previousClose.toFixed(2)}; using previousClose.`,
    );
    close = args.previousClose;
  }

  return {
    open,
    high,
    low,
    close,
    rawClose,
    mid: finite(high) && finite(low) ? (high + low) / 2 : null,
    candles,
    warnings,
  };
}

export function averageTrueRange(candles: readonly StructureCandle[], length = 14): number | null {
  if (candles.length < 2) return null;
  const start = Math.max(1, candles.length - Math.max(2, length));
  const values: number[] = [];
  for (let index = start; index < candles.length; index += 1) {
    const candle = candles[index];
    const priorClose = candles[index - 1]?.close ?? candle.open;
    values.push(Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - priorClose),
      Math.abs(candle.low - priorClose),
    ));
  }
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function buildCarriedPriorStructure(
  cashCandles: readonly StructureCandle[],
  priorSessionDate: string,
): PriorStructureLevel[] {
  const candles = filterCashSessionCandles(cashCandles, priorSessionDate);
  if (!candles.length) return [];
  const snapshot = buildZeroDteStructureMap(candles, {
    internalRadius: 3,
    externalRadius: 8,
    mitigationMode: "CLOSE",
    fvgThresholdPct: 0,
    reactionMinRelativeVolume: 1.35,
  });
  const finalHourStart = Math.floor(zonedDateTimeToEpochMs(priorSessionDate, 14, 0) / 1000);
  const levels: PriorStructureLevel[] = [];
  const external = snapshot.swings.filter(
    (swing) => swing.scale === "EXTERNAL" && swing.time >= finalHourStart,
  );
  const lastHigh = [...external].reverse().find((swing) => swing.kind === "HIGH") ?? null;
  const lastLow = [...external].reverse().find((swing) => swing.kind === "LOW") ?? null;
  if (lastHigh) {
    levels.push({
      id: `PD_SWING_HIGH_${lastHigh.time}`,
      label: "PD swing H",
      price: lastHigh.price,
      kind: "CARRIED_SWING",
    });
  }
  if (lastLow) {
    levels.push({
      id: `PD_SWING_LOW_${lastLow.time}`,
      label: "PD swing L",
      price: lastLow.price,
      kind: "CARRIED_SWING",
    });
  }

  const atr = averageTrueRange(candles, 14) ?? 0;
  const minimumGap = atr * 0.25;
  const fvgs = snapshot.fvgs
    .filter(
      (fvg) =>
        !fvg.mitigated &&
        fvg.startedAt >= finalHourStart &&
        fvg.high - fvg.low >= minimumGap,
    )
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 2)
    .reverse();
  for (const fvg of fvgs) {
    levels.push({
      id: `PD_FVG_${fvg.direction}_${fvg.startedAt}`,
      label: `PD ${fvg.direction === "BULL" ? "bull" : "bear"} FVG`,
      price: (fvg.low + fvg.high) / 2,
      low: fvg.low,
      high: fvg.high,
      kind: "CARRIED_FVG",
    });
  }
  return levels;
}

export function filterActiveCarriedLevels(
  levels: readonly PriorStructureLevel[],
  todayCandles: readonly StructureCandle[],
): PriorStructureLevel[] {
  return levels.filter((level) => {
    if (level.kind === "CARRIED_SWING") {
      if (level.id.includes("SWING_HIGH")) {
        return !todayCandles.some((candle) => candle.close > level.price);
      }
      if (level.id.includes("SWING_LOW")) {
        return !todayCandles.some((candle) => candle.close < level.price);
      }
      return true;
    }
    if (level.kind === "CARRIED_FVG") {
      const low = finite(level.low) ? level.low : level.price;
      const high = finite(level.high) ? level.high : level.price;
      return !todayCandles.some((candle) => candle.high >= low && candle.low <= high);
    }
    return true;
  });
}

export function computeOvernightLevels(args: {
  esCandles: readonly StructureCandle[];
  priorSessionDate: string;
  tradeDate: string;
  basisMedian: number | null;
  basisCoveragePct: number | null;
}): PriorStructureLevel[] {
  if (!finite(args.basisMedian)) return [];
  const start = Math.floor(zonedDateTimeToEpochMs(args.priorSessionDate, 15, 15) / 1000);
  const end = Math.floor(zonedDateTimeToEpochMs(args.tradeDate, 8, 29) / 1000) + 59;
  const overnight = args.esCandles.filter((candle) => candle.time >= start && candle.time <= end);
  if (!overnight.length) return [];
  const highEs = Math.max(...overnight.map((candle) => candle.high));
  const lowEs = Math.min(...overnight.map((candle) => candle.low));
  const approximate = !finite(args.basisCoveragePct) || args.basisCoveragePct < 50;
  return [
    {
      id: "ONH",
      label: "ON H",
      price: highEs - args.basisMedian,
      kind: "OVERNIGHT",
      approximate,
    },
    {
      id: "ONL",
      label: "ON L",
      price: lowEs - args.basisMedian,
      kind: "OVERNIGHT",
      approximate,
    },
  ];
}

function startOfWeekMonday(date: string): string {
  const dow = dayOfWeek(date);
  const back = dow === 0 ? 6 : dow - 1;
  return addCalendarDays(date, -back);
}

export function computeDailyStructure(args: {
  dailyCandles: readonly StructureCandle[];
  tradeDate: string;
  spot?: number | null;
  expectedMove?: number | null;
}): DailyStructureSummary {
  const completed = args.dailyCandles
    .filter((candle) => dateInTimeZone(candle.time, MARKET_TZ) < args.tradeDate)
    .sort((a, b) => a.time - b.time);
  const snapshot = buildZeroDteStructureMap(completed, {
    internalRadius: 2,
    externalRadius: 3,
    mitigationMode: "CLOSE",
    fvgThresholdPct: 0,
    reactionMinRelativeVolume: 1.35,
  });
  const trend = snapshot.trendExternal;
  const external = snapshot.swings.filter((swing) => swing.scale === "EXTERNAL");
  const flipSwing = trend === "BULL"
    ? [...external].reverse().find((swing) => swing.kind === "LOW") ?? null
    : trend === "BEAR"
      ? [...external].reverse().find((swing) => swing.kind === "HIGH") ?? null
      : null;
  const flipLevel = flipSwing?.price ?? null;
  const flipInPlay = dailyFlipInPlay(args.spot ?? null, flipLevel, args.expectedMove ?? null);

  const currentWeekMonday = startOfWeekMonday(args.tradeDate);
  const priorMonday = addCalendarDays(currentWeekMonday, -7);
  const priorFriday = addCalendarDays(priorMonday, 4);
  const priorWeek = completed.filter((candle) => {
    const date = dateInTimeZone(candle.time, MARKET_TZ);
    return date >= priorMonday && date <= priorFriday;
  });

  return {
    trend,
    flipLevel,
    flipInPlay,
    priorWeekHigh: priorWeek.length ? Math.max(...priorWeek.map((candle) => candle.high)) : null,
    priorWeekLow: priorWeek.length ? Math.min(...priorWeek.map((candle) => candle.low)) : null,
  };
}

export function dailyFlipInPlay(
  spot: number | null,
  flipLevel: number | null,
  expectedMove: number | null,
): boolean {
  return Boolean(
    finite(spot) &&
    finite(flipLevel) &&
    finite(expectedMove) &&
    expectedMove > 0 &&
    Math.abs(spot - flipLevel) <= expectedMove,
  );
}

export function computeOpeningPriorContext(args: {
  todayCandles: readonly StructureCandle[];
  levels: readonly PriorStructureLevel[];
  expectedMove: number | null | undefined;
}): OpeningPriorContext | null {
  const pdh = args.levels.find((level) => level.id === "PDH")?.price ?? null;
  const pdl = args.levels.find((level) => level.id === "PDL")?.price ?? null;
  const pdc = args.levels.find((level) => level.id === "PDC")?.price ?? null;
  const first = args.todayCandles[0] ?? null;
  if (!first || !finite(pdh) || !finite(pdl) || !finite(pdc) || !finite(args.expectedMove) || args.expectedMove <= 0) {
    return null;
  }

  const todayOpen = first.open;
  const openingDayType: OpeningDayType = todayOpen > pdh
    ? "OUTSIDE_UP"
    : todayOpen < pdl
      ? "OUTSIDE_DOWN"
      : "INSIDE_RANGE";
  const gapPoints = todayOpen - pdc;
  const gapVsExpectedMove = Math.abs(gapPoints) / args.expectedMove;
  const gapClass: GapClass = gapVsExpectedMove < 0.25
    ? "FLAT"
    : gapVsExpectedMove < 0.5
      ? "MODERATE"
      : "LARGE";
  const regainedPriorRange = openingDayType === "INSIDE_RANGE"
    ? false
    : args.todayCandles.some((candle) => candle.close >= pdl && candle.close <= pdh);

  let tag = "Mixed.";
  if (regainedPriorRange) tag = "Failed gap: back inside prior range";
  else if (openingDayType === "INSIDE_RANGE" && gapClass === "FLAT") {
    tag = "Rotational bias. Prior range edges are boundaries.";
  } else if (openingDayType !== "INSIDE_RANGE" && gapClass === "LARGE") {
    tag = "Trend-day risk. Respect breaks; fade less.";
  }

  return {
    openingDayType,
    todayOpen,
    gapPoints,
    gapVsExpectedMove,
    gapClass,
    regainedPriorRange,
    tag,
  };
}

export function openingPriorContextText(opening: OpeningPriorContext | null): string {
  return opening
    ? `Opened ${opening.openingDayType === "INSIDE_RANGE" ? "INSIDE prior range" : opening.openingDayType === "OUTSIDE_UP" ? "ABOVE prior range" : "BELOW prior range"} · gap ${opening.gapPoints >= 0 ? "+" : ""}${opening.gapPoints.toFixed(1)} (${opening.gapVsExpectedMove.toFixed(2)}×EM) · ${opening.tag}`
    : "Opening context unavailable";
}

export function dailyPriorContextText(
  trend: StructureDirection | null,
  flipLevel: number | null,
  flipInPlay: boolean,
): string {
  return trend
    ? `Daily ${trend} · flip ${finite(flipLevel) ? flipLevel.toFixed(1) : "—"} (${flipInPlay ? "flip in play" : "out of play"})`
    : `Daily neutral · flip ${finite(flipLevel) ? flipLevel.toFixed(1) : "—"}`;
}

export function buildPriorContextChip(args: {
  opening: OpeningPriorContext | null;
  dailyTrend: StructureDirection | null;
  dailyFlipLevel: number | null;
  dailyFlipInPlay: boolean;
}): string | null {
  if (!args.opening && !args.dailyTrend && !finite(args.dailyFlipLevel)) return null;
  return `${openingPriorContextText(args.opening)}  |  ${dailyPriorContextText(args.dailyTrend, args.dailyFlipLevel, args.dailyFlipInPlay)}`;
}

export function nearestPriorLevel(
  levels: readonly PriorStructureLevel[],
  spot: number,
): { level: PriorStructureLevel; distance: number } | null {
  if (!finite(spot)) return null;
  let best: { level: PriorStructureLevel; distance: number } | null = null;
  for (const level of levels) {
    const distance = Math.abs(level.price - spot);
    if (!best || distance < best.distance) best = { level, distance };
  }
  return best;
}

export function priorLevelGuardsShortStrike(args: {
  levels: readonly PriorStructureLevel[];
  spot: number;
  shortStrike: number | null;
}): boolean | null {
  if (!finite(args.spot) || !finite(args.shortStrike)) return null;
  const lower = Math.min(args.spot, args.shortStrike);
  const upper = Math.max(args.spot, args.shortStrike);
  return args.levels.some(
    (level) =>
      (level.kind === "PRIOR_DAY" || level.kind === "OVERNIGHT") &&
      level.price >= lower &&
      level.price <= upper,
  );
}

export function priorLevelReason(kind: PriorStructureLevelKind): string | null {
  if (kind === "PRIOR_DAY") return "prior-day level";
  if (kind === "OVERNIGHT") return "overnight level";
  if (kind === "WEEKLY") return "weekly level";
  if (kind === "DAILY") return "daily flip";
  if (kind === "CARRIED_SWING" || kind === "CARRIED_FVG") return "prior-session structure";
  return null;
}
