export type PortfolioLegType =
  | "shares"
  | "long_call"
  | "short_call"
  | "long_put"
  | "short_put";

export type CallCoverageType =
  | "shares"
  | "long_call"
  | "debit_spread"
  | "uncovered"
  | "unknown";

export type PortfolioLeg = {
  id: string;
  ticker: string;
  type: PortfolioLegType;

  // shares = share count
  // options = contract count
  quantity: number;

  strike?: number;
  expiration?: string;
  premium?: number;

  // Legs with same groupId are treated as a defined spread.
  groupId?: string;

  // For short calls only.
  coverageType?: CallCoverageType;
};

export type DebitSpreadGroup = {
  groupId: string;
  ticker: string;
  expiration?: string;
  side: "call" | "put";
  longLegs: PortfolioLeg[];
  shortLegs: PortfolioLeg[];
  quantity: number;
  longStrike?: number;
  shortStrike?: number;
  width?: number;
};

export type PortfolioCoverageSummary = {
  ticker: string;

  shares: number;
  shareLots: number;

  longCalls: number;
  shortCalls: number;
  shortPuts: number;

  shareCoveredCalls: number;
  debitSpreadShortCalls: number;
  longCallCoveredShortCalls: number;
  uncoveredShortCalls: number;
  unknownCoverageShortCalls: number;

  longCallsCommittedToDebitSpreads: number;
  longCallsCommittedToShortCalls: number;
  availableLongCalls: number;

  coveredShares: number;
  uncoveredShares: number;
  availableShareLots: number;

  totalCallCoverageCapacity: number;
  activeShortCallContracts: number;
  remainingCallCapacity: number;

  debitSpreads: DebitSpreadGroup[];
  warnings: string[];
};

function absQty(leg: Pick<PortfolioLeg, "quantity">): number {
  return Math.abs(Number(leg.quantity) || 0);
}

function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

function minDefined(values: Array<number | undefined>): number | undefined {
  const clean = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return clean.length ? Math.min(...clean) : undefined;
}

function maxDefined(values: Array<number | undefined>): number | undefined {
  const clean = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return clean.length ? Math.max(...clean) : undefined;
}

