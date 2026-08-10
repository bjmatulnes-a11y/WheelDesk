import type { ZeroDteChainRow } from "../zeroDteOiIntelligence";

export type StructuralLevelKey =
  | "callWall"
  | "putWall"
  | "pin"
  | "gammaFlip"
  | "zeroGamma"
  | "dealerNeutral"
  | "maxPain";

export type StructuralLevel = {
  key: StructuralLevelKey;
  label: string;
  value: number | null;
  strength: number;
  confidence: number;
  distanceFromSpot: number | null;
  basis: string;
};

export type MarketStructureRead = {
  gammaFlip: number | null;
  zeroGamma: number | null;
  dealerNeutral: number | null;
  maxPain: number | null;
  callWallStrength: number;
  putWallStrength: number;
  pinProbability: number;
  structuralConfidence: number;
  dominantLevel: StructuralLevelKey | null;
  dominantLevelValue: number | null;
  supportRanking: StructuralLevel[];
  resistanceRanking: StructuralLevel[];
  levels: StructuralLevel[];
  notes: string[];
};

type StrikeNode = {
  strike: number;
  callOi: number;
  putOi: number;
  callVolume: number;
  putVolume: number;
  callGamma: number;
  putGamma: number;
  signedGamma: number;
  totalGamma: number;
  totalOi: number;
  structureScore: number;
};

export function buildMarketStructureRead(args: {
  spot: number;
  rows: ZeroDteChainRow[];
  callWall: number | null;
  putWall: number | null;
  pin: number | null;
  expectedMove: number;
}): MarketStructureRead {
  const { spot, rows, callWall, putWall, pin, expectedMove } = args;
  const nodes = buildNodes(rows);

  if (!nodes.length || !Number.isFinite(spot) || spot <= 0) {
    return emptyRead();
  }

  const gammaFlip = findCumulativeGammaFlip(nodes, spot);
  const zeroGamma = findLocalZeroGamma(nodes, spot, expectedMove);
  const dealerNeutral = findDealerNeutral(nodes, spot);
  const maxPain = calculateMaxPain(nodes);

  const callWallStrength = sideWallStrength(nodes, callWall, "call");
  const putWallStrength = sideWallStrength(nodes, putWall, "put");
  const pinProbability = calculatePinProbability(nodes, pin, spot, expectedMove);

  const rawLevels: Array<{
    key: StructuralLevelKey;
    label: string;
    value: number | null;
    strength: number;
    basis: string;
  }> = [
    {
      key: "callWall",
      label: "Call Wall",
      value: callWall,
      strength: callWallStrength,
      basis: "Call OI plus gamma concentration at the strongest call-side strike.",
    },
    {
      key: "putWall",
      label: "Put Wall",
      value: putWall,
      strength: putWallStrength,
      basis: "Put OI plus gamma concentration at the strongest put-side strike.",
    },
    {
      key: "pin",
      label: "Pin",
      value: pin,
      strength: pinProbability,
      basis: "Near-spot concentration, call/put balance and distance-adjusted strike gravity.",
    },
    {
      key: "gammaFlip",
      label: "Gamma Flip",
      value: gammaFlip,
      strength: levelStrength(nodes, gammaFlip),
      basis: "Model proxy where cumulative call-positive/put-negative gamma exposure crosses neutral.",
    },
    {
      key: "zeroGamma",
      label: "Zero Gamma",
      value: zeroGamma,
      strength: levelStrength(nodes, zeroGamma),
      basis: "Nearest liquid strike where local signed gamma imbalance is smallest.",
    },
    {
      key: "dealerNeutral",
      label: "Dealer Neutral",
      value: dealerNeutral,
      strength: levelStrength(nodes, dealerNeutral),
      basis: "Strike where cumulative modeled call/put hedge pressure is closest to balance.",
    },
    {
      key: "maxPain",
      label: "Max Pain",
      value: maxPain,
      strength: levelStrength(nodes, maxPain),
      basis: "Strike minimizing aggregate intrinsic payout implied by current open interest.",
    },
  ];

  const levels = rawLevels.map((level) => ({
    ...level,
    confidence: levelConfidence({
      value: level.value,
      strength: level.strength,
      spot,
      expectedMove,
      nodeCount: nodes.length,
    }),
    distanceFromSpot:
      level.value == null ? null : Number((level.value - spot).toFixed(2)),
  }));

  const available = levels.filter((level) => level.value != null);
  const structuralConfidence = clamp(
    Math.round(
      average(available.map((level) => level.confidence)) * 0.65 +
        average([callWallStrength, putWallStrength, pinProbability]) * 0.35,
    ),
    0,
    100,
  );

  const dominant = [...available].sort(
    (a, b) => dominanceScore(b, spot, expectedMove) - dominanceScore(a, spot, expectedMove),
  )[0];

  const supportRanking = levels
    .filter((level) => level.value != null && Number(level.value) <= spot)
    .sort((a, b) => dominanceScore(b, spot, expectedMove) - dominanceScore(a, spot, expectedMove));

  const resistanceRanking = levels
    .filter((level) => level.value != null && Number(level.value) >= spot)
    .sort((a, b) => dominanceScore(b, spot, expectedMove) - dominanceScore(a, spot, expectedMove));

  return {
    gammaFlip,
    zeroGamma,
    dealerNeutral,
    maxPain,
    callWallStrength,
    putWallStrength,
    pinProbability,
    structuralConfidence,
    dominantLevel: dominant?.key ?? null,
    dominantLevelValue: dominant?.value ?? null,
    supportRanking,
    resistanceRanking,
    levels,
    notes: [
      "Gamma Flip, Zero Gamma and Dealer Neutral are WheelDesk model proxies because public chains do not disclose dealer ownership direction.",
      "Max Pain uses current open interest and can remain static intraday because exchange OI is generally updated after clearing.",
    ],
  };
}

