export type WheelBasisAdjustmentKind =
  | "PUT_EXPIRED"
  | "CALL_EXPIRED"
  | "NET_ROLL_CREDIT"
  | "NET_ROLL_DEBIT"
  | "PUT_ASSIGNED_CREDIT"
  | "CALL_BUYBACK_DEBIT"
  | "DIVIDEND"
  | "MANUAL_CREDIT"
  | "MANUAL_DEBIT";

export type WheelBasisAdjustment = {
  id: string;
  ticker: string;
  date: string;
  kind: WheelBasisAdjustmentKind;
  amount: number;
  notes?: string;
};

export type WheelBasisTickerSummary = {
  ticker: string;
  stockShares: number;
  stockLots: number;
  brokerStockCost: number;
  brokerBasisPerShare: number | null;
  totalPremiumCredits: number;
  totalPremiumDebits: number;
  cspCredits: number;
  coveredCallCredits: number;
  netRollCredits: number;
  manualCredits: number;
  dividends: number;
  wheelAdjustedCost: number;
  wheelAdjustedBasisPerShare: number | null;
  wheelCreditPerShare: number | null;
  unallocatedWheelCredit: number;
  shortCalls: number;
  shortPuts: number;
};

function n(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function symbolOf(position: any): string {
  return String(position?.symbol ?? position?.ticker ?? position?.underlying ?? "UNKNOWN").trim().toUpperCase();
}

function sideSign(side: unknown): number {
  return String(side).toLowerCase() === "short" ? -1 : 1;
}

function qtyOf(position: any): number {
  return Math.abs(n(position?.qty ?? position?.quantity));
}

function entryPriceOf(position: any): number {
  return n(position?.entryPrice ?? position?.entry ?? position?.costBasis ?? position?.price ?? position?.avgPrice);
}

function isCreditKind(kind: WheelBasisAdjustmentKind): boolean {
  return (
    kind === "PUT_EXPIRED" ||
    kind === "CALL_EXPIRED" ||
    kind === "NET_ROLL_CREDIT" ||
    kind === "PUT_ASSIGNED_CREDIT" ||
    kind === "DIVIDEND" ||
    kind === "MANUAL_CREDIT"
  );
}

function isDebitKind(kind: WheelBasisAdjustmentKind): boolean {
  return kind === "NET_ROLL_DEBIT" || kind === "CALL_BUYBACK_DEBIT" || kind === "MANUAL_DEBIT";
}

export function normalizeWheelBasisAdjustment(input: Partial<WheelBasisAdjustment>): WheelBasisAdjustment | null {
  const ticker = String(input.ticker ?? "").trim().toUpperCase();
  const amount = n(input.amount);
  const kind = input.kind;
  const date = String(input.date ?? new Date().toISOString().slice(0, 10)).slice(0, 10);

  if (!ticker || !kind || !Number.isFinite(amount) || amount <= 0) return null;

  return {
    id: input.id ?? `wheel-adj-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ticker,
    date,
    kind,
    amount,
    notes: input.notes?.trim() || undefined,
  };
}

export function buildWheelBasisSummary(args: {
  positions: any[];
  adjustments: WheelBasisAdjustment[];
}): WheelBasisTickerSummary[] {
  const byTicker = new Map<string, WheelBasisTickerSummary>();

  function get(ticker: string): WheelBasisTickerSummary {
    const normalized = ticker.trim().toUpperCase() || "UNKNOWN";
    const existing = byTicker.get(normalized);
    if (existing) return existing;

    const next: WheelBasisTickerSummary = {
      ticker: normalized,
      stockShares: 0,
      stockLots: 0,
      brokerStockCost: 0,
      brokerBasisPerShare: null,
      totalPremiumCredits: 0,
      totalPremiumDebits: 0,
      cspCredits: 0,
      coveredCallCredits: 0,
      netRollCredits: 0,
      manualCredits: 0,
      dividends: 0,
      wheelAdjustedCost: 0,
      wheelAdjustedBasisPerShare: null,
      wheelCreditPerShare: null,
      unallocatedWheelCredit: 0,
      shortCalls: 0,
      shortPuts: 0,
    };

    byTicker.set(normalized, next);
    return next;
  }

  for (const position of args.positions ?? []) {
    const ticker = symbolOf(position);
    const summary = get(ticker);
    const instrumentType = String(position?.instrumentType ?? position?.type ?? "").toLowerCase();
    const side = String(position?.side ?? "").toLowerCase();
    const qty = qtyOf(position);

    if (instrumentType === "stock" || instrumentType === "shares" || instrumentType === "equity") {
      const signedShares = sideSign(side) * qty;
      summary.stockShares += signedShares;
      summary.brokerStockCost += signedShares * entryPriceOf(position);
    }

    if (instrumentType === "call" && side === "short") {
      summary.shortCalls += qty;
    }

    if (instrumentType === "put" && side === "short") {
      summary.shortPuts += qty;
    }
  }

  for (const adjustment of args.adjustments ?? []) {
    const normalized = normalizeWheelBasisAdjustment(adjustment);
    if (!normalized) continue;

    const summary = get(normalized.ticker);
    const amount = Math.abs(normalized.amount);

    if (isCreditKind(normalized.kind)) {
      summary.totalPremiumCredits += amount;
    }

    if (isDebitKind(normalized.kind)) {
      summary.totalPremiumDebits += amount;
    }

    switch (normalized.kind) {
      case "PUT_EXPIRED":
      case "PUT_ASSIGNED_CREDIT":
        summary.cspCredits += amount;
        break;
      case "CALL_EXPIRED":
        summary.coveredCallCredits += amount;
        break;
      case "NET_ROLL_CREDIT":
        summary.netRollCredits += amount;
        break;
      case "NET_ROLL_DEBIT":
      case "CALL_BUYBACK_DEBIT":
        summary.netRollCredits -= amount;
        break;
      case "DIVIDEND":
        summary.dividends += amount;
        break;
      case "MANUAL_CREDIT":
        summary.manualCredits += amount;
        break;
      case "MANUAL_DEBIT":
        summary.manualCredits -= amount;
        break;
    }
  }

  for (const summary of byTicker.values()) {
    summary.stockLots = Math.trunc(Math.abs(summary.stockShares) / 100);

    summary.brokerBasisPerShare =
      summary.stockShares !== 0 ? summary.brokerStockCost / summary.stockShares : null;

    const netWheelCredits = summary.totalPremiumCredits - summary.totalPremiumDebits;
    summary.wheelAdjustedCost = summary.brokerStockCost - netWheelCredits;

    summary.wheelAdjustedBasisPerShare =
      summary.stockShares !== 0 ? summary.wheelAdjustedCost / summary.stockShares : null;

    summary.wheelCreditPerShare =
      summary.stockShares !== 0 ? netWheelCredits / Math.abs(summary.stockShares) : null;

    summary.unallocatedWheelCredit =
      summary.stockShares === 0 ? Math.max(0, netWheelCredits) : 0;
  }

  return Array.from(byTicker.values()).sort((a, b) => {
    if (Math.abs(b.stockShares) !== Math.abs(a.stockShares)) return Math.abs(b.stockShares) - Math.abs(a.stockShares);
    return a.ticker.localeCompare(b.ticker);
  });
}

export function wheelAdjustmentLabel(kind: WheelBasisAdjustmentKind): string {
  switch (kind) {
    case "PUT_EXPIRED":
      return "Short put expired worthless";
    case "CALL_EXPIRED":
      return "Covered call expired worthless";
    case "NET_ROLL_CREDIT":
      return "Net roll credit";
    case "NET_ROLL_DEBIT":
      return "Net roll debit";
    case "PUT_ASSIGNED_CREDIT":
      return "Assigned put premium credit";
    case "CALL_BUYBACK_DEBIT":
      return "Call buyback debit";
    case "DIVIDEND":
      return "Dividend";
    case "MANUAL_CREDIT":
      return "Manual credit";
    case "MANUAL_DEBIT":
      return "Manual debit";
    default:
      return String(kind);
  }
}
