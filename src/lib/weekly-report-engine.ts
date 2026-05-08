import {
  readWheelDeskStorage,
  type CandleRecord,
  type OptionSurfaceSnapshot,
} from "./wheeldesk-storage";
import {
  buildTraderEdgeSummary,
  type ActionBucket,
  type TraderEdgeSummary,
} from "./trader-edge-engine";
import {
  buildWallMigrationSummary,
  findPriorSurfaceForTicker,
  type WallMigrationSummary,
} from "./oi-wall-migration-engine";

export type WeeklyReportTone = "subscriber" | "internal" | "marketing_sample";

export type WeeklyReportRow = {
  ticker: string;
  snapshotDate: string;
  actionBucket: ActionBucket;
  compression: string;
  edgeScore: number;
  proofText: string;
  proofAdjustedRate: number | null;
  proofGrade: string;
  support: number | null;
  magnet: number | null;
  resistance: number | null;
  cspZone: number | null;
  ccZone: number | null;
  wallMigrationLabel: string;
  wallMigrationBias: string;
  bestAction: string;
  triggerNotes: string[];
  trapNotes: string[];
  realizedVolPct: number | null;
  atrPct: number | null;
  volumeThrust: number | null;
  volumeThrustSource: string;
  dataQualityScore: number;
  underlyingPrice: number | null;
  edgeSummary: TraderEdgeSummary;
  wallMigration: WallMigrationSummary | null;
};

export type WeeklyReport = {
  title: string;
  weekOf: string;
  generatedAt: string;
  rows: WeeklyReportRow[];
  topSetups: WeeklyReportRow[];
  cspCandidates: WeeklyReportRow[];
  coveredCallTraps: WeeklyReportRow[];
  compressionCoils: WeeklyReportRow[];
  wallMigrationRows: WeeklyReportRow[];
  markdown: string;
  csv: string;
};

export type WeeklyAdvisoryInputs = {
  selectedMarketTicker?: string;
  marketCalendar?: string;
  earningsWatch?: string;
  customMarketPosture?: string;
  customPremiumSellerPosture?: string;
};

export type WeeklyAdvisoryReport = {
  title: string;
  weekOf: string;
  generatedAt: string;
  selectedMarketTicker: string;
  selectedMarketRow: WeeklyReportRow | null;
  focusTicker: string;
  focusRow: WeeklyReportRow | null;
  marketPosture: string;
  premiumSellerPosture: string;
  marketCalendar: string;
  earningsWatch: string;
  triggerBullets: string[];
  notables: WeeklyReportRow[];
  riskFramework: string[];
  scannerRows: WeeklyReportRow[];
  markdown: string;
};

