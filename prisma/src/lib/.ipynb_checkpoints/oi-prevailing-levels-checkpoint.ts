import { ChainRow, ChainSnapshot, ExpirationSummary } from "./types";
import { OIProjectionReport } from "./oi-projection-engine";

export type PrevailingLevel = {
  strike: number;
  score: number;
  openInterest: number;
  distancePct: number;
  type: "support" | "resistance";
  label: string;
};

export type PrevailingLevels = {
  support: PrevailingLevel | null;
  resistance: PrevailingLevel | null;
  magnet: {
    strike: number;
    label: string;
  };
};

function safeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isActiveStrike(strike: number, currentPrice: number): boolean {
  if (!currentPrice) return false;
  const distancePct = Math.abs(strike - currentPrice) / currentPrice;
  return distancePct <= 0.45;
}

function proximityWeight(strike: number, currentPrice: number): number {
  const distancePct = Math.abs(strike - currentPrice) / Math.max(currentPrice, 0.01);
  return 1 / (1 + distancePct * 8);
}

function oiWeight(oi: number): number {
  return Math.log10(Math.max(oi, 1) + 1);
}

function dteWeight(dte: number): number {
  return 1 / (1 + dte / 90);
}

function candidateScore(args: {
  strike: number;
  currentPrice: number;
  openInterest: number;
  chainScore?: number;
  dte?: number;
}): number {
  return (
    oiWeight(args.openInterest) *
    proximityWeight(args.strike, args.currentPrice) *
    Math.max(1, safeNumber(args.chainScore) / 10) *
    dteWeight(args.dte ?? 30)
  );
}

export function getPrevailingLevels(args: {
  rows: ChainRow[];
  summary: ExpirationSummary;
  currentPrice: number;
}): PrevailingLevels {
  const { rows, summary, currentPrice } = args;

  const support = rows
    .filter((row) => row.strike < currentPrice)
    .filter((row) => isActiveStrike(row.strike, currentPrice))
    .map((row) => {
      const openInterest = safeNumber(row.putOi);
      return {
        strike: row.strike,
        openInterest,
        score: candidateScore({ strike: row.strike, currentPrice, openInterest }),
        distancePct: Math.abs(row.strike - currentPrice) / currentPrice,
        type: "support" as const,
        label: `Prevailing Support ${row.strike.toFixed(2)}`
      };
    })
    .filter((x) => x.openInterest > 0)
    .sort((a, b) => b.score - a.score)[0] ?? null;

  const resistance = rows
    .filter((row) => row.strike > currentPrice)
    .filter((row) => isActiveStrike(row.strike, currentPrice))
    .map((row) => {
      const openInterest = safeNumber(row.callOi);
      return {
        strike: row.strike,
        openInterest,
        score: candidateScore({ strike: row.strike, currentPrice, openInterest }),
        distancePct: Math.abs(row.strike - currentPrice) / currentPrice,
        type: "resistance" as const,
        label: `Prevailing Resistance ${row.strike.toFixed(2)}`
      };
    })
    .filter((x) => x.openInterest > 0)
    .sort((a, b) => b.score - a.score)[0] ?? null;

  return {
    support,
    resistance,
    magnet: {
      strike: summary.combinedCenter,
      label: `OI Magnet ${summary.combinedCenter.toFixed(2)}`
    }
  };
}

export function getSurfacePrevailingLevels(args: {
  snapshot: ChainSnapshot | null;
  projectionReport: OIProjectionReport | null;
  currentPrice: number;
}): PrevailingLevels | null {
  const { snapshot, projectionReport, currentPrice } = args;
  if (!snapshot || !currentPrice) return null;

  const supportMap = new Map<number, PrevailingLevel>();
  const resistanceMap = new Map<number, PrevailingLevel>();

  for (const chain of snapshot.chains) {
    const projectionPoint = projectionReport?.points.find((p) => p.expiration === chain.expiration);
    const dte = projectionPoint?.dte ?? 30;
    const chainScore = chain.summary.prevailingScore;

    for (const row of chain.rows) {
      if (!isActiveStrike(row.strike, currentPrice)) continue;

      if (row.strike < currentPrice && safeNumber(row.putOi) > 0) {
        const openInterest = safeNumber(row.putOi);
        const score = candidateScore({
          strike: row.strike,
          currentPrice,
          openInterest,
          chainScore,
          dte
        });

        const existing = supportMap.get(row.strike);
        supportMap.set(row.strike, {
          strike: row.strike,
          openInterest: (existing?.openInterest ?? 0) + openInterest,
          score: (existing?.score ?? 0) + score,
          distancePct: Math.abs(row.strike - currentPrice) / currentPrice,
          type: "support",
          label: `Surface Support ${row.strike.toFixed(2)}`
        });
      }

      if (row.strike > currentPrice && safeNumber(row.callOi) > 0) {
        const openInterest = safeNumber(row.callOi);
        const score = candidateScore({
          strike: row.strike,
          currentPrice,
          openInterest,
          chainScore,
          dte
        });

        const existing = resistanceMap.get(row.strike);
        resistanceMap.set(row.strike, {
          strike: row.strike,
          openInterest: (existing?.openInterest ?? 0) + openInterest,
          score: (existing?.score ?? 0) + score,
          distancePct: Math.abs(row.strike - currentPrice) / currentPrice,
          type: "resistance",
          label: `Surface Resistance ${row.strike.toFixed(2)}`
        });
      }
    }
  }

  const support = [...supportMap.values()].sort((a, b) => b.score - a.score)[0] ?? null;
  const resistance = [...resistanceMap.values()].sort((a, b) => b.score - a.score)[0] ?? null;

  const magnet =
    projectionReport && projectionReport.points.length
      ? projectionReport.points.reduce((sum, p) => sum + p.adjustedCenter * p.weight, 0) /
        Math.max(1, projectionReport.points.reduce((sum, p) => sum + p.weight, 0))
      : currentPrice;

  return {
    support,
    resistance,
    magnet: {
      strike: magnet,
      label: `Surface Magnet ${magnet.toFixed(2)}`
    }
  };
}