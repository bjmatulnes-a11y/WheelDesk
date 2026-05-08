import { ChainRow, ExpirationChain, ExpirationSummary } from "./types";

function weightedOrZero(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

export function summarizeExpiration(expiration: string, rows: ChainRow[], currentPrice: number): ExpirationSummary {
  const totalCallOi = rows.reduce((sum, row) => sum + row.callOi, 0);
  const totalPutOi = rows.reduce((sum, row) => sum + row.putOi, 0);

  const callWeightedStrike = weightedOrZero(rows.reduce((sum, row) => sum + row.callOi * row.strike, 0), totalCallOi);
  const putWeightedStrike = weightedOrZero(rows.reduce((sum, row) => sum + row.putOi * row.strike, 0), totalPutOi);

  const combinedCenter = weightedOrZero(
    rows.reduce((sum, row) => sum + (row.callOi + row.putOi) * row.strike, 0),
    totalCallOi + totalPutOi
  );

  // OI range method: top 3 total OI strikes define concentration band.
  const topByOi = [...rows]
    .sort((a, b) => b.callOi + b.putOi - (a.callOi + a.putOi))
    .slice(0, Math.min(3, rows.length));

  const lowerRange = Math.min(...topByOi.map((r) => r.strike));
  const upperRange = Math.max(...topByOi.map((r) => r.strike));

  const callWall = [...rows].sort((a, b) => b.callOi - a.callOi)[0]?.strike ?? combinedCenter;
  const putWall = [...rows].sort((a, b) => b.putOi - a.putOi)[0]?.strike ?? combinedCenter;

  const prevailingScore = scoreExpiration(rows, currentPrice, expiration, callWall, putWall);

  return {
    expiration,
    totalCallOi,
    totalPutOi,
    callWeightedStrike,
    putWeightedStrike,
    combinedCenter,
    lowerRange,
    upperRange,
    callWall,
    putWall,
    prevailingScore
  };
}

export function scoreExpiration(
  rows: ChainRow[],
  currentPrice: number,
  expiration: string,
  callWall: number,
  putWall: number
): number {
  const totalOi = rows.reduce((sum, row) => sum + row.callOi + row.putOi, 0);

  const nearMoneyOi = rows
    .filter((r) => Math.abs(r.strike - currentPrice) / currentPrice <= 0.05)
    .reduce((sum, row) => sum + row.callOi + row.putOi, 0);

  const wallStrength = rows
    .filter((r) => r.strike === callWall || r.strike === putWall)
    .reduce((sum, row) => sum + row.callOi + row.putOi, 0);

  const center = weightedOrZero(
    rows.reduce((sum, row) => sum + (row.callOi + row.putOi) * row.strike, 0),
    totalOi
  );
  const distancePenalty = Math.abs(center - currentPrice) / currentPrice;

  const monthlyBonus = expiration.endsWith("-19") || expiration.endsWith("-20") || expiration.endsWith("-21") ? 0.08 : 0;

  return totalOi * 0.0001 + nearMoneyOi * 0.0002 + wallStrength * 0.0001 + monthlyBonus - distancePenalty;
}

export function rankPrevailingChains(chains: ExpirationChain[]): ExpirationChain[] {
  return [...chains].sort((a, b) => b.summary.prevailingScore - a.summary.prevailingScore);
}
