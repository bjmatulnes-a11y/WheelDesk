import {
  type CandleRecord,
  type OptionSurfaceSnapshot,
  readCandles,
  readLatestOptionSurfaceSnapshot,
  readOptionSurfaceSnapshots,
  readWheelDeskStorage,
} from "./wheeldesk-storage";
import { buildTraderEdgeSummary, type TraderEdgeSummary } from "./trader-edge-engine";
import { buildWallMigrationSummary, findPriorSurfaceForTicker, type WallMigrationSummary } from "./oi-wall-migration-engine";

export type StructureNewsletterInputs = {
  weekOf: string;
  marketTicker: string;
  vixTicker?: string;
  stockOfInterest?: string;
  marketCall?: string;
  calendarNotes?: string;
  earningsNotes?: string;
  authorNote?: string;
  maxNotables?: number;
};

export type StructureReportRow = {
  ticker: string;
  snapshotDate: string;
  label: string;
  edgeScore: number;
  regime: string;
  spot: number | null;
  support: number | null;
  magnet: number | null;
  resistance: number | null;
  cspZone: number | null;
  ccZone: number | null;
  bullishUnlock: number | null;
  bearishFailure: number | null;
  rawSupport: number | null;
  rawMagnet: number | null;
  rawResistance: number | null;
  rawBullishUnlock: number | null;
  rawBearishFailure: number | null;
  suppressedRailNotes: string[];
  wallMigration: string;
  proof: string;
  action: string;
  trapNotes: string[];
  triggerNotes: string[];
  surface: OptionSurfaceSnapshot;
  edge: TraderEdgeSummary;
  migration: WallMigrationSummary | null;
};

export type StructureNewsletterReport = {
  generatedAt: string;
  weekOf: string;
  marketTicker: string;
  vixTicker: string;
  market: StructureReportRow | null;
  vix: StructureReportRow | null;
  stockOfInterest: StructureReportRow | null;
  notables: StructureReportRow[];
  marketCandles: CandleRecord[];
  vixCandles: CandleRecord[];
  stockCandles: CandleRecord[];
  marketCall: string;
  calendarNotes: string;
  earningsNotes: string;
  authorNote: string;
  executiveSummary: string;
  structureRead: string;
  premiumSellerImplication: string;
  markdown: string;
};

function normalizeTicker(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function dateKey(value: unknown): string {
  return String(value ?? "").slice(0, 10);
}

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function latestCandleClose(candles: CandleRecord[]): number | null {
  const last = candles.filter((candle) => Number.isFinite(candle.close)).at(-1);
  return last ? last.close : null;
}

function fmtMoney(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(value) >= 100) return value.toFixed(0);
  return value.toFixed(2);
}

function fmtScore(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return value.toFixed(0);
}

function getSavedCandlesForTicker(ticker: string): CandleRecord[] {
  const normalized = normalizeTicker(ticker);
  const candidates = Array.from(
    new Set([
      normalized,
      normalized.replace(/^\$/, "^"),
      normalized.replace(/^\^/, "$"),
      normalized === "SPX" ? "^SPX" : normalized,
      normalized === "^SPX" ? "SPX" : normalized,
      normalized === "$SPX" ? "^SPX" : normalized,
      normalized === "^GSPC" ? "^SPX" : normalized,
      normalized === "VIX" ? "^VIX" : normalized,
      normalized === "$VIX" ? "^VIX" : normalized,
    ])
  );

  for (const key of candidates) {
    const candles = readCandles(key);
    if (candles.length) return candles;
  }

  return [];
}

function latestSurfaceForAny(candidates: string[]): OptionSurfaceSnapshot | null {
  for (const ticker of candidates) {
    const direct = readLatestOptionSurfaceSnapshot(ticker);
    if (direct) return direct;
  }

  const storage = readWheelDeskStorage();
  const normalizedCandidates = new Set(candidates.map(normalizeTicker));
  const matches = storage.optionSurfaceSnapshots
    .filter((surface) => normalizedCandidates.has(normalizeTicker(surface.ticker)))
    .sort((a, b) => String(b.snapshotDate).localeCompare(String(a.snapshotDate)) || String(b.capturedAt).localeCompare(String(a.capturedAt)));

  return matches[0] ?? null;
}

