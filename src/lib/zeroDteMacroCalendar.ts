// Static/auditable macro calendar used only to veto new 0DTE credit-spread entries.
// Confirmed dates are maintained from official release calendars:
// BLS CPI: https://www.bls.gov/schedule/news_release/cpi.htm
// BLS Employment Situation (NFP): https://www.bls.gov/schedule/news_release/empsit.htm
// Federal Reserve FOMC: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
// BEA Personal Income and Outlays (PCE): https://www.bea.gov/news/schedule
// Keep this file easy to edit as agencies revise or extend schedules.
import calendar from "./data/macroCalendar.json";

export type ZeroDteMacroEvent = "CPI" | "FOMC" | "NFP" | "PCE";

const EVENTS = calendar as Record<string, ZeroDteMacroEvent>;

export function macroEventForDate(tradeDate: string | null | undefined): ZeroDteMacroEvent | null {
  if (!tradeDate) return null;
  const value = EVENTS[tradeDate];
  return value === "CPI" || value === "FOMC" || value === "NFP" || value === "PCE" ? value : null;
}