type ProofLike = {
  ticker?: string;
  label?: string;
  evaluated?: number;
  validated?: number;
  adjustedRate?: number | null;
  rawRate?: number | null;
  proofGrade?: string;
  confidence?: string;
  primaryOutcome?: string;
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

function latestByTicker(surfaces: OptionSurfaceSnapshot[]): OptionSurfaceSnapshot[] {
  const map = new Map<string, OptionSurfaceSnapshot>();

  for (const surface of surfaces) {
    const ticker = normalizeTicker(surface?.ticker);
    if (!ticker) continue;
    const existing = map.get(ticker);
    if (!existing || dateKey(surface.snapshotDate).localeCompare(dateKey(existing.snapshotDate)) > 0) {
      map.set(ticker, surface);
    }
  }

  return Array.from(map.values()).sort((a, b) => normalizeTicker(a.ticker).localeCompare(normalizeTicker(b.ticker)));
}

function readCandles(storage: any, ticker: string): CandleRecord[] {
  const upper = normalizeTicker(ticker);
  const candles = storage?.candles?.[upper] ?? storage?.candles?.[ticker] ?? [];
  return Array.isArray(candles) ? candles : [];
}

function proofSummaries(storage: any): ProofLike[] {
  const summaries = storage?.edgeProofSummaries;
  return Array.isArray(summaries) ? summaries : [];
}

function findProofForLabel(storage: any, label: string, ticker?: string): ProofLike | null {
  const upper = normalizeTicker(ticker);
  const target = String(label ?? "").trim().toLowerCase();
  const summaries = proofSummaries(storage);

  const tickerScoped = summaries.find((item) => {
    return normalizeTicker(item?.ticker) === upper && String(item?.label ?? "").trim().toLowerCase() === target;
  });
  if (tickerScoped) return tickerScoped;

  return summaries.find((item) => {
    const itemTicker = normalizeTicker(item?.ticker);
    return !itemTicker && String(item?.label ?? "").trim().toLowerCase() === target;
  }) ?? null;
}

function titleCase(value: string): string {
  return String(value ?? "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function proofText(proof: ProofLike | null): string {
  if (!proof) return "No proof yet";
  const evaluated = Number(proof.evaluated ?? 0);
  if (!evaluated) return `${titleCase(proof.proofGrade ?? "No proof")} · 0 samples`;

  const grade = titleCase(proof.proofGrade ?? "early");
  const adjusted = safeNumber(proof.adjustedRate);
  const adjustedText = adjusted == null ? "N/A" : `${(adjusted * 100).toFixed(0)}% adj`;
  return `${grade} · ${adjustedText} · ${evaluated} sample${evaluated === 1 ? "" : "s"}`;
}

export function formatReportMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  const decimals = Math.abs(value) >= 1000 ? 0 : Math.abs(value) >= 100 ? 0 : 2;
  return `$${value.toFixed(decimals)}`;
}

export function formatReportPercent(value: number | null | undefined, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${value.toFixed(decimals)}%`;
}

export function formatReportScore(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return value.toFixed(0);
}

function rowFromSurface(args: {
  surface: OptionSurfaceSnapshot;
  allSurfaces: OptionSurfaceSnapshot[];
  storage: any;
}): WeeklyReportRow | null {
  const ticker = normalizeTicker(args.surface.ticker);
  if (!ticker) return null;

  const candles = readCandles(args.storage, ticker);
  const edge = buildTraderEdgeSummary({
    ticker,
    surface: args.surface,
    candles,
  });

  const prior = findPriorSurfaceForTicker(args.allSurfaces, ticker, args.surface.snapshotDate);
  const migration = buildWallMigrationSummary({ currentSurface: args.surface, priorSurface: prior });
  const proof = findProofForLabel(args.storage, edge.actionBucket, ticker) ?? findProofForLabel(args.storage, edge.actionBucket);

  return {
    ticker,
    snapshotDate: dateKey(args.surface.snapshotDate),
    actionBucket: edge.actionBucket,
    compression: edge.compressionState,
    edgeScore: edge.edgeScore,
    proofText: proofText(proof),
    proofAdjustedRate: safeNumber(proof?.adjustedRate),
    proofGrade: String(proof?.proofGrade ?? "none"),
    support: edge.support,
    magnet: edge.magnet,
    resistance: edge.resistance,
    cspZone: edge.executableCspCeiling,
    ccZone: edge.executableCoveredCallFloor,
    wallMigrationLabel: migration?.label ?? "No prior comparison",
    wallMigrationBias: migration?.migrationBias ?? "unknown",
    bestAction: edge.bestAction,
    triggerNotes: edge.triggerNotes,
    trapNotes: edge.trapNotes,
    realizedVolPct: edge.realizedVolPct,
    atrPct: edge.atrPct,
    volumeThrust: edge.volumeThrust,
    volumeThrustSource: String((edge as any).volumeThrustSource ?? "unknown"),
    dataQualityScore: Number((edge as any).dataQualityScore ?? 0),
    underlyingPrice: edge.analysisPrice,
    edgeSummary: edge,
    wallMigration: migration,
  };
}

function rowsForTickers(tickers?: string[]): WeeklyReportRow[] {
  const storage = readWheelDeskStorage() as any;
  const selected = new Set((tickers ?? []).map(normalizeTicker).filter(Boolean));
  const allSurfaces = Array.isArray(storage.optionSurfaceSnapshots) ? storage.optionSurfaceSnapshots : [];
  const latest = latestByTicker(allSurfaces).filter((surface) => {
    const ticker = normalizeTicker(surface.ticker);
    return !selected.size || selected.has(ticker);
  });

  return latest
    .map((surface) => rowFromSurface({ surface, allSurfaces, storage }))
    .filter((row): row is WeeklyReportRow => row != null)
    .sort((a, b) => b.edgeScore - a.edgeScore);
}

function isCspCandidate(row: WeeklyReportRow): boolean {
  return row.actionBucket === "Best CSP setup" || row.edgeSummary.cspScore >= 70;
}

function isCoveredCallTrap(row: WeeklyReportRow): boolean {
  const trapText = row.trapNotes.join(" ").toLowerCase();
  return trapText.includes("covered-call") || trapText.includes("covered call") || row.edgeSummary.trapRisk >= 70;
}

function isCompression(row: WeeklyReportRow): boolean {
  return row.actionBucket === "Compression coil";
}

function hasMeaningfulMigration(row: WeeklyReportRow): boolean {
  const label = row.wallMigrationLabel.toLowerCase();
  return !!row.wallMigration?.hasPrior && !label.includes("unchanged") && !label.includes("no prior");
}

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function rowsToCsv(rows: WeeklyReportRow[]): string {
  const header = [
    "Ticker",
    "Date",
    "Setup",
    "Edge",
    "Proof",
    "Support",
    "Magnet",
    "Resistance",
    "CSP Zone",
    "CC Zone",
    "Wall Migration",
    "Action",
  ];
  const body = rows.map((row) => [
    row.ticker,
    row.snapshotDate,
    row.actionBucket,
    formatReportScore(row.edgeScore),
    row.proofText,
    row.support ?? "",
    row.magnet ?? "",
    row.resistance ?? "",
    row.cspZone ?? "",
    row.ccZone ?? "",
    row.wallMigrationLabel,
    row.bestAction,
  ]);

  return [header, ...body].map((line) => line.map(csvEscape).join(",")).join("\n");
}

function scannerMarkdown(report: WeeklyReport): string {
  const table = [
    "| Ticker | Setup | Edge | Proof | Support | Magnet | Resistance | CSP | CC | Action |",
    "|---|---|---:|---|---:|---:|---:|---:|---:|---|",
    ...report.rows.map((row) => {
      return `| ${row.ticker} | ${row.actionBucket} | ${formatReportScore(row.edgeScore)} | ${row.proofText} | ${formatReportMoney(row.support)} | ${formatReportMoney(row.magnet)} | ${formatReportMoney(row.resistance)} | ${formatReportMoney(row.cspZone)} | ${formatReportMoney(row.ccZone)} | ${row.bestAction} |`;
    }),
  ].join("\n");

  return [
    `# ${report.title}`,
    `Week of ${report.weekOf}`,
    "",
    "## Scanner Export",
    "This appendix is generated directly from saved WheelDesk OI surfaces and shared edge logic.",
    "",
    table,
  ].join("\n");
}