export function getMarketTickerCandidates(ticker: string): string[] {
  const normalized = normalizeTicker(ticker);
  if (["SPX", "^SPX", "$SPX", "^GSPC", "GSPC"].includes(normalized)) return ["^SPX", "$SPX", "SPX", "^GSPC", "SPY"];
  if (["VIX", "^VIX", "$VIX"].includes(normalized)) return ["^VIX", "$VIX", "VIX"];
  return [normalized];
}

function getProofLabel(ticker: string, label: string): string {
  const storage = readWheelDeskStorage() as any;
  const summaries = Array.isArray(storage.edgeProofSummaries) ? storage.edgeProofSummaries : [];
  const normalizedLabel = label.toLowerCase();
  const byTickerAndLabel = summaries.find((summary: any) => {
    const summaryTicker = normalizeTicker(summary?.ticker ?? summary?.scopeTicker ?? "");
    const summaryLabel = String(summary?.label ?? "").toLowerCase();
    return summaryTicker === normalizeTicker(ticker) && summaryLabel === normalizedLabel;
  });
  const byLabel = summaries.find((summary: any) => String(summary?.label ?? "").toLowerCase() === normalizedLabel);
  const match = byTickerAndLabel ?? byLabel;
  if (!match) return "No proof yet";

  const grade = match.proofGrade ?? match.grade ?? "No proof";
  const adjusted = safeNumber(match.adjustedRate ?? match.adjustedProbability ?? match.adjusted);
  const evaluated = safeNumber(match.evaluated ?? match.samples ?? match.totalEvaluated);
  if (adjusted == null) return `${grade}`;
  return `${grade} · ${(adjusted * 100).toFixed(0)}% adj · ${evaluated ?? 0} samples`;
}

function railReasonable(args: {
  kind: "support" | "magnet" | "resistance" | "unlock" | "failure";
  value: number | null;
  spot: number | null;
  ticker: string;
}): { value: number | null; note?: string } {
  const { kind, value, spot, ticker } = args;
  if (value == null || !Number.isFinite(value)) return { value: null };
  if (spot == null || !Number.isFinite(spot) || spot <= 0) return { value };

  const ratio = value / spot;
  const isVol = normalizeTicker(ticker).includes("VIX");
  const maxUpside = isVol ? 2.5 : 1.25;
  const minDownside = isVol ? 0.25 : 0.75;

  if (ratio > maxUpside || ratio < minDownside) {
    return {
      value: null,
      note: `${kind} rail ${fmtMoney(value)} suppressed because it is ${(ratio * 100).toFixed(0)}% of spot ${fmtMoney(spot)}.`,
    };
  }

  return { value };
}