function buildNodes(rows: ZeroDteChainRow[]): StrikeNode[] {
  const map = new Map<number, StrikeNode>();

  for (const row of rows) {
    if (!Number.isFinite(row.strike)) continue;
    const strike = Math.round(row.strike / 5) * 5;
    const node = map.get(strike) ?? {
      strike,
      callOi: 0,
      putOi: 0,
      callVolume: 0,
      putVolume: 0,
      callGamma: 0,
      putGamma: 0,
      signedGamma: 0,
      totalGamma: 0,
      totalOi: 0,
      structureScore: 0,
    };

    const oi = safe(row.openInterest);
    const volume = safe(row.volume);
    const gammaWeight = Math.abs(safe(row.gamma)) * Math.max(oi, 1) * 1000;

    if (row.optionType === "call") {
      node.callOi += oi;
      node.callVolume += volume;
      node.callGamma += gammaWeight;
      node.signedGamma += gammaWeight;
    } else {
      node.putOi += oi;
      node.putVolume += volume;
      node.putGamma += gammaWeight;
      node.signedGamma -= gammaWeight;
    }

    node.totalGamma += gammaWeight;
    node.totalOi += oi;
    // Structural state is OI/gamma topology. Cumulative intraday volume is
    // handled separately by completed-minute strike flow so the map cannot
    // mechanically strengthen simply because the trading day gets older.
    node.structureScore = node.totalOi + node.totalGamma;
    map.set(strike, node);
  }

  return [...map.values()].sort((a, b) => a.strike - b.strike);
}

function findCumulativeGammaFlip(nodes: StrikeNode[], spot: number) {
  const totalAbs = nodes.reduce((sum, node) => sum + Math.abs(node.signedGamma), 0);
  if (!totalAbs) return null;

  let cumulative = 0;
  let previous: { strike: number; value: number } | null = null;
  const candidates: number[] = [];

  for (const node of nodes) {
    cumulative += node.signedGamma;
    if (previous && Math.sign(previous.value) !== Math.sign(cumulative)) {
      const span = cumulative - previous.value;
      const ratio = span === 0 ? 0.5 : Math.abs(previous.value / span);
      candidates.push(roundFive(previous.strike + (node.strike - previous.strike) * ratio));
    }
    previous = { strike: node.strike, value: cumulative };
  }

  return nearest(candidates, spot);
}

function findLocalZeroGamma(nodes: StrikeNode[], spot: number, expectedMove: number) {
  const radius = Math.max(expectedMove * 2, 100);
  const liquid = nodes.filter(
    (node) => Math.abs(node.strike - spot) <= radius && node.totalGamma > 0,
  );
  if (!liquid.length) return null;

  return [...liquid].sort((a, b) => {
    const aRatio = Math.abs(a.signedGamma) / Math.max(a.totalGamma, 1);
    const bRatio = Math.abs(b.signedGamma) / Math.max(b.totalGamma, 1);
    return aRatio - bRatio || Math.abs(a.strike - spot) - Math.abs(b.strike - spot);
  })[0]?.strike ?? null;
}

