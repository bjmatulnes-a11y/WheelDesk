import { fetchSchwabPriceHistory, type SchwabPriceCandle } from "./schwab/client";
import {
  buildMoveObservationsFrom30MinuteSessions,
  buildMoveObservationsFromSessions,
  classifyVixBucket,
  diagnoseIntradayBarAlignment,
  type DailyMoveObservation,
  type HistoricalSessionInput,
  type MoveTableSource,
} from "./zeroDteMoveTable";
import {
  dailyMoveCount,
  hasSource,
  logMoveCapture,
  rebuildAndSaveMoveTable,
  upsertDailyMoves,
  upsertMoveTableObservations,
} from "./zeroDteMoveTableRepository";
import type { StructureCandle } from "./zeroDteStructureMap";

const DAY_MS = 86_400_000;
const CT = "America/Chicago";
const ET = "America/New_York";

export type MoveBackfillDiagnostics = {
  requestedDays: number;
  fetchedSessions: number;
  completeSessions: number;
  observationsWritten: number;
  oldestDate: string | null;
  newestDate: string | null;
  spacingMinutes: number | null;
  alignedToCashOpen: boolean;
  firstBars: Array<{ tradeDate: string; firstBar: string; rowCount: number }>;
};

export type MoveCaptureResult = {
  ok: true;
  bootstrap30m: boolean;
  backfill30m: MoveBackfillDiagnostics | null;
  fetched1mSessions: number;
  complete1mSessions: number;
  oneMinuteRowsWritten: number;
  dailyRowsWritten: number;
  sessionCount: number;
  observationCount: number;
  bucketCount: number;
  lastCaptureDate: string | null;
};

export async function backfillZeroDteMoveTable30m(args: {
  userId: string;
  nowMs?: number;
  lookbackDays?: number;
}): Promise<MoveBackfillDiagnostics> {
  const nowMs = args.nowMs ?? Date.now();
  const lookbackDays = Math.max(30, Math.min(220, Math.floor(args.lookbackDays ?? 180)));
  const startMs = nowMs - (lookbackDays + 10) * DAY_MS;
  const candles = await fetchIntradayHistoryInChunks({
    userId: args.userId,
    symbol: "$SPX",
    frequency: 30,
    startMs,
    endMs: nowMs,
    chunkDays: 30,
  });
  const alignment = diagnoseIntradayBarAlignment(candles);
  console.info("[move-table] Schwab intraday backfill alignment", alignment);
  if (alignment.spacingMinutes !== 30 || !alignment.alignedToCashOpen) {
    console.warn(
      `[move-table] Expected 30-minute bars aligned to the 08:30 CT cash open; received spacing=${alignment.spacingMinutes ?? "unknown"}m, aligned=${alignment.alignedToCashOpen}. Actual bar start times will be retained and nearest-time resolution will be used.`,
    );
  }
  const sessionsByDate = groupByCentralDate(candles);
  const dates = [...sessionsByDate.keys()].sort();
  const completeDates = dates.filter((date) => cashRows(sessionsByDate.get(date) ?? [], date).length >= 10);
  const vixByDate = await fetchVixDailyMap(args.userId, startMs - 14 * DAY_MS, nowMs);
  const vixDates = [...vixByDate.keys()].sort();
  const sessions = buildHistoricalSessions(completeDates, sessionsByDate, vixByDate, vixDates);
  const observations = buildMoveObservationsFrom30MinuteSessions(sessions);
  const observationsWritten = await upsertMoveTableObservations(observations, "SCHWAB_30M");

  return {
    requestedDays: lookbackDays,
    fetchedSessions: dates.length,
    completeSessions: completeDates.length,
    observationsWritten,
    oldestDate: completeDates[0] ?? null,
    newestDate: completeDates.at(-1) ?? null,
    spacingMinutes: alignment.spacingMinutes,
    alignedToCashOpen: alignment.alignedToCashOpen,
    firstBars: alignment.firstBars,
  };
}

