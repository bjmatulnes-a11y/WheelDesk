import { ChainRow, ChainSnapshot, ExpirationSummary } from "./types";
import { OIProjectionReport } from "./oi-projection-engine";

export type PressureType = "overwriter" | "directional" | "neutral" | "unconfirmed";

export type PrevailingLevel = {
  strike: number;
  score: number;
  openInterest: number;
  distancePct: number;
  type: "support" | "resistance";
  label: string;

  volume: number;
  oiChange?: number;
  weightedOpenInterest: number;
  dteWeight: number;
  volumeToOi: number;
  pressureType: PressureType;
  pressureScore: number;
};

export type PrevailingLevels = {
  support: PrevailingLevel | null;
  resistance: PrevailingLevel | null;

  supports: PrevailingLevel[];
  resistances: PrevailingLevel[];

  magnet: {
    strike: number;
    label: string;
  };

  quality: {
    valid: boolean;
    supportCount: number;
    resistanceCount: number;
    notes: string[];
  };
};

type InternalLevel = PrevailingLevel & {
  oiChangeTotal?: number;
  hasPriorOi: boolean;
};

function safeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function getCallVolume(row: ChainRow): number {
  const r = row as any;
  return safeNumber(r.callVolume ?? r.callVol ?? r.callsVolume ?? r.volumeCall);
}

function getPutVolume(row: ChainRow): number {
  const r = row as any;
  return safeNumber(r.putVolume ?? r.putVol ?? r.putsVolume ?? r.volumePut);
}

function getCallOi(row: ChainRow): number {
  return safeNumber((row as any).callOi);
}

function getPutOi(row: ChainRow): number {
  return safeNumber((row as any).putOi);
}

function getPriorRowMap(snapshot?: ChainSnapshot | null): Map<string, ChainRow> {
  const map = new Map<string, ChainRow>();

  if (!snapshot?.chains?.length) return map;

  for (const chain of snapshot.chains) {
    for (const row of chain.rows ?? []) {
      map.set(`${chain.expiration}|${row.strike}`, row);
    }
  }

  return map;
}

function getPriorRow(args: {
  priorMap: Map<string, ChainRow>;
  expiration: string;
  strike: number;
}): ChainRow | undefined {
  return args.priorMap.get(`${args.expiration}|${args.strike}`);
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
  return 1 / (1 + Math.max(0, dte) / 90);
}

function frontMonthBoost(dte: number): number {
  if (dte <= 7) return 1.5;
  if (dte <= 14) return 1.25;
  if (dte <= 30) return 1.1;
  return 1;
}

function chainScoreMultiplier(chainScore?: number): number {
  const score = safeNumber(chainScore);
  return 1 + Math.min(0.5, Math.max(0, score) / 20);
}

function volumeToOi(volume: number, oi: number): number {
  if (oi <= 0) return 0;
  return volume / oi;
}

function normalizeChange(value?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.abs(value) / 50_000);
}