function findDealerNeutral(nodes: StrikeNode[], spot: number) {
  const totalCall = nodes.reduce(
    (sum, node) => sum + node.callOi + node.callGamma,
    0,
  );
  const totalPut = nodes.reduce(
    (sum, node) => sum + node.putOi + node.putGamma,
    0,
  );
  if (totalCall + totalPut <= 0) return null;

  let callBelow = 0;
  let putBelow = 0;
  const scored = nodes.map((node) => {
    callBelow += node.callOi + node.callGamma;
    putBelow += node.putOi + node.putGamma;
    const callAbove = totalCall - callBelow;
    const putAbove = totalPut - putBelow;
    const modeledNet = callAbove + putBelow - (putAbove + callBelow);
    return { strike: node.strike, imbalance: Math.abs(modeledNet) };
  });

  return scored.sort(
    (a, b) => a.imbalance - b.imbalance || Math.abs(a.strike - spot) - Math.abs(b.strike - spot),
  )[0]?.strike ?? null;
}

function calculateMaxPain(nodes: StrikeNode[]) {
  if (!nodes.length) return null;
  const candidates = nodes.map((node) => node.strike);
  let best: { strike: number; payout: number } | null = null;

  for (const settlement of candidates) {
    let payout = 0;
    for (const node of nodes) {
      payout += Math.max(0, settlement - node.strike) * node.callOi;
      payout += Math.max(0, node.strike - settlement) * node.putOi;
    }
    if (!best || payout < best.payout) best = { strike: settlement, payout };
  }

  return best?.strike ?? null;
}

function sideWallStrength(nodes: StrikeNode[], strike: number | null, side: "call" | "put") {
  if (strike == null) return 0;
  const scores = nodes.map((node) =>
    side === "call" ? node.callOi + node.callGamma : node.putOi + node.putGamma,
  );
  const max = Math.max(...scores, 0);
  const node = nodes.find((item) => item.strike === roundFive(strike));
  const value = node
    ? side === "call"
      ? node.callOi + node.callGamma
      : node.putOi + node.putGamma
    : 0;
  return max > 0 ? clamp(Math.round((value / max) * 100), 0, 100) : 0;
}

function calculatePinProbability(
  nodes: StrikeNode[],
  pin: number | null,
  spot: number,
  expectedMove: number,
) {
  if (pin == null) return 0;
  const node = nodes.find((item) => item.strike === roundFive(pin));
  if (!node) return 0;
  const maxScore = Math.max(...nodes.map((item) => item.structureScore), 1);
  const concentration = node.structureScore / maxScore;
  const balance =
    1 -
    Math.abs(node.callOi + node.callGamma - (node.putOi + node.putGamma)) /
      Math.max(node.callOi + node.callGamma + node.putOi + node.putGamma, 1);
  const distanceScore = 1 - clamp(Math.abs(pin - spot) / Math.max(expectedMove, 10), 0, 1);
  return clamp(Math.round((concentration * 0.45 + balance * 0.25 + distanceScore * 0.3) * 100), 0, 100);
}

function levelStrength(nodes: StrikeNode[], value: number | null) {
  if (value == null) return 0;
  const node = nodes.find((item) => item.strike === roundFive(value));
  const max = Math.max(...nodes.map((item) => item.structureScore), 1);
  return node ? clamp(Math.round((node.structureScore / max) * 100), 0, 100) : 35;
}

function levelConfidence(args: {
  value: number | null;
  strength: number;
  spot: number;
  expectedMove: number;
  nodeCount: number;
}) {
  if (args.value == null) return 0;
  const proximity =
    1 - clamp(Math.abs(args.value - args.spot) / Math.max(args.expectedMove * 2, 60), 0, 1);
  const coverage = clamp(args.nodeCount / 25, 0, 1);
  return clamp(Math.round(args.strength * 0.55 + proximity * 25 + coverage * 20), 0, 100);
}

function dominanceScore(level: StructuralLevel, spot: number, expectedMove: number) {
  const proximity =
    1 - clamp(Math.abs(Number(level.value) - spot) / Math.max(expectedMove * 1.5, 40), 0, 1);
  return level.strength * 0.5 + level.confidence * 0.35 + proximity * 15;
}

function nearest(values: number[], spot: number) {
  if (!values.length) return null;
  return [...values].sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot))[0];
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundFive(value: number) {
  return Math.round(value / 5) * 5;
}

function safe(value: number | null | undefined) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function emptyRead(): MarketStructureRead {
  return {
    gammaFlip: null,
    zeroGamma: null,
    dealerNeutral: null,
    maxPain: null,
    callWallStrength: 0,
    putWallStrength: 0,
    pinProbability: 0,
    structuralConfidence: 0,
    dominantLevel: null,
    dominantLevelValue: null,
    supportRanking: [],
    resistanceRanking: [],
    levels: [],
    notes: ["Insufficient live chain data to build the market-structure model."],
  };
}
