import type { ZeroDteChainRow, ZeroDteRecommendation } from "./zeroDteOiIntelligence";

export type IronFlyClockState = {
  newEntryAllowed: boolean;
  sessionPhase: "preopen" | "open" | "midday" | "power_hour" | "late" | "closed";
  triggerMultiple: number;
  warning: string;
};

export type IronFlyPositionInput = {
  spxRows: ZeroDteChainRow[];
  recommendation: ZeroDteRecommendation;
  center: number;
  lowerWing: number;
  upperWing: number;
  quantity: number;
  entryCredit: number;
  entryPutShortCredit?: number | null;
  entryCallShortCredit?: number | null;
  openedAt?: string | null;
  now?: Date;
};

export type IronFlySideReport = {
  side: "put" | "call";
  shortStrike: number;
  longStrike: number;
  width: number;
  currentShortMark: number | null;
  currentLongMark: number | null;
  entryShortCredit: number | null;
  shortMarkMultiple: number | null;
  distanceToShort: number;
  distanceToBreakeven: number;
  touchedShort: boolean;
  outsideBreakeven: boolean;
  status: "safe" | "watch" | "pressure" | "defend" | "urgent";
  action: string;
  reasons: string[];
};

export type IronFlyPositionReport = {
  valid: boolean;
  errors: string[];
  clock: IronFlyClockState;
  spot: number;
  center: number;
  lowerWing: number;
  upperWing: number;
  downsideWidth: number;
  upsideWidth: number;
  quantity: number;
  entryCredit: number;
  currentCloseDebit: number | null;
  openPnl: number | null;
  maxRisk: number;
  lowerBreakeven: number;
  upperBreakeven: number;
  maxProfit: number;
  weakSide: "put" | "call" | "none";
  status: "safe" | "watch" | "pressure" | "defend" | "urgent";
  action: string;
  putSide: IronFlySideReport;
  callSide: IronFlySideReport;
  managementPlan: string[];
};

export function getIronFlyClockState(now = new Date()): IronFlyClockState {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const total = hour * 60 + minute;

  if (total < 9 * 60 + 30) {
    return {
      sessionPhase: "preopen",
      newEntryAllowed: false,
      triggerMultiple: 3.0,
      warning: "Pre-open. Use placement as a map only until live spreads open.",
    };
  }

  if (total < 11 * 60) {
    return {
      sessionPhase: "open",
      newEntryAllowed: true,
      triggerMultiple: 3.0,
      warning: "Opening window. Use smaller size until first range stabilizes.",
    };
  }

  if (total < 14 * 60) {
    return {
      sessionPhase: "midday",
      newEntryAllowed: true,
      triggerMultiple: 2.75,
      warning: "Midday. Theta helps, but a trend break still needs fast defense.",
    };
  }

  if (total < 15 * 60) {
    return {
      sessionPhase: "power_hour",
      newEntryAllowed: false,
      triggerMultiple: 2.35,
      warning: "After 2pm ET. Avoid new full-size flies; defense trigger tightened.",
    };
  }

  if (total < 16 * 60 + 15) {
    return {
      sessionPhase: "late",
      newEntryAllowed: false,
      triggerMultiple: 2.0,
      warning: "Late session. Gamma risk is high; prioritize survival over adjustment creativity.",
    };
  }

  return {
    sessionPhase: "closed",
    newEntryAllowed: false,
    triggerMultiple: 2.0,
    warning: "Market closed. Marks may be stale.",
  };
}

