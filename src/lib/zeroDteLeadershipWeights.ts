import { inflateRawSync } from "node:zlib";
import { supabaseServer } from "./supabase-server";

export type ZeroDteLeadershipWeight = {
  symbol: string;
  providerSymbol: string;
  name: string;
  weightPct: number;
  normalizedWeight: number;
  rank: number;
};

export type ZeroDteLeadershipWeightSnapshot = {
  tradeDate: string;
  asOfDate: string | null;
  source: "STATE_STREET_SPY_DAILY" | "PRIOR_VALID_SNAPSHOT" | "THINKSCRIPT_2023_FALLBACK";
  sourceUrl: string;
  fetchedAt: string;
  cumulativeWeightPct: number;
  targetWeightPct: number;
  constituents: ZeroDteLeadershipWeight[];
  warnings: string[];
};

const DEFAULT_HOLDINGS_URL =
  "https://www.ssga.com/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spy.xlsx";

const FALLBACK_2023: Array<[string, string, number]> = [
  ["AAPL", "Apple Inc.", 6.32],
  ["MSFT", "Microsoft Corporation", 6.71],
  ["NVDA", "NVIDIA Corporation", 6.57],
  ["AMZN", "Amazon.com Inc.", 3.85],
  ["META", "Meta Platforms Inc. Class A", 2.81],
  ["TSLA", "Tesla Inc.", 1.91],
  ["GOOGL", "Alphabet Inc. Class A", 1.9],
  ["AVGO", "Broadcom Inc.", 2.17],
  ["GOOG", "Alphabet Inc. Class C", 1.56],
  ["BRK/B", "Berkshire Hathaway Inc. Class B", 1.85],
];

const memory = new Map<string, ZeroDteLeadershipWeightSnapshot>();

