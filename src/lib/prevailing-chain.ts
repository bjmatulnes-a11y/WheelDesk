import { ChainRow, ExpirationChain } from "./types";

type PriorRowDelta = {
  callDelta: number;
  putDelta: number;
};

function weightedAverage(rows: ChainRow[], value: (row: ChainRow) => number, weight: (row: ChainRow) => number): number {
  const totalWeight = rows.reduce((sum, row) => sum + weight(row), 0);
  if (!totalWeight) return 0;
  return rows.reduce((sum, row) => sum + value(row) * weight(row), 0) / totalWeight;
}

function isMonthlyExpiration(expiration: string): boolean {
  const d = new Date(`${expiration}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.getUTCDay() !== 5) return false;
  const day = d.getUTCDate();
  return day >= 15 && day <= 21;
}

function rowMap(rows: ChainRow[]): Map<number, ChainRow> {
  return new Map(rows.map((row) => [row.strike, row]));
}

function getDodDeltas(current: ChainRow[], prior?: ChainRow[]): PriorRowDelta {
  if (!prior?.length) return { callDelta: 0, putDelta: 0 };
  const priorByStrike = rowMap(prior);
  return current.reduce(
    (acc, row) => {
      const prev = priorByStrike.get(row.strike);
      if (!prev) return acc;
      return {
        callDelta: acc.callDelta + (row.callOi - prev.callOi),
        putDelta: acc.putDelta + (row.putOi - prev.putOi)
      };
    },
    { callDelta: 0, putDelta: 0 }
  );
}

function scoreChain(chain: ExpirationChain, currentPrice: number, priorRows?: ChainRow[]): number {
  const rows = chain.rows;
  const totalOi = rows.reduce((sum, row) => sum + row.callOi + row.putOi, 0);
  const nearMoneyOi = rows
    .filter((row) => Math.abs(row.strike - currentPrice) / Math.max(currentPrice, 0.01) <= 0.03)
    .reduce((sum, row) => sum + row.callOi + row.putOi, 0);
  const center = weightedAverage(rows, (row) => row.strike, (row) => row.callOi + row.putOi);
  const centerDistancePenalty = Math.abs(center - currentPrice) / Math.max(currentPrice, 0.01);
  const wallRow = rows.reduce(
    (best, row) => {
      const oi = row.callOi + row.putOi;
      if (!best || oi > best.oi) return { oi, strike: row.strike };
      return best;
    },
    null as null | { oi: number; strike: number }
  );
  const wallStrength = wallRow?.oi ?? 0;
  const dod = getDodDeltas(rows, priorRows);

  const monthlyScore = isMonthlyExpiration(chain.expiration) ? 0.12 : 0;
  const oiScore = totalOi * 0.00008;
  const concentrationScore = nearMoneyOi * 0.00018;
  const wallScore = wallStrength * 0.00012;
  const distanceScore = -centerDistancePenalty;
  const dodScore = (dod.callDelta + dod.putDelta) * 0.00003;

  return oiScore + concentrationScore + wallScore + monthlyScore + distanceScore + dodScore;
}

export function rankPrevailingChains(
  chains: ExpirationChain[],
  currentPrice: number,
  priorSnapshot?: ExpirationChain[]
): ExpirationChain[] {
  const priorMap = new Map((priorSnapshot ?? []).map((chain) => [chain.expiration, chain.rows]));
  return [...chains]
    .map((chain) => {
      const score = scoreChain(chain, currentPrice, priorMap.get(chain.expiration));
      return {
        ...chain,
        summary: {
          ...chain.summary,
          prevailingScore: score
        }
      };
    })
    .sort((a, b) => b.summary.prevailingScore - a.summary.prevailingScore);
}

