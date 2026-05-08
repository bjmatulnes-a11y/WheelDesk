import { PortfolioPosition } from "./portfolio-types";
import {
    makePositionLegId,
    UserPositionGroup,
    UserPositionGroupType
} from "./position-group-store";

export type NormalizedPosition = PortfolioPosition & {
symbol: string;
instrumentType: "stock" | "call" | "put";
side: "long" | "short";
qty: number;
strike?: number;
expiration?: string;
};

export type DebitSpreadGroup = {
type: "debit_spread";
label: string;
symbol: string;
expiration: string;
longStrike: number;
shortStrike: number;
lots: number;
width: number;
maxSpreadValue: number;
longLegs: NormalizedPosition[];
shortLegs: NormalizedPosition[];
};

export type CoveredCallGroup = {
type: "covered_call";
label: string;
symbol: string;
lots: number;
shareLotsUsed: number;
sharesUsed: number;
shortCalls: NormalizedPosition[];
};

export type AvailableLongCallGroup = {
type: "available_long_calls";
label: string;
symbol: string;
lots: number;
longCalls: NormalizedPosition[];
};

export type ShortPutGroup = {
type: "short_put";
label: string;
symbol: string;
lots: number;
shortPuts: NormalizedPosition[];
};

export type StockBaseGroup = {
type: "stock_base";
label: string;
symbol: string;
shares: number;
shareLots: number;
};

export type PositionGroup =
| StockBaseGroup
| DebitSpreadGroup
| CoveredCallGroup
| AvailableLongCallGroup
| ShortPutGroup;

export type PositionGroupingResult = {
symbol: string;

shares: number;
shareLots: number;

longCallLots: number;
shortCallLots: number;
shortPutLots: number;

debitSpreadLots: number;
unpairedShortCallLots: number;

totalCallSideCapacity: number;
remainingCallSideCapacity: number;

groups: PositionGroup[];

debug: {
longCallsTotal: number;
shortCallsTotal: number;
shortCallsPairedIntoDebitSpreads: number;
shortCallsRemainingAfterSpreads: number;
capacityFormula: string;
};
};

function normalizeSymbol(value: unknown): string {
return String(value ?? "").trim().toUpperCase();
}

function asNumber(value: unknown): number {
const n = Number(value);
return Number.isFinite(n) ? n : 0;
}

function normalizePosition(position: PortfolioPosition): NormalizedPosition | null {
const symbol = normalizeSymbol((position as any).symbol);
const instrumentType = String((position as any).instrumentType ?? "").toLowerCase();
const side = String((position as any).side ?? "").toLowerCase();
const qty = Math.abs(asNumber((position as any).qty));

if (!symbol || qty <= 0) return null;

if (!["stock", "call", "put"].includes(instrumentType)) return null;
if (!["long", "short"].includes(side)) return null;

return {
...position,
symbol,
instrumentType: instrumentType as "stock" | "call" | "put",
side: side as "long" | "short",
qty,
strike:
(position as any).strike == null || (position as any).strike === ""
? undefined
: asNumber((position as any).strike),
expiration: (position as any).expiration || undefined
};
}

function lotCount(positions: NormalizedPosition[]): number {
return positions.reduce((sum, position) => sum + position.qty, 0);
}

function cloneWithQty(position: NormalizedPosition, qty: number): NormalizedPosition {
return {
...position,
qty
};
}

function positionKey(position: NormalizedPosition): string {
return [
position.symbol,
position.instrumentType,
position.side,
position.expiration ?? "",
position.strike ?? "",
JSON.stringify(position)
].join("|");
}

type WorkingLeg = {
position: NormalizedPosition;
remainingQty: number;
};

function buildWorkingLegs(positions: NormalizedPosition[]): WorkingLeg[] {
return positions.map((position) => ({
position,
remainingQty: position.qty
}));
}

function extractRemainingPositions(legs: WorkingLeg[]): NormalizedPosition[] {
return legs
.filter((leg) => leg.remainingQty > 0)
.map((leg) => cloneWithQty(leg.position, leg.remainingQty));
}