export function buildWeeklyReport(args?: {
  tickers?: string[];
  weekOf?: string;
  title?: string;
  tone?: WeeklyReportTone;
}): WeeklyReport {
  const weekOf = dateKey(args?.weekOf ?? new Date().toISOString());
  const rows = rowsForTickers(args?.tickers);
  const topSetups = rows.slice(0, 7);
  const cspCandidates = rows.filter(isCspCandidate).slice(0, 6);
  const coveredCallTraps = rows.filter(isCoveredCallTrap).slice(0, 6);
  const compressionCoils = rows.filter(isCompression).slice(0, 6);
  const wallMigrationRows = rows.filter(hasMeaningfulMigration).slice(0, 6);

  const report: WeeklyReport = {
    title: args?.title ?? "WheelDesk Weekly Premium Map",
    weekOf,
    generatedAt: new Date().toLocaleString(),
    rows,
    topSetups,
    cspCandidates,
    coveredCallTraps,
    compressionCoils,
    wallMigrationRows,
    markdown: "",
    csv: rowsToCsv(rows),
  };
  report.markdown = scannerMarkdown(report);
  return report;
}

function selectMarketRow(rows: WeeklyReportRow[], requested?: string): WeeklyReportRow | null {
  const wanted = normalizeTicker(requested);
  if (wanted) {
    const exact = rows.find((row) => row.ticker === wanted);
    if (exact) return exact;
  }
  return rows.find((row) => ["^SPX", "SPX", "SPY"].includes(row.ticker))
    ?? rows.find((row) => row.ticker === "QQQ")
    ?? rows[0]
    ?? null;
}

