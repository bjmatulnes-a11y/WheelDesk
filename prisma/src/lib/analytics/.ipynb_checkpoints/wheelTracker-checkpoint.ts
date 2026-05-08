export type WheelEventType = "SELL_PUT" | "ASSIGNED" | "SELL_CALL" | "CALLED_AWAY" | "EXPIRE_WORTHLESS";

export type WheelEvent = {
  date: string;
  symbol: string;
  event: WheelEventType;
  premium?: number;
  strike?: number;
  shares?: number;
};

export type WheelCycleSummary = {
  symbol: string;
  totalPremium: number;
  assignments: number;
  calledAway: number;
  state: "cash" | "short_put" | "long_shares" | "short_call";
};

export function summarizeWheelCycle(events: WheelEvent[]): WheelCycleSummary {
  const symbol = events[0]?.symbol ?? "UNKNOWN";
  let totalPremium = 0;
  let assignments = 0;
  let calledAway = 0;
  let state: WheelCycleSummary["state"] = "cash";

  for (const e of events) {
    totalPremium += e.premium ?? 0;
    if (e.event === "SELL_PUT") state = "short_put";
    if (e.event === "ASSIGNED") {
      assignments += 1;
      state = "long_shares";
    }
    if (e.event === "SELL_CALL") state = "short_call";
    if (e.event === "CALLED_AWAY") {
      calledAway += 1;
      state = "cash";
    }
  }

  return { symbol, totalPremium, assignments, calledAway, state };
}
