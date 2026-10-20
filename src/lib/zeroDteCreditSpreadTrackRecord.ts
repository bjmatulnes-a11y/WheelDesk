import type { CreditSpreadPlanLeg } from "./zeroDteCreditSpreadPlan";
import type { ZeroDteShadowTrade } from "./zeroDteShadowTrade";

export type CreditSpreadTrackRecord = {
  n: number;
  winRatePct: number;
  averagePnlDollars: number;
  worstLossDollars: number;
  last10Wins: number;
  last10Losses: number;
  matchLevel: "EXACT" | "DROP_TRIGGER" | "DROP_TIME";
};

export function buildCreditSpreadTrackRecord(args: {
  trades: readonly ZeroDteShadowTrade[];
  leg: CreditSpreadPlanLeg | null;
  openingDayType: "INSIDE_RANGE" | "OUTSIDE_UP" | "OUTSIDE_DOWN" | null;
  entryTimeBucket: string | null;
}): CreditSpreadTrackRecord | null {
  const leg = args.leg;
  if (!leg) return null;
  const side = leg.side;
  const strategy = side === "PCS" ? "put-credit-spread" : "call-credit-spread";
  const guardKind = leg.guard?.kind ?? null;
  const distanceEm = leg.distanceEm;
  const base = args.trades.filter((trade) =>
    trade.state === "closed" &&
    trade.source === "PLAN" &&
    (trade.planStatus === "READY" || trade.planStatus === "PAIRED") &&
    trade.strategy === strategy &&
    trade.pnlConservativeDollars !== null &&
    (args.openingDayType === null || trade.openingDayType === args.openingDayType) &&
    trade.planGuardKind != null && guardKind !== null && trade.planGuardKind === guardKind &&
    typeof trade.planDistanceEm === "number" && Math.abs(trade.planDistanceEm - distanceEm) <= 0.1,
  );
  const exact = base.filter((trade) =>
    trade.entryTrigger === leg.entryTrigger &&
    (args.entryTimeBucket === null || trade.entryTimeBucket === args.entryTimeBucket),
  );
  if (exact.length >= 10) return summarize(exact, "EXACT");
  const noTrigger = base.filter((trade) => args.entryTimeBucket === null || trade.entryTimeBucket === args.entryTimeBucket);
  if (noTrigger.length >= 10) return summarize(noTrigger, "DROP_TRIGGER");
  if (base.length) return summarize(base, "DROP_TIME");
  return null;
}

function summarize(
  trades: readonly ZeroDteShadowTrade[],
  matchLevel: CreditSpreadTrackRecord["matchLevel"],
): CreditSpreadTrackRecord {
  const ordered = [...trades].sort((a, b) => Date.parse(a.signalTime) - Date.parse(b.signalTime));
  const pnls = ordered.map((trade) => Number(trade.pnlConservativeDollars ?? 0));
  const wins = pnls.filter((value) => value > 0).length;
  const last10 = pnls.slice(-10);
  return {
    n: pnls.length,
    winRatePct: pnls.length ? (wins / pnls.length) * 100 : 0,
    averagePnlDollars: pnls.length ? pnls.reduce((sum, value) => sum + value, 0) / pnls.length : 0,
    worstLossDollars: pnls.length ? Math.min(...pnls) : 0,
    last10Wins: last10.filter((value) => value > 0).length,
    last10Losses: last10.filter((value) => value <= 0).length,
    matchLevel,
  };
}