function selectFocusRow(rows: WeeklyReportRow[], focusTicker?: string): WeeklyReportRow | null {
  const wanted = normalizeTicker(focusTicker);
  if (wanted) {
    const exact = rows.find((row) => row.ticker === wanted);
    if (exact) return exact;
  }
  return rows.find((row) => row.actionBucket === "Best CSP setup")
    ?? rows.find((row) => row.actionBucket === "Compression coil")
    ?? rows[0]
    ?? null;
}

function defaultMarketPosture(rows: WeeklyReportRow[], market: WeeklyReportRow | null): string {
  if (!rows.length) return "No saved WheelDesk surfaces are available yet. Save SPX/SPY, QQQ, VIX, and one stock of interest before publishing.";
  const compressionCount = rows.filter(isCompression).length;
  const cspCount = rows.filter(isCspCandidate).length;
  const trapCount = rows.filter(isCoveredCallTrap).length;
  const marketText = market
    ? `${market.ticker} is mapped with support ${formatReportMoney(market.support)}, magnet ${formatReportMoney(market.magnet)}, and resistance ${formatReportMoney(market.resistance)}.`
    : "No SPX/SPY structure was saved.";

  return `${marketText} Across the selected universe, WheelDesk shows ${compressionCount} compression setup${compressionCount === 1 ? "" : "s"}, ${cspCount} CSP candidate${cspCount === 1 ? "" : "s"}, and ${trapCount} trap warning${trapCount === 1 ? "" : "s"}. The advisory posture is selective: use OI rails as decision boundaries, not predictions.`;
}

function defaultPremiumPosture(rows: WeeklyReportRow[], focus: WeeklyReportRow | null): string {
  if (!rows.length) return "Wait for saved surfaces before issuing a premium posture.";
  if (focus?.actionBucket === "Best CSP setup") {
    return `${focus.ticker} is the current stock of interest. The cleaner premium posture is CSP-first at or below ${formatReportMoney(focus.cspZone)}, while covered calls should generally wait for ${formatReportMoney(focus.ccZone)} or better unless call-away is acceptable.`;
  }
  if (focus?.actionBucket === "Compression coil") {
    return `${focus.ticker} is the current stock of interest. Treat the active OI range as a compression coil: avoid selling inside the range; wait for unlock/failure or use strikes outside the guardrails.`;
  }
  return `${focus?.ticker ?? rows[0]?.ticker ?? "The focus ticker"} is not a clean high-conviction trade. The better posture is to wait for stronger stacked edge or move strikes farther from spot.`;
}

function defaultCalendarText(value?: string): string {
  const trimmed = String(value ?? "").trim();
  return trimmed || "Add this week's macro calendar manually: CPI/PPI, Fed speakers, jobs data, Treasury auctions, and major economic releases that can reprice volatility.";
}

function defaultEarningsText(value?: string): string {
  const trimmed = String(value ?? "").trim();
  return trimmed || "Add notable earnings manually, especially mega-cap tech, financials, semiconductors, and any stock of interest. Event weeks reduce confidence in static OI path reads.";
}

function triggerBulletsFor(row: WeeklyReportRow | null): string[] {
  if (!row) return ["No focus ticker selected."];
  const bullets = row.triggerNotes.length ? row.triggerNotes : [];
  return [
    ...bullets,
    `CSP permission: ${formatReportMoney(row.cspZone)} or lower unless assignment is desired.`,
    `Covered-call permission: ${formatReportMoney(row.ccZone)} or higher unless call-away is desired.`,
    `Current active range: ${formatReportMoney(row.support)} to ${formatReportMoney(row.resistance)}.`,
  ];
}

function notablesFor(rows: WeeklyReportRow[], focus: WeeklyReportRow | null, market: WeeklyReportRow | null): WeeklyReportRow[] {
  const excluded = new Set([focus?.ticker, market?.ticker].filter(Boolean));
  return rows
    .filter((row) => !excluded.has(row.ticker))
    .filter((row) => row.actionBucket === "Compression coil" || row.actionBucket === "Best CSP setup" || row.edgeSummary.trapRisk >= 65 || hasMeaningfulMigration(row))
    .slice(0, 3);
}