function buildRow(surface: OptionSurfaceSnapshot): StructureReportRow | null {
  const ticker = normalizeTicker(surface.ticker);
  const candles = getSavedCandlesForTicker(ticker);
  const edge = buildTraderEdgeSummary({ ticker, surface, candles, livePrice: null });

  const allTickerSurfaces = readOptionSurfaceSnapshots(ticker);
  const priorSurface = findPriorSurfaceForTicker(allTickerSurfaces, ticker, surface.snapshotDate);
  const migration = buildWallMigrationSummary({ currentSurface: surface, priorSurface });

  const spot = safeNumber(edge.analysisPrice) ?? safeNumber(edge.livePrice) ?? safeNumber(surface.price?.close) ?? latestCandleClose(candles);
  const rawSupport = safeNumber(edge.support);
  const rawResistance = safeNumber(edge.resistance);
  const rawMagnet = safeNumber(edge.magnet);
  const cushion = Math.max(0.001, Math.min(0.01, (safeNumber(edge.cushionPct) ?? 0.025) * 0.2));
  const rawBullishUnlock = rawResistance != null ? rawResistance * (1 + cushion) : null;
  const rawBearishFailure = rawSupport != null ? rawSupport * (1 - cushion) : null;

  const notes: string[] = [];
  const supportRail = railReasonable({ kind: "support", value: rawSupport, spot, ticker });
  const magnetRail = railReasonable({ kind: "magnet", value: rawMagnet, spot, ticker });
  const resistanceRail = railReasonable({ kind: "resistance", value: rawResistance, spot, ticker });
  const unlockRail = railReasonable({ kind: "unlock", value: rawBullishUnlock, spot, ticker });
  const failureRail = railReasonable({ kind: "failure", value: rawBearishFailure, spot, ticker });

  [supportRail, magnetRail, resistanceRail, unlockRail, failureRail].forEach((rail) => {
    if (rail.note) notes.push(rail.note);
  });

  const label = edge.actionBucket;

  return {
    ticker,
    snapshotDate: dateKey(surface.snapshotDate),
    label,
    edgeScore: edge.edgeScore,
    regime: edge.compressionState,
    spot,
    support: supportRail.value,
    magnet: magnetRail.value,
    resistance: resistanceRail.value,
    cspZone: railReasonable({ kind: "support", value: safeNumber(edge.executableCspCeiling), spot, ticker }).value,
    ccZone: railReasonable({ kind: "resistance", value: safeNumber(edge.executableCoveredCallFloor), spot, ticker }).value,
    bullishUnlock: unlockRail.value,
    bearishFailure: failureRail.value,
    rawSupport,
    rawMagnet,
    rawResistance,
    rawBullishUnlock,
    rawBearishFailure,
    suppressedRailNotes: notes,
    wallMigration: migration?.label ?? "No prior comparison",
    proof: getProofLabel(ticker, label),
    action: edge.bestAction,
    trapNotes: edge.trapNotes ?? [],
    triggerNotes: edge.triggerNotes ?? [],
    surface,
    edge,
    migration,
  };
}

function getLatestRows(): StructureReportRow[] {
  const storage = readWheelDeskStorage();
  const latestByTicker = new Map<string, OptionSurfaceSnapshot>();

  for (const surface of storage.optionSurfaceSnapshots) {
    const ticker = normalizeTicker(surface.ticker);
    const existing = latestByTicker.get(ticker);
    if (!existing || String(surface.snapshotDate).localeCompare(String(existing.snapshotDate)) > 0) {
      latestByTicker.set(ticker, surface);
    }
  }

  return Array.from(latestByTicker.values())
    .map(buildRow)
    .filter((row): row is StructureReportRow => row != null)
    .sort((a, b) => b.edgeScore - a.edgeScore);
}

function inferStructureRead(market: StructureReportRow | null, vix: StructureReportRow | null): string {
  if (!market) return "No saved SPX/SPY surface is available. Save a daily market-index OI surface before publishing the structure note.";

  const insideRange = market.support != null && market.resistance != null && market.spot != null && market.spot >= market.support && market.spot <= market.resistance;
  const parts: string[] = [];
  parts.push(`${market.ticker} is the structure anchor. Spot is ${fmtMoney(market.spot)} against support ${fmtMoney(market.support)}, magnet ${fmtMoney(market.magnet)}, and resistance ${fmtMoney(market.resistance)}.`);
  parts.push(insideRange ? "Price is inside the active OI range, so the base case is range respect until an unlock/failure rail is accepted." : "Price is outside or near the edge of the active OI range, so confirmation matters more than the raw wall." );
  if (market.bullishUnlock != null || market.bearishFailure != null) {
    parts.push(`The regime changes above ${fmtMoney(market.bullishUnlock)} or below ${fmtMoney(market.bearishFailure)}.`);
  }
  if (market.wallMigration && market.wallMigration !== "No prior comparison") {
    parts.push(`Wall migration: ${market.wallMigration}.`);
  }
  if (market.suppressedRailNotes.length) {
    parts.push("One or more rails were suppressed by the sanity filter; the report should use the visible guardrails only.");
  }
  if (vix) {
    parts.push(`Volatility check: ${vix.ticker} is reading ${vix.label.toLowerCase()} with VIX structure around ${fmtMoney(vix.support)} / ${fmtMoney(vix.magnet)} / ${fmtMoney(vix.resistance)}.`);
  }
  return parts.join(" ");
}

