import type { ConfirmedExecutionSignal } from "./execution/useExecutionSignalPaint";
import type { ExecutionLeg } from "./zeroDteExecutionIntelligence";
import type { ZeroDteShadowTrade } from "./zeroDteShadowTrade";

export type AdaptiveMarginEnvelope = {
  callMarginDollars: number;
  putMarginDollars: number;
  ifMarginDollars: number;
  effectiveMarginDollars: number;
  grossMarginDollars: number;
};

export type AdaptiveReserveEnvelope = {
  callReleaseReserveDollars: number;
  putReleaseReserveDollars: number;
  verticalReleaseReserveDollars: number;
  dominantSide: "CALL" | "PUT" | "BALANCED" | "NONE";
};

/**
 * Active buying-power envelope for one shadow lot.
 *
 * Vertical capacity follows the CURRENT active leg geometry, not the original
 * signal geometry:
 *   7735/7745 -> $1,000 width envelope
 *   +7745 runner -> $0 spread margin
 *   7740/7745 -> $500 width envelope
 *
 * The long premium remains economic P/L, but a paid long option does not keep
 * phantom short-spread margin alive after the short is released.
 */
export function activeTradeMarginDollars(trade: ZeroDteShadowTrade): number {
  const adaptiveClosed = trade.adaptiveState === "closed" || trade.adaptiveStructureState === "CLOSED";
  const legacyClosed = trade.adaptiveState === null && trade.state === "closed";
  if (adaptiveClosed || legacyClosed) return 0;

  if (trade.strategy === "iron-fly") {
    return Math.max(0, trade.maxRiskDollars ?? 0);
  }

  const legs = activeLegs(trade);
  const short = legs.find((leg) => leg.action === "sell") ?? null;
  if (!short) return 0;

  const protectiveLong = findProtectiveLong(trade.strategy, short, legs);
  if (!protectiveLong) {
    // Undefined-risk states should not normally occur in this engine. Preserve
    // the original conservative risk value instead of incorrectly reporting 0.
    return Math.max(0, trade.maxRiskDollars ?? 0);
  }

  return Math.abs(protectiveLong.strike - short.strike) * 100;
}

export function candidateMarginDollars(signal: Pick<ConfirmedExecutionSignal, "strategy" | "legs" | "maxRiskDollars">): number {
  if (signal.strategy === "iron-fly") return Math.max(0, signal.maxRiskDollars ?? 0);
  const short = signal.legs.find((leg) => leg.action === "sell") ?? null;
  if (!short) return Math.max(0, signal.maxRiskDollars ?? 0);
  const long = findProtectiveLong(signal.strategy, short, signal.legs);
  if (!long) return Math.max(0, signal.maxRiskDollars ?? 0);
  return Math.abs(long.strike - short.strike) * 100;
}

export function buildAdaptiveMarginEnvelope(trades: ZeroDteShadowTrade[]): AdaptiveMarginEnvelope {
  let callMarginDollars = 0;
  let putMarginDollars = 0;
  let ifMarginDollars = 0;

  for (const trade of activeAcceptedTrades(trades)) {
    const margin = activeTradeMarginDollars(trade);
    if (trade.strategy === "call-credit-spread") callMarginDollars += margin;
    else if (trade.strategy === "put-credit-spread") putMarginDollars += margin;
    else ifMarginDollars += margin;
  }

  return {
    callMarginDollars,
    putMarginDollars,
    ifMarginDollars,
    effectiveMarginDollars: Math.max(callMarginDollars + ifMarginDollars, putMarginDollars + ifMarginDollars),
    grossMarginDollars: callMarginDollars + putMarginDollars + ifMarginDollars,
  };
}

export function addCandidateToMarginEnvelope(
  envelope: AdaptiveMarginEnvelope,
  strategy: ConfirmedExecutionSignal["strategy"],
  candidateMargin: number,
): AdaptiveMarginEnvelope {
  const callMarginDollars = envelope.callMarginDollars + (strategy === "call-credit-spread" ? candidateMargin : 0);
  const putMarginDollars = envelope.putMarginDollars + (strategy === "put-credit-spread" ? candidateMargin : 0);
  const ifMarginDollars = envelope.ifMarginDollars + (strategy === "iron-fly" ? candidateMargin : 0);
  return {
    callMarginDollars,
    putMarginDollars,
    ifMarginDollars,
    effectiveMarginDollars: Math.max(callMarginDollars + ifMarginDollars, putMarginDollars + ifMarginDollars),
    grossMarginDollars: callMarginDollars + putMarginDollars + ifMarginDollars,
  };
}

/**
 * Cash reserve required to be able to release threatened vertical shorts.
 * This scales with the ACTUAL open short inventory; there is no hardened lot
 * count. Because call and put shorts cannot both be the adverse directional
 * side at settlement, the reserve is based on the larger side's aggregate
 * short-release need rather than blindly summing both books.
 */
