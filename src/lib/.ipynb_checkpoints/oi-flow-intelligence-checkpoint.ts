type OptionRow = {
  strike: number;
  callOI: number;
  putOI: number;
  callVolume: number;
  putVolume: number;
  expiration: string;
  dte: number;
};

type Snapshot = {
  chain: OptionRow[];
};

type PressureType = "overwriter" | "directional" | "neutral" | "unconfirmed";

type OIFlowLevel = {
  strike: number;

  callOI: number;
  putOI: number;

  callOIChange?: number;
  putOIChange?: number;

  weightedCallOI: number;
  weightedPutOI: number;

  callPressureType: PressureType;
  putPressureType: PressureType;

  callPressureScore: number;
  putPressureScore: number;
};
function rowKey(row: any): string {
  const expiration =
    row.expiration ??
    row.expirationDate ??
    row.expiry ??
    "";

  const strike = Number(row.strike ?? 0);

  const side =
    row.side ??
    row.optionType ??
    row.type ??
    "";

  return `${String(expiration)}|${strike}|${String(side).toLowerCase()}`;
}



function dteWeight(dte: number): number {
  return 1 / (1 + Math.max(0, dte) / 10);
}

function normalizeDistance(x?: number): number {
  if (typeof x !== "number" || !Number.isFinite(x)) return 0;
  return Math.min(1, Math.abs(x) / 50000);
}

function normalizeVolume(x: number): number {
  return Math.min(1, Math.abs(x) / 50000);
}

function clamp(x: number, min: number, max: number) {
  return Math.max(min, Math.min(max, x));
}

function volumeToOI(volume: number, oi: number): number {
  if (!oi || oi <= 0) return 0;
  return volume / oi;
}

function classifyPressure(args: {
  oi: number;
  volume: number;
  oiChange?: number;
}): PressureType {
  const volToOi = volumeToOI(args.volume, args.oi);

  if (args.oi <= 0 && args.volume <= 0) return "neutral";

  // Critical rule:
  // no prior snapshot = no confirmed ΔOI = no directional classification.
  if (typeof args.oiChange !== "number" || !Number.isFinite(args.oiChange)) {
    return "unconfirmed";
  }

  if (volToOi > 0.4 && args.oiChange > 0) {
    return "directional";
  }

  if (args.oi > 0) {
    return "overwriter";
  }

  return "neutral";
}

function pressureScore(args: {
  oi: number;
  volume: number;
  oiChange?: number;
  dte: number;
}): number {
  const weight = dteWeight(args.dte);
  const volToOi = volumeToOI(args.volume, args.oi);

  // Do not award ΔOI component unless prior snapshot exists.
  const oiChangeComponent =
    typeof args.oiChange === "number" && Number.isFinite(args.oiChange)
      ? 25 * normalizeDistance(args.oiChange)
      : 0;

  return clamp(
    oiChangeComponent +
      25 * Math.min(1, volToOi) +
      25 * normalizeVolume(args.volume) +
      25 * weight,
    0,
    100
  );
}

export function buildOIFlowLevels(
  current: Snapshot,
  prior?: Snapshot
): OIFlowLevel[] {
  const hasPriorSnapshot = Boolean(prior?.chain?.length);
  const priorMap = new Map<string, any>();

  prior?.chain?.forEach((row) => {
    priorMap.set(rowKey(row), row);
  });

  return current.chain.map((row) => {
    const prev = priorMap.get(rowKey(row));

    const callOIChange =
      hasPriorSnapshot && prev ? row.callOI - prev.callOI : undefined;

    const putOIChange =
      hasPriorSnapshot && prev ? row.putOI - prev.putOI : undefined;

    const weight = dteWeight(row.dte);

    const weightedCallOI = row.callOI * weight;
    const weightedPutOI = row.putOI * weight;

    const callPressureType = classifyPressure({
      oi: row.callOI,
      volume: row.callVolume,
      oiChange: callOIChange
    });

    const putPressureType = classifyPressure({
      oi: row.putOI,
      volume: row.putVolume,
      oiChange: putOIChange
    });

    const callPressureScore = pressureScore({
      oi: row.callOI,
      volume: row.callVolume,
      oiChange: callOIChange,
      dte: row.dte
    });

    const putPressureScore = pressureScore({
      oi: row.putOI,
      volume: row.putVolume,
      oiChange: putOIChange,
      dte: row.dte
    });

    return {
      strike: row.strike,

      callOI: row.callOI,
      putOI: row.putOI,

      callOIChange,
      putOIChange,

      weightedCallOI,
      weightedPutOI,

      callPressureType,
      putPressureType,

      callPressureScore,
      putPressureScore
    };
  });
}