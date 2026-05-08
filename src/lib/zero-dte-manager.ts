import {
  distanceToShortStrike,
  expirationPnL,
  getBreakeven,
  getCreditReceived,
  getGrossWidthRisk,
  getMaxSpreadRisk,
  getShortLegTrigger,
  getShortMarkMultiple,
  isSpreadBreached,
  ZeroDTEAction,
  ZeroDTEInternals,
  ZeroDTEPressureInputs,
  ZeroDTEProfile,
  ZeroDTESpread,
  ZeroDTEStatus
} from "./zero-dte-profile";

export type ZeroDTEComponentScores = {
  proximityScore: number;
  volumeConcentrationScore: number;
  volumeToOIScore: number;
  volumeAccelerationScore: number;
  skewScore: number;
  priceVelocityScore: number;
  markMultipleScore: number;
};

export type ZeroDTESpreadReport = {
  spread: ZeroDTESpread;

  grossWidthRisk: number;
  maxRisk: number;
  creditReceived: number;
  breakeven: number;

  shortLegTrigger: number;
  shortMarkMultiple: number;

  distanceToShort: number;
  breached: boolean;
  touched: boolean;

  rawAttackScore: number;
  internalsMultiplier: number;
  adjustedAttackScore: number;

  status: ZeroDTEStatus;
  action: ZeroDTEAction;
  weakSide: "put" | "call" | "none";

  scores: ZeroDTEComponentScores;

  reasons: string[];
  managementPlan: string[];
  riskWarnings: string[];

  expirationSlices: {
    price: number;
    pnl: number;
  }[];
};

