import { PortfolioPosition } from "./portfolio-types";

export type UserPositionGroupType =
| "stock_base"
| "covered_call"
| "cash_secured_put"
| "debit_spread"
| "credit_spread"
| "pmcc"
| "long_call"
| "long_put"
| "short_put"
| "custom";

export type UserPositionGroup = {
id: string;
name: string;
strategyType: UserPositionGroupType;
legIds: string[];
notes?: string;
userLocked: boolean;
};

const GROUPING_PREFIX = "wheelDesk.positionGroups";

function isBrowser(): boolean {
return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeTicker(ticker: string): string {
return String(ticker ?? "").trim().toUpperCase();
}

export function makePositionLegId(position: PortfolioPosition): string {
return [
String((position as any).symbol ?? "").toUpperCase(),
String((position as any).instrumentType ?? ""),
String((position as any).side ?? ""),
String((position as any).qty ?? ""),
String((position as any).strike ?? "NA"),
String((position as any).expiration ?? "NA")
].join("|");
}

export function makePositionGroupStorageKey(profileId: string, ticker: string): string {
return `${GROUPING_PREFIX}.${profileId}.${normalizeTicker(ticker)}`;
}

export function readUserPositionGroups(profileId: string, ticker: string): UserPositionGroup[] {
if (!isBrowser() || !profileId || !ticker) return [];

const raw = window.localStorage.getItem(makePositionGroupStorageKey(profileId, ticker));
if (!raw) return [];

try {
const parsed = JSON.parse(raw);
return Array.isArray(parsed) ? parsed : [];
} catch {
return [];
}
}

export function saveUserPositionGroups(
profileId: string,
ticker: string,
groups: UserPositionGroup[]
): void {
if (!isBrowser() || !profileId || !ticker) return;

window.localStorage.setItem(
makePositionGroupStorageKey(profileId, ticker),
JSON.stringify(groups)
);
}

export function clearUserPositionGroups(profileId: string, ticker: string): void {
if (!isBrowser() || !profileId || !ticker) return;

window.localStorage.removeItem(makePositionGroupStorageKey(profileId, ticker));
}