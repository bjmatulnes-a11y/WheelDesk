import type { ZeroDteChainRow, ZeroDteRecommendation } from "./zeroDteOiIntelligence";

export type StrikeFlowActivity = "quiet" | "building" | "active" | "extreme";
export type WallFlowState = "quiet" | "defended" | "attacked" | "absorbed" | "breaking" | "unclear";

export type ZeroDteStrikeFlowRow = {
  strike: number;
  callVolume: number;
  putVolume: number;
  callVolumeDelta: number;
  putVolumeDelta: number;
  totalVolumeDelta: number;
  callOpenInterest: number;
  putOpenInterest: number;
  callVolumeOiRatio: number | null;
  putVolumeOiRatio: number | null;
  deltaBias: "call" | "put" | "balanced";
  activity: StrikeFlowActivity;
  distanceFromSpot: number;
};

export type ZeroDteWallFlowRead = {
  strike: number | null;
  state: WallFlowState;
  volumeDelta: number;
  volumeOiRatio: number | null;
  message: string;
};

export type ZeroDteStrikeFlowRead = {
  tradeDate: string;
  generatedAt: string;
  previousGeneratedAt: string | null;
  elapsedMinutes: number | null;
  previousSpxPrice: number | null;
  currentSpxPrice: number;
  priceChange: number | null;
  hasPriorSnapshot: boolean;
  totalCallVolumeDelta: number;
  totalPutVolumeDelta: number;
  netVolumeDelta: number;
  callWall: ZeroDteWallFlowRead;
  putWall: ZeroDteWallFlowRead;
  rows: ZeroDteStrikeFlowRow[];
  notes: string[];
};

type StoredSnapshot = {
  tradeDate: string;
  generatedAt: string;
  expiration: string | null;
  spxPrice: number;
  rows: Array<{
    strike: number;
    optionType: "call" | "put";
    volume: number;
    openInterest: number;
  }>;
};

const STORAGE_PREFIX = "wheeldesk.zeroDte.strikeFlow";

export function updateZeroDteStrikeFlow(args: {
  tradeDate: string;
  generatedAt: string;
  expiration?: string | null;
  spxPrice: number;
  rows: ZeroDteChainRow[];
  recommendation: ZeroDteRecommendation;
}): ZeroDteStrikeFlowRead {
  const current = toSnapshot(args);
  const previous = readSnapshot(args.tradeDate, args.expiration ?? null);
  const read = buildZeroDteStrikeFlowRead(current, previous, args.recommendation);
  writeSnapshot(current);
  return read;
}

