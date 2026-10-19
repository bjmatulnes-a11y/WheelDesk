// Keep this list deliberately static/auditable. Populate src/lib/data/macroCalendar.json
// with YYYY-MM-DD -> CPI | FOMC | NFP | PCE as dates are confirmed.
import calendar from "./data/macroCalendar.json";

export type ZeroDteMacroEvent = "CPI" | "FOMC" | "NFP" | "PCE";

const EVENTS = calendar as Record<string, ZeroDteMacroEvent>;

export function macroEventForDate(tradeDate: string | null | undefined): ZeroDteMacroEvent | null {
  if (!tradeDate) return null;
  const value = EVENTS[tradeDate];
  return value === "CPI" || value === "FOMC" || value === "NFP" || value === "PCE" ? value : null;
}
