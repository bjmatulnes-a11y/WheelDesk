export type WheelDeskPlan = "founder" | "core" | "research";

export type TickerEntitlement = {
  plan: WheelDeskPlan;
  maxTickers: number;
  maxReplacementsPerDay: number;
  maxValidationHistoryDays: number;
};

export const DEFAULT_TICKER_ENTITLEMENTS: Record<WheelDeskPlan, TickerEntitlement> = {
  founder: {
    plan: "founder",
    maxTickers: 10,
    maxReplacementsPerDay: 3,
    maxValidationHistoryDays: 90,
  },
  core: {
    plan: "core",
    maxTickers: 15,
    maxReplacementsPerDay: 3,
    maxValidationHistoryDays: 180,
  },
  research: {
    plan: "research",
    maxTickers: 30,
    maxReplacementsPerDay: 6,
    maxValidationHistoryDays: 730,
  },
};

export function normalizeSymbol(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toUpperCase().replace(/[^A-Z0-9.^-]/g, "").slice(0, 12);
}

export function normalizePlan(value: unknown): WheelDeskPlan {
  if (value === "research" || value === "core" || value === "founder") return value;
  return "founder";
}

export function fallbackEntitlement(planValue: unknown): TickerEntitlement {
  return DEFAULT_TICKER_ENTITLEMENTS[normalizePlan(planValue)];
}
