export type WheelDeskPlanId = "founder" | "core" | "research";

export type WheelDeskPlan = {
  id: WheelDeskPlanId;
  name: string;
  priceLabel: string;
  note: string;
  description: string;
  features: string[];
  highlight?: boolean;
};

export const WHEELDESK_PLANS: WheelDeskPlan[] = [
  {
    id: "founder",
    name: "Founder",
    priceLabel: "$49",
    note: "early access",
    description: "For the first cohort validating the WheelDesk edge.",
    features: ["Control Center", "Validation", "Portfolio risk console", "Scanner", "Mobile install"],
  },
  {
    id: "core",
    name: "Core",
    priceLabel: "$79",
    note: "per month",
    description: "The main WheelDesk subscription for active premium sellers.",
    features: ["OI surfaces", "Wheel repair tools", "Saved tickers", "Market Structure", "Basic validation"],
    highlight: true,
  },
  {
    id: "research",
    name: "Research",
    priceLabel: "$129",
    note: "per month",
    description: "The deeper edge stack for validation and structure research.",
    features: ["Dealer pressure", "Wall migration", "Multi-chain confluence", "Validation history", "Research exports"],
  },
];

export function isWheelDeskPlanId(value: string | null | undefined): value is WheelDeskPlanId {
  return value === "founder" || value === "core" || value === "research";
}

export function getWheelDeskPlan(value: string | null | undefined): WheelDeskPlan {
  if (isWheelDeskPlanId(value)) {
    return WHEELDESK_PLANS.find((plan) => plan.id === value) ?? WHEELDESK_PLANS[0];
  }

  return WHEELDESK_PLANS[0];
}

export function planLabel(value: string | null | undefined): string {
  return getWheelDeskPlan(value).name;
}
