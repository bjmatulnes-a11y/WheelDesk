export type ZeroDTESide = "put" | "call";

export type ZeroDTEStrategyType =
  | "put_credit_spread"
  | "call_credit_spread"
  | "iron_condor"
  | "iron_fly"
  | "hedge";

export type ZeroDTEStatus =
  | "safe"
  | "watch"
  | "pressure"
  | "defend"
  | "urgent";

export type ZeroDTEAction =
  | "hold"
  | "monitor"
  | "prepare_defense"
  | "close_short_leg"
  | "urgent_close_short_leg"
  | "avoid_adds"
  | "hedge_weak_side";

export type ZeroDTEProfile = {
  ticker: string;
  expiration: string;

  cashAvailable: number;
  maxDailyLoss: number;
  maxRiskPerTrade: number;
  maxTotalRisk: number;

  defaultWidth: number;
  maxContracts: number;

  putDeltaTargetLow: number;
  putDeltaTargetHigh: number;
  callDeltaTargetLow: number;
  callDeltaTargetHigh: number;

  shortLegTriggerMultiple: number;

  allowShortLegOnlyClose: boolean;
  allowLongLegRunner: boolean;
  allowRecenter: boolean;
  allowHedge: boolean;
};

export type ZeroDTEInternals = {
  add: number;
  tick: number;
  vixChangePct: number;
  top10Breadth: number;
  uvolDvolRatio: number;
};

export type ZeroDTEPressureInputs = {
  sideVolumeNearStrike: number;
  totalSideVolumeWindow: number;
  sideOiAtStrike: number;
  sideVolumeAcceleration: number;
  skewScoreRaw: number;
  priceVelocityRaw: number;
};

export type ZeroDTESpread = {
  id: string;
  ticker: string;
  expiration: string;
  strategyType: ZeroDTEStrategyType;
  side: ZeroDTESide;

  shortStrike: number;
  longStrike: number;
  width: number;
  quantity: number;

  entryCredit: number;
  currentShortMark: number;
  currentLongMark?: number;
  currentSpreadMark?: number;

  entryShortDelta?: number;
  currentShortDelta?: number;

  openedAt: string;
  notes?: string;

  pressureInputs?: ZeroDTEPressureInputs;
};

export type ZeroDTEPortfolioState = {
  profile: ZeroDTEProfile;
  spot: number;
  priorSpot: number;
  internals: ZeroDTEInternals;
  spreads: ZeroDTESpread[];
};

export const defaultZeroDTEProfile: ZeroDTEProfile = {
  ticker: "SPX",
  expiration: "",
  cashAvailable: 10000,
  maxDailyLoss: 1000,
  maxRiskPerTrade: 1000,
  maxTotalRisk: 2500,
  defaultWidth: 20,
  maxContracts: 3,

  putDeltaTargetLow: 8,
  putDeltaTargetHigh: 12,
  callDeltaTargetLow: 16,
  callDeltaTargetHigh: 20,

  shortLegTriggerMultiple: 3,

  allowShortLegOnlyClose: true,
  allowLongLegRunner: true,
  allowRecenter: true,
  allowHedge: true
};

export const defaultZeroDTEInternals: ZeroDTEInternals = {
  add: 0,
  tick: 0,
  vixChangePct: 0,
  top10Breadth: 0.5,
  uvolDvolRatio: 1
};

export function makeZeroDTEId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `zdt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getSpreadWidth(shortStrike: number, longStrike: number): number {
  return Math.abs(shortStrike - longStrike);
}

export function getGrossWidthRisk(spread: Pick<ZeroDTESpread, "width" | "quantity">): number {
  return spread.width * 100 * spread.quantity;
}

export function getCreditReceived(
  spread: Pick<ZeroDTESpread, "entryCredit" | "quantity">
): number {
  return spread.entryCredit * 100 * spread.quantity;
}

export function getMaxSpreadRisk(
  spread: Pick<ZeroDTESpread, "width" | "quantity" | "entryCredit">
): number {
  return Math.max(0, spread.width * 100 * spread.quantity - spread.entryCredit * 100 * spread.quantity);
}

export function getShortLegTrigger(
  spread: Pick<ZeroDTESpread, "entryCredit">,
  profile: Pick<ZeroDTEProfile, "shortLegTriggerMultiple">
): number {
  return spread.entryCredit * profile.shortLegTriggerMultiple;
}

export function getShortMarkMultiple(spread: Pick<ZeroDTESpread, "currentShortMark" | "entryCredit">): number {
  if (spread.entryCredit <= 0) return 0;
  return spread.currentShortMark / spread.entryCredit;
}

export function isSpreadBreached(spread: ZeroDTESpread, spot: number): boolean {
  if (spread.side === "put") return spot <= spread.shortStrike;
  return spot >= spread.shortStrike;
}

export function distanceToShortStrike(spread: ZeroDTESpread, spot: number): number {
  if (spread.side === "put") return spot - spread.shortStrike;
  return spread.shortStrike - spot;
}

export function expirationPnL(spread: ZeroDTESpread, underlyingPrice: number): number {
  const qty = spread.quantity;
  const credit = spread.entryCredit * 100 * qty;

  if (spread.side === "put") {
    const shortIntrinsic = Math.max(spread.shortStrike - underlyingPrice, 0) * 100 * qty;
    const longIntrinsic = Math.max(spread.longStrike - underlyingPrice, 0) * 100 * qty;
    return credit - shortIntrinsic + longIntrinsic;
  }

  const shortIntrinsic = Math.max(underlyingPrice - spread.shortStrike, 0) * 100 * qty;
  const longIntrinsic = Math.max(underlyingPrice - spread.longStrike, 0) * 100 * qty;
  return credit - shortIntrinsic + longIntrinsic;
}

export function getBreakeven(spread: ZeroDTESpread): number {
  if (spread.side === "put") return spread.shortStrike - spread.entryCredit;
  return spread.shortStrike + spread.entryCredit;
}

export function createZeroDTESpread(args: {
  ticker: string;
  expiration: string;
  strategyType: ZeroDTEStrategyType;
  side: ZeroDTESide;
  shortStrike: number;
  longStrike: number;
  quantity: number;
  entryCredit: number;
  currentShortMark?: number;
  entryShortDelta?: number;
  notes?: string;
}): ZeroDTESpread {
  return {
    id: makeZeroDTEId(),
    ticker: args.ticker,
    expiration: args.expiration,
    strategyType: args.strategyType,
    side: args.side,
    shortStrike: args.shortStrike,
    longStrike: args.longStrike,
    width: getSpreadWidth(args.shortStrike, args.longStrike),
    quantity: args.quantity,
    entryCredit: args.entryCredit,
    currentShortMark: args.currentShortMark ?? args.entryCredit,
    entryShortDelta: args.entryShortDelta,
    openedAt: new Date().toISOString(),
    notes: args.notes,
    pressureInputs: {
      sideVolumeNearStrike: 0,
      totalSideVolumeWindow: 0,
      sideOiAtStrike: 0,
      sideVolumeAcceleration: 1,
      skewScoreRaw: 0,
      priceVelocityRaw: 0
    }
  };
}