import { supabaseServer } from "./supabase-server";
import {
  buildMoveTableFromObservations,
  type DailyMoveObservation,
  type MoveTableObservation,
  type MoveTableSource,
  type ZeroDteMoveTable,
} from "./zeroDteMoveTable";
import { previousTradingSessionDate } from "./zeroDtePriorStructure";

const STATE_ID = "spx-v2";
const CHUNK = 500;

export type MoveCaptureStatus = "ok" | "auth_failed" | "error";

export type MoveCaptureLog = {
  status: MoveCaptureStatus;
  capturedAt: string;
  tradeDate: string | null;
  rowsWritten: number;
  detail: string | null;
};

export type MoveTableStateRead = {
  table: ZeroDteMoveTable;
  source: "supabase";
  observationCount: number;
  distinctDayCount: number;
  sourceMix: { SCHWAB_1M: number; SCHWAB_30M: number };
  lastCaptureDate: string | null;
  capture: MoveCaptureLog | null;
  stale: boolean;
};

type MoveSampleRow = {
  trade_date: string;
  time_bucket: string;
  day_type: MoveTableObservation["dayType"];
  gap_class: MoveTableObservation["gapClass"];
  vix_bucket: MoveTableObservation["vixBucket"];
  prior_vix_close: number | null;
  morning_trend: MoveTableObservation["morningTrend"];
  up_max_pct: number;
  down_max_pct: number;
  close_move_pct: number;
  source: MoveTableSource;
};

type DailyMoveRow = {
  trade_date: string;
  prior_vix_close: number;
  vix_bucket: DailyMoveObservation["vixBucket"];
  up_max_pct: number;
  down_max_pct: number;
  close_move_pct: number;
};

export async function upsertMoveTableObservations(
  observations: readonly MoveTableObservation[],
  source: MoveTableSource,
): Promise<number> {
  if (!observations.length) return 0;
  let written = 0;
  for (let index = 0; index < observations.length; index += CHUNK) {
    const rows = observations.slice(index, index + CHUNK).map((item) => ({
      trade_date: item.tradeDate,
      time_bucket: item.timeBucket,
      day_type: item.dayType,
      gap_class: item.gapClass,
      vix_bucket: item.vixBucket,
      prior_vix_close: item.priorVixClose ?? null,
      morning_trend: item.morningTrend,
      up_max_pct: item.upMaxPct,
      down_max_pct: item.downMaxPct,
      close_move_pct: item.closeMovePct,
      source,
    }));
    const { data, error } = await supabaseServer.rpc("upsert_zero_dte_move_samples", {
      payload: rows,
    });
    if (error) throw new Error(`Unable to save move-table samples: ${error.message}`);
    written += Number(data ?? rows.length);
  }
  return written;
}

export async function loadMoveTableObservations(): Promise<MoveTableObservation[]> {
  const rows: MoveSampleRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabaseServer
      .from("zero_dte_move_samples")
      .select("trade_date,time_bucket,day_type,gap_class,vix_bucket,prior_vix_close,morning_trend,up_max_pct,down_max_pct,close_move_pct,source")
      .order("trade_date", { ascending: true })
      .order("time_bucket", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`Unable to load move-table samples: ${error.message}`);
    const chunk = (data ?? []) as MoveSampleRow[];
    rows.push(...chunk);
    if (chunk.length < 1000) break;
    from += 1000;
  }
  return rows.map((row) => ({
    tradeDate: row.trade_date,
    timeBucket: row.time_bucket,
    dayType: row.day_type,
    gapClass: row.gap_class,
    vixBucket: row.vix_bucket,
    priorVixClose: row.prior_vix_close == null ? null : Number(row.prior_vix_close),
    morningTrend: row.morning_trend,
    upMaxPct: Number(row.up_max_pct),
    downMaxPct: Number(row.down_max_pct),
    closeMovePct: Number(row.close_move_pct),
    source: row.source,
  }));
}