function normalizeVolume(value: number): number {
  return Math.min(1, Math.abs(value) / 50_000);
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function classifyPressure(args: {
  openInterest: number;
  volume: number;
  oiChange?: number;
}): PressureType {
  const voi = volumeToOi(args.volume, args.openInterest);

  if (args.openInterest <= 0 && args.volume <= 0) return "neutral";

  /**
   * Critical rule:
   * If no prior snapshot exists, we cannot call this directional.
   * Volume can imply activity, but it does not prove OI build until OI updates.
   */
  if (typeof args.oiChange !== "number" || !Number.isFinite(args.oiChange)) {
    return "unconfirmed";
  }

  if (voi >= 0.4 && args.oiChange > 0) return "directional";

  if (args.openInterest > 0) return "overwriter";

  return "neutral";
}

function pressureScore(args: {
  openInterest: number;
  volume: number;
  oiChange?: number;
  dte?: number;
}): number {
  const dte = args.dte ?? 30;
  const timeWeight = dteWeight(dte) * frontMonthBoost(dte);
  const voi = volumeToOi(args.volume, args.openInterest);
  const hasRealOiChange = typeof args.oiChange === "number" && Number.isFinite(args.oiChange);

  /**
   * If ΔOI is unavailable, do not award the ΔOI confirmation component.
   * The score can still reflect OI, volume, Vol/OI, and DTE pressure,
   * but it should not be treated as confirmed directional flow.
   */
  const oiChangeComponent = hasRealOiChange ? 25 * normalizeChange(args.oiChange) : 0;

  return clamp(
    oiChangeComponent +
      25 * Math.min(1, voi) +
      25 * normalizeVolume(args.volume) +
      25 * Math.min(1, timeWeight),
    0,
    100
  );
}

function candidateScore(args: {
  strike: number;
  currentPrice: number;
  openInterest: number;
  volume?: number;
  oiChange?: number;
  chainScore?: number;
  dte?: number;
}): number {
  const dte = args.dte ?? 30;
  const dteMultiplier = dteWeight(dte) * frontMonthBoost(dte);

  /**
   * Critical rule:
   * Only boost score from flow if ΔOI is real.
   * Missing prior snapshot should not act like positive flow.
   */
  const flowBoost =
    typeof args.oiChange === "number" && Number.isFinite(args.oiChange)
      ? 1 + Math.min(0.5, Math.max(0, args.oiChange) / 50_000)
      : 1;

  const volumeBoost = 1 + Math.min(0.35, volumeToOi(args.volume ?? 0, args.openInterest));

  return (
    oiWeight(args.openInterest) *
    proximityWeight(args.strike, args.currentPrice) *
    chainScoreMultiplier(args.chainScore) *
    dteMultiplier *
    flowBoost *
    volumeBoost
  );
}

function buildQuality(args: {
  supportCount: number;
  resistanceCount: number;
  magnet: number;
  currentPrice: number;
  hasPriorSnapshot: boolean;
}): PrevailingLevels["quality"] {
  const notes: string[] = [];

  if (args.supportCount === 0) {
    notes.push("No valid prevailing support candidates found below spot.");
  }

  if (args.resistanceCount === 0) {
    notes.push("No valid prevailing resistance candidates found above spot.");
  }

  if (!args.hasPriorSnapshot) {
    notes.push("No prior surface snapshot provided; ΔOI and directional confirmation are unavailable.");
  }

  const magnetDistancePct =
    args.currentPrice > 0 ? Math.abs(args.magnet - args.currentPrice) / args.currentPrice : 999;

  if (magnetDistancePct > 0.2) {
    notes.push("OI magnet is more than 20% from spot; treat magnet gravity as lower confidence.");
  }

  return {
    valid: args.supportCount > 0 || args.resistanceCount > 0,
    supportCount: args.supportCount,
    resistanceCount: args.resistanceCount,
    notes
  };
}

function finalizeLevel(level: InternalLevel, fallbackDte: number): PrevailingLevel {
  const oiChange = level.hasPriorOi ? level.oiChangeTotal ?? 0 : undefined;

  return {
    ...level,
    oiChange,
    pressureType: classifyPressure({
      openInterest: level.openInterest,
      volume: level.volume,
      oiChange
    }),
    pressureScore: pressureScore({
      openInterest: level.openInterest,
      volume: level.volume,
      oiChange,
      dte: fallbackDte
    })
  };
}

function addOrUpdateLevel(args: {
  map: Map<number, InternalLevel>;
  strike: number;
  openInterest: number;
  volume: number;
  oiChange?: number;
  hasPriorOi: boolean;
  score: number;
  currentPrice: number;
  type: "support" | "resistance";
  dte: number;
}) {
  const existing = args.map.get(args.strike);

  const nextOpenInterest = (existing?.openInterest ?? 0) + args.openInterest;
  const nextVolume = (existing?.volume ?? 0) + args.volume;
  const nextScore = (existing?.score ?? 0) + args.score;
  const nextWeightedOpenInterest =
    (existing?.weightedOpenInterest ?? 0) + args.openInterest * dteWeight(args.dte);

  const nextHasPrior = Boolean(existing?.hasPriorOi) || args.hasPriorOi;

  const nextOiChange =
    args.hasPriorOi || typeof existing?.oiChangeTotal === "number"
      ? (existing?.oiChangeTotal ?? 0) + (args.oiChange ?? 0)
      : undefined;

  args.map.set(args.strike, {
    strike: args.strike,
    openInterest: nextOpenInterest,
    score: nextScore,
    distancePct: Math.abs(args.strike - args.currentPrice) / Math.max(args.currentPrice, 0.01),
    type: args.type,
    label:
      args.type === "support"
        ? `Surface Support ${args.strike.toFixed(2)}`
        : `Surface Resistance ${args.strike.toFixed(2)}`,
    volume: nextVolume,
    oiChange: nextHasPrior ? nextOiChange ?? 0 : undefined,
    oiChangeTotal: nextOiChange,
    hasPriorOi: nextHasPrior,
    weightedOpenInterest: nextWeightedOpenInterest,
    dteWeight: dteWeight(args.dte),
    volumeToOi: volumeToOi(nextVolume, nextOpenInterest),
    pressureType: "unconfirmed",
    pressureScore: 0
  });
}

export function getPrevailingLevels(args: {
  rows: ChainRow[];
  summary: ExpirationSummary;
  currentPrice: number;
}): PrevailingLevels {
  const { rows, summary, currentPrice } = args;

  const supportCandidates = rows
    .filter((row) => row.strike < currentPrice)
    .filter((row) => isActiveStrike(row.strike, currentPrice))
    .map((row) => {
      const openInterest = getPutOi(row);
      const volume = getPutVolume(row);

      const base: InternalLevel = {
        strike: row.strike,
        openInterest,
        score: candidateScore({
          strike: row.strike,
          currentPrice,
          openInterest,
          volume
        }),
        distancePct: Math.abs(row.strike - currentPrice) / Math.max(currentPrice, 0.01),
        type: "support",
        label: `Prevailing Support ${row.strike.toFixed(2)}`,
        volume,
        oiChange: undefined,
        oiChangeTotal: undefined,
        hasPriorOi: false,
        weightedOpenInterest: openInterest,
        dteWeight: 1,
        volumeToOi: volumeToOi(volume, openInterest),
        pressureType: "unconfirmed" as PressureType,
        pressureScore: 0
      };

      return finalizeLevel(base, 30);
    })
    .filter((x) => x.openInterest > 0)
    .sort((a, b) => b.score - a.score);

  const resistanceCandidates = rows
    .filter((row) => row.strike > currentPrice)
    .filter((row) => isActiveStrike(row.strike, currentPrice))
    .map((row) => {
      const openInterest = getCallOi(row);
      const volume = getCallVolume(row);

      const base: InternalLevel = {
        strike: row.strike,
        openInterest,
        score: candidateScore({
          strike: row.strike,
          currentPrice,
          openInterest,
          volume
        }),
        distancePct: Math.abs(row.strike - currentPrice) / Math.max(currentPrice, 0.01),
        type: "resistance",
        label: `Prevailing Resistance ${row.strike.toFixed(2)}`,
        volume,
        oiChange: undefined,
        oiChangeTotal: undefined,
        hasPriorOi: false,
        weightedOpenInterest: openInterest,
        dteWeight: 1,
        volumeToOi: volumeToOi(volume, openInterest),
        pressureType: "unconfirmed" as PressureType,
        pressureScore: 0
      };

      return finalizeLevel(base, 30);
    })
    .filter((x) => x.openInterest > 0)
    .sort((a, b) => b.score - a.score);

  return {
    support: supportCandidates[0] ?? null,
    resistance: resistanceCandidates[0] ?? null,
    supports: supportCandidates.slice(0, 5),
    resistances: resistanceCandidates.slice(0, 5),
    magnet: {
      strike: summary.combinedCenter,
      label: `OI Magnet ${summary.combinedCenter.toFixed(2)}`
    },
    quality: buildQuality({
      supportCount: supportCandidates.length,
      resistanceCount: resistanceCandidates.length,
      magnet: summary.combinedCenter,
      currentPrice,
      hasPriorSnapshot: false
    })
  };
}

export function getSurfacePrevailingLevels(args: {
  snapshot: ChainSnapshot | null;
  projectionReport: OIProjectionReport | null;
  currentPrice: number;
  priorSnapshot?: ChainSnapshot | null;
}): PrevailingLevels | null {
  const { snapshot, projectionReport, currentPrice, priorSnapshot } = args;

  if (!snapshot || !currentPrice) return null;

  const hasPriorSnapshot = Boolean(priorSnapshot?.chains?.length);
  const priorMap = getPriorRowMap(priorSnapshot);

  const supportMap = new Map<number, InternalLevel>();
  const resistanceMap = new Map<number, InternalLevel>();

  for (const chain of snapshot.chains ?? []) {
    const projectionPoint = projectionReport?.points.find((p) => p.expiration === chain.expiration);
    const dte = projectionPoint?.dte ?? 30;
    const chainScore = chain.summary?.prevailingScore;

    for (const row of chain.rows ?? []) {
      if (!isActiveStrike(row.strike, currentPrice)) continue;

      if (row.strike < currentPrice && getPutOi(row) > 0) {
        const openInterest = getPutOi(row);
        const volume = getPutVolume(row);
        const priorRow = getPriorRow({
          priorMap,
          expiration: chain.expiration,
          strike: row.strike
        });
  
        const priorOi = priorRow ? getPutOi(priorRow) : 0;
        const hasPriorOi = priorRow !== undefined;
        const oiChange = hasPriorOi ? openInterest - priorOi : undefined;

        const score = candidateScore({
          strike: row.strike,
          currentPrice,
          openInterest,
          volume,
          oiChange,
          chainScore,
          dte
        });

        addOrUpdateLevel({
          map: supportMap,
          strike: row.strike,
          openInterest,
          volume,
          oiChange,
          hasPriorOi,
          score,
          currentPrice,
          type: "support",
          dte
        });
      }

      if (row.strike > currentPrice && getCallOi(row) > 0) {
        const openInterest = getCallOi(row);
        const volume = getCallVolume(row);
        const priorRow = getPriorRow({
          priorMap,
          expiration: chain.expiration,
          strike: row.strike
        });

        const priorOi = priorRow ? getCallOi(priorRow) : 0;
        const hasPriorOi = priorRow !== undefined;
        const oiChange = hasPriorOi ? openInterest - priorOi : undefined;

        const score = candidateScore({
          strike: row.strike,
          currentPrice,
          openInterest,
          volume,
          oiChange,
          chainScore,
          dte
        });

        addOrUpdateLevel({
          map: resistanceMap,
          strike: row.strike,
          openInterest,
          volume,
          oiChange,
          hasPriorOi,
          score,
          currentPrice,
          type: "resistance",
          dte
        });
      }
    }
  }

  const supports = [...supportMap.values()]
    .map((level) => finalizeLevel(level, 30))
    .sort((a, b) => b.score - a.score);

  const resistances = [...resistanceMap.values()]
    .map((level) => finalizeLevel(level, 30))
    .sort((a, b) => b.score - a.score);

  const support = supports[0] ?? null;
  const resistance = resistances[0] ?? null;

  const magnet =
    projectionReport && projectionReport.points.length
      ? projectionReport.points.reduce((sum, p) => sum + p.adjustedCenter * p.weight, 0) /
        Math.max(1, projectionReport.points.reduce((sum, p) => sum + p.weight, 0))
      : currentPrice;

  return {
    support,
    resistance,
    supports: supports.slice(0, 5),
    resistances: resistances.slice(0, 5),
    magnet: {
      strike: magnet,
      label: `Surface Magnet ${magnet.toFixed(2)}`
    },
    quality: buildQuality({
      supportCount: supports.length,
      resistanceCount: resistances.length,
      magnet,
      currentPrice,
      hasPriorSnapshot
    })
  };
}