function inferPremiumSellerImplication(market: StructureReportRow | null): string {
  if (!market) return "Without a saved market-index structure, keep the advisory qualitative and avoid specific premium-sale conclusions.";
  const label = market.label.toLowerCase();
  const rangeText = `${fmtMoney(market.support)} to ${fmtMoney(market.resistance)}`;
  if (label.includes("compression")) {
    return `The market is structure-first. Inside the ${rangeText} range, premium sellers should avoid assuming the middle is safe. Wait for a confirmed unlock/failure or sell only outside the guardrails.`;
  }
  if (label.includes("csp")) {
    return `The put side has the cleaner structure, but index premium still needs cushion. Treat ${fmtMoney(market.support)} as the downside reference and avoid selling too close to spot when calendar risk is elevated.`;
  }
  if (label.includes("trap")) {
    return "The structure is warning that the obvious premium sale may be a trap. Reduce strike aggressiveness and require price confirmation before selling into the wall.";
  }
  if (label.includes("low-edge") || label.includes("wait")) {
    return `The best trade may be no trade. Low-edge structure favors patience, smaller sizing, or wider strikes until price clears ${fmtMoney(market.bullishUnlock)} or loses ${fmtMoney(market.bearishFailure)}.`;
  }
  return "Use the structure as a guardrail map, not a prediction. Premium should be sold only where the strike sits outside the active OI range and the event calendar does not invalidate the setup.";
}

function defaultMarketCall(market: StructureReportRow | null): string {
  if (!market) return "Market structure is not yet populated. Save the SPX/SPY OI surface first, then write the weekly call around support, magnet, resistance, and volatility.";
  return `The weekly structure is centered on ${market.ticker}. The base case is respect for the active range between ${fmtMoney(market.support)} and ${fmtMoney(market.resistance)}. A bullish posture requires acceptance above ${fmtMoney(market.bullishUnlock)}; defensive posture increases below ${fmtMoney(market.bearishFailure)}. Until one of those rails breaks, this is a structure-first environment.`;
}

function markdownNotables(rows: StructureReportRow[]): string {
  if (!rows.length) return "No concise notables this week.";
  return [
    "| Ticker | Read | Edge | Structure | Note |",
    "|---|---:|---:|---|---|",
    ...rows.map((row) => `| ${row.ticker} | ${row.label} | ${fmtScore(row.edgeScore)} | ${fmtMoney(row.support)} / ${fmtMoney(row.magnet)} / ${fmtMoney(row.resistance)} | ${row.action.replace(/\|/g, "/")} |`),
  ].join("\n");
}

function buildMarkdown(report: Omit<StructureNewsletterReport, "markdown">): string {
  const lines: string[] = [];
  const market = report.market;
  const stock = report.stockOfInterest;
  lines.push("# WheelDesk Weekly Structure Note");
  lines.push(`Week of ${report.weekOf}`);
  lines.push("");
  lines.push("## Executive Market Call");
  lines.push(report.marketCall);
  lines.push("");
  lines.push("## SPX / Market Structure");
  lines.push(report.structureRead);
  if (market) {
    lines.push("");
    lines.push(`- Spot: ${fmtMoney(market.spot)}`);
    lines.push(`- Support / Magnet / Resistance: ${fmtMoney(market.support)} / ${fmtMoney(market.magnet)} / ${fmtMoney(market.resistance)}`);
    lines.push(`- Bullish unlock / Bearish failure: ${fmtMoney(market.bullishUnlock)} / ${fmtMoney(market.bearishFailure)}`);
    lines.push(`- Wall migration: ${market.wallMigration}`);
  }
  lines.push("");
  lines.push("## Premium Seller Implication");
  lines.push(report.premiumSellerImplication);
  lines.push("");
  lines.push("## Market Calendar / Macro Events");
  lines.push(report.calendarNotes || "No major calendar notes entered.");
  lines.push("");
  lines.push("## Earnings / Event Watch");
  lines.push(report.earningsNotes || "No earnings/event notes entered.");
  lines.push("");
  if (report.vix) {
    lines.push("## VIX / Volatility Structure");
    lines.push(`${report.vix.ticker}: ${report.vix.label}, support ${fmtMoney(report.vix.support)}, magnet ${fmtMoney(report.vix.magnet)}, resistance ${fmtMoney(report.vix.resistance)}.`);
    lines.push("");
  }
  if (stock) {
    lines.push(`## Stock of Interest: ${stock.ticker}`);
    lines.push(`${stock.label}. Structure: ${fmtMoney(stock.support)} / ${fmtMoney(stock.magnet)} / ${fmtMoney(stock.resistance)}. Plan: ${stock.action}`);
    lines.push("");
  }
  lines.push("## Concise Notables");
  lines.push(markdownNotables(report.notables));
  lines.push("");
  lines.push("## Risk Framework");
  lines.push("This advisory is a market-structure map, not a price prediction. OI walls are reference zones. News, earnings, macro events, and fresh flow can invalidate the structure. Use the rails to define where the read changes, not as guaranteed targets.");
  if (report.authorNote) {
    lines.push("");
    lines.push("## Author Note");
    lines.push(report.authorNote);
  }
  return lines.join("\n");
}