export function buildIronFlyPositionReport(input: IronFlyPositionInput): IronFlyPositionReport {
  const errors: string[] = [];
  const rec = input.recommendation;
  const spot = rec.spxPrice;
  const center = roundToFive(input.center);
  const lowerWing = roundToFive(input.lowerWing);
  const upperWing = roundToFive(input.upperWing);
  const downsideWidth = center - lowerWing;
  const upsideWidth = upperWing - center;
  const quantity = Math.max(1, Math.floor(input.quantity || 1));
  const entryCredit = safe(input.entryCredit);
  const clock = getIronFlyClockState(input.now);

  if (!(lowerWing < center && center < upperWing)) errors.push("Invalid fly strikes. Lower wing must be below center and upper wing above center.");
  if (entryCredit <= 0) errors.push("Enter the actual total iron-fly credit received in SPX points.");
  if (downsideWidth <= 0 || upsideWidth <= 0) errors.push("Wing width must be positive.");

  const shortPut = findOption(input.spxRows, center, "put");
  const shortCall = findOption(input.spxRows, center, "call");
  const longPut = findOption(input.spxRows, lowerWing, "put");
  const longCall = findOption(input.spxRows, upperWing, "call");

  const currentShortPutMark = mid(shortPut);
  const currentShortCallMark = mid(shortCall);
  const currentLongPutMark = mid(longPut);
  const currentLongCallMark = mid(longCall);

  if (currentShortPutMark == null) errors.push(`Missing live SPX put mid at center ${center}.`);
  if (currentShortCallMark == null) errors.push(`Missing live SPX call mid at center ${center}.`);
  if (currentLongPutMark == null) errors.push(`Missing live SPX put mid at lower wing ${lowerWing}.`);
  if (currentLongCallMark == null) errors.push(`Missing live SPX call mid at upper wing ${upperWing}.`);

  const currentCloseDebit =
    currentShortPutMark != null &&
    currentShortCallMark != null &&
    currentLongPutMark != null &&
    currentLongCallMark != null
      ? Math.max(0, currentShortPutMark + currentShortCallMark - currentLongPutMark - currentLongCallMark)
      : null;

  const openPnl = currentCloseDebit != null ? (entryCredit - currentCloseDebit) * 100 * quantity : null;
  const maxWidth = Math.max(downsideWidth, upsideWidth);
  const maxRisk = Math.max(0, (maxWidth - entryCredit) * 100 * quantity);
  const maxProfit = entryCredit * 100 * quantity;
  const lowerBreakeven = center - entryCredit;
  const upperBreakeven = center + entryCredit;

  const entryPutShortCredit = chooseEntryShortCredit({
    supplied: input.entryPutShortCredit,
    totalCredit: entryCredit,
    currentShort: currentShortPutMark,
    otherCurrentShort: currentShortCallMark,
  });

  const entryCallShortCredit = chooseEntryShortCredit({
    supplied: input.entryCallShortCredit,
    totalCredit: entryCredit,
    currentShort: currentShortCallMark,
    otherCurrentShort: currentShortPutMark,
  });

  const putSide = buildSideReport({
    side: "put",
    spot,
    shortStrike: center,
    longStrike: lowerWing,
    width: downsideWidth,
    breakeven: lowerBreakeven,
    currentShortMark: currentShortPutMark,
    currentLongMark: currentLongPutMark,
    entryShortCredit: entryPutShortCredit,
    triggerMultiple: clock.triggerMultiple,
  });

  const callSide = buildSideReport({
    side: "call",
    spot,
    shortStrike: center,
    longStrike: upperWing,
    width: upsideWidth,
    breakeven: upperBreakeven,
    currentShortMark: currentShortCallMark,
    currentLongMark: currentLongCallMark,
    entryShortCredit: entryCallShortCredit,
    triggerMultiple: clock.triggerMultiple,
  });

  const weakSide = chooseWeakSide(spot, center, putSide.status, callSide.status);
  const status = maxStatus(putSide.status, callSide.status, rec.confidenceScore, clock.sessionPhase);
  const action = actionForStatus(status, weakSide);

  const managementPlan = buildManagementPlan({
    status,
    action,
    weakSide,
    spot,
    center,
    lowerBreakeven,
    upperBreakeven,
    lowerWing,
    upperWing,
    currentCloseDebit,
    entryCredit,
    openPnl,
    clock,
    confidenceScore: rec.confidenceScore,
    dealerPressure: rec.dealerPressure,
    alignmentScore: rec.alignmentScore,
  });

  return {
    valid: errors.length === 0,
    errors,
    clock,
    spot,
    center,
    lowerWing,
    upperWing,
    downsideWidth,
    upsideWidth,
    quantity,
    entryCredit,
    currentCloseDebit,
    openPnl,
    maxRisk,
    lowerBreakeven,
    upperBreakeven,
    maxProfit,
    weakSide,
    status,
    action,
    putSide,
    callSide,
    managementPlan,
  };
}

