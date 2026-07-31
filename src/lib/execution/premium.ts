import type { ZeroDteChainRow } from "../zeroDteOiIntelligence";
import type { IronFlyLegs, PremiumPoint } from "./types";

function usablePrice(row: ZeroDteChainRow | undefined) {
  if (!row) return null;
  if ((row.mid ?? 0) > 0) return Number(row.mid);
  if ((row.bid ?? 0) > 0 && (row.ask ?? 0) > 0) {
    return (Number(row.bid) + Number(row.ask)) / 2;
  }
  if ((row.last ?? 0) > 0) return Number(row.last);
  return null;
}

function nearest(
  rows: ZeroDteChainRow[],
  optionType: "call" | "put",
  strike: number,
) {
  return rows
    .filter((row) => row.optionType === optionType)
    .sort((a, b) => Math.abs(a.strike - strike) - Math.abs(b.strike - strike))[0];
}

export function estimateIronFlyCredit(
  rows: ZeroDteChainRow[],
  legs: IronFlyLegs,
) {
  const shortPut = usablePrice(nearest(rows, "put", legs.shortPut));
  const shortCall = usablePrice(nearest(rows, "call", legs.shortCall));
  const longPut = usablePrice(nearest(rows, "put", legs.lowerWing));
  const longCall = usablePrice(nearest(rows, "call", legs.upperWing));

  if (
    shortPut === null ||
    shortCall === null ||
    longPut === null ||
    longCall === null
  ) {
    return null;
  }

  const credit = shortPut + shortCall - longPut - longCall;
  return Number.isFinite(credit) && credit > 0 ? credit : null;
}

export function appendPremiumPoint(
  history: PremiumPoint[],
  timestamp: string,
  credit: number | null,
) {
  if (credit === null) return history;

  const previous = history.at(-1);
  const elapsedMinutes = previous
    ? Math.max(
        (Date.parse(timestamp) - Date.parse(previous.timestamp)) / 60_000,
        1 / 60,
      )
    : 0;

  const velocityPerMinute =
    previous && elapsedMinutes > 0
      ? (credit - previous.credit) / elapsedMinutes
      : 0;

  const nextPoint = {
    timestamp,
    credit,
    velocityPerMinute,
  };

  const next =
    previous?.timestamp === timestamp
      ? [...history.slice(0, -1), nextPoint]
      : [...history, nextPoint];

  return next.slice(-360);
}

export function premiumStats(history: PremiumPoint[]) {
  const latest = history.at(-1);
  const peak = history.length
    ? Math.max(...history.map((point) => point.credit))
    : null;

  return {
    currentCredit: latest?.credit ?? null,
    peakCredit: peak,
    velocityPerMinute: latest?.velocityPerMinute ?? 0,
    creditOffPeakPct:
      latest && peak && peak > 0
        ? ((peak - latest.credit) / peak) * 100
        : null,
  };
}
