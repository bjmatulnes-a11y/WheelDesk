import type { ExecutionRead, PremiumPoint } from "./types";

const premiumKey = (tradeDate: string) =>
  `wheeldesk:execution:premium:${tradeDate}`;

const timelineKey = (tradeDate: string) =>
  `wheeldesk:execution:timeline:${tradeDate}`;

export function loadPremiumHistory(tradeDate: string): PremiumPoint[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(premiumKey(tradeDate)) ?? "[]",
    );
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePremiumHistory(
  tradeDate: string,
  history: PremiumPoint[],
) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    premiumKey(tradeDate),
    JSON.stringify(history.slice(-360)),
  );
}

export function loadExecutionTimeline(tradeDate: string): ExecutionRead[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(timelineKey(tradeDate)) ?? "[]",
    );
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function appendExecutionTimeline(
  tradeDate: string,
  read: ExecutionRead,
) {
  if (typeof window === "undefined") return [];

  const current = loadExecutionTimeline(tradeDate);
  const previous = current.at(-1);

  const materialChange =
    !previous ||
    previous.action !== read.action ||
    Math.abs(previous.harvestScore - read.harvestScore) >= 5 ||
    Date.parse(read.generatedAt) - Date.parse(previous.generatedAt) >= 5 * 60_000;

  if (!materialChange) return current;

  const next = [...current, read].slice(-120);
  window.localStorage.setItem(timelineKey(tradeDate), JSON.stringify(next));
  return next;
}