function buildSideReport(args: {
  side: "put" | "call";
  spot: number;
  shortStrike: number;
  longStrike: number;
  width: number;
  breakeven: number;
  currentShortMark: number | null;
  currentLongMark: number | null;
  entryShortCredit: number | null;
  triggerMultiple: number;
}): IronFlySideReport {
  const distanceToShort = args.side === "put" ? args.spot - args.shortStrike : args.shortStrike - args.spot;
  const distanceToBreakeven = args.side === "put" ? args.spot - args.breakeven : args.breakeven - args.spot;
  const touchedShort = distanceToShort <= 0;
  const outsideBreakeven = distanceToBreakeven <= 0;
  const shortMarkMultiple = args.currentShortMark != null && args.entryShortCredit && args.entryShortCredit > 0
    ? args.currentShortMark / args.entryShortCredit
    : null;

  const reasons: string[] = [];
  if (shortMarkMultiple != null) reasons.push(`Short mark is ${shortMarkMultiple.toFixed(2)}x estimated entry short credit.`);
  if (outsideBreakeven) reasons.push(`Spot is outside the ${args.side} breakeven.`);
  else reasons.push(`Spot is ${distanceToBreakeven.toFixed(1)} point(s) from the ${args.side} breakeven.`);
  if (touchedShort) reasons.push(`Spot has touched/passed the ${args.side} short strike.`);

  let status: IronFlySideReport["status"] = "safe";
  if (outsideBreakeven || (shortMarkMultiple != null && shortMarkMultiple >= args.triggerMultiple + 0.65)) status = "urgent";
  else if (touchedShort || (shortMarkMultiple != null && shortMarkMultiple >= args.triggerMultiple)) status = "defend";
  else if (distanceToBreakeven <= Math.max(args.width * 0.25, 8) || (shortMarkMultiple != null && shortMarkMultiple >= args.triggerMultiple * 0.75)) status = "pressure";
  else if (distanceToBreakeven <= Math.max(args.width * 0.45, 15) || (shortMarkMultiple != null && shortMarkMultiple >= args.triggerMultiple * 0.55)) status = "watch";

  return {
    side: args.side,
    shortStrike: args.shortStrike,
    longStrike: args.longStrike,
    width: args.width,
    currentShortMark: args.currentShortMark,
    currentLongMark: args.currentLongMark,
    entryShortCredit: args.entryShortCredit,
    shortMarkMultiple,
    distanceToShort,
    distanceToBreakeven,
    touchedShort,
    outsideBreakeven,
    status,
    action: actionForStatus(status, args.side),
    reasons,
  };
}

function buildManagementPlan(args: {
  status: IronFlyPositionReport["status"];
  action: string;
  weakSide: "put" | "call" | "none";
  spot: number;
  center: number;
  lowerBreakeven: number;
  upperBreakeven: number;
  lowerWing: number;
  upperWing: number;
  currentCloseDebit: number | null;
  entryCredit: number;
  openPnl: number | null;
  clock: IronFlyClockState;
  confidenceScore: number;
  dealerPressure: number;
  alignmentScore: number;
}): string[] {
  const plan: string[] = [];
  plan.push(args.clock.warning);

  if (args.status === "safe") {
    plan.push("Hold. Spot is inside the iron-fly body and neither short leg is under pressure.");
  } else if (args.status === "watch") {
    plan.push("Watch. Do not add size. Confirm whether SPX is moving toward a breakeven or just testing the center.");
  } else if (args.status === "pressure") {
    plan.push(`Prepare defense on the ${args.weakSide} side. Check live spread mark and liquidity before adjusting.`);
  } else if (args.status === "defend") {
    plan.push(`Defend the ${args.weakSide} side. Candidate actions: close challenged short, roll away from center, or convert to broken wing.`);
  } else {
    plan.push(`Urgent. ${args.weakSide === "none" ? "Position" : `${capitalize(args.weakSide)} side`} is outside normal risk envelope. Reduce risk first.`);
  }

  if (args.currentCloseDebit != null) {
    const ratio = args.entryCredit > 0 ? args.currentCloseDebit / args.entryCredit : 0;
    plan.push(`Current estimated close debit is ${args.currentCloseDebit.toFixed(2)} versus entry credit ${args.entryCredit.toFixed(2)} (${ratio.toFixed(2)}x).`);
  }

  if (args.confidenceScore < 55) plan.push("Placement confidence is below 55. Treat this as a tactical trade, not a set-and-forget pin.");
  if (args.alignmentScore < 55) plan.push("SPY confirmation is weak. SPX-only map may not be enough to trust the pin.");
  if (Math.abs(args.dealerPressure) > 35) plan.push("Dealer pressure is directional. Symmetric fly may need faster defense or a broken-wing structure.");

  plan.push(`Breakevens: ${args.lowerBreakeven.toFixed(1)} / ${args.upperBreakeven.toFixed(1)}. Wings: ${args.lowerWing.toFixed(0)} / ${args.upperWing.toFixed(0)}.`);
  return plan;
}

