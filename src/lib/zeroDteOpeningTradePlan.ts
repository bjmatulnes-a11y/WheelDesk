import type { ZeroDteTradeSelection } from "./zeroDteTradeSelector";

export type LockedCreditSpread = {
  side: "put" | "call";
  shortStrike: number;
  longStrike: number;
  width: number;
  openingCredit: number | null;
  openingConfidence: number;
};

export type ZeroDteOpeningTradePlan = {
  tradeDate: string;
  generatedAt: string;
  put: LockedCreditSpread | null;
  call: LockedCreditSpread | null;
};

const PREFIX = "wheeldesk.zeroDte.openingTradePlan.";

function storageKey(tradeDate: string) {
  return `${PREFIX}${tradeDate}`;
}

function toLocked(selection: ZeroDteTradeSelection, side: "put" | "call"): LockedCreditSpread | null {
  const spread = side === "put" ? selection.creditSpreadBook.put : selection.creditSpreadBook.call;
  if (!spread.shortStrike || !spread.longStrike || !spread.actualWidth) return null;
  return {
    side,
    shortStrike: spread.shortStrike,
    longStrike: spread.longStrike,
    width: spread.actualWidth,
    openingCredit: spread.estimatedCredit,
    openingConfidence: spread.confidence,
  };
}

export function loadOpeningTradePlan(tradeDate: string): ZeroDteOpeningTradePlan | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(tradeDate));
    if (!raw) return null;
    const value = JSON.parse(raw) as ZeroDteOpeningTradePlan;
    if (value.tradeDate !== tradeDate) return null;
    return value;
  } catch {
    return null;
  }
}

export function lockOpeningTradePlan(
  tradeDate: string,
  generatedAt: string,
  selection: ZeroDteTradeSelection
): ZeroDteOpeningTradePlan {
  const existing = loadOpeningTradePlan(tradeDate);
  if (existing) return existing;

  const plan: ZeroDteOpeningTradePlan = {
    tradeDate,
    generatedAt,
    put: toLocked(selection, "put"),
    call: toLocked(selection, "call"),
  };

  if (typeof window !== "undefined") {
    window.localStorage.setItem(storageKey(tradeDate), JSON.stringify(plan));
  }
  return plan;
}

export function resetOpeningTradePlan(tradeDate: string) {
  if (typeof window !== "undefined") window.localStorage.removeItem(storageKey(tradeDate));
}