export function getDte(expiration?: string, asOfDate?: string): number | null {
  if (!expiration) return null;

  const startDate = asOfDate ?? new Date().toISOString().slice(0, 10);

  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${expiration}T00:00:00Z`).getTime();

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;

  return Math.max(0, Math.round((end - start) / 86_400_000));
}

export function formatLegDte(leg: PortfolioLeg, asOfDate?: string): string {
  const dte = getDte(leg.expiration, asOfDate);
  if (dte == null) return "N/A";
  return `${dte} DTE`;
}

export function groupDebitSpreads(legs: PortfolioLeg[]): DebitSpreadGroup[] {
  const grouped = new Map<string, PortfolioLeg[]>();

  for (const leg of legs) {
    if (!leg.groupId) continue;

    const key = leg.groupId.trim();
    if (!key) continue;

    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(leg);
  }

  const spreads: DebitSpreadGroup[] = [];

  for (const [groupId, groupLegs] of grouped.entries()) {
    const longCalls = groupLegs.filter((l) => l.type === "long_call");
    const shortCalls = groupLegs.filter((l) => l.type === "short_call");
    const longPuts = groupLegs.filter((l) => l.type === "long_put");
    const shortPuts = groupLegs.filter((l) => l.type === "short_put");

    const isCallSpread = longCalls.length > 0 && shortCalls.length > 0;
    const isPutSpread = longPuts.length > 0 && shortPuts.length > 0;

    if (!isCallSpread && !isPutSpread) continue;

    const side: "call" | "put" = isCallSpread ? "call" : "put";
    const longLegs = side === "call" ? longCalls : longPuts;
    const shortLegs = side === "call" ? shortCalls : shortPuts;

    const longQty = longLegs.reduce((sum, l) => sum + absQty(l), 0);
    const shortQty = shortLegs.reduce((sum, l) => sum + absQty(l), 0);
    const quantity = Math.min(longQty, shortQty);

    const longStrike =
      side === "call"
        ? minDefined(longLegs.map((l) => l.strike))
        : maxDefined(longLegs.map((l) => l.strike));

    const shortStrike =
      side === "call"
        ? maxDefined(shortLegs.map((l) => l.strike))
        : minDefined(shortLegs.map((l) => l.strike));

    const width =
      longStrike != null && shortStrike != null
        ? Math.abs(shortStrike - longStrike)
        : undefined;

    spreads.push({
      groupId,
      ticker: normalizeTicker(groupLegs[0]?.ticker ?? ""),
      expiration: groupLegs[0]?.expiration,
      side,
      longLegs,
      shortLegs,
      quantity,
      longStrike,
      shortStrike,
      width
    });
  }

  return spreads;
}

export function inferCoverageType(leg: PortfolioLeg): CallCoverageType {
  if (leg.type !== "short_call") return "unknown";

  if (leg.coverageType) return leg.coverageType;

  if (leg.groupId) return "debit_spread";

  return "unknown";
}

export function summarizePortfolioCoverage(args: {
  ticker: string;
  legs: PortfolioLeg[];
  asOfDate?: string;
}): PortfolioCoverageSummary {
  const ticker = normalizeTicker(args.ticker);

  const legs = args.legs.filter((l) => normalizeTicker(l.ticker) === ticker);

  const warnings: string[] = [];

  const shares = legs
    .filter((l) => l.type === "shares")
    .reduce((sum, l) => sum + Math.max(0, Number(l.quantity) || 0), 0);

  const shareLots = Math.floor(shares / 100);

  const longCallLegs = legs.filter((l) => l.type === "long_call");
  const shortCallLegs = legs.filter((l) => l.type === "short_call");
  const shortPutLegs = legs.filter((l) => l.type === "short_put");

  const longCalls = longCallLegs.reduce((sum, l) => sum + absQty(l), 0);
  const shortCalls = shortCallLegs.reduce((sum, l) => sum + absQty(l), 0);
  const shortPuts = shortPutLegs.reduce((sum, l) => sum + absQty(l), 0);

  const allDebitSpreads = groupDebitSpreads(legs);
  const callDebitSpreads = allDebitSpreads.filter((g) => g.side === "call");

  const debitSpreadShortCallsFromGroups = callDebitSpreads.reduce(
    (sum, g) => sum + g.quantity,
    0
  );

  const shareCoveredCalls = shortCallLegs
    .filter((l) => inferCoverageType(l) === "shares")
    .reduce((sum, l) => sum + absQty(l), 0);

  const explicitDebitSpreadShortCalls = shortCallLegs
    .filter((l) => inferCoverageType(l) === "debit_spread")
    .reduce((sum, l) => sum + absQty(l), 0);

  const debitSpreadShortCalls = Math.max(
    debitSpreadShortCallsFromGroups,
    explicitDebitSpreadShortCalls
  );

  const longCallCoveredShortCalls = shortCallLegs
    .filter((l) => inferCoverageType(l) === "long_call")
    .reduce((sum, l) => sum + absQty(l), 0);

  const uncoveredShortCalls = shortCallLegs
    .filter((l) => inferCoverageType(l) === "uncovered")
    .reduce((sum, l) => sum + absQty(l), 0);

  const unknownCoverageShortCalls = shortCallLegs
    .filter((l) => inferCoverageType(l) === "unknown")
    .reduce((sum, l) => sum + absQty(l), 0);

  const longCallsCommittedToDebitSpreads = Math.min(longCalls, debitSpreadShortCalls);

  const longCallsCommittedToShortCalls = Math.min(
    longCalls,
    longCallsCommittedToDebitSpreads + longCallCoveredShortCalls
  );

  const availableLongCalls = Math.max(0, longCalls - longCallsCommittedToShortCalls);

  const coveredShares = shareCoveredCalls * 100;
  const uncoveredShares = Math.max(0, shares - coveredShares);
  const availableShareLots = Math.max(0, shareLots - shareCoveredCalls);

  const totalCallCoverageCapacity = shareLots + longCalls;

  const activeShortCallContracts =
    shareCoveredCalls +
    debitSpreadShortCalls +
    longCallCoveredShortCalls +
    uncoveredShortCalls +
    unknownCoverageShortCalls;

  const remainingCallCapacity = Math.max(0, availableShareLots + availableLongCalls);

  if (shareCoveredCalls > shareLots) {
    warnings.push(
      `Share-covered calls (${shareCoveredCalls}) exceed available share lots (${shareLots}).`
    );
  }

  if (debitSpreadShortCalls > longCalls) {
    warnings.push(
      `Debit-spread short calls (${debitSpreadShortCalls}) exceed long call contracts (${longCalls}).`
    );
  }

  if (unknownCoverageShortCalls > 0) {
    warnings.push(
      `${unknownCoverageShortCalls} short call contract(s) have unknown coverage. Mark them as shares, debit_spread, long_call, or uncovered.`
    );
  }

  if (uncoveredShortCalls > 0) {
    warnings.push(`${uncoveredShortCalls} short call contract(s) are marked uncovered.`);
  }

  for (const leg of legs) {
    if (leg.expiration && getDte(leg.expiration, args.asOfDate) == null) {
      warnings.push(`Could not calculate DTE for ${leg.type} ${leg.strike ?? ""} ${leg.expiration}.`);
    }
  }

  return {
    ticker,

    shares,
    shareLots,

    longCalls,
    shortCalls,
    shortPuts,

    shareCoveredCalls,
    debitSpreadShortCalls,
    longCallCoveredShortCalls,
    uncoveredShortCalls,
    unknownCoverageShortCalls,

    longCallsCommittedToDebitSpreads,
    longCallsCommittedToShortCalls,
    availableLongCalls,

    coveredShares,
    uncoveredShares,
    availableShareLots,

    totalCallCoverageCapacity,
    activeShortCallContracts,
    remainingCallCapacity,

    debitSpreads: callDebitSpreads,
    warnings
  };
}