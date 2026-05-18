export type WheelDeskPlanId = "founder" | "core" | "research";

export type WheelDeskPlan = {
  id: WheelDeskPlanId;
  name: string;
  priceLabel: string;
  note: string;
  stripeProductName: string;
  description: string;
  features: string[];
  highlight?: boolean;
};

export const WHEELDESK_PLANS: WheelDeskPlan[] = [
  {
    id: "founder",
    name: "Founder",
    stripeProductName: "WheelDesk Founder",
    priceLabel: "$49",
    note: "per month · early access",
    description: "Founder access for the first cohort validating the WheelDesk edge.",
    features: [
      "Control Center",
      "Watchlist Command",
      "Validation engine",
      "Portfolio risk console",
      "Mobile install",
    ],
  },
  {
    id: "core",
    name: "Core",
    stripeProductName: "WheelDesk Core",
    priceLabel: "$79",
    note: "per month",
    description: "The main WheelDesk subscription for active options traders.",
    features: [
      "OI surfaces",
      "Dealer pressure context",
      "Wheel repair tools",
      "Saved ticker workflow",
      "Basic validation receipts",
    ],
    highlight: true,
  },
  {
    id: "research",
    name: "Research",
    stripeProductName: "WheelDesk Research",
    priceLabel: "$129",
    note: "per month",
    description: "The deeper edge stack for validation and market-structure research.",
    features: [
      "Wall migration history",
      "Multi-chain confluence",
      "Advanced validation history",
      "Research exports",
      "Priority feature access",
    ],
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

export function planSortRank(value: string | null | undefined): number {
  if (value === "research") return 30;
  if (value === "core") return 20;
  if (value === "founder") return 10;
  return 0;
}