export function buildStructureNewsletterReport(inputs: StructureNewsletterInputs): StructureNewsletterReport {
  const weekOf = dateKey(inputs.weekOf || new Date().toISOString());
  const marketCandidates = getMarketTickerCandidates(inputs.marketTicker || "^SPX");
  const marketSurface = latestSurfaceForAny(marketCandidates);
  const market = marketSurface ? buildRow(marketSurface) : null;

  const vixSurface = latestSurfaceForAny(getMarketTickerCandidates(inputs.vixTicker || "^VIX"));
  const vix = vixSurface ? buildRow(vixSurface) : null;

  const stockTicker = normalizeTicker(inputs.stockOfInterest || "");
  const stockSurface = stockTicker ? latestSurfaceForAny([stockTicker]) : null;
  const stockOfInterest = stockSurface ? buildRow(stockSurface) : null;

  const allRows = getLatestRows();
  const excluded = new Set([market?.ticker, vix?.ticker, stockOfInterest?.ticker].filter(Boolean) as string[]);
  const notables = allRows
    .filter((row) => !excluded.has(row.ticker))
    .filter((row) => row.label === "Compression coil" || row.label.includes("trap") || row.edgeScore >= 65)
    .slice(0, inputs.maxNotables ?? 3);

  const structureRead = inferStructureRead(market, vix);
  const premiumSellerImplication = inferPremiumSellerImplication(market);
  const marketCall = inputs.marketCall?.trim() || defaultMarketCall(market);

  const base: Omit<StructureNewsletterReport, "markdown"> = {
    generatedAt: new Date().toISOString(),
    weekOf,
    marketTicker: normalizeTicker(inputs.marketTicker || "^SPX"),
    vixTicker: normalizeTicker(inputs.vixTicker || "^VIX"),
    market,
    vix,
    stockOfInterest,
    notables,
    marketCandles: getSavedCandlesForTicker(inputs.marketTicker || "^SPX"),
    vixCandles: getSavedCandlesForTicker(inputs.vixTicker || "^VIX"),
    stockCandles: stockTicker ? getSavedCandlesForTicker(stockTicker) : [],
    marketCall,
    calendarNotes: inputs.calendarNotes?.trim() ?? "",
    earningsNotes: inputs.earningsNotes?.trim() ?? "",
    authorNote: inputs.authorNote?.trim() ?? "",
    executiveSummary: marketCall,
    structureRead,
    premiumSellerImplication,
  };

  return { ...base, markdown: buildMarkdown(base) };
}

export function listNewsletterTickers(): string[] {
  const storage = readWheelDeskStorage();
  return Array.from(new Set(storage.optionSurfaceSnapshots.map((surface) => normalizeTicker(surface.ticker)).filter(Boolean))).sort();
}

export function reportMoney(value?: number | null): string {
  return fmtMoney(value);
}

export function reportScore(value?: number | null): string {
  return fmtScore(value);
}