export async function upsertDailyMoves(moves: readonly DailyMoveObservation[]): Promise<number> {
  if (!moves.length) return 0;
  let written = 0;
  for (let index = 0; index < moves.length; index += CHUNK) {
    const rows = moves.slice(index, index + CHUNK).map((item) => ({
      trade_date: item.tradeDate,
      prior_vix_close: item.priorVixClose,
      vix_bucket: item.vixBucket,
      up_max_pct: item.upMaxPct,
      down_max_pct: item.downMaxPct,
      close_move_pct: item.closeMovePct,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabaseServer
      .from("zero_dte_daily_moves")
      .upsert(rows, { onConflict: "trade_date" });
    if (error) throw new Error(`Unable to save daily move fallback rows: ${error.message}`);
    written += rows.length;
  }
  return written;
}

export async function loadDailyMoves(): Promise<DailyMoveObservation[]> {
  const rows: DailyMoveRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabaseServer
      .from("zero_dte_daily_moves")
      .select("trade_date,prior_vix_close,vix_bucket,up_max_pct,down_max_pct,close_move_pct")
      .order("trade_date", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`Unable to load daily move fallback rows: ${error.message}`);
    const chunk = (data ?? []) as DailyMoveRow[];
    rows.push(...chunk);
    if (chunk.length < 1000) break;
    from += 1000;
  }
  return rows.map((row) => ({
    tradeDate: row.trade_date,
    priorVixClose: Number(row.prior_vix_close),
    vixBucket: row.vix_bucket,
    upMaxPct: Number(row.up_max_pct),
    downMaxPct: Number(row.down_max_pct),
    closeMovePct: Number(row.close_move_pct),
  }));
}

export async function sampleCount(): Promise<number> {
  const { count, error } = await supabaseServer
    .from("zero_dte_move_samples")
    .select("trade_date", { count: "exact", head: true });
  if (error) throw new Error(`Unable to count move-table samples: ${error.message}`);
  return count ?? 0;
}

export async function dailyMoveCount(): Promise<number> {
  const { count, error } = await supabaseServer
    .from("zero_dte_daily_moves")
    .select("trade_date", { count: "exact", head: true });
  if (error) throw new Error(`Unable to count daily move rows: ${error.message}`);
  return count ?? 0;
}

export async function distinctSampleDayCount(): Promise<number> {
  const { data, error } = await supabaseServer
    .from("zero_dte_move_samples")
    .select("trade_date");
  if (error) throw new Error(`Unable to count move-table days: ${error.message}`);
  return new Set((data ?? []).map((row: any) => String(row.trade_date ?? "")).filter(Boolean)).size;
}

export async function hasSource(source: MoveTableSource): Promise<boolean> {
  const { count, error } = await supabaseServer
    .from("zero_dte_move_samples")
    .select("trade_date", { count: "exact", head: true })
    .eq("source", source);
  if (error) throw new Error(`Unable to inspect move-table source ${source}: ${error.message}`);
  return (count ?? 0) > 0;
}


export async function moveTableCoverageReport() {
  const observations = await loadMoveTableObservations();
  const byVix = new Map<string, Set<string>>();
  const byCell = new Map<string, Set<string>>();
  for (const row of observations) {
    const vixDates = byVix.get(row.vixBucket) ?? new Set<string>();
    vixDates.add(row.tradeDate);
    byVix.set(row.vixBucket, vixDates);
    const cellKey = `${row.timeBucket}|${row.vixBucket}`;
    const cellDates = byCell.get(cellKey) ?? new Set<string>();
    cellDates.add(row.tradeDate);
    byCell.set(cellKey, cellDates);
  }
  return {
    distinctDaysByVix: Object.fromEntries([...byVix.entries()].map(([key, dates]) => [key, dates.size])),
    thinCells: [...byCell.entries()]
      .map(([key, dates]) => {
        const [timeBucket, vixBucket] = key.split("|");
        return { timeBucket, vixBucket, distinctDays: dates.size };
      })
      .filter((item) => item.distinctDays < 30)
      .sort((a, b) => a.timeBucket.localeCompare(b.timeBucket) || a.vixBucket.localeCompare(b.vixBucket)),
  };
}

export async function logMoveCapture(entry: {
  status: MoveCaptureStatus;
  tradeDate?: string | null;
  rowsWritten?: number;
  detail?: string | null;
}) {
  const { error } = await supabaseServer.from("zero_dte_move_capture_log").insert({
    status: entry.status,
    trade_date: entry.tradeDate ?? null,
    rows_written: Math.max(0, Math.floor(entry.rowsWritten ?? 0)),
    detail: entry.detail ?? null,
    captured_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Unable to write move capture log: ${error.message}`);
}

export async function latestMoveCapture(): Promise<MoveCaptureLog | null> {
  const { data, error } = await supabaseServer
    .from("zero_dte_move_capture_log")
    .select("status,trade_date,rows_written,detail,captured_at")
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Unable to read move capture log: ${error.message}`);
  if (!data) return null;
  const status: MoveCaptureStatus = data.status === "auth_failed" || data.status === "error" ? data.status : "ok";
  return {
    status,
    capturedAt: String(data.captured_at),
    tradeDate: data.trade_date ? String(data.trade_date) : null,
    rowsWritten: Number(data.rows_written ?? 0),
    detail: data.detail ? String(data.detail) : null,
  };
}

export async function rebuildAndSaveMoveTable(): Promise<MoveTableStateRead> {
  const [observations, dailyMoves, capture] = await Promise.all([
    loadMoveTableObservations(),
    loadDailyMoves().catch(() => [] as DailyMoveObservation[]),
    latestMoveCapture().catch(() => null),
  ]);
  const lastCaptureDate = capture?.status === "ok" ? capture.tradeDate : maxTradeDate(observations);
  const table = buildMoveTableFromObservations(observations, { dailyMoves, lastCaptureDate });
  const payload = {
    id: STATE_ID,
    table_json: table,
    generated_at: table.generatedAt,
    session_count: table.sessionCount,
    bucket_count: table.buckets.length,
    observation_count: observations.length,
    last_capture_date: table.lastCaptureDate,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabaseServer
    .from("zero_dte_move_table_state")
    .upsert(payload, { onConflict: "id" });
  if (error) throw new Error(`Unable to save move-table state: ${error.message}`);
  return stateRead(table, observations.length, capture);
}

export async function loadMoveTableState(): Promise<MoveTableStateRead | null> {
  const { data, error } = await supabaseServer
    .from("zero_dte_move_table_state")
    .select("table_json,observation_count")
    .eq("id", STATE_ID)
    .maybeSingle();
  if (error) throw new Error(`Unable to load move-table state: ${error.message}`);
  if (!data?.table_json) {
    const count = await sampleCount().catch(() => 0);
    if (!count) return null;
    return rebuildAndSaveMoveTable();
  }
  const table = data.table_json as ZeroDteMoveTable;
  const capture = await latestMoveCapture().catch(() => null);
  return stateRead(table, Number(data.observation_count ?? 0), capture);
}

function stateRead(table: ZeroDteMoveTable, observationCount: number, capture: MoveCaptureLog | null): MoveTableStateRead {
  const sourceMix = table.sourceMix ?? { SCHWAB_1M: 0, SCHWAB_30M: 0 };
  const lastCaptureDate = table.lastCaptureDate ?? null;
  return {
    table,
    source: "supabase",
    observationCount,
    distinctDayCount: table.sessionCount,
    sourceMix,
    lastCaptureDate,
    capture,
    stale: isStale(lastCaptureDate),
  };
}

function isStale(lastCaptureDate: string | null) {
  if (!lastCaptureDate) return true;
  const today = centralToday();
  const acceptable = previousTradingSessionDate(today);
  return lastCaptureDate < acceptable;
}

function centralToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function maxTradeDate(observations: readonly MoveTableObservation[]) {
  return observations.map((item) => item.tradeDate).filter(Boolean).sort().at(-1) ?? null;
}