export function buildAdaptiveReserveEnvelope(
  trades: ZeroDteShadowTrade[],
  candidate?: {
    strategy: ConfirmedExecutionSignal["strategy"];
    shortSellPrice: number | null;
  } | null,
): AdaptiveReserveEnvelope {
  let callReleaseReserveDollars = 0;
  let putReleaseReserveDollars = 0;

  for (const trade of activeAcceptedTrades(trades)) {
    if (trade.strategy === "iron-fly") continue;
    const short = activeLegs(trade).find((leg) => leg.action === "sell") ?? null;
    if (!short) continue;
    const entry = activeShortEntryPrice(trade, short);
    if (entry === null || entry <= 0) continue;
    const currentAsk = currentShortAsk(trade, short);
    const releaseDebit = Math.max(entry * 3, currentAsk == null ? 0 : currentAsk * 1.1);
    const dollars = releaseDebit * 100;
    if (trade.strategy === "call-credit-spread") callReleaseReserveDollars += dollars;
    else putReleaseReserveDollars += dollars;
  }

  if (candidate?.shortSellPrice != null && candidate.shortSellPrice > 0) {
    const dollars = candidate.shortSellPrice * 3 * 100;
    if (candidate.strategy === "call-credit-spread") callReleaseReserveDollars += dollars;
    else if (candidate.strategy === "put-credit-spread") putReleaseReserveDollars += dollars;
  }

  const verticalReleaseReserveDollars = Math.max(callReleaseReserveDollars, putReleaseReserveDollars);
  const dominantSide: AdaptiveReserveEnvelope["dominantSide"] =
    verticalReleaseReserveDollars <= 0
      ? "NONE"
      : Math.abs(callReleaseReserveDollars - putReleaseReserveDollars) < 0.01
        ? "BALANCED"
        : callReleaseReserveDollars > putReleaseReserveDollars
          ? "CALL"
          : "PUT";

  return {
    callReleaseReserveDollars,
    putReleaseReserveDollars,
    verticalReleaseReserveDollars,
    dominantSide,
  };
}

/** Current negative adaptive mark on released/repaired vertical episodes. */
export function portfolioRepairDeficitDollars(trades: ZeroDteShadowTrade[]): number {
  return roundMoney(
    activeAcceptedTrades(trades).reduce((sum, trade) => {
      if (trade.strategy === "iron-fly") return sum;
      const hasRepairHistory = (trade.adaptiveStructureHistory ?? []).some(
        (item) => item.action === "RELEASE_SHORT" || item.action === "REINSTATE_SHORT",
      );
      if (!hasRepairHistory) return sum;
      const pnl = trade.adaptiveMarkedPnlDollars ?? trade.adaptivePnlDollars ?? 0;
      return sum + Math.max(0, -pnl);
    }, 0),
  );
}

export function activeLegs(trade: ZeroDteShadowTrade): ExecutionLeg[] {
  return trade.adaptiveActiveLegs?.length ? trade.adaptiveActiveLegs : trade.legs;
}

function activeAcceptedTrades(trades: ZeroDteShadowTrade[]) {
  return trades.filter(
    (trade) =>
      trade.portfolioDecision === "TAKE" &&
      trade.state !== "skipped" &&
      (trade.state === "open" || trade.adaptiveState === "open"),
  );
}

function findProtectiveLong(
  strategy: ConfirmedExecutionSignal["strategy"],
  short: ExecutionLeg,
  legs: ExecutionLeg[],
) {
  const longs = legs.filter(
    (leg) => leg.action === "buy" && leg.optionType === short.optionType,
  );
  if (strategy === "call-credit-spread") {
    return longs
      .filter((leg) => leg.strike > short.strike)
      .sort((a, b) => a.strike - b.strike)[0] ?? null;
  }
  if (strategy === "put-credit-spread") {
    return longs
      .filter((leg) => leg.strike < short.strike)
      .sort((a, b) => b.strike - a.strike)[0] ?? null;
  }
  return null;
}

function activeShortEntryPrice(trade: ZeroDteShadowTrade, short: ExecutionLeg) {
  const repaired = [...(trade.adaptiveStructureHistory ?? [])]
    .reverse()
    .find(
      (item) =>
        item.action === "REINSTATE_SHORT" &&
        item.strike != null &&
        Math.abs(item.strike - short.strike) < 0.01 &&
        item.price != null &&
        item.price > 0,
    );
  if (repaired?.price != null) return repaired.price;
  return (
    trade.entryShortLegs.find(
      (item) => item.optionType === short.optionType && Math.abs(item.strike - short.strike) < 0.01,
    )?.sellPrice ?? null
  );
}

function currentShortAsk(trade: ZeroDteShadowTrade, short: ExecutionLeg) {
  const snapshot = (trade.currentLegSnapshots ?? []).find(
    (item) =>
      item.action === "sell" &&
      item.optionType === short.optionType &&
      Math.abs(item.strike - short.strike) < 0.01,
  );
  return snapshot?.ask ?? null;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