/**
* Pair same-expiration long calls below short calls into vertical call debit spreads.
*
* Rule:
* long call strike < short call strike
* same expiration
* same symbol
*
* The short calls inside these spreads are classified as spread shorts.
* They do NOT reduce remaining covered-call capacity in Bryan's capacity model.
*/
function buildDebitSpreads(args: {
symbol: string;
longCalls: NormalizedPosition[];
shortCalls: NormalizedPosition[];
}): {
spreads: DebitSpreadGroup[];
remainingLongCalls: NormalizedPosition[];
remainingShortCalls: NormalizedPosition[];
pairedShortLots: number;
} {
const longLegs = buildWorkingLegs(
args.longCalls
.filter((p) => p.expiration && typeof p.strike === "number")
.sort((a, b) => {
const expCompare = String(a.expiration).localeCompare(String(b.expiration));
if (expCompare !== 0) return expCompare;
return (a.strike ?? 0) - (b.strike ?? 0);
})
);

const shortLegs = buildWorkingLegs(
args.shortCalls
.filter((p) => p.expiration && typeof p.strike === "number")
.sort((a, b) => {
const expCompare = String(a.expiration).localeCompare(String(b.expiration));
if (expCompare !== 0) return expCompare;
return (a.strike ?? 0) - (b.strike ?? 0);
})
);

const spreads: DebitSpreadGroup[] = [];
let pairedShortLots = 0;

for (const shortLeg of shortLegs) {
if (shortLeg.remainingQty <= 0) continue;

const short = shortLeg.position;
const shortStrike = short.strike;
const expiration = short.expiration;

if (!expiration || typeof shortStrike !== "number") continue;

/**
* Best matching long:
* same expiration, lower strike, closest below the short strike.
*
* Example:
* long 37 / short 40 pairs before long 30 / short 40.
*/
const eligibleLongs = longLegs
.filter((longLeg) => {
const long = longLeg.position;
return (
longLeg.remainingQty > 0 &&
long.expiration === expiration &&
typeof long.strike === "number" &&
long.strike < shortStrike
);
})
.sort((a, b) => (b.position.strike ?? 0) - (a.position.strike ?? 0));

for (const longLeg of eligibleLongs) {
if (shortLeg.remainingQty <= 0) break;
if (longLeg.remainingQty <= 0) continue;

const long = longLeg.position;
const longStrike = long.strike;

if (typeof longStrike !== "number") continue;

const matchedLots = Math.min(shortLeg.remainingQty, longLeg.remainingQty);
if (matchedLots <= 0) continue;

shortLeg.remainingQty -= matchedLots;
longLeg.remainingQty -= matchedLots;
pairedShortLots += matchedLots;

const width = shortStrike - longStrike;

spreads.push({
type: "debit_spread",
label: `${longStrike}/${shortStrike} call debit spread`,
symbol: args.symbol,
expiration,
longStrike,
shortStrike,
lots: matchedLots,
width,
maxSpreadValue: width * 100 * matchedLots,
longLegs: [cloneWithQty(long, matchedLots)],
shortLegs: [cloneWithQty(short, matchedLots)]
});
}
}

return {
spreads,
remainingLongCalls: extractRemainingPositions(longLegs),
remainingShortCalls: extractRemainingPositions(shortLegs),
pairedShortLots
};
}

