export type Plan = "free" | "pro" | "pro_research" | "desk";

export function getPlanPrice(plan: Plan): number {
  switch (plan) {
    case "pro":
      return 79;
    case "pro_research":
      return 129;
    case "desk":
      return 399;
    default:
      return 0;
  }
}

export function createCheckoutPlaceholder(plan: Plan): { checkoutUrl: string; monthlyPrice: number } {
  const monthlyPrice = getPlanPrice(plan);
  return {
    checkoutUrl: `/billing/checkout?plan=${plan}`,
    monthlyPrice
  };
}
