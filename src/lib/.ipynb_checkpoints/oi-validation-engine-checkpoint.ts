export type ValidationCandle = {
time?: string | number;
date?: string;
open?: number;
high: number;
low: number;
close: number;
volume?: number;
};

export type ValidationHorizon = 1 | 3 | 5 | 10;

export type DailyStructureValidationSetup = {
id: string;
ticker: string;
snapshotDate: string;

spot: number;
supportStrike: number | null;
resistanceStrike: number | null;
magnetStrike: number | null;

projectedBias?: string;
impliedPathDirection: "up" | "down" | "neutral" | "unknown";

source: "daily_structure";
notes: string[];
};

export type HorizonValidationResult = {
horizonDays: ValidationHorizon;
evaluated: boolean;

endDate?: string;
finalClose?: number;
maxHigh?: number;
minLow?: number;

supportBreached: boolean;
resistanceBreached: boolean;
magnetTouched: boolean;

closedAboveResistance: boolean;
closedBelowSupport: boolean;
movedTowardMagnet: boolean;
impliedPathCorrect: boolean | null;

outcomeLabel: string;
};

export type DailyStructureValidationResult = {
setup: DailyStructureValidationSetup;
horizons: HorizonValidationResult[];
};

export type DailyStructureValidationSummary = {
totalSetups: number;
evaluatedSetups: number;

supportBreachRate: number | null;
resistanceBreachRate: number | null;
magnetTouchRate: number | null;
movedTowardMagnetRate: number | null;
impliedPathAccuracy: number | null;

supportHoldRate: number | null;
resistanceHoldRate: number | null;
};

function toDateKey(value: unknown): string {
if (typeof value === "string") return value.slice(0, 10);

if (typeof value === "number") {
const ms = value > 10_000_000_000 ? value : value * 1000;
return new Date(ms).toISOString().slice(0, 10);
}

return "";
}

export function candleDate(candle: ValidationCandle): string {
return toDateKey(candle.date ?? candle.time);
}

function safeNumber(value: unknown): number | null {
const n = Number(value);
return Number.isFinite(n) ? n : null;
}

function isBetween(value: number, low: number, high: number): boolean {
return value >= Math.min(low, high) && value <= Math.max(low, high);
}

function inferDirection(args: {
projectedBias?: string;
spot: number;
magnetStrike: number | null;
}): "up" | "down" | "neutral" | "unknown" {
const raw = String(args.projectedBias ?? "").toLowerCase();

if (
raw.includes("bull") ||
raw.includes("up") ||
raw.includes("higher") ||
raw.includes("positive")
) {
return "up";
}

if (
raw.includes("bear") ||
raw.includes("down") ||
raw.includes("lower") ||
raw.includes("negative")
) {
return "down";
}

if (raw.includes("neutral") || raw.includes("range")) {
return "neutral";
}

if (args.magnetStrike != null && args.spot > 0) {
const diffPct = Math.abs(args.magnetStrike - args.spot) / args.spot;

if (diffPct < 0.005) return "neutral";
if (args.magnetStrike > args.spot) return "up";
if (args.magnetStrike < args.spot) return "down";
}

return "unknown";
}

function evaluatePathDirection(args: {
direction: "up" | "down" | "neutral" | "unknown";
startClose: number;
finalClose: number;
supportStrike: number | null;
resistanceStrike: number | null;
}): boolean | null {
if (args.direction === "unknown") return null;

if (args.direction === "up") {
return args.finalClose > args.startClose;
}

if (args.direction === "down") {
return args.finalClose < args.startClose;
}

const lower = args.supportStrike;
const upper = args.resistanceStrike;

if (args.direction === "neutral" && lower != null && upper != null) {
return args.finalClose >= lower && args.finalClose <= upper;
}

return Math.abs(args.finalClose - args.startClose) / Math.max(args.startClose, 0.01) < 0.02;
}

function buildOutcomeLabel(args: {
supportBreached: boolean;
resistanceBreached: boolean;
magnetTouched: boolean;
impliedPathCorrect: boolean | null;
closedAboveResistance: boolean;
closedBelowSupport: boolean;
}): string {
if (args.closedAboveResistance) return "Closed above resistance";
if (args.closedBelowSupport) return "Closed below support";
if (args.resistanceBreached && args.supportBreached) return "Both sides breached";
if (args.resistanceBreached) return "Resistance breached";
if (args.supportBreached) return "Support breached";
if (args.magnetTouched) return "Magnet touched";
if (args.impliedPathCorrect === true) return "Path correct";
if (args.impliedPathCorrect === false) return "Path failed";
return "Held structure";
}

export function normalizeCandles(raw: unknown[]): ValidationCandle[] {
  return raw
    .map((item: any): ValidationCandle | null => {
      const high = safeNumber(item.high ?? item.h);
      const low = safeNumber(item.low ?? item.l);
      const close = safeNumber(item.close ?? item.c);
      const open = safeNumber(item.open ?? item.o ?? item.close ?? item.c);
      const volume = safeNumber(item.volume ?? item.v);

      const time = item.time ?? item.date ?? item.timestamp;
      const date = item.date ?? item.time ?? item.timestamp;

      if (
        high === null ||
        low === null ||
        close === null ||
        open === null ||
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close) ||
        !Number.isFinite(open)
      ) {
        return null;
      }

      return {
        time,
        date,
        open,
        high,
        low,
        close,
        volume:
          volume !== null && Number.isFinite(volume)
            ? volume
            : undefined,
      };
    })
    .filter((item): item is ValidationCandle => item !== null);
}

export function findSnapshotCandle(args: {
candles: ValidationCandle[];
snapshotDate: string;
}): ValidationCandle | null {
return args.candles.find((c) => candleDate(c) === args.snapshotDate) ?? null;
}

