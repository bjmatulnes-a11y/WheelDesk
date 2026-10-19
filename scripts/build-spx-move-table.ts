/**
 * Build WheelDesk's empirical SPX remaining-move table.
 *
 * Usage (CSV seed; recommended if Schwab minute history is shallow):
 *   npx tsx scripts/build-spx-move-table.ts --spx-csv ./data/spx-1m.csv --vix-csv ./data/vix-daily.csv
 *   # After the close, a job may merge only the new session sample into an existing table:
 *   npx tsx scripts/build-spx-move-table.ts --spx-csv ./data/latest.csv --vix-csv ./data/vix-daily.csv --append-existing
 *
 * CSV formats:
 *   SPX: time,open,high,low,close  (time may be ISO or epoch seconds/ms)
 *   VIX: date,close                (YYYY-MM-DD; close is that session's VIX close)
 *
 * Optional authenticated WheelDesk API pull:
 *   npx tsx scripts/build-spx-move-table.ts --api-base http://localhost:3000 --bearer "$TOKEN"
 *
 * The API path is intentionally best-effort because Schwab controls intraday lookback.
 * If fewer than ~120 sessions are returned, the script logs a warning and accepts --spx-csv
 * as a supplemental/seed source.
 */
import fs from "node:fs";
import path from "node:path";
import {
  buildMoveTableFromSessions,
  mergeZeroDteMoveTables,
  type HistoricalSessionInput,
} from "../src/lib/zeroDteMoveTable";
import type { StructureCandle } from "../src/lib/zeroDteStructureMap";

const args = parseArgs(process.argv.slice(2));
const output = path.resolve(args.out ?? "public/data/spx-move-table.json");

async function main() {
  let candles: StructureCandle[] = [];
  if (args["spx-csv"]) candles.push(...readSpXCsv(path.resolve(args["spx-csv"])));
  if (args["api-base"] && args.bearer) {
    const apiCandles = await fetchFromWheelDeskApi(args["api-base"], args.bearer);
    candles.push(...apiCandles);
  }
  candles = dedupeCandles(candles);
  if (!candles.length) throw new Error("No SPX minute candles loaded. Provide --spx-csv or --api-base + --bearer.");

  const sessionsByDate = groupByCentralDate(candles);
  const dates = [...sessionsByDate.keys()].sort();
  console.log(`Loaded ${dates.length} SPX sessions (${candles.length.toLocaleString()} minute rows).`);
  if (dates.length < 120) {
    console.warn(`WARNING: only ${dates.length} sessions are available. Seed with a longer --spx-csv history if possible.`);
  }

  let vixByDate = args["vix-csv"] ? readVixCsv(path.resolve(args["vix-csv"])) : new Map<string, number>();
  if (!vixByDate.size && args["api-base"] && args.bearer) {
    vixByDate = await fetchVixFromWheelDeskApi(args["api-base"], args.bearer);
  }
  if (!vixByDate.size) console.warn("WARNING: no VIX history available; sessions without a prior VIX close will be skipped.");

  const sessions: HistoricalSessionInput[] = [];
  for (let i = 0; i < dates.length; i += 1) {
    const tradeDate = dates[i];
    const priorDate = dates[i - 1] ?? null;
    const priorVixClose = priorDate ? vixByDate.get(priorDate) ?? null : null;
    sessions.push({ tradeDate, candles: sessionsByDate.get(tradeDate) ?? [], priorVixClose });
  }

  const built = buildMoveTableFromSessions(sessions);
  const table = args["append-existing"] === "1" && fs.existsSync(output)
    ? mergeZeroDteMoveTables(JSON.parse(fs.readFileSync(output, "utf8")), built)
    : built;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(table, null, 2));
  console.log(`Wrote ${table.buckets.length} conditioned buckets from ${table.sessionCount} session inputs to ${output}.`);
  if (args["append-existing"] === "1") console.log("Append mode enabled: incoming bucket arrays were merged into the existing table.");
}

