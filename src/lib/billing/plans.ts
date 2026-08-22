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
  badge?: string;
  public?: boolean;
};

export const WHEELDESK_PLANS: WheelDeskPlan[] = [
  {
    id: "founder",
    name: "Founder (Legacy)",
    stripeProductName: "WheelDesk Founder",
    priceLabel: "$49",
    note: "legacy monthly access",
    description: "Legacy founder access retained for existing subscribers.",
    features: [
      "Legacy founder entitlement",
    ],
    public: false,
  },
  {
    id: "core",
    name: "WheelDesk",
    stripeProductName: "WheelDesk",
    priceLabel: "$99",
    note: "per month",
    description: "Market structure, portfolio intelligence, and premium-management tools for active options traders.",
    features: [
      "Control Center",
      "Watchlist Command",
      "Portfolio risk console",
      "Wheel workflow and repair tools",
      "OI surfaces and dealer pressure",
      "Validation receipts and structure history",
    ],
    public: true,
  },
  {
    id: "research",
    name: "WheelDesk Command",
    stripeProductName: "WheelDesk Command",
    priceLabel: "$499",
    note: "per month",
    description: "The complete WheelDesk platform plus SPX 0DTE decision intelligence for the live trading session.",
    features: [
      "Everything in WheelDesk",
      "SPX 0DTE Command",
      "Candidate and structure intelligence",
      "Readiness and entry-state engine",
      "Premium crest and exhaustion",
      "Trade lifecycle and risk intelligence",
    ],
    highlight: true,
    badge: "Early Access",
    public: true,
  },
];

export const WHEELDESK_PUBLIC_PLANS = WHEELDESK_PLANS.filter((plan) => plan.public !== false);

export function isWheelDeskPlanId(value: string | null | undefined): value is WheelDeskPlanId {
  return value === "founder" || value === "core" || value === "research";
}

export function getWheelDeskPlan(value: string | null | undefined): WheelDeskPlan {
  if (isWheelDeskPlanId(value)) {
    return WHEELDESK_PLANS.find((plan) => plan.id === value) ?? WHEELDESK_PLANS[1];
  }

  return WHEELDESK_PLANS[1];
}

export function planLabel(value: string | null | undefined): string {
  return getWheelDeskPlan(value).name;
}

export function planSortRank(value: string | null | undefined): number {
  // Founder is a retired legacy SKU, but existing Founder subscribers are
  // grandfathered into the complete product, including Command.
  if (value === "founder") return 40;
  if (value === "research") return 30;
  if (value === "core") return 20;
  return 0;
}