function chooseEntryShortCredit(args: {
  supplied?: number | null;
  totalCredit: number;
  currentShort: number | null;
  otherCurrentShort: number | null;
}) {
  if (args.supplied && args.supplied > 0) return args.supplied;
  if (args.totalCredit <= 0) return null;
  if (args.currentShort != null && args.otherCurrentShort != null && args.currentShort + args.otherCurrentShort > 0) {
    return args.totalCredit * (args.currentShort / (args.currentShort + args.otherCurrentShort));
  }
  return args.totalCredit / 2;
}

function findOption(rows: ZeroDteChainRow[], strike: number, optionType: "put" | "call") {
  const target = roundToFive(strike);
  return rows.find((row) => row.optionType === optionType && roundToFive(row.strike) === target) ?? null;
}

function mid(row: ZeroDteChainRow | null) {
  if (!row) return null;
  if (typeof row.mid === "number" && Number.isFinite(row.mid) && row.mid > 0) return row.mid;
  if (typeof row.bid === "number" && typeof row.ask === "number" && row.bid >= 0 && row.ask > 0) return (row.bid + row.ask) / 2;
  if (typeof row.last === "number" && Number.isFinite(row.last) && row.last > 0) return row.last;
  return null;
}

function chooseWeakSide(spot: number, center: number, putStatus: IronFlySideReport["status"], callStatus: IronFlySideReport["status"]): "put" | "call" | "none" {
  const putRank = statusRank(putStatus);
  const callRank = statusRank(callStatus);
  if (putRank > callRank) return "put";
  if (callRank > putRank) return "call";
  if (spot < center) return "put";
  if (spot > center) return "call";
  return "none";
}

function maxStatus(
  put: IronFlySideReport["status"],
  call: IronFlySideReport["status"],
  confidenceScore: number,
  phase: IronFlyClockState["sessionPhase"]
): IronFlyPositionReport["status"] {
  const base = statusRank(put) >= statusRank(call) ? put : call;
  if ((phase === "power_hour" || phase === "late") && base === "watch") return "pressure";
  if (confidenceScore < 40 && base === "safe") return "watch";
  return base;
}

function actionForStatus(status: IronFlySideReport["status"], weakSide: "put" | "call" | "none") {
  if (status === "safe") return "Hold";
  if (status === "watch") return "Monitor only / no adds";
  if (status === "pressure") return weakSide === "none" ? "Prepare defense" : `Prepare ${weakSide} defense`;
  if (status === "defend") return weakSide === "none" ? "Defend now" : `Defend ${weakSide} side`;
  return weakSide === "none" ? "Urgent risk reduction" : `Urgent: reduce ${weakSide} risk`;
}

function statusRank(status: IronFlySideReport["status"]) {
  return { safe: 0, watch: 1, pressure: 2, defend: 3, urgent: 4 }[status];
}

function roundToFive(value: number) {
  return Math.round(value / 5) * 5;
}

function safe(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