export function buildZeroDteStrikeFlowRead(
  current: StoredSnapshot,
  previous: StoredSnapshot | null,
  recommendation: ZeroDteRecommendation
): ZeroDteStrikeFlowRead {
  const currentMap = aggregate(current.rows);
  const previousMap = aggregate(previous?.rows ?? []);
  const strikes = [...currentMap.keys()].sort((a, b) => a - b);

  const deltas = strikes.map((strike) => {
    const now = currentMap.get(strike)!;
    const before = previousMap.get(strike) ?? emptyAggregate();
    return {
      strike,
      callVolume: now.callVolume,
      putVolume: now.putVolume,
      callVolumeDelta: Math.max(0, now.callVolume - before.callVolume),
      putVolumeDelta: Math.max(0, now.putVolume - before.putVolume),
      callOpenInterest: now.callOpenInterest,
      putOpenInterest: now.putOpenInterest,
    };
  });

  const totalDelta = deltas.reduce((sum, row) => sum + row.callVolumeDelta + row.putVolumeDelta, 0);
  const activeFloor = Math.max(25, totalDelta * 0.025);
  const extremeFloor = Math.max(150, totalDelta * 0.08);

  const rows: ZeroDteStrikeFlowRow[] = deltas.map((row) => {
    const totalVolumeDelta = row.callVolumeDelta + row.putVolumeDelta;
    const imbalance = row.callVolumeDelta - row.putVolumeDelta;
    const biasThreshold = Math.max(10, totalVolumeDelta * 0.15);
    const activity: StrikeFlowActivity = !previous
      ? "quiet"
      : totalVolumeDelta >= extremeFloor
      ? "extreme"
      : totalVolumeDelta >= activeFloor
      ? "active"
      : totalVolumeDelta >= Math.max(10, activeFloor * 0.35)
      ? "building"
      : "quiet";

    return {
      ...row,
      totalVolumeDelta,
      callVolumeOiRatio: ratio(row.callVolume, row.callOpenInterest),
      putVolumeOiRatio: ratio(row.putVolume, row.putOpenInterest),
      deltaBias: imbalance > biasThreshold ? "call" : imbalance < -biasThreshold ? "put" : "balanced",
      activity,
      distanceFromSpot: row.strike - current.spxPrice,
    };
  });

  const priceChange = previous ? current.spxPrice - previous.spxPrice : null;
  const callWall = classifyCallWall({
    strike: recommendation.spx.callWall,
    rows,
    previousPrice: previous?.spxPrice ?? null,
    currentPrice: current.spxPrice,
  });
  const putWall = classifyPutWall({
    strike: recommendation.spx.putWall,
    rows,
    previousPrice: previous?.spxPrice ?? null,
    currentPrice: current.spxPrice,
  });

  const totalCallVolumeDelta = rows.reduce((sum, row) => sum + row.callVolumeDelta, 0);
  const totalPutVolumeDelta = rows.reduce((sum, row) => sum + row.putVolumeDelta, 0);
  const elapsedMinutes = previous ? Math.max(0, (Date.parse(current.generatedAt) - Date.parse(previous.generatedAt)) / 60000) : null;
  const notes = previous
    ? [
        `Flow compares this harvest with ${previous.generatedAt}.`,
        "OI remains the structural map; cumulative volume deltas are used only as an execution confirmation layer.",
      ]
    : [
        "Baseline strike-volume snapshot saved. Harvest again to calculate volume acceleration.",
        "The first snapshot cannot distinguish recent flow from volume accumulated earlier in the session.",
      ];

  return {
    tradeDate: current.tradeDate,
    generatedAt: current.generatedAt,
    previousGeneratedAt: previous?.generatedAt ?? null,
    elapsedMinutes,
    previousSpxPrice: previous?.spxPrice ?? null,
    currentSpxPrice: current.spxPrice,
    priceChange,
    hasPriorSnapshot: Boolean(previous),
    totalCallVolumeDelta,
    totalPutVolumeDelta,
    netVolumeDelta: totalCallVolumeDelta - totalPutVolumeDelta,
    callWall,
    putWall,
    rows,
    notes,
  };
}

function classifyCallWall(args: {
  strike: number | null;
  rows: ZeroDteStrikeFlowRow[];
  previousPrice: number | null;
  currentPrice: number;
}): ZeroDteWallFlowRead {
  const row = nearest(args.strike, args.rows);
  if (!args.strike || !row) return wallRead(args.strike, "unclear", 0, null, "No call-wall flow row is available.");
  if (args.previousPrice === null) return wallRead(args.strike, "quiet", row.callVolumeDelta, row.callVolumeOiRatio, "Baseline saved; another harvest is needed.");
  const nearNow = Math.abs(args.currentPrice - args.strike) <= 8;
  const approached = args.previousPrice < args.strike && args.currentPrice >= args.previousPrice;
  const crossed = args.previousPrice <= args.strike && args.currentPrice > args.strike + 3;
  const rejected = (nearNow || approached) && args.currentPrice < args.strike && args.currentPrice < args.previousPrice;
  const active = row.activity === "active" || row.activity === "extreme";
  if (active && crossed) return wallRead(args.strike, "attacked", row.callVolumeDelta, row.callVolumeOiRatio, "Call flow accelerated while price accepted above the call wall. Do not fade the breakout.");
  if (active && rejected) return wallRead(args.strike, "defended", row.callVolumeDelta, row.callVolumeOiRatio, "Call flow accelerated and price rejected below the call wall.");
  if (active && nearNow) return wallRead(args.strike, "unclear", row.callVolumeDelta, row.callVolumeOiRatio, "Call wall is active, but price has not confirmed defense or acceptance.");
  return wallRead(args.strike, "quiet", row.callVolumeDelta, row.callVolumeOiRatio, "No meaningful new call-wall volume acceleration.");
}