async function fetchFromWheelDeskApi(base: string, bearer: string): Promise<StructureCandle[]> {
  const url = new URL("/api/brokers/schwab/price-history", base);
  url.searchParams.set("symbol", "$SPX");
  url.searchParams.set("frequencyType", "minute");
  url.searchParams.set("frequency", "1");
  url.searchParams.set("periodType", "day");
  url.searchParams.set("period", "10");
  url.searchParams.set("extended", "0");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${bearer}` } });
  if (!response.ok) throw new Error(`WheelDesk history request failed: ${response.status} ${await response.text()}`);
  const json: any = await response.json();
  return (json.candles ?? []).map((row: any) => ({
    time: Number(row.time), open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), volume: null,
  })).filter(validCandle);
}

async function fetchVixFromWheelDeskApi(base: string, bearer: string): Promise<Map<string, number>> {
  const url = new URL("/api/brokers/schwab/price-history", base);
  url.searchParams.set("symbol", "$VIX");
  url.searchParams.set("frequencyType", "daily");
  url.searchParams.set("frequency", "1");
  url.searchParams.set("periodType", "month");
  url.searchParams.set("period", "3");
  url.searchParams.set("extended", "0");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${bearer}` } });
  if (!response.ok) {
    console.warn(`WARNING: VIX daily history request failed: ${response.status} ${await response.text()}`);
    return new Map();
  }
  const json: any = await response.json();
  const out = new Map<string, number>();
  for (const row of json.candles ?? []) {
    const time = Number(row.time);
    const close = Number(row.close);
    if (Number.isFinite(time) && Number.isFinite(close) && close > 0) out.set(marketDate(time), close);
  }
  console.log(`Loaded ${out.size} daily VIX closes from WheelDesk/Schwab.`);
  return out;
}

function readSpXCsv(file: string): StructureCandle[] {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = splitCsv(lines[0]).map((value) => value.trim().toLowerCase());
  const idx = (name: string) => headers.indexOf(name);
  const required = ["time", "open", "high", "low", "close"];
  for (const name of required) if (idx(name) < 0) throw new Error(`SPX CSV is missing '${name}'.`);
  return lines.slice(1).map((line) => {
    const row = splitCsv(line);
    const rawTime = row[idx("time")];
    const numericTime = Number(rawTime);
    const time = Number.isFinite(numericTime)
      ? Math.floor(numericTime > 1e12 ? numericTime / 1000 : numericTime)
      : Math.floor(Date.parse(rawTime) / 1000);
    return {
      time,
      open: Number(row[idx("open")]), high: Number(row[idx("high")]), low: Number(row[idx("low")]), close: Number(row[idx("close")]),
      volume: null,
    } satisfies StructureCandle;
  }).filter(validCandle);
}

function readVixCsv(file: string): Map<string, number> {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  if (!lines.length) return new Map();
  const headers = splitCsv(lines[0]).map((value) => value.trim().toLowerCase());
  const dateIndex = headers.indexOf("date");
  const closeIndex = headers.indexOf("close");
  if (dateIndex < 0 || closeIndex < 0) throw new Error("VIX CSV requires date,close columns.");
  const out = new Map<string, number>();
  for (const line of lines.slice(1)) {
    const row = splitCsv(line);
    const close = Number(row[closeIndex]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(row[dateIndex]) && Number.isFinite(close) && close > 0) out.set(row[dateIndex], close);
  }
  return out;
}

function groupByCentralDate(candles: readonly StructureCandle[]): Map<string, StructureCandle[]> {
  const out = new Map<string, StructureCandle[]>();
  for (const candle of candles) {
    const date = centralDate(candle.time);
    const bucket = out.get(date) ?? [];
    bucket.push(candle);
    out.set(date, bucket);
  }
  for (const rows of out.values()) rows.sort((a, b) => a.time - b.time);
  return out;
}

function marketDate(epochSeconds: number) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(epochSeconds * 1000));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function centralDate(epochSeconds: number) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(epochSeconds * 1000));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function dedupeCandles(candles: readonly StructureCandle[]) {
  const byTime = new Map<number, StructureCandle>();
  for (const candle of candles) if (validCandle(candle)) byTime.set(candle.time, candle);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

function validCandle(candle: StructureCandle) {
  return [candle.time, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) && candle.high >= candle.low;
}

function splitCsv(line: string) {
  const result: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === "," && !quoted) { result.push(value); value = ""; }
    else value += ch;
  }
  result.push(value);
  return result;
}

function parseArgs(values: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < values.length; i += 1) {
    const current = values[i];
    if (!current.startsWith("--")) continue;
    const key = current.slice(2);
    const next = values[i + 1];
    if (next && !next.startsWith("--")) { out[key] = next; i += 1; }
    else out[key] = "1";
  }
  return out;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