export function groupTickerPositions(
symbolInput: string,
positions: PortfolioPosition[]
): PositionGroupingResult {
const symbol = normalizeSymbol(symbolInput);

const normalized = positions
.map(normalizePosition)
.filter((position): position is NormalizedPosition => position != null)
.filter((position) => position.symbol === symbol);

const stockPositions = normalized.filter((p) => p.instrumentType === "stock");
const longCalls = normalized.filter((p) => p.instrumentType === "call" && p.side === "long");
const shortCalls = normalized.filter((p) => p.instrumentType === "call" && p.side === "short");
const shortPuts = normalized.filter((p) => p.instrumentType === "put" && p.side === "short");

const shares = stockPositions.reduce((sum, position) => {
return sum + (position.side === "long" ? position.qty : -position.qty);
}, 0);

const shareLots = Math.max(0, Math.floor(shares / 100));
const longCallLots = lotCount(longCalls);
const shortCallLots = lotCount(shortCalls);
const shortPutLots = lotCount(shortPuts);

const spreadBuild = buildDebitSpreads({
symbol,
longCalls,
shortCalls
});

const debitSpreadLots = spreadBuild.spreads.reduce((sum, spread) => sum + spread.lots, 0);

/**
* Bryan capacity rule:
*
* Total call-side coverage capacity = share lots + all long-call lots.
*
* Debit spread shorts are grouped separately and are not treated as consuming
* remaining covered-call selling capacity.
*
* Remaining capacity = total call-side capacity - unpaired short calls.
*/
const unpairedShortCallLots = lotCount(spreadBuild.remainingShortCalls);
const totalCallSideCapacity = shareLots + longCallLots;
const remainingCallSideCapacity = Math.max(0, totalCallSideCapacity - shortCallLots);

const groups: PositionGroup[] = [];

groups.push({
type: "stock_base",
label: "Stock base",
symbol,
shares,
shareLots
});

if (spreadBuild.spreads.length) {
groups.push(...spreadBuild.spreads);
}

if (spreadBuild.remainingShortCalls.length) {
const lots = lotCount(spreadBuild.remainingShortCalls);

groups.push({
type: "covered_call",
label: "Unpaired short calls / covered-call exposure",
symbol,
lots,
shareLotsUsed: Math.min(shareLots, lots),
sharesUsed: Math.min(shareLots, lots) * 100,
shortCalls: spreadBuild.remainingShortCalls
});
}

if (spreadBuild.remainingLongCalls.length) {
groups.push({
type: "available_long_calls",
label: "Available long calls / LEAPS coverage",
symbol,
lots: lotCount(spreadBuild.remainingLongCalls),
longCalls: spreadBuild.remainingLongCalls
});
}

if (shortPuts.length) {
groups.push({
type: "short_put",
label: "Short put exposure",
symbol,
lots: shortPutLots,
shortPuts
});
}

return {
symbol,
shares,
shareLots,

longCallLots,
shortCallLots,
shortPutLots,

debitSpreadLots,
unpairedShortCallLots,

totalCallSideCapacity,
remainingCallSideCapacity,

groups,

debug: {
longCallsTotal: longCallLots,
shortCallsTotal: shortCallLots,
shortCallsPairedIntoDebitSpreads: spreadBuild.pairedShortLots,
shortCallsRemainingAfterSpreads: unpairedShortCallLots,
capacityFormula: `${shareLots} share lots + ${longCallLots} long call lots - ${shortCallLots} short calls = ${remainingCallSideCapacity} remaining`
}
};
}
function groupTypeToUserType(type: string): UserPositionGroupType {
if (type === "stock_base") return "stock_base";
if (type === "covered_call") return "covered_call";
if (type === "debit_spread") return "debit_spread";
if (type === "available_long_calls") return "long_call";
if (type === "short_put") return "short_put";
return "custom";
}

export function buildSuggestedUserPositionGroups(
symbol: string,
positions: PortfolioPosition[]
): UserPositionGroup[] {
const grouped = groupTickerPositions(symbol, positions);

return grouped.groups.map((group, index) => {
let legIds: string[] = [];

if (group.type === "stock_base") {
legIds = positions
.filter(
(p) =>
String((p as any).symbol ?? "").toUpperCase() === symbol.toUpperCase() &&
(p as any).instrumentType === "stock"
)
.map(makePositionLegId);
}

if (group.type === "covered_call") {
legIds = group.shortCalls.map(makePositionLegId);
}

if (group.type === "debit_spread") {
legIds = [
...group.longLegs.map(makePositionLegId),
...group.shortLegs.map(makePositionLegId)
];
}

if (group.type === "available_long_calls") {
legIds = group.longCalls.map(makePositionLegId);
}

if (group.type === "short_put") {
legIds = group.shortPuts.map(makePositionLegId);
}

return {
id: `${symbol.toUpperCase()}-${group.type}-${index}`,
name: group.label,
strategyType: groupTypeToUserType(group.type),
legIds,
notes: "Auto-suggested by grouping engine.",
userLocked: false
};
});
}