export type ZeroDTEPortfolioReport = {
  totalGrossWidthRisk: number;
  totalMaxRisk: number;
  totalCreditReceived: number;
  riskUtilizationPct: number;
  overLeverage: "none" | "moderate" | "high";
  portfolioWarnings: string[];
  reports: ZeroDTESpreadReport[];
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function n(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function getProximityScore(spread: ZeroDTESpread, spot: number): number {
  const distance = Math.max(distanceToShortStrike(spread, spot), 0);
  const dangerWindow = Math.max(spread.width * 2, 5);
  return clamp(1 - distance / dangerWindow);
}

function getVolumeConcentrationScore(input?: ZeroDTEPressureInputs): number {
  if (!input) return 0;
  if (input.totalSideVolumeWindow <= 0) return 0;
  return clamp(input.sideVolumeNearStrike / input.totalSideVolumeWindow);
}

function getVolumeToOIScore(input?: ZeroDTEPressureInputs): number {
  if (!input) return 0;
  if (input.sideOiAtStrike <= 0) return 0;
  return clamp(input.sideVolumeNearStrike / input.sideOiAtStrike);
}

function getVolumeAccelerationScore(input?: ZeroDTEPressureInputs): number {
  if (!input) return 0;
  return clamp((input.sideVolumeAcceleration - 1) / 2);
}

function getSkewScore(input?: ZeroDTEPressureInputs): number {
  if (!input) return 0;
  return clamp(input.skewScoreRaw);
}

function getPriceVelocityScore(input: ZeroDTEPressureInputs | undefined, spread: ZeroDTESpread): number {
  if (!input) return 0;
  const scale = Math.max(spread.width, 5);
  return clamp(input.priceVelocityRaw / scale);
}

function getMarkMultipleScore(spread: ZeroDTESpread, profile: ZeroDTEProfile): number {
  const multiple = getShortMarkMultiple(spread);
  return clamp(multiple / profile.shortLegTriggerMultiple);
}

function getInternalsMultiplier(side: "put" | "call", internals: ZeroDTEInternals): number {
  let m = 1.0;

  if (side === "put") {
    if (internals.add < -500) m += 0.1;
    if (internals.add < -1200) m += 0.15;

    if (internals.tick < -300) m += 0.1;
    if (internals.tick < -800) m += 0.15;

    if (internals.vixChangePct > 2) m += 0.1;
    if (internals.vixChangePct > 5) m += 0.15;

    if (internals.top10Breadth < 0.4) m += 0.1;
    if (internals.uvolDvolRatio > 0 && internals.uvolDvolRatio < 0.75) m += 0.1;
  }

  if (side === "call") {
    if (internals.add > 500) m += 0.1;
    if (internals.add > 1200) m += 0.15;

    if (internals.tick > 300) m += 0.1;
    if (internals.tick > 800) m += 0.15;

    if (internals.vixChangePct < -2) m += 0.05;
    if (internals.top10Breadth > 0.6) m += 0.1;
    if (internals.uvolDvolRatio > 1.35) m += 0.1;
  }

  return Math.max(0.8, Math.min(1.5, m));
}

function rawAttackScore(scores: ZeroDTEComponentScores): number {
  const score =
    25 * scores.proximityScore +
    20 * scores.volumeConcentrationScore +
    20 * scores.volumeToOIScore +
    15 * scores.volumeAccelerationScore +
    10 * scores.skewScore +
    10 * scores.priceVelocityScore +
    20 * scores.markMultipleScore;

  return Math.max(0, Math.min(100, score));
}

function classifyStatus(args: {
  adjustedAttackScore: number;
  shortMarkMultiple: number;
  triggerMultiple: number;
  breached: boolean;
  touched: boolean;
}): ZeroDTEStatus {
  const { adjustedAttackScore, shortMarkMultiple, triggerMultiple, breached, touched } = args;

  if (breached && adjustedAttackScore >= 70) return "urgent";
  if (breached) return "defend";

  if (shortMarkMultiple >= triggerMultiple && adjustedAttackScore >= 70) return "urgent";
  if (shortMarkMultiple >= triggerMultiple && adjustedAttackScore >= 55) return "defend";
  if (shortMarkMultiple >= triggerMultiple) return "pressure";

  if (touched && adjustedAttackScore >= 55) return "defend";
  if (adjustedAttackScore >= 80) return "urgent";
  if (adjustedAttackScore >= 65) return "defend";
  if (adjustedAttackScore >= 45) return "pressure";
  if (adjustedAttackScore >= 25) return "watch";

  return "safe";
}

function actionFromStatus(status: ZeroDTEStatus): ZeroDTEAction {
  if (status === "urgent") return "urgent_close_short_leg";
  if (status === "defend") return "close_short_leg";
  if (status === "pressure") return "prepare_defense";
  if (status === "watch") return "monitor";
  return "hold";
}

function buildReasons(args: {
  spread: ZeroDTESpread;
  profile: ZeroDTEProfile;
  scores: ZeroDTEComponentScores;
  shortMarkMultiple: number;
  shortLegTrigger: number;
  distanceToShort: number;
  breached: boolean;
  touched: boolean;
  internalsMultiplier: number;
  adjustedAttackScore: number;
}): string[] {
  const sideName = args.spread.side === "put" ? "Put" : "Call";
  const input = args.spread.pressureInputs;
  const reasons: string[] = [];

  reasons.push(`${sideName} ${args.spread.shortStrike}/${args.spread.longStrike}, width ${args.spread.width}, qty ${args.spread.quantity}.`);
  reasons.push(`Entry credit ${money(args.spread.entryCredit)}; short-leg trigger ${money(args.shortLegTrigger)}.`);
  reasons.push(`Short mark is ${args.shortMarkMultiple.toFixed(2)}x entry credit.`);

  if (args.distanceToShort >= 0) {
    reasons.push(`Spot is ${args.distanceToShort.toFixed(1)} point(s) from the short strike.`);
  } else {
    reasons.push(`Spot is through the short strike by ${Math.abs(args.distanceToShort).toFixed(1)} point(s).`);
  }

  if (input) {
    const concentration =
      input.totalSideVolumeWindow > 0
        ? input.sideVolumeNearStrike / input.totalSideVolumeWindow
        : 0;

    const volOi =
      input.sideOiAtStrike > 0
        ? input.sideVolumeNearStrike / input.sideOiAtStrike
        : 0;

    if (input.sideVolumeNearStrike > 0) {
      reasons.push(`${sideName} volume near strike = ${pct(concentration)} of selected side volume window.`);
    }

    if (input.sideOiAtStrike > 0) {
      reasons.push(`Volume/OI near short strike = ${pct(volOi)}.`);
    }

    if (input.sideVolumeAcceleration > 1.25) {
      reasons.push(`${sideName} flow accelerated ${input.sideVolumeAcceleration.toFixed(1)}x.`);
    }

    if (input.priceVelocityRaw > 0) {
      reasons.push(`Price moved ${input.priceVelocityRaw.toFixed(1)} point(s) toward the short strike in the measured window.`);
    }
  }

  if (args.internalsMultiplier > 1.15) {
    reasons.push(`Internals are amplifying risk (${args.internalsMultiplier.toFixed(2)}x multiplier).`);
  } else if (args.internalsMultiplier < 0.95) {
    reasons.push(`Internals are dampening immediate strike pressure (${args.internalsMultiplier.toFixed(2)}x multiplier).`);
  }

  if (args.breached) reasons.push("Spot has breached the short strike.");
  else if (args.touched) reasons.push("Spot is inside the touch/defense zone.");

  reasons.push(`Adjusted attack score: ${args.adjustedAttackScore.toFixed(0)} / 100.`);

  return reasons;
}

function buildManagementPlan(args: {
  spread: ZeroDTESpread;
  profile: ZeroDTEProfile;
  status: ZeroDTEStatus;
  action: ZeroDTEAction;
  shortLegTrigger: number;
  shortMarkMultiple: number;
  breached: boolean;
}): string[] {
  const sideName = args.spread.side === "put" ? "put" : "call";
  const plan: string[] = [];

  plan.push(`3x short-leg rule: defend when short mark reaches ${money(args.shortLegTrigger)} unless evidence shows only IV noise.`);

  if (args.status === "safe") {
    plan.push("Hold. No immediate adjustment needed.");
    plan.push("Do not add size unless total risk remains inside profile limits.");
    return plan;
  }

  if (args.status === "watch") {
    plan.push("Monitor closely. Pressure is building but not yet a forced adjustment.");
    plan.push("Do not add to the weak side.");
    plan.push("Prepare a short-leg close order in TOS if short mark expands toward the trigger.");
    return plan;
  }

  if (args.status === "pressure") {
    plan.push("Prepare defense. Short leg is under pressure.");
    plan.push(`If short ${sideName} mark reaches 3x and spot continues toward strike, buy back the short ${sideName}.`);
    plan.push(`Leave the long ${sideName} open if momentum continues and you want convexity.`);
    return plan;
  }

  if (args.status === "defend") {
    if (args.profile.allowShortLegOnlyClose) {
      plan.push(`Close the short ${sideName} leg if mark is at/above trigger or price continues toward the strike.`);
    } else {
      plan.push("Close or reduce the full spread because short-leg-only defense is disabled in profile.");
    }

    if (args.profile.allowLongLegRunner) {
      plan.push(`Keep the long ${sideName} open as a runner/hedge after closing the short leg.`);
    }

    if (args.profile.allowRecenter) {
      plan.push(`If pressure cools, consider re-selling a new short ${sideName} closer to the long leg.`);
      plan.push(`Prefer reducing width from ${args.spread.width}pt toward ${Math.max(5, args.spread.width / 2).toFixed(0)}pt.`);
    }

    return plan;
  }

  plan.push(`Urgent: close the short ${sideName} leg or fully defend immediately.`);
  plan.push("Do not immediately re-sell unless price stabilizes and pressure inputs cool.");
  plan.push("If re-entering, use smaller size and narrower width.");
  plan.push("Avoid adding new same-side exposure.");

  return plan;
}

function buildRiskWarnings(spread: ZeroDTESpread, profile: ZeroDTEProfile): string[] {
  const warnings: string[] = [];
  const maxRisk = getMaxSpreadRisk(spread);

  if (maxRisk > profile.maxRiskPerTrade) {
    warnings.push(`This spread max risk ${money(maxRisk)} exceeds max risk per trade ${money(profile.maxRiskPerTrade)}.`);
  }

  if (spread.quantity > profile.maxContracts) {
    warnings.push(`Contracts ${spread.quantity} exceed profile max contracts ${profile.maxContracts}.`);
  }

  if (spread.width > profile.defaultWidth * 1.5) {
    warnings.push(`Width ${spread.width} is materially wider than default width ${profile.defaultWidth}.`);
  }

  return warnings;
}

function buildExpirationSlices(spread: ZeroDTESpread, spot: number): { price: number; pnl: number }[] {
  const width = Math.max(spread.width, 5);
  const prices = [
    spot - width * 2,
    spot - width,
    spread.longStrike,
    spread.shortStrike,
    getBreakeven(spread),
    spot,
    spot + width,
    spot + width * 2
  ];

  const unique = [...new Set(prices.map((p) => Number(p.toFixed(2))))].sort((a, b) => a - b);

  return unique.map((price) => ({
    price,
    pnl: expirationPnL(spread, price)
  }));
}

export function evaluateZeroDTESpread(args: {
  spread: ZeroDTESpread;
  profile: ZeroDTEProfile;
  spot: number;
  internals: ZeroDTEInternals;
}): ZeroDTESpreadReport {
  const { spread, profile, spot, internals } = args;

  const distance = distanceToShortStrike(spread, spot);
  const breached = isSpreadBreached(spread, spot);
  const touched = distance <= Math.max(2, spread.width * 0.25);

  const scores: ZeroDTEComponentScores = {
    proximityScore: getProximityScore(spread, spot),
    volumeConcentrationScore: getVolumeConcentrationScore(spread.pressureInputs),
    volumeToOIScore: getVolumeToOIScore(spread.pressureInputs),
    volumeAccelerationScore: getVolumeAccelerationScore(spread.pressureInputs),
    skewScore: getSkewScore(spread.pressureInputs),
    priceVelocityScore: getPriceVelocityScore(spread.pressureInputs, spread),
    markMultipleScore: getMarkMultipleScore(spread, profile)
  };

  const raw = rawAttackScore(scores);
  const multiplier = getInternalsMultiplier(spread.side, internals);
  const adjusted = Math.max(0, Math.min(100, raw * multiplier));

  const shortMarkMultiple = getShortMarkMultiple(spread);
  const shortLegTrigger = getShortLegTrigger(spread, profile);

  const status = classifyStatus({
    adjustedAttackScore: adjusted,
    shortMarkMultiple,
    triggerMultiple: profile.shortLegTriggerMultiple,
    breached,
    touched
  });

  const action = actionFromStatus(status);

  const reasons = buildReasons({
    spread,
    profile,
    scores,
    shortMarkMultiple,
    shortLegTrigger,
    distanceToShort: distance,
    breached,
    touched,
    internalsMultiplier: multiplier,
    adjustedAttackScore: adjusted
  });

  const managementPlan = buildManagementPlan({
    spread,
    profile,
    status,
    action,
    shortLegTrigger,
    shortMarkMultiple,
    breached
  });

  return {
    spread,
    grossWidthRisk: getGrossWidthRisk(spread),
    maxRisk: getMaxSpreadRisk(spread),
    creditReceived: getCreditReceived(spread),
    breakeven: getBreakeven(spread),
    shortLegTrigger,
    shortMarkMultiple,
    distanceToShort: distance,
    breached,
    touched,
    rawAttackScore: raw,
    internalsMultiplier: multiplier,
    adjustedAttackScore: adjusted,
    status,
    action,
    weakSide: status === "safe" ? "none" : spread.side,
    scores,
    reasons,
    managementPlan,
    riskWarnings: buildRiskWarnings(spread, profile),
    expirationSlices: buildExpirationSlices(spread, spot)
  };
}

export function evaluateZeroDTEPortfolio(args: {
  spreads: ZeroDTESpread[];
  profile: ZeroDTEProfile;
  spot: number;
  internals: ZeroDTEInternals;
}): ZeroDTEPortfolioReport {
  const reports = args.spreads.map((spread) =>
    evaluateZeroDTESpread({
      spread,
      profile: args.profile,
      spot: args.spot,
      internals: args.internals
    })
  );

  const totalGrossWidthRisk = reports.reduce((sum, r) => sum + r.grossWidthRisk, 0);
  const totalMaxRisk = reports.reduce((sum, r) => sum + r.maxRisk, 0);
  const totalCreditReceived = reports.reduce((sum, r) => sum + r.creditReceived, 0);

  const riskUtilizationPct = args.profile.maxTotalRisk > 0 ? totalMaxRisk / args.profile.maxTotalRisk : 0;

  const portfolioWarnings: string[] = [];

  if (totalMaxRisk > args.profile.maxTotalRisk) {
    portfolioWarnings.push(`Total max risk ${money(totalMaxRisk)} exceeds profile max total risk ${money(args.profile.maxTotalRisk)}.`);
  }

  if (totalMaxRisk > args.profile.cashAvailable) {
    portfolioWarnings.push(`Total max risk ${money(totalMaxRisk)} exceeds available cash ${money(args.profile.cashAvailable)}.`);
  }

  const urgentCount = reports.filter((r) => r.status === "urgent" || r.status === "defend").length;
  if (urgentCount > 0) {
    portfolioWarnings.push(`${urgentCount} spread(s) require defense or urgent monitoring.`);
  }

  const overLeverage =
    riskUtilizationPct >= 1
      ? "high"
      : riskUtilizationPct >= 0.7
        ? "moderate"
        : "none";

  if (overLeverage === "high") {
    portfolioWarnings.push("Overleverage risk is high. Do not add new 0DTE exposure.");
  } else if (overLeverage === "moderate") {
    portfolioWarnings.push("Risk usage is elevated. New trades should be small or avoided.");
  }

  return {
    totalGrossWidthRisk,
    totalMaxRisk,
    totalCreditReceived,
    riskUtilizationPct,
    overLeverage,
    portfolioWarnings,
    reports
  };
}