export async function getDailyLeadershipWeightSnapshot(args: {
  tradeDate: string;
  forceRefresh?: boolean;
  minConstituents?: number;
  maxConstituents?: number;
  targetWeightPct?: number;
}): Promise<ZeroDteLeadershipWeightSnapshot> {
  const minConstituents = clampInt(args.minConstituents ?? 10, 5, 25);
  const maxConstituents = clampInt(
    args.maxConstituents ?? 10,
    minConstituents,
    50,
  );
  const targetWeightPct = clamp(args.targetWeightPct ?? 40, 20, 80);

  if (!args.forceRefresh) {
    const cached = memory.get(args.tradeDate);
    if (cached) return cached;
    const saved = await loadSaved(args.tradeDate);
    if (saved && isValidLeadershipSnapshot(saved)) {
      memory.set(args.tradeDate, saved);
      return saved;
    }
  }

  const sourceUrl =
    process.env.ZERO_DTE_SPY_HOLDINGS_URL?.trim() || DEFAULT_HOLDINGS_URL;

  try {
    const response = await fetch(sourceUrl, {
      headers: {
        accept:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream;q=0.9,*/*;q=0.5",
        "user-agent": "WheelDesk/1.0 SPX-Mood-Leadership",
      },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`State Street holdings request failed ${response.status}`);
    }
    const rows = parseSpyHoldingsXlsx(Buffer.from(await response.arrayBuffer()));
    if (rows.length < minConstituents) {
      throw new Error(`Only ${rows.length} usable equity holdings were parsed.`);
    }
    validateParsedHoldings(rows);
    const selected = selectLeadershipRows(
      rows,
      minConstituents,
      maxConstituents,
      targetWeightPct,
    );
    const asOfDate = inferAsOfDate(rows.flatMap((row) => [row.name, row.rawDate ?? ""]));
    const snapshot = finalizeSnapshot({
      tradeDate: args.tradeDate,
      asOfDate,
      source: "STATE_STREET_SPY_DAILY",
      sourceUrl,
      targetWeightPct,
      rows: selected,
      warnings: [],
    });
    await saveSnapshot(snapshot);
    memory.set(args.tradeDate, snapshot);
    return snapshot;
  } catch (error) {
    const warning = error instanceof Error ? error.message : String(error);
    const prior = await loadLatestPrior(args.tradeDate);
    if (prior && isValidLeadershipSnapshot(prior)) {
      const snapshot: ZeroDteLeadershipWeightSnapshot = {
        ...prior,
        tradeDate: args.tradeDate,
        source: "PRIOR_VALID_SNAPSHOT",
        fetchedAt: new Date().toISOString(),
        warnings: [
          ...prior.warnings,
          `Daily holdings refresh failed; prior valid weights retained: ${warning}`,
        ],
      };
      await saveSnapshot(snapshot);
      memory.set(args.tradeDate, snapshot);
      return snapshot;
    }

    const snapshot = finalizeSnapshot({
      tradeDate: args.tradeDate,
      asOfDate: "2023-01-12",
      source: "THINKSCRIPT_2023_FALLBACK",
      sourceUrl,
      targetWeightPct,
      rows: FALLBACK_2023.map(([symbol, name, weightPct]) => ({
        symbol,
        name,
        weightPct,
      })),
      warnings: [
        `Daily holdings refresh failed and no prior snapshot exists: ${warning}`,
        "Using the uploaded January 2023 ThinkScript basket as an emergency fallback only.",
      ],
    });
    await saveSnapshot(snapshot);
    memory.set(args.tradeDate, snapshot);
    return snapshot;
  }
}

export function normalizeLeadershipProviderSymbol(symbol: string) {
  const upper = symbol.trim().toUpperCase();
  if (upper === "BRK.B" || upper === "BRK-B") return "BRK/B";
  if (upper === "BF.B" || upper === "BF-B") return "BF/B";
  return upper.replace(".", "/");
}

type ParsedHolding = {
  symbol: string;
  name: string;
  weightPct: number;
  rawDate?: string | null;
};

function selectLeadershipRows(
  rows: ParsedHolding[],
  min: number,
  max: number,
  target: number,
) {
  const sorted = [...rows]
    .filter((row) => row.weightPct > 0 && row.symbol)
    .sort((a, b) => b.weightPct - a.weightPct);
  const selected: ParsedHolding[] = [];
  let cumulative = 0;
  for (const row of sorted) {
    if (selected.length >= max) break;
    selected.push(row);
    cumulative += row.weightPct;
    if (selected.length >= min && cumulative >= target) break;
  }
  return selected;
}

function finalizeSnapshot(args: {
  tradeDate: string;
  asOfDate: string | null;
  source: ZeroDteLeadershipWeightSnapshot["source"];
  sourceUrl: string;
  targetWeightPct: number;
  rows: ParsedHolding[];
  warnings: string[];
}): ZeroDteLeadershipWeightSnapshot {
  const cumulativeWeightPct = args.rows.reduce((sum, row) => sum + row.weightPct, 0);
  const denominator = Math.max(cumulativeWeightPct, 0.0001);
  return {
    tradeDate: args.tradeDate,
    asOfDate: args.asOfDate,
    source: args.source,
    sourceUrl: args.sourceUrl,
    fetchedAt: new Date().toISOString(),
    cumulativeWeightPct,
    targetWeightPct: args.targetWeightPct,
    constituents: args.rows.map((row, index) => ({
      symbol: row.symbol,
      providerSymbol: normalizeLeadershipProviderSymbol(row.symbol),
      name: row.name,
      weightPct: row.weightPct,
      normalizedWeight: row.weightPct / denominator,
      rank: index + 1,
    })),
    warnings: args.warnings,
  };
}

async function loadSaved(tradeDate: string) {
  try {
    const { data, error } = await supabaseServer
      .from("zero_dte_leadership_weight_snapshots")
      .select("*")
      .eq("trade_date", tradeDate)
      .maybeSingle();
    if (error || !data) return null;
    return rowToSnapshot(data);
  } catch {
    return null;
  }
}

async function loadLatestPrior(tradeDate: string) {
  try {
    const { data, error } = await supabaseServer
      .from("zero_dte_leadership_weight_snapshots")
      .select("*")
      .lt("trade_date", tradeDate)
      .order("trade_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return rowToSnapshot(data);
  } catch {
    return null;
  }
}

async function saveSnapshot(snapshot: ZeroDteLeadershipWeightSnapshot) {
  try {
    await supabaseServer.from("zero_dte_leadership_weight_snapshots").upsert(
      {
        trade_date: snapshot.tradeDate,
        as_of_date: snapshot.asOfDate,
        source: snapshot.source,
        source_url: snapshot.sourceUrl,
        fetched_at: snapshot.fetchedAt,
        cumulative_weight_pct: snapshot.cumulativeWeightPct,
        target_weight_pct: snapshot.targetWeightPct,
        constituents: snapshot.constituents,
        warnings: snapshot.warnings,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "trade_date" },
    );
  } catch {
    // The in-memory copy keeps the route functional until the migration is applied.
  }
}

function rowToSnapshot(row: any): ZeroDteLeadershipWeightSnapshot {
  return {
    tradeDate: row.trade_date,
    asOfDate: row.as_of_date ?? null,
    source: row.source,
    sourceUrl: row.source_url ?? DEFAULT_HOLDINGS_URL,
    fetchedAt: row.fetched_at,
    cumulativeWeightPct: Number(row.cumulative_weight_pct ?? 0),
    targetWeightPct: Number(row.target_weight_pct ?? 40),
    constituents: Array.isArray(row.constituents) ? row.constituents : [],
    warnings: Array.isArray(row.warnings) ? row.warnings : [],
  };
}

export function parseSpyHoldingsXlsx(buffer: Buffer): ParsedHolding[] {
  const files = unzipFiles(buffer);
  const sharedStrings = parseSharedStrings(files.get("xl/sharedStrings.xml"));
  const sheets = [...files.entries()]
    .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .map(([, data]) => parseWorksheet(data.toString("utf8"), sharedStrings));

  for (const rows of sheets) {
    const asOfDate = inferAsOfDate(rows.flat());
    const result = holdingsFromRows(rows).map((row) => ({
      ...row,
      rawDate: asOfDate,
    }));
    if (result.length) return result;
  }
  return [];
}

function holdingsFromRows(rows: string[][]): ParsedHolding[] {
  const headerIndex = rows.findIndex((row) => {
    const normalized = row.map(normalizeHeader);
    return normalized.some((value) => value === "ticker") &&
      normalized.some((value) => value.includes("weight"));
  });
  if (headerIndex < 0) return [];

  const header = rows[headerIndex].map(normalizeHeader);
  const tickerIndex = header.findIndex((value) => value === "ticker");
  const nameIndex = header.findIndex((value) =>
    ["name", "securityname", "holdingname"].includes(value),
  );
  const weightIndex = header.findIndex((value) => value.includes("weight"));
  const assetIndex = header.findIndex((value) => value.includes("assetclass"));
  if (tickerIndex < 0 || weightIndex < 0) return [];

  const result: ParsedHolding[] = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const symbol = (row[tickerIndex] ?? "").trim().toUpperCase();
    const name = (row[nameIndex] ?? symbol).trim();
    const weightPct = parsePercent(row[weightIndex]);
    const asset = (row[assetIndex] ?? "").toLowerCase();
    if (!symbol || symbol === "-" || symbol.includes("CASH")) continue;
    if (asset && !asset.includes("equity") && !asset.includes("stock")) continue;
    if (!(weightPct > 0)) continue;
    result.push({ symbol, name, weightPct });
  }
  return result;
}

function unzipFiles(buffer: Buffer) {
  const files = new Map<string, Buffer>();
  const eocd = findSignatureBackwards(buffer, 0x06054b50);
  if (eocd < 0) throw new Error("Invalid XLSX ZIP: end directory not found.");
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);

  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer
      .subarray(offset + 46, offset + 46 + fileNameLength)
      .toString("utf8");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const content =
      compression === 0
        ? compressed
        : compression === 8
          ? inflateRawSync(compressed)
          : null;
    if (content) files.set(name, content);
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return files;
}

function parseSharedStrings(buffer: Buffer | undefined) {
  if (!buffer) return [] as string[];
  const xml = buffer.toString("utf8");
  return [...xml.matchAll(/<si[ >][\s\S]*?<\/si>/g)].map((match) =>
    [...match[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
      .map((item) => decodeXml(item[1]))
      .join(""),
  );
}

function parseWorksheet(xml: string, sharedStrings: string[]) {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1] ?? "A";
      const index = columnIndex(ref);
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "";
      const raw = /<v[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
      const inline = /<is[ >][\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/.exec(body)?.[1];
      row[index] =
        type === "s"
          ? sharedStrings[Number(raw)] ?? ""
          : inline !== undefined
            ? decodeXml(inline)
            : decodeXml(raw);
    }
    rows.push(row);
  }
  return rows;
}

function inferAsOfDate(values: string[]) {
  const joined = values.join(" ");
  const iso = /\b(20\d{2})[-\/]([01]?\d)[-\/]([0-3]?\d)\b/.exec(joined);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const named = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(20\d{2})\b/i.exec(joined);
  if (!named) return null;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const month = months.findIndex((item) => named[1].toLowerCase().startsWith(item)) + 1;
  return `${named[3]}-${String(month).padStart(2, "0")}-${named[2].padStart(2, "0")}`;
}

function columnIndex(letters: string) {
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return value - 1;
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parsePercent(value: string | undefined) {
  if (!value) return 0;
  const numeric = Number(value.replace(/[%,$\s]/g, ""));
  if (!Number.isFinite(numeric)) return 0;

  /**
   * State Street's SPY workbook stores the Weight column in percentage points.
   * Examples:
   *   7.71   means 7.71%
   *   0.9828 means 0.9828%, not 98.28%
   *
   * Do not multiply values below 1 by 100. That previously promoted ordinary
   * sub-1% holdings above the actual index leaders.
   */
  return numeric;
}

function validateParsedHoldings(rows: ParsedHolding[]) {
  const totalWeight = rows.reduce((sum, row) => sum + row.weightPct, 0);
  const largestWeight = Math.max(...rows.map((row) => row.weightPct));

  if (largestWeight > 25) {
    throw new Error(
      `Parsed SPY holding weight ${largestWeight.toFixed(2)}% is not credible; refusing the workbook.`,
    );
  }

  if (totalWeight < 85 || totalWeight > 115) {
    throw new Error(
      `Parsed SPY holdings total ${totalWeight.toFixed(2)}%; expected approximately 100%.`,
    );
  }
}

function isValidLeadershipSnapshot(
  snapshot: ZeroDteLeadershipWeightSnapshot,
) {
  if (!Array.isArray(snapshot.constituents) || snapshot.constituents.length < 10) {
    return false;
  }

  const weights = snapshot.constituents.map((item) => Number(item.weightPct));
  if (weights.some((weight) => !Number.isFinite(weight) || weight <= 0 || weight > 25)) {
    return false;
  }

  const selectedTotal = weights.reduce((sum, weight) => sum + weight, 0);
  return selectedTotal >= 20 && selectedTotal <= 60;
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function findSignatureBackwards(buffer: Buffer, signature: number) {
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65_557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) return offset;
  }
  return -1;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number) {
  return Math.round(clamp(value, min, max));
}