export function validateDailyStructureSetup(args: {
setup: DailyStructureValidationSetup;
candles: ValidationCandle[];
horizons?: ValidationHorizon[];
}): DailyStructureValidationResult {
const horizons = args.horizons ?? [1, 3, 5];
const snapshotDate = args.setup.snapshotDate;

const futureCandles = args.candles
.filter((c) => candleDate(c) > snapshotDate)
.sort((a, b) => candleDate(a).localeCompare(candleDate(b)));

const results: HorizonValidationResult[] = horizons.map((horizonDays) => {
const window = futureCandles.slice(0, horizonDays);

if (window.length < horizonDays) {
return {
horizonDays,
evaluated: false,
supportBreached: false,
resistanceBreached: false,
magnetTouched: false,
closedAboveResistance: false,
closedBelowSupport: false,
movedTowardMagnet: false,
impliedPathCorrect: null,
outcomeLabel: "Not enough future candles"
};
}

const final = window[window.length - 1];
const maxHigh = Math.max(...window.map((c) => c.high));
const minLow = Math.min(...window.map((c) => c.low));

const support = args.setup.supportStrike;
const resistance = args.setup.resistanceStrike;
const magnet = args.setup.magnetStrike;

const supportBreached = support != null ? minLow <= support : false;
const resistanceBreached = resistance != null ? maxHigh >= resistance : false;
const magnetTouched = magnet != null ? window.some((c) => isBetween(magnet, c.low, c.high)) : false;

const closedAboveResistance = resistance != null ? final.close > resistance : false;
const closedBelowSupport = support != null ? final.close < support : false;

const movedTowardMagnet =
magnet != null
? Math.abs(final.close - magnet) < Math.abs(args.setup.spot - magnet)
: false;

const impliedPathCorrect = evaluatePathDirection({
direction: args.setup.impliedPathDirection,
startClose: args.setup.spot,
finalClose: final.close,
supportStrike: support,
resistanceStrike: resistance
});

return {
horizonDays,
evaluated: true,
endDate: candleDate(final),
finalClose: final.close,
maxHigh,
minLow,
supportBreached,
resistanceBreached,
magnetTouched,
closedAboveResistance,
closedBelowSupport,
movedTowardMagnet,
impliedPathCorrect,
outcomeLabel: buildOutcomeLabel({
supportBreached,
resistanceBreached,
magnetTouched,
impliedPathCorrect,
closedAboveResistance,
closedBelowSupport
})
};
});

return {
setup: args.setup,
horizons: results
};
}

function rate(numerator: number, denominator: number): number | null {
if (denominator <= 0) return null;
return numerator / denominator;
}

export function summarizeDailyStructureValidationResults(
results: DailyStructureValidationResult[],
horizon: ValidationHorizon = 5
): DailyStructureValidationSummary {
const evaluated = results
.map((record) => ({
setup: record.setup,
result: record.horizons.find((h) => h.horizonDays === horizon)
}))
.filter((row) => row.result?.evaluated);

const supportRows = evaluated.filter((row) => row.setup.supportStrike != null);
const resistanceRows = evaluated.filter((row) => row.setup.resistanceStrike != null);
const magnetRows = evaluated.filter((row) => row.setup.magnetStrike != null);
const pathRows = evaluated.filter((row) => row.result?.impliedPathCorrect != null);

return {
totalSetups: results.length,
evaluatedSetups: evaluated.length,

supportBreachRate: rate(
supportRows.filter((row) => row.result?.supportBreached).length,
supportRows.length
),

resistanceBreachRate: rate(
resistanceRows.filter((row) => row.result?.resistanceBreached).length,
resistanceRows.length
),

magnetTouchRate: rate(
magnetRows.filter((row) => row.result?.magnetTouched).length,
magnetRows.length
),

movedTowardMagnetRate: rate(
magnetRows.filter((row) => row.result?.movedTowardMagnet).length,
magnetRows.length
),

impliedPathAccuracy: rate(
pathRows.filter((row) => row.result?.impliedPathCorrect).length,
pathRows.length
),

supportHoldRate: rate(
supportRows.filter((row) => !row.result?.supportBreached).length,
supportRows.length
),

resistanceHoldRate: rate(
resistanceRows.filter((row) => !row.result?.resistanceBreached).length,
resistanceRows.length
)
};
}

export function formatRate(value: number | null): string {
if (value == null) return "N/A";
return `${(value * 100).toFixed(1)}%`;
}

export function createDailyStructureValidationSetup(args: {
ticker: string;
snapshotDate: string;
candleClose: number;
supportStrike: number | null;
resistanceStrike: number | null;
magnetStrike: number | null;
projectedBias?: string;
raw?: Record<string, any>;
}): DailyStructureValidationSetup {
const direction = inferDirection({
projectedBias: args.projectedBias,
spot: args.candleClose,
magnetStrike: args.magnetStrike
});

return {
id: `${args.ticker}-${args.snapshotDate}`,
ticker: args.ticker,
snapshotDate: args.snapshotDate,
spot: args.candleClose,
supportStrike: args.supportStrike,
resistanceStrike: args.resistanceStrike,
magnetStrike: args.magnetStrike,
projectedBias: args.projectedBias,
impliedPathDirection: direction,
source: "daily_structure",
notes: [
`Source: daily structure`,
`Spot source: Yahoo candle close`,
`Bias: ${args.projectedBias ?? "N/A"}`,
`Path direction: ${direction}`,
`Support: ${args.supportStrike ?? "N/A"}`,
`Resistance: ${args.resistanceStrike ?? "N/A"}`,
`Magnet: ${args.magnetStrike ?? "N/A"}`
]
};
}