function classifyPutWall(args: {
  strike: number | null;
  rows: ZeroDteStrikeFlowRow[];
  previousPrice: number | null;
  currentPrice: number;
}): ZeroDteWallFlowRead {
  const row = nearest(args.strike, args.rows);
  if (!args.strike || !row) return wallRead(args.strike, "unclear", 0, null, "No put-wall flow row is available.");
  if (args.previousPrice === null) return wallRead(args.strike, "quiet", row.putVolumeDelta, row.putVolumeOiRatio, "Baseline saved; another harvest is needed.");
  const nearNow = Math.abs(args.currentPrice - args.strike) <= 8;
  const approached = args.previousPrice > args.strike && args.currentPrice <= args.previousPrice;
  const crossed = args.previousPrice >= args.strike && args.currentPrice < args.strike - 3;
  const bounced = (nearNow || approached) && args.currentPrice > args.strike && args.currentPrice > args.previousPrice;
  const active = row.activity === "active" || row.activity === "extreme";
  if (active && crossed) return wallRead(args.strike, "breaking", row.putVolumeDelta, row.putVolumeOiRatio, "Put flow accelerated while price accepted below the put wall. Do not fade the breakdown.");
  if (active && bounced) return wallRead(args.strike, "absorbed", row.putVolumeDelta, row.putVolumeOiRatio, "Put flow accelerated and price reclaimed above the put wall.");
  if (active && nearNow) return wallRead(args.strike, "unclear", row.putVolumeDelta, row.putVolumeOiRatio, "Put wall is active, but price has not confirmed absorption or acceptance.");
  return wallRead(args.strike, "quiet", row.putVolumeDelta, row.putVolumeOiRatio, "No meaningful new put-wall volume acceleration.");
}

function wallRead(strike: number | null, state: WallFlowState, volumeDelta: number, volumeOiRatio: number | null, message: string): ZeroDteWallFlowRead {
  return { strike, state, volumeDelta, volumeOiRatio, message };
}

function toSnapshot(args: {
  tradeDate: string;
  generatedAt: string;
  expiration?: string | null;
  spxPrice: number;
  rows: ZeroDteChainRow[];
}): StoredSnapshot {
  return {
    tradeDate: args.tradeDate,
    generatedAt: args.generatedAt,
    expiration: args.expiration ?? null,
    spxPrice: args.spxPrice,
    rows: args.rows.map((row) => ({
      strike: row.strike,
      optionType: row.optionType,
      volume: finite(row.volume),
      openInterest: finite(row.openInterest),
    })),
  };
}

function aggregate(rows: StoredSnapshot["rows"]) {
  const map = new Map<number, ReturnType<typeof emptyAggregate>>();
  for (const row of rows) {
    const strike = Math.round(row.strike / 5) * 5;
    const value = map.get(strike) ?? emptyAggregate();
    if (row.optionType === "call") {
      value.callVolume += row.volume;
      value.callOpenInterest += row.openInterest;
    } else {
      value.putVolume += row.volume;
      value.putOpenInterest += row.openInterest;
    }
    map.set(strike, value);
  }
  return map;
}

function emptyAggregate() {
  return { callVolume: 0, putVolume: 0, callOpenInterest: 0, putOpenInterest: 0 };
}

function nearest(strike: number | null, rows: ZeroDteStrikeFlowRow[]) {
  if (!strike || !rows.length) return null;
  return [...rows].sort((a, b) => Math.abs(a.strike - strike) - Math.abs(b.strike - strike))[0] ?? null;
}

function ratio(volume: number, openInterest: number) {
  return openInterest > 0 ? volume / openInterest : volume > 0 ? null : 0;
}

function finite(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function storageKey(tradeDate: string, expiration: string | null) {
  return `${STORAGE_PREFIX}.${tradeDate}.${expiration ?? "none"}`;
}

function readSnapshot(tradeDate: string, expiration: string | null): StoredSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(tradeDate, expiration));
    return raw ? (JSON.parse(raw) as StoredSnapshot) : null;
  } catch {
    return null;
  }
}

function writeSnapshot(snapshot: StoredSnapshot) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(snapshot.tradeDate, snapshot.expiration), JSON.stringify(snapshot));
  } catch {
    // Flow is an enhancement. A storage failure must not block the harvest.
  }
}