export async function captureZeroDteMoveTableEod(args: {
  userId: string;
  nowMs?: number;
  bootstrap30mDays?: number;
  oneMinuteLookbackDays?: number;
}): Promise<MoveCaptureResult> {
  const nowMs = args.nowMs ?? Date.now();
  let bootstrap30m = false;
  let backfill30m: MoveBackfillDiagnostics | null = null;

  try {
    const has30m = await hasSource("SCHWAB_30M").catch(() => false);
    if (!has30m) {
      bootstrap30m = true;
      backfill30m = await backfillZeroDteMoveTable30m({
        userId: args.userId,
        nowMs,
        lookbackDays: args.bootstrap30mDays ?? 180,
      });
    }

    const lookbackDays = Math.max(10, Math.min(60, Math.floor(args.oneMinuteLookbackDays ?? 45)));
    const startMs = nowMs - lookbackDays * DAY_MS;
    const minuteCandles = await fetchIntradayHistoryInChunks({
      userId: args.userId,
      symbol: "$SPX",
      frequency: 1,
      startMs,
      endMs: nowMs,
      chunkDays: 7,
    });
    const sessionsByDate = groupByCentralDate(minuteCandles);
    const today = zonedDate(nowMs, CT);
    const nowMinute = zonedMinute(nowMs, CT);
    const dates = [...sessionsByDate.keys()].sort();
    const completeDates = dates.filter((tradeDate) => {
      const rows = cashRows(sessionsByDate.get(tradeDate) ?? [], tradeDate);
      if (rows.length < 200) return false;
      if (tradeDate < today) return true;
      return tradeDate === today && nowMinute >= 15 * 60 + 5 && lastCashMinute(rows) >= 14 * 60 + 55;
    });

    const vixByDate = await fetchVixDailyMap(args.userId, startMs - 14 * DAY_MS, nowMs);
    const vixDates = [...vixByDate.keys()].sort();
    const sessions = buildHistoricalSessions(completeDates, sessionsByDate, vixByDate, vixDates);
    const oneMinute = buildMoveObservationsFromSessions(sessions, "SCHWAB_1M");
    const oneMinuteRowsWritten = await upsertMoveTableObservations(oneMinute, "SCHWAB_1M");

    const dailyRowsWritten = await refreshDailyMoveFallback({ userId: args.userId, nowMs });
    const captureDate = completeDates.at(-1) ?? null;
    await logMoveCapture({
      status: "ok",
      tradeDate: captureDate,
      rowsWritten: oneMinuteRowsWritten,
      detail: `1m complete sessions=${completeDates.length}; 30m bootstrap=${bootstrap30m ? "yes" : "no"}`,
    });
    const state = await rebuildAndSaveMoveTable();
    return {
      ok: true,
      bootstrap30m,
      backfill30m,
      fetched1mSessions: dates.length,
      complete1mSessions: completeDates.length,
      oneMinuteRowsWritten,
      dailyRowsWritten,
      sessionCount: state.table.sessionCount,
      observationCount: state.observationCount,
      bucketCount: state.table.buckets.length,
      lastCaptureDate: state.lastCaptureDate,
    };
  } catch (error) {
    const authFailed = isAuthFailure(error);
    await logMoveCapture({
      status: authFailed ? "auth_failed" : "error",
      tradeDate: zonedDate(nowMs, CT),
      rowsWritten: 0,
      detail: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
    }).catch(() => undefined);
    throw error;
  }
}

export async function refreshDailyMoveFallback(args: {
  userId: string;
  nowMs?: number;
}): Promise<number> {
  const nowMs = args.nowMs ?? Date.now();
  const existingDailyMoves = await dailyMoveCount().catch(() => 0);
  const spx = existingDailyMoves === 0
    ? await fetchSchwabPriceHistory({
        userId: args.userId,
        symbol: "$SPX",
        frequencyType: "daily",
        frequency: 1,
        periodType: "year",
        period: 20,
        needExtendedHoursData: false,
        needPreviousClose: false,
      })
    : await fetchSchwabPriceHistory({
        userId: args.userId,
        symbol: "$SPX",
        frequencyType: "daily",
        frequency: 1,
        periodType: "month",
        startDate: nowMs - 120 * DAY_MS,
        endDate: nowMs,
        needExtendedHoursData: false,
        needPreviousClose: false,
      });
  const vix = existingDailyMoves === 0
    ? await fetchSchwabPriceHistory({
        userId: args.userId,
        symbol: "$VIX",
        frequencyType: "daily",
        frequency: 1,
        periodType: "year",
        period: 20,
        needExtendedHoursData: false,
        needPreviousClose: false,
      })
    : await fetchSchwabPriceHistory({
        userId: args.userId,
        symbol: "$VIX",
        frequencyType: "daily",
        frequency: 1,
        periodType: "month",
        startDate: nowMs - 140 * DAY_MS,
        endDate: nowMs,
        needExtendedHoursData: false,
        needPreviousClose: false,
      });

  const spxRows = (spx.candles ?? []).filter(validSchwabCandle).sort((a, b) => a.datetime - b.datetime);
  const vixMap = dailyCloseMap(vix.candles ?? []);
  const vixDates = [...vixMap.keys()].sort();
  const moves: DailyMoveObservation[] = [];
  for (const candle of spxRows) {
    if (candle.open <= 0) continue;
    const tradeDate = zonedDate(candle.datetime, ET);
    const priorVixClose = priorClose(vixMap, vixDates, tradeDate);
    const vixBucket = classifyVixBucket(priorVixClose);
    if (!vixBucket || priorVixClose === null) continue;
    moves.push({
      tradeDate,
      priorVixClose,
      vixBucket,
      upMaxPct: Math.max(0, (candle.high - candle.open) / candle.open),
      downMaxPct: Math.max(0, (candle.open - candle.low) / candle.open),
      closeMovePct: (candle.close - candle.open) / candle.open,
    });
  }
  return upsertDailyMoves(moves);
}

