export const BILLING_ACTIVE_STATUSES = new Set(["active", "trialing"]);

export function hasActiveBillingStatus(status: string | null | undefined): boolean {
  return Boolean(status && BILLING_ACTIVE_STATUSES.has(status));
}

export function friendlyBillingStatus(status: string | null | undefined): string {
  if (!status) return "Not subscribed";
  if (status === "active") return "Active";
  if (status === "trialing") return "Trialing";
  if (status === "past_due") return "Past due";
  if (status === "canceled") return "Canceled";
  if (status === "unpaid") return "Unpaid";
  if (status === "incomplete") return "Incomplete";
  if (status === "incomplete_expired") return "Incomplete expired";
  if (status === "paused") return "Paused";
  return status;
}