function riskFramework(): string[] {
  return [
    "This report maps options pressure; it does not predict candles.",
    "The OI wall is the battlefield, not automatically the trade strike. Use the CSP/CC guardrails for cushion.",
    "Event risk can gap through otherwise useful OI rails. Reduce confidence around earnings, CPI, Fed decisions, and major macro shocks.",
    "Validation proof is sample-size dependent. Early proof is useful, but not statistically mature.",
    "Do not stack premium into low-edge or conflict regimes just because a strike pays well.",
  ];
}

function advisoryMarkdown(report: WeeklyAdvisoryReport): string {
  const market = report.selectedMarketRow;
  const focus = report.focusRow;
  const quickHits = report.notables.length
    ? report.notables.map((row) => `- **${row.ticker}** — ${row.actionBucket}. ${row.bestAction}`).join("\n")
    : "- No secondary notables this week.";

  return [
    `# ${report.title}`,
    `Week of ${report.weekOf}`,
    "",
    "## Executive Market Call",
    report.marketPosture,
    "",
    `**Premium seller posture:** ${report.premiumSellerPosture}`,
    "",
    "## SPX / Market Structure",
    market
      ? `**${market.ticker}:** support ${formatReportMoney(market.support)}, magnet ${formatReportMoney(market.magnet)}, resistance ${formatReportMoney(market.resistance)}. Wall migration: ${market.wallMigrationLabel}.`
      : "No market structure row available.",
    "",
    "## Market Calendar",
    report.marketCalendar,
    "",
    "## Earnings / Event Watch",
    report.earningsWatch,
    "",
    `## Stock of Interest: ${report.focusTicker || "N/A"}`,
    focus
      ? `**${focus.ticker}** is labeled **${focus.actionBucket}** with edge score ${formatReportScore(focus.edgeScore)}. ${focus.bestAction}`
      : "No stock of interest selected.",
    "",
    focus
      ? `Structure: support ${formatReportMoney(focus.support)}, magnet ${formatReportMoney(focus.magnet)}, resistance ${formatReportMoney(focus.resistance)}. CSP guardrail ${formatReportMoney(focus.cspZone)}. CC guardrail ${formatReportMoney(focus.ccZone)}.`
      : "",
    "",
    "## Trigger Map",
    ...report.triggerBullets.map((bullet) => `- ${bullet}`),
    "",
    "## Notables to Watch",
    quickHits,
    "",
    "## Risk Framework",
    ...report.riskFramework.map((item) => `- ${item}`),
    "",
    "_Educational research only. Not financial advice._",
  ].join("\n");
}

export function buildWeeklyAdvisoryReport(args?: {
  tickers?: string[];
  weekOf?: string;
  focusTicker?: string;
  title?: string;
  inputs?: WeeklyAdvisoryInputs;
}): WeeklyAdvisoryReport {
  const base = buildWeeklyReport({
    tickers: args?.tickers,
    weekOf: args?.weekOf,
    title: args?.title ?? "WheelDesk Weekly Premium Map",
  });

  const market = selectMarketRow(base.rows, args?.inputs?.selectedMarketTicker);
  const focus = selectFocusRow(base.rows, args?.focusTicker);
  const report: WeeklyAdvisoryReport = {
    title: args?.title ?? "WheelDesk Weekly Premium Map",
    weekOf: base.weekOf,
    generatedAt: base.generatedAt,
    selectedMarketTicker: market?.ticker ?? normalizeTicker(args?.inputs?.selectedMarketTicker),
    selectedMarketRow: market,
    focusTicker: focus?.ticker ?? normalizeTicker(args?.focusTicker),
    focusRow: focus,
    marketPosture: args?.inputs?.customMarketPosture || defaultMarketPosture(base.rows, market),
    premiumSellerPosture: args?.inputs?.customPremiumSellerPosture || defaultPremiumPosture(base.rows, focus),
    marketCalendar: defaultCalendarText(args?.inputs?.marketCalendar),
    earningsWatch: defaultEarningsText(args?.inputs?.earningsWatch),
    triggerBullets: triggerBulletsFor(focus),
    notables: notablesFor(base.rows, focus, market),
    riskFramework: riskFramework(),
    scannerRows: base.rows,
    markdown: "",
  };

  report.markdown = advisoryMarkdown(report);
  return report;
}