async function fetchIntradayHistoryInChunks(args: {
  userId: string;
  symbol: string;
  frequency: 1 | 30;
  startMs: number;
  endMs: number;
  chunkDays: number;
}): Promise<StructureCandle[]> {
  const out = new Map<number, StructureCandle>();
  const chunkMs = args.chunkDays * DAY_MS;
  for (let startDate = args.startMs; startDate <= args.endMs; startDate += chunkMs) {
    const endDate = Math.min(args.endMs, startDate + chunkMs - 1);
    const result = await fetchSchwabPriceHistory({
      userId: args.userId,
      symbol: args.symbol,
      frequencyType: "minute",
      frequency: args.frequency,
      periodType: "day",
      startDate,
      endDate,
      needExtendedHoursData: false,
      needPreviousClose: false,
    });
    for (const candle of result.candles ?? []) {
      if (!validSchwabCandle(candle)) continue;
      const time = Math.floor(candle.datetime / 1000);
      out.set(time, {
        time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: Number.isFinite(candle.volume) ? candle.volume : null,
      });
    }
  }
  return [...out.values()].sort((a, b) => a.time - b.time);
}

async function fetchVixDailyMap(userId: string, startMs: number, endMs: number) {
  const result = await fetchSchwabPriceHistory({
    userId,
    symbol: "$VIX",
    frequencyType: "daily",
    frequency: 1,
    periodType: "year",
    startDate: startMs,
    endDate: endMs,
    needExtendedHoursData: false,
    needPreviousClose: false,
  });
  return dailyCloseMap(result.candles ?? []);
}

function buildHistoricalSessions(
  dates: readonly string[],
  sessionsByDate: Map<string, StructureCandle[]>,
  vixByDate: Map<string, number>,
  vixDates: readonly string[],
): HistoricalSessionInput[] {
  return dates.map((tradeDate) => ({
    tradeDate,
    candles: sessionsByDate.get(tradeDate) ?? [],
    priorVixClose: priorClose(vixByDate, vixDates, tradeDate),
  }));
}

function validSchwabCandle(candle: SchwabPriceCandle) {
  return [candle.datetime, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) && candle.high >= candle.low;
}

function groupByCentralDate(candles: readonly StructureCandle[]) {
  const out = new Map<string, StructureCandle[]>();
  for (const candle of candles) {
    const date = zonedDate(candle.time * 1000, CT);
    const rows = out.get(date) ?? [];
    rows.push(candle);
    out.set(date, rows);
  }
  for (const rows of out.values()) rows.sort((a, b) => a.time - b.time);
  return out;
}

function cashRows(candles: readonly StructureCandle[], tradeDate: string) {
  return candles.filter((candle) => {
    const ms = candle.time * 1000;
    if (zonedDate(ms, CT) !== tradeDate) return false;
    const minute = zonedMinute(ms, CT);
    return minute >= 8 * 60 + 30 && minute <= 15 * 60;
  });
}

function lastCashMinute(rows: readonly StructureCandle[]) {
  if (!rows.length) return -1;
  return zonedMinute(rows.at(-1)!.time * 1000, CT);
}

function dailyCloseMap(candles: readonly SchwabPriceCandle[]) {
  const out = new Map<string, number>();
  for (const candle of candles) {
    if (!validSchwabCandle(candle) || candle.close <= 0) continue;
    out.set(zonedDate(candle.datetime, ET), candle.close);
  }
  return out;
}

function priorClose(map: Map<string, number>, sortedDates: readonly string[], tradeDate: string) {
  for (let index = sortedDates.length - 1; index >= 0; index -= 1) {
    const date = sortedDates[index];
    if (date < tradeDate) return map.get(date) ?? null;
  }
  return null;
}

function zonedDate(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function zonedMinute(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(map.hour) * 60 + Number(map.minute);
}

function isAuthFailure(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("schwab is not connected") ||
    message.includes("invalid_grant") ||
    message.includes("refresh token") ||
    message.includes("401");
}
